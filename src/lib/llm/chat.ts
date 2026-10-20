import { callLlmChat, type ChatMessage } from "./providers";
import type { LlmConfig, TrackContext, TrackSummary } from "./types";

const SYSTEM_PROMPT = `You are a genre-nerd music curator. Earlier you looked at the data below for one
track and suggested subgenre tags; now the listener is asking follow-up questions — why you tagged
it the way you did, what you know about the song or artist, what a genre is about, what to listen
to next, and so on.

Be clear about where an answer comes from. The track data below (Last.fm tags and bio, MusicBrainz
genres and votes, audio features) is evidence you can point to directly. You may also draw on your
general knowledge of music, but say when you are doing so, and say plainly when you don't know or
aren't sure — never invent facts about the track or artist (release history, backstory, samples,
collaborators) to fill a gap. Don't treat the words of the track title as evidence of its genre.

The current tags may have been edited by the listener. If they disagree with your original
reasoning, take their view seriously: explain your reasoning, but concede when they have a point.

Answer conversationally and concisely, in plain text. Short paragraphs or simple "- " lists are
fine; no markdown headings, bold or tables.`;

// Older turns beyond this are left out, to keep long chats affordable.
const MAX_HISTORY = 20;

export interface ChatTrackInfo {
  context: TrackContext;
  // The AI's original answer, if one is saved.
  summary: TrackSummary | null;
  // The tags as currently saved, and whether the listener edited them.
  tags: { own: string[]; broader: string[]; edited: boolean } | null;
}

function systemPrompt({ context, summary, tags }: ChatTrackInfo): string {
  const parts = [SYSTEM_PROMPT, `Track data:\n${JSON.stringify(context, null, 2)}`];
  if (summary) {
    parts.push(
      `Your original answer:\nMood/vibe: ${summary.moodVibe}\nSubgenres: ${summary.subgenres.join(", ")}\n` +
        `Rationale: ${summary.rationale}`
    );
  }
  if (tags) {
    parts.push(
      `Tags currently saved for the track${tags.edited ? " (edited by the listener)" : ""}: ${tags.own.join(", ")}` +
        (tags.broader.length > 0 ? `\nBroader genres they roll up into: ${tags.broader.join(", ")}` : "")
    );
  } else {
    parts.push("No tags are saved for the track yet.");
  }
  return parts.join("\n\n");
}

/** The AI's reply to the last (user) message in `messages`. */
export async function answerTrackQuestion(
  info: ChatTrackInfo,
  messages: ChatMessage[],
  config: LlmConfig
): Promise<string> {
  const { text } = await callLlmChat(config, systemPrompt(info), messages.slice(-MAX_HISTORY));
  const reply = text.trim();
  if (!reply) throw new Error("The AI sent back an empty answer. Try asking again.");
  return reply;
}
