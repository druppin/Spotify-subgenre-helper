import { sql } from "@/lib/db";
import { getCache } from "@/lib/cache";
import { buildTrackContext } from "@/lib/context";
import { answerTrackQuestion } from "@/lib/llm/chat";
import type { ChatMessage } from "@/lib/llm/providers";
import { SUMMARY_PROMPT_VERSION } from "@/lib/llm/summarize";
import type { LlmConfig, TrackSummary } from "@/lib/llm/types";
import type { SpotifyClient } from "@/lib/spotify/client";
import { getStoredGenres } from "@/lib/trackGenres";

/*
 * Follow-up questions about a song, kept per Spotify track ID in the
 * library database (track_chat_messages — see db.ts) so a conversation is
 * still there when the song comes round again.
 */

export interface StoredChatMessage extends ChatMessage {
  id: number;
  createdAt: number;
}

export function getTrackChat(trackId: string): StoredChatMessage[] {
  const rows = sql(
    "SELECT id, role, content, created_at FROM track_chat_messages WHERE track_id = ? ORDER BY id"
  ).all(trackId) as { id: number; role: ChatMessage["role"]; content: string; created_at: number }[];
  return rows.map((r) => ({ id: r.id, role: r.role, content: r.content, createdAt: r.created_at }));
}

export function clearTrackChat(trackId: string) {
  sql("DELETE FROM track_chat_messages WHERE track_id = ?").run(trackId);
}

function addMessage(trackId: string, role: ChatMessage["role"], content: string) {
  sql("INSERT INTO track_chat_messages (track_id, role, content, created_at) VALUES (?, ?, ?, ?)").run(
    trackId,
    role,
    content,
    Date.now()
  );
}

// The AI's original answer for the song: from the model now in use if it
// has one, otherwise from whichever model answered before.
async function findSummary(trackId: string, config: LlmConfig): Promise<TrackSummary | null> {
  const cache = getCache<TrackSummary>("track-summary");
  const current = await cache.get(`${trackId}:${config.provider}:${config.model}:${SUMMARY_PROMPT_VERSION}`);
  if (current) return current;
  const any = (await cache.entries()).find(([key]) => key.startsWith(`${trackId}:`));
  return any?.[1] ?? null;
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
    findSummary(trackId, config),
    getStoredGenres(trackId),
  ]);
  const history: ChatMessage[] = getTrackChat(trackId).map(({ role, content }) => ({ role, content }));
  const answer = await answerTrackQuestion(
    {
      context,
      summary,
      tags: tags ? { own: tags.own, broader: tags.broader, edited: tags.edited } : null,
    },
    [...history, { role: "user", content: question }],
    config
  );
  addMessage(trackId, "user", question);
  addMessage(trackId, "assistant", answer);
  return getTrackChat(trackId);
}
