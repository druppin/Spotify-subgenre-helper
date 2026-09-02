import { createHash } from "crypto";
import { callLlm } from "./providers";
import type { LlmConfig, TrackContext, TrackSummary } from "./types";

const SYSTEM_PROMPT = `You are a genre-nerd music curator helping someone sort tracks into playlists.
Given metadata, tags, and audio-feature numbers for a track, produce a short structured summary.
Propose freeform subgenre labels as specific as you can justify from the evidence given
(e.g. "UK house" vs "bass house" vs "tech house" vs "dubstep" vs "hardstyle" vs "uptempo" vs
"drum and bass" vs "jungle" vs "liquid dnb" vs "hardcore/gabber" vs "industrial techno") —
do not pick from a fixed list, and do not default to the artist's broad Spotify genre if the
audio features or tags suggest something more specific.

Tempo is a strong but not absolute signal for electronic subgenres — as a rough guide: house/
tech house ~120-128 BPM, techno ~125-150 BPM, dubstep ~140 BPM (half-time feel), drum and bass/
jungle ~160-180 BPM (174 is an extremely common DnB tempo — don't default to hardcore/gabber
just because a track is fast), hardstyle ~150-160 BPM, hardcore/gabber usually 170+ BPM AND
distorted/four-on-the-floor. Weigh tempo alongside energy/valence/acousticness and any genre
tags given, not in isolation.

Ground the rationale ONLY in the data actually provided (audio features, artist genres, Last.fm
tags/bio). Never invent context that isn't in the given data — no assumed soundtracks, games,
playlists, or backstory for the artist or track. Never use the literal wording of the track
title as evidence of genre or mood (e.g. a track called "Hot Wheels" is not evidence of a
racing/car theme) — titles are not a reliable signal and reasoning from them reads as making
things up. If artistGenres, Last.fm tags, and audio features are all empty or missing, say so
plainly in the rationale and keep the guess clearly hedged rather than presenting a confident-
sounding but ungrounded story.

Respond with ONLY a JSON object of this exact shape, no markdown fences:
{"moodVibe": string, "subgenres": string[], "rationale": string}`;

// Derived from the prompt text itself so editing SYSTEM_PROMPT automatically
// invalidates cached summaries (see the cache key in the summary route)
// instead of silently serving stale answers from a since-changed prompt.
export const SUMMARY_PROMPT_VERSION = createHash("sha256")
  .update(SYSTEM_PROMPT)
  .digest("hex")
  .slice(0, 8);

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
