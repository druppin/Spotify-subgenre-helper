import { getAudioFeatures } from "@/lib/reccobeats";
import { getRecordLabel } from "@/lib/deezer";
import { getCache } from "@/lib/cache";
import { clashes, type LastfmArtistCheck } from "@/lib/artistCheck";
import { getArtistInfo, getTrackTags, type LastfmArtistInfo } from "@/lib/lastfm";
import { artistIdFor, getMusicBrainzInfo } from "@/lib/musicbrainz";
import type { SpotifyClient } from "@/lib/spotify/client";
import type { TrackContext } from "@/lib/llm/types";
import { getTrackDetailsCached } from "@/lib/playlistIndex";

// Bump the namespace whenever TrackContext gains a field, so contexts cached
// before it existed get rebuilt instead of served without it. (v4 also
// dropped contexts saved empty because a lookup had failed; v5 checks
// Last.fm's artist against MusicBrainz, and adds lastfmArtistCheck; v6 adds
// recordLabel.)
const contextCache = getCache<TrackContext>("track-context-v6");

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
  const [[lastfmTrack, lastfmByName], audioFeaturesByTrack, { credits, ...musicbrainz }, recordLabel] = await Promise.all([
    reported(
      "lastfm",
      Promise.all([
        getTrackTags(primaryArtistName, track.name, onFailure),
        getArtistInfo(primaryArtistName, onFailure),
      ])
    ),
    reported("audio", getAudioFeatures([trackId], onFailure)),
    reported("musicbrainz", getMusicBrainzInfo(primaryArtistName, track.name, onFailure, refresh)),
    getRecordLabel(track.isrc, onFailure),
  ]);
  const { lastfmArtist, lastfmArtistCheck } = checkLastfmArtist(
    lastfmByName,
    artistIdFor(credits, primaryArtistName),
    [
      ...lastfmTrack,
      ...[...musicbrainz.recordingTags, ...musicbrainz.releaseGroupGenres].map((v) => v.name),
      ...musicbrainz.artistGenres.flatMap((a) => a.genres.map((v) => v.name)),
    ]
  );

  const context: TrackContext = {
    trackId,
    trackName: track.name,
    artistNames: track.artists,
    albumName: track.album ?? "",
    releaseDate: track.releaseDate ?? "",
    recordLabel,
    // Spotify returns no artist genres to development-mode apps (none of the
    // first ~280 cached contexts got any), so fetching each artist just spent
    // rate limit. Kept empty so the prompt and cached contexts keep their shape.
    artistGenres: [],
    lastfmTrackTags: lastfmTrack,
    lastfmArtistTags: lastfmArtist.tags,
    lastfmArtistBio: lastfmArtist.bioSummary,
    lastfmArtistCheck,
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

const NO_ARTIST_INFO = { tags: [], bioSummary: null };

/**
 * Last.fm's artist, checked against the artist MusicBrainz credits on the
 * matched recording (Last.fm finds artists by name, so it can return someone
 * else with the same name). A mismatch is left out rather than looked up
 * again by MusicBrainz id: Last.fm's pages are keyed by name, so that lands
 * on the same page. A matching id isn't enough on its own either: Last.fm
 * merges same-named artists onto one page (its "Rova" has the drum and bass
 * producer's id and a jazz quartet's tags), so tags that clash with every
 * other genre the song has are left out as well.
 */
function checkLastfmArtist(
  byName: (LastfmArtistInfo & { mbid: string | null }) | null,
  musicbrainzArtistId: string | null,
  songGenres: string[]
): { lastfmArtist: LastfmArtistInfo; lastfmArtistCheck: LastfmArtistCheck } {
  if (!byName) return { lastfmArtist: NO_ARTIST_INFO, lastfmArtistCheck: "unconfirmed" };
  if (musicbrainzArtistId && byName.mbid && byName.mbid !== musicbrainzArtistId) {
    return { lastfmArtist: NO_ARTIST_INFO, lastfmArtistCheck: "removed: different artist" };
  }
  if (clashes(byName.tags, songGenres)) {
    return { lastfmArtist: NO_ARTIST_INFO, lastfmArtistCheck: "removed: clashes with this song's genres" };
  }
  const confirmed = Boolean(musicbrainzArtistId && byName.mbid === musicbrainzArtistId);
  return { lastfmArtist: byName, lastfmArtistCheck: confirmed ? "confirmed" : "unconfirmed" };
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
