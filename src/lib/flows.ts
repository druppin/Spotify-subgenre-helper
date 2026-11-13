import { sql, transaction } from "@/lib/db";
import { LIKED_SONGS_ID } from "@/lib/library";
import { getPlaceTracks } from "@/lib/libraryStore";
import { familyOf, type GenreFamily } from "@/lib/genreFamily";
import { recordOrganizeEvent } from "@/lib/organizeLog";
import { getLikedSongs, getPlaylistTracksCached, recordOwnEdit } from "@/lib/playlistIndex";
import type { LibraryTrack, SpotifyClient } from "@/lib/spotify/client";
import { getTrackGenreDetails, normalizeGenre, type TrackGenreDetails } from "@/lib/trackGenres";

/*
 * Flows pool playlists (and Liked Songs) into one target playlist. Each
 * source is wired in with optional filters; running a flow adds the songs
 * that pass and aren't in the target yet, and removes songs it added
 * earlier that no longer pass (left a source, or a filter changed). Songs
 * added to the target by hand, or before flows remembered what they added,
 * are never removed. Stored in the library database (flows, flow_sources,
 * flow_added — see db.ts).
 */

export interface FlowSource {
  // A playlist ID, or "liked" for Liked Songs.
  sourceId: string;
  // A song passes if any of its genres is in one of these families or is
  // one of these genres. Both empty: no genre filter.
  families: GenreFamily[];
  genres: string[];
  // Minimum average tag confidence, 0-100, or null for none.
  minConfidence: number | null;
  // Whether songs with no tags pass when a filter is set.
  includeUntagged: boolean;
}

export interface Flow {
  id: number;
  name: string;
  targetId: string | null;
  createdAt: number;
  lastRunAt: number | null;
  lastRunAdded: number | null;
  sources: FlowSource[];
}

const FAMILIES: GenreFamily[] = ["house", "bass", "rock", "pop", "hiphop", "roots"];

// Keeps what's stored to known values, whatever a request sends.
export function cleanSource(raw: Partial<FlowSource> & { sourceId: string }): FlowSource {
  const min = Number(raw.minConfidence);
  return {
    sourceId: String(raw.sourceId),
    families: (raw.families ?? []).filter((f): f is GenreFamily => FAMILIES.includes(f as GenreFamily)),
    genres: [...new Set((raw.genres ?? []).map((g) => normalizeGenre(String(g))).filter(Boolean))],
    minConfidence: raw.minConfidence === null || raw.minConfidence === undefined || !Number.isFinite(min)
      ? null
      : Math.min(Math.max(Math.round(min), 0), 100),
    includeUntagged: Boolean(raw.includeUntagged),
  };
}

function readSources(flowId: number): FlowSource[] {
  const rows = sql(
    "SELECT source_id, families, genres, min_confidence, include_untagged FROM flow_sources WHERE flow_id = ? ORDER BY position"
  ).all(flowId) as {
    source_id: string;
    families: string;
    genres: string;
    min_confidence: number | null;
    include_untagged: number;
  }[];
  return rows.map((r) => ({
    sourceId: r.source_id,
    families: JSON.parse(r.families),
    genres: JSON.parse(r.genres),
    minConfidence: r.min_confidence,
    includeUntagged: r.include_untagged === 1,
  }));
}

type FlowRow = {
  id: number;
  name: string;
  target_id: string | null;
  created_at: number;
  last_run_at: number | null;
  last_run_added: number | null;
};

function toFlow(r: FlowRow): Flow {
  return {
    id: r.id,
    name: r.name,
    targetId: r.target_id,
    createdAt: r.created_at,
    lastRunAt: r.last_run_at,
    lastRunAdded: r.last_run_added,
    sources: readSources(r.id),
  };
}

export function listFlows(): Flow[] {
  return (sql("SELECT * FROM flows ORDER BY created_at").all() as FlowRow[]).map(toFlow);
}

export function getFlow(id: number): Flow | undefined {
  const row = sql("SELECT * FROM flows WHERE id = ?").get(id) as FlowRow | undefined;
  return row && toFlow(row);
}

export function createFlow(name: string, targetId: string | null): Flow {
  const { lastInsertRowid } = sql("INSERT INTO flows (name, target_id, created_at) VALUES (?, ?, ?)").run(
    name,
    targetId,
    Date.now()
  );
  return getFlow(Number(lastInsertRowid))!;
}

/** Changes a flow's name, target or sources (the whole list, in order). */
export function updateFlow(
  id: number,
  change: { name?: string; targetId?: string | null; sources?: FlowSource[] }
): Flow | undefined {
  const flow = getFlow(id);
  if (!flow) return undefined;
  transaction(() => {
    // What it added to the old target is that playlist's business now.
    if (change.targetId !== undefined && change.targetId !== flow.targetId) {
      sql("DELETE FROM flow_added WHERE flow_id = ?").run(id);
    }
    sql("UPDATE flows SET name = ?, target_id = ? WHERE id = ?").run(
      change.name ?? flow.name,
      change.targetId === undefined ? flow.targetId : change.targetId,
      id
    );
    if (change.sources) {
      sql("DELETE FROM flow_sources WHERE flow_id = ?").run(id);
      const insert = sql(
        `INSERT INTO flow_sources (flow_id, source_id, position, families, genres, min_confidence, include_untagged)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      const seen = new Set<string>();
      change.sources.forEach((s, position) => {
        if (seen.has(s.sourceId)) return;
        seen.add(s.sourceId);
        insert.run(id, s.sourceId, position, JSON.stringify(s.families), JSON.stringify(s.genres), s.minConfidence, s.includeUntagged ? 1 : 0);
      });
    }
  });
  return getFlow(id);
}

export function deleteFlow(id: number) {
  sql("DELETE FROM flows WHERE id = ?").run(id);
}

function hasFilters(source: FlowSource): boolean {
  return source.families.length > 0 || source.genres.length > 0 || source.minConfidence !== null;
}

/** Whether one song, with its stored genres (if any), gets through a source's filters. */
export function passes(source: FlowSource, genres: TrackGenreDetails | undefined): boolean {
  if (!hasFilters(source)) return true;
  if (!genres) return source.includeUntagged;
  if (source.families.length > 0 || source.genres.length > 0) {
    const all = [...genres.own, ...genres.broader];
    const wanted = new Set(source.genres);
    const matches = all.some(
      (g) => wanted.has(normalizeGenre(g)) || source.families.includes(familyOf(g, genres.broader))
    );
    if (!matches) return false;
  }
  if (source.minConfidence !== null) {
    if (genres.songConfidence === null || genres.songConfidence < source.minConfidence) return false;
  }
  return true;
}

export interface FlowSourceResult {
  sourceId: string;
  total: number;
  passing: number;
  // Passing songs the target doesn't have yet (counted once across sources:
  // a song in two sources is credited to the first).
  newCount: number;
  // A few album covers from the source, for its crate.
  covers: string[];
}

export interface FlowResult {
  sources: FlowSourceResult[];
  targetTotal: number;
  newSongs: { track: LibraryTrack; from: string }[];
  // Songs the flow added earlier that no longer pass any source.
  removedSongs: LibraryTrack[];
}

const isTrack = (t: LibraryTrack) => t.uri.startsWith("spotify:track:");
const trackId = (uri: string) => uri.slice("spotify:track:".length);

/** The songs a flow has added to its current target. */
function addedBy(flowId: number): Set<string> {
  return new Set((sql("SELECT track_uri FROM flow_added WHERE flow_id = ?").all(flowId) as { track_uri: string }[]).map((r) => r.track_uri));
}

/** What running a flow would add and remove, given each place's songs and what the flow added before. */
export async function computeFlow(
  sources: FlowSource[],
  targetTracks: LibraryTrack[],
  tracksOf: (sourceId: string) => LibraryTrack[],
  addedBefore: Set<string>
): Promise<FlowResult> {
  const inTarget = new Set(targetTracks.map((t) => t.uri));
  const lists = sources.map((s) => tracksOf(s.sourceId).filter(isTrack));
  const genres = await getTrackGenreDetails([...new Set(lists.flat().map((t) => trackId(t.uri)))]);
  const added = new Set<string>();
  const passingAll = new Set<string>();
  const newSongs: FlowResult["newSongs"] = [];
  const results = sources.map((source, i) => {
    const tracks = lists[i];
    const passing = tracks.filter((t) => passes(source, genres[trackId(t.uri)]));
    for (const track of passing) passingAll.add(track.uri);
    let newCount = 0;
    for (const track of passing) {
      if (inTarget.has(track.uri) || added.has(track.uri)) continue;
      added.add(track.uri);
      newSongs.push({ track, from: source.sourceId });
      newCount++;
    }
    const covers = [...new Set(tracks.map((t) => t.image).filter((c): c is string => !!c))].slice(0, 4);
    return { sourceId: source.sourceId, total: tracks.length, passing: passing.length, newCount, covers };
  });
  const removedSongs = [
    ...new Map(targetTracks.filter((t) => addedBefore.has(t.uri) && !passingAll.has(t.uri)).map((t) => [t.uri, t])).values(),
  ];
  return { sources: results, targetTotal: targetTracks.length, newSongs, removedSongs };
}

/** What running the flow would do, from the saved library only (no Spotify requests). */
export function previewFlow(flowId: number, sources: FlowSource[], targetId: string | null): Promise<FlowResult> {
  return computeFlow(sources, targetId ? getPlaceTracks(targetId) : [], getPlaceTracks, addedBy(flowId));
}

/**
 * Runs a flow: brings each source and the target up to date with Spotify,
 * adds the passing songs the target doesn't have, and removes the songs it
 * added before that no longer pass. Returns what changed.
 */
export async function runFlow(flow: Flow, spotify: SpotifyClient): Promise<FlowResult> {
  if (!flow.targetId) throw new Error("Pick the playlist this flow fills first.");
  const fresh = new Map<string, LibraryTrack[]>();
  const load = async (id: string) =>
    id === LIKED_SONGS_ID ? ((await getLikedSongs(spotify, "update")).tracks ?? []) : getPlaylistTracksCached(spotify, id);
  for (const id of new Set([flow.targetId, ...flow.sources.map((s) => s.sourceId)])) fresh.set(id, await load(id));
  const targetTracks = fresh.get(flow.targetId) ?? [];
  const before = addedBy(flow.id);
  const result = await computeFlow(flow.sources, targetTracks, (id) => fresh.get(id) ?? [], before);
  const uris = result.newSongs.map((s) => s.track.uri);
  if (uris.length > 0) {
    const snapshotId = await spotify.addTracksToPlaylist(flow.targetId, uris);
    await recordOwnEdit(flow.targetId, { added: uris }, snapshotId);
    await recordOrganizeEvent({ action: "add", playlistId: flow.targetId, uris, source: "flows" });
    transaction(() => {
      for (const uri of uris) sql("INSERT OR IGNORE INTO flow_added (flow_id, track_uri) VALUES (?, ?)").run(flow.id, uri);
    });
  }
  const removed = result.removedSongs.map((t) => t.uri);
  if (removed.length > 0) {
    const snapshotId = await spotify.removeTracksFromPlaylist(flow.targetId, removed);
    await recordOwnEdit(flow.targetId, { removed }, snapshotId);
    await recordOrganizeEvent({ action: "remove", playlistId: flow.targetId, uris: removed, source: "flows" });
  }
  // Forget removed songs, and ones taken out of the target by hand, so they
  // count as hand-added if someone puts them back.
  const inTarget = new Set(targetTracks.map((t) => t.uri));
  transaction(() => {
    for (const uri of before) {
      if (removed.includes(uri) || !inTarget.has(uri)) sql("DELETE FROM flow_added WHERE flow_id = ? AND track_uri = ?").run(flow.id, uri);
    }
  });
  sql("UPDATE flows SET last_run_at = ?, last_run_added = ? WHERE id = ?").run(Date.now(), uris.length, flow.id);
  return result;
}
