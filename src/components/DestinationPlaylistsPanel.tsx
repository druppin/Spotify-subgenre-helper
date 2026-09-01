"use client";

import { useState } from "react";
import type { SpotifyPlaylist } from "@/lib/spotify/client";

interface Props {
  playlists: SpotifyPlaylist[];
  pinnedIds: string[];
  onTogglePin: (playlistId: string) => void;
  onAddToPlaylist: (playlistId: string, alsoRemoveFromSource: boolean) => Promise<void>;
  disabled: boolean;
}

export function DestinationPlaylistsPanel({
  playlists,
  pinnedIds,
  onTogglePin,
  onAddToPlaylist,
  disabled,
}: Props) {
  const [alsoRemove, setAlsoRemove] = useState(false);
  const [showAllPicker, setShowAllPicker] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const pinned = playlists.filter((p) => pinnedIds.includes(p.id));

  const handleAdd = async (playlistId: string) => {
    setBusyId(playlistId);
    try {
      await onAddToPlaylist(playlistId, alsoRemove);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between px-3 pt-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
          Add to playlist
        </h2>
        <button
          onClick={() => setShowAllPicker((v) => !v)}
          className="text-xs text-neutral-500 hover:text-neutral-300"
        >
          {showAllPicker ? "Hide" : "Pin more…"}
        </button>
      </div>

      <label className="flex items-center gap-2 px-3 py-2 text-xs text-neutral-400">
        <input
          type="checkbox"
          checked={alsoRemove}
          onChange={(e) => setAlsoRemove(e.target.checked)}
        />
        Also remove from source playlist
      </label>

      {showAllPicker && (
        <ul className="max-h-40 overflow-y-auto border-b border-neutral-800">
          {playlists.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => onTogglePin(p.id)}
                className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm text-neutral-300 hover:bg-neutral-800"
              >
                <span className="truncate">{p.name}</span>
                <span className="text-xs text-neutral-500">
                  {pinnedIds.includes(p.id) ? "Unpin" : "Pin"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <ul className="flex-1 overflow-y-auto">
        {pinned.map((p) => (
          <li key={p.id} className="px-3 py-2">
            <button
              onClick={() => handleAdd(p.id)}
              disabled={disabled || busyId === p.id}
              className="w-full rounded-md border border-neutral-700 px-3 py-2 text-left text-sm text-neutral-200 hover:border-green-600 hover:bg-green-600/10 disabled:opacity-50"
            >
              <div className="flex items-center justify-between">
                <span className="truncate">{p.name}</span>
                <span className="text-xs text-neutral-500">{p.tracks?.total ?? "?"}</span>
              </div>
            </button>
          </li>
        ))}
        {pinned.length === 0 && (
          <li className="px-3 py-2 text-sm text-neutral-500">
            No playlists pinned yet. Use &quot;Pin more…&quot; above to add some.
          </li>
        )}
      </ul>
    </div>
  );
}
