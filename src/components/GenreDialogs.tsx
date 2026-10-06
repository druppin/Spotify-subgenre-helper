"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SpotifyPlaylist } from "@/lib/spotify/client";
import { fetchPlaylistGenres, summarizeGenres, type PlaylistGenreTrack } from "@/lib/playlistGenres";
import type { SummaryStep } from "@/lib/context";
import { PlaylistPicker } from "./PlaylistPicker";

const DEFAULT_BATCH = 10;
const MAX_BATCH = 50;
// Songs analyzed at once. A song whose Spotify details aren't saved yet
// costs a Spotify request, so the normal cap stays modest to keep clear of
// Spotify's rate limits; the user can opt into the higher one.
const DEFAULT_CONCURRENCY = 3;
const MAX_CONCURRENCY = 8;
const RAISED_MAX_CONCURRENCY = 25;
// Per-song steps shown while analyzing, in the order they usually finish.
const STEPS: { step: SummaryStep; label: string }[] = [
  { step: "spotify", label: "Spotify" },
  { step: "lastfm", label: "Last.fm" },
  { step: "audio", label: "Audio" },
  { step: "musicbrainz", label: "MusicBrainz" },
  { step: "ai", label: "AI" },
];
// Stop a run after this many failures in a row — usually the LLM provider
// rate-limiting or rejecting the key, where carrying on just burns requests.
const MAX_CONSECUTIVE_FAILURES = 3;

type Loaded =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; tracks: PlaylistGenreTrack[] };

function usePlaylistGenres(playlistId: string | null, reloadNonce: number): Loaded {
  const [state, setState] = useState<{ key: string; loaded: Loaded } | null>(null);
  const key = `${playlistId}:${reloadNonce}`;

  useEffect(() => {
    if (!playlistId) return;
    let cancelled = false;
    fetchPlaylistGenres(playlistId)
      .then((tracks) => !cancelled && setState({ key, loaded: { status: "ready", tracks } }))
      .catch((err) => !cancelled && setState({ key, loaded: { status: "error", message: String(err.message ?? err) } }));
    return () => {
      cancelled = true;
    };
  }, [playlistId, key]);

  // Anything loaded for a different playlist/reload is stale.
  return state?.key === key ? state.loaded : { status: "loading" };
}

function Overlay({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto flex max-h-[85vh] w-full max-w-xl flex-col rounded-lg border border-neutral-700 bg-neutral-900 p-0 text-white backdrop:bg-black/60"
    >
      <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        <button onClick={() => ref.current?.close()} className="text-neutral-500 hover:text-white" aria-label="Close">
          ✕
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">{children}</div>
    </dialog>
  );
}

interface CommonProps {
  // Playlists whose tracks we can read: owned/collaborative, plus the source.
  playlists: SpotifyPlaylist[];
  initialPlaylistId: string | null;
  onClose: () => void;
}

export function PlaylistGenresDialog({
  playlists,
  initialPlaylistId,
  onClose,
  onGenerateMissing,
}: CommonProps & { onGenerateMissing: (playlistId: string) => void }) {
  const [playlistId, setPlaylistId] = useState(initialPlaylistId);
  const loaded = usePlaylistGenres(playlistId, 0);

  return (
    <Overlay title="Playlist genres" onClose={onClose}>
      <PlaylistPicker
        playlists={playlists}
        selectedId={playlistId}
        onSelect={setPlaylistId}
        placeholder="Choose a playlist…"
        fullWidth
      />

      {!playlistId ? null : loaded.status === "loading" ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : loaded.status === "error" ? (
        <p className="text-sm text-red-400">{loaded.message}</p>
      ) : (
        <GenreSummary tracks={loaded.tracks} onGenerateMissing={() => onGenerateMissing(playlistId)} />
      )}
    </Overlay>
  );
}

function GenreSummary({ tracks, onGenerateMissing }: { tracks: PlaylistGenreTrack[]; onGenerateMissing: () => void }) {
  const { counts, withInfo } = summarizeGenres(tracks);
  const missing = tracks.length - withInfo;
  const max = counts[0]?.tracks ?? 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-neutral-400">
          {withInfo} of {tracks.length} songs have genre info
        </span>
        {missing > 0 && (
          <button onClick={onGenerateMissing} className="text-xs text-green-400 hover:underline">
            Generate for the {missing} missing →
          </button>
        )}
      </div>

      {counts.length === 0 ? (
        <p className="text-sm text-neutral-500">No genre info for this playlist yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {counts.map(({ genre, tracks: n }) => (
            <li key={genre} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-2 text-sm">
              <span className="truncate text-neutral-200" title={genre}>
                {genre}
              </span>
              <span className="h-2 rounded-full bg-neutral-800">
                <span
                  className="block h-2 rounded-full bg-green-600"
                  style={{ width: `${Math.max((n / max) * 100, 3)}%` }}
                />
              </span>
              <span className="w-16 text-right text-xs text-neutral-500">
                {n} · {Math.round((n / withInfo) * 100)}%
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type RunResult = { id: string; name: string; ok: boolean; detail: string };
type ActiveSong = { id: string; name: string; startedAt: number; steps: SummaryStep[] };

type RunMessage =
  | { id: string; started: true }
  | { id: string; step: SummaryStep }
  | { id: string; status: number; body: { summary?: { subgenres: string[] }; summaryError?: string; error?: string } }
  | { done: true };

// Reads a newline-delimited JSON response, one message at a time.
async function* readMessages(res: Response): AsyncGenerator<RunMessage> {
  if (!res.body) return;
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffered += value;
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    for (const line of lines) if (line) yield JSON.parse(line);
  }
}

export function GenerateGenresDialog({
  playlists,
  initialPlaylistId,
  onClose,
  currentTrackId,
  sourcePlaylistId,
  onGenerated,
}: CommonProps & {
  currentTrackId: string | null;
  sourcePlaylistId: string | null;
  onGenerated: () => void;
}) {
  const [playlistId, setPlaylistId] = useState(initialPlaylistId);
  const [reloadNonce, setReloadNonce] = useState(0);
  const loaded = usePlaylistGenres(playlistId, reloadNonce);
  const [batchSize, setBatchSize] = useState(DEFAULT_BATCH);
  const [concurrency, setConcurrency] = useState(DEFAULT_CONCURRENCY);
  const [raisedConcurrency, setRaisedConcurrency] = useState(false);
  const maxConcurrency = raisedConcurrency ? RAISED_MAX_CONCURRENCY : MAX_CONCURRENCY;
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [active, setActive] = useState<ActiveSong[]>([]);
  // Ticks while running so each song's elapsed time stays current.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  const [results, setResults] = useState<RunResult[]>([]);
  const [stoppedReason, setStoppedReason] = useState<string | null>(null);
  const stopRef = useRef(false);
  const runIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Asks the server to start no more songs; ones already running finish.
  const stop = () => {
    if (stopRef.current) return;
    stopRef.current = true;
    if (runIdRef.current) fetch(`/api/genre-runs?runId=${runIdRef.current}`, { method: "DELETE" }).catch(() => {});
  };

  // Closing the overlay mid-run drops the connection, which also tells the
  // server to start no more songs.
  useEffect(
    () => () => {
      stopRef.current = true;
      abortRef.current?.abort();
    },
    []
  );

  const missing = (() => {
    if (loaded.status !== "ready") return [];
    const seen = new Set<string>();
    const list: PlaylistGenreTrack[] = [];
    for (const t of loaded.tracks) {
      if (t.subgenres || seen.has(t.id)) continue;
      seen.add(t.id);
      list.push(t);
    }
    // In the source playlist, "next" means from the song you're on onward.
    if (playlistId === sourcePlaylistId && currentTrackId) {
      const order = loaded.tracks.map((t) => t.id);
      const start = order.indexOf(currentTrackId);
      if (start > 0) {
        const position = (id: string) => (order.indexOf(id) - start + order.length) % order.length;
        list.sort((a, b) => position(a.id) - position(b.id));
      }
    }
    return list;
  })();

  const clampedBatch = Math.min(Math.max(Math.round(batchSize) || 1, 1), MAX_BATCH);
  const clampedConcurrency = Math.min(Math.max(Math.round(concurrency) || 1, 1), maxConcurrency);

  const run = async (queue: PlaylistGenreTrack[]) => {
    stopRef.current = false;
    setRunning(true);
    setResults([]);
    setStoppedReason(null);
    let consecutiveFailures = 0;
    let anySucceeded = false;
    let done = 0;
    setActive([]);
    setProgress({ done, total: queue.length });
    const names = new Map(queue.map((t) => [t.id, t.name]));
    const runId = crypto.randomUUID();
    runIdRef.current = runId;
    const abort = new AbortController();
    abortRef.current = abort;

    // One request for the whole run: the server works through the songs in
    // parallel and streams back every song's progress. (One request per song
    // would be held to the browser's 6 connections per server.)
    const finish = (id: string, result: RunResult) => {
      setActive((prev) => prev.filter((s) => s.id !== id));
      done++;
      setProgress({ done, total: queue.length });
      setResults((prev) => [...prev, result]);
      if (result.ok) {
        anySucceeded = true;
        consecutiveFailures = 0;
      } else if (++consecutiveFailures >= MAX_CONSECUTIVE_FAILURES && !stopRef.current) {
        stop();
        setStoppedReason(`Stopped after ${MAX_CONSECUTIVE_FAILURES} failures in a row — see the errors below.`);
      }
    };
    try {
      const res = await fetch("/api/genre-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, trackIds: queue.map((t) => t.id), concurrency: clampedConcurrency }),
        signal: abort.signal,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      for await (const message of readMessages(res)) {
        if ("done" in message) break;
        const name = names.get(message.id) ?? message.id;
        if ("started" in message) {
          setActive((prev) => [...prev, { id: message.id, name, startedAt: Date.now(), steps: [] }]);
        } else if ("step" in message) {
          const { id, step } = message;
          setActive((prev) => prev.map((s) => (s.id === id ? { ...s, steps: [...s.steps, step] } : s)));
        } else {
          const { id, status, body } = message;
          finish(
            id,
            status < 400 && body.summary
              ? { id, name, ok: true, detail: body.summary.subgenres.join(", ") }
              : { id, name, ok: false, detail: body.summaryError ?? body.error ?? `HTTP ${status}` }
          );
        }
      }
    } catch (err) {
      if (!abort.signal.aborted) setStoppedReason(`The run failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    runIdRef.current = null;
    setActive([]);
    if (stopRef.current && done < queue.length) setStoppedReason((r) => r ?? "Stopped.");

    setProgress((p) => (p ? { ...p, done: p.total } : p));
    setRunning(false);
    if (anySucceeded) {
      onGenerated();
      setReloadNonce((n) => n + 1);
    }
  };

  const analyzeAll = () => {
    if (!window.confirm(`Analyze all ${missing.length} songs? That's ${missing.length} AI requests.`)) return;
    run(missing);
  };

  return (
    <Overlay title="Generate genres" onClose={onClose}>
      <PlaylistPicker
        playlists={playlists}
        selectedId={playlistId}
        onSelect={setPlaylistId}
        placeholder="Choose a playlist…"
        fullWidth
        disabled={running}
      />

      {!playlistId ? null : loaded.status === "loading" && !running ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : loaded.status === "error" ? (
        <p className="text-sm text-red-400">{loaded.message}</p>
      ) : (
        <div className="space-y-4">
          {loaded.status === "ready" && (
            <p className="text-sm text-neutral-400">
              {missing.length === 0
                ? "Every song in this playlist already has genre info."
                : `${missing.length} of ${loaded.tracks.length} songs have no genre info. Each one analyzed is one AI request.`}
            </p>
          )}

          {missing.length > 0 && !running && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-sm">
                Analyze the next
                <input
                  type="number"
                  min={1}
                  max={MAX_BATCH}
                  value={batchSize}
                  onChange={(e) => setBatchSize(Number(e.target.value))}
                  className="w-16 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm outline-none focus:border-green-600"
                />
                songs,
                <input
                  type="number"
                  min={1}
                  max={maxConcurrency}
                  value={concurrency}
                  onChange={(e) => setConcurrency(Number(e.target.value))}
                  title={`How many songs to analyze at the same time (1–${maxConcurrency}). Higher is faster but more likely to hit rate limits.`}
                  className="w-14 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm outline-none focus:border-green-600"
                />
                at a time
              </label>
              <button
                onClick={() => run(missing.slice(0, clampedBatch))}
                className="rounded-md bg-green-600 px-3 py-1 text-sm font-semibold text-white"
              >
                Analyze {Math.min(clampedBatch, missing.length)}
              </button>
              <button
                onClick={analyzeAll}
                className="rounded-md border border-neutral-700 px-3 py-1 text-sm text-neutral-200 hover:border-amber-500 hover:text-amber-300"
              >
                Analyze all {missing.length}
              </button>
              <label className="flex basis-full items-start gap-2 text-xs text-neutral-400">
                <input
                  type="checkbox"
                  checked={raisedConcurrency}
                  onChange={(e) => {
                    setRaisedConcurrency(e.target.checked);
                    if (!e.target.checked) setConcurrency((c) => Math.min(c, MAX_CONCURRENCY));
                  }}
                  className="mt-0.5 accent-green-600"
                />
                <span>
                  Allow up to {RAISED_MAX_CONCURRENCY} at a time (normally {MAX_CONCURRENCY}). Songs whose Spotify info
                  isn&apos;t saved yet each cost a Spotify request, so this can send Spotify more requests at once than
                  expected and risk getting the app temporarily blocked.
                </span>
              </label>
            </div>
          )}

          {progress && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="truncate text-neutral-300">
                  {running
                    ? `Analyzed ${progress.done} of ${progress.total}`
                    : `Done — ${results.filter((r) => r.ok).length} of ${results.length} succeeded.`}
                </span>
                {running && (
                  <button
                    onClick={stop}
                    className="flex-shrink-0 text-xs text-neutral-400 hover:text-red-400"
                  >
                    {active.length > 1 ? "Stop after these" : "Stop after this one"}
                  </button>
                )}
              </div>
              <div className="h-1.5 rounded-full bg-neutral-800">
                <div
                  className="h-1.5 rounded-full bg-green-600 transition-[width]"
                  style={{ width: `${(progress.done / progress.total) * 100}%` }}
                />
              </div>
              {stoppedReason && <p className="text-xs text-amber-400">{stoppedReason}</p>}
            </div>
          )}

          {active.length > 0 && (
            <ul className="space-y-2">
              {active.map((song) => (
                <li key={song.id} className="rounded-md border border-neutral-800 bg-neutral-950/60 px-3 py-2">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="truncate text-neutral-200">{song.name}</span>
                    <span className="flex-shrink-0 text-xs tabular-nums text-neutral-500">
                      {Math.max(0, Math.floor((now - song.startedAt) / 1000))}s
                    </span>
                  </div>
                  <div className="mt-1.5 h-1 rounded-full bg-neutral-800">
                    <div
                      className="h-1 rounded-full bg-green-600 transition-[width]"
                      style={{ width: `${(song.steps.length / STEPS.length) * 100}%` }}
                    />
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
                    {STEPS.map(({ step, label }) => {
                      const finished = song.steps.includes(step);
                      // The AI only starts once every source is in.
                      const working = !finished && (step === "ai" ? song.steps.length === STEPS.length - 1 : step === "spotify" || song.steps.includes("spotify"));
                      return (
                        <span
                          key={step}
                          className={finished ? "text-green-400" : working ? "animate-pulse text-neutral-300" : "text-neutral-600"}
                        >
                          {finished ? "✓" : "·"} {label}
                        </span>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {results.length > 0 && (
            <ul className="space-y-1 text-xs">
              {results.map((r, i) => (
                <li key={`${r.id}-${i}`} className="flex gap-2">
                  <span className={r.ok ? "text-green-400" : "text-red-400"}>{r.ok ? "✓" : "✕"}</span>
                  <span className="min-w-0 flex-1">
                    <span className="text-neutral-200">{r.name}</span>{" "}
                    <span className={r.ok ? "text-neutral-500" : "text-red-400/80"}>— {r.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Overlay>
  );
}
