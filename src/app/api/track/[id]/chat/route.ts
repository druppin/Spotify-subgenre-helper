import { NextRequest, NextResponse } from "next/server";
import { getValidAccessToken } from "@/lib/spotify/auth";
import { SpotifyClient } from "@/lib/spotify/client";
import { spotifyErrorResponse } from "@/lib/spotify/routeError";
import { getLlmConfig } from "@/lib/settings";
import { askAboutTrack, clearTrackChat, getTrackChat } from "@/lib/trackChat";

const MAX_QUESTION_LENGTH = 4000;

type Params = { params: Promise<{ id: string }> };

/** The saved conversation about this song. */
export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  return NextResponse.json({ messages: getTrackChat(id) });
}

/** Body: { question }. Responds with the whole conversation, answer included. */
export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const { question } = await request.json().catch(() => ({}));
  if (typeof question !== "string" || !question.trim()) {
    return NextResponse.json({ error: "Ask a question first." }, { status: 400 });
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    return NextResponse.json({ error: "That question is too long." }, { status: 400 });
  }
  const config = getLlmConfig();
  if (!config) {
    return NextResponse.json(
      { error: "No AI provider set up yet. Choose one and add its key in Settings." },
      { status: 400 }
    );
  }
  let client: SpotifyClient;
  try {
    client = new SpotifyClient(await getValidAccessToken());
  } catch (err) {
    return spotifyErrorResponse(err, "POST /api/track/[id]/chat");
  }
  try {
    const messages = await askAboutTrack(id, question.trim(), client, config);
    return NextResponse.json({ messages });
  } catch (err) {
    console.error("track chat failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}

/** Starts the conversation about this song over. */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  clearTrackChat(id);
  return NextResponse.json({ ok: true });
}
