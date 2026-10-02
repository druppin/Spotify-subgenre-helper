"use client";

import { useState, type FormEvent, type RefObject } from "react";
import type { SpotifyPlaylist } from "@/lib/spotify/client";
import { loadSetups, saveSetups, type Setup } from "@/lib/setups";

interface Props {
  dialogRef: RefObject<HTMLDialogElement | null>;
  playlists: SpotifyPlaylist[];
  sourcePlaylistId: string | null;
  pinnedIds: string[];
  onLoad: (setup: Setup) => void;
}

export function SetupsDialog({ dialogRef, playlists, sourcePlaylistId, pinnedIds, onLoad }: Props) {
  const [setups, setSetups] = useState<Setup[]>(loadSetups);
  const [title, setTitle] = useState("");
  const [includeSource, setIncludeSource] = useState(true);

  const playlistName = (id: string | null) =>
    id ? (playlists.find((p) => p.id === id)?.name ?? "Unknown playlist") : null;

  const sourceName = playlistName(sourcePlaylistId);
  const trimmedTitle = title.trim();
  const existing = setups.find((s) => s.title.toLowerCase() === trimmedTitle.toLowerCase());

  const update = (next: Setup[]) => {
    setSetups(next);
    saveSetups(next);
  };

  const handleSave = (e: FormEvent) => {
    e.preventDefault();
    if (!trimmedTitle) return;
    const setup: Setup = {
      id: existing?.id ?? crypto.randomUUID(),
      title: trimmedTitle,
      sourcePlaylistId: includeSource ? sourcePlaylistId : null,
      pinnedIds: [...pinnedIds],
      savedAt: Date.now(),
    };
    update(existing ? setups.map((s) => (s.id === existing.id ? setup : s)) : [setup, ...setups]);
    setTitle("");
  };

  // A setup saved without a source playlist stays source-less; one saved
  // with a source takes the current one (or keeps its own if none is open).
  const handleUpdate = (setup: Setup) => {
    const nextSourceId = setup.sourcePlaylistId === null ? null : (sourcePlaylistId ?? setup.sourcePlaylistId);
    const nextSourceName = playlistName(nextSourceId);
    const summary =
      `${pinnedIds.length} starred playlist${pinnedIds.length === 1 ? "" : "s"}` +
      (nextSourceName ? ` and source playlist "${nextSourceName}"` : "");
    if (!window.confirm(`Update "${setup.title}" with your current ${summary}?`)) return;
    update(
      setups.map((s) =>
        s.id === setup.id
          ? { ...s, sourcePlaylistId: nextSourceId, pinnedIds: [...pinnedIds], savedAt: Date.now() }
          : s
      )
    );
  };

  const handleRename = (setup: Setup) => {
    const next = window.prompt("Rename setup", setup.title)?.trim().slice(0, 80);
    if (!next || next === setup.title) return;
    const clash = setups.find((s) => s.id !== setup.id && s.title.toLowerCase() === next.toLowerCase());
    if (clash) {
      window.alert(`A setup named "${clash.title}" already exists.`);
      return;
    }
    update(setups.map((s) => (s.id === setup.id ? { ...s, title: next } : s)));
  };

  const handleDelete = (setup: Setup) => {
    if (!window.confirm(`Delete setup "${setup.title}"?`)) return;
    update(setups.filter((s) => s.id !== setup.id));
  };

  const handleLoad = (setup: Setup) => {
    onLoad(setup);
    dialogRef.current?.close();
  };

  return (
    <dialog
      ref={dialogRef}
      className="m-auto w-full max-w-lg rounded-lg border border-neutral-700 bg-neutral-900 p-0 text-white backdrop:bg-black/60"
    >
      <div className="space-y-5 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Setups</h2>
          <button
            onClick={() => dialogRef.current?.close()}
            className="text-neutral-500 hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-2 rounded-md border border-neutral-800 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Save current setup
          </p>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={80}
            placeholder="Title, e.g. House sorting"
            className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm outline-none focus:border-green-600"
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeSource && sourcePlaylistId !== null}
              disabled={sourcePlaylistId === null}
              onChange={(e) => setIncludeSource(e.target.checked)}
            />
            <span className={sourcePlaylistId === null ? "text-neutral-500" : ""}>
              Include source playlist
              {sourceName ? <span className="text-neutral-400"> ({sourceName})</span> : " (none selected)"}
            </span>
          </label>
          <div className="flex items-center justify-between">
            <span className="text-xs text-neutral-500">
              {pinnedIds.length} starred playlist{pinnedIds.length === 1 ? "" : "s"}
            </span>
            <button
              type="submit"
              disabled={!trimmedTitle}
              className="rounded-md bg-green-600 px-3 py-1 text-sm font-semibold text-white disabled:opacity-50"
            >
              {existing ? "Overwrite" : "Save"}
            </button>
          </div>
        </form>

        <ul className="max-h-80 space-y-2 overflow-y-auto">
          {setups.map((setup) => {
            const name = playlistName(setup.sourcePlaylistId);
            return (
              <li
                key={setup.id}
                className="flex items-center gap-3 rounded-md border border-neutral-800 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{setup.title}</p>
                  <p className="truncate text-xs text-neutral-500">
                    {name ? `Source: ${name}` : "No source playlist"} · {setup.pinnedIds.length} starred ·{" "}
                    {new Date(setup.savedAt).toLocaleDateString()}
                  </p>
                </div>
                <button
                  onClick={() => handleLoad(setup)}
                  className="rounded-md border border-neutral-700 px-2.5 py-1 text-sm hover:border-green-600 hover:bg-green-600/10"
                >
                  Load
                </button>
                <button
                  onClick={() => handleUpdate(setup)}
                  title="Replace this setup's starred playlists (and source, if it has one) with your current ones"
                  className="text-sm text-neutral-400 hover:text-green-400"
                >
                  Update
                </button>
                <button
                  onClick={() => handleRename(setup)}
                  className="text-sm text-neutral-400 hover:text-white"
                >
                  Rename
                </button>
                <button
                  onClick={() => handleDelete(setup)}
                  className="text-sm text-neutral-500 hover:text-red-400"
                  aria-label={`Delete ${setup.title}`}
                >
                  Delete
                </button>
              </li>
            );
          })}
          {setups.length === 0 && (
            <li className="text-sm text-neutral-500">
              No saved setups yet. Star some playlists, give it a title, and save.
            </li>
          )}
        </ul>
      </div>
    </dialog>
  );
}
