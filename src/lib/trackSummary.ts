import { NextResponse } from "next/server";
import { getValidAccessToken } from "@/lib/spotify/auth";
import { SpotifyClient, SpotifyApiError } from "@/lib/spotify/client";
import { buildTrackContext, hasGenreEvidence, type SummaryStep } from "@/lib/context";
import { summarizeTrack, SUMMARY_PROMPT_VERSION } from "@/lib/llm/summarize";
import type { ShownSummary, TrackContext, TrackSummary } from "@/lib/llm/types";
import { getCache } from "@/lib/cache";
import { spotifyErrorResponse } from "@/lib/spotify/routeError";
import { describeGenres, getStoredGenres, saveTrackGenres } from "@/lib/trackGenres";
import { getLlmConfig } from "@/lib/settings";

const summaryCache = getCache<TrackSummary>("track-summary");

// The summary as shown: the stored tags (the user's, if they edited them)
// in the same spellings they're read back with elsewhere.
async function shownSummary(id: string, summary: TrackSummary): Promise<ShownSummary> {
  const stored = await getStoredGenres(id);
  const { own, broader } = stored ?? (await describeGenres(summary.subgenres));
  return { ...summary, subgenres: [...own, ...broader], own, broader, edited: stored?.edited ?? false };
}

/**
 * One song's genre summary, as the summary route returns it. onStep hears
 * each source (and then the AI) as it finishes, for per-song progress.
 * accessToken skips the session lookup — needed once a streamed response
 * has started, when a token refresh could no longer save its cookie.
 * refreshSources looks the song up again (latest MusicBrainz data
 * included) instead of using what's saved; forceRegenerate implies it.
 */
export async function summarizeTrackById(
  id: string,
  forceRegenerate: boolean,
  {
    onStep,
    accessToken,
    refreshSources = false,
  }: { onStep?: (step: SummaryStep) => void; accessToken?: string; refreshSources?: boolean } = {}
): Promise<NextResponse> {
  // Track context (Spotify metadata + artist genres + Last.fm tags + audio
  // features) is independent of the AI summary and always worth returning —
  // a flaky/rate-limited LLM shouldn't hide data we already successfully
  // fetched.
  let context: TrackContext;
  let lookupFailed: boolean;
  try {
    const client = new SpotifyClient(accessToken ?? (await getValidAccessToken()));
    ({ context, lookupFailed } = await buildTrackContext(id, client, onStep, forceRegenerate || refreshSources));
  } catch (err) {
    return spotifyErrorResponse(err, "track summary (context)");
  }

  const llmConfig = getLlmConfig();
  if (!llmConfig) {
    return NextResponse.json({
      context,
      summaryError: "No AI provider set up yet. Choose one and add its key in Settings.",
    });
  }

  const cacheKey = `${id}:${llmConfig.provider}:${llmConfig.model}:${SUMMARY_PROMPT_VERSION}`;
  const modelLabel = `${llmConfig.provider}:${llmConfig.model}`;
  if (!forceRegenerate) {
    const cached = await summaryCache.get(cacheKey);
    // An answer with no subgenres (usually from an empty lookup) is no
    // answer; ask again rather than serving it.
    if (cached && cached.subgenres.length > 0) {
      await saveTrackGenres(id, cached, modelLabel);
      onStep?.("ai");
      return NextResponse.json({ summary: await shownSummary(id, cached), context, cached: true });
    }
  }

  // With nothing to go on, the AI can only answer "unknown" — and saving
  // that would mark the song as done. Leave it missing to try again later.
  if (lookupFailed && !hasGenreEvidence(context)) {
    return NextResponse.json({
      context,
      summaryError: "Couldn't look this song up (Last.fm, MusicBrainz, and ReccoBeats all failed or timed out). Try again.",
    });
  }

  try {
    const summary = await summarizeTrack(context, llmConfig);
    onStep?.("ai");
    if (summary.subgenres.length === 0) {
      return NextResponse.json({
        context,
        summaryError: "The AI couldn't name any subgenres for this song, so nothing was saved. Try again.",
        // About this song alone, not a sign the AI or a source is down.
        songSpecific: true,
      });
    }
    await summaryCache.set(cacheKey, summary);
    // Regenerating replaces tags the user edited; otherwise they're kept.
    await saveTrackGenres(id, summary, modelLabel, forceRegenerate);
    return NextResponse.json({ summary: await shownSummary(id, summary), context, cached: false });
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
