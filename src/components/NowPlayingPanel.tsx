"use client";

import { useEffect, useState } from "react";
import type { SpotifyTrack } from "@/lib/spotify/client";
import type { ShownSummary, TrackContext } from "@/lib/llm/types";
import { usePlayer } from "./PlayerProvider";
import { TrackDataPanel } from "./TrackDataPanel";
import { ConfidenceMeter, GenreChips, GenreTagEditor, saveGenreTags, type SavedGenres } from "./GenreTagEditor";
import { SeekBar } from "./SeekBar";
import { TrackChat } from "./TrackChat";
import { NextIcon, PauseIcon, PlayIcon, PreviousIcon, VolumeIcon } from "./Icons";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";

interface Props {
  track: SpotifyTrack | null;
  onPrevious: () => void;
  onNext: () => void;
  canGoPrevious: boolean;
  canGoNext: boolean;
  // Hears the song's tag confidence once its tags load, are scored, or are edited.
  onConfidenceChange?: (trackId: string, confidence: number | null) => void;
  // Shown for a song that may not be the one playing (My library's song
  // view): Play starts this song, and the seek bar only works once it has.
  ownPlayback?: boolean;
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
    return <p className="text-sm text-muted">Loading track data…</p>;
  }

  if (state.status === "error") {
    return (
      <div className="space-y-2">
        <p className="text-sm text-danger">{state.message}</p>
        <button onClick={() => onRefresh(false)} className="text-xs text-ink underline underline-offset-2">
          Retry
        </button>
      </div>
    );
  }

  // New tags from the editor or a chat suggestion. A song with no summary
  // yet (no AI answer) gets one holding just the tags.
  const showTags = (saved: SavedGenres) => {
    onConfidenceChange?.(trackId, saved.songConfidence);
    setState((prev) =>
      prev.status === "ready"
        ? { ...prev, summary: { moodVibe: "", rationale: "", ...prev.summary, ...saved } }
        : prev
    );
  };

  const saveTags = async (tags: string[]) => {
    showTags(await saveGenreTags(trackId, tags));
    setEditing(false);
  };

  const noTags: SavedGenres = {
    own: [],
    broader: [],
    subgenres: [],
    edited: false,
    confidence: {},
    userTags: [],
    songConfidence: null,
  };

  return (
    <div className="space-y-3">
      <TrackDataPanel context={state.context} />

      <div className="border-t border-line pt-3">
        {state.summary && (
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <p className="text-[15px] font-semibold text-ink">{state.summary.moodVibe || "Your tags"}</p>
              <div className="flex flex-shrink-0 gap-3">
                {!editing && (
                  <button
                    onClick={() => setEditing(true)}
                    title="Change, remove, or add tags"
                    className="text-[13px] text-muted hover:text-ink"
                  >
                    Edit tags
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
                  className="text-[13px] text-muted hover:text-ink"
                >
                  Regenerate
                </button>
              </div>
            </div>
            {editing ? (
              <GenreTagEditor genres={state.summary} onSave={saveTags} onCancel={() => setEditing(false)} />
            ) : (
              <div className="space-y-2">
                <GenreChips genres={state.summary} />
                {(state.summary.songConfidence !== null || state.summary.edited) && (
                  <div className="flex items-center gap-3 text-[12.5px] text-muted">
                    {state.summary.songConfidence !== null && (
                      <span className="inline-flex items-center gap-2" title="The average of the AI's confidence in its tags">
                        Overall
                        <ConfidenceMeter score={state.summary.songConfidence} width={64} />
                      </span>
                    )}
                    {state.summary.edited && <span title="You changed these tags by hand">Edited by you</span>}
                  </div>
                )}
              </div>
            )}
            {state.summary.rationale && (
            <p className="max-w-[62ch] text-[13px] leading-relaxed text-muted">
              {state.summary.edited && <span className="text-faint">The AI&apos;s original reasoning: </span>}
              {state.summary.rationale}
            </p>
            )}
          </div>
        )}
        {!state.summary && (
          <div className="space-y-2">
            {state.summaryError && <p className="text-xs text-danger">AI summary: {state.summaryError}</p>}
            {editing ? (
              <GenreTagEditor genres={noTags} onSave={saveTags} onCancel={() => setEditing(false)} />
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setEditing(true)}
                  className="rounded-md bg-ink px-3 py-1.5 text-[13px] font-semibold text-ground hover:bg-ink-2"
                >
                  Add tags yourself
                </button>
                {state.summaryError && (
                  <button
                    onClick={() => onRefresh(true)}
                    className="rounded-md border border-line-strong px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-raised"
                  >
                    Retry the AI
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <TrackChat trackId={trackId} firstTag={state.summary?.own[0]} onTagsApplied={showTags} />
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
  ownPlayback = false,
}: Props) {
  const { ready, isPaused, currentUri, volume, playbackError, togglePlay, playTrack, setVolume } = usePlayer();
  const [retryNonce, setRetryNonce] = useState(0);
  const [forceNextFetch, setForceNextFetch] = useState(false);

  const refresh = (force: boolean) => {
    setForceNextFetch(force);
    setRetryNonce((n) => n + 1);
  };

  if (!track) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        Pick a source playlist to start sorting.
      </div>
    );
  }

  const isThisPlaying = !ownPlayback || currentUri === track.uri;

  return (
    <div className="flex h-full flex-col items-center gap-4 overflow-y-auto px-8 py-6 text-center">
      {track.album.images[0] ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={track.album.images[0].url}
          alt={track.album.name}
          className="h-44 w-44 flex-shrink-0 rounded-md object-cover shadow-[0_14px_30px_rgba(0,0,0,0.35)]"
        />
      ) : (
        <div className="h-44 w-44 flex-shrink-0 rounded-md bg-raised" />
      )}
      <div>
        <h1 className="font-narrow text-4xl font-bold leading-tight">{track.name}</h1>
        <p className="mt-0.5 text-[15px] text-muted">{track.artists.map((a) => a.name).join(", ")}</p>
      </div>

      <div className="w-full max-w-xl space-y-1.5">
        <SeekBar disabled={!isThisPlaying} />
        <div className="grid grid-cols-[1fr_auto_1fr] items-center">
          <span />
          <div className="flex items-center gap-2">
            <button
              onClick={onPrevious}
              disabled={!canGoPrevious}
              className="flex h-9 w-9 items-center justify-center rounded-full text-ink hover:bg-raised disabled:opacity-30"
              aria-label="Previous track"
            >
              <PreviousIcon size={18} />
            </button>
            <button
              onClick={() => (isThisPlaying ? togglePlay() : void playTrack(track.uri))}
              disabled={!ready}
              aria-label={isThisPlaying && !isPaused ? "Pause" : "Play"}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-ink text-ground hover:bg-ink-2 disabled:opacity-50"
            >
              {isThisPlaying && !isPaused ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
            </button>
            <button
              onClick={onNext}
              disabled={!canGoNext}
              className="flex h-9 w-9 items-center justify-center rounded-full text-ink hover:bg-raised disabled:opacity-30"
              aria-label="Next track"
            >
              <NextIcon size={18} />
            </button>
          </div>
          <div className="flex items-center justify-end gap-1.5 text-muted">
            <VolumeIcon size={16} />
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              aria-label="Volume"
              className="w-20 min-w-0 accent-[var(--ink)]"
            />
          </div>
        </div>
      </div>

      {playbackError && (
        <p className="max-w-md text-xs text-danger">Playback error: {playbackError}</p>
      )}

      <div className="w-full max-w-xl rounded-[10px] bg-panel px-5 py-4 text-left">
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
