import { getAudioFeatures } from "@/lib/reccobeats";
import { getCache } from "@/lib/cache";
import { getArtistInfo, getTrackTags } from "@/lib/lastfm";
import { getMusicBrainzInfo } from "@/lib/musicbrainz";
import type { SpotifyClient } from "@/lib/spotify/client";
import type { TrackContext } from "@/lib/llm/types";
import { getTrackDetailsCached } from "@/lib/playlistIndex";

// Bump the namespace whenever TrackContext gains a field, so contexts cached
// before it existed get rebuilt instead of served without it. (v4 also
// dropped contexts saved empty because a lookup had failed.)
const contextCache = getCache<TrackContext>("track-context-v4");

// The sources a context is built from, reported as each one finishes so a
// caller can show per-song progress.
export const CONTEXT_STEPS = ["spotify", "lastfm", "audio", "musicbrainz"] as const;
export type ContextStep = (typeof CONTEXT_STEPS)[number];
// The full set for a summary: the context sources, then the AI itself.
export type SummaryStep = ContextStep | "ai";

/**
 * Pulls Spotify metadata + artist genre tags + Last.fm tags/bio + ReccoBeats
 * audio-feature data into one JSON object per track. Cached per track ID
 * so repeat plays of the same track (or a summary retry) don't re-fetch —
 * but only when every lookup worked, so a rate-limited or timed-out source
 * isn't remembered as "no data" for good. refresh fetches again anyway
 * (for regenerating), skipping MusicBrainz's artist/album cache too, and
 * falls back to the cached copy if a lookup fails.
 */
export async function buildTrackContext(
  trackId: string,
  spotify: SpotifyClient,
  onStep?: (step: ContextStep) => void,
  refresh = false
): Promise<{ context: TrackContext; lookupFailed: boolean }> {
  const cached = await contextCache.get(trackId);
  if (cached && !refresh) {
    for (const step of CONTEXT_STEPS) onStep?.(step);
    return { context: cached, lookupFailed: false };
  }

  const reported = <T>(step: ContextStep, promise: Promise<T>) =>
    promise.then((value) => {
      onStep?.(step);
      return value;
    });

  // Free when a library scan, an opened playlist, or an earlier lookup has
  // already seen this song; otherwise one Spotify request.
  const track = await reported("spotify", getTrackDetailsCached(spotify, trackId));
  const primaryArtistName = track.artists[0] ?? "";

  let failed = false;
  const onFailure = () => {
    failed = true;
  };
  const [[lastfmTrack, lastfmArtist], audioFeaturesByTrack, musicbrainz] = await Promise.all([
    reported(
      "lastfm",
      Promise.all([getTrackTags(primaryArtistName, track.name, onFailure), getArtistInfo(primaryArtistName, onFailure)])
    ),
    reported("audio", getAudioFeatures([trackId], onFailure)),
    reported("musicbrainz", getMusicBrainzInfo(primaryArtistName, track.name, onFailure, refresh)),
  ]);

  const context: TrackContext = {
    trackId,
    trackName: track.name,
    artistNames: track.artists,
    albumName: track.album ?? "",
    releaseDate: track.releaseDate ?? "",
    // Spotify returns no artist genres to development-mode apps (none of the
    // first ~280 cached contexts got any), so fetching each artist just spent
    // rate limit. Kept empty so the prompt and cached contexts keep their shape.
    artistGenres: [],
    lastfmTrackTags: lastfmTrack,
    lastfmArtistTags: lastfmArtist.tags,
    lastfmArtistBio: lastfmArtist.bioSummary,
    musicbrainz,
    audioFeatures: audioFeaturesByTrack[trackId] ?? null,
  };

  if (failed) {
    console.warn(`Track context for ${trackId} is missing data from a failed lookup; not caching it.`);
    return cached ? { context: cached, lookupFailed: false } : { context, lookupFailed: true };
  }
  await contextCache.set(trackId, context);
  return { context, lookupFailed: false };
}

// Whether a context has anything to base genres on beyond the song's own
// name and artist (Spotify gives development-mode apps no artist genres).
export function hasGenreEvidence(context: TrackContext): boolean {
  return (
    context.lastfmTrackTags.length > 0 ||
    context.lastfmArtistTags.length > 0 ||
    !!context.lastfmArtistBio ||
    !!context.musicbrainz.matchedRecording ||
    !!context.audioFeatures
  );
}
