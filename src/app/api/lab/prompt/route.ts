import { NextResponse } from "next/server";
import { checkDevRequest } from "@/lib/devMode";
import { setLiveSummaryPrompt } from "@/lib/lab/store";

/** Body: { prompt: string | null }. Makes it the app's summary prompt; null restores the built-in one. */
export async function PUT(request: Request) {
  const denied = checkDevRequest(request);
  if (denied) return denied;
  const { prompt } = await request.json().catch(() => ({}));
  if (prompt !== null && (typeof prompt !== "string" || !prompt.trim())) {
    return NextResponse.json({ error: "prompt must be text, or null for the built-in prompt" }, { status: 400 });
  }
  setLiveSummaryPrompt(prompt);
  return NextResponse.json({ ok: true });
}
