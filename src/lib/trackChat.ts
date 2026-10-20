import { sql } from "@/lib/db";
import { buildTrackContext } from "@/lib/context";
import { answerTrackQuestion, type TagSuggestion } from "@/lib/llm/chat";
import type { ChatMessage } from "@/lib/llm/providers";
import type { LlmConfig } from "@/lib/llm/types";
import type { SpotifyClient } from "@/lib/spotify/client";
import { getStoredGenres, setTrackGenresByUser } from "@/lib/trackGenres";
import { findAnySummary } from "@/lib/trackSummary";

/*
 * Follow-up questions about a song, kept per Spotify track ID in the
 * library database (track_chat_messages — see db.ts) so a conversation is
 * still there when the song comes round again.
 */

export interface StoredChatMessage extends ChatMessage {
  id: number;
  createdAt: number;
  // Tags the AI proposed in this answer, if any, and whether they were applied.
  suggestion: TagSuggestion | null;
  applied: boolean;
}

export function getTrackChat(trackId: string): StoredChatMessage[] {
  const rows = sql(
    "SELECT id, role, content, created_at, suggestion, applied FROM track_chat_messages WHERE track_id = ? ORDER BY id"
  ).all(trackId) as {
    id: number;
    role: ChatMessage["role"];
    content: string;
    created_at: number;
    suggestion: string | null;
    applied: number;
  }[];
  return rows.map((r) => ({
    id: r.id,
    role: r.role,
    content: r.content,
    createdAt: r.created_at,
    suggestion: r.suggestion ? (JSON.parse(r.suggestion) as TagSuggestion) : null,
    applied: r.applied === 1,
  }));
}

export function clearTrackChat(trackId: string) {
  sql("DELETE FROM track_chat_messages WHERE track_id = ?").run(trackId);
}

function addMessage(trackId: string, role: ChatMessage["role"], content: string, suggestion: TagSuggestion | null = null) {
  sql(
    "INSERT INTO track_chat_messages (track_id, role, content, created_at, suggestion) VALUES (?, ?, ?, ?, ?)"
  ).run(trackId, role, content, Date.now(), suggestion ? JSON.stringify(suggestion) : null);
}

/**
 * Saves the tags the AI proposed in one of its answers as the song's tags
 * (scored as the AI's), and marks that suggestion applied. Read from the
 * saved answer, not from the request, so only what the AI proposed applies.
 */
export async function applySuggestion(trackId: string, messageId: number) {
  const message = getTrackChat(trackId).find((m) => m.id === messageId);
  if (!message?.suggestion) throw new Error("That answer has no suggested tags.");
  const scores = Object.fromEntries(message.suggestion.tags.map((t) => [t.genre, t.confidence]));
  const stored = await setTrackGenresByUser(trackId, Object.keys(scores), scores);
  sql("UPDATE track_chat_messages SET applied = 1 WHERE id = ? AND track_id = ?").run(messageId, trackId);
  return { tags: stored, messages: getTrackChat(trackId) };
}

/**
 * Asks the AI `question` about the song, with the earlier conversation,
 * and saves both. The question is only saved once an answer comes back,
 * so a failed call can just be asked again.
 */
export async function askAboutTrack(
  trackId: string,
  question: string,
  spotify: SpotifyClient,
  config: LlmConfig
): Promise<StoredChatMessage[]> {
  const [{ context }, summary, tags] = await Promise.all([
    buildTrackContext(trackId, spotify),
    findAnySummary(trackId, config),
    getStoredGenres(trackId),
  ]);
  const history: ChatMessage[] = getTrackChat(trackId).map(({ role, content }) => ({ role, content }));
  const answer = await answerTrackQuestion(
    {
      context,
      summary,
      tags: tags
        ? {
            own: tags.own,
            broader: tags.broader,
            edited: tags.edited,
            confidence: tags.confidence,
            userTags: tags.userTags,
          }
        : null,
    },
    [...history, { role: "user", content: question }],
    config
  );
  addMessage(trackId, "user", question);
  addMessage(trackId, "assistant", answer.text, answer.suggestion);
  return getTrackChat(trackId);
}
