"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SpotifyPlaylist } from "@/lib/spotify/client";
import { fetchPlaylistGenres, summarizeGenres, type PlaylistGenreTrack } from "@/lib/playlistGenres";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";
import { PlaylistPicker } from "./PlaylistPicker";

const DEFAULT_BATCH = 10;
const MAX_BATCH = 50;
// Songs analyzed at once. Each one also costs a few Spotify requests for its
// context, so the cap stays modest to keep clear of Spotify's rate limits.
const DEFAULT_CONCURRENCY = 3;
const MAX_CONCURRENCY = 8;
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
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; current: string[] } | null>(null);
  const [results, setResults] = useState<RunResult[]>([]);
  const [stoppedReason, setStoppedReason] = useState<string | null>(null);
  const stopRef = useRef(false);

  // Closing the overlay mid-run stops after the requests in flight.
  useEffect(
    () => () => {
      stopRef.current = true;
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
  const clampedConcurrency = Math.min(Math.max(Math.round(concurrency) || 1, 1), MAX_CONCURRENCY);

  const run = async (queue: PlaylistGenreTrack[]) => {
    stopRef.current = false;
    setRunning(true);
    setResults([]);
    setStoppedReason(null);
    let consecutiveFailures = 0;
    let anySucceeded = false;
    let next = 0;
    let done = 0;
    // Keyed by track ID: two different songs can share a name.
    const inFlight = new Map<string, string>();
    const report = () => setProgress({ done, total: queue.length, current: [...inFlight.values()] });
    report();

    // Each worker takes the next song off the queue until it's empty or the
    // run is stopped; requests already in flight always finish.
    const worker = async () => {
      while (next < queue.length && !stopRef.current) {
        const track = queue[next++];
        inFlight.set(track.id, track.name);
        report();
        let result: RunResult;
        try {
          const res = await fetchWithTimeout(`/api/track/${track.id}/summary`, {}, 90_000);
          const body = await res.json();
          if (res.ok && body.summary) {
            result = { id: track.id, name: track.name, ok: true, detail: body.summary.subgenres.join(", ") };
          } else {
            result = { id: track.id, name: track.name, ok: false, detail: body.summaryError ?? body.error ?? `HTTP ${res.status}` };
          }
        } catch (err) {
          result = { id: track.id, name: track.name, ok: false, detail: String(err) };
        }
        inFlight.delete(track.id);
        done++;
        report();
        setResults((prev) => [...prev, result]);
        if (result.ok) {
          anySucceeded = true;
          consecutiveFailures = 0;
        } else if (++consecutiveFailures >= MAX_CONSECUTIVE_FAILURES && !stopRef.current) {
          stopRef.current = true;
          setStoppedReason(`Stopped after ${MAX_CONSECUTIVE_FAILURES} failures in a row — see the errors below.`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(clampedConcurrency, queue.length) }, worker));
    if (stopRef.current && done < queue.length) setStoppedReason((r) => r ?? "Stopped.");

    setProgress((p) => (p ? { ...p, done: p.total, current: [] } : p));
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
                  max={MAX_CONCURRENCY}
                  value={concurrency}
                  onChange={(e) => setConcurrency(Number(e.target.value))}
                  title={`How many songs to analyze at the same time (1–${MAX_CONCURRENCY}). Higher is faster but more likely to hit rate limits.`}
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
            </div>
          )}

          {progress && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="truncate text-neutral-300">
                  {running
                    ? `Analyzed ${progress.done} of ${progress.total}` +
                      (progress.current.length ? ` — now: ${progress.current.join(", ")}` : "")
                    : `Done — ${results.filter((r) => r.ok).length} of ${results.length} succeeded.`}
                </span>
                {running && (
                  <button
                    onClick={() => (stopRef.current = true)}
                    className="flex-shrink-0 text-xs text-neutral-400 hover:text-red-400"
                  >
                    {progress.current.length > 1 ? "Stop after these" : "Stop after this one"}
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
