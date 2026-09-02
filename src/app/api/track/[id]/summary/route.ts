import { NextRequest, NextResponse } from "next/server";
import { getValidAccessToken } from "@/lib/spotify/auth";
import { SpotifyClient, SpotifyApiError } from "@/lib/spotify/client";
import { buildTrackContext } from "@/lib/context";
import { summarizeTrack, SUMMARY_PROMPT_VERSION } from "@/lib/llm/summarize";
import type { LlmConfig, LlmProvider, TrackContext, TrackSummary } from "@/lib/llm/types";
import { getCache } from "@/lib/cache";
import { spotifyErrorResponse } from "@/lib/spotify/routeError";

const summaryCache = getCache<TrackSummary>("track-summary");

function llmConfigFromEnv(): LlmConfig | null {
  const provider = process.env.LLM_PROVIDER as LlmProvider | undefined;
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL;
  if (!provider || !apiKey || !model) return null;
  return { provider, apiKey, model };
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Track context (Spotify metadata + artist genres + Last.fm tags + audio
  // features) is independent of the AI summary and always worth returning —
  // a flaky/rate-limited LLM shouldn't hide data we already successfully
  // fetched.
  let context: TrackContext;
  try {
    const accessToken = await getValidAccessToken();
    const client = new SpotifyClient(accessToken);
    context = await buildTrackContext(id, client);
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
  const cached = await summaryCache.get(cacheKey);
  if (cached) {
    return NextResponse.json({ summary: cached, context, cached: true });
  }

  try {
    const summary = await summarizeTrack(context, llmConfig);
    await summaryCache.set(cacheKey, summary);
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
