import { NextResponse } from "next/server";
import { checkDevRequest } from "@/lib/devMode";
import { DEFAULT_SUMMARY_PROMPT, promptHash } from "@/lib/llm/summarize";
import { running } from "@/lib/lab/runner";
import { scoreRun, scoreTrack } from "@/lib/lab/score";
import { allResults, listRuns, listTracks, liveSummaryPrompt } from "@/lib/lab/store";
import { STARTER_SET } from "@/lib/lab/starterSet";
import { getLlmConfig } from "@/lib/settings";

export type LabOverview = ReturnType<typeof overview>;

function overview() {
  const tracks = listTracks();
  const truths = new Map(tracks.flatMap((t) => (t.truth ? [[t.trackId, t.truth] as const] : [])));
  const results = allResults();
  const runs = listRuns().map((run) => {
    // Scored against today's truths, so changing a truth re-scores every run.
    const scores = results
      .filter((r) => r.runId === run.id && r.summary && truths.has(r.trackId))
      .map((r) => scoreTrack(r.summary!.subgenres, r.summary!.confidence ?? {}, truths.get(r.trackId)!));
    return {
      ...run,
      status: run.finishedAt ? "done" : running.has(run.id) ? "running" : "interrupted",
      errors: results.filter((r) => r.runId === run.id && r.error).length,
      score: scoreRun(scores),
    };
  });
  const live = liveSummaryPrompt();
  const config = getLlmConfig();
  return {
    // What runs and the chat use: the model chosen in Settings.
    model: config ? `${config.provider}:${config.model}` : null,
    starterCount: STARTER_SET.length,
    tracks,
    runs,
    defaultPrompt: DEFAULT_SUMMARY_PROMPT,
    livePrompt: live,
    livePromptHash: promptHash(live),
    liveIsDefault: live === DEFAULT_SUMMARY_PROMPT,
  };
}

export async function GET(request: Request) {
  return checkDevRequest(request) ?? NextResponse.json(overview());
}
