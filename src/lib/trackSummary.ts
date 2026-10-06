import { NextResponse } from "next/server";
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
 * One song's genre summary, as the summary route returns it. onStep hears
 * each source (and then the AI) as it finishes, for per-song progress.
 * accessToken skips the session lookup — needed once a streamed response
 * has started, when a token refresh could no longer save its cookie.
 */
export async function summarizeTrackById(
  id: string,
  forceRegenerate: boolean,
  { onStep, accessToken }: { onStep?: (step: SummaryStep) => void; accessToken?: string } = {}
): Promise<NextResponse> {
  // Track context (Spotify metadata + artist genres + Last.fm tags + audio
  // features) is independent of the AI summary and always worth returning —
  // a flaky/rate-limited LLM shouldn't hide data we already successfully
  // fetched.
  let context: TrackContext;
  try {
    const client = new SpotifyClient(accessToken ?? (await getValidAccessToken()));
    context = await buildTrackContext(id, client, onStep);
  } catch (err) {
    return spotifyErrorResponse(err, "track summary (context)");
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
    console.error("track summary (LLM) failed:", err);
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
