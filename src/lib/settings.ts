import { randomBytes } from "crypto";
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "fs";
import path from "path";
import { DATA_DIR } from "@/lib/dataDir";
import type { LlmConfig, LlmProvider } from "@/lib/llm/types";

/*
 * The keys and choices a user enters in the app's Settings, kept in
 * settings.json in the data folder. A value saved there wins; one that isn't
 * falls back to the same-named variable in .env.local, so setups made by
 * editing that file keep working.
 */

export const SETTING_NAMES = [
  "SPOTIFY_CLIENT_ID",
  "SPOTIFY_CLIENT_SECRET",
  "LLM_PROVIDER",
  "LLM_API_KEY",
  "LLM_MODEL",
  "LASTFM_API_KEY",
] as const;
export type SettingName = (typeof SETTING_NAMES)[number];

// Never sent back to the page in full once saved.
export const SECRET_SETTINGS: SettingName[] = ["SPOTIFY_CLIENT_SECRET", "LLM_API_KEY", "LASTFM_API_KEY"];

export const LLM_PROVIDERS: LlmProvider[] = ["anthropic", "openai", "google", "groq", "openrouter"];

const DEFAULT_REDIRECT_URI = "http://127.0.0.1:3000/api/auth/callback";

interface SettingsFile {
  values: Partial<Record<SettingName, string>>;
  // Encrypts the login cookie. Made on first run; nobody needs to see it.
  sessionSecret?: string;
}

const SETTINGS_PATH = path.join(DATA_DIR, "settings.json");

// Re-read only when the file changes, since every request reads settings.
let loaded: { mtimeMs: number; file: SettingsFile } | null = null;

function readFile(): SettingsFile {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(SETTINGS_PATH).mtimeMs;
  } catch {
    return { values: {} };
  }
  if (loaded?.mtimeMs === mtimeMs) return loaded.file;
  try {
    const file = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8")) as SettingsFile;
    loaded = { mtimeMs, file: { ...file, values: file.values ?? {} } };
  } catch (err) {
    console.error(`Couldn't read ${SETTINGS_PATH}:`, err);
    return { values: {} };
  }
  return loaded.file;
}

function writeFile(file: SettingsFile) {
  mkdirSync(DATA_DIR, { recursive: true });
  // Written whole and swapped in, so a crash can't leave half a file. Holds
  // secrets, so only this user can read it.
  const temp = `${SETTINGS_PATH}.tmp`;
  writeFileSync(temp, JSON.stringify(file, null, 2), { mode: 0o600 });
  renameSync(temp, SETTINGS_PATH);
  loaded = null;
}

export function settingSource(name: SettingName): "app" | "env" | null {
  if (readFile().values[name]) return "app";
  if (process.env[name]) return "env";
  return null;
}

export function getSetting(name: SettingName): string | undefined {
  return readFile().values[name] || process.env[name] || undefined;
}

/** Saves the given settings; an empty value clears what the app saved. */
export function saveSettings(changes: Partial<Record<SettingName, string>>) {
  const file = readFile();
  const values = { ...file.values };
  for (const [name, value] of Object.entries(changes) as [SettingName, string][]) {
    const trimmed = value.trim();
    if (trimmed) values[name] = trimmed;
    else delete values[name];
  }
  writeFile({ ...file, values });
}

export function getSessionSecret(): string {
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv && fromEnv.length >= 32) return fromEnv;
  const file = readFile();
  if (file.sessionSecret) return file.sessionSecret;
  const sessionSecret = randomBytes(32).toString("base64url");
  writeFile({ ...file, sessionSecret });
  return sessionSecret;
}

export function getRedirectUri(): string {
  return process.env.SPOTIFY_REDIRECT_URI || DEFAULT_REDIRECT_URI;
}

export function spotifyConfigured(): boolean {
  return Boolean(getSetting("SPOTIFY_CLIENT_ID") && getSetting("SPOTIFY_CLIENT_SECRET"));
}

export function getLlmConfig(): LlmConfig | null {
  const provider = getSetting("LLM_PROVIDER") as LlmProvider | undefined;
  const apiKey = getSetting("LLM_API_KEY");
  const model = getSetting("LLM_MODEL");
  if (!provider || !LLM_PROVIDERS.includes(provider) || !apiKey || !model) return null;
  return { provider, apiKey, model };
}
