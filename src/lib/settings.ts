import { randomBytes } from "crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "fs";
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
  // A folder of the user's own audio files, measured for mix density (see localAudio.ts).
  "MUSIC_FOLDER",
] as const;
export type SettingName = (typeof SETTING_NAMES)[number];

// Never sent back to the page in full once saved.
export const SECRET_SETTINGS: SettingName[] = ["SPOTIFY_CLIENT_SECRET", "LLM_API_KEY", "LASTFM_API_KEY"];

export const LLM_PROVIDERS: LlmProvider[] = ["anthropic", "openai", "google", "groq", "openrouter"];

const DEFAULT_REDIRECT_URI = "http://127.0.0.1:3000/api/auth/callback";

type Values = Partial<Record<SettingName, string>>;

interface SettingsFile {
  // The active profile's settings, plus the shared ones.
  values: Values;
  // Set once the user has made a second profile. From then on a profile's
  // keys come only from the app, not .env.local, so one profile's keys
  // can't show through in another.
  activeProfile?: string;
  // The other profiles' keys, by name.
  profiles?: Record<string, Values>;
  // While the active profile is one just made: the profile it was made
  // from, to go back to if the user cancels.
  madeFrom?: string;
  // Encrypts the login cookie. Made on first run; nobody needs to see it.
  sessionSecret?: string;
}

// What a profile holds: every key. The music folder is the same files whoever's logged in.
const PROFILE_SETTINGS: SettingName[] = SETTING_NAMES.filter((name) => name !== "MUSIC_FOLDER");
export const DEFAULT_PROFILE = "Default";

// The active profile's data folder, on globalThis so every route sees a switch.
const dirHolder = globalThis as typeof globalThis & { __sghProfileDir?: string };

// Default keeps the data folder itself, where everything was before profiles.
function dirFor(profile: string | undefined): string {
  return !profile || profile === DEFAULT_PROFILE ? DATA_DIR : path.join(DATA_DIR, "profiles", encodeURIComponent(profile));
}

/** Where the active profile keeps its library database, caches and logs. Settings and the sound model are shared. */
export function profileDataDir(): string {
  return (dirHolder.__sghProfileDir ??= dirFor(readFile().activeProfile));
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

function fromEnv(file: SettingsFile, name: SettingName): string | undefined {
  return file.activeProfile && PROFILE_SETTINGS.includes(name) ? undefined : process.env[name];
}

export function settingSource(name: SettingName): "app" | "env" | null {
  const file = readFile();
  if (file.values[name]) return "app";
  if (fromEnv(file, name)) return "env";
  return null;
}

export function getSetting(name: SettingName): string | undefined {
  const file = readFile();
  return file.values[name] || fromEnv(file, name) || undefined;
}

export interface Profiles {
  active: string;
  names: string[];
  // Set while the active profile is new: where cancelling it goes back to.
  madeFrom?: string;
}

export function listProfiles(): Profiles {
  const file = readFile();
  const active = file.activeProfile ?? DEFAULT_PROFILE;
  const names = [active, ...Object.keys(file.profiles ?? {})].sort((a, b) => a.localeCompare(b));
  return { active, names, ...(file.madeFrom && file.profiles?.[file.madeFrom] && { madeFrom: file.madeFrom }) };
}

/** Throws away the profile just made, keys and all, and goes back to the one it was made from. */
export function cancelNewProfile() {
  const file = readFile();
  const { activeProfile: made, madeFrom } = file;
  if (!made || !madeFrom || !file.profiles?.[madeFrom]) throw new Error("There's no new profile to cancel.");
  switchProfile(madeFrom, false);
  const after = readFile();
  const profiles = { ...after.profiles };
  delete profiles[made];
  writeFile({ ...after, profiles });
  // Only just made, so whatever it saved goes too.
  rmSync(dirFor(made), { recursive: true, force: true });
}

/**
 * Makes `name` the active profile: the current one's keys (including any
 * from .env.local, the first time) are put away under its name, and
 * `name`'s come out, or none for a new profile. The music folder stays.
 */
export function switchProfile(name: string, create: boolean) {
  const file = readFile();
  const active = file.activeProfile ?? DEFAULT_PROFILE;
  const profiles = { ...file.profiles };
  if (name === active) throw new Error(`${name} is already the profile in use.`);
  if (create && profiles[name]) throw new Error(`There's already a profile called ${name}.`);
  if (!create && !profiles[name]) throw new Error(`There's no profile called ${name}.`);
  profiles[active] = Object.fromEntries(
    PROFILE_SETTINGS.flatMap((key) => {
      const value = file.values[key] || fromEnv(file, key);
      return value ? [[key, value]] : [];
    })
  );
  const shared = Object.fromEntries(Object.entries(file.values).filter(([key]) => !PROFILE_SETTINGS.includes(key as SettingName)));
  const values = { ...shared, ...(create ? {} : profiles[name]) };
  delete profiles[name];
  writeFile({ ...file, values, activeProfile: name, profiles, madeFrom: create ? active : undefined });
  dirHolder.__sghProfileDir = dirFor(name);
}

export function deleteProfile(name: string) {
  const file = readFile();
  if (!file.profiles?.[name]) throw new Error(`There's no other profile called ${name}.`);
  const profiles = { ...file.profiles };
  delete profiles[name];
  writeFile({ ...file, profiles });
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
