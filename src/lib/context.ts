import { getAudioFeatures } from "@/lib/reccobeats";
import { getCache } from "@/lib/cache";
import { getArtistInfo, getTrackTags } from "@/lib/lastfm";
import { getMusicBrainzInfo } from "@/lib/musicbrainz";
import type { SpotifyClient } from "@/lib/spotify/client";
import type { TrackContext } from "@/lib/llm/types";
import { getTrackDetailsCached } from "@/lib/playlistIndex";

// Bump the namespace whenever TrackContext gains a field, so contexts cached
// before it existed get rebuilt instead of served without it.
const contextCache = getCache<TrackContext>("track-context-v3");

/**
 * Pulls Spotify metadata + artist genre tags + Last.fm tags/bio + ReccoBeats
 * audio-feature data into one JSON object per track. Cached per track ID
 * so repeat plays of the same track (or a summary retry) don't re-fetch.
 */
export async function buildTrackContext(
  trackId: string,
  spotify: SpotifyClient
): Promise<TrackContext> {
  const cached = await contextCache.get(trackId);
  if (cached) return cached;

  // Free when a library scan, an opened playlist, or an earlier lookup has
  // already seen this song; otherwise one Spotify request.
  const track = await getTrackDetailsCached(spotify, trackId);
  const primaryArtistName = track.artists[0] ?? "";

  const [lastfmTrack, lastfmArtist, audioFeaturesByTrack, musicbrainz] = await Promise.all([
    getTrackTags(primaryArtistName, track.name),
    getArtistInfo(primaryArtistName),
    getAudioFeatures([trackId]),
    getMusicBrainzInfo(primaryArtistName, track.name),
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

  await contextCache.set(trackId, context);
  return context;
}
