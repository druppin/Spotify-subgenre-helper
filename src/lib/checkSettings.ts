import { fetchWithTimeout } from "@/lib/fetchWithTimeout";
import { callLlm, OPENAI_COMPATIBLE_BASE_URL } from "@/lib/llm/providers";
import type { LlmConfig, LlmProvider } from "@/lib/llm/types";

/*
 * Tries keys against the services they're for before Settings saves them,
 * so a mistyped secret shows up as a plain message at setup rather than as
 * a failed login or an empty AI panel later. A check that can't reach the
 * service at all isn't treated as a rejection: offline, the keys still save.
 */

// "rejected": the service said no, so don't save. "unreachable": couldn't
// ask, so save anyway and say the keys weren't checked.
export type CheckResult = { ok: true } | { ok: false; kind: "rejected" | "unreachable"; message: string };

const OK: CheckResult = { ok: true };
const unreachable = (service: string): CheckResult => ({
  ok: false,
  kind: "unreachable",
  message: `Couldn't reach ${service} to check the key, so it was saved unchecked.`,
});

/** A client-credentials token request: it fails only when the ID or secret is wrong. */
export async function checkSpotify(clientId: string, clientSecret: string): Promise<CheckResult> {
  let res: Response;
  try {
    res = await fetchWithTimeout("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: "grant_type=client_credentials",
    });
  } catch {
    return unreachable("Spotify");
  }
  if (res.ok) return OK;
  if (res.status === 400 || res.status === 401) {
    return {
      ok: false,
      kind: "rejected",
      message:
        "Spotify didn't accept this Client ID and secret. Copy both again from your app's Settings page in the " +
        "Spotify Developer Dashboard (the secret is behind \"View client secret\").",
    };
  }
  return unreachable("Spotify");
}

export async function checkLastfm(apiKey: string): Promise<CheckResult> {
  let body: { error?: number };
  try {
    const url = new URL("https://ws.audioscrobbler.com/2.0/");
    url.search = new URLSearchParams({ method: "chart.gettopartists", limit: "1", api_key: apiKey, format: "json" }).toString();
    body = await (await fetchWithTimeout(url)).json();
  } catch {
    return unreachable("Last.fm");
  }
  // Error 10 is Last.fm's "Invalid API key".
  if (body.error === 10) {
    return { ok: false, kind: "rejected", message: "Last.fm didn't accept this API key." };
  }
  return OK;
}

const PROVIDER_NAMES: Record<LlmProvider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  groq: "Groq",
  openrouter: "OpenRouter",
};

/** Sends the model a tiny request, which checks the key and the model ID at once. */
export async function checkLlm(config: LlmConfig): Promise<CheckResult> {
  const name = PROVIDER_NAMES[config.provider];
  try {
    await callLlm(config, 'Reply with the JSON object {"ok": true} and nothing else.', "Check");
    return OK;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = Number(/request failed: (\d{3})/.exec(message)?.[1]);
    if (status === 401 || status === 403 || /api key|api_key|unauthori[sz]ed|invalid.*key/i.test(message)) {
      return { ok: false, kind: "rejected", message: `${name} didn't accept this API key.` };
    }
    if (status === 404 || /model/i.test(message)) {
      return {
        ok: false,
        kind: "rejected",
        message: `${name} doesn't have a model called "${config.model}" for this key. Pick one from the list.`,
      };
    }
    if (status === 429) {
      // Rate limited, but the key and model were good enough to get that far.
      return OK;
    }
    if (!status) return unreachable(name);
    return { ok: false, kind: "rejected", message: `${name} turned down a test request (${status}).` };
  }
}

/**
 * The models a key can use, best guess first, for the Model field's
 * suggestions. Empty when the provider can't be asked.
 */
export async function listModels(provider: LlmProvider, apiKey: string): Promise<string[]> {
  try {
    const ids = await fetchModelIds(provider, apiKey);
    const usable = ids.filter((id) => USABLE[provider](id));
    const pick = suggestModel(provider, usable);
    return pick ? [pick, ...usable.filter((id) => id !== pick)] : usable;
  } catch {
    return [];
  }
}

async function fetchModelIds(provider: LlmProvider, apiKey: string): Promise<string[]> {
  if (provider === "google") {
    const res = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${apiKey}`);
    if (!res.ok) return [];
    const body = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
    return (body.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m) => m.name.replace(/^models\//, ""));
  }
  const res =
    provider === "anthropic"
      ? await fetchWithTimeout("https://api.anthropic.com/v1/models?limit=100", {
          headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        })
      : await fetchWithTimeout(`${OPENAI_COMPATIBLE_BASE_URL[provider]}/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
  if (!res.ok) return [];
  const body = (await res.json()) as { data?: { id: string }[] };
  return (body.data ?? []).map((m) => m.id);
}

// Text chat models only: the lists also hold speech, image and embedding models.
const NOT_CHAT = /embed|whisper|tts|audio|realtime|transcribe|image|dall-e|moderation|guard|search|computer-use|aqa|veo|imagen/i;
const USABLE: Record<LlmProvider, (id: string) => boolean> = {
  anthropic: () => true,
  openai: (id) => /^(gpt|o\d)/.test(id) && !NOT_CHAT.test(id),
  google: (id) => id.startsWith("gemini") && !NOT_CHAT.test(id) && !/live|exp/i.test(id),
  groq: (id) => !NOT_CHAT.test(id),
  openrouter: (id) => !NOT_CHAT.test(id),
};

// Newest first, comparing the version numbers inside model IDs.
const byVersionDesc = (a: string, b: string) => b.localeCompare(a, undefined, { numeric: true });

// Cheap, fast models are plenty for short genre summaries.
function suggestModel(provider: LlmProvider, ids: string[]): string | undefined {
  const first = (test: (id: string) => boolean) => [...ids].sort(byVersionDesc).find(test);
  switch (provider) {
    case "anthropic":
      // The API lists newest first already.
      return ids.find((id) => id.includes("haiku")) ?? ids[0];
    case "openai":
      return first((id) => /^gpt-[\d.]+-mini$/.test(id)) ?? first((id) => id.includes("mini"));
    case "google":
      return first((id) => /^gemini-[\d.]+-flash$/.test(id)) ?? first((id) => id.includes("flash") && !id.includes("preview"));
    case "groq":
      return ids.find((id) => id === "llama-3.3-70b-versatile") ?? first((id) => id.includes("llama"));
    case "openrouter":
      return first((id) => id.endsWith(":free") && /llama|gemma|qwen|deepseek|mistral/.test(id));
  }
}
