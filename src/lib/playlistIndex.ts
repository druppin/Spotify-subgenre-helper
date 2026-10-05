import { getCache } from "@/lib/cache";
import { SpotifyApiError, type LibraryTrack, type SpotifyClient } from "@/lib/spotify/client";

// Bumped whenever LibraryTrack gains fields, so entries cached in an older
// shape are re-fetched once instead of being read with fields missing.
const ENTRY_VERSION = 2;

interface IndexEntry {
  snapshotId: string | null;
  tracks?: LibraryTrack[];
  version?: number;
  fetchedAt: number;
}

interface LikedEntry {
  marker: string;
  tracks: LibraryTrack[];
  version?: number;
}

// playlistId -> track URIs in that playlist
export type PlaylistIndex = Record<string, string[]>;
// playlistId -> that playlist's tracks
export type LibraryIndex = Record<string, LibraryTrack[]>;

const indexCache = getCache<IndexEntry>("playlist-index");
const likedCache = getCache<LikedEntry>("liked-songs");
const CONCURRENCY = 4;
// Only used if Spotify ever omits snapshot_id, which normally tells us
// exactly when a playlist changed.
const NO_SNAPSHOT_MAX_AGE_MS = 60 * 60 * 1000;

let inFlight: Promise<LibraryIndex> | null = null;
let likedInFlight: Promise<LibraryTrack[]> | null = null;

/**
 * How far the current (or last) scan has got, for showing progress while a
 * long first scan runs. Null parts haven't started yet. Kept on globalThis
 * so the progress route sees the same object as the route running the scan.
 */
export interface ScanProgress {
  playlists: { fetched: number; toFetch: number; unchanged: number } | null;
  liked: { fetched: number; total: number | null; unchanged: boolean } | null;
  // Epoch ms until which Spotify asked us to hold off, if it has.
  rateLimitedUntil: number | null;
}

const progressHolder = globalThis as typeof globalThis & { __libraryScanProgress?: ScanProgress };
progressHolder.__libraryScanProgress ??= { playlists: null, liked: null, rateLimitedUntil: null };

export function getScanProgress(): ScanProgress {
  return progressHolder.__libraryScanProgress!;
}

function reportRateLimits(spotify: SpotifyClient) {
  spotify.onRateLimitWait = (waitMs) => {
    getScanProgress().rateLimitedUntil = Date.now() + waitMs;
  };
}

/**
 * Track URIs for every playlist the user can add to, re-downloading only
 * playlists whose snapshot_id changed since they were last indexed.
 * Concurrent callers share one sync.
 */
export async function getPlaylistIndex(spotify: SpotifyClient): Promise<PlaylistIndex> {
  const library = await getLibraryIndex(spotify);
  const index: PlaylistIndex = {};
  for (const [id, tracks] of Object.entries(library)) index[id] = tracks.map((t) => t.uri);
  return index;
}

/** Same as getPlaylistIndex, with each track's details. */
export function getLibraryIndex(spotify: SpotifyClient): Promise<LibraryIndex> {
  inFlight ??= syncIndex(spotify).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function syncIndex(spotify: SpotifyClient): Promise<LibraryIndex> {
  const progress = getScanProgress();
  progress.playlists = null;
  progress.rateLimitedUntil = null;
  reportRateLimits(spotify);
  const playlists = (await spotify.getUserPlaylists()).filter((p) => p.canModify);
  const index: LibraryIndex = {};
  const stale: typeof playlists = [];

  for (const playlist of playlists) {
    const entry = await indexCache.get(playlist.id);
    const fresh =
      entry?.tracks &&
      entry.version === ENTRY_VERSION &&
      (playlist.snapshot_id
        ? entry.snapshotId === playlist.snapshot_id
        : Date.now() - entry.fetchedAt < NO_SNAPSHOT_MAX_AGE_MS);
    if (fresh) index[playlist.id] = entry.tracks!;
    else stale.push(playlist);
  }

  const playlistProgress = { fetched: 0, toFetch: stale.length, unchanged: playlists.length - stale.length };
  progress.playlists = playlistProgress;

  const fetched: { id: string; entry: IndexEntry }[] = [];
  let next = 0;
  let rateLimited = false;
  const worker = async () => {
    while (next < stale.length && !rateLimited) {
      const playlist = stale[next++];
      try {
        const tracks = await spotify.getPlaylistLibraryTracks(playlist.id);
        fetched.push({
          id: playlist.id,
          entry: { snapshotId: playlist.snapshot_id ?? null, tracks, version: ENTRY_VERSION, fetchedAt: Date.now() },
        });
      } catch (err) {
        // A long rate limit would skip every remaining playlist, leaving an
        // index that silently misses tracks — fail the whole sync instead.
        if (err instanceof SpotifyApiError && err.status === 429) {
          rateLimited = true;
          throw err;
        }
        // One unreadable playlist shouldn't sink the whole index.
        console.error(`Indexing playlist ${playlist.id} failed:`, err);
      }
      playlistProgress.fetched++;
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // Written one at a time: FileCache rewrites its whole file on every set,
  // and overlapping writes to the same file could corrupt it.
  for (const { id, entry } of fetched) {
    await indexCache.set(id, entry);
    index[id] = entry.tracks!;
  }
  return index;
}

/**
 * The user's Liked Songs, re-downloaded only when its size or newest entry
 * has changed since the last fetch. Needs the user-library-read scope.
 */
export function getLikedSongs(spotify: SpotifyClient): Promise<LibraryTrack[]> {
  likedInFlight ??= syncLiked(spotify).finally(() => {
    likedInFlight = null;
  });
  return likedInFlight;
}

async function syncLiked(spotify: SpotifyClient): Promise<LibraryTrack[]> {
  const progress = getScanProgress();
  progress.liked = null;
  reportRateLimits(spotify);
  const marker = await spotify.getLikedTracksMarker();
  const entry = await likedCache.get("liked");
  if (entry?.marker === marker && entry.version === ENTRY_VERSION) {
    progress.liked = { fetched: entry.tracks.length, total: entry.tracks.length, unchanged: true };
    return entry.tracks;
  }
  progress.liked = { fetched: 0, total: null, unchanged: false };
  const tracks = await spotify.getLikedTracks((fetched, total) => {
    progress.liked = { fetched, total, unchanged: false };
  });
  await likedCache.set("liked", { marker, tracks, version: ENTRY_VERSION });
  return tracks;
}
