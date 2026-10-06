"use client";

import { useEffect, useState } from "react";
import { PlayerProvider } from "./PlayerProvider";
import { Dashboard } from "./Dashboard";
import { LostTracksView } from "./LostTracksView";
import type { OrganizeStats } from "@/lib/organizeLog";

const TABS = [
  { id: "subgenres", label: "Subgenre sorter" },
  { id: "lost", label: "Lost tracks" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const TAB_STORAGE_KEY = "app.activeTab";

function loadTab(): TabId {
  try {
    const saved = localStorage.getItem(TAB_STORAGE_KEY);
    if (TABS.some((t) => t.id === saved)) return saved as TabId;
  } catch {
    // Storage unavailable — fall back to the default tab.
  }
  return "subgenres";
}

// Songs this app has filed into playlists, per tool: exact since tracking
// began, plus an estimate (shown with ~) for the time before that.
function OrganizedCount({ stats }: { stats: OrganizeStats }) {
  const before = stats.before?.bySource ?? { sorter: 0, "lost-tracks": 0 };
  const sorter = before.sorter + stats.bySource.sorter;
  const lost = before["lost-tracks"] + stats.bySource["lost-tracks"];
  const estimated = (stats.before?.songs ?? 0) > 0;
  const approx = estimated ? "~" : "";
  return (
    <span
      className="ml-2 text-xs text-neutral-500"
      title={
        `Since tracking began: ${stats.songsOrganized} songs (${stats.bySource.sorter} sorter, ` +
        `${stats.bySource["lost-tracks"]} Lost tracks), ${stats.adds} adds. ` +
        `Moves: ${stats.movesBySource.sorter} sorter, ${stats.movesBySource["lost-tracks"]} Lost tracks. ` +
        `Removals: ${stats.removalsBySource.sorter} sorter, ${stats.removalsBySource["lost-tracks"]} Lost tracks. ` +
        `A removal counts as a move when the song was also added to another playlist within 2 hours. ` +
        `Moves and removals are only counted from when tracking began.` +
        (estimated
          ? ` Before that (estimated from when songs were added to your playlists): ${before.sorter} sorter, ` +
            `${before["lost-tracks"]} Lost tracks — an upper bound that may include adds made in Spotify itself.`
          : "")
      }
    >
      {approx}
      {sorter + lost} songs organized · Subgenre sorter {approx}
      {sorter} · Lost tracks {approx}
      {lost} · {stats.moves} move{stats.moves === 1 ? "" : "s"} · {stats.removals} removal
      {stats.removals === 1 ? "" : "s"}
    </span>
  );
}

/**
 * Top-level layout: one shared player, with each tool as a tab. Tabs stay
 * mounted once visited (just hidden) so switching away doesn't lose a
 * tool's place, and a tab is only mounted on its first visit so a tool's
 * startup work doesn't run until it's wanted.
 */
export function AppShell() {
  // Only ever mounted client-side (AuthGate renders it after a fetch), so
  // reading localStorage in the initializer can't cause a hydration mismatch.
  const [activeTab, setActiveTab] = useState<TabId>(loadTab);
  const [visited, setVisited] = useState<Set<TabId>>(() => new Set([activeTab]));

  // Spotify can block the app for many hours after too many requests; say
  // so up front instead of letting every action fail one at a time.
  const [blockedUntil, setBlockedUntil] = useState<number | null>(null);
  const [organized, setOrganized] = useState<OrganizeStats | null>(null);
  useEffect(() => {
    // Both answered locally by the server; neither touches Spotify.
    const check = () => {
      fetch("/api/spotify/status")
        .then((res) => res.json())
        .then((body) => setBlockedUntil(body.blockedUntil ?? null))
        .catch(() => {});
      fetch("/api/organize-stats")
        .then((res) => res.json())
        .then((body: OrganizeStats) => setOrganized(body))
        .catch(() => {});
    };
    check();
    const timer = setInterval(check, 60_000);
    return () => clearInterval(timer);
  }, []);

  const selectTab = (id: TabId) => {
    setActiveTab(id);
    setVisited((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    try {
      localStorage.setItem(TAB_STORAGE_KEY, id);
    } catch {
      // Not remembering the tab is fine.
    }
  };

  const tabs = (
    <nav className="flex items-center gap-1" aria-label="Tools">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => selectTab(tab.id)}
          aria-current={tab.id === activeTab ? "page" : undefined}
          className={`rounded-md px-3 py-1.5 text-sm font-medium ${
            tab.id === activeTab
              ? "bg-green-600/20 text-green-400"
              : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
          }`}
        >
          {tab.label}
        </button>
      ))}
      {organized && <OrganizedCount stats={organized} />}
    </nav>
  );

  return (
    <PlayerProvider>
      {blockedUntil && (
        <div className="fixed inset-x-0 bottom-0 z-50 bg-red-950/95 px-4 py-2 text-center text-sm text-red-200">
          Spotify has blocked this app&apos;s requests until{" "}
          {new Date(blockedUntil).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}{" "}
          for making too many. Adding, removing, and scanning won&apos;t work until then.
        </div>
      )}
      {visited.has("subgenres") && (
        <div className={activeTab === "subgenres" ? "contents" : "hidden"}>
          <Dashboard tabs={tabs} />
        </div>
      )}
      {visited.has("lost") && (
        <div className={activeTab === "lost" ? "contents" : "hidden"}>
          <LostTracksView tabs={tabs} />
        </div>
      )}
    </PlayerProvider>
  );
}
