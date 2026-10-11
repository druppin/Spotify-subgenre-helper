import { NextResponse } from "next/server";
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
  saveSettings(changes);
  return NextResponse.json(settingsResponse());
}
