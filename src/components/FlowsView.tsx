"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { SpotifyPlaylist } from "@/lib/spotify/client";
import { LIKED_SONGS_ID, LIKED_SONGS_PICKER_ENTRY } from "@/lib/library";
import { FAMILY_NAMES, familyMark, familyTab, type GenreFamily } from "@/lib/genreFamily";
import { PlaylistPicker } from "./PlaylistPicker";
import { NewPlaylistDialog } from "./QuickActions";
import { CloseIcon } from "./Icons";

/*
 * Flows: playlists wired into one bigger playlist. Each source is a milk
 * crate of records in its genre family's colour; wires run into the target
 * crate, and Run flow adds the songs the target is missing. Running only
 * adds; nothing is ever taken out of the target.
 */

interface FlowSource {
  sourceId: string;
  families: GenreFamily[];
  genres: string[];
  minConfidence: number | null;
  includeUntagged: boolean;
}

interface Flow {
  id: number;
  name: string;
  targetId: string | null;
  lastRunAt: number | null;
  lastRunAdded: number | null;
  sources: FlowSource[];
  // How many songs running it would add, from the saved library.
  waiting: number;
}

interface Preview {
  sources: { sourceId: string; total: number; passing: number; newCount: number; covers: string[] }[];
  targetTotal: number;
  newTotal: number;
  newSongs: { uri: string; name: string; artists: string[]; image: string | null; from: string }[];
}

const FAMILIES: GenreFamily[] = ["house", "bass", "pop", "hiphop", "rock", "roots"];
const SHORT: Record<GenreFamily, string> = {
  house: "house",
  bass: "bass",
  rock: "rock",
  pop: "pop",
  hiphop: "hip hop",
  roots: "roots",
  none: "other",
};

// Board geometry: sources stack down the left, the target sits to the right.
const CRATE_W = 236;
const CRATE_H = 150;
const CRATE_GAP = 26;
const BOARD_PAD = 28;
// The target sits this far right when there's room, and wires shorten
// down to MIN_WIRE when there isn't (say, with the filter panel open).
const TARGET_X = 640;
const TARGET_W = 320;
const MIN_WIRE = 120;
// The board's side padding (px-8).
const BOARD_SIDES = 64;

function hasFilters(s: FlowSource) {
  return s.families.length > 0 || s.genres.length > 0 || s.minConfidence !== null;
}

// The wire's label, e.g. "house, uk garage, 70%+".
function filterSummary(s: FlowSource): string {
  const parts = [...s.families.map((f) => SHORT[f]), ...s.genres];
  if (s.minConfidence !== null) parts.push(`${s.minConfidence}%+`);
  return parts.join(", ");
}

async function send<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json as T;
}

function ago(ms: number): string {
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/** A milk crate of records: covers peek over the rim, the name is on a paper label. */
function Crate({
  name,
  detail,
  colour,
  covers,
  big = false,
  onClick,
  children,
}: {
  name: string;
  detail: string;
  colour: string;
  covers: string[];
  big?: boolean;
  onClick?: () => void;
  children?: ReactNode;
}) {
  const record = big ? 70 : 58;
  const step = big ? 46 : 40;
  const body = (
    <>
      {covers.slice(0, big ? 6 : 4).map((src, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={`${src}-${i}`}
          src={src}
          alt=""
          className="absolute rounded-[2px] object-cover shadow-[0_2px_6px_rgba(0,0,0,0.35)]"
          style={{
            left: 22 + i * step,
            top: (i % 2) * 6,
            width: record,
            height: record,
            transform: `rotate(${[-6, 3, -2, 5, -4, 2][i % 6]}deg)`,
          }}
        />
      ))}
      <div
        className="absolute inset-x-0 bottom-0 rounded-[9px] shadow-[inset_0_-10px_0_rgba(0,0,0,0.14),0_10px_24px_rgba(0,0,0,0.35)]"
        style={{ top: big ? 40 : 30, background: colour }}
      >
        <span
          className="absolute left-1/2 -translate-x-1/2 rounded-full bg-[#1a1613]/55"
          style={{ top: big ? 12 : 9, width: big ? 76 : 58, height: big ? 13 : 11 }}
        />
        <span className="absolute inset-x-3.5 h-0.5 bg-[#1a1613]/20" style={{ top: big ? 38 : 30 }} />
        <span
          className="absolute flex flex-col gap-px rounded-[4px] bg-[#f1e9dd] px-2.5 py-1.5 text-left text-[#1a1613]"
          style={{ left: big ? 24 : 18, right: big ? 24 : 18, top: big ? 52 : 40 }}
        >
          <span className={`font-narrow truncate font-bold ${big ? "text-xl" : "text-sm"}`}>{name}</span>
          <span className="truncate text-[11.5px] text-[#5a4c3f]">{detail}</span>
        </span>
      </div>
      {children}
    </>
  );
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className="relative block h-full w-full rounded-[9px] focus-visible:outline-offset-4"
      title={`Filters for ${name}`}
    >
      {body}
    </button>
  ) : (
    <div className="relative h-full w-full">{body}</div>
  );
}

export function FlowsView({ tabs }: { tabs: ReactNode }) {
  const [flows, setFlows] = useState<Flow[] | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([]);
  const [families, setFamilies] = useState<Record<string, { top: string[]; family: GenreFamily }>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const runDialogRef = useRef<HTMLDialogElement>(null);
  const newPlaylistRef = useRef<HTMLDialogElement>(null);
  const [boardWidth, setBoardWidth] = useState<number | null>(null);
  const boardObserver = useRef<ResizeObserver | null>(null);
  const measureBoard = useCallback((el: HTMLDivElement | null) => {
    boardObserver.current?.disconnect();
    if (!el) return;
    boardObserver.current = new ResizeObserver(() => setBoardWidth(el.clientWidth));
    boardObserver.current.observe(el);
  }, []);

  const flow = flows?.find((f) => f.id === selectedId) ?? null;

  const showFlows = useCallback((flows: Flow[]) => {
    setFlows(flows);
    setSelectedId((id) => (id !== null && flows.some((f) => f.id === id) ? id : (flows[0]?.id ?? null)));
  }, []);
  const loadFlows = useCallback(
    async () => showFlows((await send<{ flows: Flow[] }>("/api/flows", "GET")).flows),
    [showFlows]
  );

  useEffect(() => {
    send<{ flows: Flow[] }>("/api/flows", "GET")
      .then((body) => showFlows(body.flows))
      .catch((err) => setError(String(err.message ?? err)));
    fetch("/api/playlists")
      .then((res) => res.json())
      .then((body) => setPlaylists(body.playlists ?? []))
      .catch(() => {});
    fetch("/api/playlist-genre-summary")
      .then((res) => res.json())
      .then((body) => body.summaries && setFamilies(body.summaries))
      .catch(() => {});
  }, [showFlows]);

  const loadPreview = useCallback(async (flowId: number) => {
    setPreview(await send<Preview>(`/api/flows/${flowId}/preview`, "POST", {}));
  }, []);

  useEffect(() => {
    if (selectedId === null) return;
    let cancelled = false;
    send<Preview>(`/api/flows/${selectedId}/preview`, "POST", {})
      .then((p) => !cancelled && setPreview(p))
      .catch((err) => !cancelled && setError(String(err.message ?? err)));
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const placeName = (id: string) =>
    id === LIKED_SONGS_ID ? "Liked Songs" : (playlists.find((p) => p.id === id)?.name ?? "A playlist");
  const placeColour = (id: string) => familyTab(families[id]?.family ?? "none");
  const placeMark = (id: string) => familyMark(families[id]?.family ?? "none");

  // Saves a change to the selected flow, then refreshes it and its preview.
  const save = async (change: Partial<Pick<Flow, "name" | "targetId" | "sources">>) => {
    if (!flow) return;
    setError(null);
    try {
      await send(`/api/flows/${flow.id}`, "PUT", change);
      await loadFlows();
      await loadPreview(flow.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const createFlow = async () => {
    const name = newName.trim();
    if (!name) return;
    setError(null);
    try {
      const { flow } = await send<{ flow: Flow }>("/api/flows", "POST", { name });
      setNewName("");
      await loadFlows();
      setSelectedId(flow.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const deleteFlow = async () => {
    if (!flow || !window.confirm(`Delete the flow "${flow.name}"? Its playlist and songs stay as they are.`)) return;
    await send(`/api/flows/${flow.id}`, "DELETE").catch(() => {});
    setPreview(null);
    await loadFlows();
  };

  const run = async () => {
    if (!flow) return;
    setRunning(true);
    setError(null);
    try {
      const { added } = await send<{ added: number }>(`/api/flows/${flow.id}/run`, "POST");
      runDialogRef.current?.close();
      setNotice(
        added === 0
          ? `${placeName(flow.targetId!)} already had every song.`
          : `Added ${added} song${added === 1 ? "" : "s"} to ${placeName(flow.targetId!)}.`
      );
      await loadFlows();
      await loadPreview(flow.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  // Followed-only playlists can't be read (Spotify 403s), so they can't feed or be filled.
  const editable = playlists.filter((p) => p.canModify);
  const sourceOptions = flow
    ? [LIKED_SONGS_PICKER_ENTRY, ...editable].filter(
        (p) => p.id !== flow.targetId && !flow.sources.some((s) => s.sourceId === p.id)
      )
    : [];
  const targetOptions = flow ? editable.filter((p) => !flow.sources.some((s) => s.sourceId === p.id)) : [];

  const sources = flow?.sources ?? [];
  const targetX =
    boardWidth === null
      ? TARGET_X
      : Math.min(TARGET_X, Math.max(BOARD_PAD + CRATE_W + MIN_WIRE, boardWidth - BOARD_SIDES - TARGET_W));
  const boardHeight = Math.max(BOARD_PAD * 2 + sources.length * (CRATE_H + CRATE_GAP), 420);
  const targetTop = Math.max(BOARD_PAD, boardHeight / 2 - 150);
  const stats = (id: string) => preview?.sources.find((s) => s.sourceId === id);
  const target = flow?.targetId ? playlists.find((p) => p.id === flow.targetId) : undefined;
  const editingSource = sources.find((s) => s.sourceId === editing) ?? null;

  return (
    <div className="flex h-screen flex-col bg-ground text-ink">
      <header className="band flex items-center gap-3 px-4 py-2.5">
        {tabs}
        {flows && (
          <span className="text-[13px] text-muted">
            {flows.length === 0
              ? "No flows yet"
              : `${flows.length} flow${flows.length === 1 ? "" : "s"}, ${flows.filter((f) => f.waiting > 0).length} with new songs waiting`}
          </span>
        )}
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col gap-2.5 overflow-y-auto border-r border-line bg-side p-3.5">
          <h2 className="font-narrow text-base font-bold">Flows</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void createFlow();
            }}
            className="flex gap-2"
          >
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New flow name"
              aria-label="New flow name"
              className="min-w-0 flex-1 rounded-md border border-line bg-ground px-2.5 py-1.5 text-[13px] outline-none placeholder:text-faint focus:border-ink-2"
            />
            <button
              type="submit"
              disabled={!newName.trim()}
              className="rounded-md border border-line-strong px-3 text-[13px] font-semibold hover:bg-raised disabled:opacity-50"
            >
              Create
            </button>
          </form>
          {flows?.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => {
                setSelectedId(f.id);
                setEditing(null);
                setNotice(null);
              }}
              className={`flex flex-col gap-1.5 rounded-lg border px-3 py-2.5 text-left ${
                f.id === selectedId ? "border-line-strong bg-raised" : "border-line hover:bg-panel"
              }`}
            >
              <span className="font-narrow truncate text-[15px] font-bold">{f.name}</span>
              <span className="flex items-center gap-1">
                {f.sources.map((s) => (
                  <span key={s.sourceId} className="h-2 w-2 rounded-full" style={{ background: placeMark(s.sourceId) }} />
                ))}
                <span className="ml-1 text-xs text-muted">
                  {f.sources.length} crate{f.sources.length === 1 ? "" : "s"}
                  {f.targetId ? ` into ${placeName(f.targetId)}` : ""}
                </span>
              </span>
              <span className={`text-xs ${f.waiting > 0 ? "text-warn" : "text-muted"}`}>
                {!f.targetId
                  ? "No playlist to fill yet"
                  : f.waiting > 0
                    ? `${f.waiting} new song${f.waiting === 1 ? "" : "s"} waiting`
                    : f.lastRunAt
                      ? `Up to date, ran ${ago(f.lastRunAt)}`
                      : "Up to date"}
              </span>
            </button>
          ))}
          {flows?.length === 0 && (
            <p className="text-[13px] leading-relaxed text-muted">
              A flow pools playlists into one. Name one above, then wire in the playlists that feed it.
            </p>
          )}
        </aside>

        {/* The filter panel is a column of its own, so the board (and Run flow)
            scrolls beside it instead of hiding under it. */}
        <main className="flex min-h-0 min-w-0">
          <div ref={measureBoard} className="min-h-0 min-w-0 flex-1 overflow-auto">
            {!flow ? (
              <div className="flex h-full items-center justify-center p-8 text-center text-muted">
                {flows === null ? "Loading flows…" : "Create a flow on the left to start pooling playlists."}
              </div>
            ) : (
              <div className="px-8 py-6" style={{ minWidth: targetX + TARGET_W + BOARD_SIDES }}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1">
                    <h1 className="font-narrow text-3xl font-bold leading-tight">{flow.name}</h1>
                    <p className="max-w-[62ch] text-[13px] text-muted">
                      {sources.length === 0
                        ? "Add the playlists that feed this flow."
                        : `${sources.length} crate${sources.length === 1 ? " feeds" : "s feed"} ${
                            flow.targetId ? placeName(flow.targetId) : "this flow"
                          }. Running adds the songs it doesn't have yet; it never takes any out.`}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="w-52">
                      <PlaylistPicker
                        playlists={sourceOptions}
                        selectedId={null}
                        onSelect={(id) =>
                          void save({
                            sources: [...sources, { sourceId: id, families: [], genres: [], minConfidence: null, includeUntagged: false }],
                          })
                        }
                        placeholder="Add a crate"
                        fullWidth
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const name = window.prompt("Rename this flow", flow.name);
                        if (name?.trim()) void save({ name: name.trim() });
                      }}
                      className="rounded-md border border-line-strong px-3 py-1.5 text-[13px] font-medium hover:bg-raised"
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteFlow()}
                      className="rounded-md border border-danger/50 px-3 py-1.5 text-[13px] font-medium text-danger hover:bg-danger/10"
                    >
                      Delete flow
                    </button>
                  </div>
                </div>

                {error && <p className="mt-3 text-[13px] text-danger">{error}</p>}
                {notice && <p className="mt-3 text-[13px] text-ok">{notice}</p>}

                <div className="relative mt-6" style={{ height: boardHeight }}>
                  <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
                    {flow.targetId &&
                      sources.map((s, i) => {
                        const x1 = BOARD_PAD + CRATE_W;
                        const y1 = BOARD_PAD + i * (CRATE_H + CRATE_GAP) + 100;
                        const x2 = targetX;
                        const bend = (x2 - x1) / 2;
                        const y2 = targetTop + 120 + (i - (sources.length - 1) / 2) * 18;
                        const dim = editing !== null && editing !== s.sourceId;
                        const colour = placeMark(s.sourceId);
                        return (
                          <g key={s.sourceId} opacity={dim ? 0.4 : 1}>
                            <path
                              d={`M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`}
                              fill="none"
                              stroke={colour}
                              strokeWidth={editing === s.sourceId ? 5 : 3}
                              strokeLinecap="round"
                            />
                            <circle cx={x1} cy={y1} r={5} fill="var(--ground)" stroke={colour} strokeWidth={2.5} />
                            <circle cx={x2} cy={y2} r={5} fill="var(--ground)" stroke={colour} strokeWidth={2.5} />
                          </g>
                        );
                      })}
                  </svg>

                  {sources.map((s, i) => {
                    const st = stats(s.sourceId);
                    const top = BOARD_PAD + i * (CRATE_H + CRATE_GAP);
                    const label = hasFilters(s) ? filterSummary(s) : null;
                    return (
                      <div key={s.sourceId}>
                        <div className="absolute" style={{ left: BOARD_PAD, top, width: CRATE_W, height: CRATE_H }}>
                          <Crate
                            name={placeName(s.sourceId)}
                            detail={
                              st
                                ? hasFilters(s)
                                  ? `${st.passing} of ${st.total} songs pass`
                                  : `${st.total} songs`
                                : "Not saved yet: scan it in My library"
                            }
                            colour={placeColour(s.sourceId)}
                            covers={st?.covers ?? []}
                            onClick={() => setEditing(s.sourceId)}
                          />
                        </div>
                        {flow.targetId && (
                          <button
                            type="button"
                            onClick={() => setEditing(s.sourceId)}
                            className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-full border bg-panel px-2.5 py-1 text-xs font-semibold hover:bg-raised"
                            style={{
                              left: (BOARD_PAD + CRATE_W + targetX) / 2,
                              top: (top + 100 + targetTop + 120 + (i - (sources.length - 1) / 2) * 18) / 2,
                              borderColor: placeMark(s.sourceId),
                            }}
                          >
                            <span className="h-[7px] w-[7px] rounded-full" style={{ background: placeMark(s.sourceId) }} />
                            {label ?? (st && st.newCount > 0 ? `+${st.newCount}` : "all songs")}
                          </button>
                        )}
                      </div>
                    );
                  })}

                  <div className="absolute" style={{ left: targetX, top: targetTop, width: TARGET_W, height: 300 }}>
                    {flow.targetId ? (
                      <div className="relative h-[236px]">
                        <Crate
                          big
                          name={placeName(flow.targetId)}
                          detail={`${preview?.targetTotal ?? target?.tracks?.total ?? "?"} songs${
                            flow.lastRunAt ? `, last run ${ago(flow.lastRunAt)}` : ""
                          }`}
                          colour="var(--band)"
                          covers={[
                            ...(preview?.newSongs.map((s) => s.image).filter((c): c is string => !!c) ?? []),
                            ...(target?.images?.[0] ? [target.images[0].url] : []),
                          ]}
                        />
                      </div>
                    ) : (
                      <div className="flex h-[236px] flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-line-strong p-5 text-center">
                        <p className="text-[13px] text-muted">Which playlist should this flow fill?</p>
                      </div>
                    )}
                    <div className="mt-3 space-y-2">
                      {flow.targetId ? (
                        <button
                          type="button"
                          onClick={() => runDialogRef.current?.showModal()}
                          disabled={!preview || sources.length === 0}
                          className="flex h-11 w-full items-center justify-center gap-2.5 rounded-lg bg-ink text-[15px] font-bold text-ground hover:bg-ink-2 disabled:opacity-50"
                        >
                          Run flow
                          <span className="text-[13px] font-medium opacity-75">
                            {preview ? `${preview.newTotal} new song${preview.newTotal === 1 ? "" : "s"}` : "…"}
                          </span>
                        </button>
                      ) : null}
                      <div className="flex gap-2">
                        <div className="min-w-0 flex-1">
                          <PlaylistPicker
                            playlists={targetOptions}
                            selectedId={null}
                            onSelect={(id) =>
                              void save({ targetId: id, sources: sources.filter((s) => s.sourceId !== id) })
                            }
                            placeholder={flow.targetId ? "Fill a different playlist" : "Pick a playlist to fill"}
                            fullWidth
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => newPlaylistRef.current?.showModal()}
                          className="rounded-md border border-line-strong px-3 text-[13px] font-medium hover:bg-raised"
                        >
                          New playlist
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {flow && editingSource && (
            <FilterPanel
              key={editingSource.sourceId}
              flowId={flow.id}
              allSources={sources}
              source={editingSource}
              name={placeName(editingSource.sourceId)}
              targetName={flow.targetId ? placeName(flow.targetId) : "this flow"}
              onClose={() => setEditing(null)}
              onSave={async (updated) => {
                await save({ sources: sources.map((s) => (s.sourceId === updated.sourceId ? updated : s)) });
                setEditing(null);
              }}
              onUnplug={async () => {
                await save({ sources: sources.filter((s) => s.sourceId !== editingSource.sourceId) });
                setEditing(null);
              }}
            />
          )}
        </main>
      </div>

      <dialog
        ref={runDialogRef}
        aria-labelledby="run-title"
        className="m-auto w-full max-w-xl overflow-hidden rounded-xl bg-panel p-0 text-ink shadow-[0_24px_60px_rgba(0,0,0,0.45)] backdrop:bg-black/60"
      >
        {flow && preview && (
          <>
            <div className="band px-6 py-3.5">
              <h2 id="run-title" className="font-narrow text-xl font-bold">
                Run {flow.name}
              </h2>
            </div>
            <div className="space-y-4 p-6">
              <p className="text-sm leading-relaxed">
                {preview.newTotal === 0
                  ? `${placeName(flow.targetId!)} already has every song these crates would add.`
                  : `${preview.newTotal} song${preview.newTotal === 1 ? "" : "s"} from ${sources.length} crate${
                      sources.length === 1 ? "" : "s"
                    } aren't in ${placeName(flow.targetId!)} yet. Running adds them to the end. Nothing already in it is removed.`}
              </p>
              <p className="text-xs text-muted">
                Each crate is checked with Spotify first, so the final count can differ a little from this one.
              </p>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
                {preview.sources.map((s) => (
                  <div
                    key={s.sourceId}
                    className="rounded-lg border-t-[3px] bg-ground p-2.5"
                    style={{ borderTopColor: placeMark(s.sourceId) }}
                  >
                    <div className="text-lg font-bold">+{s.newCount}</div>
                    <div className="truncate text-xs text-muted">{placeName(s.sourceId)}</div>
                  </div>
                ))}
              </div>
              {preview.newSongs.length > 0 && (
                <ul className="max-h-56 overflow-y-auto rounded-lg border border-line">
                  {preview.newSongs.slice(0, 20).map((s) => (
                    <li key={s.uri} className="flex items-center gap-2.5 border-b border-line px-3 py-1.5 last:border-b-0">
                      {s.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={s.image} alt="" className="h-7 w-7 rounded-[3px] object-cover" />
                      ) : (
                        <span className="h-7 w-7 rounded-[3px] bg-raised" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-[13.5px]">
                        {s.name} <span className="text-muted">{s.artists.join(", ")}</span>
                      </span>
                      <span className="text-xs text-muted">from {placeName(s.from)}</span>
                    </li>
                  ))}
                  {preview.newTotal > 20 && <li className="px-3 py-1.5 text-[12.5px] text-muted">and {preview.newTotal - 20} more</li>}
                </ul>
              )}
              {error && <p className="text-[13px] text-danger">{error}</p>}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => runDialogRef.current?.close()}
                  className="rounded-md border border-line-strong px-3.5 py-2 text-[13px] font-medium hover:bg-raised"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void run()}
                  disabled={running || preview.newTotal === 0}
                  className="rounded-md bg-ink px-4 py-2 text-[13px] font-bold text-ground hover:bg-ink-2 disabled:opacity-50"
                >
                  {running ? "Adding…" : `Add ${preview.newTotal} song${preview.newTotal === 1 ? "" : "s"}`}
                </button>
              </div>
            </div>
          </>
        )}
      </dialog>

      <NewPlaylistDialog
        dialogRef={newPlaylistRef}
        showStar={false}
        onCreated={(playlist) => {
          setPlaylists((prev) => [playlist, ...prev]);
          void save({ targetId: playlist.id });
        }}
      />
    </div>
  );
}

/** One wire's filters, with a live count of what gets through. */
function FilterPanel({
  flowId,
  allSources,
  source,
  name,
  targetName,
  onClose,
  onSave,
  onUnplug,
}: {
  flowId: number;
  allSources: FlowSource[];
  source: FlowSource;
  name: string;
  targetName: string;
  onClose: () => void;
  onSave: (source: FlowSource) => Promise<void>;
  onUnplug: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(source);
  const [genreDraft, setGenreDraft] = useState("");
  const [count, setCount] = useState<{ total: number; passing: number; newCount: number } | null>(null);
  const [saving, setSaving] = useState(false);

  // Recounted (from the saved library) as the filters change.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      send<Preview>(`/api/flows/${flowId}/preview`, "POST", {
        sources: allSources.map((s) => (s.sourceId === draft.sourceId ? draft : s)),
      })
        .then((p) => {
          const st = p.sources.find((s) => s.sourceId === draft.sourceId);
          if (!cancelled && st) setCount(st);
        })
        .catch(() => {});
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [draft, flowId, allSources]);

  const toggleFamily = (f: GenreFamily) =>
    setDraft((d) => ({ ...d, families: d.families.includes(f) ? d.families.filter((x) => x !== f) : [...d.families, f] }));
  const addGenre = () => {
    const g = genreDraft.trim().toLowerCase();
    if (g && !draft.genres.includes(g)) setDraft((d) => ({ ...d, genres: [...d.genres, g] }));
    setGenreDraft("");
  };
  const filtered = hasFilters(draft);

  return (
    <aside
      aria-label={`Filters for ${name}`}
      className="flex w-[380px] shrink-0 flex-col gap-5 overflow-y-auto border-l border-line bg-panel px-5 py-5 shadow-[-16px_0_40px_rgba(0,0,0,0.3)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-muted">Wire</p>
          <h2 className="font-narrow text-xl font-bold leading-tight">
            {name} into {targetName}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close filters"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-raised hover:bg-line"
        >
          <CloseIcon size={14} />
        </button>
      </div>

      <fieldset className="space-y-2">
        <legend className="mb-2 text-[13px] font-semibold">Let songs through from these genre families</legend>
        <div className="flex flex-wrap gap-1.5">
          {FAMILIES.map((f) => {
            const on = draft.families.includes(f);
            return (
              <button
                key={f}
                type="button"
                aria-pressed={on}
                onClick={() => toggleFamily(f)}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12.5px] ${
                  on ? "bg-raised font-bold" : "border-line font-medium hover:bg-raised"
                }`}
                style={on ? { borderColor: familyMark(f) } : undefined}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: familyMark(f) }} />
                {FAMILY_NAMES[f]}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="space-y-2">
        <span className="block text-[13px] font-semibold">Or these exact genres</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {draft.genres.map((g) => (
            <span key={g} className="inline-flex items-center gap-1 rounded-md bg-raised py-1 pl-2.5 pr-1 text-[12.5px]">
              {g}
              <button
                type="button"
                aria-label={`Remove ${g}`}
                onClick={() => setDraft((d) => ({ ...d, genres: d.genres.filter((x) => x !== g) }))}
                className="rounded px-1 text-muted hover:text-ink"
              >
                <CloseIcon size={11} />
              </button>
            </span>
          ))}
          <input
            value={genreDraft}
            onChange={(e) => setGenreDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addGenre();
              }
            }}
            onBlur={addGenre}
            placeholder="Add a genre"
            aria-label="Add a genre"
            className="min-w-28 flex-1 rounded-md border border-dashed border-line-strong bg-transparent px-2.5 py-1 text-[12.5px] outline-none placeholder:text-faint focus:border-ink-2"
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="flex items-center justify-between gap-3 text-[13px] font-semibold">
          <span className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.minConfidence !== null}
              onChange={(e) => setDraft((d) => ({ ...d, minConfidence: e.target.checked ? 70 : null }))}
              className="accent-band"
            />
            Only songs the AI is at least this sure of
          </span>
          {draft.minConfidence !== null && <span className="font-bold">{draft.minConfidence}%</span>}
        </label>
        {draft.minConfidence !== null && (
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={draft.minConfidence}
            onChange={(e) => setDraft((d) => ({ ...d, minConfidence: Number(e.target.value) }))}
            aria-label="Minimum confidence"
            className="w-full accent-[var(--ink)]"
          />
        )}
      </div>

      {filtered && (
        <div className="space-y-2">
          <span id="untagged-label" className="block text-[13px] font-semibold">
            Songs with no tags yet
          </span>
          <div role="radiogroup" aria-labelledby="untagged-label" className="inline-flex gap-0.5 rounded-md border border-line bg-ground p-0.5">
            {[
              [false, "Leave out"],
              [true, "Let through"],
            ].map(([value, label]) => (
              <button
                key={String(value)}
                type="button"
                role="radio"
                aria-checked={draft.includeUntagged === value}
                onClick={() => setDraft((d) => ({ ...d, includeUntagged: value as boolean }))}
                className={`rounded-[5px] px-3 py-1 text-[13px] ${
                  draft.includeUntagged === value ? "bg-raised font-semibold ring-1 ring-line-strong" : "text-ink-2 hover:bg-raised"
                }`}
              >
                {label as string}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-auto space-y-1 rounded-lg bg-ground px-3.5 py-3">
        {count ? (
          <>
            <p className="text-[15px] font-bold">
              {filtered ? `${count.passing} of ${count.total} songs pass` : `All ${count.total} songs pass`}
            </p>
            <p className="text-[12.5px] text-muted">
              {count.newCount === 0
                ? `${targetName} already has all of them.`
                : `${count.newCount} of them ${count.newCount === 1 ? "isn't" : "aren't"} in ${targetName} yet.`}
            </p>
          </>
        ) : (
          <p className="text-[13px] text-muted">Counting…</p>
        )}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            await onSave(draft);
            setSaving(false);
          }}
          className="flex-1 rounded-md bg-ink py-2 text-[13px] font-bold text-ground hover:bg-ink-2 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save filters"}
        </button>
        <button
          type="button"
          onClick={() => void onUnplug()}
          className="rounded-md border border-danger/50 px-3.5 text-[13px] font-medium text-danger hover:bg-danger/10"
        >
          Unplug crate
        </button>
      </div>
    </aside>
  );
}
