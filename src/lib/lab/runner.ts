import { buildTrackContext } from "@/lib/context";
import { summarizeTrack } from "@/lib/llm/summarize";
import type { LlmConfig } from "@/lib/llm/types";
import { SpotifyClient } from "@/lib/spotify/client";
import { createRun, finishRun, latestContext, listTracks, saveContext, saveResult } from "./store";

// Songs sent to the AI at once; low enough to stay under free-tier rate limits.
const CONCURRENCY = 2;

// Runs going in this server process. A run with no finish time that isn't
// here was cut off by a restart.
const holder = globalThis as typeof globalThis & { __labRunning?: Set<number> };
export const running = (holder.__labRunning ??= new Set());

/**
 * Starts a run of `prompt` over the whole test set and returns its id
 * straight away; results are saved one song at a time as they come in.
 * refresh looks every song up again first (saving the data if it changed),
 * otherwise each song's last saved data is reused so only the prompt varies.
 */
export function startRun(name: string, prompt: string, config: LlmConfig, refresh: boolean, accessToken: string | null): number {
  const trackIds = listTracks().map((t) => t.trackId);
  const runId = createRun(name, prompt, `${config.provider}:${config.model}`, refresh, trackIds.length);
  running.add(runId);

  const runOne = async (trackId: string) => {
    let contextHash: string | null = null;
    try {
      let saved = latestContext(trackId);
      if (refresh || !saved) {
        if (!accessToken) throw new Error("No saved data for this song; log in to Spotify to look it up.");
        const { context, lookupFailed } = await buildTrackContext(trackId, new SpotifyClient(accessToken), undefined, refresh);
        if (lookupFailed && saved) throw new Error("Looking the song up again failed; its saved data was left as it was.");
        saved = { hash: saveContext(context), context };
      }
      contextHash = saved.hash;
      const summary = await summarizeTrack(saved.context, config, prompt);
      saveResult({ runId, trackId, contextHash, summary, error: null });
    } catch (err) {
      saveResult({ runId, trackId, contextHash, summary: null, error: err instanceof Error ? err.message : String(err) });
    }
  };

  void (async () => {
    const queue = [...trackIds];
    const worker = async () => {
      for (let id = queue.shift(); id; id = queue.shift()) await runOne(id);
    };
    try {
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    } finally {
      finishRun(runId);
      running.delete(runId);
    }
  })();
  return runId;
}
