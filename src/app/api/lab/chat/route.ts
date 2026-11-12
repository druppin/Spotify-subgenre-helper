import { NextResponse } from "next/server";
import { checkDevRequest } from "@/lib/devMode";
import { callLlmChat, type ChatMessage } from "@/lib/llm/providers";
import { getLlmConfig } from "@/lib/settings";
import { latestContext } from "@/lib/lab/store";

const MAX_MESSAGES = 40;
const MAX_MESSAGE_LENGTH = 8000;

const SYSTEM_PROMPT = `You are the AI model a music app uses to tag songs with subgenres. A developer is
chatting with you directly to test how you reason about genres. Answer plainly and concisely.`;

/**
 * Body: { messages: [{ role, content }], trackId? }, ending on the user's turn.
 * With trackId, the model also gets the data the lab saved for that song.
 * Nothing is saved; the page keeps the conversation.
 */
export async function POST(request: Request) {
  const denied = checkDevRequest(request);
  if (denied) return denied;
  const { messages, trackId } = await request.json().catch(() => ({}));
  const valid =
    Array.isArray(messages) &&
    messages.length > 0 &&
    messages.length <= MAX_MESSAGES &&
    messages.every(
      (m) =>
        (m?.role === "user" || m?.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim() &&
        m.content.length <= MAX_MESSAGE_LENGTH
    ) &&
    messages[messages.length - 1].role === "user";
  if (!valid) return NextResponse.json({ error: "Send a conversation that ends with your message." }, { status: 400 });
  const config = getLlmConfig();
  if (!config) return NextResponse.json({ error: "No AI provider set up yet (Settings)." }, { status: 400 });

  const saved = typeof trackId === "string" ? latestContext(trackId) : undefined;
  const system = saved
    ? `${SYSTEM_PROMPT}\n\nThe developer is asking about this song. Its data, as the app would send it for tagging:\n${JSON.stringify(saved.context, null, 2)}`
    : SYSTEM_PROMPT;
  try {
    const reply = await callLlmChat(config, system, messages as ChatMessage[]);
    return NextResponse.json({ reply: reply.text, model: `${config.provider}:${config.model}` });
  } catch (err) {
    console.error("lab chat failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
