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
  // null when the current track isn't in any of the user's playlists.
  onRemoveFromAll: (() => void) | null;
  removeFromAllCount: number;
  currentTrackId: string | null;
  onGenresGenerated: () => void;
  aiOff: boolean;
  onToggleAi: () => void;
}

const BUTTON =
  "rounded-md border border-line-strong px-3 py-1.5 text-[13px] font-medium text-ink hover:border-ink-2 hover:bg-raised";

export function QuickActions({
  playlists,
  sourcePlaylistId,
  pinnedIds,
  alsoRemoveFromSource,
  onPlaylistCreated,
  onLoadSetup,
  onRemoveFromSource,
  onRemoveFromAll,
  removeFromAllCount,
  currentTrackId,
  onGenresGenerated,
  aiOff,
  onToggleAi,
}: Props) {
  // Removing from every playlist can't be undone here, so it asks first.
  const [confirmingAll, setConfirmingAll] = useState(false);
  // Moving to another song drops the question.
  const [confirmTrackId, setConfirmTrackId] = useState(currentTrackId);
  if (confirmTrackId !== currentTrackId) {
    setConfirmTrackId(currentTrackId);
    setConfirmingAll(false);
  }
  const dialogRef = useRef<HTMLDialogElement>(null);
  const setupsDialogRef = useRef<HTMLDialogElement>(null);
  // Genre overlays mount only while open, so each opening starts fresh.
  const [genreDialog, setGenreDialog] = useState<
    { kind: "summary" | "generate"; playlistId: string | null } | null
  >(null);
  // Followed-only playlists can't have their tracks read (Spotify 403s).
  const readablePlaylists = playlists.filter((p) => p.canModify || p.id === sourcePlaylistId);

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-2.5">
      <button
        onClick={() => dialogRef.current?.showModal()}
        className="rounded-md border border-line-strong px-3 py-1.5 text-[13px] font-medium text-ink hover:border-ink-2 hover:bg-raised"
      >
        New playlist
      </button>
      <button
        onClick={() => setupsDialogRef.current?.showModal()}
        className="rounded-md border border-line-strong px-3 py-1.5 text-[13px] font-medium text-ink hover:border-ink-2 hover:bg-raised"
      >
        Setups
      </button>
      <button onClick={() => setGenreDialog({ kind: "summary", playlistId: sourcePlaylistId })} className={BUTTON}>
        Playlist genres
      </button>
      <button onClick={() => setGenreDialog({ kind: "generate", playlistId: sourcePlaylistId })} className={BUTTON}>
        Generate genres
      </button>
      <button
        onClick={onToggleAi}
        aria-pressed={aiOff}
        title={
          aiOff
            ? "AI is off: songs show just the player, for quick sorting. Click to turn it back on."
            : "Turn off the AI summary, genre tags and chat for each song, for quick sorting"
        }
        className={aiOff ? `${BUTTON} border-ink-2 bg-raised` : BUTTON}
      >
        {aiOff ? "AI off" : "AI on"}
      </button>
      <button
        onClick={() => onRemoveFromSource?.()}
        disabled={!onRemoveFromSource}
        title="Remove the current track from the source playlist now and move to the next one"
        className="ml-auto rounded-md border border-danger/50 px-3 py-1.5 text-[13px] font-medium text-danger hover:bg-danger/10 disabled:opacity-40 disabled:hover:bg-transparent"
      >
        Remove from source
      </button>
      {confirmingAll && onRemoveFromAll ? (
        <span className="flex items-center gap-1.5 text-[13px]" role="group" aria-label="Confirm removing from all playlists">
          <span className="text-danger">
            Remove from {removeFromAllCount} playlist{removeFromAllCount === 1 ? "" : "s"}?
          </span>
          <button
            autoFocus
            onClick={() => {
              setConfirmingAll(false);
              onRemoveFromAll?.();
            }}
            className="rounded-md border border-danger bg-danger/15 px-3 py-1.5 font-medium text-danger hover:bg-danger/25"
          >
            Remove
          </button>
          <button onClick={() => setConfirmingAll(false)} className={BUTTON}>
            Cancel
          </button>
        </span>
      ) : (
        <button
          onClick={() => setConfirmingAll(true)}
          disabled={!onRemoveFromAll}
          title={
            onRemoveFromAll
              ? `Remove the current track from all ${removeFromAllCount} of your playlists it's in (not Liked Songs) and move to the next one`
              : "The current track isn't in any of your playlists"
          }
          className="rounded-md border border-danger/50 px-3 py-1.5 text-[13px] font-medium text-danger hover:bg-danger/10 disabled:opacity-40 disabled:hover:bg-transparent"
        >
          Remove from all playlists
        </button>
      )}
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
      className="m-auto w-full max-w-md rounded-lg border border-line-strong bg-panel p-0 text-ink backdrop:bg-black/60"
    >
      <form onSubmit={handleSubmit} className="space-y-4 p-5">
        <h2 className="text-lg font-semibold">New playlist</h2>

        <label className="block space-y-1">
          <span className="text-xs text-muted">Name</span>
          <input
            autoFocus
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My playlist"
            className="w-full rounded-md border border-line-strong bg-ground px-2 py-1.5 text-sm outline-none focus:border-ink-2"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-xs text-muted">Description (optional)</span>
          <textarea
            maxLength={300}
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add an optional description"
            className="w-full resize-none rounded-md border border-line-strong bg-ground px-2 py-1.5 text-sm outline-none focus:border-ink-2"
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
            <span className={collaborative ? "text-muted" : ""}>Public</span>
            {collaborative && (
              <span className="text-xs text-muted">(collaborative playlists are always private)</span>
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
                Star it
              </span>
            </label>
          )}
        </div>

        {error && <p className="text-xs text-danger">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={close}
            className="rounded-md px-3 py-1.5 text-sm text-ink-2 hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !name.trim()}
            className="rounded-md bg-ink px-4 py-1.5 text-sm font-semibold text-ground disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
