"use client";

import { useEffect, useRef, useState } from "react";
import type { SpotifyTrack } from "@/lib/spotify/client";
import type { ShownSummary, TrackContext } from "@/lib/llm/types";
import { usePlayer } from "./PlayerProvider";
import { TrackDataPanel } from "./TrackDataPanel";
import { confidenceColor, GenreChips, GenreTagEditor, saveGenreTags } from "./GenreTagEditor";
import { TrackChat } from "./TrackChat";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";

interface Props {
  track: SpotifyTrack | null;
  onPrevious: () => void;
  onNext: () => void;
  canGoPrevious: boolean;
  canGoNext: boolean;
  // Hears the song's tag confidence once its tags load, are scored, or are edited.
  onConfidenceChange?: (trackId: string, confidence: number | null) => void;
}

function formatMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

type FetchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; context: TrackContext; summary: ShownSummary | null; summaryError: string | null };

// Owns the actual fetch. Remounted (via a `key` that includes a retry
// nonce) whenever the track changes OR the user clicks retry/regenerate, so
// a lazy initial state is all that's needed — no setState-in-effect reset
// required. `force`, when true, tells the API to skip the disk cache and
// generate a brand new summary rather than returning the same cached one.
function TrackData({
  trackId,
  force,
  onRefresh,
  onConfidenceChange,
}: {
  trackId: string;
  force: boolean;
  onRefresh: (force: boolean) => void;
  onConfidenceChange?: (trackId: string, confidence: number | null) => void;
}) {
  const [state, setState] = useState<FetchState>({ status: "loading" });
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const url = `/api/track/${trackId}/summary${force ? "?force=true" : ""}`;
    // Server-side, a single track summary can legitimately chain several
    // retrying layers (Spotify calls, then the LLM call) — worst case that
    // can take well over a minute. This request had no timeout of its own,
    // so in a bad case the fetch promise just never settled and the UI sat
    // on "Loading track data..." with nothing to show for it. 60s is a
    // generous ceiling that still guarantees an actionable error + Retry
    // button shows up eventually instead of an unbounded wait.
    fetchWithTimeout(url, {}, 60_000)
      .then(async (res) => {
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setState({ status: "error", message: body.error ?? "Failed to load track data" });
          return;
        }
        if (body.summary) onConfidenceChange?.(trackId, body.summary.songConfidence);
        setState({
          status: "ready",
          context: body.context,
          summary: body.summary ?? null,
          summaryError: body.summaryError ?? body.scoreError ?? null,
        });
      })
      .catch((err) => {
        if (!cancelled) setState({ status: "error", message: String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [trackId, force, onConfidenceChange]);

  if (state.status === "loading") {
    return <p className="text-sm text-neutral-500">Loading track data…</p>;
  }

  if (state.status === "error") {
    return (
      <div className="space-y-2">
        <p className="text-sm text-red-400">{state.message}</p>
        <button onClick={() => onRefresh(false)} className="text-xs text-green-400 hover:underline">
          Retry
        </button>
      </div>
    );
  }

  const saveTags = async (tags: string[]) => {
    const saved = await saveGenreTags(trackId, tags);
    onConfidenceChange?.(trackId, saved.songConfidence);
    setState((prev) =>
      prev.status === "ready" && prev.summary ? { ...prev, summary: { ...prev.summary, ...saved } } : prev
    );
    setEditing(false);
  };

  return (
    <div className="space-y-3">
      <TrackDataPanel context={state.context} />

      <div className="border-t border-neutral-800 pt-3">
        {state.summary && (
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium text-neutral-200">{state.summary.moodVibe}</p>
              <div className="flex flex-shrink-0 gap-3">
                {!editing && (
                  <button
                    onClick={() => setEditing(true)}
                    title="Change, remove, or add tags"
                    className="text-xs text-neutral-500 hover:text-green-400"
                  >
                    ✎ Edit tags
                  </button>
                )}
                <button
                  onClick={() => {
                    if (
                      state.summary?.edited &&
                      !confirm("Regenerating replaces the tags you edited with the AI's. Go ahead?")
                    ) {
                      return;
                    }
                    onRefresh(true);
                  }}
                  title="Not right? Generate a fresh AI summary for this track."
                  className="text-xs text-neutral-500 hover:text-green-400"
                >
                  ↻ Regenerate
                </button>
              </div>
            </div>
            {editing ? (
              <GenreTagEditor genres={state.summary} onSave={saveTags} onCancel={() => setEditing(false)} />
            ) : (
              <div className="flex flex-wrap items-center gap-1">
                <GenreChips genres={state.summary} />
                {state.summary.songConfidence !== null && (
                  <span
                    className={`text-[11px] ${confidenceColor(state.summary.songConfidence)}`}
                    title="The average of the AI's confidence in its tags"
                  >
                    {state.summary.songConfidence}% overall
                  </span>
                )}
                {state.summary.edited && (
                  <span className="text-[11px] text-neutral-500" title="You changed these tags by hand">
                    edited
                  </span>
                )}
              </div>
            )}
            <p className="text-xs text-neutral-500">
              {state.summary.edited && <span className="text-neutral-600">The AI&apos;s original reasoning: </span>}
              {state.summary.rationale}
            </p>
          </div>
        )}
        {state.summaryError && (
          <div className="space-y-1">
            <p className="text-xs text-red-400">AI summary: {state.summaryError}</p>
            <button onClick={() => onRefresh(true)} className="text-xs text-green-400 hover:underline">
              Retry summary
            </button>
          </div>
        )}
      </div>

      {state.summary && <TrackChat trackId={trackId} firstTag={state.summary.own[0]} />}
    </div>
  );
}

export function NowPlayingPanel({
  track,
  onPrevious,
  onNext,
  canGoPrevious,
  canGoNext,
  onConfidenceChange,
}: Props) {
  const { ready, isPaused, position, duration, volume, playbackError, togglePlay, seek, setVolume } =
    usePlayer();
  const [retryNonce, setRetryNonce] = useState(0);
  // Where the seek bar is while it's being dragged. Each change event would
  // otherwise be its own seek request to Spotify — dozens per drag — so the
  // bar moves locally and one seek goes out when it's let go.
  const [scrubPosition, setScrubPosition] = useState<number | null>(null);
  // Mirrors scrubPosition so a release right after the last change event
  // seeks to where the bar actually is, whether or not React re-rendered.
  const scrubRef = useRef<number | null>(null);
  const scrubTo = (value: number) => {
    scrubRef.current = value;
    setScrubPosition(value);
  };
  const commitScrub = () => {
    if (scrubRef.current === null) return;
    seek(scrubRef.current);
    scrubRef.current = null;
    setScrubPosition(null);
  };
  const shownPosition = scrubPosition ?? position;
  const [forceNextFetch, setForceNextFetch] = useState(false);

  const refresh = (force: boolean) => {
    setForceNextFetch(force);
    setRetryNonce((n) => n + 1);
  };

  if (!track) {
    return (
      <div className="flex h-full items-center justify-center text-neutral-500">
        Pick a source playlist to start sorting.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 overflow-y-auto px-8 py-6 text-center">
      {track.album.images[0] && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={track.album.images[0].url}
          alt={track.album.name}
          className="h-56 w-56 rounded-lg shadow-lg"
        />
      )}
      <div>
        <h1 className="text-2xl font-bold">{track.name}</h1>
        <p className="text-neutral-400">{track.artists.map((a) => a.name).join(", ")}</p>
      </div>

      <div className="w-full max-w-md space-y-3">
        <div className="flex items-center gap-2">
          <span className="w-10 text-right text-xs text-neutral-500">{formatMs(shownPosition)}</span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            value={Math.min(shownPosition, duration || 0)}
            onChange={(e) => scrubTo(Number(e.target.value))}
            onPointerUp={commitScrub}
            onKeyUp={commitScrub}
            onBlur={commitScrub}
            disabled={!ready || !duration}
            className="flex-1 accent-green-600"
          />
          <span className="w-10 text-xs text-neutral-500">{formatMs(duration)}</span>
        </div>

        <div className="flex items-center justify-center gap-4">
          <button
            onClick={onPrevious}
            disabled={!canGoPrevious}
            className="text-2xl text-neutral-300 hover:text-white disabled:opacity-30"
            aria-label="Previous track"
          >
            ⏮
          </button>
          <button
            onClick={() => togglePlay()}
            disabled={!ready}
            className="rounded-full bg-green-600 px-6 py-2 font-semibold text-white disabled:opacity-50"
          >
            {isPaused ? "Play" : "Pause"}
          </button>
          <button
            onClick={onNext}
            disabled={!canGoNext}
            className="text-2xl text-neutral-300 hover:text-white disabled:opacity-30"
            aria-label="Next track"
          >
            ⏭
          </button>
        </div>

        <div className="flex items-center justify-center gap-2">
          <span className="text-sm text-neutral-500">🔉</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            className="w-24 accent-green-600"
          />
        </div>
      </div>

      {playbackError && (
        <p className="max-w-md text-xs text-red-400">Playback error: {playbackError}</p>
      )}

      <div className="w-full max-w-md rounded-lg bg-neutral-900 p-4 text-left">
        <TrackData
          key={retryNonce}
          trackId={track.id}
          force={forceNextFetch}
          onRefresh={refresh}
          onConfidenceChange={onConfidenceChange}
        />
      </div>
    </div>
  );
}
