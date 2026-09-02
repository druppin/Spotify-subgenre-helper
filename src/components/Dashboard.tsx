"use client";

import { useCallback, useEffect, useState } from "react";
import type { SpotifyPlaylist, SpotifyPlaylistTrackItem } from "@/lib/spotify/client";
import { PlayerProvider, usePlayer } from "./PlayerProvider";
import { SourcePlaylistPanel } from "./SourcePlaylistPanel";
import { NowPlayingPanel } from "./NowPlayingPanel";
import { DestinationPlaylistsPanel } from "./DestinationPlaylistsPanel";
import { PlaylistPicker } from "./PlaylistPicker";

function DashboardInner() {
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([]);
  const [sourcePlaylistId, setSourcePlaylistId] = useState<string | null>(null);
  const [sourceTracks, setSourceTracks] = useState<SpotifyPlaylistTrackItem[]>([]);
  const [sourceTracksError, setSourceTracksError] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  // A track "add"ed with "also remove from source" checked doesn't get
  // removed right away — the same track might still get added to a second
  // or third destination playlist while it's showing. The actual removal
  // is deferred until the user navigates to a different track (or a
  // different source playlist), tracked here by the pending track's URI.
  const [pendingRemovalUri, setPendingRemovalUri] = useState<string | null>(null);
  // Which destination playlists each track has been added to this session —
  // keyed by track id so the "already added" cue is still there if the user
  // navigates back to a track they already filed somewhere.
  const [addedPlaylistIdsByTrack, setAddedPlaylistIdsByTrack] = useState<Record<string, string[]>>({});

  const { playTrack } = usePlayer();

  useEffect(() => {
    fetch("/api/playlists")
      .then((res) => res.json())
      .then((body) => setPlaylists(body.playlists ?? []));
  }, []);

  useEffect(() => {
    if (!sourcePlaylistId) return;
    fetch(`/api/playlists/${sourcePlaylistId}/tracks`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) {
          setSourceTracks([]);
          setSourceTracksError(body.error ?? "Failed to load this playlist's tracks.");
          return;
        }
        setSourceTracksError(null);
        setSourceTracks(body.items ?? []);
        setCurrentIndex(0);
      })
      .catch((err) => setSourceTracksError(String(err)));
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

  // Actually removes the pending track from the source playlist (Spotify +
  // local state) against `fromPlaylistId` — the playlist that was current
  // when it was marked, which may differ from sourcePlaylistId by the time
  // this runs if the user has since switched source playlists. Returns the
  // resulting tracks array so navigation math can be computed against it
  // synchronously rather than racing the next render.
  const flushPendingRemoval = useCallback(
    (tracks: SpotifyPlaylistTrackItem[], fromPlaylistId: string | null): SpotifyPlaylistTrackItem[] => {
      if (!pendingRemovalUri || !fromPlaylistId) return tracks;
      const uri = pendingRemovalUri;
      setPendingRemovalUri(null);
      fetch(`/api/playlists/${fromPlaylistId}/tracks`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackUri: uri }),
      }).catch((err) => console.error("Failed to remove track from source playlist:", err));
      return tracks.filter((item) => item.track?.uri !== uri);
    },
    [pendingRemovalUri]
  );

  const goNext = useCallback(() => {
    const hadPending = pendingRemovalUri !== null;
    const tracks = flushPendingRemoval(sourceTracks, sourcePlaylistId);
    setSourceTracks(tracks);
    // If the current track just got removed, whatever was after it slides
    // into its old position — so the target is the same index, not +1.
    const target = hadPending ? currentIndex : currentIndex + 1;
    setCurrentIndex(Math.max(Math.min(target, tracks.length - 1), 0));
  }, [sourceTracks, sourcePlaylistId, currentIndex, pendingRemovalUri, flushPendingRemoval]);

  const goPrevious = useCallback(() => {
    const tracks = flushPendingRemoval(sourceTracks, sourcePlaylistId);
    setSourceTracks(tracks);
    // Removing the current track never shifts indices before it.
    setCurrentIndex(Math.max(Math.min(currentIndex - 1, tracks.length - 1), 0));
  }, [sourceTracks, sourcePlaylistId, currentIndex, flushPendingRemoval]);

  const selectTrack = useCallback(
    (clickedIndex: number) => {
      if (clickedIndex === currentIndex) return;
      const hadPending = pendingRemovalUri !== null;
      const tracks = flushPendingRemoval(sourceTracks, sourcePlaylistId);
      setSourceTracks(tracks);
      const adjusted = hadPending && clickedIndex > currentIndex ? clickedIndex - 1 : clickedIndex;
      setCurrentIndex(Math.max(Math.min(adjusted, tracks.length - 1), 0));
    },
    [sourceTracks, sourcePlaylistId, currentIndex, pendingRemovalUri, flushPendingRemoval]
  );

  const selectSourcePlaylist = useCallback(
    (newId: string) => {
      // Flush against the playlist being left, not the one being entered.
      flushPendingRemoval(sourceTracks, sourcePlaylistId);
      setSourcePlaylistId(newId);
    },
    [sourceTracks, sourcePlaylistId, flushPendingRemoval]
  );

  const handleAddToPlaylist = useCallback(
    async (destinationPlaylistId: string, alsoRemoveFromSource: boolean) => {
      if (!currentTrack) return;

      await fetch(`/api/playlists/${destinationPlaylistId}/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackUri: currentTrack.uri }),
      });

      setAddedPlaylistIdsByTrack((prev) => ({
        ...prev,
        [currentTrack.id]: [...(prev[currentTrack.id] ?? []), destinationPlaylistId],
      }));

      if (alsoRemoveFromSource) {
        setPendingRemovalUri(currentTrack.uri);
      }
    },
    [currentTrack]
  );

  const handleRemoveFromPlaylist = useCallback(
    async (destinationPlaylistId: string) => {
      if (!currentTrack) return;

      await fetch(`/api/playlists/${destinationPlaylistId}/tracks`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackUri: currentTrack.uri }),
      });

      setAddedPlaylistIdsByTrack((prev) => ({
        ...prev,
        [currentTrack.id]: (prev[currentTrack.id] ?? []).filter((id) => id !== destinationPlaylistId),
      }));
    },
    [currentTrack]
  );

  const addedPlaylistIds = new Set(currentTrack ? addedPlaylistIdsByTrack[currentTrack.id] : undefined);

  return (
    <div className="flex h-screen flex-col bg-neutral-950 text-white">
      <header className="flex items-center gap-3 border-b border-neutral-800 px-4 py-3">
        <h1 className="text-lg font-semibold">Spotify Subgenre Assistant</h1>
        <div className="ml-auto">
          <PlaylistPicker
            playlists={playlists}
            selectedId={sourcePlaylistId}
            onSelect={selectSourcePlaylist}
          />
        </div>
      </header>

      <div className="grid flex-1 grid-cols-[260px_1fr_280px] overflow-hidden">
        <div className="min-h-0 overflow-hidden border-r border-neutral-800">
          <SourcePlaylistPanel
            tracks={sourceTracks}
            currentIndex={currentIndex}
            onSelect={selectTrack}
            error={sourceTracksError}
            pendingRemovalUri={pendingRemovalUri}
          />
        </div>

        <div className="min-h-0 overflow-hidden">
          <NowPlayingPanel
            key={currentTrack?.id ?? "none"}
            track={currentTrack}
            onPrevious={goPrevious}
            onNext={goNext}
            canGoPrevious={currentIndex > 0}
            canGoNext={currentIndex < sourceTracks.length - 1 || pendingRemovalUri !== null}
          />
        </div>

        <div className="min-h-0 overflow-hidden border-l border-neutral-800">
          <DestinationPlaylistsPanel
            playlists={playlists}
            pinnedIds={pinnedIds}
            onTogglePin={togglePin}
            onAddToPlaylist={handleAddToPlaylist}
            onRemoveFromPlaylist={handleRemoveFromPlaylist}
            disabled={!currentTrack}
            addedPlaylistIds={addedPlaylistIds}
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
