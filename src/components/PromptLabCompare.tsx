"use client";

import { Fragment, useEffect, useState } from "react";
import type { LabOverview } from "@/app/api/lab/route";
import type { LabResult } from "@/lib/lab/store";
import type { TrackContext } from "@/lib/llm/types";
import { diffLines, scoreTrack, type Truth } from "@/lib/lab/score";
import { PauseIcon, PlayIcon } from "./Icons";
import { usePlayer } from "./PlayerProvider";
import { SeekBar } from "./SeekBar";

/*
 * The prompt lab's two read-outs: up to six runs side by side (prompt
 * changes, scores, every song's tags), and one song across every run.
 */

type Run = LabOverview["runs"][number];
type Track = LabOverview["tracks"][number];

export const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)}%`);
const num = (x: number | null) => (x === null ? "–" : String(Math.round(x)));
const short = (hash: string | null) => (hash ? hash.slice(0, 8) : "–");

const VERDICT_STYLE = {
  hit: { className: "text-ok", mark: "✓", label: "expected" },
  ok: { className: "text-muted", mark: "~", label: "acceptable" },
  wrong: { className: "text-danger", mark: "✗", label: "not expected" },
} as const;

/** One answer's tags, marked against the truth when there is one. */
function Answer({ result, truth }: { result: LabResult | undefined; truth: Truth | null }) {
  if (!result) return <span className="text-faint">not run</span>;
  if (!result.summary) return <span className="text-danger">Failed: {result.error}</span>;
  const { subgenres, confidence = {}, moodVibe, rationale } = result.summary;
  const score = truth && scoreTrack(subgenres, confidence, truth);
  return (
    <div title={`${moodVibe}\n\n${rationale}`}>
      <ul className="flex flex-col gap-0.5">
        {subgenres.map((tag, i) => {
          const style = score ? VERDICT_STYLE[score.tags[i].verdict] : null;
          return (
            <li key={tag} className={style?.className}>
              {style && <span aria-label={style.label}>{style.mark} </span>}
              {tag}
              {confidence[tag] !== undefined && <span className="text-faint"> {confidence[tag]}</span>}
            </li>
          );
        })}
      </ul>
      {score && score.missed.length > 0 && (
        <p className="mt-1 text-faint">
          Missed: <span className="line-through">{score.missed.join(", ")}</span>
        </p>
      )}
    </div>
  );
}

function Diff({ before, after }: { before: string; after: string }) {
  const lines = diffLines(before, after);
  if (lines.every((l) => l.kind === "same")) return <p className="text-[13px] text-muted">No differences.</p>;
  return (
    <pre className="max-h-96 overflow-auto rounded-md border border-line bg-ground p-2 text-xs leading-5">
      {lines.map((line, i) => (
        <div
          key={i}
          className={line.kind === "add" ? "bg-ok/15 text-ok" : line.kind === "del" ? "bg-danger/15 text-danger" : "text-muted"}
        >
          {line.kind === "add" ? "+ " : line.kind === "del" ? "- " : "  "}
          {line.text}
        </div>
      ))}
    </pre>
  );
}

function ScoreLine({ run }: { run: Run }) {
  const s = run.score;
  return (
    <span className="text-xs text-muted">
      F1 {pct(s.f1)} · precision {pct(s.precision)} · recall {pct(s.recall)} · family {pct(s.familyAccuracy)} · confidence
      right {num(s.hitConfidence)} / wrong {num(s.wrongConfidence)} · {s.tracks} scored
    </span>
  );
}

interface Detail {
  runs: { id: number; prompt: string }[];
  results: LabResult[];
  contexts: Record<string, TrackContext>;
}

/** Selected runs side by side; the first one is the base the others are compared with. */
export function CompareRuns({ runs, tracks, refreshKey }: { runs: Run[]; tracks: Track[]; refreshKey: number }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [openData, setOpenData] = useState<string | null>(null);
  const ids = runs.map((r) => r.id).join(",");

  useEffect(() => {
    if (!ids) return;
    let cancelled = false;
    fetch(`/api/lab/runs?ids=${ids}`)
      .then((res) => res.json())
      .then((body: Detail) => !cancelled && setDetail(body))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [ids, refreshKey]);

  if (runs.length === 0) return <p className="text-[13px] text-muted">Tick up to 6 runs above to compare them.</p>;
  if (!detail) return <p className="text-[13px] text-muted">Loading…</p>;

  const prompt = (id: number) => detail.runs.find((r) => r.id === id)?.prompt ?? "";
  const result = (runId: number, trackId: string) => detail.results.find((r) => r.runId === runId && r.trackId === trackId);
  const base = runs[0];
  const context = (hash: string | null | undefined) => (hash ? JSON.stringify(detail.contexts[hash] ?? {}, null, 2) : "");

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <h3 className="font-narrow text-sm font-bold">Prompts (compared with {base.name})</h3>
        {runs.slice(1).map((run) => (
          <details key={run.id} className="rounded-md border border-line bg-panel p-2">
            <summary className="cursor-pointer text-[13px]">
              {run.name}:{" "}
              {run.promptHash === base.promptHash ? "same prompt" : `prompt ${short(run.promptHash)} differs`}
            </summary>
            <div className="mt-2">
              <Diff before={prompt(base.id)} after={prompt(run.id)} />
            </div>
          </details>
        ))}
        <details className="rounded-md border border-line bg-panel p-2">
          <summary className="cursor-pointer text-[13px]">{base.name}: full prompt</summary>
          <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap text-xs text-muted">{prompt(base.id)}</pre>
        </details>
      </section>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="text-left align-bottom">
              <th className="sticky left-0 min-w-48 bg-ground p-2">Song</th>
              {runs.map((run) => (
                <th key={run.id} className="min-w-52 p-2 font-normal">
                  <div className="font-semibold">{run.name}</div>
                  <div className="text-xs text-muted">
                    {run.model} · prompt {short(run.promptHash)}
                  </div>
                  <ScoreLine run={run} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tracks.map((track) => {
              const baseHash = result(base.id, track.trackId)?.contextHash;
              const open = openData === track.trackId;
              return (
                <Fragment key={track.trackId}>
                  <tr className="border-t border-line align-top">
                    <td className="sticky left-0 bg-ground p-2">
                      <div className="font-semibold">{track.name}</div>
                      <div className="text-xs text-muted">{track.artists.join(", ")}</div>
                      {track.note && <div className="text-xs text-faint">{track.note}</div>}
                      {!track.truth && <div className="text-xs text-warn">No expected genres set</div>}
                    </td>
                    {runs.map((run) => {
                      const r = result(run.id, track.trackId);
                      const changed = run.id !== base.id && r?.contextHash && baseHash && r.contextHash !== baseHash;
                      return (
                        <td key={run.id} className="p-2">
                          <Answer result={r} truth={track.truth} />
                          {changed && (
                            <button
                              type="button"
                              onClick={() => setOpenData(open ? null : track.trackId)}
                              className="mt-1 text-xs text-warn underline"
                            >
                              Song data differs from {base.name}
                            </button>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={runs.length + 1} className="p-2">
                        {runs.slice(1).map((run) => {
                          const hash = result(run.id, track.trackId)?.contextHash;
                          if (!hash || hash === baseHash) return null;
                          return (
                            <div key={run.id} className="mb-2">
                              <p className="mb-1 text-xs text-muted">
                                Data given to the AI: {base.name} → {run.name}
                              </p>
                              <Diff before={context(baseHash)} after={context(hash)} />
                            </div>
                          );
                        })}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const splitList = (text: string) => text.split(",").map((s) => s.trim()).filter(Boolean);

/** One song: its note and expected genres (editable), and its answer in every run. */
export function SongHistory({
  track,
  runs,
  refreshKey,
  onSaved,
  onRemove,
}: {
  track: Track;
  runs: Run[];
  refreshKey: number;
  onSaved: () => void;
  onRemove: () => void;
}) {
  const [history, setHistory] = useState<{ results: LabResult[]; truths: (Truth & { setAt: number })[] } | null>(null);
  const [note, setNote] = useState(track.note);
  const [required, setRequired] = useState(track.truth?.required.join(", ") ?? "");
  const [acceptable, setAcceptable] = useState(track.truth?.acceptable.join(", ") ?? "");
  const [openData, setOpenData] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { ready, currentUri, isPaused, playbackError, playTrack, togglePlay } = usePlayer();

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/lab/tracks?id=${track.trackId}`)
      .then((res) => res.json())
      .then((body) => !cancelled && setHistory(body))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [track.trackId, refreshKey]);

  const save = async () => {
    setError(null);
    const res = await fetch("/api/lab/tracks", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        trackId: track.trackId,
        note,
        truth: { required: splitList(required), acceptable: splitList(acceptable) },
      }),
    });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? "Couldn't save.");
    else onSaved();
  };

  // Newest run first; data marked when it changed since the run before.
  const results = [...(history?.results ?? [])].reverse();
  const contextBefore = (i: number) => results.slice(i + 1).find((r) => r.contextHash)?.contextHash;
  const inputClass =
    "w-full rounded-md border border-line bg-ground px-2.5 py-1.5 text-[13px] outline-none placeholder:text-faint focus:border-ink-2";

  const uri = `spotify:track:${track.trackId}`;
  const playing = currentUri === uri;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => (playing ? togglePlay() : void playTrack(uri))}
          disabled={!ready}
          aria-label={playing && !isPaused ? `Pause ${track.name}` : `Play ${track.name}`}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-line-strong hover:bg-raised disabled:opacity-40"
        >
          {playing && !isPaused ? <PauseIcon size={15} /> : <PlayIcon size={15} />}
        </button>
        <div className="min-w-0 flex-1">
          <h3 className="font-narrow text-base font-bold">{track.name}</h3>
          <p className="text-[13px] text-muted">
            {track.artists.join(", ")} ·{" "}
            {track.dataCapturedAt ? `data saved ${new Date(track.dataCapturedAt).toLocaleString()}` : "no data saved"}
          </p>
          {playing && <SeekBar className="mt-1 max-w-md" />}
          {playing && playbackError && <p className="text-[13px] text-danger">{playbackError}</p>}
        </div>
      </div>

      <form
        className="flex flex-col gap-2 rounded-md border border-line bg-panel p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="flex flex-col gap-1 text-[13px]">
          Why it&apos;s in the set
          <input value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-[13px]">
          Expected genres (comma-separated; use | for alternatives, e.g. &quot;liquid dnb | liquid funk&quot;)
          <input value={required} onChange={(e) => setRequired(e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-[13px]">
          Also acceptable (fine if named, not required)
          <input value={acceptable} onChange={(e) => setAcceptable(e.target.value)} className={inputClass} />
        </label>
        {error && <p className="text-[13px] text-danger">{error}</p>}
        <div className="flex gap-2">
          <button type="submit" className="rounded-md border border-line-strong px-3 py-1 text-[13px] font-semibold hover:bg-raised">
            Save
          </button>
          <button type="button" onClick={onRemove} className="rounded-md px-3 py-1 text-[13px] text-danger hover:bg-raised">
            Remove from test set
          </button>
        </div>
        <p className="text-xs text-faint">
          Saving keeps the old version below. Every run is scored against the current expected genres.
        </p>
      </form>

      {history && history.truths.length > 1 && (
        <details className="text-[13px]">
          <summary className="cursor-pointer text-muted">Earlier expected genres ({history.truths.length - 1})</summary>
          <ul className="mt-1 flex flex-col gap-1 text-xs text-muted">
            {history.truths.slice(1).map((t) => (
              <li key={t.setAt}>
                {new Date(t.setAt).toLocaleString()}: {t.required.join(", ") || "none"}
                {t.acceptable.length > 0 && ` (acceptable: ${t.acceptable.join(", ")})`}
              </li>
            ))}
          </ul>
        </details>
      )}

      <section>
        <h3 className="mb-2 font-narrow text-sm font-bold">Every run</h3>
        {!history ? (
          <p className="text-[13px] text-muted">Loading…</p>
        ) : results.length === 0 ? (
          <p className="text-[13px] text-muted">Not in any run yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {results.map((r, i) => {
              const run = runs.find((x) => x.id === r.runId);
              const before = contextBefore(i);
              const changed = r.contextHash && before && r.contextHash !== before;
              return (
                <li key={r.runId} className="rounded-md border border-line bg-panel p-2 text-[13px]">
                  <div className="mb-1 text-xs text-muted">
                    {run?.name ?? `Run ${r.runId}`} · {run && new Date(run.createdAt).toLocaleString()} · prompt{" "}
                    {short(run?.promptHash ?? null)} · data {short(r.contextHash)}
                    {changed && (
                      <button
                        type="button"
                        onClick={() => setOpenData(openData === r.runId ? null : r.runId)}
                        className="ml-1 text-warn underline"
                      >
                        changed since the run before
                      </button>
                    )}
                  </div>
                  <Answer result={r} truth={track.truth} />
                  {openData === r.runId && <DataDiff before={before!} after={r.contextHash!} />}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

// Fetches two saved versions of a song's data and diffs them.
function DataDiff({ before, after }: { before: string; after: string }) {
  const [texts, setTexts] = useState<[string, string] | null>(null);
  useEffect(() => {
    fetch(`/api/lab/contexts?hashes=${before},${after}`)
      .then((res) => res.json())
      .then((body: Record<string, TrackContext>) =>
        setTexts([JSON.stringify(body[before] ?? {}, null, 2), JSON.stringify(body[after] ?? {}, null, 2)])
      )
      .catch(() => {});
  }, [before, after]);
  return <div className="mt-2">{texts ? <Diff before={texts[0]} after={texts[1]} /> : null}</div>;
}
