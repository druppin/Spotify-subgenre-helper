"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { LabOverview } from "@/app/api/lab/route";
import { CompareRuns, pct, SongHistory } from "./PromptLabCompare";

/*
 * Prompt lab (developer mode): a test set of songs with the genres expected
 * for each, a summary-prompt editor, and saved runs of a prompt over the
 * set, compared side by side and scored. Runs never touch the library's
 * tags; "Use in app" is the only thing here that changes what the app does.
 */

const MAX_COMPARE = 6;
// Without these the app can't read the AI's answer.
const REQUIRED_KEYS = ["moodVibe", "subgenres", "rationale"];

async function send(url: string, method: string, body?: unknown): Promise<string | null> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => null);
  if (!res) return "Couldn't reach the app.";
  if (res.ok) return null;
  return (await res.json().catch(() => ({}))).error ?? `Failed (${res.status}).`;
}

type ChatTurn = { role: "user" | "assistant"; content: string };

/** A conversation with the app's model; the selected test song's data goes along with it. Kept only on the page. */
function LabChat({ model, track }: { model: string | null; track: { trackId: string; name: string } | null }) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    const question = text.trim();
    if (!question || sending) return;
    const next = [...turns, { role: "user" as const, content: question }];
    setTurns(next);
    setText("");
    setSending(true);
    setError(null);
    const res = await fetch("/api/lab/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: next, trackId: track?.trackId }),
    }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    if (res?.ok) {
      setTurns([...next, { role: "assistant", content: body.reply }]);
    } else {
      // Put the question back so it isn't lost.
      setTurns(turns);
      setText(question);
      setError(!res ? "Couldn't reach the app." : (body.error ?? `Failed (${res.status}).`));
    }
    setSending(false);
  };

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline gap-3">
        <h2 className="font-narrow text-base font-bold">Chat with the model</h2>
        <span className="text-xs text-muted">{model ?? "No AI provider set up (Settings)"}</span>
        {turns.length > 0 && (
          <button type="button" className="ml-auto text-xs text-muted underline hover:text-ink" onClick={() => setTurns([])}>
            Clear
          </button>
        )}
      </div>
      <p className="text-[13px] text-muted">
        {track
          ? `Each message includes the saved data for ${track.name}.`
          : "Select a test song to include its data with each message."}{" "}
        Nothing here is saved.
      </p>
      {turns.length > 0 && (
        <ol className="flex flex-col gap-2" aria-live="polite">
          {turns.map((turn, i) => (
            <li
              key={i}
              className={`whitespace-pre-wrap rounded-md px-3 py-2 text-[13px] ${
                turn.role === "user" ? "self-end bg-raised" : "border border-line"
              }`}
            >
              {turn.content}
            </li>
          ))}
          {sending && <li className="text-[13px] text-muted">Thinking…</li>}
        </ol>
      )}
      {error && <p className="text-[13px] text-danger">{error}</p>}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={2}
          placeholder="Ask the model something (Enter sends, Shift+Enter for a new line)"
          aria-label="Message to the model"
          className={`${input} flex-1`}
        />
        <button type="submit" disabled={sending || !text.trim() || !model} className={button}>
          Send
        </button>
      </form>
    </section>
  );
}

const button = "rounded-md border border-line-strong px-3 py-1 text-[13px] font-semibold hover:bg-raised disabled:opacity-50";
const input =
  "rounded-md border border-line bg-ground px-2.5 py-1.5 text-[13px] outline-none placeholder:text-faint focus:border-ink-2";

export function PromptLabView({ tabs }: { tabs: ReactNode }) {
  const [data, setData] = useState<LabOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped on every reload, so open read-outs fetch again too.
  const [refreshKey, setRefreshKey] = useState(0);
  const [draft, setDraft] = useState<string | null>(null);
  const [runName, setRunName] = useState("");
  const [refresh, setRefresh] = useState(false);
  const [links, setLinks] = useState("");
  const [newNote, setNewNote] = useState("");
  const [busy, setBusy] = useState(false);
  // Index of the starter song being added, while adding them.
  const [starterDone, setStarterDone] = useState<number | null>(null);
  const [compareIds, setCompareIds] = useState<number[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/lab").catch(() => null);
    if (!res?.ok) {
      setError((await res?.json().catch(() => ({})))?.error ?? "Couldn't load the prompt lab.");
      return;
    }
    const body: LabOverview = await res.json();
    setData(body);
    setDraft((d) => d ?? body.livePrompt);
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    // Fetching on mount; state is only set once the fetch answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const anyRunning = data?.runs.some((r) => r.status === "running") ?? false;
  useEffect(() => {
    if (!anyRunning) return;
    const timer = setInterval(() => void load(), 2500);
    return () => clearInterval(timer);
  }, [anyRunning, load]);

  const act = async (url: string, method: string, body?: unknown) => {
    setBusy(true);
    const err = await send(url, method, body);
    setError(err);
    await load();
    setBusy(false);
    return err === null;
  };

  if (!data || draft === null) {
    return (
      <div className="flex h-screen flex-col bg-ground text-ink">
        <header className="band flex items-center gap-3 px-4 py-2.5">{tabs}</header>
        <p className="p-4 text-[13px] text-muted">{error ?? "Loading…"}</p>
      </div>
    );
  }

  const missingKeys = REQUIRED_KEYS.filter((k) => !draft.includes(k));
  const comparedRuns = compareIds.flatMap((id) => data.runs.find((r) => r.id === id) ?? []);
  const selectedTrack = data.tracks.find((t) => t.trackId === selected);
  const toggleCompare = (id: number) =>
    setCompareIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : ids.length < MAX_COMPARE ? [...ids, id] : ids));

  return (
    <div className="flex h-screen flex-col bg-ground text-ink">
      <header className="band flex items-center gap-3 px-4 py-2.5">
        {tabs}
        <span className="text-[13px] text-muted">
          {data.tracks.length} test songs · {data.runs.length} runs
        </span>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col gap-2.5 overflow-y-auto border-r border-line bg-side p-3.5">
          <h2 className="font-narrow text-base font-bold">Test set</h2>
          <form
            className="flex flex-col gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await act("/api/lab/tracks", "POST", { input: links, note: newNote })) {
                setLinks("");
                setNewNote("");
              }
            }}
          >
            <textarea
              value={links}
              onChange={(e) => setLinks(e.target.value)}
              rows={3}
              placeholder="Spotify song links or ids, one per line"
              aria-label="Spotify song links or ids"
              className={input}
            />
            <input
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Why they're in the set (optional)"
              aria-label="Why they're in the set"
              className={input}
            />
            <button type="submit" disabled={busy || !links.trim()} className={button}>
              Add songs
            </button>
          </form>
          <button
            type="button"
            disabled={busy}
            className={button}
            title="Looks up a picked set of songs on Spotify, with notes and expected genres. Songs already in the set are left as they are."
            onClick={async () => {
              setBusy(true);
              setError(null);
              const notFound: string[] = [];
              const partial: string[] = [];
              for (let i = 0; i < data.starterCount; i++) {
                setStarterDone(i);
                const res = await fetch("/api/lab/tracks", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ starter: i }),
                }).catch(() => null);
                const body = await res?.json().catch(() => ({}));
                if (!res?.ok) {
                  // Usually not logged in or offline: the rest would fail the same way.
                  setError(!res ? "Couldn't reach the app." : (body.error ?? `Failed (${res.status}).`));
                  break;
                }
                if (body.status === "notFound") notFound.push(data.starterLabels[i]);
                if (body.lookupFailed) partial.push(data.starterLabels[i]);
                if (body.status === "added") await load();
              }
              setStarterDone(null);
              if (notFound.length || partial.length) {
                setError(
                  [
                    notFound.length && `Not found on Spotify: ${notFound.join("; ")}.`,
                    partial.length && `Added with some lookups failed (tick "Look songs up again first" on a run): ${partial.join("; ")}.`,
                  ]
                    .filter(Boolean)
                    .join(" ")
                );
              }
              await load();
              setBusy(false);
            }}
          >
            {starterDone === null
              ? `Add starter songs (${data.starterCount})`
              : `Adding starter songs… ${starterDone + 1}/${data.starterCount}`}
          </button>
          <ul className="flex flex-col gap-1">
            {data.tracks.map((t) => (
              <li key={t.trackId}>
                <button
                  type="button"
                  onClick={() => setSelected(t.trackId === selected ? null : t.trackId)}
                  aria-pressed={t.trackId === selected}
                  className={`w-full rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-raised ${
                    t.trackId === selected ? "bg-raised" : ""
                  }`}
                >
                  <div className="font-semibold">{t.name}</div>
                  <div className="text-xs text-muted">{t.artists.join(", ")}</div>
                  {t.truth ? (
                    <div className="text-xs text-faint">{t.truth.required.join(", ")}</div>
                  ) : (
                    <div className="text-xs text-warn">No expected genres yet</div>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <main className="flex min-h-0 flex-col gap-5 overflow-y-auto p-4">
          {error && <p className="text-[13px] text-danger">{error}</p>}

          <section className="flex flex-col gap-2">
            <h2 className="font-narrow text-base font-bold">Summary prompt</h2>
            <p className="text-[13px] text-muted">
              The app uses{" "}
              {data.liveIsDefault ? "the built-in prompt" : `a custom prompt (${data.livePromptHash.slice(0, 8)})`}.
              Runs below don&apos;t change anything in your library.
            </p>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={14}
              spellCheck={false}
              aria-label="Summary prompt"
              className={`${input} font-mono text-xs leading-5`}
            />
            {missingKeys.length > 0 && (
              <p className="text-[13px] text-warn">
                The prompt no longer mentions {missingKeys.join(", ")}; the AI&apos;s answers may not be readable.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={button} onClick={() => setDraft(data.livePrompt)}>
                Load app&apos;s prompt
              </button>
              <button type="button" className={button} onClick={() => setDraft(data.defaultPrompt)}>
                Load built-in
              </button>
              <button type="button" className={button} onClick={() => void navigator.clipboard?.writeText(draft)}>
                Copy
              </button>
              <button
                type="button"
                disabled={busy || draft === data.livePrompt}
                className={button}
                onClick={() => {
                  if (confirm("Use this prompt for every new summary in the app? Songs already tagged keep their tags.")) {
                    void act("/api/lab/prompt", "PUT", { prompt: draft });
                  }
                }}
              >
                Use in app
              </button>
              {!data.liveIsDefault && (
                <button type="button" disabled={busy} className={button} onClick={() => void act("/api/lab/prompt", "PUT", { prompt: null })}>
                  App back to built-in
                </button>
              )}
            </div>
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await act("/api/lab/runs", "POST", { name: runName, prompt: draft, refresh })) setRunName("");
              }}
            >
              <input
                value={runName}
                onChange={(e) => setRunName(e.target.value)}
                placeholder="Run name (what you changed)"
                aria-label="Run name"
                className={`${input} min-w-64 flex-1`}
              />
              <label className="flex items-center gap-1.5 text-[13px]">
                <input type="checkbox" checked={refresh} onChange={(e) => setRefresh(e.target.checked)} />
                Look songs up again first
              </label>
              <button type="submit" disabled={busy || data.tracks.length === 0} className={button}>
                Run test set ({data.tracks.length} songs)
              </button>
            </form>
          </section>

          <LabChat model={data.model} track={selectedTrack ?? null} />

          <section className="flex flex-col gap-2">
            <h2 className="font-narrow text-base font-bold">Runs</h2>
            {data.runs.length === 0 ? (
              <p className="text-[13px] text-muted">No runs yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr className="text-left text-xs text-muted">
                      <th className="p-1.5">Compare</th>
                      <th className="p-1.5">Run</th>
                      <th className="p-1.5">Model · prompt</th>
                      <th className="p-1.5">Status</th>
                      <th className="p-1.5" title="Balance of precision and recall">F1</th>
                      <th className="p-1.5" title="Share of named tags that were expected or acceptable">Precision</th>
                      <th className="p-1.5" title="Share of expected genres that were named">Recall</th>
                      <th className="p-1.5" title="Songs whose main genre family matched">Family</th>
                      <th className="p-1.5" title="Average confidence on right / wrong tags">Conf. ✓/✗</th>
                      <th className="p-1.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.runs.map((run) => {
                      const checked = compareIds.includes(run.id);
                      return (
                        <tr key={run.id} className="border-t border-line">
                          <td className="p-1.5">
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={!checked && compareIds.length >= MAX_COMPARE}
                              onChange={() => toggleCompare(run.id)}
                              aria-label={`Compare ${run.name}`}
                            />
                          </td>
                          <td className="p-1.5">
                            <div className="font-semibold">{run.name}</div>
                            <div className="text-xs text-muted">
                              {new Date(run.createdAt).toLocaleString()}
                              {run.refreshed && " · fresh data"}
                            </div>
                          </td>
                          <td className="p-1.5 text-xs text-muted">
                            {run.model}
                            <br />
                            {run.promptHash.slice(0, 8)}
                          </td>
                          <td className="p-1.5 text-xs">
                            {run.status === "running"
                              ? `Running ${run.done}/${run.total}`
                              : run.status === "interrupted"
                                ? `Stopped at ${run.done}/${run.total}`
                                : `Done${run.errors ? `, ${run.errors} failed` : ""}`}
                          </td>
                          <td className="p-1.5 font-semibold">{pct(run.score.f1)}</td>
                          <td className="p-1.5">{pct(run.score.precision)}</td>
                          <td className="p-1.5">{pct(run.score.recall)}</td>
                          <td className="p-1.5">{pct(run.score.familyAccuracy)}</td>
                          <td className="p-1.5 text-xs">
                            {run.score.hitConfidence === null ? "–" : Math.round(run.score.hitConfidence)} /{" "}
                            {run.score.wrongConfidence === null ? "–" : Math.round(run.score.wrongConfidence)}
                          </td>
                          <td className="whitespace-nowrap p-1.5">
                            <button
                              type="button"
                              className="text-xs text-muted underline hover:text-ink"
                              onClick={async () => {
                                const res = await fetch(`/api/lab/runs?ids=${run.id}`);
                                const body = await res.json();
                                if (body.runs?.[0]) setDraft(body.runs[0].prompt);
                              }}
                            >
                              Edit prompt
                            </button>{" "}
                            <button
                              type="button"
                              disabled={run.status === "running"}
                              className="text-xs text-danger underline disabled:opacity-50"
                              onClick={() => {
                                if (confirm(`Delete ${run.name}?`)) {
                                  setCompareIds((ids) => ids.filter((x) => x !== run.id));
                                  void act(`/api/lab/runs?id=${run.id}`, "DELETE");
                                }
                              }}
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="flex flex-col gap-2">
            {selectedTrack ? (
              <>
                <button type="button" className="self-start text-xs text-muted underline" onClick={() => setSelected(null)}>
                  ← Back to comparing runs
                </button>
                <SongHistory
                  key={selectedTrack.trackId}
                  track={selectedTrack}
                  runs={data.runs}
                  refreshKey={refreshKey}
                  onSaved={() => void load()}
                  onRemove={() => {
                    if (confirm(`Take ${selectedTrack.name} out of the test set? Its past answers stay in old runs.`)) {
                      setSelected(null);
                      void act(`/api/lab/tracks?id=${selectedTrack.trackId}`, "DELETE");
                    }
                  }}
                />
              </>
            ) : (
              <>
                <h2 className="font-narrow text-base font-bold">
                  Compare {comparedRuns.length > 0 && `(${comparedRuns.length} of max ${MAX_COMPARE})`}
                </h2>
                <CompareRuns runs={comparedRuns} tracks={data.tracks} refreshKey={refreshKey} />
              </>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
