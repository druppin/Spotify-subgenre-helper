"use client";

import { useEffect, useState } from "react";
import type { SnapshotChange, TagSnapshot } from "@/lib/trackGenres";

/**
 * Saving a playlist's songs' tags, and later seeing side by side what's
 * changed since and putting any of them back. reloadNonce refreshes the list
 * (a run can save a snapshot of its own); onRestored lets the dialog reload.
 */
export function TagSnapshots({
  playlistId,
  trackIds,
  disabled,
  reloadNonce,
  onRestored,
}: {
  playlistId: string;
  trackIds: string[];
  disabled: boolean;
  reloadNonce: number;
  onRestored: () => void;
}) {
  const [snapshots, setSnapshots] = useState<TagSnapshot[]>([]);
  const [listNonce, setListNonce] = useState(0);
  const [open, setOpen] = useState<{ id: number; changes: SnapshotChange[] | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/tag-snapshots?playlistId=${encodeURIComponent(playlistId)}`)
      .then((res) => res.json())
      .then((body) => !cancelled && setSnapshots(body.snapshots ?? []))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [playlistId, reloadNonce, listNonce]);

  const call = async (url: string, init?: RequestInit) => {
    setError(null);
    const res = await fetch(url, init);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    return body;
  };
  const failed = (err: unknown) => setError(err instanceof Error ? err.message : String(err));

  const compare = (id: number) => {
    setOpen({ id, changes: null });
    call(`/api/tag-snapshots?id=${id}`).then((body) => setOpen({ id, changes: body.changes }), failed);
  };

  const save = () =>
    call("/api/tag-snapshots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Saved by you", playlistId, trackIds }),
    }).then(() => setListNonce((n) => n + 1), failed);

  const restore = (id: number, ids?: string[]) =>
    call("/api/tag-snapshots", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, trackIds: ids }),
    }).then(() => {
      onRestored();
      compare(id);
    }, failed);

  const remove = (snapshot: TagSnapshot) => {
    if (!window.confirm(`Delete the snapshot from ${when(snapshot.createdAt)}? This can't be undone.`)) return;
    call(`/api/tag-snapshots?id=${snapshot.id}`, { method: "DELETE" }).then(() => {
      if (open?.id === snapshot.id) setOpen(null);
      setListNonce((n) => n + 1);
    }, failed);
  };

  return (
    <div className="space-y-2 border-t border-line pt-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">Snapshots</h3>
        <button
          onClick={save}
          disabled={disabled}
          title="Save a copy of every song's tags in this playlist, to compare with or put back later."
          className="rounded-md border border-line-strong px-3 py-1 text-sm text-ink hover:border-ink-2 disabled:opacity-50"
        >
          Save snapshot
        </button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      {snapshots.length === 0 ? (
        <p className="text-xs text-muted">None yet. Redo all saves one first, automatically.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {snapshots.map((s) => (
            <li key={s.id} className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-ink">{when(s.createdAt)}</span>
              <span className="text-xs text-muted">
                {s.name} · {s.songs} songs
              </span>
              <span className="ml-auto flex gap-3 text-xs">
                <button onClick={() => (open?.id === s.id ? setOpen(null) : compare(s.id))} className="text-ink-2 hover:text-ink">
                  {open?.id === s.id ? "Hide" : "Compare with now"}
                </button>
                <button onClick={() => remove(s)} disabled={disabled} className="text-muted hover:text-danger disabled:opacity-50">
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div className="space-y-2 rounded-md border border-line bg-ground/60 p-2">
          {open.changes === null ? (
            <p className="text-xs text-muted">Comparing…</p>
          ) : open.changes.length === 0 ? (
            <p className="text-xs text-muted">No song&apos;s tags have changed since this snapshot.</p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-muted">
                  {open.changes.length} {open.changes.length === 1 ? "song has" : "songs have"} different tags now.
                  Struck-out tags are gone now; highlighted ones are new.
                </span>
                <button
                  onClick={() => {
                    const n = open.changes!.length;
                    if (window.confirm(`Put back the snapshot's tags on all ${n} changed songs?`)) restore(open.id, open.changes!.map((c) => c.trackId));
                  }}
                  disabled={disabled}
                  className="flex-shrink-0 rounded-md bg-ink px-2 py-0.5 font-semibold text-ground disabled:opacity-50"
                >
                  Restore all {open.changes.length}
                </button>
              </div>
              <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 text-xs">
                <span className="text-muted">Song</span>
                <span className="text-muted">Snapshot</span>
                <span className="text-muted">Now</span>
                <span />
                {open.changes.map((c) => (
                  <Row key={c.trackId} change={c} disabled={disabled} onRestore={() => restore(open.id, [c.trackId])} />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ change, disabled, onRestore }: { change: SnapshotChange; disabled: boolean; onRestore: () => void }) {
  const now = new Set(change.now ?? []);
  const then = new Set(change.then);
  return (
    <>
      <span className="min-w-0">
        <span className="block truncate text-ink">{change.name}</span>
        <span className="block truncate text-muted">{change.artists}</span>
      </span>
      <Tags tags={change.then} marked={(t) => !now.has(t)} kind="gone" />
      {change.now ? <Tags tags={change.now} marked={(t) => !then.has(t)} kind="new" /> : <span className="text-muted">No tags</span>}
      <button onClick={onRestore} disabled={disabled} className="text-ink-2 hover:text-ink disabled:opacity-50">
        Restore
      </button>
    </>
  );
}

function Tags({ tags, marked, kind }: { tags: string[]; marked: (tag: string) => boolean; kind: "gone" | "new" }) {
  return (
    <span className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <span
          key={t}
          className={`rounded-md px-1.5 py-0.5 ${
            !marked(t) ? "bg-raised text-ink-2" : kind === "gone" ? "bg-raised text-danger line-through" : "bg-raised font-semibold text-ok"
          }`}
        >
          {t}
        </span>
      ))}
    </span>
  );
}

function when(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
