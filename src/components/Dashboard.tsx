"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { SpotifyPlaylist, SpotifyPlaylistTrackItem } from "@/lib/spotify/client";
import { usePlayer, type SpotifyPlayerTrack } from "./PlayerProvider";
import { SourcePlaylistPanel, type SourceSort } from "./SourcePlaylistPanel";
import { NowPlayingPanel } from "./NowPlayingPanel";
import { DestinationPlaylistsPanel } from "./DestinationPlaylistsPanel";
import { PlaylistPicker } from "./PlaylistPicker";
import { QuickActions } from "./QuickActions";
import { loadLastSession, saveLastSession, type Setup } from "@/lib/setups";

const SOURCE_SORT_STORAGE_KEY = "sorter.sourceSort";

function loadSourceSort(): SourceSort {
  try {
    const saved = localStorage.getItem(SOURCE_SORT_STORAGE_KEY);
    if (saved === "least-confident" || saved === "most-confident") return saved;
  } catch {
    // Storage unavailable — playlist order it is.
  }
  return "playlist";
}

const AI_OFF_STORAGE_KEY = "sorter.aiOff";

function loadAiOff(): boolean {
  try {
    return localStorage.getItem(AI_OFF_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

// Each song's average tag confidence (null when its tags aren't scored),
// for the songs that have genre info.
async function fetchConfidences(trackIds: string[]): Promise<Record<string, number | null>> {
  const res = await fetch("/api/track-genres", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: trackIds }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return Object.fromEntries(
    Object.entries(body.genres as Record<string, { songConfidence: number | null }>).map(([id, g]) => [
      id,
      g.songConfidence,
    ])
  );
}

// The tracks in `sort` order; playlistOrder is how the playlist itself has
// them. Songs with no score go last, in playlist order.
function sortTracks(
  tracks: SpotifyPlaylistTrackItem[],
  sort: SourceSort,
  confidences: Record<string, number | null>,
  playlistOrder: SpotifyPlaylistTrackItem[]
): SpotifyPlaylistTrackItem[] {
  const position = new Map(playlistOrder.map((item, i) => [item, i]));
  const byPlaylist = (a: SpotifyPlaylistTrackItem, b: SpotifyPlaylistTrackItem) =>
    (position.get(a) ?? 0) - (position.get(b) ?? 0);
  if (sort === "playlist") return [...tracks].sort(byPlaylist);
  const direction = sort === "least-confident" ? 1 : -1;
  const score = (item: SpotifyPlaylistTrackItem) => (item.track ? (confidences[item.track.id] ?? null) : null);
  return [...tracks].sort((a, b) => {
    const x = score(a);
    const y = score(b);
    if (x === null || y === null) return (x === null ? 1 : 0) - (y === null ? 1 : 0) || byPlaylist(a, b);
    return (x - y) * direction || byPlaylist(a, b);
  });
}

// A song as the player reports it, in the shape the sorter's lists use.
function toTrackItem(track: SpotifyPlayerTrack & { id: string }): SpotifyPlaylistTrackItem {
  return {
    added_at: "",
    track: {
      id: track.id,
      uri: track.uri,
      name: track.name,
      artists: track.artists.map((a) => ({ id: "", name: a.name })),
      album: {
        id: "",
        name: track.album.name,
        images: track.album.images.map((i) => ({ url: i.url, width: null, height: null })),
        release_date: "",
      },
      duration_ms: track.duration_ms,
      explicit: false,
    },
  };
}

// The subgenre sorting view. Rendered inside AppShell, which provides the
// player and the tab bar shown in this view's header.
export function Dashboard({ tabs }: { tabs: ReactNode }) {
  // Only ever mounted client-side (AuthGate renders it after a fetch), so
  // reading localStorage in the initializer can't cause a hydration mismatch.
  const [initialSession] = useState(loadLastSession);
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([]);
  const [playlistsLoaded, setPlaylistsLoaded] = useState(false);
  const [sourcePlaylistId, setSourcePlaylistId] = useState<string | null>(initialSession.sourcePlaylistId);
  const [sourceTracks, setSourceTracks] = useState<SpotifyPlaylistTrackItem[]>([]);
  const [sourceTracksError, setSourceTracksError] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [pinnedIds, setPinnedIds] = useState<string[]>(initialSession.pinnedIds);
  const [alsoRemoveFromSource, setAlsoRemoveFromSource] = useState(initialSession.alsoRemoveFromSource);
  // A track "add"ed with "also remove from source" checked doesn't get
  // removed right away — the same track might still get added to a second
  // or third destination playlist while it's showing. The actual removal
  // is deferred until the user navigates to a different track (or a
  // different source playlist), tracked here by the pending track's URI.
  const [pendingRemovalUri, setPendingRemovalUri] = useState<string | null>(null);
  // Track URIs in each playlist the user can add to, from the server-side
  // playlist index, kept current locally as tracks are added/removed here.
  const [playlistIndex, setPlaylistIndex] = useState<Record<string, Set<string>>>({});
  const [playlistIndexStatus, setPlaylistIndexStatus] = useState<"loading" | "ready" | "error">("loading");
  // Bumped after genres are generated so expanded playlist genre lists reload.
  const [genresVersion, setGenresVersion] = useState(0);
  const [sourceSort, setSourceSort] = useState<SourceSort>(loadSourceSort);
  // Quick sorting: no AI summary, lookups or chat per song, just the player.
  const [aiOff, setAiOff] = useState(loadAiOff);
  const toggleAi = useCallback(() => {
    setAiOff((off) => {
      try {
        localStorage.setItem(AI_OFF_STORAGE_KEY, String(!off));
      } catch {
        // Not remembering it is fine.
      }
      return !off;
    });
  }, []);
  // Read by the playlist load without making the sort a reason to reload.
  const sourceSortRef = useRef(sourceSort);
  // Average tag confidence per source track ID.
  const [confidences, setConfidences] = useState<Record<string, number | null>>({});
  // The source playlist's own order, to go back to from a confidence sort.
  const playlistOrderRef = useRef<SpotifyPlaylistTrackItem[]>([]);

  const { ready, playTrack, onTrackEnd, playContext, skip, currentTrack: playerTrack, contextUri, playbackError } =
    usePlayer();
  // Listen mode: Spotify won't let the app read the songs of a playlist the
  // user doesn't own, so the sorter plays it and follows whatever plays.
  // sourceTracks then holds the songs heard so far.
  const isListenPlaylist = useCallback(
    (playlistId: string | null) => playlists.find((p) => p.id === playlistId)?.canModify === false,
    [playlists]
  );
  const listening = isListenPlaylist(sourcePlaylistId);
  const listenContext = sourcePlaylistId ? `spotify:playlist:${sourcePlaylistId}` : null;
  const [heardUri, setHeardUri] = useState<string | null>(null);
  // Spotify doesn't always say what it's playing from; only a song from
  // somewhere else is left out.
  const fromListenContext = contextUri === null || contextUri === listenContext;
  if (listening && playerTrack?.id && fromListenContext && playerTrack.uri !== heardUri) {
    setHeardUri(playerTrack.uri);
    const found = sourceTracks.findIndex((item) => item.track?.uri === playerTrack.uri);
    if (found >= 0) {
      setCurrentIndex(found);
    } else {
      setSourceTracks([...sourceTracks, toTrackItem({ ...playerTrack, id: playerTrack.id })]);
      setCurrentIndex(sourceTracks.length);
    }
  }

  useEffect(() => {
    if (listening && ready && listenContext) {
      playContext(listenContext).catch((err) => console.error(err));
    }
  }, [listening, ready, listenContext, playContext]);

  useEffect(() => {
    // Cached membership for every playlist, refreshing only the starred
    // destinations (the ones whose marks matter most) if they've changed —
    // loading the sorter shouldn't cost a whole library scan.
    const sync = initialSession.pinnedIds.join(",");
    fetch(`/api/playlist-index${sync ? `?sync=${encodeURIComponent(sync)}` : ""}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        const index: Record<string, Set<string>> = {};
        for (const [playlistId, uris] of Object.entries(body.index as Record<string, string[]>)) {
          index[playlistId] = new Set(uris);
        }
        // Keep tracks added here while the index was still loading. (A
        // removal made in that window can reappear until the next reload.)
        setPlaylistIndex((prev) => {
          for (const [playlistId, uris] of Object.entries(prev)) {
            index[playlistId] = new Set([...(index[playlistId] ?? []), ...uris]);
          }
          return index;
        });
        setPlaylistIndexStatus("ready");
      })
      .catch((err) => {
        console.error("Failed to load playlist index:", err);
        setPlaylistIndexStatus("error");
      });
  }, [initialSession]);

  const setMembership = useCallback((playlistId: string, uri: string, present: boolean) => {
    setPlaylistIndex((prev) => {
      const next = new Set(prev[playlistId]);
      if (present) next.add(uri);
      else next.delete(uri);
      return { ...prev, [playlistId]: next };
    });
  }, []);

  // Where to resume within the restored source playlist; consumed by the
  // first successful track load of that playlist.
  const resumeRef = useRef(
    initialSession.sourcePlaylistId && initialSession.currentTrackUri
      ? {
          playlistId: initialSession.sourcePlaylistId,
          uri: initialSession.currentTrackUri,
          index: initialSession.currentIndex,
        }
      : null
  );

  // Keeps the song counts shown next to playlists current as tracks are
  // added/removed here, without refetching the playlist list.
  const adjustTrackCount = useCallback((playlistId: string, delta: number) => {
    setPlaylists((prev) =>
      prev.map((p) =>
        p.id === playlistId && p.tracks ? { ...p, tracks: { total: Math.max(0, p.tracks.total + delta) } } : p
      )
    );
  }, []);

  useEffect(() => {
    fetch("/api/playlists")
      .then((res) => res.json())
      .then((body) => setPlaylists(body.playlists ?? []))
      .finally(() => setPlaylistsLoaded(true));
  }, []);

  useEffect(() => {
    // Waits for the playlist list, which says whether this one is readable.
    if (!sourcePlaylistId || !playlistsLoaded || listening) return;
    // Ignore a response for a playlist the user has already moved off of
    // (and the effect double-run in dev, which would otherwise consume the
    // resume point on the discarded fetch).
    let cancelled = false;
    fetch(`/api/playlists/${sourcePlaylistId}/tracks`)
      .then(async (res) => {
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setSourceTracks([]);
          setSourceTracksError(body.error ?? "Failed to load this playlist's tracks.");
          return;
        }
        const loadedItems: SpotifyPlaylistTrackItem[] = body.items ?? [];
        playlistOrderRef.current = loadedItems;
        // Scores come from the app's own database; without them the
        // playlist still loads, just in its own order.
        const ids = [...new Set(loadedItems.flatMap((item) => (item.track ? [item.track.id] : [])))];
        const scores = await fetchConfidences(ids).catch((err) => {
          console.error("Failed to load tag confidence:", err);
          return {};
        });
        if (cancelled) return;
        setConfidences(scores);
        const items = sortTracks(loadedItems, sourceSortRef.current, scores, loadedItems);
        let index = 0;
        const resume = resumeRef.current;
        resumeRef.current = null;
        if (resume && resume.playlistId === sourcePlaylistId) {
          const found = items.findIndex((item) => item.track?.uri === resume.uri);
          index = found >= 0 ? found : Math.min(resume.index, Math.max(items.length - 1, 0));
        }
        setSourceTracksError(null);
        setSourceTracks(items);
        setCurrentIndex(index);
      })
      .catch((err) => {
        if (!cancelled) setSourceTracksError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [sourcePlaylistId, playlistsLoaded, listening]);

  const currentTrack = sourceTracks[currentIndex]?.track ?? null;

  // Re-sorts right away, staying on the same song.
  const changeSourceSort = (sort: SourceSort) => {
    setSourceSort(sort);
    sourceSortRef.current = sort;
    try {
      localStorage.setItem(SOURCE_SORT_STORAGE_KEY, sort);
    } catch {
      // Not remembering the sort is fine.
    }
    const sorted = sortTracks(sourceTracks, sort, confidences, playlistOrderRef.current);
    const current = sourceTracks[currentIndex];
    setSourceTracks(sorted);
    setCurrentIndex(Math.max(sorted.indexOf(current), 0));
  };

  // Keeps a song's score current after it's scored or its tags are edited.
  // The list isn't re-sorted, so songs don't jump around while sorting.
  const handleConfidenceChange = useCallback((trackId: string, confidence: number | null) => {
    setConfidences((prev) => (prev[trackId] === confidence ? prev : { ...prev, [trackId]: confidence }));
  }, []);

  // Picks up scores from bulk generation.
  useEffect(() => {
    if (genresVersion === 0) return;
    const ids = [...new Set(playlistOrderRef.current.flatMap((item) => (item.track ? [item.track.id] : [])))];
    fetchConfidences(ids)
      .then(setConfidences)
      .catch((err) => console.error("Failed to reload tag confidence:", err));
  }, [genresVersion]);

  useEffect(() => {
    // Until the restored playlist's tracks arrive there's no current track —
    // keep the saved resume point instead of overwriting it with nothing.
    const resume = resumeRef.current;
    saveLastSession({
      sourcePlaylistId,
      pinnedIds,
      alsoRemoveFromSource,
      currentTrackUri: currentTrack?.uri ?? resume?.uri ?? null,
      currentIndex: currentTrack ? currentIndex : (resume?.index ?? 0),
    });
  }, [sourcePlaylistId, pinnedIds, alsoRemoveFromSource, currentTrack, currentIndex]);

  // A removal deferred until "next track" would otherwise be lost if the tab
  // closes first. keepalive lets the request outlive the page.
  const pendingRemovalRef = useRef({ uri: pendingRemovalUri, playlistId: sourcePlaylistId });
  useEffect(() => {
    pendingRemovalRef.current = { uri: pendingRemovalUri, playlistId: sourcePlaylistId };
  }, [pendingRemovalUri, sourcePlaylistId]);
  useEffect(() => {
    const onPageHide = () => {
      const { uri, playlistId } = pendingRemovalRef.current;
      if (!uri || !playlistId) return;
      fetch(`/api/playlists/${playlistId}/tracks`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackUri: uri, source: "sorter" }),
        keepalive: true,
      });
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, []);

  // Waits for the player to be ready: a restored session loads its source
  // playlist's tracks before the Web Playback SDK has connected.
  useEffect(() => {
    if (currentTrack && ready && !listening) {
      console.debug("[skip] current track effect → playTrack", currentTrack.uri, currentTrack.name);
      playTrack(currentTrack.uri).catch((err) => console.error(err));
    }
  }, [currentTrack, ready, listening, playTrack]);

  const togglePin = useCallback((playlistId: string) => {
    setPinnedIds((prev) =>
      prev.includes(playlistId) ? prev.filter((id) => id !== playlistId) : [...prev, playlistId]
    );
  }, []);

  const handlePlaylistCreated = useCallback((playlist: SpotifyPlaylist, star: boolean) => {
    setPlaylists((prev) => [playlist, ...prev]);
    setPlaylistIndex((prev) => ({ ...prev, [playlist.id]: new Set() }));
    if (star) setPinnedIds((prev) => [...prev, playlist.id]);
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
        body: JSON.stringify({ trackUri: uri, source: "sorter" }),
      }).catch((err) => console.error("Failed to remove track from source playlist:", err));
      setMembership(fromPlaylistId, uri, false);
      const remaining = tracks.filter((item) => item.track?.uri !== uri);
      // Removing by URI drops every copy of the track, not just one.
      adjustTrackCount(fromPlaylistId, remaining.length - tracks.length);
      return remaining;
    },
    [pendingRemovalUri, setMembership, adjustTrackCount]
  );

  const goNext = useCallback(() => {
    if (listening) {
      skip("next");
      return;
    }
    const hadPending = pendingRemovalUri !== null;
    const tracks = flushPendingRemoval(sourceTracks, sourcePlaylistId);
    setSourceTracks(tracks);
    // If the current track just got removed, whatever was after it slides
    // into its old position — so the target is the same index, not +1.
    const target = hadPending ? currentIndex : currentIndex + 1;
    const nextIndex = Math.max(Math.min(target, tracks.length - 1), 0);
    console.debug("[skip] goNext", {
      fromIndex: currentIndex,
      fromUri: sourceTracks[currentIndex]?.track?.uri,
      pendingRemovalUri,
      tracksBefore: sourceTracks.length,
      tracksAfter: tracks.length,
      toIndex: nextIndex,
      toUri: tracks[nextIndex]?.track?.uri,
    });
    setCurrentIndex(nextIndex);
  }, [listening, skip, sourceTracks, sourcePlaylistId, currentIndex, pendingRemovalUri, flushPendingRemoval]);

  useEffect(() => {
    onTrackEnd((uri) => {
      if (uri === currentTrack?.uri) goNext();
    });
    return () => onTrackEnd(null);
  }, [onTrackEnd, currentTrack, goNext]);

  const goPrevious = useCallback(() => {
    if (listening) {
      skip("previous");
      return;
    }
    const tracks = flushPendingRemoval(sourceTracks, sourcePlaylistId);
    setSourceTracks(tracks);
    // Removing the current track never shifts indices before it.
    setCurrentIndex(Math.max(Math.min(currentIndex - 1, tracks.length - 1), 0));
  }, [listening, skip, sourceTracks, sourcePlaylistId, currentIndex, flushPendingRemoval]);

  const selectTrack = useCallback(
    (clickedIndex: number) => {
      if (clickedIndex === currentIndex) return;
      const uri = sourceTracks[clickedIndex]?.track?.uri;
      if (listening) {
        if (uri && listenContext) playContext(listenContext, uri).catch((err) => console.error(err));
        setCurrentIndex(clickedIndex);
        return;
      }
      const hadPending = pendingRemovalUri !== null;
      const tracks = flushPendingRemoval(sourceTracks, sourcePlaylistId);
      setSourceTracks(tracks);
      const adjusted = hadPending && clickedIndex > currentIndex ? clickedIndex - 1 : clickedIndex;
      setCurrentIndex(Math.max(Math.min(adjusted, tracks.length - 1), 0));
    },
    [listening, listenContext, playContext, sourceTracks, sourcePlaylistId, currentIndex, pendingRemovalUri, flushPendingRemoval]
  );

  const selectSourcePlaylist = useCallback(
    (newId: string) => {
      // Flush against the playlist being left, not the one being entered.
      flushPendingRemoval(sourceTracks, sourcePlaylistId);
      setSourcePlaylistId(newId);
      if (isListenPlaylist(newId)) {
        // Starts an empty list of songs heard.
        setSourceTracks([]);
        setSourceTracksError(null);
        setCurrentIndex(0);
        // The song already playing isn't from this playlist.
        setHeardUri(playerTrack?.uri ?? null);
      }
    },
    [sourceTracks, sourcePlaylistId, flushPendingRemoval, isListenPlaylist, playerTrack]
  );

  const loadSetup = useCallback(
    (setup: Setup) => {
      setPinnedIds(setup.pinnedIds);
      if (setup.alsoRemoveFromSource !== undefined) setAlsoRemoveFromSource(setup.alsoRemoveFromSource);
      if (setup.sourcePlaylistId && setup.sourcePlaylistId !== sourcePlaylistId) {
        selectSourcePlaylist(setup.sourcePlaylistId);
      }
    },
    [sourcePlaylistId, selectSourcePlaylist]
  );

  // Unlike the deferred "also remove" checkbox, this removes right away and
  // moves on — whatever was after the track slides into its position.
  const removeCurrentFromSource = useCallback(() => {
    if (!currentTrack || !sourcePlaylistId) return;
    const uri = currentTrack.uri;
    setPendingRemovalUri(null);
    fetch(`/api/playlists/${sourcePlaylistId}/tracks`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trackUri: uri, source: "sorter" }),
    }).catch((err) => console.error("Failed to remove track from source playlist:", err));
    setMembership(sourcePlaylistId, uri, false);
    const tracks = sourceTracks.filter((item) => item.track?.uri !== uri);
    adjustTrackCount(sourcePlaylistId, tracks.length - sourceTracks.length);
    setSourceTracks(tracks);
    setCurrentIndex(Math.max(Math.min(currentIndex, tracks.length - 1), 0));
  }, [currentTrack, sourcePlaylistId, sourceTracks, currentIndex, setMembership, adjustTrackCount]);

  // Every editable playlist the current track is in, per the cached index
  // (plus the source, whose tracks are loaded right here).
  const currentPlaylistIds = useMemo(() => {
    if (!currentTrack) return [];
    const ids = Object.keys(playlistIndex).filter((id) => playlistIndex[id].has(currentTrack.uri));
    const sourceEditable = playlists.find((p) => p.id === sourcePlaylistId)?.canModify;
    if (sourcePlaylistId && sourceEditable && !ids.includes(sourcePlaylistId)) ids.push(sourcePlaylistId);
    return ids;
  }, [currentTrack, playlistIndex, playlists, sourcePlaylistId]);

  // Like "Remove from source", but from every playlist at once.
  const removeCurrentFromAll = useCallback(() => {
    if (!currentTrack) return;
    const uri = currentTrack.uri;
    setPendingRemovalUri(null);
    for (const playlistId of currentPlaylistIds) {
      fetch(`/api/playlists/${playlistId}/tracks`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackUri: uri, source: "sorter" }),
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(await res.text());
          setMembership(playlistId, uri, false);
          if (playlistId !== sourcePlaylistId) adjustTrackCount(playlistId, -1);
        })
        .catch((err) => console.error(`Failed to remove track from playlist ${playlistId}:`, err));
    }
    if (sourcePlaylistId && currentPlaylistIds.includes(sourcePlaylistId)) {
      const tracks = sourceTracks.filter((item) => item.track?.uri !== uri);
      adjustTrackCount(sourcePlaylistId, tracks.length - sourceTracks.length);
      setSourceTracks(tracks);
      setCurrentIndex(Math.max(Math.min(currentIndex, tracks.length - 1), 0));
    } else if (listening) {
      skip("next");
    } else {
      setCurrentIndex(Math.min(currentIndex + 1, sourceTracks.length - 1));
    }
  }, [currentTrack, currentPlaylistIds, sourcePlaylistId, listening, skip, sourceTracks, currentIndex, setMembership, adjustTrackCount]);

  const handleAddToPlaylist = useCallback(
    async (destinationPlaylistId: string) => {
      if (!currentTrack) return;

      const res = await fetch(`/api/playlists/${destinationPlaylistId}/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackUri: currentTrack.uri, source: "sorter" }),
      });
      if (!res.ok) {
        console.error("Failed to add track to playlist:", await res.text());
        return;
      }

      setMembership(destinationPlaylistId, currentTrack.uri, true);
      adjustTrackCount(destinationPlaylistId, 1);

      if (alsoRemoveFromSource && !listening) {
        setPendingRemovalUri(currentTrack.uri);
      }
    },
    [currentTrack, alsoRemoveFromSource, listening, setMembership, adjustTrackCount]
  );

  const handleRemoveFromPlaylist = useCallback(
    async (destinationPlaylistId: string) => {
      if (!currentTrack) return;

      const res = await fetch(`/api/playlists/${destinationPlaylistId}/tracks`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackUri: currentTrack.uri, source: "sorter" }),
      });
      if (!res.ok) {
        console.error("Failed to remove track from playlist:", await res.text());
        return;
      }

      setMembership(destinationPlaylistId, currentTrack.uri, false);
      // Assumes one copy; a duplicate elsewhere in the playlist would also be
      // removed but isn't counted here.
      adjustTrackCount(destinationPlaylistId, -1);
    },
    [currentTrack, setMembership, adjustTrackCount]
  );

  const addedPlaylistIds = new Set(
    currentTrack
      ? Object.keys(playlistIndex).filter((id) => playlistIndex[id].has(currentTrack.uri))
      : []
  );

  // How many playlists (other than the source itself) each source track is
  // already in.
  const otherPlaylistCounts = useMemo(() => {
    const counts = new Map<string, number>();
    const others = Object.entries(playlistIndex).filter(([id]) => id !== sourcePlaylistId);
    for (const item of sourceTracks) {
      const uri = item.track?.uri;
      if (!uri || counts.has(uri)) continue;
      counts.set(uri, others.filter(([, uris]) => uris.has(uri)).length);
    }
    return counts;
  }, [playlistIndex, sourcePlaylistId, sourceTracks]);

  return (
    <div className="flex h-screen flex-col bg-ground text-ink">
      <header className="band flex items-center gap-3 px-4 py-2.5">
        {tabs}
        <div className="ml-auto">
          <PlaylistPicker
            playlists={playlists}
            selectedId={sourcePlaylistId}
            onSelect={selectSourcePlaylist}
          />
        </div>
      </header>

      <div className="grid flex-1 grid-cols-[280px_1fr_340px] overflow-hidden">
        <div className="min-h-0 overflow-hidden border-r border-line">
          <SourcePlaylistPanel
            tracks={sourceTracks}
            currentIndex={currentIndex}
            onSelect={selectTrack}
            error={listening ? playbackError : sourceTracksError}
            pendingRemovalUri={pendingRemovalUri}
            otherPlaylistCounts={otherPlaylistCounts}
            confidences={confidences}
            sort={sourceSort}
            onSortChange={changeSourceSort}
            listening={listening}
          />
        </div>

        <div className="flex min-h-0 flex-col overflow-hidden">
          <QuickActions
            playlists={playlists}
            sourcePlaylistId={sourcePlaylistId}
            pinnedIds={pinnedIds}
            alsoRemoveFromSource={alsoRemoveFromSource}
            onPlaylistCreated={handlePlaylistCreated}
            onLoadSetup={loadSetup}
            onRemoveFromSource={currentTrack && !listening ? removeCurrentFromSource : null}
            onRemoveFromAll={currentPlaylistIds.length > 0 ? removeCurrentFromAll : null}
            removeFromAllCount={currentPlaylistIds.length}
            currentTrackId={currentTrack?.id ?? null}
            onGenresGenerated={() => setGenresVersion((v) => v + 1)}
            aiOff={aiOff}
            onToggleAi={toggleAi}
          />
          <div className="min-h-0 flex-1 overflow-hidden">
            <NowPlayingPanel
              key={currentTrack?.id ?? "none"}
              track={currentTrack}
              onPrevious={goPrevious}
              onNext={goNext}
              canGoPrevious={listening || currentIndex > 0}
              canGoNext={listening || currentIndex < sourceTracks.length - 1 || pendingRemovalUri !== null}
              onConfidenceChange={handleConfidenceChange}
              emptyText={listening ? "Starting the playlist…" : undefined}
              aiOff={aiOff}
            />
          </div>
        </div>

        <div className="min-h-0 overflow-hidden border-l border-line">
          <DestinationPlaylistsPanel
            playlists={playlists}
            pinnedIds={pinnedIds}
            onTogglePin={togglePin}
            onClearPins={() => setPinnedIds([])}
            onAddToPlaylist={handleAddToPlaylist}
            onRemoveFromPlaylist={handleRemoveFromPlaylist}
            alsoRemoveFromSource={alsoRemoveFromSource}
            onAlsoRemoveFromSourceChange={setAlsoRemoveFromSource}
            disabled={!currentTrack}
            addedPlaylistIds={addedPlaylistIds}
            membershipStatus={playlistIndexStatus}
            genresVersion={genresVersion}
          />
        </div>
      </div>
    </div>
  );
}
