import { callLlmChat, type ChatMessage } from "./providers";
import { parseConfidence } from "./summarize";
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
fine; no markdown headings, bold or tables.

You can propose new tags. Do so only when the conversation has concluded the saved tags should
change: the listener asks you to retag or add tags, or you've agreed a tag is wrong or missing.
Then end your reply with one last line, exactly in this form and nothing after it:
TAGS: {"tags": [{"genre": string, "confidence": number}]}
listing the complete set of tags you'd save (specific subgenres, usually two to five), each with a
confidence from 0 to 100: how likely a knowledgeable listener would agree it fits. Keep tags the
listener added unless they asked you to change them. The listener sees this as a suggestion and
decides whether to apply it, so say in your text what you'd change and why, but never mention the
TAGS line itself. Leave the line out entirely in every other reply.`;

// Older turns beyond this are left out, to keep long chats affordable.
const MAX_HISTORY = 20;

export interface ChatTrackInfo {
  context: TrackContext;
  // The AI's original answer, if one is saved.
  summary: TrackSummary | null;
  // The tags as currently saved, how sure the AI was of each, which the
  // listener added, and whether they edited them.
  tags: {
    own: string[];
    broader: string[];
    edited: boolean;
    confidence: Record<string, number>;
    userTags: string[];
  } | null;
}

// New tags the AI proposed in a reply, for the listener to apply or not.
export interface TagSuggestion {
  tags: { genre: string; confidence: number }[];
}

export interface ChatAnswer {
  text: string;
  suggestion: TagSuggestion | null;
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
      `Tags currently saved for the track${tags.edited ? " (edited by the listener)" : ""}: ` +
        tags.own
          .map((genre) =>
            tags.userTags.includes(genre)
              ? `${genre} (added by the listener)`
              : tags.confidence[genre] !== undefined
                ? `${genre} (${tags.confidence[genre]}% confident)`
                : genre
          )
          .join(", ") +
        (tags.broader.length > 0 ? `\nBroader genres they roll up into: ${tags.broader.join(", ")}` : "")
    );
  } else {
    parts.push("No tags are saved for the track yet.");
  }
  return parts.join("\n\n");
}

const TAGS_LINE = /^[ \t]*TAGS:[ \t]*(\{.*\})[ \t]*$/m;

/**
 * Splits a proposed tag set off the end of a reply. A malformed TAGS line
 * is dropped rather than shown, and gives no suggestion.
 */
export function splitSuggestion(reply: string): ChatAnswer {
  const match = reply.match(TAGS_LINE);
  if (!match) return { text: reply, suggestion: null };
  const text = reply.replace(match[0], "").trim();
  try {
    const parsed = JSON.parse(match[1]);
    const tags: TagSuggestion["tags"] = [];
    for (const item of Array.isArray(parsed.tags) ? parsed.tags : []) {
      const genre = typeof item === "string" ? item : item?.genre;
      if (typeof genre !== "string" || !genre.trim()) continue;
      tags.push({ genre: genre.trim(), confidence: parseConfidence(item?.confidence) ?? 50 });
    }
    return { text, suggestion: tags.length > 0 ? { tags } : null };
  } catch {
    return { text, suggestion: null };
  }
}

/** The AI's reply to the last (user) message in `messages`, and any tags it proposed. */
export async function answerTrackQuestion(
  info: ChatTrackInfo,
  messages: ChatMessage[],
  config: LlmConfig
): Promise<ChatAnswer> {
  const { text } = await callLlmChat(config, systemPrompt(info), messages.slice(-MAX_HISTORY));
  const answer = splitSuggestion(text.trim());
  if (!answer.text && !answer.suggestion) throw new Error("The AI sent back an empty answer. Try asking again.");
  return { ...answer, text: answer.text || "Here's the tag set I'd use." };
}
