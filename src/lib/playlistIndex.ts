import { getCache } from "@/lib/cache";
import type { SpotifyClient } from "@/lib/spotify/client";

interface IndexEntry {
  snapshotId: string | null;
  uris: string[];
  fetchedAt: number;
}

// playlistId -> track URIs in that playlist
export type PlaylistIndex = Record<string, string[]>;

const indexCache = getCache<IndexEntry>("playlist-index");
const CONCURRENCY = 4;
// Only used if Spotify ever omits snapshot_id, which normally tells us
// exactly when a playlist changed.
const NO_SNAPSHOT_MAX_AGE_MS = 60 * 60 * 1000;

let inFlight: Promise<PlaylistIndex> | null = null;

/**
 * Track URIs for every playlist the user can add to, re-downloading only
 * playlists whose snapshot_id changed since they were last indexed.
 * Concurrent callers share one sync.
 */
export function getPlaylistIndex(spotify: SpotifyClient): Promise<PlaylistIndex> {
  inFlight ??= syncIndex(spotify).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function syncIndex(spotify: SpotifyClient): Promise<PlaylistIndex> {
  const playlists = (await spotify.getUserPlaylists()).filter((p) => p.canModify);
  const index: PlaylistIndex = {};
  const stale: typeof playlists = [];

  for (const playlist of playlists) {
    const entry = await indexCache.get(playlist.id);
    const fresh =
      entry &&
      (playlist.snapshot_id
        ? entry.snapshotId === playlist.snapshot_id
        : Date.now() - entry.fetchedAt < NO_SNAPSHOT_MAX_AGE_MS);
    if (fresh) index[playlist.id] = entry.uris;
    else stale.push(playlist);
  }

  const fetched: { id: string; entry: IndexEntry }[] = [];
  let next = 0;
  const worker = async () => {
    while (next < stale.length) {
      const playlist = stale[next++];
      try {
        const uris = await spotify.getPlaylistTrackUris(playlist.id);
        fetched.push({
          id: playlist.id,
          entry: { snapshotId: playlist.snapshot_id ?? null, uris, fetchedAt: Date.now() },
        });
      } catch (err) {
        // One unreadable playlist shouldn't sink the whole index.
        console.error(`Indexing playlist ${playlist.id} failed:`, err);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // Written one at a time: FileCache rewrites its whole file on every set,
  // and overlapping writes to the same file could corrupt it.
  for (const { id, entry } of fetched) {
    await indexCache.set(id, entry);
    index[id] = entry.uris;
  }
  return index;
}
