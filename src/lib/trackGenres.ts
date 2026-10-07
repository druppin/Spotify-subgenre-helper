import { existsSync, readFileSync } from "fs";
import path from "path";
import { once, sql, transaction } from "@/lib/db";
import type { TrackSummary } from "@/lib/llm/types";

/**
 * The genres the AI settled on for each track, keyed by Spotify track id.
 * Unlike the summary cache (keyed by model + prompt version, so a prompt
 * tweak orphans every entry), this survives prompt/model changes and is
 * what playlist genre views read from. Stored in the library database
 * (track_genres, track_genre_tags — see db.ts).
 */
export interface TrackGenres {
  subgenres: string[];
  moodVibe: string;
  model: string;
  updatedAt: number;
}

const CACHE_DIR = path.join(process.cwd(), ".cache");

function readGenres(trackId: string): TrackGenres | undefined {
  const row = sql("SELECT mood_vibe, model, updated_at FROM track_genres WHERE track_id = ?").get(trackId) as
    | { mood_vibe: string; model: string; updated_at: number }
    | undefined;
  if (!row) return undefined;
  const tags = sql("SELECT genre FROM track_genre_tags WHERE track_id = ? ORDER BY position").all(trackId) as {
    genre: string;
  }[];
  return { subgenres: tags.map((t) => t.genre), moodVibe: row.mood_vibe, model: row.model, updatedAt: row.updated_at };
}

function writeGenres(trackId: string, genres: TrackGenres) {
  sql(
    `INSERT INTO track_genres (track_id, mood_vibe, model, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (track_id) DO UPDATE SET
       mood_vibe = excluded.mood_vibe, model = excluded.model, updated_at = excluded.updated_at`
  ).run(trackId, genres.moodVibe, genres.model, genres.updatedAt);
  sql("DELETE FROM track_genre_tags WHERE track_id = ?").run(trackId);
  const insert = sql("INSERT INTO track_genre_tags (track_id, position, genre) VALUES (?, ?, ?)");
  genres.subgenres.forEach((genre, position) => insert.run(trackId, position, genre));
}

// LLMs mix in non-breaking hyphens/spaces and inconsistent case, which
// would split one genre into several when counting.
export function normalizeGenre(genre: string): string {
  return genre
    .replace(/[‐-―]/g, "-")
    .replace(/[  ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Abbreviations and symbols that name the same thing, applied before
// comparing (the shown spelling is still one the AI actually used).
const GENRE_ALIASES: [RegExp, string][] = [
  [/&/g, " and "], // drum & bass, r&b
  [/\s'?n'?\s/g, " and "], // drum 'n' bass, rock n roll
  [/\b(dnb|d and b)\b/g, "drum and bass"],
  [/\brnb\b/g, "r and b"],
  [/\balt\b/g, "alternative"], // alt rock, alt-rock
  [/\bpsych\b/g, "psychedelic"], // psych rock, psych-pop
];

// Spellings that differ only by hyphens or spaces ("pop-punk", "pop punk",
// "synthpop" / "synth-pop") or by an alias above are one genre and share
// a key.
function genreKey(genre: string): string {
  let key = genre;
  for (const [pattern, replacement] of GENRE_ALIASES) key = key.replace(pattern, replacement);
  return key.replace(/[-\s]/g, "");
}

// Broad genres every narrower one ending in them also belongs to ("doom
// metal" -> "metal", "liquid dnb" -> "drum and bass"), even if no song is
// tagged with just the broad one yet.
const BASE_GENRES = [
  "metal",
  "rock",
  "punk",
  "pop",
  "hip hop",
  "house",
  "techno",
  "trance",
  "drum and bass",
  "dubstep",
  "breakbeat",
  "trap",
  "disco",
  "funk",
  "soul",
  "jazz",
  "blues",
  "folk",
  "country",
  "reggae",
  "ska",
  "ambient",
  "electronic",
];

// Genre words that name a family member without ending in the family's
// name ("southern sludge" is metal).
const IMPLIED_PARENTS: Record<string, string> = {
  sludge: "metal",
  metalcore: "metal",
  deathcore: "metal",
  grindcore: "metal",
  djent: "metal",
  grunge: "rock",
  shoegaze: "rock",
};

// A genre also counts as a parent when this many songs are tagged with
// exactly it ("alternative rock" for "90s alternative rock").
const MIN_SONGS_AS_PARENT = 2;
// Names that mean different things in different scenes, so a genre ending
// in them doesn't say which: "beatdown hardcore" is punk, "uk hardcore" is
// rave; "garage rock" and "uk garage" share nothing.
const NEVER_PARENTS = new Set(["hardcore", "garage", "bass"].map(genreKey));

interface GenreIndex {
  // Each genre key's display spelling: the one used on the most songs,
  // then the one with fewer hyphens, then the spelled-out one ("drum &
  // bass" over "dnb").
  spellings: Map<string, string>;
  // Keys of genres that narrower ones ending in them roll up into.
  parents: Set<string>;
}

// Rebuilt after any save.
let genreIndex: Promise<GenreIndex> | null = null;

function getGenreIndex(): Promise<GenreIndex> {
  genreIndex ??= (async () => {
    ensureBackfilled();
    const counts = new Map<string, Map<string, number>>();
    // Songs per spelling, counting a song tagged twice with one spelling once.
    const rows = sql(
      "SELECT genre, count(DISTINCT track_id) AS songs FROM track_genre_tags GROUP BY genre"
    ).all() as { genre: string; songs: number }[];
    for (const { genre, songs } of rows) {
      const key = genreKey(genre);
      let spellings = counts.get(key);
      if (!spellings) counts.set(key, (spellings = new Map()));
      spellings.set(genre, songs);
    }
    const hyphens = (genre: string) => genre.split("-").length;
    const spellings = new Map<string, string>();
    const parents = new Set(BASE_GENRES.map(genreKey));
    for (const [key, byspelling] of counts) {
      const [best] = [...byspelling].sort(
        ([a, n], [b, m]) => m - n || hyphens(a) - hyphens(b) || b.length - a.length || a.localeCompare(b)
      );
      spellings.set(key, best[0]);
      const songs = [...byspelling.values()].reduce((sum, n) => sum + n, 0);
      if (songs >= MIN_SONGS_AS_PARENT && !NEVER_PARENTS.has(key)) parents.add(key);
    }
    for (const genre of BASE_GENRES) if (!spellings.has(genreKey(genre))) spellings.set(genreKey(genre), genre);
    return { spellings, parents };
  })();
  return genreIndex;
}

// The broader genres a genre belongs to: known genres its name ends with
// ("90s alternative rock" -> "alternative rock", "rock"), plus families
// its words imply ("southern sludge" -> "metal").
function parentKeys(genre: string, parents: Set<string>): string[] {
  const words = genre.split(/[\s-]+/).filter(Boolean);
  const found: string[] = [];
  for (let i = 1; i < words.length; i++) {
    const key = genreKey(words.slice(i).join(" "));
    if (parents.has(key)) found.push(key);
  }
  for (const word of words) {
    const implied = IMPLIED_PARENTS[word];
    if (implied) found.push(genreKey(implied));
  }
  return found;
}

// Normalizes a song's subgenres and merges spelling variants into one
// display spelling (so they count and filter as a single genre). `broader`
// holds the genres they belong to that the song isn't tagged with itself.
export async function describeGenres(subgenres: string[]): Promise<{ own: string[]; broader: string[] }> {
  const { spellings, parents } = await getGenreIndex();
  const normalized = subgenres.map(normalizeGenre).filter(Boolean);
  const own = [...new Set(normalized.map((genre) => spellings.get(genreKey(genre)) ?? genre))];
  const broader = [
    ...new Set(normalized.flatMap((genre) => parentKeys(genre, parents)).map((key) => spellings.get(key)!)),
  ].filter((genre) => !own.includes(genre));
  return { own, broader };
}

// The song's own genres, then the broader ones they belong to.
export async function canonicalizeGenres(subgenres: string[]): Promise<string[]> {
  const { own, broader } = await describeGenres(subgenres);
  return [...own, ...broader];
}

// The first time the store is used, fill it from the JSON file genres used
// to be kept in, or failing that from summaries generated before it existed.
function ensureBackfilled() {
  once("import:track-genres", () => {
    const legacy = readJson<Record<string, { value: TrackGenres }>>("track-genres.json");
    if (legacy) {
      for (const [trackId, { value }] of Object.entries(legacy)) {
        if (Array.isArray(value?.subgenres)) writeGenres(trackId, value);
      }
      return;
    }
    const summaries = readJson<Record<string, { value: TrackSummary }>>("track-summary.json") ?? {};
    for (const [key, entry] of Object.entries(summaries)) {
      // Summary keys are `${trackId}:${provider}:${model}:${promptVersion}`.
      const [trackId, provider, ...rest] = key.split(":");
      const summary = entry?.value;
      if (!trackId || !Array.isArray(summary?.subgenres)) continue;
      writeGenres(trackId, {
        subgenres: summary.subgenres.map(normalizeGenre).filter(Boolean),
        moodVibe: summary.moodVibe ?? "",
        model: `${provider}:${rest.slice(0, -1).join(":")}`,
        updatedAt: Date.now(),
      });
    }
  });
}

function readJson<V>(file: string): V | undefined {
  const filePath = path.join(CACHE_DIR, file);
  if (!existsSync(filePath)) return undefined;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as V;
  } catch {
    return undefined;
  }
}

// Entries with no subgenres (saved before empty answers were refused)
// count as missing, so they show up to be generated again.
export async function getTrackGenres(trackIds: string[]): Promise<Record<string, TrackGenres>> {
  ensureBackfilled();
  const result: Record<string, TrackGenres> = {};
  for (const id of trackIds) {
    const entry = readGenres(id);
    if (entry && entry.subgenres.length > 0) {
      result[id] = { ...entry, subgenres: await canonicalizeGenres(entry.subgenres) };
    }
  }
  return result;
}

/** Like getTrackGenres, with own and broader genres kept apart. */
export async function getTrackGenreDetails(
  trackIds: string[]
): Promise<Record<string, Omit<TrackGenres, "subgenres"> & { own: string[]; broader: string[] }>> {
  ensureBackfilled();
  const result: Awaited<ReturnType<typeof getTrackGenreDetails>> = {};
  for (const id of trackIds) {
    const entry = readGenres(id);
    if (!entry || entry.subgenres.length === 0) continue;
    const { subgenres, ...rest } = entry;
    result[id] = { ...rest, ...(await describeGenres(subgenres)) };
  }
  return result;
}

/** Every track ID with stored genres. */
export function listTracksWithGenres(): string[] {
  ensureBackfilled();
  const rows = sql(
    "SELECT track_id FROM track_genres g WHERE EXISTS (SELECT 1 FROM track_genre_tags t WHERE t.track_id = g.track_id)"
  ).all() as { track_id: string }[];
  return rows.map((row) => row.track_id);
}

export async function saveTrackGenres(trackId: string, summary: TrackSummary, model: string): Promise<void> {
  ensureBackfilled();
  const subgenres = summary.subgenres.map(normalizeGenre).filter(Boolean);
  const existing = readGenres(trackId);
  // Skip the write (and the genre index rebuild) when nothing changed —
  // this runs on every summary request, cached ones included.
  if (
    existing &&
    existing.model === model &&
    existing.moodVibe === summary.moodVibe &&
    existing.subgenres.join("|") === subgenres.join("|")
  ) {
    return;
  }
  transaction(() => writeGenres(trackId, { subgenres, moodVibe: summary.moodVibe, model, updatedAt: Date.now() }));
  genreIndex = null;
}
