import { genreKey, normalizeGenre } from "../genreKey.ts";
import { dominantFamily } from "../genreFamily.ts";

/*
 * Scoring a prompt-lab run against the expected genres. Pure, so it can be
 * tested with `npm test` and used on both server and page.
 *
 * A truth has required genres (the answer should name each) and acceptable
 * ones (fine to name, never required). An entry can list alternatives:
 * "liquid dnb | liquid funk" is matched by either. Spellings are compared
 * the way the app merges them (genreKey), so "drum & bass" = "dnb".
 */

export interface Truth {
  required: string[];
  acceptable: string[];
}

export type Verdict = "hit" | "ok" | "wrong";

export interface TrackScore {
  tags: { tag: string; confidence: number | null; verdict: Verdict }[];
  // Required entries no tag matched.
  missed: string[];
  // Required entries matched, out of required.length.
  found: number;
  required: number;
  familyMatch: boolean;
}

const key = (genre: string) => genreKey(normalizeGenre(genre));
const alternatives = (entry: string) => entry.split("|").map(key).filter(Boolean);

export function scoreTrack(tags: string[], confidence: Record<string, number>, truth: Truth): TrackScore {
  const required = truth.required.map(alternatives).filter((alts) => alts.length > 0);
  const acceptable = new Set(truth.acceptable.flatMap(alternatives));
  const matched = new Set<number>();
  const scored = tags.map((tag) => {
    const k = key(tag);
    const i = required.findIndex((alts) => alts.includes(k));
    if (i >= 0) matched.add(i);
    const verdict: Verdict = i >= 0 ? "hit" : acceptable.has(k) ? "ok" : "wrong";
    return { tag, confidence: confidence[tag] ?? null, verdict };
  });
  const firstSpellings = truth.required.map((entry) => entry.split("|")[0].trim()).filter(Boolean);
  return {
    tags: scored,
    missed: truth.required.filter((_, i) => !matched.has(i)).filter((entry) => alternatives(entry).length > 0),
    found: matched.size,
    required: required.length,
    familyMatch: firstSpellings.length > 0 && dominantFamily(tags.map(normalizeGenre)) === dominantFamily(firstSpellings.map(normalizeGenre)),
  };
}

export interface RunScore {
  // Songs with both an answer and a truth.
  tracks: number;
  // Share of named tags that were required or acceptable.
  precision: number | null;
  // Share of required genres that were named.
  recall: number | null;
  f1: number | null;
  // Share of songs whose main genre family matched.
  familyAccuracy: number | null;
  // Average confidence the AI gave right and wrong tags; a well-calibrated
  // prompt keeps these far apart.
  hitConfidence: number | null;
  wrongConfidence: number | null;
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
const mean = (xs: number[]) => (xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Totals over every song (micro-averaged, so a song with more tags counts for more). */
export function scoreRun(scores: TrackScore[]): RunScore {
  const tags = scores.flatMap((s) => s.tags);
  const right = tags.filter((t) => t.verdict !== "wrong").length;
  const precision = ratio(right, tags.length);
  const recall = ratio(
    scores.reduce((n, s) => n + s.found, 0),
    scores.reduce((n, s) => n + s.required, 0)
  );
  const confidences = (want: (v: Verdict) => boolean) =>
    tags.filter((t) => want(t.verdict) && t.confidence !== null).map((t) => t.confidence!);
  return {
    tracks: scores.length,
    precision,
    recall,
    f1: precision !== null && recall !== null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : null,
    familyAccuracy: ratio(scores.filter((s) => s.familyMatch).length, scores.length),
    hitConfidence: mean(confidences((v) => v === "hit")),
    wrongConfidence: mean(confidences((v) => v === "wrong")),
  };
}

export type DiffLine = { kind: "same" | "add" | "del"; text: string };

/** Line diff of two texts (longest common subsequence), for prompts and song data. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  // lcs[i][j]: length of the common subsequence of a[i..] and b[j..].
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ kind: "del", text: a[i++] });
    else out.push({ kind: "add", text: b[j++] });
  }
  while (i < a.length) out.push({ kind: "del", text: a[i++] });
  while (j < b.length) out.push({ kind: "add", text: b[j++] });
  return out;
}
