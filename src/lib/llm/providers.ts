import { fetchWithTimeout, FetchTimeoutError } from "@/lib/fetchWithTimeout";
import type { LlmConfig } from "./types";

const OPENAI_COMPATIBLE_BASE_URL: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
};

class LlmApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "LlmApiError";
  }
}

// Free-tier and shared LLM infra commonly return these transiently (rate
// limiting, "model overloaded") — worth a retry before giving up.
const TRANSIENT_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callOpenAiCompatible(
  config: LlmConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const baseUrl = OPENAI_COMPATIBLE_BASE_URL[config.provider];
  const res = await fetchWithTimeout(
    `${baseUrl}/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.4,
      }),
    },
    30_000
  );
  if (!res.ok) {
    throw new LlmApiError(res.status, `${config.provider} request failed: ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  return body.choices?.[0]?.message?.content ?? "";
}

async function callAnthropic(
  config: LlmConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const res = await fetchWithTimeout(
    "https://api.anthropic.com/v1/messages",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    },
    30_000
  );
  if (!res.ok) {
    throw new LlmApiError(res.status, `anthropic request failed: ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  return body.content?.[0]?.text ?? "";
}

async function callGoogle(
  config: LlmConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`;
  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.4 },
      }),
    },
    30_000
  );
  if (!res.ok) {
    throw new LlmApiError(res.status, `google request failed: ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  return body.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

function callProvider(config: LlmConfig, systemPrompt: string, userPrompt: string): Promise<string> {
  switch (config.provider) {
    case "openai":
    case "groq":
    case "openrouter":
      return callOpenAiCompatible(config, systemPrompt, userPrompt);
    case "anthropic":
      return callAnthropic(config, systemPrompt, userPrompt);
    case "google":
      return callGoogle(config, systemPrompt, userPrompt);
  }
}

/**
 * Sends a system+user prompt to the configured provider and returns the raw
 * text response (expected to be a JSON string — callers parse it). Retries
 * transient failures (rate limiting, "model overloaded") a couple of times
 * before giving up.
 */
export async function callLlm(
  config: LlmConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await callProvider(config, systemPrompt, userPrompt);
    } catch (err) {
      const isTransient =
        (err instanceof LlmApiError && TRANSIENT_STATUS_CODES.has(err.status)) ||
        err instanceof FetchTimeoutError;
      if (!isTransient || attempt === MAX_ATTEMPTS) throw err;
      await sleep(500 * attempt);
    }
  }
  throw new Error("unreachable");
}
