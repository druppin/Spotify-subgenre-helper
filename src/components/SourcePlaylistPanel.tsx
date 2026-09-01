"use client";

import type { SpotifyPlaylistTrackItem } from "@/lib/spotify/client";

interface Props {
  tracks: SpotifyPlaylistTrackItem[];
  currentIndex: number;
  onSelect: (index: number) => void;
}

export function SourcePlaylistPanel({ tracks, currentIndex, onSelect }: Props) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <h2 className="mb-2 px-3 pt-3 text-sm font-semibold uppercase tracking-wide text-neutral-400">
        Source playlist
      </h2>
      <ul className="flex-1 overflow-y-auto">
        {tracks.map((item, index) => {
          if (!item.track) return null;
          const isCurrent = index === currentIndex;
          return (
            <li key={`${item.track.id}-${index}`}>
              <button
                onClick={() => onSelect(index)}
                className={`w-full truncate px-3 py-2 text-left text-sm ${
                  isCurrent
                    ? "bg-green-600/20 text-green-400"
                    : "text-neutral-300 hover:bg-neutral-800"
                }`}
              >
                <div className="truncate font-medium">{item.track.name}</div>
                <div className="truncate text-xs text-neutral-500">
                  {item.track.artists.map((a) => a.name).join(", ")}
                </div>
              </button>
            </li>
          );
        })}
        {tracks.length === 0 && (
          <li className="px-3 py-2 text-sm text-neutral-500">No tracks in this playlist.</li>
        )}
      </ul>
    </div>
  );
}
