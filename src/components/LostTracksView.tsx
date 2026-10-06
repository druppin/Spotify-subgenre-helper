"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { SpotifyPlaylist } from "@/lib/spotify/client";
import {
  LIKED_SONGS_ID,
  type LibraryCoverage,
  type LibraryFetchMode,
  type LibraryResponse,
  type LibraryTrackDetails,
} from "@/lib/library";
import type { ScanProgressResponse } from "@/app/api/library/progress/route";
import { groupSongs } from "@/lib/songIdentity";
import { usePlayer } from "./PlayerProvider";
import { PlaylistPicker } from "./PlaylistPicker";
import { PlaylistThumb } from "./PlaylistThumb";
import { NewPlaylistDialog } from "./QuickActions";
import { GenerateGenresDialog, PlaylistGenresDialog } from "./GenreDialogs";

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

// What the genre dropdown shows: stored genres (subgenres + mood), plus the
// AI's reasoning when it was generated in this session.
interface SongGenres {
  subgenres: string[];
  moodVibe: string;
  rationale?: string;
}

// Lets Liked Songs be picked in a PlaylistPicker alongside real playlists.
const LIKED_SONGS_PICKER_ENTRY: SpotifyPlaylist = {
  id: LIKED_SONGS_ID,
  name: "Liked Songs",
  images: [],
  owner: { id: "", display_name: null },
  collaborative: false,
  canModify: false,
};

function trackIdOf(uri: string): string {
  return uri.split(":")[2] ?? uri;
}

// "lost": songs with exactly one counted home. "homes": every song in one
// chosen place, with everywhere else it lives.
type Mode = "lost" | "homes";
type SortKey = "oldest" | "newest" | "artist" | "title" | "fewest";

const IGNORED_STORAGE_KEY = "lostTracks.ignoredPlaceIds";
const DESTINATION_STORAGE_KEY = "lostTracks.destinationId";
const MODE_STORAGE_KEY = "lostTracks.mode";
const HIDDEN_STORAGE_KEY = "lostTracks.hiddenByPlace";
const HIDE_RULES_STORAGE_KEY = "lostTracks.hideIfAlsoIn";
const SHOW_GENRES_STORAGE_KEY = "lostTracks.showGenres";

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

interface SelectByOption {
  value: string;
  name: string;
  count: number;
}

// "Select songs [in / not in] [playlist or subgenre]": replaces the current
// selection with the shown songs that match.
function SelectByBar({
  playlists,
  genres,
  onSelect,
}: {
  playlists: SelectByOption[];
  genres: SelectByOption[];
  onSelect: (matching: boolean, category: string) => void;
}) {
  const [matching, setMatching] = useState(true);
  const [category, setCategory] = useState("");
  // A choice that no longer applies to the shown songs falls back to none.
  const available = [...playlists, ...genres].some((o) => o.value === category) ? category : "";
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800 px-4 py-2 text-xs text-neutral-400">
      <span>Select songs</span>
      <select
        value={matching ? "in" : "not-in"}
        onChange={(e) => setMatching(e.target.value === "in")}
        aria-label="In or not in"
        className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-200"
      >
        <option value="in">in</option>
        <option value="not-in">not in</option>
      </select>
      <select
        value={available}
        onChange={(e) => setCategory(e.target.value)}
        aria-label="Playlist or subgenre"
        className="max-w-xs rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-200"
      >
        <option value="">Choose a playlist or subgenre…</option>
        {playlists.length > 0 && (
          <optgroup label="Playlists">
            {playlists.map((o) => (
              <option key={o.value} value={o.value}>
                {o.name} ({o.count})
              </option>
            ))}
          </optgroup>
        )}
        {genres.length > 0 && (
          <optgroup label="Subgenres">
            {genres.map((o) => (
              <option key={o.value} value={o.value}>
                {o.name} ({o.count})
              </option>
            ))}
          </optgroup>
        )}
      </select>
      <button
        type="button"
        onClick={() => onSelect(matching, available)}
        disabled={!available}
        title="Replace the current selection with the shown songs that match"
        className="rounded-md border border-neutral-700 px-2.5 py-1 text-neutral-200 hover:border-green-600 hover:bg-green-600/10 disabled:opacity-50 disabled:hover:border-neutral-700 disabled:hover:bg-transparent"
      >
        Select
      </button>
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

// What's saved of the library and how current it is, with what it would
// cost (in Spotify requests) to bring it up to date.
function CoverageBar({
  coverage,
  scanError,
  onFetch,
}: {
  coverage: LibraryCoverage;
  scanError: string | null;
  onFetch: (mode: LibraryFetchMode) => void;
}) {
  const p = coverage.playlists;
  const scanned = p.fresh + p.incomplete + p.changed;
  const likedNeedsUpdate = coverage.likedSongs === "notScanned" || coverage.likedSongs === "unchecked";
  const needsUpdate = p.changed + p.notScanned > 0 || likedNeedsUpdate;
  const needsDetails = p.incomplete > 0 || coverage.likedSongs === "incomplete";
  const likedLabel: Record<LibraryCoverage["likedSongs"], string> = {
    fresh: "up to date",
    incomplete: "saved, missing album details",
    unchecked: "saved (not checked for changes)",
    notScanned: "not scanned",
    unreadable: "needs reconnecting",
  };
  const parts = [
    `${scanned} of ${p.total} playlists saved`,
    p.changed && `${p.changed} changed since`,
    p.notScanned && `${p.notScanned} never scanned`,
    p.incomplete && `${p.incomplete} missing album details`,
    `Liked Songs ${likedLabel[coverage.likedSongs]}`,
  ].filter(Boolean);
  const likedNote = coverage.likedSongs === "notScanned" || coverage.likedSongs === "incomplete" ? " + Liked Songs" : "";
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-800 bg-neutral-900/50 px-4 py-2 text-xs text-neutral-400">
      <span>{parts.join(" · ")}</span>
      {p.changed + p.notScanned > 0 && (
        <span className="text-amber-400/80">
          Songs in unsaved or changed playlists can show as lost when they aren&apos;t.
        </span>
      )}
      {scanError && <span className="text-red-400">Last scan stopped: {scanError}</span>}
      <span className="ml-auto flex gap-2">
        {needsUpdate && (
          <button
            type="button"
            onClick={() => onFetch("update")}
            title="Download playlists that changed or were never scanned (and check Liked Songs for changes)"
            className="rounded-md border border-neutral-700 px-2.5 py-1 text-neutral-200 hover:border-green-600 hover:bg-green-600/10"
          >
            Update (~{p.requestsToUpdate + (likedNeedsUpdate ? 1 : 0)} requests{likedNote})
          </button>
        )}
        {(needsUpdate || needsDetails) && (
          <button
            type="button"
            onClick={() => onFetch("complete")}
            title="Also re-download saved playlists that are missing album details, so genre lookups never need Spotify"
            className="rounded-md border border-neutral-700 px-2.5 py-1 text-neutral-200 hover:border-green-600 hover:bg-green-600/10"
          >
            Update and fill in details (~{p.requestsToComplete + 1} requests{likedNote})
          </button>
        )}
      </span>
    </div>
  );
}

// A song's genre info as a column in its row: subgenres and mood, with
// the AI's reasoning on hover, and a way to generate or regenerate it.
function GenreCell({
  genres,
  state,
  onGenerate,
}: {
  genres: SongGenres | undefined;
  // "loading" while generating, an error message if that failed.
  state: "loading" | { error: string } | undefined;
  onGenerate: (force: boolean) => void;
}) {
  const loading = state === "loading";
  const error = state && state !== "loading" ? state.error : null;
  return (
    <div className="w-64 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
      {genres ? (
        <div
          title={[genres.moodVibe, genres.rationale].filter(Boolean).join("\n\n") || undefined}
          className="flex items-start gap-1"
        >
          <div className="min-w-0 flex-1">
            <div className="flex max-h-[2.5rem] flex-wrap gap-1 overflow-hidden">
              {genres.subgenres.map((genre) => (
                <span key={genre} className="rounded-full bg-green-600/20 px-1.5 py-px text-[11px] text-green-400">
                  {genre}
                </span>
              ))}
              {genres.subgenres.length === 0 && <span className="text-[11px] text-neutral-500">No subgenres listed.</span>}
            </div>
            {genres.moodVibe && <div className="mt-0.5 truncate text-[11px] text-neutral-500">{genres.moodVibe}</div>}
          </div>
          <button
            type="button"
            onClick={() => onGenerate(true)}
            disabled={loading}
            title="Not right? Generate fresh genre info for this song."
            aria-label="Regenerate genre info"
            className={`flex-shrink-0 text-xs text-neutral-500 hover:text-green-400 disabled:opacity-50 ${
              loading ? "" : "opacity-0 focus:opacity-100 group-hover:opacity-100"
            }`}
          >
            {loading ? "…" : "↻"}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onGenerate(false)}
          disabled={loading}
          className="rounded-md border border-neutral-800 px-2 py-0.5 text-[11px] text-neutral-400 hover:border-green-600 hover:bg-green-600/10 hover:text-neutral-200 disabled:opacity-50"
        >
          {loading ? "Generating…" : "Generate genre info"}
        </button>
      )}
      {error && (
        <div className="mt-0.5 truncate text-[11px] text-red-400" title={error}>
          {error}
        </div>
      )}
    </div>
  );
}

function PlaceChip({
  name,
  ignored,
  onClick,
  onRemove,
}: {
  name: string;
  ignored: boolean;
  onClick: () => void;
  // Omitted where removing isn't possible (Liked Songs).
  onRemove?: () => void;
}) {
  // Removing takes a second click on the armed chip, so a stray click on
  // the × can't take a song out of a playlist.
  const [armed, setArmed] = useState(false);
  if (armed && onRemove) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setArmed(false);
          onRemove();
        }}
        onMouseLeave={() => setArmed(false)}
        onBlur={() => setArmed(false)}
        title={`Remove this song from ${name}`}
        className="max-w-[180px] truncate rounded-full border border-red-600 bg-red-900/40 px-2 py-0.5 text-[11px] text-red-200"
      >
        Remove from {name}?
      </button>
    );
  }
  return (
    <span
      className={`flex max-w-[180px] items-center rounded-full border text-[11px] ${
        ignored
          ? "border-neutral-800 text-neutral-600"
          : "border-neutral-700 text-neutral-300 hover:border-green-600"
      }`}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        title={ignored ? `${name} (not counted as a home)` : `Show ${name}`}
        className={`truncate py-0.5 ${onRemove ? "pl-2 pr-1" : "px-2"} ${ignored ? "line-through" : "hover:text-green-400"}`}
      >
        {name}
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setArmed(true);
          }}
          aria-label={`Remove from ${name}`}
          title={`Remove from ${name}`}
          className="rounded-full pr-1.5 text-neutral-500 hover:text-red-400"
        >
          ×
        </button>
      )}
    </span>
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
  // Each load reads the saved library; fetchMode says how much to download
  // from Spotify first. The first load downloads nothing.
  const [load, setLoad] = useState<{ key: number; fetchMode: LibraryFetchMode }>({ key: 0, fetchMode: "none" });
  const [coverage, setCoverage] = useState<LibraryCoverage | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ScanProgressResponse | null>(null);

  const [mode, setMode] = useState<Mode>(() => (loadJson<Mode>(MODE_STORAGE_KEY, "homes") === "lost" ? "lost" : "homes"));
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
  const [removing, setRemoving] = useState(false);
  // Bulk remove takes a second click, which shows what it's about to do.
  const [removeArmed, setRemoveArmed] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string; onUndo?: () => void } | null>(
    null
  );
  const newPlaylistDialogRef = useRef<HTMLDialogElement>(null);
  // Stored genre info by Spotify track ID, loaded once the library is in.
  const [genres, setGenres] = useState<Record<string, SongGenres>>({});
  // Genre overlays mount only while open, so each opening starts fresh.
  const [genreDialog, setGenreDialog] = useState<
    { kind: "summary" | "generate"; playlistId: string | null } | null
  >(null);
  const [showGenres, setShowGenres] = useState(() => loadJson<boolean>(SHOW_GENRES_STORAGE_KEY, true));
  // Songs hidden within a playlist in the homes view, as placeId -> track
  // URIs. Hidden songs still show, greyed out at the bottom, and can't be
  // selected. A song counts as hidden if any of its versions is listed.
  const [hiddenByPlace, setHiddenByPlace] = useState<Record<string, string[]>>(() =>
    loadJson<Record<string, string[]>>(HIDDEN_STORAGE_KEY, {})
  );
  // Per-playlist rules for the homes view: placeId -> other places whose
  // songs are hidden here, so clearing out songs that are filed elsewhere
  // can leave the ones also in those places alone.
  const [hideRules, setHideRules] = useState<Record<string, string[]>>(() =>
    loadJson<Record<string, string[]>>(HIDE_RULES_STORAGE_KEY, {})
  );
  const [genreStatus, setGenreStatus] = useState<Record<string, "loading" | { error: string }>>({});

  const { ready, isPaused, currentUri, playbackError, playTrack, togglePlay } = usePlayer();

  // The scan itself is one long request, so poll how far it's got.
  useEffect(() => {
    if (status !== "loading" || load.fetchMode === "none") return;
    const timer = setInterval(() => {
      fetch("/api/library/progress")
        .then((res) => res.json())
        .then((body: ScanProgressResponse) => setProgress(body))
        .catch(() => {});
    }, 500);
    return () => clearInterval(timer);
  }, [status, load.fetchMode]);

  useEffect(() => {
    fetch("/api/playlists")
      .then((res) => res.json())
      .then((body) => setPlaylists(body.playlists ?? []));
  }, [load.key]);

  const startLoad = (fetchMode: LibraryFetchMode) => {
    setStatus("loading");
    setProgress(null);
    if (fetchMode !== "none") setScanError(null);
    setLoad((prev) => ({ key: prev.key + 1, fetchMode }));
  };

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/library?fetch=${load.fetchMode}`)
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
        const trackIds = Object.keys(library.tracks)
          .filter((uri) => uri.startsWith("spotify:track:"))
          .map(trackIdOf);
        fetch("/api/track-genres", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: trackIds }),
        })
          .then((res) => res.json())
          .then((genreBody) => {
            if (!cancelled && genreBody.genres) setGenres(genreBody.genres);
          })
          .catch((err) => console.error("Failed to load stored genres:", err));
        setLikedSongsStatus(library.likedSongs);
        setCoverage(library.coverage);
        setStatus("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Failed to load library:", err);
        const message = String(err instanceof Error ? err.message : err);
        if (load.fetchMode !== "none") {
          // A scan that stopped part way still saved what it downloaded;
          // show the saved library with the reason it stopped.
          setScanError(message);
          setLoad((prev) => ({ key: prev.key + 1, fetchMode: "none" }));
          return;
        }
        setError(message);
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

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

  // songId -> every URI that's a version of it, for finding genre info
  // generated against any of them.
  const songVersions = useMemo(() => {
    const versions = new Map<string, string[]>();
    for (const [uri, songId] of songOf) {
      const list = versions.get(songId);
      if (list) list.push(uri);
      else versions.set(songId, [uri]);
    }
    return versions;
  }, [songOf]);

  const genresFor = useCallback(
    (row: SongRow): SongGenres | undefined => {
      const own = genres[trackIdOf(row.uri)];
      if (own) return own;
      for (const uri of songVersions.get(row.songId) ?? []) {
        const other = genres[trackIdOf(uri)];
        if (other) return other;
      }
      return undefined;
    },
    [genres, songVersions]
  );

  // Picks up genres generated in bulk so the genre column shows them.
  const reloadGenres = () => {
    const trackIds = Object.keys(trackDetails)
      .filter((uri) => uri.startsWith("spotify:track:"))
      .map(trackIdOf);
    fetch("/api/track-genres", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: trackIds }),
    })
      .then((res) => res.json())
      .then((body) => body.genres && setGenres(body.genres))
      .catch((err) => console.error("Failed to reload stored genres:", err));
  };

  // The genre overlays read playlists by id; Liked Songs isn't one, and
  // followed-only playlists can't have their tracks read (Spotify 403s).
  const genreDialogPlaylists = playlists.filter((p) => p.canModify);
  const openGenreDialog = (kind: "summary" | "generate") =>
    setGenreDialog({
      kind,
      playlistId: selectedPlaceId && genreDialogPlaylists.some((p) => p.id === selectedPlaceId) ? selectedPlaceId : null,
    });

  const toggleShowGenres = () => {
    setShowGenres(!showGenres);
    saveJson(SHOW_GENRES_STORAGE_KEY, !showGenres);
  };

  const generateGenres = async (row: SongRow, force: boolean) => {
    const trackId = trackIdOf(row.uri);
    setGenreStatus((prev) => ({ ...prev, [row.songId]: "loading" }));
    try {
      const res = await fetch(`/api/track/${trackId}/summary${force ? "?force=true" : ""}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      if (!body.summary) throw new Error(body.summaryError ?? "No genre info came back.");
      setGenres((prev) => ({ ...prev, [trackId]: body.summary }));
      setGenreStatus((prev) => {
        const next = { ...prev };
        delete next[row.songId];
        return next;
      });
    } catch (err) {
      console.error("Failed to generate genres:", err);
      const error = err instanceof Error ? err.message : String(err);
      setGenreStatus((prev) => ({ ...prev, [row.songId]: { error } }));
    }
  };

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

  // Homes mode always shows one playlist; open on the first once the
  // library has loaded rather than an empty list.
  if (mode === "homes" && !selectedPlaceId && placeList.length > 0) setSelectedPlaceId(placeList[0].id);

  const hiddenSets = useMemo(() => {
    const sets: Record<string, Set<string>> = {};
    for (const [placeId, uris] of Object.entries(hiddenByPlace)) sets[placeId] = new Set(uris);
    return sets;
  }, [hiddenByPlace]);

  // Why a song is hidden in a place, or null if it isn't: hidden by hand,
  // and/or also in places the place's hide rules name.
  const hiddenReason = useCallback(
    (songId: string, placeId: string): { manual: boolean; alsoIn: string[] } | null => {
      const hidden = hiddenSets[placeId];
      const manual = Boolean(hidden && (songVersions.get(songId) ?? [songId]).some((uri) => hidden.has(uri)));
      const homes = songHomes.get(songId);
      const alsoIn = (hideRules[placeId] ?? []).filter((id) => homes?.has(id));
      return manual || alsoIn.length ? { manual, alsoIn } : null;
    },
    [hiddenSets, songVersions, songHomes, hideRules]
  );

  // rows: what can be selected and acted on. hiddenRows: the homes view's
  // hidden songs, listed after them. hiddenTotal ignores the text filter.
  const { rows, hiddenRows, hiddenTotal } = useMemo(() => {
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
    const hiddenIds = new Set(
      mode === "homes" && selectedPlaceId
        ? candidates.filter((r) => hiddenReason(r.songId, selectedPlaceId)).map((r) => r.songId)
        : []
    );
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
    filtered.sort(compare[sort]);
    return {
      rows: filtered.filter((r) => !hiddenIds.has(r.songId)),
      hiddenRows: filtered.filter((r) => hiddenIds.has(r.songId)),
      hiddenTotal: hiddenIds.size,
    };
  }, [mode, lostSongs, songHomes, selectedPlaceId, rowFor, query, sort, hiddenReason]);

  const saveHideRules = (placeId: string, ruleIds: string[]) => {
    const next = { ...hideRules };
    if (ruleIds.length) next[placeId] = ruleIds;
    else delete next[placeId];
    setHideRules(next);
    saveJson(HIDE_RULES_STORAGE_KEY, next);
    // Songs a new rule hides can't stay selected.
    setSelected(new Set());
  };

  // The quick clean-out: check every shown song that's also somewhere else
  // that counts, ready to remove from this playlist.
  const selectSongsLivingElsewhere = () => {
    setSelected(new Set(rows.filter((r) => r.countedOtherHomes > 0).map((r) => r.uri)));
  };

  // What the "Select songs in / not in" dropdown offers: the playlists and
  // subgenres the shown songs actually have, with how many songs have each.
  const selectByOptions = useMemo(() => {
    const playlistCounts = new Map<string, number>();
    const genreCounts = new Map<string, number>();
    for (const row of rows) {
      for (const id of new Set([row.placeId, ...row.otherPlaceIds])) {
        playlistCounts.set(id, (playlistCounts.get(id) ?? 0) + 1);
      }
      for (const genre of new Set(genresFor(row)?.subgenres ?? [])) {
        genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1);
      }
    }
    // Every song shown in a playlist is in it, so it's no use as a choice.
    if (mode === "homes" && selectedPlaceId) playlistCounts.delete(selectedPlaceId);
    const byCount = (a: { name: string; count: number }, b: { name: string; count: number }) =>
      b.count - a.count || a.name.localeCompare(b.name);
    return {
      playlists: [...playlistCounts]
        .map(([id, count]) => ({ value: `playlist:${id}`, name: placeName(id), count }))
        .sort(byCount),
      genres: [...genreCounts]
        .map(([genre, count]) => ({ value: `genre:${genre}`, name: genre, count }))
        .sort(byCount),
    };
  }, [rows, genresFor, mode, selectedPlaceId, placeName]);

  // Checks every shown song that is (or isn't) in a playlist or has (or
  // hasn't) a subgenre. Songs with no genre info yet are left out of
  // "not in subgenre", since it isn't known whether they belong.
  const selectBy = (matching: boolean, category: string) => {
    let has: (row: SongRow) => boolean | undefined;
    if (category.startsWith("playlist:")) {
      const id = category.slice("playlist:".length);
      has = (row) => row.placeId === id || row.otherPlaceIds.includes(id);
    } else {
      const genre = category.slice("genre:".length);
      has = (row) => genresFor(row)?.subgenres.includes(genre);
    }
    setSelected(new Set(rows.filter((r) => (matching ? has(r) === true : has(r) === false)).map((r) => r.uri)));
    lastToggledIndexRef.current = null;
  };

  const saveHidden = (next: Record<string, string[]>) => {
    setHiddenByPlace(next);
    saveJson(HIDDEN_STORAGE_KEY, next);
  };

  const hideRows = (toHide: SongRow[], placeId: string) => {
    const uris = new Set([...(hiddenByPlace[placeId] ?? []), ...toHide.map((r) => r.uri)]);
    saveHidden({ ...hiddenByPlace, [placeId]: [...uris] });
    // Hidden songs can't be selected, so don't leave them checked.
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of toHide) next.delete(r.uri);
      return next;
    });
  };

  const unhideRow = (row: SongRow, placeId: string) => {
    const versions = new Set(songVersions.get(row.songId) ?? [row.uri]);
    const remaining = (hiddenByPlace[placeId] ?? []).filter((uri) => !versions.has(uri));
    const next = { ...hiddenByPlace };
    if (remaining.length) next[placeId] = remaining;
    else delete next[placeId];
    saveHidden(next);
  };

  // Only what's both checked and currently shown gets added, so a filter
  // change can't quietly sweep in songs the user can no longer see.
  const selectedRows = rows.filter((r) => selected.has(r.uri));
  // A song already in the destination (in any version) would just be duplicated.
  const toAdd = destinationId
    ? selectedRows.filter((r) => !songHomes.get(r.songId)?.has(destinationId))
    : selectedRows;
  const allRowsSelected = rows.length > 0 && selectedRows.length === rows.length;
  // Removing needs one playlist in view; Liked Songs can't be edited here.
  const removePlaceId = selectedPlaceId && selectedPlaceId !== LIKED_SONGS_ID ? selectedPlaceId : null;
  // Of the selected songs, how many would be left with no counted home.
  const wouldBeHomeless = removePlaceId
    ? selectedRows.filter((r) => {
        const homes = [...(songHomes.get(r.songId)?.keys() ?? [])];
        return !homes.some((id) => id !== removePlaceId && !ignoredIds.has(id));
      }).length
    : 0;

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

  // Records tracks added to or removed from a place, keeping the local
  // library (and the playlist's song count) in step with Spotify.
  const applyMembership = (placeId: string, entries: [string, string][], present: boolean) => {
    setPlaces((prev) => {
      const next = new Map(prev[placeId]);
      for (const [uri, addedAt] of entries) {
        if (present && !next.has(uri)) next.set(uri, addedAt);
        else if (!present) next.delete(uri);
      }
      return { ...prev, [placeId]: next };
    });
    const delta = present ? entries.length : -entries.length;
    setPlaylists((prev) =>
      prev.map((p) =>
        p.id === placeId && p.tracks ? { ...p, tracks: { total: Math.max(0, p.tracks.total + delta) } } : p
      )
    );
  };

  const removeSongsFromPlace = async (songIds: string[], placeId: string) => {
    // Every version of each song that's in this playlist, not just one.
    const songSet = new Set(songIds);
    const entries = [...(places[placeId] ?? [])].filter(([uri]) => songSet.has(songOf.get(uri) ?? uri));
    if (entries.length === 0) return;
    const name =
      songIds.length === 1
        ? (trackDetails[entries[0][0]]?.name ?? "Song")
        : `${songIds.length} songs`;
    setNotice(null);
    setRemoving(true);
    try {
      const res = await fetch(`/api/playlists/${placeId}/tracks`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackUris: entries.map(([uri]) => uri), source: "lost-tracks" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      applyMembership(placeId, entries, false);
      setSelected((prev) => {
        const next = new Set(prev);
        for (const [uri] of entries) next.delete(uri);
        return next;
      });
      setNotice({
        kind: "ok",
        text: `Removed ${name} from ${placeName(placeId)}.`,
        // Spotify can't restore a track's old position; undo re-adds it at the end.
        onUndo: () => undoRemove(placeId, entries, name),
      });
    } catch (err) {
      console.error("Failed to remove song:", err);
      setNotice({ kind: "error", text: `Couldn't remove ${name}: ${err instanceof Error ? err.message : err}` });
    } finally {
      setRemoving(false);
    }
  };

  const undoRemove = async (placeId: string, entries: [string, string][], name: string) => {
    setNotice(null);
    try {
      const res = await fetch(`/api/playlists/${placeId}/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackUris: entries.map(([uri]) => uri), source: "lost-tracks" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      applyMembership(placeId, entries, true);
      setNotice({ kind: "ok", text: `Put ${name} back in ${placeName(placeId)} (at the end).` });
    } catch (err) {
      console.error("Failed to undo removal:", err);
      setNotice({ kind: "error", text: `Couldn't put ${name} back: ${err instanceof Error ? err.message : err}` });
    }
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
        body: JSON.stringify({ trackUris: uris, source: "lost-tracks" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      // Now in a second place, so lost songs drop out of the lost list.
      const now = new Date().toISOString();
      applyMembership(
        destinationId,
        uris.map((uri) => [uri, now]),
        true
      );
      // The songs stay selected (until Clear selection), ready to add to
      // another playlist too.
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
              ["homes", "My playlists"],
              ["lost", "Lost tracks"],
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
          onClick={() => openGenreDialog("summary")}
          title="See which subgenres make up a playlist"
          className="ml-auto rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:border-green-600 hover:bg-green-600/10"
        >
          Playlist genres
        </button>
        <button
          type="button"
          onClick={() => openGenreDialog("generate")}
          title="Generate genre info for a playlist's songs that don't have it yet"
          className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:border-green-600 hover:bg-green-600/10"
        >
          Generate genres
        </button>
        {genreDialog?.kind === "summary" && (
          <PlaylistGenresDialog
            playlists={genreDialogPlaylists}
            initialPlaylistId={genreDialog.playlistId}
            onClose={() => setGenreDialog(null)}
            onGenerateMissing={(playlistId) => setGenreDialog({ kind: "generate", playlistId })}
          />
        )}
        {genreDialog?.kind === "generate" && (
          <GenerateGenresDialog
            playlists={genreDialogPlaylists}
            initialPlaylistId={genreDialog.playlistId}
            onClose={() => setGenreDialog(null)}
            currentTrackId={null}
            sourcePlaylistId={null}
            onGenerated={reloadGenres}
          />
        )}
        <button
          type="button"
          onClick={() => startLoad("update")}
          disabled={status === "loading"}
          title="Download playlists that changed or were never scanned"
          className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:border-neutral-500 disabled:opacity-50"
        >
          {status === "loading" && load.fetchMode !== "none" ? "Scanning…" : "Update library"}
        </button>
      </header>

      {status === "ready" && coverage && (
        <CoverageBar coverage={coverage} scanError={scanError} onFetch={startLoad} />
      )}

      {likedSongsStatus === "missing_scope" && status === "ready" && (
        <div className="flex items-center gap-3 border-b border-amber-900/50 bg-amber-950/40 px-4 py-2 text-sm text-amber-300">
          <span>Liked Songs isn&apos;t included yet. Spotify needs one more permission to read it.</span>
          <a href="/api/auth/login" className="rounded-full bg-green-600 px-3 py-1 font-semibold text-white hover:bg-green-500">
            Reconnect Spotify
          </a>
        </div>
      )}

      {status === "loading" && load.fetchMode === "none" && (
        <div className="flex flex-1 items-center justify-center text-neutral-400">Loading your saved library…</div>
      )}

      {status === "loading" && load.fetchMode !== "none" && (
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
            Only playlists that changed or haven&apos;t been saved yet are downloaded. What&apos;s downloaded is
            kept even if the scan stops part way.
          </p>
        </div>
      )}

      {status === "error" && (
        <div className="flex flex-1 items-center justify-center">
          <p className="rounded-md bg-red-900/30 px-3 py-2 text-sm text-red-400">Couldn&apos;t load your library: {error}</p>
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
                    {hiddenTotal > 0 && (
                      <span className="text-neutral-500">
                        · {hiddenTotal} hidden (at the bottom, can&apos;t be selected)
                      </span>
                    )}
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
              <button
                type="button"
                onClick={toggleShowGenres}
                aria-pressed={showGenres}
                title={showGenres ? "Hide the genre column" : "Show each song's subgenres and mood in a column"}
                className={`rounded border px-2 py-1 text-sm ${
                  showGenres
                    ? "border-green-700 bg-green-600/10 text-green-400"
                    : "border-neutral-700 text-neutral-400 hover:text-neutral-200"
                }`}
              >
                Genres
              </button>
            </div>
            {rows.length > 0 && (
              <SelectByBar
                playlists={selectByOptions.playlists}
                genres={selectByOptions.genres}
                onSelect={selectBy}
              />
            )}
            {mode === "homes" && selectedPlaceId && (
              <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800 px-4 py-2 text-xs text-neutral-400">
                <span>Hide songs also in:</span>
                {(hideRules[selectedPlaceId] ?? []).map((id) => (
                  <span key={id} className="flex items-center rounded-full border border-neutral-700 text-neutral-200">
                    <span className="max-w-[180px] truncate py-0.5 pl-2 pr-1">{placeName(id)}</span>
                    <button
                      type="button"
                      onClick={() =>
                        saveHideRules(
                          selectedPlaceId,
                          (hideRules[selectedPlaceId] ?? []).filter((ruleId) => ruleId !== id)
                        )
                      }
                      aria-label={`Stop hiding songs also in ${placeName(id)}`}
                      className="rounded-full pr-1.5 text-neutral-500 hover:text-red-400"
                    >
                      ×
                    </button>
                  </span>
                ))}
                <PlaylistPicker
                  playlists={[
                    ...(places[LIKED_SONGS_ID] ? [LIKED_SONGS_PICKER_ENTRY] : []),
                    ...playlists.filter((p) => places[p.id]),
                  ].filter((p) => p.id !== selectedPlaceId && !(hideRules[selectedPlaceId] ?? []).includes(p.id))}
                  selectedId={null}
                  onSelect={(id) => saveHideRules(selectedPlaceId, [...(hideRules[selectedPlaceId] ?? []), id])}
                  placeholder="+ Add playlist"
                />
                <button
                  type="button"
                  onClick={selectSongsLivingElsewhere}
                  title="Check every shown song that's also in another counted playlist, ready to remove from this one"
                  className="ml-auto rounded-md border border-neutral-700 px-2.5 py-1 text-xs text-neutral-200 hover:border-green-600 hover:bg-green-600/10"
                >
                  Select songs that live elsewhere
                </button>
              </div>
            )}

            <ul className="min-h-0 flex-1 overflow-y-auto">
              {[...rows, ...hiddenRows].map((row, index) => {
                const hidden = index >= rows.length;
                const reason = hidden && selectedPlaceId ? hiddenReason(row.songId, selectedPlaceId) : null;
                const isCurrent = row.uri === currentUri;
                return (
                  <li key={row.songId}>
                    {hidden && index === rows.length && (
                      <div className="mt-2 border-t border-neutral-800 px-4 pb-1 pt-2 text-[11px] uppercase tracking-wide text-neutral-500">
                        Hidden ({hiddenRows.length})
                      </div>
                    )}
                    <div
                      onClick={() => ready && playTrack(row.uri).catch((err) => console.error(err))}
                      title={ready ? "Click to play" : "Player is still connecting…"}
                      className={`group flex cursor-pointer items-center gap-3 px-4 py-1.5 text-sm ${
                        isCurrent
                          ? "bg-green-600/20 text-green-400"
                          : hidden
                            ? "text-neutral-300 opacity-40 hover:opacity-70"
                            : selected.has(row.uri)
                              ? "bg-neutral-800 text-neutral-100 hover:bg-neutral-700/80"
                              : "text-neutral-300 hover:bg-neutral-900"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={!hidden && selected.has(row.uri)}
                        disabled={hidden}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!hidden) toggleSelected(index, e.shiftKey);
                        }}
                        onChange={() => {}}
                        aria-label={hidden ? `${row.details.name} is hidden` : `Select ${row.details.name}`}
                        className="accent-green-600 disabled:cursor-not-allowed"
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
                              onRemove={id === LIKED_SONGS_ID ? undefined : () => removeSongsFromPlace([row.songId], id)}
                            />
                          ))}
                        </div>
                      )}
                      {hidden && reason && reason.alsoIn.length > 0 && (
                        <span className="max-w-[200px] flex-shrink-0 truncate text-[11px] text-neutral-400">
                          also in {reason.alsoIn.map(placeName).join(", ")}
                        </span>
                      )}
                      {mode === "homes" && selectedPlaceId && (!hidden || reason?.manual) && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (hidden) unhideRow(row, selectedPlaceId);
                            else hideRows([row], selectedPlaceId);
                          }}
                          title={
                            hidden
                              ? "Show this song normally again"
                              : "Move to the bottom of this playlist's list, greyed out and unselectable"
                          }
                          className={`flex-shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${
                            hidden
                              ? "border-neutral-600 text-neutral-200 hover:border-neutral-400"
                              : "border-neutral-800 text-neutral-500 opacity-0 hover:border-neutral-600 hover:text-neutral-200 focus:opacity-100 group-hover:opacity-100"
                          }`}
                        >
                          {hidden ? "Unhide" : "Hide"}
                        </button>
                      )}
                      {showGenres && (
                        <GenreCell
                          genres={genresFor(row)}
                          state={genreStatus[row.songId]}
                          onGenerate={(force) => generateGenres(row, force)}
                        />
                      )}
                      <span className="w-24 flex-shrink-0 text-right text-xs text-neutral-500">{formatAddedAt(row.addedAt)}</span>
                    </div>
                  </li>
                );
              })}
              {rows.length === 0 && (
                <li className="px-4 py-6 text-center text-sm text-neutral-500">
                  {mode === "homes"
                    ? selectedPlaceId
                      ? hiddenRows.length > 0
                        ? "Every song shown here is hidden."
                        : "No songs match this filter."
                      : "Pick a playlist on the left."
                    : Object.keys(places).length === 0
                      ? "Nothing saved yet. Playlists you open in the Subgenre sorter are saved as you go, or use Update above to scan."
                      : lostSongs.length === 0
                        ? "No lost songs. Everything saved lives in at least two places."
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
                <span className={`text-xs ${notice.kind === "ok" ? "text-green-400" : "text-red-400"}`}>
                  {notice.text}
                  {notice.onUndo && (
                    <button type="button" onClick={notice.onUndo} className="ml-2 font-semibold underline hover:text-white">
                      Undo
                    </button>
                  )}
                </span>
              )}
              <button
                type="button"
                onClick={() => {
                  setSelected(new Set());
                  lastToggledIndexRef.current = null;
                }}
                disabled={selected.size === 0}
                className="rounded-full border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:border-neutral-500 disabled:opacity-40"
              >
                Clear selection
                {selected.size > 0 && ` (${selectedRows.length}${
                  selected.size > selectedRows.length ? ` + ${selected.size - selectedRows.length} not shown` : ""
                })`}
              </button>
              {mode === "homes" && selectedPlaceId && (
                <button
                  type="button"
                  onClick={() => hideRows(selectedRows, selectedPlaceId)}
                  disabled={selectedRows.length === 0}
                  title="Move the checked songs to the bottom of this playlist's list, greyed out"
                  className="rounded-full border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:border-neutral-500 disabled:opacity-40"
                >
                  Hide {selectedRows.length}
                </button>
              )}
              {removePlaceId && (
                <button
                  type="button"
                  onClick={() => {
                    if (!removeArmed) {
                      setRemoveArmed(true);
                      return;
                    }
                    setRemoveArmed(false);
                    removeSongsFromPlace(selectedRows.map((r) => r.songId), removePlaceId);
                  }}
                  onMouseLeave={() => setRemoveArmed(false)}
                  onBlur={() => setRemoveArmed(false)}
                  disabled={removing || selectedRows.length === 0}
                  className={`max-w-[360px] truncate rounded-full border px-3 py-1.5 text-sm disabled:opacity-40 ${
                    removeArmed
                      ? "border-red-600 bg-red-900/50 text-red-100"
                      : "border-neutral-700 text-neutral-300 hover:border-red-500 hover:text-red-300"
                  }`}
                >
                  {removing
                    ? "Removing…"
                    : removeArmed
                      ? `Confirm: remove ${selectedRows.length}${wouldBeHomeless ? ` (${wouldBeHomeless} left with no home)` : ""}`
                      : `Remove ${selectedRows.length} from ${placeName(removePlaceId)}`}
                </button>
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
                    ? `${selectedRows.length - toAdd.length} of the selected songs are already in ${
                        destinationId ? placeName(destinationId) : "that playlist"
                      } (in some version) and will be skipped`
                    : undefined
                }
                className="rounded-full bg-green-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-green-500 disabled:opacity-40"
              >
                {adding
                  ? "Adding…"
                  : selectedRows.length === 0
                    ? "Add to playlist"
                    : toAdd.length === selectedRows.length
                      ? `Add ${toAdd.length} to playlist`
                      : toAdd.length === 0
                        ? `All ${selectedRows.length} already there`
                        : `Add ${toAdd.length} of ${selectedRows.length} (${selectedRows.length - toAdd.length} already there)`}
              </button>
            </footer>
          </section>
        </div>
      )}
      <NewPlaylistDialog dialogRef={newPlaylistDialogRef} onCreated={handlePlaylistCreated} showStar={false} />
    </div>
  );
}
