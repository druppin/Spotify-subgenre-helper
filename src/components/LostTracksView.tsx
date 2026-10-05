"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { SpotifyPlaylist } from "@/lib/spotify/client";
import { LIKED_SONGS_ID, type LibraryResponse, type LibraryTrackDetails } from "@/lib/library";
import type { ScanProgressResponse } from "@/app/api/library/progress/route";
import { groupSongs } from "@/lib/songIdentity";
import { usePlayer } from "./PlayerProvider";
import { PlaylistPicker } from "./PlaylistPicker";
import { PlaylistThumb } from "./PlaylistThumb";
import { NewPlaylistDialog } from "./QuickActions";

// One song as it appears in one place (Liked Songs or an editable playlist).
// Versions of the same song (see groupSongs) share a songId, so a single in
// one playlist and its album version in another count as one song in two.
interface SongRow {
  songId: string;
  // The version of the song that's in placeId.
  uri: string;
  details: LibraryTrackDetails;
  placeId: string;
  addedAt: string;
  // Every other place the song (any version) is in, counted or not.
  otherPlaceIds: string[];
  // How many of otherPlaceIds count as homes (aren't ignored).
  countedOtherHomes: number;
  versions: number;
}

// "lost": songs with exactly one counted home. "homes": every song in one
// chosen place, with everywhere else it lives.
type Mode = "lost" | "homes";
type SortKey = "oldest" | "newest" | "artist" | "title" | "fewest";

const IGNORED_STORAGE_KEY = "lostTracks.ignoredPlaceIds";
const DESTINATION_STORAGE_KEY = "lostTracks.destinationId";
const MODE_STORAGE_KEY = "lostTracks.mode";

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not remembering this is fine.
  }
}

function formatAddedAt(addedAt: string): string {
  const date = new Date(addedAt);
  // Very old playlist entries come back with a 1970 placeholder date.
  if (Number.isNaN(date.getTime()) || date.getFullYear() < 2000) return "—";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function ProgressLine({ label, done, total }: { label: string; done: number; total: number | null }) {
  const percent = total ? Math.min(100, Math.round((done / total) * 100)) : null;
  return (
    <div className="w-80">
      <div className="mb-1 flex justify-between text-xs text-neutral-400">
        <span>{label}</span>
        <span>{total === null ? done : `${done} / ${total}`}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-neutral-800">
        {percent === null ? (
          <div className="h-full w-1/3 animate-pulse rounded-full bg-green-600/60" />
        ) : (
          <div className="h-full rounded-full bg-green-600 transition-[width]" style={{ width: `${percent}%` }} />
        )}
      </div>
    </div>
  );
}

function LikedSongsThumb({ size = 32 }: { size?: number }) {
  return (
    <div
      className="flex flex-shrink-0 items-center justify-center rounded bg-gradient-to-br from-indigo-700 to-emerald-500 text-white"
      style={{ width: size, height: size, fontSize: size * 0.45 }}
      aria-hidden
    >
      ♥
    </div>
  );
}

function PlaceChip({ name, ignored, onClick }: { name: string; ignored: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={ignored ? `${name} (not counted as a home)` : `Show ${name}`}
      className={`max-w-[160px] truncate rounded-full border px-2 py-0.5 text-[11px] ${
        ignored
          ? "border-neutral-800 text-neutral-600 line-through"
          : "border-neutral-700 text-neutral-300 hover:border-green-600 hover:text-green-400"
      }`}
    >
      {name}
    </button>
  );
}

export function LostTracksView({ tabs }: { tabs: ReactNode }) {
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([]);
  const [trackDetails, setTrackDetails] = useState<LibraryResponse["tracks"]>({});
  // placeId -> (uri -> addedAt), kept current locally as tracks are added.
  const [places, setPlaces] = useState<Record<string, Map<string, string>>>({});
  const [likedSongsStatus, setLikedSongsStatus] = useState<LibraryResponse["likedSongs"]>("ok");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [progress, setProgress] = useState<ScanProgressResponse | null>(null);

  const [mode, setMode] = useState<Mode>(() => (loadJson<Mode>(MODE_STORAGE_KEY, "lost") === "homes" ? "homes" : "lost"));
  // Places that don't count as a song's home — e.g. a catch-all playlist
  // that would otherwise make every song look filed.
  const [ignoredIds, setIgnoredIds] = useState<Set<string>>(() => new Set(loadJson<string[]>(IGNORED_STORAGE_KEY, [])));
  // Lost mode: narrows to songs living only here (null = everywhere).
  // Homes mode: the place whose songs are listed.
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [placeQuery, setPlaceQuery] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("oldest");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastToggledIndexRef = useRef<number | null>(null);
  const [destinationId, setDestinationId] = useState<string | null>(() =>
    loadJson<string | null>(DESTINATION_STORAGE_KEY, null)
  );
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const newPlaylistDialogRef = useRef<HTMLDialogElement>(null);

  const { ready, isPaused, currentUri, playbackError, playTrack, togglePlay } = usePlayer();

  // The scan itself is one long request, so poll how far it's got.
  useEffect(() => {
    if (status !== "loading") return;
    const timer = setInterval(() => {
      fetch("/api/library/progress")
        .then((res) => res.json())
        .then((body: ScanProgressResponse) => setProgress(body))
        .catch(() => {});
    }, 500);
    return () => clearInterval(timer);
  }, [status]);

  useEffect(() => {
    fetch("/api/playlists")
      .then((res) => res.json())
      .then((body) => setPlaylists(body.playlists ?? []));
  }, [reloadKey]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/library")
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        if (cancelled) return;
        const library = body as LibraryResponse;
        const next: Record<string, Map<string, string>> = {};
        for (const place of library.places) {
          // Keep the earliest add for a track that's in a playlist twice.
          const entries = new Map<string, string>();
          for (const [uri, addedAt] of place.entries) {
            const existing = entries.get(uri);
            if (!existing || addedAt < existing) entries.set(uri, addedAt);
          }
          next[place.id] = entries;
        }
        setTrackDetails(library.tracks);
        setPlaces(next);
        setLikedSongsStatus(library.likedSongs);
        setStatus("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Failed to load library:", err);
        setError(String(err instanceof Error ? err.message : err));
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const playlistsById = useMemo(() => new Map(playlists.map((p) => [p.id, p])), [playlists]);
  const placeName = useCallback(
    (id: string) => (id === LIKED_SONGS_ID ? "Liked Songs" : (playlistsById.get(id)?.name ?? "Unknown playlist")),
    [playlistsById]
  );

  const songOf = useMemo(() => groupSongs(trackDetails), [trackDetails]);

  // songId -> (placeId -> the version there, earliest added if several).
  const songHomes = useMemo(() => {
    const homes = new Map<string, Map<string, { uri: string; addedAt: string }>>();
    for (const [placeId, entries] of Object.entries(places)) {
      for (const [uri, addedAt] of entries) {
        // Local files and podcast episodes can't be added to playlists.
        if (!uri.startsWith("spotify:track:") || !trackDetails[uri]) continue;
        const songId = songOf.get(uri) ?? uri;
        let byPlace = homes.get(songId);
        if (!byPlace) homes.set(songId, (byPlace = new Map()));
        const existing = byPlace.get(placeId);
        if (!existing || addedAt < existing.addedAt) byPlace.set(placeId, { uri, addedAt });
      }
    }
    return homes;
  }, [places, songOf, trackDetails]);

  const versionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const songId of songOf.values()) counts.set(songId, (counts.get(songId) ?? 0) + 1);
    return counts;
  }, [songOf]);

  const rowFor = useCallback(
    (songId: string, byPlace: Map<string, { uri: string; addedAt: string }>, placeId: string): SongRow => {
      const { uri, addedAt } = byPlace.get(placeId)!;
      const otherPlaceIds = [...byPlace.keys()].filter((id) => id !== placeId);
      return {
        songId,
        uri,
        details: trackDetails[uri],
        placeId,
        addedAt,
        otherPlaceIds,
        countedOtherHomes: otherPlaceIds.filter((id) => !ignoredIds.has(id)).length,
        versions: versionCounts.get(songId) ?? 1,
      };
    },
    [trackDetails, ignoredIds, versionCounts]
  );

  const lostSongs = useMemo(() => {
    const lost: SongRow[] = [];
    for (const [songId, byPlace] of songHomes) {
      const counted = [...byPlace.keys()].filter((id) => !ignoredIds.has(id));
      if (counted.length === 1) lost.push(rowFor(songId, byPlace, counted[0]));
    }
    return lost;
  }, [songHomes, ignoredIds, rowFor]);

  // Per-place number shown in the sidebar: lost songs in lost mode, all
  // songs in homes mode.
  const placeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (mode === "lost") {
      for (const row of lostSongs) counts.set(row.placeId, (counts.get(row.placeId) ?? 0) + 1);
    } else {
      for (const byPlace of songHomes.values()) {
        for (const placeId of byPlace.keys()) counts.set(placeId, (counts.get(placeId) ?? 0) + 1);
      }
    }
    return counts;
  }, [mode, lostSongs, songHomes]);

  const placeList = useMemo(() => {
    const normalized = placeQuery.trim().toLowerCase();
    return Object.keys(places)
      .map((id) => ({ id, name: placeName(id), count: placeCounts.get(id) ?? 0, ignored: ignoredIds.has(id) }))
      .filter((p) => !normalized || p.name.toLowerCase().includes(normalized))
      .sort(
        (a, b) =>
          Number(a.ignored) - Number(b.ignored) ||
          Number(b.id === LIKED_SONGS_ID) - Number(a.id === LIKED_SONGS_ID) ||
          b.count - a.count ||
          a.name.localeCompare(b.name)
      );
  }, [places, placeName, placeCounts, ignoredIds, placeQuery]);

  const rows = useMemo(() => {
    let candidates: SongRow[];
    if (mode === "lost") {
      candidates = selectedPlaceId ? lostSongs.filter((r) => r.placeId === selectedPlaceId) : lostSongs;
    } else {
      candidates = [];
      if (selectedPlaceId) {
        for (const [songId, byPlace] of songHomes) {
          if (byPlace.has(selectedPlaceId)) candidates.push(rowFor(songId, byPlace, selectedPlaceId));
        }
      }
    }
    const normalized = query.trim().toLowerCase();
    const filtered = normalized
      ? candidates.filter(
          (r) =>
            r.details.name.toLowerCase().includes(normalized) ||
            r.details.artists.some((a) => a.toLowerCase().includes(normalized))
        )
      : candidates;
    const byArtist = (a: SongRow, b: SongRow) =>
      (a.details.artists[0] ?? "").localeCompare(b.details.artists[0] ?? "") || a.details.name.localeCompare(b.details.name);
    const compare: Record<SortKey, (a: SongRow, b: SongRow) => number> = {
      oldest: (a, b) => a.addedAt.localeCompare(b.addedAt),
      newest: (a, b) => b.addedAt.localeCompare(a.addedAt),
      artist: byArtist,
      title: (a, b) => a.details.name.localeCompare(b.details.name),
      fewest: (a, b) => a.countedOtherHomes - b.countedOtherHomes || a.addedAt.localeCompare(b.addedAt),
    };
    return filtered.sort(compare[sort]);
  }, [mode, lostSongs, songHomes, selectedPlaceId, rowFor, query, sort]);

  // Only what's both checked and currently shown gets added, so a filter
  // change can't quietly sweep in songs the user can no longer see.
  const selectedRows = rows.filter((r) => selected.has(r.uri));
  // A song already in the destination (in any version) would just be duplicated.
  const toAdd = destinationId
    ? selectedRows.filter((r) => !songHomes.get(r.songId)?.has(destinationId))
    : selectedRows;
  const allRowsSelected = rows.length > 0 && selectedRows.length === rows.length;

  const changeMode = (next: Mode) => {
    setMode(next);
    saveJson(MODE_STORAGE_KEY, next);
    if (next === "homes" && !selectedPlaceId) setSelectedPlaceId(placeList[0]?.id ?? null);
    if (next === "lost" && sort === "fewest") setSort("oldest");
  };

  const toggleIgnored = (id: string) => {
    setIgnoredIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveJson(IGNORED_STORAGE_KEY, [...next]);
      return next;
    });
    // In lost mode an uncounted place can't hold lost songs.
    if (mode === "lost" && selectedPlaceId === id) setSelectedPlaceId(null);
  };

  const toggleSelected = (index: number, shiftKey: boolean) => {
    const uri = rows[index].uri;
    const select = !selected.has(uri);
    const anchor = lastToggledIndexRef.current;
    // Shift-click applies the same check state to the whole range.
    const [from, to] =
      shiftKey && anchor !== null && anchor < rows.length
        ? [Math.min(anchor, index), Math.max(anchor, index)]
        : [index, index];
    setSelected((prev) => {
      const next = new Set(prev);
      for (let i = from; i <= to; i++) {
        if (select) next.add(rows[i].uri);
        else next.delete(rows[i].uri);
      }
      return next;
    });
    lastToggledIndexRef.current = index;
  };

  const toggleAllRows = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of rows) {
        if (allRowsSelected) next.delete(r.uri);
        else next.add(r.uri);
      }
      return next;
    });
  };

  const chooseDestination = (id: string) => {
    setDestinationId(id);
    saveJson(DESTINATION_STORAGE_KEY, id);
  };

  const handlePlaylistCreated = (playlist: SpotifyPlaylist) => {
    setPlaylists((prev) => [playlist, ...prev]);
    setPlaces((prev) => ({ ...prev, [playlist.id]: new Map() }));
    chooseDestination(playlist.id);
    setNotice({ kind: "ok", text: `Created ${playlist.name}. It's now the playlist songs get added to.` });
  };

  const addSelected = async () => {
    if (!destinationId || toAdd.length === 0) return;
    const uris = toAdd.map((r) => r.uri);
    setAdding(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/playlists/${destinationId}/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackUris: uris }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      // Now in a second place, so lost songs drop out of the lost list.
      const now = new Date().toISOString();
      setPlaces((prev) => {
        const entries = new Map(prev[destinationId]);
        for (const uri of uris) if (!entries.has(uri)) entries.set(uri, now);
        return { ...prev, [destinationId]: entries };
      });
      setPlaylists((prev) =>
        prev.map((p) =>
          p.id === destinationId && p.tracks ? { ...p, tracks: { total: p.tracks.total + uris.length } } : p
        )
      );
      setSelected((prev) => {
        const next = new Set(prev);
        for (const uri of uris) next.delete(uri);
        return next;
      });
      setNotice({
        kind: "ok",
        text: `Added ${uris.length} song${uris.length === 1 ? "" : "s"} to ${placeName(destinationId)}.`,
      });
    } catch (err) {
      console.error("Failed to add songs:", err);
      setNotice({ kind: "error", text: `Couldn't add songs: ${err instanceof Error ? err.message : err}` });
    } finally {
      setAdding(false);
    }
  };

  const currentDetails = currentUri ? trackDetails[currentUri] : undefined;
  const destinationPlaylists = playlists.filter((p) => p.canModify);
  const totalSongs = songHomes.size;

  return (
    <div className="flex h-screen flex-col bg-neutral-950 text-white">
      <header className="flex items-center gap-3 border-b border-neutral-800 px-4 py-3">
        {tabs}
        <div className="ml-4 flex rounded-md border border-neutral-700 p-0.5 text-sm" role="group" aria-label="View">
          {(
            [
              ["lost", "Lost songs"],
              ["homes", "Where songs live"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => changeMode(id)}
              aria-pressed={mode === id}
              className={`rounded px-2.5 py-1 ${mode === id ? "bg-neutral-700 text-white" : "text-neutral-400 hover:text-neutral-200"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            setStatus("loading");
            setProgress(null);
            setReloadKey((k) => k + 1);
          }}
          disabled={status === "loading"}
          className="ml-auto rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:border-neutral-500 disabled:opacity-50"
        >
          {status === "loading" ? "Scanning…" : "Rescan library"}
        </button>
      </header>

      {likedSongsStatus === "missing_scope" && status === "ready" && (
        <div className="flex items-center gap-3 border-b border-amber-900/50 bg-amber-950/40 px-4 py-2 text-sm text-amber-300">
          <span>Liked Songs isn&apos;t included yet. Spotify needs one more permission to read it.</span>
          <a href="/api/auth/login" className="rounded-full bg-green-600 px-3 py-1 font-semibold text-white hover:bg-green-500">
            Reconnect Spotify
          </a>
        </div>
      )}

      {status === "loading" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-neutral-400">
          <p>Scanning your library…</p>
          <div className="my-2 flex flex-col gap-3">
            {progress?.playlists ? (
              <ProgressLine
                label={
                  progress.playlists.toFetch > 0 && progress.playlists.fetched === progress.playlists.toFetch
                    ? "Playlists downloaded, saving…"
                    : `Downloading changed playlists (${progress.playlists.unchanged} unchanged)`
                }
                done={progress.playlists.fetched}
                total={progress.playlists.toFetch}
              />
            ) : (
              <ProgressLine label="Listing your playlists…" done={0} total={null} />
            )}
            {progress && progress.rateLimitWaitMs > 0 && (
              <p className="text-xs text-amber-400">
                Spotify asked us to slow down. Resuming in {Math.ceil(progress.rateLimitWaitMs / 1000)}s
              </p>
            )}
            {progress?.liked && (
              <ProgressLine
                label={progress.liked.unchanged ? "Liked Songs unchanged" : "Downloading Liked Songs"}
                done={progress.liked.fetched}
                total={progress.liked.total}
              />
            )}
          </div>
          <p className="max-w-md text-center text-xs text-neutral-500">
            The first scan downloads every playlist you can edit (and Liked Songs). After that, only
            playlists that changed get downloaded again.
          </p>
        </div>
      )}

      {status === "error" && (
        <div className="flex flex-1 items-center justify-center">
          <p className="rounded-md bg-red-900/30 px-3 py-2 text-sm text-red-400">Couldn&apos;t scan your library: {error}</p>
        </div>
      )}


      {status === "ready" && (
        <div className="grid min-h-0 flex-1 grid-cols-[300px_1fr] overflow-hidden">
          <aside className="flex min-h-0 flex-col overflow-hidden border-r border-neutral-800">
            <div className="px-3 pt-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
                {mode === "lost" ? "Lives only in" : "Playlist"}
              </h2>
              <p className="mt-1 text-xs text-neutral-500">
                {mode === "lost"
                  ? "Songs with exactly one home."
                  : "Pick one to see where else each of its songs lives."}{" "}
                Mark a catch-all playlist <span className="text-neutral-300">Don&apos;t count</span> so it isn&apos;t
                treated as a song&apos;s home.
              </p>
              <input
                type="search"
                value={placeQuery}
                onChange={(e) => setPlaceQuery(e.target.value)}
                placeholder="Search playlists…"
                aria-label="Search playlists"
                className="mt-2 w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm outline-none placeholder:text-neutral-500 focus:border-green-600"
              />
            </div>
            <ul className="mt-2 flex-1 overflow-y-auto pb-2">
              {mode === "lost" && (
                <li>
                  <button
                    type="button"
                    onClick={() => setSelectedPlaceId(null)}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                      selectedPlaceId === null ? "bg-green-600/20 text-green-400" : "text-neutral-200 hover:bg-neutral-800"
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">Everywhere</span>
                    <span className="text-xs text-neutral-500">{lostSongs.length}</span>
                  </button>
                </li>
              )}
              {placeList.map((place, index) => {
                const playlist = playlistsById.get(place.id);
                // In lost mode an uncounted place holds no lost songs; in
                // homes mode it's still worth seeing what's in it.
                const selectable = mode === "homes" || !place.ignored;
                const firstIgnored = place.ignored && !placeList[index - 1]?.ignored;
                return (
                  <li key={place.id}>
                    {firstIgnored && (
                      <div className="mt-2 border-t border-neutral-800 px-3 pb-1 pt-2 text-[11px] uppercase tracking-wide text-neutral-500">
                        Not counted as a home
                      </div>
                    )}
                    <div className="flex items-center">
                      <button
                        type="button"
                        onClick={() => selectable && setSelectedPlaceId(place.id)}
                        disabled={!selectable}
                        className={`flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left text-sm ${
                          place.id === selectedPlaceId
                            ? "bg-green-600/20 text-green-400"
                            : place.ignored
                              ? "text-neutral-500 hover:bg-neutral-900"
                              : "text-neutral-200 hover:bg-neutral-800"
                        }`}
                      >
                        {place.id === LIKED_SONGS_ID ? (
                          <LikedSongsThumb size={28} />
                        ) : playlist ? (
                          <PlaylistThumb playlist={playlist} size={28} />
                        ) : (
                          <div className="h-7 w-7 flex-shrink-0 rounded bg-neutral-800" />
                        )}
                        <span className="min-w-0 flex-1 truncate">{place.name}</span>
                        <span className="text-xs text-neutral-500">
                          {mode === "lost" && place.ignored ? "" : place.count}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleIgnored(place.id)}
                        title={
                          place.ignored
                            ? "Count this as a home again"
                            : "Don't count this as a home: songs here can still be lost"
                        }
                        className={`mr-2 flex-shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${
                          place.ignored
                            ? "border-amber-700/60 text-amber-400 hover:bg-amber-900/30"
                            : "border-neutral-800 text-neutral-500 hover:border-neutral-600 hover:text-neutral-200"
                        }`}
                      >
                        {place.ignored ? "Count" : "Don't count"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </aside>

          <section className="flex min-h-0 flex-col overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 border-b border-neutral-800 px-4 py-2">
              <label className="flex items-center gap-2 text-sm text-neutral-300">
                <input
                  type="checkbox"
                  checked={allRowsSelected}
                  onChange={toggleAllRows}
                  disabled={rows.length === 0}
                  className="accent-green-600"
                />
                {mode === "lost" ? (
                  <>
                    {rows.length} lost song{rows.length === 1 ? "" : "s"}
                    {selectedPlaceId && <span className="text-neutral-500">only in {placeName(selectedPlaceId)}</span>}
                  </>
                ) : selectedPlaceId ? (
                  <>
                    {rows.length} song{rows.length === 1 ? "" : "s"} in {placeName(selectedPlaceId)}
                  </>
                ) : (
                  "No playlist chosen"
                )}
              </label>
              <span className="text-xs text-neutral-600">of {totalSongs} songs in your library</span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter by title or artist…"
                aria-label="Filter songs"
                className="ml-auto w-56 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm outline-none placeholder:text-neutral-500 focus:border-green-600"
              />
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                aria-label="Sort songs"
                className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
              >
                <option value="oldest">Oldest added first</option>
                <option value="newest">Newest added first</option>
                <option value="artist">Artist</option>
                <option value="title">Title</option>
                {mode === "homes" && <option value="fewest">Fewest other homes</option>}
              </select>
            </div>

            <ul className="min-h-0 flex-1 overflow-y-auto">
              {rows.map((row, index) => {
                const isCurrent = row.uri === currentUri;
                return (
                  <li
                    key={row.songId}
                    onClick={() => ready && playTrack(row.uri).catch((err) => console.error(err))}
                    title={ready ? "Click to play" : "Player is still connecting…"}
                    className={`flex cursor-pointer items-center gap-3 px-4 py-1.5 text-sm ${
                      isCurrent ? "bg-green-600/20 text-green-400" : "text-neutral-300 hover:bg-neutral-900"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(row.uri)}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSelected(index, e.shiftKey);
                      }}
                      onChange={() => {}}
                      aria-label={`Select ${row.details.name}`}
                      className="accent-green-600"
                    />
                    {row.details.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={row.details.image} alt="" loading="lazy" className="h-9 w-9 flex-shrink-0 rounded object-cover" />
                    ) : (
                      <div className="h-9 w-9 flex-shrink-0 rounded bg-neutral-800" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-medium">
                          {isCurrent && <span className="mr-1">{isPaused ? "❚❚" : "▶"}</span>}
                          {row.details.name}
                        </span>
                        {row.versions > 1 && (
                          <span
                            className="flex-shrink-0 rounded bg-neutral-800 px-1 text-[10px] text-neutral-400"
                            title="Released more than once (e.g. single and album); counted as one song"
                          >
                            {row.versions} versions
                          </span>
                        )}
                      </div>
                      <div className="truncate text-xs text-neutral-500">{row.details.artists.join(", ")}</div>
                    </div>
                    {mode === "lost" && !selectedPlaceId && (
                      <span className="hidden max-w-[200px] truncate text-xs text-neutral-500 md:block">
                        {placeName(row.placeId)}
                      </span>
                    )}
                    {mode === "homes" && (
                      <div className="hidden max-w-[45%] flex-wrap justify-end gap-1 md:flex">
                        {row.countedOtherHomes === 0 && (
                          <span className="rounded-full bg-amber-900/40 px-2 py-0.5 text-[11px] text-amber-300">
                            Only here
                          </span>
                        )}
                        {row.otherPlaceIds.map((id) => (
                          <PlaceChip
                            key={id}
                            name={placeName(id)}
                            ignored={ignoredIds.has(id)}
                            onClick={() => setSelectedPlaceId(id)}
                          />
                        ))}
                      </div>
                    )}
                    <span className="w-24 flex-shrink-0 text-right text-xs text-neutral-500">{formatAddedAt(row.addedAt)}</span>
                  </li>
                );
              })}
              {rows.length === 0 && (
                <li className="px-4 py-6 text-center text-sm text-neutral-500">
                  {mode === "homes"
                    ? selectedPlaceId
                      ? "No songs match this filter."
                      : "Pick a playlist on the left."
                    : lostSongs.length === 0
                      ? "No lost songs. Everything in your library lives in at least two places."
                      : "No lost songs match this filter."}
                </li>
              )}
            </ul>

            <footer className="flex flex-wrap items-center gap-3 border-t border-neutral-800 px-4 py-3">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <button
                  type="button"
                  onClick={() => togglePlay()}
                  disabled={!ready || !currentUri}
                  className="rounded-full bg-white px-3 py-1 text-sm font-semibold text-black hover:bg-neutral-200 disabled:opacity-40"
                >
                  {isPaused ? "Play" : "Pause"}
                </button>
                <span className="min-w-0 truncate text-xs text-neutral-400">
                  {!ready
                    ? "Player connecting…"
                    : currentDetails
                      ? `${currentDetails.name} · ${currentDetails.artists.join(", ")}`
                      : "Click a song to preview it"}
                </span>
                {playbackError && <span className="truncate text-xs text-red-400">{playbackError}</span>}
              </div>
              {notice && (
                <span className={`text-xs ${notice.kind === "ok" ? "text-green-400" : "text-red-400"}`}>{notice.text}</span>
              )}
              <button
                type="button"
                onClick={() => newPlaylistDialogRef.current?.showModal()}
                className="rounded-md border border-neutral-700 px-2.5 py-1.5 text-sm text-neutral-200 hover:border-green-600 hover:bg-green-600/10"
              >
                + New playlist
              </button>
              <PlaylistPicker
                playlists={destinationPlaylists}
                selectedId={destinationId}
                onSelect={chooseDestination}
                placeholder="Choose a playlist…"
                dropUp
              />
              <button
                type="button"
                onClick={addSelected}
                disabled={adding || !destinationId || toAdd.length === 0}
                title={
                  selectedRows.length > toAdd.length
                    ? "Songs already in the chosen playlist (in any version) are skipped"
                    : undefined
                }
                className="rounded-full bg-green-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-green-500 disabled:opacity-40"
              >
                {adding ? "Adding…" : `Add ${toAdd.length} to playlist`}
              </button>
            </footer>
          </section>
        </div>
      )}
      <NewPlaylistDialog dialogRef={newPlaylistDialogRef} onCreated={handlePlaylistCreated} showStar={false} />
    </div>
  );
}
