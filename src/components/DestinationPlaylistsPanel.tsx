"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SpotifyPlaylist } from "@/lib/spotify/client";
import { fetchPlaylistGenres, type PlaylistGenreTrack } from "@/lib/playlistGenres";
import { PlaylistThumb } from "./PlaylistThumb";

interface Props {
  playlists: SpotifyPlaylist[];
  pinnedIds: string[];
  onTogglePin: (playlistId: string) => void;
  onClearPins: () => void;
  onAddToPlaylist: (playlistId: string) => Promise<void>;
  alsoRemoveFromSource: boolean;
  onAlsoRemoveFromSourceChange: (value: boolean) => void;
  onRemoveFromPlaylist: (playlistId: string) => Promise<void>;
  disabled: boolean;
  addedPlaylistIds: Set<string>;
  membershipStatus: "loading" | "ready" | "error";
  genresVersion: number;
}

export function DestinationPlaylistsPanel({
  playlists,
  pinnedIds,
  onTogglePin,
  onClearPins,
  onAddToPlaylist,
  onRemoveFromPlaylist,
  alsoRemoveFromSource,
  onAlsoRemoveFromSourceChange,
  disabled,
  addedPlaylistIds,
  membershipStatus,
  genresVersion,
}: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLUListElement>(null);
  const scrollTopBeforePinRef = useRef<number | null>(null);

  // Pinning moves the clicked row to the top; without this the browser's
  // scroll anchoring follows that row and yanks the list back up.
  useLayoutEffect(() => {
    if (scrollTopBeforePinRef.current === null || !listRef.current) return;
    listRef.current.scrollTop = scrollTopBeforePinRef.current;
    scrollTopBeforePinRef.current = null;
  }, [pinnedIds]);

  const toggleExpanded = (playlistId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(playlistId)) next.delete(playlistId);
      else next.add(playlistId);
      return next;
    });
  };

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
      <div className="flex items-center justify-between gap-2 px-3 pt-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">Add to playlist</h2>
        {pinnedIds.length > 0 && (
          <button
            onClick={() => {
              const n = pinnedIds.length;
              if (window.confirm(`Unstar all ${n} starred playlist${n === 1 ? "" : "s"}?`)) onClearPins();
            }}
            className="text-xs text-neutral-500 hover:text-red-400"
            title="Unstar every playlist (saved setups aren't affected)"
          >
            Clear stars ({pinnedIds.length})
          </button>
        )}
      </div>
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
          const isExpanded = expandedIds.has(p.id);
          return (
            <li key={p.id} className="px-3 py-1">
              <div className="flex items-center gap-1">
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
                <button
                  onClick={() => toggleExpanded(p.id)}
                  onMouseDown={(e) => e.preventDefault()}
                  className="flex-shrink-0 px-1 text-neutral-500 hover:text-white"
                  aria-expanded={isExpanded}
                  aria-label={isExpanded ? "Hide songs and genres" : "Show songs and genres"}
                  title={isExpanded ? "Hide songs and genres" : "Show songs and genres"}
                >
                  {isExpanded ? "▾" : "▸"}
                </button>
              </div>
              {isExpanded && <PlaylistGenreList key={`${p.id}:${genresVersion}`} playlistId={p.id} />}
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

type GenreListState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; tracks: PlaylistGenreTrack[] };

// Remounted (via key) when genres are regenerated, so the initial state is
// all the reset it needs.
function PlaylistGenreList({ playlistId }: { playlistId: string }) {
  const [state, setState] = useState<GenreListState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetchPlaylistGenres(playlistId)
      .then((tracks) => !cancelled && setState({ status: "ready", tracks }))
      .catch((err) => !cancelled && setState({ status: "error", message: String(err.message ?? err) }));
    return () => {
      cancelled = true;
    };
  }, [playlistId]);

  if (state.status === "loading") {
    return <p className="py-1.5 pl-9 text-xs text-neutral-500">Loading songs…</p>;
  }
  if (state.status === "error") {
    return <p className="py-1.5 pl-9 text-xs text-red-400">{state.message}</p>;
  }
  if (state.tracks.length === 0) {
    return <p className="py-1.5 pl-9 text-xs text-neutral-500">No songs in this playlist.</p>;
  }
  return (
    <ul className="mt-1 max-h-72 space-y-1 overflow-y-auto border-l border-neutral-800 py-1 pl-3 ml-4">
      {state.tracks.map((t, i) => (
        <li key={`${t.id}-${i}`} className="text-xs">
          <div className="truncate text-neutral-300" title={`${t.name} — ${t.artists.join(", ")}`}>
            {t.name} <span className="text-neutral-500">— {t.artists.join(", ")}</span>
          </div>
          {t.subgenres && t.subgenres.length > 0 && (
            <div className="mt-0.5 flex flex-wrap gap-1">
              {t.subgenres.map((g) => (
                <span key={g} className="rounded-full bg-green-600/15 px-1.5 py-px text-[10px] text-green-400">
                  {g}
                </span>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
