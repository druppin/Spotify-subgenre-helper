import { NextRequest, NextResponse } from "next/server";
import { getValidAccessToken } from "@/lib/spotify/auth";
import { SpotifyClient, SpotifyApiError } from "@/lib/spotify/client";
import { buildTrackContext, type SummaryStep } from "@/lib/context";
import { summarizeTrack, SUMMARY_PROMPT_VERSION } from "@/lib/llm/summarize";
import type { LlmConfig, LlmProvider, TrackContext, TrackSummary } from "@/lib/llm/types";
import { getCache } from "@/lib/cache";
import { spotifyErrorResponse } from "@/lib/spotify/routeError";
import { saveTrackGenres } from "@/lib/trackGenres";

const summaryCache = getCache<TrackSummary>("track-summary");

function llmConfigFromEnv(): LlmConfig | null {
  const provider = process.env.LLM_PROVIDER as LlmProvider | undefined;
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL;
  if (!provider || !apiKey || !model) return null;
  return { provider, apiKey, model };
}

/**
 * With ?progress=1 the response is newline-delimited JSON: a
 * {"step": ...} line as each source (and then the AI) finishes, ending with
 * {"status": ..., "body": ...} — the status and body the plain request would
 * have returned. Bulk genre generation uses it to show each song's progress.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const searchParams = new URL(request.url).searchParams;
  const forceRegenerate = searchParams.get("force") === "true";
  if (searchParams.get("progress") !== "1") return summarize(id, forceRegenerate);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (line: unknown) => controller.enqueue(encoder.encode(JSON.stringify(line) + "\n"));
      const res = await summarize(id, forceRegenerate, (step) => send({ step }));
      send({ status: res.status, body: await res.json() });
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson" } });
}

async function summarize(
  id: string,
  forceRegenerate: boolean,
  onStep?: (step: SummaryStep) => void
): Promise<NextResponse> {

  // Track context (Spotify metadata + artist genres + Last.fm tags + audio
  // features) is independent of the AI summary and always worth returning —
  // a flaky/rate-limited LLM shouldn't hide data we already successfully
  // fetched.
  let context: TrackContext;
  try {
    const accessToken = await getValidAccessToken();
    const client = new SpotifyClient(accessToken);
    context = await buildTrackContext(id, client, onStep);
  } catch (err) {
    return spotifyErrorResponse(err, "GET /api/track/[id]/summary (context)");
  }

  const llmConfig = llmConfigFromEnv();
  if (!llmConfig) {
    return NextResponse.json({
      context,
      summaryError: "LLM_PROVIDER, LLM_API_KEY, and LLM_MODEL must be set (see .env.example)",
    });
  }

  const cacheKey = `${id}:${llmConfig.provider}:${llmConfig.model}:${SUMMARY_PROMPT_VERSION}`;
  const modelLabel = `${llmConfig.provider}:${llmConfig.model}`;
  if (!forceRegenerate) {
    const cached = await summaryCache.get(cacheKey);
    if (cached) {
      await saveTrackGenres(id, cached, modelLabel);
      onStep?.("ai");
      return NextResponse.json({ summary: cached, context, cached: true });
    }
  }

  try {
    const summary = await summarizeTrack(context, llmConfig);
    onStep?.("ai");
    await summaryCache.set(cacheKey, summary);
    await saveTrackGenres(id, summary, modelLabel);
    return NextResponse.json({ summary, context, cached: false });
  } catch (err) {
    console.error("GET /api/track/[id]/summary (LLM) failed:", err);
    if (err instanceof SpotifyApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    // The AI summary failed, but context is still good data — return both,
    // 200 status, and let the UI show context immediately with a retryable
    // summary error rather than losing everything to a transient LLM hiccup.
    return NextResponse.json({ context, summaryError: message });
  }
}
