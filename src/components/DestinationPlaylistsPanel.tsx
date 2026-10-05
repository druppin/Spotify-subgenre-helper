"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { SpotifyPlaylist } from "@/lib/spotify/client";
import { PlaylistThumb } from "./PlaylistThumb";

interface Props {
  playlists: SpotifyPlaylist[];
  pinnedIds: string[];
  onTogglePin: (playlistId: string) => void;
  onAddToPlaylist: (playlistId: string) => Promise<void>;
  alsoRemoveFromSource: boolean;
  onAlsoRemoveFromSourceChange: (value: boolean) => void;
  onRemoveFromPlaylist: (playlistId: string) => Promise<void>;
  disabled: boolean;
  addedPlaylistIds: Set<string>;
  membershipStatus: "loading" | "ready" | "error";
}

export function DestinationPlaylistsPanel({
  playlists,
  pinnedIds,
  onTogglePin,
  onAddToPlaylist,
  onRemoveFromPlaylist,
  alsoRemoveFromSource,
  onAlsoRemoveFromSourceChange,
  disabled,
  addedPlaylistIds,
  membershipStatus,
}: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLUListElement>(null);
  const scrollTopBeforePinRef = useRef<number | null>(null);

  // Pinning moves the clicked row to the top; without this the browser's
  // scroll anchoring follows that row and yanks the list back up.
  useLayoutEffect(() => {
    if (scrollTopBeforePinRef.current === null || !listRef.current) return;
    listRef.current.scrollTop = scrollTopBeforePinRef.current;
    scrollTopBeforePinRef.current = null;
  }, [pinnedIds]);

  const handleTogglePin = (playlistId: string) => {
    scrollTopBeforePinRef.current = listRef.current?.scrollTop ?? null;
    onTogglePin(playlistId);
  };

  // Adding a track requires owning or collaborating on the destination
  // playlist — Spotify 403s otherwise — so followed-only playlists never
  // belong here.
  const modifiablePlaylists = playlists.filter((p) => p.canModify);
  // Pinned playlists float to the top (in whatever order they were pinned/
  // already in); everything else keeps its normal order below — all of it
  // always visible, so there's no separate hidden picker to dig through.
  const sorted = [...modifiablePlaylists].sort((a, b) => {
    const aPinned = pinnedIds.includes(a.id) ? 0 : 1;
    const bPinned = pinnedIds.includes(b.id) ? 0 : 1;
    return aPinned - bPinned;
  });
  const normalizedQuery = query.trim().toLowerCase();
  const visible = normalizedQuery
    ? sorted.filter((p) => p.name.toLowerCase().includes(normalizedQuery))
    : sorted;

  const handleClick = async (playlistId: string, isAdded: boolean) => {
    setBusyId(playlistId);
    try {
      if (isAdded) {
        await onRemoveFromPlaylist(playlistId);
      } else {
        await onAddToPlaylist(playlistId);
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <h2 className="px-3 pt-3 text-sm font-semibold uppercase tracking-wide text-neutral-400">
        Add to playlist
      </h2>
      {membershipStatus === "loading" && (
        <p className="px-3 pt-1 text-xs text-neutral-500">
          Checking which playlists already have this track…
        </p>
      )}
      {membershipStatus === "error" && (
        <p className="px-3 pt-1 text-xs text-red-400">
          Couldn&apos;t check which playlists already have this track.
        </p>
      )}

      <label className="flex items-center gap-2 px-3 py-2 text-xs text-neutral-400">
        <input
          type="checkbox"
          checked={alsoRemoveFromSource}
          onChange={(e) => onAlsoRemoveFromSourceChange(e.target.checked)}
        />
        Also remove from source playlist
      </label>

      <div className="px-3 pb-2">
        <div className="relative">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
            }}
            placeholder="Search playlists…"
            aria-label="Search playlists"
            className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 pr-7 text-sm outline-none placeholder:text-neutral-500 focus:border-green-600 [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white"
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <ul ref={listRef} className="flex-1 overflow-y-auto [overflow-anchor:none]">
        {visible.map((p) => {
          const isPinned = pinnedIds.includes(p.id);
          const isAdded = addedPlaylistIds.has(p.id);
          return (
            <li key={p.id} className="flex items-center gap-1 px-3 py-1">
              <button
                onClick={() => handleTogglePin(p.id)}
                onMouseDown={(e) => e.preventDefault()}
                className={`flex-shrink-0 px-1 text-lg ${
                  isPinned ? "text-yellow-400" : "text-neutral-600 hover:text-neutral-400"
                }`}
                aria-label={isPinned ? "Unpin from top" : "Pin to top"}
                title={isPinned ? "Unpin from top" : "Pin to top"}
              >
                {isPinned ? "★" : "☆"}
              </button>
              <button
                onClick={() => handleClick(p.id, isAdded)}
                disabled={disabled || busyId === p.id}
                title={isAdded ? "Click to remove the current track from this playlist" : undefined}
                className={`flex min-w-0 flex-1 items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm disabled:opacity-50 ${
                  isAdded
                    ? "border-green-500 bg-green-600/15 text-green-300 hover:border-red-500 hover:bg-red-600/10 hover:text-red-300"
                    : "border-neutral-700 text-neutral-200 hover:border-green-600 hover:bg-green-600/10"
                }`}
              >
                <PlaylistThumb playlist={p} size={32} />
                <div className="flex min-w-0 flex-1 items-center justify-between">
                  <span className="truncate">{p.name}</span>
                  {isAdded ? (
                    <span className="flex-shrink-0 text-xs font-medium">✓ Added</span>
                  ) : (
                    <span className="flex-shrink-0 text-xs text-neutral-500">
                      {p.tracks?.total ?? "?"}
                    </span>
                  )}
                </div>
              </button>
            </li>
          );
        })}
        {sorted.length > 0 && visible.length === 0 && (
          <li className="px-3 py-2 text-sm text-neutral-500">No playlists match “{query.trim()}”.</li>
        )}
        {sorted.length === 0 && (
          <li className="px-3 py-2 text-sm text-neutral-500">
            No playlists you can add to yet — you need to own or collaborate on a playlist for it
            to show up here.
          </li>
        )}
      </ul>
    </div>
  );
}
