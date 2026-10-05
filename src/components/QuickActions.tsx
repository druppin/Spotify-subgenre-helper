"use client";

import { useRef, useState, type FormEvent } from "react";
import type { SpotifyPlaylist } from "@/lib/spotify/client";
import type { Setup } from "@/lib/setups";
import { SetupsDialog } from "./SetupsDialog";
import { GenerateGenresDialog, PlaylistGenresDialog } from "./GenreDialogs";

interface Props {
  playlists: SpotifyPlaylist[];
  sourcePlaylistId: string | null;
  pinnedIds: string[];
  alsoRemoveFromSource: boolean;
  onPlaylistCreated: (playlist: SpotifyPlaylist, star: boolean) => void;
  onLoadSetup: (setup: Setup) => void;
  // null when there's no current track to remove.
  onRemoveFromSource: (() => void) | null;
  currentTrackId: string | null;
  onGenresGenerated: () => void;
}

const BUTTON =
  "rounded-md border border-neutral-700 px-2.5 py-1 text-sm text-neutral-200 hover:border-green-600 hover:bg-green-600/10";

export function QuickActions({
  playlists,
  sourcePlaylistId,
  pinnedIds,
  alsoRemoveFromSource,
  onPlaylistCreated,
  onLoadSetup,
  onRemoveFromSource,
  currentTrackId,
  onGenresGenerated,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const setupsDialogRef = useRef<HTMLDialogElement>(null);
  // Genre overlays mount only while open, so each opening starts fresh.
  const [genreDialog, setGenreDialog] = useState<
    { kind: "summary" | "generate"; playlistId: string | null } | null
  >(null);
  // Followed-only playlists can't have their tracks read (Spotify 403s).
  const readablePlaylists = playlists.filter((p) => p.canModify || p.id === sourcePlaylistId);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-neutral-800 px-4 py-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
        Quick actions
      </span>
      <button
        onClick={() => dialogRef.current?.showModal()}
        className="rounded-md border border-neutral-700 px-2.5 py-1 text-sm text-neutral-200 hover:border-green-600 hover:bg-green-600/10"
      >
        + New playlist
      </button>
      <button
        onClick={() => setupsDialogRef.current?.showModal()}
        className="rounded-md border border-neutral-700 px-2.5 py-1 text-sm text-neutral-200 hover:border-green-600 hover:bg-green-600/10"
      >
        Setups
      </button>
      <button
        onClick={() => onRemoveFromSource?.()}
        disabled={!onRemoveFromSource}
        title="Remove the current track from the source playlist now and move to the next one"
        className="rounded-md border border-neutral-700 px-2.5 py-1 text-sm text-neutral-200 hover:border-red-500 hover:bg-red-600/10 hover:text-red-300 disabled:opacity-40 disabled:hover:border-neutral-700 disabled:hover:bg-transparent disabled:hover:text-neutral-200"
      >
        Remove from source
      </button>
      <button onClick={() => setGenreDialog({ kind: "summary", playlistId: sourcePlaylistId })} className={BUTTON}>
        Playlist genres
      </button>
      <button onClick={() => setGenreDialog({ kind: "generate", playlistId: sourcePlaylistId })} className={BUTTON}>
        Generate genres
      </button>
      {genreDialog?.kind === "summary" && (
        <PlaylistGenresDialog
          playlists={readablePlaylists}
          initialPlaylistId={genreDialog.playlistId}
          onClose={() => setGenreDialog(null)}
          onGenerateMissing={(playlistId) => setGenreDialog({ kind: "generate", playlistId })}
        />
      )}
      {genreDialog?.kind === "generate" && (
        <GenerateGenresDialog
          playlists={readablePlaylists}
          initialPlaylistId={genreDialog.playlistId}
          onClose={() => setGenreDialog(null)}
          currentTrackId={currentTrackId}
          sourcePlaylistId={sourcePlaylistId}
          onGenerated={onGenresGenerated}
        />
      )}
      <NewPlaylistDialog dialogRef={dialogRef} onCreated={onPlaylistCreated} />
      <SetupsDialog
        dialogRef={setupsDialogRef}
        playlists={playlists}
        sourcePlaylistId={sourcePlaylistId}
        pinnedIds={pinnedIds}
        alsoRemoveFromSource={alsoRemoveFromSource}
        onLoad={onLoadSetup}
      />
    </div>
  );
}

export function NewPlaylistDialog({
  dialogRef,
  onCreated,
  showStar = true,
}: {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  onCreated: (playlist: SpotifyPlaylist, star: boolean) => void;
  // Starring only means something in the subgenre sorter's destination panel.
  showStar?: boolean;
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
          {showStar && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={star} onChange={(e) => setStar(e.target.checked)} />
              <span>
                Star it <span className="text-yellow-400">★</span>
              </span>
            </label>
          )}
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
