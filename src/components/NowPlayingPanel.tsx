"use client";

import { useEffect, useState } from "react";
import type { SpotifyTrack } from "@/lib/spotify/client";
import type { TrackSummary } from "@/lib/llm/types";
import { usePlayer } from "./PlayerProvider";

interface Props {
  track: SpotifyTrack | null;
}

type SummaryState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; summary: TrackSummary };

export function NowPlayingPanel({ track }: Props) {
  const { ready, isPaused, playbackError, togglePlay } = usePlayer();
  // NowPlayingPanel is remounted (via `key={track?.id}`) whenever the current
  // track changes, so this lazy initializer is all that's needed to reset
  // state per track — no effect-based reset required.
  const [summaryState, setSummaryState] = useState<SummaryState>(() =>
    track ? { status: "loading" } : { status: "idle" }
  );

  useEffect(() => {
    if (!track) return;
    let cancelled = false;
    fetch(`/api/track/${track.id}/summary`)
      .then(async (res) => {
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setSummaryState({ status: "error", message: body.error ?? "Failed to summarize" });
          return;
        }
        setSummaryState({ status: "ready", summary: body.summary });
      })
      .catch((err) => {
        if (!cancelled) setSummaryState({ status: "error", message: String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [track]);

  if (!track) {
    return (
      <div className="flex h-full items-center justify-center text-neutral-500">
        Pick a source playlist to start sorting.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-8 text-center">
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
        {summaryState.status === "loading" && (
          <p className="text-sm text-neutral-500">Summarizing…</p>
        )}
        {summaryState.status === "error" && (
          <p className="text-sm text-red-400">{summaryState.message}</p>
        )}
        {summaryState.status === "ready" && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-neutral-200">{summaryState.summary.moodVibe}</p>
            <div className="flex flex-wrap gap-1">
              {summaryState.summary.subgenres.map((genre) => (
                <span
                  key={genre}
                  className="rounded-full bg-green-600/20 px-2 py-0.5 text-xs text-green-400"
                >
                  {genre}
                </span>
              ))}
            </div>
            <p className="text-xs text-neutral-500">{summaryState.summary.rationale}</p>
          </div>
        )}
      </div>
    </div>
  );
}
