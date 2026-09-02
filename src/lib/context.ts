import { getAudioFeatures } from "@/lib/reccobeats";
import { getCache } from "@/lib/cache";
import { getArtistInfo, getTrackTags } from "@/lib/lastfm";
import type { SpotifyClient } from "@/lib/spotify/client";
import type { TrackContext } from "@/lib/llm/types";

const contextCache = getCache<TrackContext>("track-context");

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

  const track = await spotify.getTrack(trackId);
  const artists = await spotify.getArtists(track.artists.map((a) => a.id));
  const primaryArtistName = track.artists[0]?.name ?? "";

  const [lastfmTrack, lastfmArtist, audioFeaturesByTrack] = await Promise.all([
    getTrackTags(primaryArtistName, track.name),
    getArtistInfo(primaryArtistName),
    getAudioFeatures([trackId]),
  ]);

  const context: TrackContext = {
    trackId,
    trackName: track.name,
    artistNames: track.artists.map((a) => a.name),
    albumName: track.album.name,
    releaseDate: track.album.release_date,
    artistGenres: [...new Set(artists.flatMap((a) => a.genres ?? []))],
    lastfmTrackTags: lastfmTrack,
    lastfmArtistTags: lastfmArtist.tags,
    lastfmArtistBio: lastfmArtist.bioSummary,
    audioFeatures: audioFeaturesByTrack[trackId] ?? null,
  };

  await contextCache.set(trackId, context);
  return context;
}
