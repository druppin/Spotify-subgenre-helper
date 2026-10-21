"use client";

import { memo, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { LIKED_SONGS_ID, type LibraryTrackDetails } from "@/lib/library";
import type { StoredTags } from "@/lib/llm/types";
import { GenreChips, GenreTagEditor } from "./GenreTagEditor";
import { CloseIcon, PauseIcon, PencilIcon, PlayIcon, RefreshIcon } from "./Icons";

// One song as it appears in one place (Liked Songs or an editable playlist).
// Versions of the same song (see groupSongs) share a songId, so a single in
// one playlist and its album version in another count as one song in two.
export interface SongRow {
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
export interface SongGenres extends StoredTags {
  // own, then broader.
  subgenres: string[];
  moodVibe: string;
  rationale?: string;
}

// Other homes shown as chips in a song's row before the rest fold into "+N",
// so a song in many playlists doesn't make its row taller.
const MAX_PLACE_CHIPS = 3;

function formatAddedAt(addedAt: string): string {
  const date = new Date(addedAt);
  // Very old playlist entries come back with a 1970 placeholder date.
  if (Number.isNaN(date.getTime()) || date.getFullYear() < 2000) return "—";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

// A song's genre info as a column in its row: subgenres and mood, with
// the AI's reasoning on hover, and ways to edit the tags or generate or
// regenerate them.
// What a song with no tags starts from in the tag editor.
const NO_GENRES: SongGenres = {
  own: [],
  broader: [],
  subgenres: [],
  edited: false,
  confidence: {},
  userTags: [],
  songConfidence: null,
  moodVibe: "",
};

function GenreCell({
  genres,
  state,
  expandAll,
  onGenerate,
  onSaveTags,
}: {
  genres: SongGenres | undefined;
  // The list's "expand all genres" switch; each row can still be flipped.
  expandAll: boolean;
  // "loading" while generating, an error message if that failed.
  state: "loading" | { error: string } | undefined;
  onGenerate: (force: boolean) => void;
  onSaveTags: (tags: string[]) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  // Tags show on one line; the ones that don't fit are counted and can be
  // expanded into view.
  const [expanded, setExpanded] = useState(expandAll);
  // Follows the switch whenever it's flipped (React's "adjust state when a
  // prop changes" pattern).
  const [lastExpandAll, setLastExpandAll] = useState(expandAll);
  if (expandAll !== lastExpandAll) {
    setLastExpandAll(expandAll);
    setExpanded(expandAll);
  }
  const [hiddenCount, setHiddenCount] = useState(0);
  const chipsRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = chipsRef.current;
    if (!el) return;
    const count = () => {
      // Off-screen rows skip layout (see the row's content-visibility);
      // measuring them would force it. They're counted on coming back
      // into view instead, since the folded line keeps its size even when
      // the tags changed meanwhile.
      if (!el.checkVisibility({ contentVisibilityAuto: true })) return;
      const items = [...el.children] as HTMLElement[];
      const firstTop = items[0]?.offsetTop ?? 0;
      setHiddenCount(items.filter((item) => item.offsetTop > firstTop).length);
    };
    count();
    const observer = new ResizeObserver(count);
    observer.observe(el);
    const row = el.closest("li");
    row?.addEventListener("contentvisibilityautostatechange", count);
    return () => {
      observer.disconnect();
      row?.removeEventListener("contentvisibilityautostatechange", count);
    };
  }, [genres, editing]);
  const loading = state === "loading";
  const error = state && state !== "loading" ? state.error : null;
  return (
    <div className="w-64 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
      {editing ? (
        <GenreTagEditor
          genres={genres ?? NO_GENRES}
          size="sm"
          onSave={async (tags) => {
            await onSaveTags(tags);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : genres ? (
        <div
          title={
            [genres.edited && "Tags edited by you", genres.moodVibe, genres.rationale].filter(Boolean).join("\n\n") ||
            undefined
          }
          className="flex items-center gap-1"
        >
          <div className="min-w-0 flex-1">
            <div
              ref={chipsRef}
              className={`flex flex-wrap gap-1 ${expanded ? "" : "max-h-[1.25rem] overflow-hidden"}`}
            >
              <GenreChips genres={genres} size="sm" />
              {genres.subgenres.length === 0 && <span className="text-[11px] text-muted">No subgenres listed.</span>}
            </div>
            {/* Counted open or folded: tags past the first line. */}
            {hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => setExpanded((open) => !open)}
                aria-expanded={expanded}
                className="text-[11px] text-muted underline-offset-2 hover:text-ink hover:underline"
              >
                {expanded ? "Show less" : `+${hiddenCount} more`}
              </button>
            )}
          </div>
          <div
            className={`flex flex-shrink-0 items-center gap-1 ${
              loading ? "" : "opacity-0 focus-within:opacity-100 group-hover:opacity-100"
            }`}
          >
            <button
              type="button"
              onClick={() => setEditing(true)}
              disabled={loading}
              title="Change, remove, or add tags"
              aria-label="Edit tags"
              className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-raised hover:text-ink disabled:opacity-50"
            >
              <PencilIcon size={14} />
            </button>
            <button
              type="button"
              onClick={() => {
                if (genres.edited && !confirm("Regenerating replaces the tags you edited with the AI's. Go ahead?")) {
                  return;
                }
                onGenerate(true);
              }}
              disabled={loading}
              title="Not right? Generate fresh genre info for this song."
              aria-label="Regenerate genre info"
              className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-raised hover:text-ink disabled:opacity-50"
            >
              <RefreshIcon size={14} className={loading ? "animate-spin motion-reduce:animate-none" : undefined} />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onGenerate(false)}
            disabled={loading}
            className="rounded-md border border-line px-2 py-0.5 text-[11px] text-muted hover:border-ink-2 hover:bg-raised hover:text-ink disabled:opacity-50"
          >
            {loading ? "Generating…" : "Generate genre info"}
          </button>
          {!loading && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              title="Tag this song yourself"
              className="rounded-md border border-line px-2 py-0.5 text-[11px] text-muted hover:border-ink-2 hover:bg-raised hover:text-ink"
            >
              Add tags
            </button>
          )}
        </div>
      )}
      {error && (
        <div className="mt-0.5 truncate text-[11px] text-danger" title={error}>
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
        className="max-w-[180px] truncate rounded-full border border-danger bg-danger/20 px-2 py-0.5 text-[11px] text-danger"
      >
        Remove from {name}?
      </button>
    );
  }
  return (
    <span
      className={`flex min-w-0 max-w-[180px] flex-shrink items-center rounded-full border text-[11px] ${
        ignored
          ? "border-line text-faint"
          : "border-line-strong text-ink-2 hover:border-ink-2"
      }`}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        title={ignored ? `${name} (not counted as a home)` : `Show ${name}`}
        className={`truncate py-0.5 ${onRemove ? "pl-2 pr-1" : "px-2"} ${ignored ? "line-through" : "hover:text-ink"}`}
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
          className="rounded-full pr-1.5 text-muted hover:text-danger"
        >
          <CloseIcon size={12} />
        </button>
      )}
    </span>
  );
}

// What a row can ask the list to do. The list keeps these in a ref that's
// current as of its last render, so rows never re-render just because the
// list made new functions.
export interface SongRowActions {
  play: (uri: string) => void;
  toggleSelected: (uri: string, shiftKey: boolean) => void;
  openInfo: (uri: string) => void;
  openVersions: (songId: string) => void;
  showPlace: (placeId: string) => void;
  removeFromPlace: (songId: string, placeId: string) => void;
  togglePlaces: (songId: string) => void;
  hide: (row: SongRow) => void;
  unhide: (row: SongRow) => void;
  generateGenres: (row: SongRow, force: boolean) => void;
  saveTags: (row: SongRow, tags: string[]) => Promise<void>;
}

/**
 * One song in My library's list. Memoized: typing in a search box re-renders
 * the list, and with thousands of songs redrawing every row is what lagged.
 */
export const LibrarySongRow = memo(function LibrarySongRow({
  row,
  hidden,
  hiddenHeaderCount,
  hiddenReason,
  current,
  selected,
  ready,
  mode,
  selectedPlaceId,
  showVersions,
  placesExpanded,
  placeName,
  ignoredIds,
  showGenres,
  genres,
  genreState,
  genresExpandAll,
  actions,
}: {
  row: SongRow;
  // Hidden in this playlist: greyed out at the bottom, can't be selected.
  hidden: boolean;
  // Set on the first hidden row, which heads the hidden ones.
  hiddenHeaderCount?: number;
  hiddenReason: (songId: string, placeId: string) => { manual: boolean; alsoIn: string[] } | null;
  // Whether this is the song in the player, and its state.
  current: "playing" | "paused" | null;
  selected: boolean;
  ready: boolean;
  mode: "lost" | "homes";
  selectedPlaceId: string | null;
  showVersions: boolean;
  placesExpanded: boolean;
  placeName: (id: string) => string;
  ignoredIds: Set<string>;
  showGenres: boolean;
  genres: SongGenres | undefined;
  genreState: "loading" | { error: string } | undefined;
  genresExpandAll: boolean;
  actions: RefObject<SongRowActions>;
}) {
  const reason = hidden && selectedPlaceId ? hiddenReason(row.songId, selectedPlaceId) : null;
  return (
    // Off-screen rows skip layout and paint, so a change elsewhere on the
    // page doesn't re-lay out thousands of them. "auto" keeps each row's
    // last rendered height for the scrollbar.
    <li className="[content-visibility:auto] [contain-intrinsic-size:auto_2.5rem]">
      {hiddenHeaderCount !== undefined && (
        <div className="mt-2 border-t border-line px-4 pb-1 pt-2 text-xs font-semibold text-muted">
          Hidden ({hiddenHeaderCount})
        </div>
      )}
      <div
        onClick={() => actions.current.play(row.uri)}
        title={ready ? "Click to play" : "Player is still connecting…"}
        className={`group flex cursor-pointer items-center gap-3 px-4 py-1 text-sm ${
          current
            ? "bg-raised text-ink"
            : hidden
              ? "text-ink-2 opacity-40 hover:opacity-70"
              : selected
                ? "bg-raised text-ink hover:bg-line"
                : "text-ink-2 hover:bg-panel"
        }`}
      >
        <input
          type="checkbox"
          checked={!hidden && selected}
          disabled={hidden}
          onClick={(e) => {
            e.stopPropagation();
            if (!hidden) actions.current.toggleSelected(row.uri, e.shiftKey);
          }}
          onChange={() => {}}
          aria-label={hidden ? `${row.details.name} is hidden` : `Select ${row.details.name}`}
          className="accent-band disabled:cursor-not-allowed"
        />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            actions.current.openInfo(row.uri);
          }}
          title="Open the song's genres, AI notes and chat"
          aria-label={`Open ${row.details.name}'s genres and AI notes`}
          className="flex-shrink-0 rounded hover:ring-2 hover:ring-line-strong"
        >
          {row.details.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={row.details.image} alt="" loading="lazy" className="h-8 w-8 rounded object-cover" />
          ) : (
            <div className="h-8 w-8 rounded bg-raised" />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-medium">
              {current && (
                <span className="mr-1.5 inline-flex align-[-2px]">
                  {current === "paused" ? <PauseIcon size={13} /> : <PlayIcon size={13} />}
                </span>
              )}
              {row.details.name}
            </span>
            {showVersions && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  actions.current.openVersions(row.songId);
                }}
                className="flex-shrink-0 rounded bg-raised px-1 text-[11px] text-muted hover:bg-line hover:text-ink"
                title="Released more than once (e.g. single and album); counted as one song. Click to compare them."
              >
                {row.versions} versions
              </button>
            )}
          </div>
          <div className="truncate text-xs text-muted">{row.details.artists.join(", ")}</div>
        </div>
        {mode === "lost" && !selectedPlaceId && (
          <span className="hidden max-w-[200px] truncate text-xs text-muted md:block">{placeName(row.placeId)}</span>
        )}
        {mode === "homes" && (
          <div
            className={`hidden max-w-[45%] items-center justify-end gap-1 md:flex ${
              placesExpanded ? "flex-wrap py-1" : "flex-nowrap overflow-hidden"
            }`}
          >
            {row.countedOtherHomes === 0 && (
              <span className="flex-shrink-0 rounded-full bg-warn/20 px-2 py-0.5 text-[11px] text-warn">
                Only here
              </span>
            )}
            {(placesExpanded ? row.otherPlaceIds : row.otherPlaceIds.slice(0, MAX_PLACE_CHIPS)).map((id) => (
              <PlaceChip
                key={id}
                name={placeName(id)}
                ignored={ignoredIds.has(id)}
                onClick={() => actions.current.showPlace(id)}
                onRemove={id === LIKED_SONGS_ID ? undefined : () => actions.current.removeFromPlace(row.songId, id)}
              />
            ))}
            {row.otherPlaceIds.length > MAX_PLACE_CHIPS && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  actions.current.togglePlaces(row.songId);
                }}
                aria-expanded={placesExpanded}
                className="flex-shrink-0 rounded-full border border-line px-2 py-0.5 text-[11px] text-muted hover:border-ink-2 hover:text-ink"
                title={
                  placesExpanded
                    ? "Fold these back"
                    : `Also in ${row.otherPlaceIds.slice(MAX_PLACE_CHIPS).map(placeName).join(", ")}`
                }
              >
                {placesExpanded ? "Show less" : `+${row.otherPlaceIds.length - MAX_PLACE_CHIPS}`}
              </button>
            )}
          </div>
        )}
        {hidden && reason && reason.alsoIn.length > 0 && (
          <span className="max-w-[200px] flex-shrink-0 truncate text-[11px] text-muted">
            also in {reason.alsoIn.map(placeName).join(", ")}
          </span>
        )}
        {mode === "homes" && selectedPlaceId && (!hidden || reason?.manual) && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (hidden) actions.current.unhide(row);
              else actions.current.hide(row);
            }}
            title={
              hidden ? "Show this song normally again" : "Move to the bottom of this playlist's list, greyed out and unselectable"
            }
            className={`flex-shrink-0 rounded border px-1.5 py-0.5 text-[11px] ${
              hidden
                ? "border-line-strong text-ink hover:border-muted"
                : "border-line text-muted opacity-0 hover:border-line-strong hover:text-ink focus:opacity-100 group-hover:opacity-100"
            }`}
          >
            {hidden ? "Unhide" : "Hide"}
          </button>
        )}
        {showGenres && (
          <GenreCell
            genres={genres}
            expandAll={genresExpandAll}
            state={genreState}
            onGenerate={(force) => actions.current.generateGenres(row, force)}
            onSaveTags={(tags) => actions.current.saveTags(row, tags)}
          />
        )}
        <span className="w-24 flex-shrink-0 text-right text-xs text-muted">{formatAddedAt(row.addedAt)}</span>
      </div>
    </li>
  );
});
