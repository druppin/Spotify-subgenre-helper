"use client";

import type { SpotifyPlaylist } from "@/lib/spotify/client";

export function PlaylistThumb({
  playlist,
  size = 32,
}: {
  playlist: SpotifyPlaylist;
  size?: number;
}) {
  const image = playlist.images?.[playlist.images.length - 1];
  if (!image) {
    return (
      <div className="flex-shrink-0 rounded bg-neutral-800" style={{ width: size, height: size }} />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={image.url}
      alt=""
      className="flex-shrink-0 rounded object-cover"
      style={{ width: size, height: size }}
    />
  );
}
