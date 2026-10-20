"use client";

import { useEffect, useRef, useState } from "react";
import type { SpotifyPlaylist } from "@/lib/spotify/client";
import { PlaylistThumb } from "./PlaylistThumb";
import { ChevronDownIcon } from "./Icons";

interface Props {
  playlists: SpotifyPlaylist[];
  selectedId: string | null;
  onSelect: (playlistId: string) => void;
  placeholder?: string;
  // Stretch to the container's width and open the list in place (pushing
  // content down) instead of floating — for use inside scrolling dialogs,
  // where a floating list would be clipped.
  fullWidth?: boolean;
  disabled?: boolean;
  // Open the floating list above the button, for pickers at the bottom of
  // the screen.
  dropUp?: boolean;
}

export function PlaylistPicker({
  playlists,
  selectedId,
  onSelect,
  placeholder = "Choose a source playlist…",
  fullWidth = false,
  disabled = false,
  dropUp = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = playlists.find((p) => p.id === selectedId) ?? null;

  const normalizedQuery = query.trim().toLowerCase();
  const visible = normalizedQuery
    ? playlists.filter((p) => p.name.toLowerCase().includes(normalizedQuery))
    : playlists;

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  const choose = (playlistId: string) => {
    onSelect(playlistId);
    close();
  };

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  return (
    <div ref={rootRef} className={`relative ${fullWidth ? "w-full" : ""}`}>
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        disabled={disabled}
        className={`flex items-center gap-2 rounded-md border border-line-strong bg-panel px-2 py-1.5 text-sm hover:border-muted disabled:opacity-50 ${
          fullWidth ? "w-full" : ""
        }`}
      >
        {selected ? (
          <>
            <PlaylistThumb playlist={selected} size={24} />
            <span className={`truncate text-left ${fullWidth ? "flex-1" : "max-w-[180px]"}`}>{selected.name}</span>
          </>
        ) : (
          <span className={`text-left text-muted ${fullWidth ? "flex-1" : ""}`}>{placeholder}</span>
        )}
        <span className="text-muted"><ChevronDownIcon size={14} /></span>
      </button>

      {open && (
        <div
          className={`overflow-hidden rounded-md border border-line-strong bg-panel shadow-xl ${
            fullWidth ? "mt-1" : `absolute right-0 z-10 w-72 ${dropUp ? "bottom-full mb-1" : "mt-1"}`
          }`}
        >
          <div className="border-b border-line p-1.5">
            <input
              autoFocus
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  // Keep Escape from also closing an enclosing <dialog>.
                  e.preventDefault();
                  e.stopPropagation();
                  close();
                } else if (e.key === "Enter" && visible[0]) {
                  e.preventDefault();
                  choose(visible[0].id);
                }
              }}
              placeholder="Search playlists…"
              aria-label="Search playlists"
              className="w-full rounded border border-line-strong bg-ground px-2 py-1 text-sm outline-none placeholder:text-faint focus:border-ink-2"
            />
          </div>
          <ul className="max-h-80 overflow-y-auto">
            {visible.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => choose(p.id)}
                  className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-raised ${
                    p.id === selectedId ? "bg-raised text-ink" : "text-ink"
                  }`}
                >
                  <PlaylistThumb playlist={p} />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <span className="flex-shrink-0 text-xs text-muted">{p.tracks?.total ?? "?"}</span>
                </button>
              </li>
            ))}
            {visible.length === 0 && (
              <li className="px-2 py-1.5 text-sm text-muted">
                {playlists.length === 0 ? "No playlists found." : `No playlists match “${query.trim()}”.`}
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
