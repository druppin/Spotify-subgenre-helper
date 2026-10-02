"use client";

import { useRef, useState, type FormEvent } from "react";
import type { SpotifyPlaylist } from "@/lib/spotify/client";

interface Props {
  onPlaylistCreated: (playlist: SpotifyPlaylist, star: boolean) => void;
}

export function QuickActions({ onPlaylistCreated }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <div className="flex items-center gap-3 border-b border-neutral-800 px-4 py-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
        Quick actions
      </span>
      <button
        onClick={() => dialogRef.current?.showModal()}
        className="rounded-md border border-neutral-700 px-2.5 py-1 text-sm text-neutral-200 hover:border-green-600 hover:bg-green-600/10"
      >
        + New playlist
      </button>
      <NewPlaylistDialog dialogRef={dialogRef} onCreated={onPlaylistCreated} />
    </div>
  );
}

function NewPlaylistDialog({
  dialogRef,
  onCreated,
}: {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  onCreated: (playlist: SpotifyPlaylist, star: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [collaborative, setCollaborative] = useState(false);
  const [star, setStar] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setDescription("");
    setIsPublic(false);
    setCollaborative(false);
    setStar(true);
    setError(null);
  };

  const close = () => dialogRef.current?.close();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, isPublic, collaborative }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Failed to create playlist");
        return;
      }
      onCreated(body.playlist, star);
      close();
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      onClose={reset}
      className="m-auto w-full max-w-md rounded-lg border border-neutral-700 bg-neutral-900 p-0 text-white backdrop:bg-black/60"
    >
      <form onSubmit={handleSubmit} className="space-y-4 p-5">
        <h2 className="text-lg font-semibold">New playlist</h2>

        <label className="block space-y-1">
          <span className="text-xs text-neutral-400">Name</span>
          <input
            autoFocus
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My playlist"
            className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm outline-none focus:border-green-600"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-xs text-neutral-400">Description (optional)</span>
          <textarea
            maxLength={300}
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add an optional description"
            className="w-full resize-none rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm outline-none focus:border-green-600"
          />
        </label>

        <div className="space-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={isPublic && !collaborative}
              disabled={collaborative}
              onChange={(e) => setIsPublic(e.target.checked)}
            />
            <span className={collaborative ? "text-neutral-500" : ""}>Public</span>
            {collaborative && (
              <span className="text-xs text-neutral-500">(collaborative playlists are always private)</span>
            )}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={collaborative}
              onChange={(e) => setCollaborative(e.target.checked)}
            />
            Collaborative
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={star} onChange={(e) => setStar(e.target.checked)} />
            <span>
              Star it <span className="text-yellow-400">★</span>
            </span>
          </label>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={close}
            className="rounded-md px-3 py-1.5 text-sm text-neutral-300 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !name.trim()}
            className="rounded-md bg-green-600 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
