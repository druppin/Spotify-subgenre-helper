"use client";

import { useEffect, useState } from "react";
import type { SpotifyTrack } from "@/lib/spotify/client";
import type { TrackContext, TrackSummary } from "@/lib/llm/types";
import { usePlayer } from "./PlayerProvider";
import { TrackDataPanel } from "./TrackDataPanel";

interface Props {
  track: SpotifyTrack | null;
}

type FetchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; context: TrackContext; summary: TrackSummary | null; summaryError: string | null };

// Owns the actual fetch. Remounted (via a `key` that includes a retry
// nonce) whenever the track changes OR the user clicks retry, so a lazy
// initial state is all that's needed — no setState-in-effect reset required.
function TrackData({ trackId, onRetry }: { trackId: string; onRetry: () => void }) {
  const [state, setState] = useState<FetchState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/track/${trackId}/summary`)
      .then(async (res) => {
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setState({ status: "error", message: body.error ?? "Failed to load track data" });
          return;
        }
        setState({
          status: "ready",
          context: body.context,
          summary: body.summary ?? null,
          summaryError: body.summaryError ?? null,
        });
      })
      .catch((err) => {
        if (!cancelled) setState({ status: "error", message: String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [trackId]);

  if (state.status === "loading") {
    return <p className="text-sm text-neutral-500">Loading track data…</p>;
  }

  if (state.status === "error") {
    return (
      <div className="space-y-2">
        <p className="text-sm text-red-400">{state.message}</p>
        <button onClick={onRetry} className="text-xs text-green-400 hover:underline">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <TrackDataPanel context={state.context} />

      <div className="border-t border-neutral-800 pt-3">
        {state.summary && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-neutral-200">{state.summary.moodVibe}</p>
            <div className="flex flex-wrap gap-1">
              {state.summary.subgenres.map((genre) => (
                <span
                  key={genre}
                  className="rounded-full bg-green-600/20 px-2 py-0.5 text-xs text-green-400"
                >
                  {genre}
                </span>
              ))}
            </div>
            <p className="text-xs text-neutral-500">{state.summary.rationale}</p>
          </div>
        )}
        {state.summaryError && (
          <div className="space-y-1">
            <p className="text-xs text-red-400">AI summary: {state.summaryError}</p>
            <button onClick={onRetry} className="text-xs text-green-400 hover:underline">
              Retry summary
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function NowPlayingPanel({ track }: Props) {
  const { ready, isPaused, playbackError, togglePlay } = usePlayer();
  const [retryNonce, setRetryNonce] = useState(0);

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

      <button
        onClick={() => togglePlay()}
        disabled={!ready}
        className="rounded-full bg-green-600 px-6 py-2 font-semibold text-white disabled:opacity-50"
      >
        {isPaused ? "Play" : "Pause"}
      </button>

      {playbackError && (
        <p className="max-w-md text-xs text-red-400">Playback error: {playbackError}</p>
      )}

      <div className="w-full max-w-md rounded-lg bg-neutral-900 p-4 text-left">
        <TrackData
          key={retryNonce}
          trackId={track.id}
          onRetry={() => setRetryNonce((n) => n + 1)}
        />
      </div>
    </div>
  );
}
