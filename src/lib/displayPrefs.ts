"use client";

import { useSyncExternalStore } from "react";

/*
 * How the app looks on this computer: the theme, and how tag confidence is
 * shown. Kept in localStorage (they're per-screen choices, not settings the
 * server needs), and shared live between every component using them.
 */

export type ThemePref = "system" | "light" | "dark";
export type ConfidenceDisplay = "both" | "bars" | "percent";

export interface DisplayPrefs {
  theme: ThemePref;
  confidence: ConfidenceDisplay;
}

// Also read by THEME_BOOT_SCRIPT (themeBoot.ts) before first paint.
const STORAGE_KEY = "app.display";
const DEFAULTS: DisplayPrefs = { theme: "system", confidence: "both" };

let current: DisplayPrefs | null = null;
const listeners = new Set<() => void>();

function read(): DisplayPrefs {
  if (current) return current;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<DisplayPrefs>;
    current = {
      theme: saved.theme === "light" || saved.theme === "dark" ? saved.theme : DEFAULTS.theme,
      confidence:
        saved.confidence === "bars" || saved.confidence === "percent" ? saved.confidence : DEFAULTS.confidence,
    };
  } catch {
    current = DEFAULTS;
  }
  return current;
}

/** Puts the theme on <html>; "system" leaves it to prefers-color-scheme. */
export function applyTheme(theme: ThemePref) {
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
}

export function setDisplayPrefs(change: Partial<DisplayPrefs>) {
  current = { ...read(), ...change };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Not remembering is fine; the choice still applies until reload.
  }
  applyTheme(current.theme);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDisplayPrefs(): DisplayPrefs {
  return useSyncExternalStore(subscribe, read, () => DEFAULTS);
}
