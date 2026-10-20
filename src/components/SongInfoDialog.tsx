"use client";

import { useEffect, useRef, useState } from "react";
import type { LibraryTrackDetails } from "@/lib/library";
import type { ReleaseInfo } from "@/lib/releaseInfo";
import type { SpotifyTrack } from "@/lib/spotify/client";
import { CloseIcon } from "./Icons";
import { NowPlayingPanel } from "./NowPlayingPanel";

/**
 * A song from My library in the Subgenre sorter's view (cover, player, AI
 * genres, tags, chat and the data behind them), without the playlists to
 * file it into. Previous and next step through the list it was opened from.
 */
export function SongInfoDialog({
  uri,
  details,
  onPrevious,
  onNext,
  canGoPrevious,
  canGoNext,
  onClose,
}: {
  uri: string;
  details: LibraryTrackDetails;
  onPrevious: () => void;
  onNext: () => void;
  canGoPrevious: boolean;
  canGoNext: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // The library only keeps a small cover per song; the release's large one
  // is looked up for this view.
  const [largeImage, setLargeImage] = useState<{ uri: string; url: string } | null>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/versions/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uris: [uri] }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { info: Record<string, ReleaseInfo> } | null) => {
        const url = body?.info[uri]?.image;
        if (!cancelled && url) setLargeImage({ uri, url });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [uri]);

  const image = largeImage?.uri === uri ? largeImage.url : details.image;
  const track: SpotifyTrack = {
    id: uri.split(":")[2] ?? uri,
    uri,
    name: details.name,
    artists: details.artists.map((name) => ({ id: "", name })),
    album: { id: "", name: "", images: image ? [{ url: image, width: null, height: null }] : [], release_date: "" },
    duration_ms: details.durationMs,
    explicit: false,
  };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-label={details.name}
      className="m-auto flex h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-line-strong bg-ground p-0 text-ink backdrop:bg-black/60"
    >
      <button
        type="button"
        onClick={() => ref.current?.close()}
        aria-label="Close"
        className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-raised hover:text-ink"
      >
        <CloseIcon size={16} />
      </button>
      <div className="min-h-0 flex-1">
        <NowPlayingPanel
          key={uri}
          track={track}
          onPrevious={onPrevious}
          onNext={onNext}
          canGoPrevious={canGoPrevious}
          canGoNext={canGoNext}
          ownPlayback
        />
      </div>
    </dialog>
  );
}
