import { NextRequest, NextResponse } from "next/server";
import { getValidAccessToken } from "@/lib/spotify/auth";
import { spotifyErrorResponse } from "@/lib/spotify/routeError";
import { summarizeTrackById } from "@/lib/trackSummary";

/*
 * Bulk genre generation as one streamed request. Browsers open at most 6
 * connections to a plain-http server, so one request per song capped the
 * real concurrency at 6 however many the user asked for; here the server
 * runs the songs in parallel and reports on all of them over one response.
 */

const MAX_CONCURRENCY = 25;
const SONG_TIMEOUT_MS = 90_000;

// Runs in progress, and whether each has been asked to stop: no new songs
// start, songs already running finish.
const runs = new Map<string, { stopping: boolean }>();

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Body: { runId, trackIds, concurrency }. Responds with newline-delimited
 * JSON: {"id","started":true} when a song starts, {"id","step"} as each of
 * its sources finishes, {"id","status","body"} with what the single-song
 * summary route would have returned, and finally {"done":true}.
 */
export async function POST(request: NextRequest) {
  const { runId, trackIds, concurrency } = await request.json();
  if (typeof runId !== "string" || !Array.isArray(trackIds)) {
    return NextResponse.json({ error: "runId and trackIds are required" }, { status: 400 });
  }
  const workers = Math.min(Math.max(Math.round(Number(concurrency)) || 1, 1), MAX_CONCURRENCY, trackIds.length);

  // A token refresh saves a cookie, which can't happen once streaming has
  // begun — so get a valid token now and use it for the whole run.
  let accessToken: string;
  try {
    accessToken = await getValidAccessToken();
  } catch (err) {
    return spotifyErrorResponse(err, "POST /api/genre-runs");
  }

  const run = { stopping: false };
  runs.set(runId, run);
  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream({
    async start(controller) {
      const send = (line: unknown) => {
        if (!closed) controller.enqueue(encoder.encode(JSON.stringify(line) + "\n"));
      };
      let next = 0;
      const worker = async () => {
        while (next < trackIds.length && !closed && !run.stopping) {
          const id = String(trackIds[next++]);
          send({ id, started: true });
          try {
            const res = await withTimeout(
              summarizeTrackById(id, false, { accessToken, onStep: (step) => send({ id, step }) }),
              SONG_TIMEOUT_MS
            );
            send({ id, status: res.status, body: await res.json() });
          } catch (err) {
            send({ id, status: 500, body: { error: err instanceof Error ? err.message : String(err) } });
          }
        }
      };
      await Promise.all(Array.from({ length: workers }, worker));
      runs.delete(runId);
      send({ done: true });
      if (!closed) controller.close();
      closed = true;
    },
    // The page went away (dialog closed, tab closed): start nothing new.
    cancel() {
      closed = true;
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson" } });
}

/** ?runId=: stop starting new songs in that run. */
export async function DELETE(request: NextRequest) {
  const runId = new URL(request.url).searchParams.get("runId");
  const run = runId ? runs.get(runId) : undefined;
  if (run) run.stopping = true;
  return NextResponse.json({ ok: true });
}
