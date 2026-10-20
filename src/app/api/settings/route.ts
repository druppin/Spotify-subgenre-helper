import { NextResponse } from "next/server";
import { checkLastfm, checkLlm, checkSpotify, type CheckResult } from "@/lib/checkSettings";
import { checkLocalRequest } from "@/lib/localRequest";
import {
  getLlmConfig,
  getRedirectUri,
  getSetting,
  LLM_PROVIDERS,
  saveSettings,
  SECRET_SETTINGS,
  SETTING_NAMES,
  settingSource,
  spotifyConfigured,
  type SettingName,
} from "@/lib/settings";
import type { LlmProvider } from "@/lib/llm/types";

export interface SettingState {
  source: "app" | "env" | null;
  // Plain settings come back whole; saved secrets only as their last 4
  // characters (none at all for a short one).
  value?: string;
  hint?: string;
}

export interface SettingsResponse {
  settings: Record<SettingName, SettingState>;
  redirectUri: string;
  spotifyConfigured: boolean;
  llmConfigured: boolean;
  // After a save: keys that couldn't be checked (the service was unreachable).
  warnings?: string[];
}

function settingsResponse(): SettingsResponse {
  const settings = {} as Record<SettingName, SettingState>;
  for (const name of SETTING_NAMES) {
    const value = getSetting(name);
    const source = settingSource(name);
    settings[name] = !value
      ? { source }
      : SECRET_SETTINGS.includes(name)
        ? { source, hint: value.length >= 12 ? value.slice(-4) : "••••" }
        : { source, value };
  }
  return {
    settings,
    redirectUri: getRedirectUri(),
    spotifyConfigured: spotifyConfigured(),
    llmConfigured: getLlmConfig() !== null,
  };
}

export async function GET(request: Request) {
  return checkLocalRequest(request) ?? NextResponse.json(settingsResponse());
}

/** Body: the settings to change, by name. An empty string clears one. */
export async function PUT(request: Request) {
  const denied = checkLocalRequest(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Send settings as JSON." }, { status: 400 });

  const changes: Partial<Record<SettingName, string>> = {};
  for (const [name, value] of Object.entries(body)) {
    if (!SETTING_NAMES.includes(name as SettingName) || typeof value !== "string") {
      return NextResponse.json({ error: `Unknown setting: ${name}` }, { status: 400 });
    }
    changes[name as SettingName] = value;
  }
  const provider = changes.LLM_PROVIDER?.trim();
  if (provider && !LLM_PROVIDERS.includes(provider as (typeof LLM_PROVIDERS)[number])) {
    return NextResponse.json({ error: `Unknown AI provider: ${provider}` }, { status: 400 });
  }

  // Check the keys being changed, with the saved values filling in the rest.
  const after = (name: SettingName) => (name in changes ? changes[name]?.trim() : getSetting(name)) || "";
  const touched = (...names: SettingName[]) => names.some((name) => changes[name]?.trim());
  const checks: Promise<CheckResult>[] = [];
  if (touched("SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET") && after("SPOTIFY_CLIENT_ID") && after("SPOTIFY_CLIENT_SECRET")) {
    checks.push(checkSpotify(after("SPOTIFY_CLIENT_ID"), after("SPOTIFY_CLIENT_SECRET")));
  }
  const llmProvider = after("LLM_PROVIDER") as LlmProvider;
  if (touched("LLM_PROVIDER", "LLM_API_KEY", "LLM_MODEL") && llmProvider && after("LLM_API_KEY") && after("LLM_MODEL")) {
    checks.push(checkLlm({ provider: llmProvider, apiKey: after("LLM_API_KEY"), model: after("LLM_MODEL") }));
  }
  if (touched("LASTFM_API_KEY")) checks.push(checkLastfm(after("LASTFM_API_KEY")));
  const results = await Promise.all(checks);
  const rejected = results.flatMap((r) => (!r.ok && r.kind === "rejected" ? [r.message] : []));
  if (rejected.length > 0) return NextResponse.json({ error: rejected.join(" ") }, { status: 400 });

  saveSettings(changes);
  const warnings = results.flatMap((r) => (!r.ok ? [r.message] : []));
  return NextResponse.json({ ...settingsResponse(), ...(warnings.length > 0 && { warnings }) });
}
