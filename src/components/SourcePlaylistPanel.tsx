"use client";

import type { SpotifyPlaylistTrackItem } from "@/lib/spotify/client";
import { ConfidenceMeter } from "./GenreTagEditor";
import { CheckIcon } from "./Icons";

export type SourceSort = "playlist" | "least-confident" | "most-confident";

interface Props {
  tracks: SpotifyPlaylistTrackItem[];
  currentIndex: number;
  onSelect: (index: number) => void;
  error?: string | null;
  pendingRemovalUri?: string | null;
  otherPlaylistCounts: Map<string, number>;
  // Average tag confidence per track ID; null or missing when not scored.
  confidences: Record<string, number | null>;
  sort: SourceSort;
  onSortChange: (sort: SourceSort) => void;
}

export function SourcePlaylistPanel({
  tracks,
  currentIndex,
  onSelect,
  error,
  pendingRemovalUri,
  otherPlaylistCounts,
  confidences,
  sort,
  onSortChange,
}: Props) {
  const scored = tracks.filter((item) => item.track && (confidences[item.track.id] ?? null) !== null).length;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="mb-2 flex items-center justify-between gap-2 px-3 pt-3">
        <h2 className="font-narrow text-base font-bold">Source playlist</h2>
        <select
          value={sort}
          onChange={(e) => onSortChange(e.target.value as SourceSort)}
          aria-label="Order of the source playlist"
          title="Songs with no confidence score go last"
          className="min-w-0 rounded-md border border-line-strong bg-panel px-1.5 py-1 text-xs text-ink"
        >
          <option value="playlist">Playlist order</option>
          <option value="least-confident">Least confident first</option>
          <option value="most-confident">Most confident first</option>
        </select>
      </div>
      {sort !== "playlist" && tracks.length > 0 && scored < tracks.length && (
        <p className="mx-3 mb-2 text-[11px] text-muted">
          {scored === 0 ? "No songs here have" : `Only ${scored} of ${tracks.length} songs have`} confidence scores
          yet, so the rest stay in playlist order at the end. Score them with the Generate genres button, or by opening each
          song.
        </p>
      )}
      {error && (
        <p className="mx-3 mb-2 rounded-md bg-danger/15 px-2 py-1.5 text-xs text-danger">
          {error}
        </p>
      )}
      <ul className="flex-1 overflow-y-auto px-1.5 pb-2">
        {tracks.map((item, index) => {
          if (!item.track) return null;
          const isCurrent = index === currentIndex;
          const inOtherPlaylists = otherPlaylistCounts.get(item.track.uri) ?? 0;
          const confidence = confidences[item.track.id] ?? null;
          return (
            <li key={`${item.track.id}-${index}`}>
              <button
                onClick={() => onSelect(index)}
                className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm ${
                  isCurrent ? "bg-raised font-semibold text-ink" : "text-ink hover:bg-panel"
                }`}
              >
                {item.track.album.images[item.track.album.images.length - 1] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.track.album.images[item.track.album.images.length - 1].url}
                    alt=""
                    className="h-9 w-9 flex-shrink-0 rounded object-cover"
                  />
                ) : (
                  <div className="h-9 w-9 flex-shrink-0 rounded bg-raised" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate">{item.track.name}</div>
                  <div className="truncate text-xs font-normal text-muted">
                    {item.track.artists.map((a) => a.name).join(", ")}
                  </div>
                  {item.track.uri === pendingRemovalUri && (
                    <div className="truncate text-[10px] text-warn">
                      Leaving source playlist when you move on…
                    </div>
                  )}
                </div>
                {confidence !== null && <ConfidenceMeter score={confidence} width={48} stacked />}
                {inOtherPlaylists > 0 && (
                  <span
                    className="flex-shrink-0 rounded border border-line-strong px-1 py-px text-[10px] font-medium text-muted"
                    title={`Already in ${inOtherPlaylists} of your other playlist${inOtherPlaylists === 1 ? "" : "s"}`}
                  >
                    <span className="inline-flex items-center gap-0.5"><CheckIcon size={10} />{inOtherPlaylists}</span>
                  </span>
                )}
              </button>
            </li>
          );
        })}
        {tracks.length === 0 && !error && (
          <li className="px-3 py-2 text-sm text-muted">No tracks in this playlist.</li>
        )}
      </ul>
    </div>
  );
}
