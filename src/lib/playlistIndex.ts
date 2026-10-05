import { getCache } from "@/lib/cache";
import type { LibraryCoverage, LibraryFetchMode } from "@/lib/library";
import {
  SpotifyApiError,
  isCompleteTrack,
  type LibraryTrack,
  type SpotifyClient,
  type SpotifyPlaylist,
} from "@/lib/spotify/client";

/*
 * Everything the app knows about the user's library, built up from whatever
 * requests happen to see it — a full library scan, a playlist opened in the
 * sorter, a single song's genre lookup — so no request is spent twice on
 * the same data. Nothing here scans on its own: callers choose whether to
 * fetch (and how much) or only read what's cached.
 */

// v3 entries carry album details (see LibraryTrack); v2 entries have the
// right songs without them and stay usable until something re-fetches the
// playlist anyway.
const ENTRY_VERSION = 3;
const MIN_USABLE_VERSION = 2;

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
// Single songs looked up on their own (e.g. for genre info), for songs no
// cached playlist has complete details for.
const trackDetailsCache = getCache<LibraryTrack>("track-details");

// Kept low: bursts of parallel requests are what draw Spotify's long blocks.
const CONCURRENCY = 2;
// Only used if Spotify ever omits snapshot_id, which normally tells us
// exactly when a playlist changed.
const NO_SNAPSHOT_MAX_AGE_MS = 60 * 60 * 1000;
// How long a fetched playlist list is reused before asking again. Also how
// long an edit made in the Spotify app can go unnoticed here (the app's own
// edits clear the list right away).
const LISTING_MAX_AGE_MS = 15 * 60 * 1000;
// The app's own edits update a cached playlist in place only if that copy
// was confirmed current this recently; otherwise a change made elsewhere
// (e.g. in the Spotify app) could be papered over by the new snapshot.
const EDIT_PATCH_MAX_AGE_MS = 30 * 60 * 1000;

/**
 * How far the current (or last) scan has got, for showing progress while a
 * long scan runs. Null parts haven't started yet.
 */
export interface ScanProgress {
  playlists: { fetched: number; toFetch: number; unchanged: number } | null;
  liked: { fetched: number; total: number | null; unchanged: boolean } | null;
  // Epoch ms until which Spotify asked us to hold off, if it has.
  rateLimitedUntil: number | null;
}

interface SharedState {
  listing: { playlists: SpotifyPlaylist[]; fetchedAt: number } | null;
  listingInFlight: Promise<SpotifyPlaylist[]> | null;
  // playlistId -> when its cached copy was last confirmed current.
  verifiedAt: Map<string, number>;
  // Serializes syncs that fetch, so two never download the same playlist.
  syncChain: Promise<unknown>;
  // uri -> best known details, built lazily from every cache above.
  catalog: Map<string, LibraryTrack> | null;
  progress: ScanProgress;
}

// On globalThis so every route shares one copy (and so the progress route
// sees the same object as the route running the scan).
const holder = globalThis as typeof globalThis & { __libraryState?: SharedState };
holder.__libraryState ??= {
  listing: null,
  listingInFlight: null,
  verifiedAt: new Map(),
  syncChain: Promise.resolve(),
  catalog: null,
  progress: { playlists: null, liked: null, rateLimitedUntil: null },
};
const state = holder.__libraryState;

export function getScanProgress(): ScanProgress {
  return state.progress;
}

function reportRateLimits(spotify: SpotifyClient) {
  spotify.onRateLimitWait = (waitMs) => {
    state.progress.rateLimitedUntil = Date.now() + waitMs;
  };
}

function requestsFor(playlist: SpotifyPlaylist): number {
  return Math.max(1, Math.ceil((playlist.tracks?.total ?? 0) / 100));
}

// Runs fetching work one job at a time, so overlapping requests never
// download the same playlist twice.
function serialized<T>(job: () => Promise<T>): Promise<T> {
  const run = state.syncChain.then(job);
  state.syncChain = run.catch(() => {});
  return run;
}

// ---------------------------------------------------------------------------
// The playlist list

/** The user's playlists, reused for a few minutes unless `fresh` is asked for. */
export async function getPlaylistsListing(
  spotify: SpotifyClient,
  { fresh = false }: { fresh?: boolean } = {}
): Promise<SpotifyPlaylist[]> {
  if (!fresh && state.listing && Date.now() - state.listing.fetchedAt < LISTING_MAX_AGE_MS) {
    return state.listing.playlists;
  }
  state.listingInFlight ??= spotify
    .getUserPlaylists()
    .then((playlists) => {
      state.listing = { playlists, fetchedAt: Date.now() };
      return playlists;
    })
    .finally(() => {
      state.listingInFlight = null;
    });
  return state.listingInFlight;
}

/** Forget the cached playlist list, e.g. after creating a playlist. */
export function invalidateListing() {
  state.listing = null;
}

// ---------------------------------------------------------------------------
// Playlists

type EntryState = "fresh" | "incomplete" | "changed" | "notScanned";

function entryState(entry: IndexEntry | undefined, playlist: SpotifyPlaylist): EntryState {
  if (!entry?.tracks || (entry.version ?? 0) < MIN_USABLE_VERSION) return "notScanned";
  const current = playlist.snapshot_id
    ? entry.snapshotId === playlist.snapshot_id
    : Date.now() - entry.fetchedAt < NO_SNAPSHOT_MAX_AGE_MS;
  if (!current) return "changed";
  return (entry.version ?? 0) < ENTRY_VERSION ? "incomplete" : "fresh";
}

async function saveEntry(playlistId: string, entry: IndexEntry) {
  await indexCache.set(playlistId, entry);
  state.verifiedAt.set(playlistId, Date.now());
  state.catalog = null;
}

/**
 * Cached playlists (and how current they are), fetching any that `mode` and
 * `onlyIds` call for:
 * - "none": fetch nothing; changed playlists are returned as cached.
 * - "update": fetch playlists that changed or were never scanned.
 * - "complete": also re-fetch playlists cached without album details.
 * `onlyIds` limits fetching (not what's returned) to those playlists.
 */
export async function getLibrary(
  spotify: SpotifyClient,
  mode: LibraryFetchMode,
  onlyIds?: string[]
): Promise<{ index: LibraryIndex; coverage: LibraryCoverage["playlists"] }> {
  if (mode === "none") return readLibrary(await getPlaylistsListing(spotify), null);
  return serialized(async () => {
    // A fetching sync wants current snapshots, not a listing minutes old.
    const playlists = await getPlaylistsListing(spotify, { fresh: true });
    return readLibrary(playlists, { spotify, mode, onlyIds });
  });
}

async function readLibrary(
  allPlaylists: SpotifyPlaylist[],
  fetch: { spotify: SpotifyClient; mode: "update" | "complete"; onlyIds?: string[] } | null
): Promise<{ index: LibraryIndex; coverage: LibraryCoverage["playlists"] }> {
  const playlists = allPlaylists.filter((p) => p.canModify);
  const index: LibraryIndex = {};
  const states = new Map<string, EntryState>();
  for (const playlist of playlists) {
    const entry = await indexCache.get(playlist.id);
    const current = entryState(entry, playlist);
    states.set(playlist.id, current);
    if (current !== "notScanned") index[playlist.id] = entry!.tracks!;
    if (current === "fresh" || current === "incomplete") state.verifiedAt.set(playlist.id, Date.now());
  }

  if (fetch) {
    const wanted = new Set<EntryState>(
      fetch.mode === "complete" ? ["changed", "notScanned", "incomplete"] : ["changed", "notScanned"]
    );
    const toFetch = playlists.filter(
      (p) => wanted.has(states.get(p.id)!) && (!fetch.onlyIds || fetch.onlyIds.includes(p.id))
    );
    await fetchPlaylists(fetch.spotify, toFetch, playlists.length - toFetch.length, (id, tracks) => {
      index[id] = tracks;
      states.set(id, "fresh");
    });
  }

  const coverage: LibraryCoverage["playlists"] = {
    total: playlists.length,
    fresh: 0,
    incomplete: 0,
    changed: 0,
    notScanned: 0,
    requestsToUpdate: 0,
    requestsToComplete: 0,
  };
  for (const playlist of playlists) {
    const current = states.get(playlist.id)!;
    coverage[current]++;
    if (current === "changed" || current === "notScanned") coverage.requestsToUpdate += requestsFor(playlist);
    if (current !== "fresh") coverage.requestsToComplete += requestsFor(playlist);
  }
  return { index, coverage };
}

async function fetchPlaylists(
  spotify: SpotifyClient,
  playlists: SpotifyPlaylist[],
  unchanged: number,
  onFetched: (id: string, tracks: LibraryTrack[]) => void
) {
  const progress = state.progress;
  progress.rateLimitedUntil = null;
  reportRateLimits(spotify);
  const playlistProgress = { fetched: 0, toFetch: playlists.length, unchanged };
  progress.playlists = playlistProgress;

  const fetched: { id: string; entry: IndexEntry }[] = [];
  let next = 0;
  let rateLimited = false;
  const worker = async () => {
    while (next < playlists.length && !rateLimited) {
      const playlist = playlists[next++];
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
  // Let every worker finish before saving, then save even if the sync
  // failed: playlists downloaded before a rate limit hit are still good, and
  // throwing them away means spending requests on them again next time.
  const results = await Promise.allSettled(Array.from({ length: CONCURRENCY }, worker));

  // Written one at a time: FileCache rewrites its whole file on every set,
  // and overlapping writes to the same file could corrupt it.
  for (const { id, entry } of fetched) {
    await saveEntry(id, entry);
    onFetched(id, entry.tracks!);
  }
  const failure = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failure) throw failure.reason;
}

/** Track URIs per playlist, for the sorter's "already in this playlist" marks. */
export async function getPlaylistIndex(
  spotify: SpotifyClient,
  mode: LibraryFetchMode,
  onlyIds?: string[]
): Promise<PlaylistIndex> {
  const { index } = await getLibrary(spotify, mode, onlyIds);
  const uris: PlaylistIndex = {};
  for (const [id, tracks] of Object.entries(index)) uris[id] = tracks.map((t) => t.uri);
  return uris;
}

/**
 * One playlist's tracks for the sorter. Costs a single request when the
 * cached copy is current; otherwise downloads it, and the download becomes
 * part of the cached library (so a later library scan can skip it).
 */
export function getPlaylistTracksCached(spotify: SpotifyClient, playlistId: string): Promise<LibraryTrack[]> {
  return serialized(async () => {
    const listed =
      state.listing && Date.now() - state.listing.fetchedAt < LISTING_MAX_AGE_MS
        ? state.listing.playlists.find((p) => p.id === playlistId)
        : undefined;
    const snapshotId = listed?.snapshot_id ?? (await spotify.getPlaylistSnapshot(playlistId));
    const entry = await indexCache.get(playlistId);
    if (entry?.tracks && entry.version === ENTRY_VERSION && snapshotId && entry.snapshotId === snapshotId) {
      state.verifiedAt.set(playlistId, Date.now());
      return entry.tracks;
    }
    const tracks = await spotify.getPlaylistLibraryTracks(playlistId);
    await saveEntry(playlistId, { snapshotId, tracks, version: ENTRY_VERSION, fetchedAt: Date.now() });
    return tracks;
  });
}

/**
 * Applies the app's own add/remove to the cached playlist, so that edit
 * doesn't make the next scan or sorter visit download the playlist again.
 * Skipped (leaving the cache to look changed) when the cached copy wasn't
 * recently confirmed current or an added song's details aren't known.
 */
export function recordOwnEdit(
  playlistId: string,
  change: { added?: string[]; removed?: string[] },
  newSnapshotId: string | null
): Promise<void> {
  // The cached list's snapshot for this playlist is now out of date.
  invalidateListing();
  return serialized(async () => {
    const entry = await indexCache.get(playlistId);
    const verified = state.verifiedAt.get(playlistId);
    if (!entry?.tracks || !newSnapshotId || !verified || Date.now() - verified > EDIT_PATCH_MAX_AGE_MS) return;

    let tracks = entry.tracks;
    let version = entry.version ?? MIN_USABLE_VERSION;
    if (change.removed?.length) {
      const removed = new Set(change.removed);
      tracks = tracks.filter((t) => !removed.has(t.uri));
    }
    if (change.added?.length) {
      const now = new Date().toISOString();
      const added: LibraryTrack[] = [];
      for (const uri of change.added) {
        const details = await findTrackDetails(uri);
        if (!details) return;
        if (!isCompleteTrack(details)) version = Math.min(version, MIN_USABLE_VERSION);
        added.push({ ...details, addedAt: now });
      }
      tracks = [...tracks, ...added];
    }
    await saveEntry(playlistId, { snapshotId: newSnapshotId, tracks, version, fetchedAt: Date.now() });
  });
}

/** Caches a just-created (empty) playlist so it never needs downloading. */
export async function recordNewPlaylist(playlist: SpotifyPlaylist) {
  invalidateListing();
  if (!playlist.snapshot_id) return;
  await serialized(() =>
    saveEntry(playlist.id, { snapshotId: playlist.snapshot_id!, tracks: [], version: ENTRY_VERSION, fetchedAt: Date.now() })
  );
}

// ---------------------------------------------------------------------------
// Liked Songs

/**
 * Liked Songs, per `mode` as in getLibrary. Liked Songs has no snapshot_id,
 * so knowing whether it changed costs one request — which "none" skips.
 * Needs the user-library-read scope.
 */
export async function getLikedSongs(
  spotify: SpotifyClient,
  mode: LibraryFetchMode
): Promise<{ tracks: LibraryTrack[] | null; status: LibraryCoverage["likedSongs"] }> {
  const entry = await likedCache.get("liked");
  const usable = entry && (entry.version ?? 0) >= MIN_USABLE_VERSION ? entry : undefined;
  if (mode === "none") {
    const status = !usable ? "notScanned" : (usable.version ?? 0) < ENTRY_VERSION ? "incomplete" : "unchecked";
    return { tracks: usable?.tracks ?? null, status };
  }

  return serialized(async () => {
    const progress = state.progress;
    progress.liked = null;
    reportRateLimits(spotify);
    const marker = await spotify.getLikedTracksMarker();
    const complete = (usable?.version ?? 0) >= ENTRY_VERSION;
    if (usable && usable.marker === marker && (complete || mode === "update")) {
      progress.liked = { fetched: usable.tracks.length, total: usable.tracks.length, unchanged: true };
      return { tracks: usable.tracks, status: complete ? "fresh" : "incomplete" } as const;
    }
    progress.liked = { fetched: 0, total: null, unchanged: false };
    const tracks = await spotify.getLikedTracks((fetched, total) => {
      progress.liked = { fetched, total, unchanged: false };
    });
    await likedCache.set("liked", { marker, tracks, version: ENTRY_VERSION });
    state.catalog = null;
    return { tracks, status: "fresh" } as const;
  });
}

// ---------------------------------------------------------------------------
// Single songs

async function buildCatalog(): Promise<Map<string, LibraryTrack>> {
  const catalog = new Map<string, LibraryTrack>();
  const consider = (track: LibraryTrack) => {
    const existing = catalog.get(track.uri);
    if (!existing || (!isCompleteTrack(existing) && isCompleteTrack(track))) catalog.set(track.uri, track);
  };
  for (const [, entry] of await indexCache.entries()) entry.tracks?.forEach(consider);
  (await likedCache.get("liked"))?.tracks.forEach(consider);
  for (const [, track] of await trackDetailsCache.entries()) consider(track);
  return catalog;
}

/** Everything known about a song from any cached source, or null. */
export async function findTrackDetails(uri: string): Promise<LibraryTrack | null> {
  state.catalog ??= await buildCatalog();
  return state.catalog.get(uri) ?? null;
}

/**
 * A song's details for genre lookups: from the cache when anything has
 * already seen it with album details, otherwise one request to Spotify,
 * which is then cached too.
 */
export async function getTrackDetailsCached(spotify: SpotifyClient, trackId: string): Promise<LibraryTrack> {
  const uri = `spotify:track:${trackId}`;
  const known = await findTrackDetails(uri);
  if (known && isCompleteTrack(known)) return known;
  const details = await spotify.getTrackDetails(trackId);
  await trackDetailsCache.set(uri, details);
  state.catalog?.set(uri, details);
  return details;
}
