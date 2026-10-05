"use client";

import { useState } from "react";
import { PlayerProvider } from "./PlayerProvider";
import { Dashboard } from "./Dashboard";
import { LostTracksView } from "./LostTracksView";

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
    </nav>
  );

  return (
    <PlayerProvider>
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
