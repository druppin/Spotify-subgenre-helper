import { NextRequest, NextResponse } from "next/server";
import { getValidAccessToken } from "@/lib/spotify/auth";
import { SpotifyClient } from "@/lib/spotify/client";
import { buildTrackContext } from "@/lib/context";
import { summarizeTrack } from "@/lib/llm/summarize";
import type { LlmConfig, LlmProvider, TrackSummary } from "@/lib/llm/types";
import { getCache } from "@/lib/cache";

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

  const llmConfig = llmConfigFromEnv();
  if (!llmConfig) {
    return NextResponse.json(
      { error: "LLM_PROVIDER, LLM_API_KEY, and LLM_MODEL must be set (see .env.example)" },
      { status: 500 }
    );
  }

  const cacheKey = `${id}:${llmConfig.provider}:${llmConfig.model}`;
  const cached = await summaryCache.get(cacheKey);
  if (cached) {
    return NextResponse.json({ summary: cached, cached: true });
  }

  try {
    const accessToken = await getValidAccessToken();
    const client = new SpotifyClient(accessToken);
    const context = await buildTrackContext(id, client);
    const summary = await summarizeTrack(context, llmConfig);
    await summaryCache.set(cacheKey, summary);
    return NextResponse.json({ summary, context, cached: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = message.includes("Not authenticated") ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
