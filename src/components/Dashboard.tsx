"use client";

import { useCallback, useEffect, useState } from "react";
import type { SpotifyPlaylist, SpotifyPlaylistTrackItem } from "@/lib/spotify/client";
import { PlayerProvider, usePlayer } from "./PlayerProvider";
import { SourcePlaylistPanel } from "./SourcePlaylistPanel";
import { NowPlayingPanel } from "./NowPlayingPanel";
import { DestinationPlaylistsPanel } from "./DestinationPlaylistsPanel";

function DashboardInner() {
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([]);
  const [sourcePlaylistId, setSourcePlaylistId] = useState<string | null>(null);
  const [sourceTracks, setSourceTracks] = useState<SpotifyPlaylistTrackItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);

  const { playTrack } = usePlayer();

  useEffect(() => {
    fetch("/api/playlists")
      .then((res) => res.json())
      .then((body) => setPlaylists(body.playlists ?? []));
  }, []);

  useEffect(() => {
    if (!sourcePlaylistId) return;
    fetch(`/api/playlists/${sourcePlaylistId}/tracks`)
      .then((res) => res.json())
      .then((body) => {
        setSourceTracks(body.items ?? []);
        setCurrentIndex(0);
      });
  }, [sourcePlaylistId]);

  const currentTrack = sourceTracks[currentIndex]?.track ?? null;

  useEffect(() => {
    if (currentTrack) {
      playTrack(currentTrack.uri).catch((err) => console.error(err));
    }
  }, [currentTrack, playTrack]);

  const togglePin = useCallback((playlistId: string) => {
    setPinnedIds((prev) =>
      prev.includes(playlistId) ? prev.filter((id) => id !== playlistId) : [...prev, playlistId]
    );
  }, []);

  const advance = useCallback(() => {
    setCurrentIndex((i) => Math.min(i + 1, sourceTracks.length - 1));
  }, [sourceTracks.length]);

  const handleAddToPlaylist = useCallback(
    async (destinationPlaylistId: string, alsoRemoveFromSource: boolean) => {
      if (!currentTrack || !sourcePlaylistId) return;

      await fetch(`/api/playlists/${destinationPlaylistId}/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackUri: currentTrack.uri }),
      });

      if (alsoRemoveFromSource) {
        await fetch(`/api/playlists/${sourcePlaylistId}/tracks`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trackUri: currentTrack.uri }),
        });
        setSourceTracks((prev) => prev.filter((_, i) => i !== currentIndex));
      } else {
        advance();
      }
    },
    [currentTrack, sourcePlaylistId, currentIndex, advance]
  );

  return (
    <div className="flex h-screen flex-col bg-neutral-950 text-white">
      <header className="flex items-center gap-3 border-b border-neutral-800 px-4 py-3">
        <h1 className="text-lg font-semibold">Spotify Subgenre Assistant</h1>
        <select
          className="ml-auto rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
          value={sourcePlaylistId ?? ""}
          onChange={(e) => setSourcePlaylistId(e.target.value || null)}
        >
          <option value="">Choose a source playlist…</option>
          {playlists.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.tracks?.total ?? "?"})
            </option>
          ))}
        </select>
      </header>

      <div className="grid flex-1 grid-cols-[260px_1fr_280px] overflow-hidden">
        <div className="border-r border-neutral-800">
          <SourcePlaylistPanel
            tracks={sourceTracks}
            currentIndex={currentIndex}
            onSelect={setCurrentIndex}
          />
        </div>

        <NowPlayingPanel key={currentTrack?.id ?? "none"} track={currentTrack} />

        <div className="border-l border-neutral-800">
          <DestinationPlaylistsPanel
            playlists={playlists}
            pinnedIds={pinnedIds}
            onTogglePin={togglePin}
            onAddToPlaylist={handleAddToPlaylist}
            disabled={!currentTrack}
          />
        </div>
      </div>
    </div>
  );
}

export function Dashboard() {
  return (
    <PlayerProvider>
      <DashboardInner />
    </PlayerProvider>
  );
}
