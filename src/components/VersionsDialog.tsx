"use client";

import { useEffect, useRef, useState } from "react";
import { LIKED_SONGS_ID, type LibraryTrackDetails } from "@/lib/library";
import type { StoredTags } from "@/lib/llm/types";
import type { ReleaseInfo } from "@/lib/releaseInfo";
import type { VersionChange } from "@/lib/versions";
import { GenreChips } from "./GenreTagEditor";
import { CloseIcon, PauseIcon, PlayIcon } from "./Icons";
import { usePlayer } from "./PlayerProvider";
import { formatMs, SeekBar } from "./SeekBar";

export interface SongVersion {
  uri: string;
  details: LibraryTrackDetails;
  // Playlists (and Liked Songs) this version is in.
  placeIds: string[];
  genres: StoredTags | undefined;
}

const RELEASE_KIND: Record<NonNullable<ReleaseInfo["albumType"]>, string> = {
  album: "Album",
  single: "Single or EP",
  compilation: "Compilation",
};

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json as T;
}

// "2024-07-09" -> "Jul 9, 2024", keeping only as much as is known
// ("2024-07" -> "Jul 2024", "2024" -> "2024").
function formatDate(date: string | null): string | null {
  if (!date) return null;
  const [y, m, d] = date.split("-").map(Number);
  if (!m) return String(y);
  return new Date(Date.UTC(y, m - 1, d || 1)).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    ...(d ? { day: "numeric" } : {}),
    timeZone: "UTC",
  });
}

/**
 * A song's versions side by side, to listen to and compare, then keep one
 * (it replaces the others everywhere they are) or leave them be.
 */
export function VersionsDialog({
  versions,
  placeName,
  onClose,
  onKeepApart,
  onKept,
}: {
  versions: SongVersion[];
  placeName: (id: string) => string;
  onClose: () => void;
  // "These are different on purpose": stop flagging them.
  onKeepApart: () => void;
  onKept: (keep: string, changes: VersionChange[]) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { ready, currentUri, isPaused, playTrack, togglePlay } = usePlayer();
  const [info, setInfo] = useState<Record<string, ReleaseInfo> | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  // The version picked to keep, and what keeping it would change.
  const [plan, setPlan] = useState<{ keep: string; changes: VersionChange[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const uris = versions.map((v) => v.uri).join(",");
  useEffect(() => {
    let cancelled = false;
    postJson<{ info: Record<string, ReleaseInfo> }>("/api/versions/info", { uris: uris.split(",") })
      .then((body) => !cancelled && setInfo(body.info))
      .catch((err) => !cancelled && setInfoError(err.message));
    return () => {
      cancelled = true;
    };
  }, [uris]);

  const pickToKeep = async (keep: string) => {
    setError(null);
    setBusy(true);
    try {
      const { changes } = await postJson<{ changes: VersionChange[] }>("/api/versions/keep", {
        keep,
        others: versions.map((v) => v.uri),
        preview: true,
      });
      setPlan({ keep, changes });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const confirmKeep = async () => {
    if (!plan) return;
    setError(null);
    setBusy(true);
    try {
      const { changes } = await postJson<{ changes: VersionChange[] }>("/api/versions/keep", {
        keep: plan.keep,
        others: versions.map((v) => v.uri),
      });
      onKept(plan.keep, changes);
      ref.current?.close();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const lengths = new Set(versions.map((v) => Math.round(v.details.durationMs / 1000)));
  const kept = plan && versions.find((v) => v.uri === plan.keep);
  const replacing = plan ? plan.changes.reduce((n, c) => n + c.removed.length, 0) : 0;

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="versions-title"
      className="m-auto flex max-h-[90vh] w-full max-w-5xl flex-col rounded-lg border border-line-strong bg-panel p-0 text-ink backdrop:bg-black/60"
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <div>
          <h2 id="versions-title" className="font-narrow text-lg font-bold">
            {versions[0].details.name}
          </h2>
          <p className="text-[13px] text-muted">
            {versions.length} versions of this song are in your library. Listen to them, then keep one or leave
            them as they are.
          </p>
        </div>
        <button onClick={() => ref.current?.close()} className="text-muted hover:text-ink" aria-label="Close">
          <CloseIcon size={16} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
        {plan && kept ? (
          <div className="mx-auto max-w-xl space-y-3">
            <h3 className="text-[15px] font-semibold">
              Keep the version {info?.[kept.uri]?.album ? `on ${info[kept.uri].album}` : `of ${kept.details.name}`}?
            </h3>
            {plan.changes.length === 0 ? (
              <p className="text-sm text-muted">The other versions aren&apos;t in any of your playlists, so nothing changes.</p>
            ) : (
              <>
                <p className="text-sm text-muted">
                  This replaces {replacing} {replacing === 1 ? "copy" : "copies"} of the other versions in{" "}
                  {plan.changes.length} {plan.changes.length === 1 ? "place" : "places"}:
                </p>
                <ul className="space-y-1 text-sm">
                  {plan.changes.map((c) => (
                    <li key={c.placeId} className="flex gap-2">
                      <span className="font-medium">{placeName(c.placeId)}</span>
                      <span className="text-muted">
                        {c.keptAdded
                          ? c.placeId === LIKED_SONGS_ID
                            ? "liked instead"
                            : "swapped in the same spot"
                          : "already has this version, so the others are just removed"}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted">You can undo it afterwards.</p>
              </>
            )}
          </div>
        ) : (
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: `repeat(${versions.length}, minmax(220px, 1fr))` }}
          >
            {versions.map((v) => {
              const release = info?.[v.uri];
              const playing = currentUri === v.uri;
              const original = release?.originalDate ?? null;
              return (
                <section key={v.uri} className="flex flex-col gap-3 rounded-[10px] bg-ground p-3">
                  <div className="flex items-start gap-3">
                    {release?.image || v.details.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={release?.image ?? v.details.image!}
                        alt=""
                        className="h-24 w-24 flex-shrink-0 rounded object-cover"
                      />
                    ) : (
                      <div className="h-24 w-24 flex-shrink-0 rounded bg-raised" />
                    )}
                    <div className="min-w-0">
                      <div className="font-semibold leading-snug">{v.details.name}</div>
                      <div className="text-[13px] text-muted">{v.details.artists.join(", ")}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => (playing ? togglePlay() : void playTrack(v.uri))}
                      disabled={!ready}
                      aria-label={playing && !isPaused ? "Pause this version" : "Play this version"}
                      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-line-strong hover:bg-raised disabled:opacity-40"
                    >
                      {playing && !isPaused ? <PauseIcon size={15} /> : <PlayIcon size={15} />}
                    </button>
                    {playing ? (
                      <SeekBar className="min-w-0 flex-1" />
                    ) : (
                      <span className="text-[13px] text-muted">{ready ? "Play to compare" : "Player connecting…"}</span>
                    )}
                  </div>

                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px]">
                    <dt className="text-muted">Length</dt>
                    <dd className={lengths.size > 1 ? "font-semibold" : undefined}>{formatMs(v.details.durationMs)}</dd>
                    <dt className="text-muted">Released</dt>
                    <dd>{release ? (formatDate(original) ?? "Unknown") : infoError ? "Unknown" : "Looking up…"}</dd>
                    <dt className="text-muted">On</dt>
                    <dd>
                      {release ? (
                        <>
                          {release.albumType && `${RELEASE_KIND[release.albumType]}: `}
                          <span className={release.albumType ? "text-muted" : undefined}>
                            {release.album ?? "Unknown release"}
                          </span>
                          {release.albumDate && release.albumDate !== original && (
                            <span className="text-muted">, {formatDate(release.albumDate)}</span>
                          )}
                        </>
                      ) : (
                        <span className="text-muted">…</span>
                      )}
                    </dd>
                    <dt className="text-muted">In</dt>
                    <dd>
                      {v.placeIds.length > 0 ? (
                        v.placeIds.map(placeName).join(", ")
                      ) : (
                        <span className="text-muted">No playlists</span>
                      )}
                    </dd>
                  </dl>

                  {v.genres && v.genres.own.length > 0 && (
                    <div className="flex flex-wrap gap-x-2 gap-y-1">
                      <GenreChips genres={v.genres} size="sm" />
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => void pickToKeep(v.uri)}
                    disabled={busy}
                    className="mt-auto rounded-md border border-line-strong px-3 py-1.5 text-[13px] font-semibold hover:bg-raised disabled:opacity-50"
                  >
                    Keep this one
                  </button>
                </section>
              );
            })}
          </div>
        )}
        {infoError && !plan && (
          <p className="mt-3 text-xs text-muted">Couldn&apos;t look up release dates: {infoError}</p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">
        {error && <span className="mr-auto text-[13px] text-danger">{error}</span>}
        {plan ? (
          <>
            <button
              type="button"
              onClick={() => setPlan(null)}
              disabled={busy}
              className="rounded-md border border-line-strong px-3 py-1.5 text-[13px] font-medium hover:bg-raised disabled:opacity-50"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => void confirmKeep()}
              disabled={busy || plan.changes.length === 0}
              className="rounded-md bg-ink px-4 py-1.5 text-[13px] font-semibold text-ground hover:bg-ink-2 disabled:opacity-50"
            >
              {busy ? "Replacing…" : `Replace ${replacing} ${replacing === 1 ? "copy" : "copies"}`}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => {
                onKeepApart();
                ref.current?.close();
              }}
              className="mr-auto text-[13px] text-muted underline-offset-2 hover:text-ink hover:underline"
            >
              These are different on purpose
            </button>
            <button
              type="button"
              onClick={() => ref.current?.close()}
              className="rounded-md border border-line-strong px-3 py-1.5 text-[13px] font-medium hover:bg-raised"
            >
              Leave as is
            </button>
          </>
        )}
      </div>
    </dialog>
  );
}
