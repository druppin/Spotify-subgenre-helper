import { promises as fs } from "fs";
import path from "path";
import { getCache } from "@/lib/cache";
import type { TrackSummary } from "@/lib/llm/types";

/**
 * The genres the AI settled on for each track, keyed by Spotify track id.
 * Unlike the summary cache (keyed by model + prompt version, so a prompt
 * tweak orphans every entry), this survives prompt/model changes and is
 * what playlist genre views read from.
 */
export interface TrackGenres {
  subgenres: string[];
  moodVibe: string;
  model: string;
  updatedAt: number;
}

const NAMESPACE = "track-genres";
const CACHE_DIR = path.join(process.cwd(), ".cache");
const genreCache = getCache<TrackGenres>(NAMESPACE);

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

// Spellings that differ only by hyphens or spaces ("pop-punk", "pop punk",
// "synthpop" / "synth-pop") are one genre and share a key.
function genreKey(genre: string): string {
  return genre.replace(/[-\s]/g, "");
}

// Each genre key's display spelling: the one used on the most songs, then
// the one with fewer hyphens. Rebuilt after any save.
let canonicalSpellings: Promise<Map<string, string>> | null = null;

function getCanonicalSpellings(): Promise<Map<string, string>> {
  canonicalSpellings ??= (async () => {
    await ensureBackfilled();
    const counts = new Map<string, Map<string, number>>();
    for (const [, entry] of await genreCache.entries()) {
      for (const genre of new Set(entry.subgenres)) {
        const key = genreKey(genre);
        let spellings = counts.get(key);
        if (!spellings) counts.set(key, (spellings = new Map()));
        spellings.set(genre, (spellings.get(genre) ?? 0) + 1);
      }
    }
    const hyphens = (genre: string) => genre.split("-").length;
    const canonical = new Map<string, string>();
    for (const [key, spellings] of counts) {
      const [best] = [...spellings].sort(
        ([a, n], [b, m]) => m - n || hyphens(a) - hyphens(b) || a.localeCompare(b)
      );
      canonical.set(key, best[0]);
    }
    return canonical;
  })();
  return canonicalSpellings;
}

// Normalizes a song's subgenres and merges spelling variants into one
// display spelling, so they count and filter as a single genre.
export async function canonicalizeGenres(subgenres: string[]): Promise<string[]> {
  const spellings = await getCanonicalSpellings();
  return [
    ...new Set(
      subgenres
        .map(normalizeGenre)
        .filter(Boolean)
        .map((genre) => spellings.get(genreKey(genre)) ?? genre)
    ),
  ];
}

let backfill: Promise<void> | null = null;

// The first time the store is used, seed it from summaries generated before
// it existed. Writes the file directly (before the cache loads it) rather
// than one cache.set per entry, each of which rewrites the whole file.
function ensureBackfilled(): Promise<void> {
  backfill ??= (async () => {
    const storePath = path.join(CACHE_DIR, `${NAMESPACE}.json`);
    try {
      await fs.access(storePath);
      return;
    } catch {}
    let summaries: Record<string, { value: TrackSummary }>;
    try {
      summaries = JSON.parse(await fs.readFile(path.join(CACHE_DIR, "track-summary.json"), "utf-8"));
    } catch {
      return;
    }
    const seeded: Record<string, { value: TrackGenres }> = {};
    for (const [key, entry] of Object.entries(summaries)) {
      // Summary keys are `${trackId}:${provider}:${model}:${promptVersion}`.
      const [trackId, provider, ...rest] = key.split(":");
      const summary = entry?.value;
      if (!trackId || !Array.isArray(summary?.subgenres)) continue;
      seeded[trackId] = {
        value: {
          subgenres: summary.subgenres.map(normalizeGenre).filter(Boolean),
          moodVibe: summary.moodVibe ?? "",
          model: `${provider}:${rest.slice(0, -1).join(":")}`,
          updatedAt: Date.now(),
        },
      };
    }
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(storePath, JSON.stringify(seeded, null, 2), "utf-8");
  })();
  return backfill;
}

// Entries with no subgenres (saved before empty answers were refused)
// count as missing, so they show up to be generated again.
export async function getTrackGenres(trackIds: string[]): Promise<Record<string, TrackGenres>> {
  await ensureBackfilled();
  const result: Record<string, TrackGenres> = {};
  for (const id of trackIds) {
    const entry = await genreCache.get(id);
    if (entry && entry.subgenres.length > 0) {
      result[id] = { ...entry, subgenres: await canonicalizeGenres(entry.subgenres) };
    }
  }
  return result;
}

export async function saveTrackGenres(trackId: string, summary: TrackSummary, model: string): Promise<void> {
  await ensureBackfilled();
  const subgenres = summary.subgenres.map(normalizeGenre).filter(Boolean);
  const existing = await genreCache.get(trackId);
  // Skip the write (a full file rewrite) when nothing changed — this runs on
  // every summary request, cached ones included.
  if (
    existing &&
    existing.model === model &&
    existing.moodVibe === summary.moodVibe &&
    existing.subgenres.join("|") === subgenres.join("|")
  ) {
    return;
  }
  await genreCache.set(trackId, { subgenres, moodVibe: summary.moodVibe, model, updatedAt: Date.now() });
  canonicalSpellings = null;
}
