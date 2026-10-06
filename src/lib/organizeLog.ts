import { promises as fs } from "fs";
import path from "path";
import { getCache } from "@/lib/cache";

/*
 * A record of every song this app files into (or takes out of) a playlist,
 * so "how many songs has this helped organize" has an exact answer. Kept
 * as append-only JSON lines: one write per change, never a full rewrite.
 */

const CACHE_DIR = path.join(process.cwd(), ".cache");
const LOG_PATH = path.join(CACHE_DIR, "organize-log.jsonl");

// Which part of the app made a change.
export type OrganizeSource = "sorter" | "lost-tracks";
export const ORGANIZE_SOURCES: OrganizeSource[] = ["sorter", "lost-tracks"];

export interface OrganizeEvent {
  at: string;
  action: "add" | "remove";
  playlistId: string;
  uris: string[];
  // Missing if the caller didn't say.
  source?: OrganizeSource;
}

type BySource = Record<OrganizeSource, number>;

export interface OrganizeStats {
  // Distinct songs this app has added to a playlist since tracking began.
  songsOrganized: number;
  // Distinct songs per part of the app; untagged adds aren't in either.
  bySource: BySource;
  adds: number;
  removes: number;
  // Removals split into songs moved to another playlist (the app also added
  // the song to a different playlist within MOVE_WINDOW_MS) and the rest.
  // Only known from tracking on — the cached library keeps no record of
  // songs taken out of playlists before then.
  moves: number;
  removals: number;
  movesBySource: BySource;
  removalsBySource: BySource;
  trackingSince: string | null;
  // Songs added to the user's playlists between the app's first commit and
  // the start of tracking, from the cached library — an upper bound, since
  // it can't tell this app's adds from ones made in Spotify itself.
  before: { songs: number; since: string; bySource: BySource | null } | null;
}

// A removal counts as a move when the same song was added to a different
// playlist this close in time, either before or after. The sorter's "also
// remove from source" removes only once the user moves on, so this is
// generous rather than tight.
const MOVE_WINDOW_MS = 2 * 60 * 60 * 1000;

// When the app was first used (its first commit), for the pre-tracking estimate.
const APP_STARTED = "2026-09-01T23:21:02Z";

interface Baseline {
  songs: number;
  since: string;
  until: string;
  // Estimated split: the sorter adds one song per request, while Lost
  // tracks adds checked songs in bulk — and Spotify stamps every song added
  // in one request with the same added_at. So songs that arrived in a group
  // sharing a timestamp are counted as Lost tracks, lone ones as the sorter
  // (which also catches anything added one at a time in Spotify itself).
  bySource?: BySource;
}
const baselineCache = getCache<Baseline>("organize-baseline");

export async function recordOrganizeEvent(event: Omit<OrganizeEvent, "at">): Promise<void> {
  if (event.uris.length === 0) return;
  try {
    await ensureBaseline();
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.appendFile(LOG_PATH, JSON.stringify({ at: new Date().toISOString(), ...event }) + "\n", "utf-8");
  } catch (err) {
    // Losing a log line shouldn't fail the add/remove that already happened.
    console.error("Failed to record organize event:", err);
  }
}

async function readEvents(): Promise<OrganizeEvent[]> {
  let raw: string;
  try {
    raw = await fs.readFile(LOG_PATH, "utf-8");
  } catch {
    return [];
  }
  return raw
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as OrganizeEvent];
      } catch {
        return [];
      }
    });
}

// Computed once, the first time anything is tracked (or stats are asked
// for), from playlist entries added between APP_STARTED and then.
async function ensureBaseline(): Promise<Baseline> {
  const existing = await baselineCache.get("baseline");
  if (existing?.bySource) return existing;
  // Keep an existing baseline's cut-off, only adding the split it lacks.
  const until = existing?.until ?? new Date().toISOString();
  const songs = new Set<string>();
  const groups = new Map<string, string[]>();
  try {
    const index = JSON.parse(await fs.readFile(path.join(CACHE_DIR, "playlist-index.json"), "utf-8")) as Record<
      string,
      { value: { tracks?: { uri: string; addedAt: string }[] } }
    >;
    for (const [playlistId, { value }] of Object.entries(index)) {
      for (const track of value.tracks ?? []) {
        if (track.addedAt < APP_STARTED || track.addedAt >= until) continue;
        songs.add(track.uri);
        const key = `${playlistId}|${track.addedAt}`;
        groups.set(key, [...(groups.get(key) ?? []), track.uri]);
      }
    }
  } catch {
    // No cached library yet — the estimate is just zero.
  }
  const bySourceSongs = { sorter: new Set<string>(), "lost-tracks": new Set<string>() };
  for (const uris of groups.values()) {
    for (const uri of uris) bySourceSongs[uris.length > 1 ? "lost-tracks" : "sorter"].add(uri);
  }
  const baseline: Baseline = {
    songs: songs.size,
    since: APP_STARTED,
    until,
    bySource: { sorter: bySourceSongs.sorter.size, "lost-tracks": bySourceSongs["lost-tracks"].size },
  };
  await baselineCache.set("baseline", baseline);
  return baseline;
}

export async function getOrganizeStats(): Promise<OrganizeStats> {
  const baseline = await ensureBaseline();
  const events = await readEvents();
  const added = new Set<string>();
  const addedBySource = { sorter: new Set<string>(), "lost-tracks": new Set<string>() };
  let adds = 0;
  let removes = 0;
  // uri -> when and where the app added it, for spotting moves.
  const addsByUri = new Map<string, { at: number; playlistId: string }[]>();
  for (const event of events) {
    if (event.action !== "add") continue;
    adds += event.uris.length;
    for (const uri of event.uris) {
      added.add(uri);
      if (event.source) addedBySource[event.source].add(uri);
      const list = addsByUri.get(uri) ?? [];
      list.push({ at: Date.parse(event.at), playlistId: event.playlistId });
      addsByUri.set(uri, list);
    }
  }
  let moves = 0;
  let removals = 0;
  const movesBySource: BySource = { sorter: 0, "lost-tracks": 0 };
  const removalsBySource: BySource = { sorter: 0, "lost-tracks": 0 };
  for (const event of events) {
    if (event.action !== "remove") continue;
    removes += event.uris.length;
    const at = Date.parse(event.at);
    for (const uri of event.uris) {
      const moved = (addsByUri.get(uri) ?? []).some(
        (a) => a.playlistId !== event.playlistId && Math.abs(a.at - at) <= MOVE_WINDOW_MS
      );
      if (moved) moves++;
      else removals++;
      if (event.source) (moved ? movesBySource : removalsBySource)[event.source]++;
    }
  }
  return {
    songsOrganized: added.size,
    bySource: { sorter: addedBySource.sorter.size, "lost-tracks": addedBySource["lost-tracks"].size },
    adds,
    removes,
    moves,
    removals,
    movesBySource,
    removalsBySource,
    trackingSince: baseline.until,
    before: { songs: baseline.songs, since: baseline.since, bySource: baseline.bySource ?? null },
  };
}
