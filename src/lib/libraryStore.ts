import { existsSync, readFileSync } from "fs";
import path from "path";
import { once, sql, transaction } from "@/lib/db";
import { LIKED_SONGS_ID } from "@/lib/library";
import { baseTitle } from "@/lib/songIdentity";
import { isCompleteTrack, type LibraryTrack } from "@/lib/spotify/client";

/*
 * Cached playlists, Liked Songs and song details, stored in the library
 * database (see db.ts). Each song's details are stored once, however many
 * places it's in; places list songs by URI with when each was added.
 */

export interface PlaceInfo {
  snapshotId: string | null;
  version: number;
  fetchedAt: number;
}

interface TrackRow {
  uri: string;
  name: string;
  artists: string;
  image: string | null;
  image_large: string | null;
  isrc: string | null;
  duration_ms: number;
  album: string | null;
  release_date: string | null;
  complete: number;
}

function toLibraryTrack(row: TrackRow, addedAt: string): LibraryTrack {
  const track: LibraryTrack = {
    uri: row.uri,
    name: row.name,
    artists: JSON.parse(row.artists) as string[],
    image: row.image,
    isrc: row.isrc,
    durationMs: row.duration_ms,
    addedAt,
  };
  // Incomplete songs leave album details undefined, as isCompleteTrack expects.
  if (row.complete) {
    track.album = row.album;
    track.releaseDate = row.release_date ?? null;
    track.imageLarge = row.image_large ?? null;
  }
  return track;
}

// Complete details never get replaced by incomplete ones from an older copy.
function upsertTrack(track: LibraryTrack) {
  sql(
    `INSERT INTO tracks (uri, name, artists, image, image_large, isrc, duration_ms, album, release_date, complete, base_title)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (uri) DO UPDATE SET
       name = excluded.name, base_title = excluded.base_title, artists = excluded.artists, image = excluded.image,
       image_large = excluded.image_large, isrc = excluded.isrc, duration_ms = excluded.duration_ms,
       album = excluded.album, release_date = excluded.release_date, complete = excluded.complete
     WHERE excluded.complete >= tracks.complete`
  ).run(
    track.uri,
    track.name,
    JSON.stringify(track.artists),
    track.image,
    track.imageLarge ?? null,
    track.isrc,
    track.durationMs,
    track.album ?? null,
    track.releaseDate ?? null,
    isCompleteTrack(track) ? 1 : 0,
    baseTitle(track.name)
  );
}

function writePlace(
  id: string,
  info: PlaceInfo & { name?: string | null },
  tracks: LibraryTrack[]
) {
  sql(
    `INSERT INTO places (id, kind, name, snapshot_id, version, fetched_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       name = coalesce(excluded.name, places.name), snapshot_id = excluded.snapshot_id,
       version = excluded.version, fetched_at = excluded.fetched_at`
  ).run(
    id,
    id === LIKED_SONGS_ID ? "liked" : "playlist",
    info.name ?? (id === LIKED_SONGS_ID ? "Liked Songs" : null),
    info.snapshotId,
    info.version,
    info.fetchedAt
  );
  sql("DELETE FROM place_tracks WHERE place_id = ?").run(id);
  const insert = sql("INSERT INTO place_tracks (place_id, position, track_uri, added_at) VALUES (?, ?, ?, ?)");
  tracks.forEach((track, position) => {
    upsertTrack(track);
    insert.run(id, position, track.uri, track.addedAt);
  });
}

// ---------------------------------------------------------------------------
// Places (playlists and Liked Songs)

export function getPlaceInfo(id: string): PlaceInfo | undefined {
  importLegacyCache();
  const row = sql("SELECT snapshot_id, version, fetched_at FROM places WHERE id = ?").get(id) as
    | { snapshot_id: string | null; version: number; fetched_at: number }
    | undefined;
  return row && { snapshotId: row.snapshot_id, version: row.version, fetchedAt: row.fetched_at };
}

/** A place's songs in playlist order. */
export function getPlaceTracks(id: string): LibraryTrack[] {
  importLegacyCache();
  const rows = sql(
    `SELECT t.*, pt.added_at FROM place_tracks pt JOIN tracks t ON t.uri = pt.track_uri
     WHERE pt.place_id = ? ORDER BY pt.position`
  ).all(id) as unknown as (TrackRow & { added_at: string })[];
  return rows.map((row) => toLibraryTrack(row, row.added_at));
}

/** Replaces a place's cached songs (and records their details). */
export function savePlace(id: string, info: PlaceInfo & { name?: string | null }, tracks: LibraryTrack[]) {
  importLegacyCache();
  transaction(() => writePlace(id, info, tracks));
}

/** Keeps stored playlist names current, so the database reads by name. */
export function updatePlaceNames(names: { id: string; name: string }[]) {
  importLegacyCache();
  const update = sql("UPDATE places SET name = ? WHERE id = ? AND name IS NOT ?");
  transaction(() => names.forEach(({ id, name }) => update.run(name, id, name)));
}

/** Songs added to cached playlists (not Liked Songs) in [since, until). */
export function getPlaylistAdds(since: string, until: string): { playlistId: string; uri: string; addedAt: string }[] {
  importLegacyCache();
  return sql(
    `SELECT pt.place_id AS playlistId, pt.track_uri AS uri, pt.added_at AS addedAt
     FROM place_tracks pt JOIN places p ON p.id = pt.place_id
     WHERE p.kind = 'playlist' AND pt.added_at >= ? AND pt.added_at < ?`
  ).all(since, until) as { playlistId: string; uri: string; addedAt: string }[];
}

// ---------------------------------------------------------------------------
// Single songs

/** Everything known about a song, or null. `addedAt` is empty. */
export function getTrack(uri: string): LibraryTrack | null {
  importLegacyCache();
  const row = sql("SELECT * FROM tracks WHERE uri = ?").get(uri) as TrackRow | undefined;
  return row ? toLibraryTrack(row, "") : null;
}

/** Every cached release of a recording. */
export function findTracksByIsrc(isrc: string): LibraryTrack[] {
  importLegacyCache();
  const rows = sql("SELECT * FROM tracks WHERE isrc = ?").all(isrc.trim().toUpperCase()) as unknown as TrackRow[];
  return rows.map((row) => toLibraryTrack(row, ""));
}

/** Every cached version of a song title, by baseTitle. */
export function findTracksByBaseTitle(base: string): LibraryTrack[] {
  importLegacyCache();
  const rows = sql("SELECT * FROM tracks WHERE base_title = ?").all(base) as unknown as TrackRow[];
  return rows.map((row) => toLibraryTrack(row, ""));
}

export interface PlaceSummary {
  id: string;
  name: string | null;
  kind: "playlist" | "liked";
  trackCount: number;
  fetchedAt: number;
}

export function listPlaces(): PlaceSummary[] {
  importLegacyCache();
  return sql(
    `SELECT p.id, p.name, p.kind, p.fetched_at AS fetchedAt,
            (SELECT count(*) FROM place_tracks pt WHERE pt.place_id = p.id) AS trackCount
     FROM places p ORDER BY p.kind = 'liked' DESC, p.name COLLATE NOCASE`
  ).all() as unknown as PlaceSummary[];
}

export function getPlaceSummary(id: string): PlaceSummary | undefined {
  return listPlaces().find((place) => place.id === id);
}

/** Records a song looked up on its own, outside any playlist. */
export function saveTrack(track: LibraryTrack) {
  importLegacyCache();
  upsertTrack(track);
}

// ---------------------------------------------------------------------------
// The JSON cache this replaced

const CACHE_DIR = path.join(process.cwd(), ".cache");

function readLegacy<V>(namespace: string): [string, V][] {
  const file = path.join(CACHE_DIR, `${namespace}.json`);
  if (!existsSync(file)) return [];
  try {
    const entries = JSON.parse(readFileSync(file, "utf-8")) as Record<string, { value: V }>;
    return Object.entries(entries).map(([key, entry]) => [key, entry.value]);
  } catch (err) {
    console.error(`Couldn't import ${file}:`, err);
    return [];
  }
}

let imported = false;

// Copies the library from the JSON files it used to live in, the first
// time the database is used, so nothing has to be downloaded again. The
// JSON files are left in place. Also fills in columns added later.
function importLegacyCache() {
  if (imported) return;
  imported = true;
  once("backfill:base_title", () => {
    const rows = sql("SELECT uri, name FROM tracks WHERE base_title IS NULL").all() as { uri: string; name: string }[];
    const update = sql("UPDATE tracks SET base_title = ? WHERE uri = ?");
    for (const { uri, name } of rows) update.run(baseTitle(name), uri);
  });
  once("import:library-json", () => {
    type IndexEntry = { snapshotId: string | null; tracks?: LibraryTrack[]; version?: number; fetchedAt: number };
    for (const [id, entry] of readLegacy<IndexEntry>("playlist-index")) {
      if (!entry?.tracks) continue;
      writePlace(id, { snapshotId: entry.snapshotId, version: entry.version ?? 0, fetchedAt: entry.fetchedAt }, entry.tracks);
    }
    type LikedEntry = { marker: string; tracks: LibraryTrack[]; version?: number };
    for (const [, entry] of readLegacy<LikedEntry>("liked-songs")) {
      if (!entry?.tracks) continue;
      writePlace(
        LIKED_SONGS_ID,
        { snapshotId: entry.marker, version: entry.version ?? 0, fetchedAt: Date.now() },
        entry.tracks
      );
    }
    for (const [, track] of readLegacy<LibraryTrack>("track-details")) upsertTrack(track);
  });
}
