import { callLlm } from "./providers";
import type { LlmConfig, TrackContext, TrackSummary } from "./types";

const SYSTEM_PROMPT = `You are a genre-nerd music curator helping someone sort tracks into playlists.
Given metadata, tags, and audio-feature numbers for a track, produce a short structured summary.
Propose freeform subgenre labels as specific as you can justify from the evidence given
(e.g. "UK house" vs "bass house" vs "tech house" vs "dubstep" vs "hardstyle" vs "uptempo") —
do not pick from a fixed list, and do not default to the artist's broad Spotify genre if the
audio features or tags suggest something more specific.
Ground the rationale in the actual values you were given rather than generic descriptions.
Respond with ONLY a JSON object of this exact shape, no markdown fences:
{"moodVibe": string, "subgenres": string[], "rationale": string}`;

function buildUserPrompt(context: TrackContext): string {
  return JSON.stringify(context, null, 2);
}

function parseSummary(raw: string): TrackSummary {
  const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/```\s*$/, "");
  const parsed = JSON.parse(cleaned);
  if (
    typeof parsed.moodVibe !== "string" ||
    !Array.isArray(parsed.subgenres) ||
    typeof parsed.rationale !== "string"
  ) {
    throw new Error(`LLM response did not match expected shape: ${raw}`);
  }
  return {
    moodVibe: parsed.moodVibe,
    subgenres: parsed.subgenres,
    rationale: parsed.rationale,
  };
}

export async function summarizeTrack(
  context: TrackContext,
  config: LlmConfig
): Promise<TrackSummary> {
  const raw = await callLlm(config, SYSTEM_PROMPT, buildUserPrompt(context));
  return parseSummary(raw);
}
