import { callLlm } from "./providers";
import { parseConfidence } from "./summarize";
import type { LlmConfig, TrackContext } from "./types";

const SYSTEM_PROMPT = `You are a genre-nerd music curator reviewing subgenre tags already given to a track.
Given the track's metadata, tags and audio-feature numbers, rate each tag listed with a confidence
from 0 to 100: how likely a knowledgeable listener would agree the label fits this track.

Base each score only on the data provided. Several sources agreeing (MusicBrainz genres with votes,
Last.fm tags, audio features that match the style's usual tempo and energy) means high; a guess from
the artist's general style, or thin or conflicting data, means low. A tag the data contradicts
should score low. Never use the wording of the track title as evidence. Use the whole range; don't
give every tag the same number. Do not add, remove or rename tags.

Respond with ONLY a JSON object of this exact shape, no markdown fences, with one key per tag
exactly as given: {"confidence": {"<tag>": number}}`;

/** The AI's 0-100 score for each of `tags`, keyed by tag. Tags it skipped are left out. */
export async function scoreTags(context: TrackContext, tags: string[], config: LlmConfig): Promise<Record<string, number>> {
  const user = JSON.stringify({ track: context, tags }, null, 2);
  // Models occasionally send broken JSON; one more try usually fixes it.
  for (let attempt = 1; ; attempt++) {
    const { text } = await callLlm(config, SYSTEM_PROMPT, user);
    try {
      const parsed = JSON.parse(text.trim().replace(/^```json\s*/i, "").replace(/```\s*$/, ""));
      const scores: Record<string, number> = {};
      for (const [tag, value] of Object.entries(parsed.confidence ?? {})) {
        const score = parseConfidence(value);
        if (score !== undefined) scores[tag] = score;
      }
      if (Object.keys(scores).length === 0) throw new Error(`No scores in the AI's answer: ${text}`);
      return scores;
    } catch (err) {
      if (attempt >= 2) throw err;
    }
  }
}
