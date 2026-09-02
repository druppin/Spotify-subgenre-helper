"use client";

import { useEffect, useRef, useState } from "react";
import type { SpotifyPlaylist } from "@/lib/spotify/client";
import { PlaylistThumb } from "./PlaylistThumb";

interface Props {
  playlists: SpotifyPlaylist[];
  selectedId: string | null;
  onSelect: (playlistId: string) => void;
}

export function PlaylistPicker({ playlists, selectedId, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = playlists.find((p) => p.id === selectedId) ?? null;

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm hover:border-neutral-500"
      >
        {selected ? (
          <>
            <PlaylistThumb playlist={selected} size={24} />
            <span className="max-w-[180px] truncate">{selected.name}</span>
          </>
        ) : (
          <span className="text-neutral-400">Choose a source playlist…</span>
        )}
        <span className="text-neutral-500">▾</span>
      </button>

      {open && (
        <ul className="absolute right-0 z-10 mt-1 max-h-80 w-72 overflow-y-auto rounded-md border border-neutral-700 bg-neutral-900 shadow-xl">
          {playlists.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => {
                  onSelect(p.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-neutral-800 ${
                  p.id === selectedId ? "bg-green-600/20 text-green-400" : "text-neutral-200"
                }`}
              >
                <PlaylistThumb playlist={p} />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                <span className="flex-shrink-0 text-xs text-neutral-500">
                  {p.tracks?.total ?? "?"}
                </span>
              </button>
            </li>
          ))}
          {playlists.length === 0 && (
            <li className="px-2 py-1.5 text-sm text-neutral-500">No playlists found.</li>
          )}
        </ul>
      )}
    </div>
  );
}
