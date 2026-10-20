"use client";

import { useRef, useState } from "react";
import { usePlayer } from "./PlayerProvider";

function formatMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** The playing song's position, with a bar to scrub through it. */
export function SeekBar({ className = "", disabled = false }: { className?: string; disabled?: boolean }) {
  const { ready, position, duration, seek } = usePlayer();
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

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span className="w-10 text-right text-xs text-muted tabular-nums">{formatMs(shownPosition)}</span>
      <input
        type="range"
        min={0}
        max={duration || 0}
        value={Math.min(shownPosition, duration || 0)}
        onChange={(e) => scrubTo(Number(e.target.value))}
        onPointerUp={commitScrub}
        onKeyUp={commitScrub}
        onBlur={commitScrub}
        disabled={disabled || !ready || !duration}
        aria-label="Position in song"
        className="min-w-0 flex-1 accent-[var(--ink)]"
      />
      <span className="w-10 text-xs text-muted tabular-nums">{formatMs(duration)}</span>
    </div>
  );
}
