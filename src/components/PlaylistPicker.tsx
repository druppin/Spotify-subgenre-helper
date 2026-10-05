"use client";

import { useEffect, useRef, useState } from "react";
import type { SpotifyPlaylist } from "@/lib/spotify/client";
import { PlaylistThumb } from "./PlaylistThumb";

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
        className={`flex items-center gap-2 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm hover:border-neutral-500 disabled:opacity-50 ${
          fullWidth ? "w-full" : ""
        }`}
      >
        {selected ? (
          <>
            <PlaylistThumb playlist={selected} size={24} />
            <span className={`truncate text-left ${fullWidth ? "flex-1" : "max-w-[180px]"}`}>{selected.name}</span>
          </>
        ) : (
          <span className={`text-left text-neutral-400 ${fullWidth ? "flex-1" : ""}`}>{placeholder}</span>
        )}
        <span className="text-neutral-500">▾</span>
      </button>

      {open && (
        <div
          className={`overflow-hidden rounded-md border border-neutral-700 bg-neutral-900 shadow-xl ${
            fullWidth ? "mt-1" : `absolute right-0 z-10 w-72 ${dropUp ? "bottom-full mb-1" : "mt-1"}`
          }`}
        >
          <div className="border-b border-neutral-800 p-1.5">
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
              className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm outline-none placeholder:text-neutral-500 focus:border-green-600"
            />
          </div>
          <ul className="max-h-80 overflow-y-auto">
            {visible.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => choose(p.id)}
                  className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-neutral-800 ${
                    p.id === selectedId ? "bg-green-600/20 text-green-400" : "text-neutral-200"
                  }`}
                >
                  <PlaylistThumb playlist={p} />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <span className="flex-shrink-0 text-xs text-neutral-500">{p.tracks?.total ?? "?"}</span>
                </button>
              </li>
            ))}
            {visible.length === 0 && (
              <li className="px-2 py-1.5 text-sm text-neutral-500">
                {playlists.length === 0 ? "No playlists found." : `No playlists match “${query.trim()}”.`}
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
