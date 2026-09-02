"use client";

import type { SpotifyPlaylistTrackItem } from "@/lib/spotify/client";

interface Props {
  tracks: SpotifyPlaylistTrackItem[];
  currentIndex: number;
  onSelect: (index: number) => void;
  error?: string | null;
}

export function SourcePlaylistPanel({ tracks, currentIndex, onSelect, error }: Props) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <h2 className="mb-2 px-3 pt-3 text-sm font-semibold uppercase tracking-wide text-neutral-400">
        Source playlist
      </h2>
      {error && (
        <p className="mx-3 mb-2 rounded-md bg-red-900/30 px-2 py-1.5 text-xs text-red-400">
          {error}
        </p>
      )}
      <ul className="flex-1 overflow-y-auto">
        {tracks.map((item, index) => {
          if (!item.track) return null;
          const isCurrent = index === currentIndex;
          return (
            <li key={`${item.track.id}-${index}`}>
              <button
                onClick={() => onSelect(index)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                  isCurrent
                    ? "bg-green-600/20 text-green-400"
                    : "text-neutral-300 hover:bg-neutral-800"
                }`}
              >
                {item.track.album.images[item.track.album.images.length - 1] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.track.album.images[item.track.album.images.length - 1].url}
                    alt=""
                    className="h-10 w-10 flex-shrink-0 rounded object-cover"
                  />
                ) : (
                  <div className="h-10 w-10 flex-shrink-0 rounded bg-neutral-800" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{item.track.name}</div>
                  <div className="truncate text-xs text-neutral-500">
                    {item.track.artists.map((a) => a.name).join(", ")}
                  </div>
                </div>
              </button>
            </li>
          );
        })}
        {tracks.length === 0 && !error && (
          <li className="px-3 py-2 text-sm text-neutral-500">No tracks in this playlist.</li>
        )}
      </ul>
    </div>
  );
}
