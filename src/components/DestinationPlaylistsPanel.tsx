"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SpotifyPlaylist } from "@/lib/spotify/client";
import { fetchPlaylistGenres, type PlaylistGenreTrack } from "@/lib/playlistGenres";
import { PlaylistThumb } from "./PlaylistThumb";
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, CloseIcon, StarIcon } from "./Icons";
import { FAMILY_NAMES, familyMark, familyOf, familyTab, type GenreFamily } from "@/lib/genreFamily";

// How far each starred divider's tab sits from the left, staggered like
// dividers in a record bin.
const DIVIDER_OFFSETS = [0, 48, 96, 24, 72];

interface GenreSummary {
  top: string[];
  family: GenreFamily;
}

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
  // The playlist a song was just filed into, for its drop animation.
  const [droppedId, setDroppedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);
  // Each playlist's top genres and genre family, from the saved library.
  const [summaries, setSummaries] = useState<Record<string, GenreSummary>>({});

  useEffect(() => {
    let cancelled = false;
    fetch("/api/playlist-genre-summary")
      .then((res) => res.json())
      .then((body) => !cancelled && body.summaries && setSummaries(body.summaries))
      .catch((err) => console.error("Failed to load playlist genres:", err));
    return () => {
      cancelled = true;
    };
  }, [genresVersion]);
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
        setDroppedId(playlistId);
        setTimeout(() => setDroppedId((id) => (id === playlistId ? null : id)), 250);
      }
    } finally {
      setBusyId(null);
    }
  };

  const starred = visible.filter((p) => pinnedIds.includes(p.id));
  const others = visible.filter((p) => !pinnedIds.includes(p.id));

  const addButton = (p: SpotifyPlaylist, compact: boolean) => {
    const isAdded = addedPlaylistIds.has(p.id);
    return (
      <button
        onClick={() => handleClick(p.id, isAdded)}
        disabled={disabled || busyId === p.id}
        title={isAdded ? `In ${p.name}. Click to take this song out again.` : `Add this song to ${p.name}`}
        className={`group/add flex flex-shrink-0 items-center justify-center gap-1 rounded-md font-semibold disabled:opacity-50 ${
          compact ? "h-6 w-[4.25rem] text-xs" : "h-7 w-[4.5rem] text-[12.5px]"
        } ${
          isAdded
            ? "border border-line-strong text-muted hover:border-danger hover:text-danger"
            : compact
              ? "border border-line-strong text-ink hover:border-ink hover:bg-ink hover:text-ground"
              : "bg-ink text-ground hover:bg-ink-2"
        }`}
      >
        {isAdded ? (
          <>
            <CheckIcon size={13} className="group-hover/add:hidden" />
            <span className="group-hover/add:hidden">Added</span>
            <span className="hidden group-hover/add:inline">Remove</span>
          </>
        ) : (
          "Add"
        )}
      </button>
    );
  };

  const starButton = (p: SpotifyPlaylist) => {
    const isPinned = pinnedIds.includes(p.id);
    return (
      <button
        onClick={() => handleTogglePin(p.id)}
        onMouseDown={(e) => e.preventDefault()}
        className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded ${
          isPinned ? "text-warn" : "text-faint hover:text-ink"
        }`}
        aria-label={isPinned ? `Unstar ${p.name}` : `Star ${p.name}`}
        title={isPinned ? "Unstar: move back to all playlists" : "Star: file it under a divider at the top"}
      >
        <StarIcon size={15} filled={isPinned} />
      </button>
    );
  };

  const expandButton = (p: SpotifyPlaylist) => {
    const isExpanded = expandedIds.has(p.id);
    return (
      <button
        onClick={() => toggleExpanded(p.id)}
        onMouseDown={(e) => e.preventDefault()}
        className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-muted hover:text-ink"
        aria-expanded={isExpanded}
        aria-label={isExpanded ? `Hide songs in ${p.name}` : `Show songs in ${p.name}`}
        title={isExpanded ? "Hide songs and genres" : "Show songs and genres"}
      >
        {isExpanded ? <ChevronDownIcon size={15} /> : <ChevronRightIcon size={15} />}
      </button>
    );
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-side">
      <div className="space-y-2 px-3.5 pb-2 pt-3.5">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-narrow text-base font-bold">File it under</h2>
          {pinnedIds.length > 0 && (
            <button
              onClick={() => {
                const n = pinnedIds.length;
                if (window.confirm(`Unstar all ${n} starred playlist${n === 1 ? "" : "s"}?`)) onClearPins();
              }}
              className="text-xs text-muted hover:text-danger"
              title="Unstar every playlist (saved setups aren't affected)"
            >
              Clear stars ({pinnedIds.length})
            </button>
          )}
        </div>
        <label className="flex items-center gap-2 text-[12.5px] text-muted">
          <input
            type="checkbox"
            checked={alsoRemoveFromSource}
            onChange={(e) => onAlsoRemoveFromSourceChange(e.target.checked)}
            className="accent-band"
          />
          Also remove from the source playlist
        </label>
        <div className="relative">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
            }}
            placeholder={`Find a playlist (${modifiablePlaylists.length})`}
            aria-label="Find a playlist"
            className="w-full rounded-md border border-line bg-ground px-2.5 py-1.5 pr-8 text-[13px] outline-none placeholder:text-faint focus:border-ink-2 [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-ink"
              aria-label="Clear search"
            >
              <CloseIcon size={14} />
            </button>
          )}
        </div>
        {membershipStatus === "loading" && (
          <p className="text-xs text-muted">Checking which playlists already have this song…</p>
        )}
        {membershipStatus === "error" && (
          <p className="text-xs text-danger">Couldn&apos;t check which playlists already have this song.</p>
        )}
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto pb-3 [overflow-anchor:none]">
        {starred.length > 0 && (
          <>
            <p className="px-3.5 pb-1.5 pt-1 text-xs font-semibold text-muted">Starred</p>
            <ul className="space-y-1.5 px-3.5">
              {starred.map((p, index) => {
                const summary = summaries[p.id];
                const family = summary?.family ?? "none";
                const offset = DIVIDER_OFFSETS[index % DIVIDER_OFFSETS.length];
                const isAdded = addedPlaylistIds.has(p.id);
                return (
                  <li key={p.id}>
                    <span
                      className="font-narrow inline-block max-w-[80%] truncate rounded-t-[5px] px-2.5 pb-px pt-0.5 align-bottom text-xs font-bold text-[#1a1613]"
                      style={{ marginLeft: offset, background: familyTab(family) }}
                      title={`${p.name}: mostly ${FAMILY_NAMES[family].toLowerCase()}`}
                    >
                      {p.name}
                    </span>
                    <div
                      className={`flex items-center gap-2 border-t-2 py-1.5 pl-1.5 pr-1 ${isAdded ? "bg-raised" : "bg-panel"} ${
                        offset === 0 ? "rounded-b-md rounded-tr-md" : "rounded-md"
                      } ${droppedId === p.id ? "file-drop" : ""}`}
                      style={{ borderTopColor: familyTab(family), ["--drop" as string]: familyTab(family) }}
                    >
                      <PlaylistThumb playlist={p} size={32} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12.5px] text-ink-2">
                          {summary?.top.length ? summary.top.join(", ") : "No genres yet"}
                        </div>
                        <div className="text-[11.5px] text-muted">{p.tracks?.total ?? "?"} songs</div>
                      </div>
                      {addButton(p, false)}
                      {expandButton(p)}
                      {starButton(p)}
                    </div>
                    {expandedIds.has(p.id) && <PlaylistGenreList key={`${p.id}:${genresVersion}`} playlistId={p.id} />}
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {others.length > 0 && (
          <>
            <p className="px-3.5 pb-1 pt-3 text-xs font-semibold text-muted">
              {starred.length > 0 || query ? "All playlists" : "Your playlists"}
            </p>
            <ul className="px-2">
              {others.map((p) => {
                const family = summaries[p.id]?.family ?? "none";
                return (
                  <li key={p.id}>
                    <div
                      className={`flex h-9 items-center gap-2 rounded-md px-1.5 hover:bg-panel ${
                        droppedId === p.id ? "file-drop" : ""
                      }`}
                      style={{ ["--drop" as string]: familyTab(family) }}
                    >
                      {starButton(p)}
                      <PlaylistThumb playlist={p} size={26} />
                      <span
                        className="h-2 w-2 flex-shrink-0 rounded-full"
                        style={{ background: familyMark(family) }}
                        title={family === "none" ? "No genres yet" : `Mostly ${FAMILY_NAMES[family].toLowerCase()}`}
                      />
                      <span className="min-w-0 flex-1 truncate text-[13px]" title={summaries[p.id]?.top.join(", ")}>
                        {p.name}
                      </span>
                      <span className="w-9 flex-shrink-0 text-right text-[11.5px] text-muted">{p.tracks?.total ?? "?"}</span>
                      {addButton(p, true)}
                      {expandButton(p)}
                    </div>
                    {expandedIds.has(p.id) && <PlaylistGenreList key={`${p.id}:${genresVersion}`} playlistId={p.id} />}
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {sorted.length > 0 && visible.length === 0 && (
          <p className="px-3.5 py-2 text-sm text-muted">No playlists match “{query.trim()}”.</p>
        )}
        {sorted.length === 0 && (
          <p className="px-3.5 py-2 text-sm text-muted">
            No playlists you can add to yet. You need to own or collaborate on a playlist for it to show up here.
          </p>
        )}
      </div>
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
    return <p className="py-1.5 pl-9 text-xs text-muted">Loading songs…</p>;
  }
  if (state.status === "error") {
    return <p className="py-1.5 pl-9 text-xs text-danger">{state.message}</p>;
  }
  if (state.tracks.length === 0) {
    return <p className="py-1.5 pl-9 text-xs text-muted">No songs in this playlist.</p>;
  }
  return (
    <ul className="mt-1 max-h-72 space-y-1 overflow-y-auto border-l border-line py-1 pl-3 ml-4">
      {state.tracks.map((t, i) => (
        <li key={`${t.id}-${i}`} className="text-xs">
          <div className="truncate text-ink-2" title={`${t.name} — ${t.artists.join(", ")}`}>
            {t.name} <span className="text-muted">— {t.artists.join(", ")}</span>
          </div>
          {t.subgenres && t.subgenres.length > 0 && (
            <div className="mt-0.5 flex flex-wrap gap-x-2.5 gap-y-0.5">
              {t.subgenres.map((g) => (
                <span key={g} className="inline-flex items-center gap-1 text-[11px] text-ink-2">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: familyMark(familyOf(g)) }} />
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
