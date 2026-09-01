import type { LlmConfig } from "./types";

const OPENAI_COMPATIBLE_BASE_URL: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
};

async function callOpenAiCompatible(
  config: LlmConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const baseUrl = OPENAI_COMPATIBLE_BASE_URL[config.provider];
  const res = await fetch(`${baseUrl}/chat/completions`, {
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
  });
  if (!res.ok) {
    throw new Error(`${config.provider} request failed: ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  return body.choices?.[0]?.message?.content ?? "";
}

async function callAnthropic(
  config: LlmConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
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
  });
  if (!res.ok) {
    throw new Error(`anthropic request failed: ${res.status} ${await res.text()}`);
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
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.4 },
    }),
  });
  if (!res.ok) {
    throw new Error(`google request failed: ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  return body.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

/**
 * Sends a system+user prompt to the configured provider and returns the raw
 * text response (expected to be a JSON string — callers parse it).
 */
export async function callLlm(
  config: LlmConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
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
