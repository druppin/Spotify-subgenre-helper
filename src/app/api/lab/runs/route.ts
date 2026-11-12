import { NextResponse } from "next/server";
import { checkDevRequest } from "@/lib/devMode";
import { getLlmConfig } from "@/lib/settings";
import { getValidAccessToken } from "@/lib/spotify/auth";
import { startRun } from "@/lib/lab/runner";
import { allResults, contextsByHash, deleteRun, listRuns, listTracks, promptText } from "@/lib/lab/store";

// Side-by-side columns are capped so each stays readable.
const MAX_COMPARE = 6;

/** ?ids=1,2,3 : those runs' prompts and answers, and the song data each answer was based on. */
export async function GET(request: Request) {
  const denied = checkDevRequest(request);
  if (denied) return denied;
  const ids = (new URL(request.url).searchParams.get("ids") ?? "").split(",").map(Number).filter(Boolean).slice(0, MAX_COMPARE);
  const runs = listRuns().filter((r) => ids.includes(r.id));
  const results = allResults().filter((r) => ids.includes(r.runId));
  return NextResponse.json({
    runs: runs.map((r) => ({ id: r.id, prompt: promptText(r.promptHash) ?? "" })),
    results,
    contexts: contextsByHash(results.flatMap((r) => r.contextHash ?? [])),
  });
}

/** Body: { name, prompt, refresh }. Starts a run over the test set. */
export async function POST(request: Request) {
  const denied = checkDevRequest(request);
  if (denied) return denied;
  const { name, prompt, refresh } = await request.json().catch(() => ({}));
  if (typeof prompt !== "string" || !prompt.trim()) return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  const config = getLlmConfig();
  if (!config) return NextResponse.json({ error: "No AI provider set up yet (Settings)." }, { status: 400 });
  if (listTracks().length === 0) return NextResponse.json({ error: "Add some songs to the test set first." }, { status: 400 });
  // Only looking songs up needs Spotify; a run on saved data doesn't.
  const accessToken = await getValidAccessToken().catch(() => null);
  if (!accessToken && refresh === true) return NextResponse.json({ error: "Log in to Spotify first." }, { status: 401 });
  const label = typeof name === "string" && name.trim() ? name.trim() : `Run ${new Date().toLocaleString()}`;
  return NextResponse.json({ id: startRun(label, prompt, config, refresh === true, accessToken) });
}

/** ?id= : deletes a run and its answers. */
export async function DELETE(request: Request) {
  const denied = checkDevRequest(request);
  if (denied) return denied;
  deleteRun(Number(new URL(request.url).searchParams.get("id")));
  return NextResponse.json({ ok: true });
}
