import { NextRequest, NextResponse } from "next/server";
import { applySuggestion } from "@/lib/trackChat";

/** Applies the tags the AI suggested in one chat answer. Responds with the saved tags and the conversation. */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string; messageId: string }> }) {
  const { id, messageId } = await params;
  try {
    const { tags, messages } = await applySuggestion(id, Number(messageId));
    return NextResponse.json({ tags: { ...tags, subgenres: [...tags.own, ...tags.broader] }, messages });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
