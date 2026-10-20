import { existsSync, readFileSync } from "fs";
import path from "path";
import { once, sql, transaction } from "@/lib/db";
import type { StoredTags, TrackSummary } from "@/lib/llm/types";
import { DATA_DIR } from "@/lib/dataDir";

/**
 * The genres the AI settled on for each track, keyed by Spotify track id.
 * Unlike the summary cache (keyed by model + prompt version, so a prompt
 * tweak orphans every entry), this survives prompt/model changes and is
 * what playlist genre views read from. Stored in the library database
 * (track_genres, track_genre_tags — see db.ts).
 */
export interface TrackGenres {
  subgenres: string[];
  // Per subgenre, in the same order: the AI's 0-100 score (null if not
  // scored yet), and whether the user added it.
  confidence: (number | null)[];
  byUser: boolean[];
  moodVibe: string;
  model: string;
  updatedAt: number;
  // The user changed the tags by hand.
  edited: boolean;
}


function readGenres(trackId: string): TrackGenres | undefined {
  const row = sql("SELECT mood_vibe, model, updated_at, edited FROM track_genres WHERE track_id = ?").get(trackId) as
    | { mood_vibe: string; model: string; updated_at: number; edited: number }
    | undefined;
  if (!row) return undefined;
  const tags = sql(
    "SELECT genre, confidence, by_user FROM track_genre_tags WHERE track_id = ? ORDER BY position"
  ).all(trackId) as { genre: string; confidence: number | null; by_user: number }[];
  return {
    subgenres: tags.map((t) => t.genre),
    confidence: tags.map((t) => t.confidence),
    byUser: tags.map((t) => t.by_user === 1),
    moodVibe: row.mood_vibe,
    model: row.model,
    updatedAt: row.updated_at,
    edited: row.edited === 1,
  };
}

function writeGenres(trackId: string, genres: TrackGenres) {
  sql(
    `INSERT INTO track_genres (track_id, mood_vibe, model, updated_at, edited) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (track_id) DO UPDATE SET
       mood_vibe = excluded.mood_vibe, model = excluded.model, updated_at = excluded.updated_at,
       edited = excluded.edited`
  ).run(trackId, genres.moodVibe, genres.model, genres.updatedAt, genres.edited ? 1 : 0);
  sql("DELETE FROM track_genre_tags WHERE track_id = ?").run(trackId);
  const insert = sql(
    "INSERT INTO track_genre_tags (track_id, position, genre, confidence, by_user) VALUES (?, ?, ?, ?, ?)"
  );
  genres.subgenres.forEach((genre, position) =>
    insert.run(trackId, position, genre, genres.confidence[position] ?? null, genres.byUser[position] ? 1 : 0)
  );
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
  neurofunk: "drum and bass",
  techstep: "drum and bass",
  brostep: "dubstep",
};

// Subgenres whose names don't contain their umbrella genre, matched when a
// genre is or ends with them ("ragga jungle" is drum and bass, but "jungle
// terror" isn't). Words that mean different things in different scenes
// (garage, riddim) stay out.
const IMPLIED_BY_ENDING: Record<string, string> = {
  "liquid funk": "drum and bass",
  jungle: "drum and bass",
  "jump up": "drum and bass",
  halftime: "drum and bass",
  "speed garage": "house",
  bassline: "house",
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

const impliedByEndingKey = new Map(
  Object.entries(IMPLIED_BY_ENDING).map(([ending, parent]) => [genreKey(ending), genreKey(parent)])
);

// The broader genres a genre belongs to: known genres its name ends with
// ("90s alternative rock" -> "alternative rock", "rock"), plus families
// its words or ending imply ("southern sludge" -> "metal", "liquid funk"
// -> "drum and bass").
function parentKeys(genre: string, parents: Set<string>): string[] {
  const words = genre.split(/[\s-]+/).filter(Boolean);
  const found: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const key = genreKey(words.slice(i).join(" "));
    if (i > 0 && parents.has(key)) found.push(key);
    const implied = impliedByEndingKey.get(key);
    if (implied) found.push(implied);
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

// The first time the store is used, fill it from the JSON file genres used
// to be kept in, or failing that from summaries generated before it existed.
function ensureBackfilled() {
  once("import:track-genres", () => {
    const legacy = readJson<Record<string, { value: TrackGenres }>>("track-genres.json");
    if (legacy) {
      for (const [trackId, { value }] of Object.entries(legacy)) {
        if (Array.isArray(value?.subgenres)) {
          writeGenres(trackId, { ...value, confidence: [], byUser: [], edited: false });
        }
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
        confidence: [],
        byUser: [],
        edited: false,
      });
    }
  });
}

function readJson<V>(file: string): V | undefined {
  const filePath = path.join(DATA_DIR, file);
  if (!existsSync(filePath)) return undefined;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as V;
  } catch {
    return undefined;
  }
}

// Stored tags as shown: display spellings, own and broader apart, and the
// scores keyed by the display spelling (the higher one where two stored
// spellings merge into one).
async function describeStored(entry: TrackGenres): Promise<StoredTags> {
  const { own, broader } = await describeGenres(entry.subgenres);
  const confidence: Record<string, number> = {};
  const userTags: string[] = [];
  for (let i = 0; i < entry.subgenres.length; i++) {
    const [shown] = (await describeGenres([entry.subgenres[i]])).own;
    if (!shown) continue;
    if (entry.byUser[i]) {
      if (!userTags.includes(shown)) userTags.push(shown);
      continue;
    }
    const score = entry.confidence[i];
    if (score !== null && score !== undefined) confidence[shown] = Math.max(confidence[shown] ?? 0, score);
  }
  // Tags the user added are ones they're sure of, so a song they've
  // corrected sorts as confident rather than unknown.
  const scores = [...Object.values(confidence), ...userTags.map(() => 100)];
  const songConfidence = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  return { own, broader, edited: entry.edited, confidence, userTags, songConfidence };
}

// Whether some tag the AI gave still has no score.
function needsScores(entry: TrackGenres): boolean {
  return entry.subgenres.some((_, i) => !entry.byUser[i] && (entry.confidence[i] ?? null) === null);
}

export type TrackGenreDetails = Pick<TrackGenres, "moodVibe" | "model" | "updatedAt"> &
  StoredTags & {
    // Some AI tag hasn't been given a confidence score yet.
    unscored: boolean;
  };

/**
 * Stored genres for many tracks: own and broader apart, with scores.
 * Entries with no subgenres (saved before empty answers were refused)
 * count as missing, so they show up to be generated again.
 */
export async function getTrackGenreDetails(trackIds: string[]): Promise<Record<string, TrackGenreDetails>> {
  ensureBackfilled();
  const result: Record<string, TrackGenreDetails> = {};
  for (const id of trackIds) {
    const entry = readGenres(id);
    if (!entry || entry.subgenres.length === 0) continue;
    result[id] = {
      moodVibe: entry.moodVibe,
      model: entry.model,
      updatedAt: entry.updatedAt,
      unscored: needsScores(entry),
      ...(await describeStored(entry)),
    };
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

/**
 * Saves the AI's genres for a track. Tags the user has edited are kept
 * unless overwriteEdits (an explicit regenerate) says to replace them.
 * Returns whether the AI's genres were saved.
 */
export async function saveTrackGenres(
  trackId: string,
  summary: TrackSummary,
  model: string,
  overwriteEdits = false
): Promise<boolean> {
  ensureBackfilled();
  const scored = summary.subgenres
    .map((raw) => ({ genre: normalizeGenre(raw), score: summary.confidence?.[raw] ?? null }))
    .filter((t) => t.genre);
  const subgenres = scored.map((t) => t.genre);
  const confidence = scored.map((t) => t.score);
  const existing = readGenres(trackId);
  if (existing?.edited && !overwriteEdits) return false;
  // Skip the write (and the genre index rebuild) when nothing changed —
  // this runs on every summary request, cached ones included.
  if (
    existing &&
    !existing.edited &&
    existing.model === model &&
    existing.moodVibe === summary.moodVibe &&
    existing.subgenres.join("|") === subgenres.join("|") &&
    existing.confidence.join("|") === confidence.join("|")
  ) {
    return true;
  }
  transaction(() =>
    writeGenres(trackId, {
      subgenres,
      confidence,
      byUser: subgenres.map(() => false),
      moodVibe: summary.moodVibe,
      model,
      updatedAt: Date.now(),
      edited: false,
    })
  );
  genreIndex = null;
  return true;
}

/**
 * Replaces a track's tags with the user's own list (duplicates and
 * spelling variants of one genre dropped). Tags kept from before keep
 * their scores; new ones count as the user's. The mood and model stay as
 * the AI left them; the AI won't overwrite these tags unless regenerated.
 */
export async function setTrackGenresByUser(
  trackId: string,
  tags: string[],
  // Tags the AI proposed (in a chat) with its scores: these count as the
  // AI's, scored, rather than the user's own.
  aiScores: Record<string, number> = {}
): Promise<StoredTags> {
  ensureBackfilled();
  const seen = new Set<string>();
  const subgenres = tags
    .map(normalizeGenre)
    .filter((genre) => genre && !seen.has(genreKey(genre)) && seen.add(genreKey(genre)));
  if (subgenres.length === 0) throw new Error("A song needs at least one tag.");
  const existing = readGenres(trackId);
  const before = (genre: string) => existing?.subgenres.findIndex((g) => genreKey(g) === genreKey(genre)) ?? -1;
  const aiScore = new Map(
    Object.entries(aiScores).map(([genre, score]) => [genreKey(normalizeGenre(genre)), score])
  );
  const entry: TrackGenres = {
    subgenres,
    confidence: subgenres.map((g) =>
      aiScore.has(genreKey(g))
        ? aiScore.get(genreKey(g))!
        : before(g) >= 0
          ? (existing!.confidence[before(g)] ?? null)
          : null
    ),
    byUser: subgenres.map((g) => (aiScore.has(genreKey(g)) ? false : before(g) >= 0 ? existing!.byUser[before(g)] : true)),
    moodVibe: existing?.moodVibe ?? "",
    model: existing?.model ?? "user",
    updatedAt: Date.now(),
    edited: true,
  };
  transaction(() => writeGenres(trackId, entry));
  genreIndex = null;
  return describeStored(entry);
}

/**
 * Saves the AI's scores for tags already stored, keyed by tag. Tags the
 * user added, and tags not in `scores`, are left as they are.
 */
export function saveTagScores(trackId: string, scores: Record<string, number>) {
  const entry = readGenres(trackId);
  if (!entry) return;
  const byKey = new Map(Object.entries(scores).map(([genre, score]) => [genreKey(normalizeGenre(genre)), score]));
  const update = sql("UPDATE track_genre_tags SET confidence = ? WHERE track_id = ? AND position = ?");
  transaction(() =>
    entry.subgenres.forEach((genre, position) => {
      const score = byKey.get(genreKey(genre));
      if (!entry.byUser[position] && score !== undefined) update.run(score, trackId, position);
    })
  );
}

/** The stored tags the AI gave (not the user), as stored, for scoring. */
export function aiTagsOf(trackId: string): string[] {
  const entry = readGenres(trackId);
  return entry ? entry.subgenres.filter((_, i) => !entry.byUser[i]) : [];
}

/** A track's stored tags as shown, or undefined if none. */
export async function getStoredGenres(trackId: string): Promise<(TrackGenreDetails & { subgenres: string[] }) | undefined> {
  ensureBackfilled();
  const entry = readGenres(trackId);
  if (!entry || entry.subgenres.length === 0) return undefined;
  return {
    subgenres: entry.subgenres,
    moodVibe: entry.moodVibe,
    model: entry.model,
    updatedAt: entry.updatedAt,
    unscored: needsScores(entry),
    ...(await describeStored(entry)),
  };
}
