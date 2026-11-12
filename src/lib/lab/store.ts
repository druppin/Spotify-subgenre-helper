import { sql, transaction } from "@/lib/db";
import { DEFAULT_SUMMARY_PROMPT, promptHash } from "@/lib/llm/summarize";
import type { TrackContext, TrackSummary } from "@/lib/llm/types";
import type { Truth } from "./score";

/*
 * The prompt lab's saved data (tables lab_* in db.ts): the test set, the
 * expected genres for each song (every version kept), what the AI was
 * given for each song, and every run with each song's answer.
 */

export function savePrompt(text: string): string {
  const hash = promptHash(text);
  sql("INSERT OR IGNORE INTO lab_prompts (hash, text, created_at) VALUES (?, ?, ?)").run(hash, text, Date.now());
  return hash;
}

export function promptText(hash: string): string | undefined {
  return (sql("SELECT text FROM lab_prompts WHERE hash = ?").get(hash) as { text: string } | undefined)?.text;
}

/** The summary prompt the app uses: one promoted from the lab, else the built-in one. */
export function liveSummaryPrompt(): string {
  const row = sql("SELECT value FROM lab_state WHERE key = 'live_prompt'").get() as { value: string } | undefined;
  return (row && promptText(row.value)) || DEFAULT_SUMMARY_PROMPT;
}

/** Makes `text` the app's summary prompt; null goes back to the built-in one. */
export function setLiveSummaryPrompt(text: string | null) {
  if (text === null || text === DEFAULT_SUMMARY_PROMPT) {
    sql("DELETE FROM lab_state WHERE key = 'live_prompt'").run();
    return;
  }
  const hash = savePrompt(text);
  sql("INSERT INTO lab_state (key, value) VALUES ('live_prompt', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(hash);
}

// ---- Test set ----

export interface LabTrack {
  trackId: string;
  name: string;
  artists: string[];
  note: string;
  addedAt: number;
  truth: (Truth & { setAt: number }) | null;
  dataCapturedAt: number | null;
}

export function listTracks(): LabTrack[] {
  const rows = sql(
    `SELECT t.track_id, t.name, t.artists, t.note, t.added_at,
       (SELECT max(captured_at) FROM lab_contexts c WHERE c.track_id = t.track_id) AS captured_at
     FROM lab_tracks t ORDER BY t.added_at`
  ).all() as { track_id: string; name: string; artists: string; note: string; added_at: number; captured_at: number | null }[];
  const truths = currentTruths();
  return rows.map((r) => ({
    trackId: r.track_id,
    name: r.name,
    artists: JSON.parse(r.artists),
    note: r.note,
    addedAt: r.added_at,
    truth: truths.get(r.track_id) ?? null,
    dataCapturedAt: r.captured_at,
  }));
}

export function addTrack(context: TrackContext, note: string) {
  transaction(() => {
    sql(
      `INSERT INTO lab_tracks (track_id, name, artists, note, added_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (track_id) DO UPDATE SET name = excluded.name, artists = excluded.artists`
    ).run(context.trackId, context.trackName, JSON.stringify(context.artistNames), note, Date.now());
    saveContext(context);
  });
}

export function setNote(trackId: string, note: string) {
  sql("UPDATE lab_tracks SET note = ? WHERE track_id = ?").run(note, trackId);
}

// Past runs and truths stay, so old runs still show the song.
export function removeTrack(trackId: string) {
  sql("DELETE FROM lab_tracks WHERE track_id = ?").run(trackId);
}

const cleanList = (list: string[]) => list.map((s) => s.trim()).filter(Boolean);

export function setTruth(trackId: string, truth: Truth) {
  sql("INSERT INTO lab_truths (track_id, required, acceptable, set_at) VALUES (?, ?, ?, ?)").run(
    trackId,
    JSON.stringify(cleanList(truth.required)),
    JSON.stringify(cleanList(truth.acceptable)),
    Date.now()
  );
}

type TruthRow = { track_id: string; required: string; acceptable: string; set_at: number };
const toTruth = (r: TruthRow) => ({ required: JSON.parse(r.required), acceptable: JSON.parse(r.acceptable), setAt: r.set_at });

export function currentTruths(): Map<string, Truth & { setAt: number }> {
  const rows = sql(
    "SELECT track_id, required, acceptable, set_at FROM lab_truths WHERE id IN (SELECT max(id) FROM lab_truths GROUP BY track_id)"
  ).all() as TruthRow[];
  return new Map(rows.map((r) => [r.track_id, toTruth(r)]));
}

export function truthHistory(trackId: string): (Truth & { setAt: number })[] {
  return (
    sql("SELECT track_id, required, acceptable, set_at FROM lab_truths WHERE track_id = ? ORDER BY id DESC").all(trackId) as TruthRow[]
  ).map(toTruth);
}

// ---- What the AI was given ----

/** Saves a song's input data (once per distinct version) and returns its hash. */
export function saveContext(context: TrackContext): string {
  const text = JSON.stringify(context, null, 2);
  const hash = promptHash(text);
  sql(
    `INSERT INTO lab_contexts (hash, track_id, context, captured_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (hash) DO UPDATE SET captured_at = excluded.captured_at`
  ).run(hash, context.trackId, text, Date.now());
  return hash;
}

export function latestContext(trackId: string): { hash: string; context: TrackContext } | undefined {
  const row = sql("SELECT hash, context FROM lab_contexts WHERE track_id = ? ORDER BY captured_at DESC LIMIT 1").get(trackId) as
    | { hash: string; context: string }
    | undefined;
  return row && { hash: row.hash, context: JSON.parse(row.context) };
}

export function contextsByHash(hashes: string[]): Record<string, TrackContext> {
  const out: Record<string, TrackContext> = {};
  for (const hash of new Set(hashes)) {
    const row = sql("SELECT context FROM lab_contexts WHERE hash = ?").get(hash) as { context: string } | undefined;
    if (row) out[hash] = JSON.parse(row.context);
  }
  return out;
}

// ---- Runs ----

export interface LabRun {
  id: number;
  name: string;
  promptHash: string;
  model: string;
  refreshed: boolean;
  total: number;
  done: number;
  createdAt: number;
  finishedAt: number | null;
}

export interface LabResult {
  runId: number;
  trackId: string;
  contextHash: string | null;
  summary: TrackSummary | null;
  error: string | null;
}

export function createRun(name: string, prompt: string, model: string, refreshed: boolean, total: number): number {
  const hash = savePrompt(prompt);
  const { lastInsertRowid } = sql(
    "INSERT INTO lab_runs (name, prompt_hash, model, refreshed, total, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(name, hash, model, refreshed ? 1 : 0, total, Date.now());
  return Number(lastInsertRowid);
}

export function saveResult(result: LabResult) {
  sql(
    `INSERT INTO lab_results (run_id, track_id, context_hash, summary, error) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (run_id, track_id) DO UPDATE SET context_hash = excluded.context_hash, summary = excluded.summary, error = excluded.error`
  ).run(result.runId, result.trackId, result.contextHash, result.summary && JSON.stringify(result.summary), result.error);
}

export function finishRun(runId: number) {
  sql("UPDATE lab_runs SET finished_at = ? WHERE id = ?").run(Date.now(), runId);
}

export function deleteRun(runId: number) {
  sql("DELETE FROM lab_runs WHERE id = ?").run(runId);
}

export function listRuns(): LabRun[] {
  const rows = sql(
    `SELECT r.*, (SELECT count(*) FROM lab_results x WHERE x.run_id = r.id) AS done
     FROM lab_runs r ORDER BY r.id DESC`
  ).all() as {
    id: number;
    name: string;
    prompt_hash: string;
    model: string;
    refreshed: number;
    total: number;
    done: number;
    created_at: number;
    finished_at: number | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    promptHash: r.prompt_hash,
    model: r.model,
    refreshed: r.refreshed === 1,
    total: r.total,
    done: r.done,
    createdAt: r.created_at,
    finishedAt: r.finished_at,
  }));
}

type ResultRow = { run_id: number; track_id: string; context_hash: string | null; summary: string | null; error: string | null };
const toResult = (r: ResultRow): LabResult => ({
  runId: r.run_id,
  trackId: r.track_id,
  contextHash: r.context_hash,
  summary: r.summary ? JSON.parse(r.summary) : null,
  error: r.error,
});

export function allResults(): LabResult[] {
  return (sql("SELECT * FROM lab_results").all() as ResultRow[]).map(toResult);
}

export function resultsForTrack(trackId: string): LabResult[] {
  return (sql("SELECT * FROM lab_results WHERE track_id = ? ORDER BY run_id").all(trackId) as ResultRow[]).map(toResult);
}
