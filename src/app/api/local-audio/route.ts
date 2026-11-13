import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localRequest";
import { ffmpegAvailable, getLocalAudioProgress, localAudioCounts, soundModelReady, startLocalAudioScan, type LocalAudioProgress } from "@/lib/localAudio";
import { getSetting } from "@/lib/settings";

export interface LocalAudioStatus {
  folder: string | null;
  ffmpeg: boolean;
  soundModel: boolean;
  progress: LocalAudioProgress;
  counts: ReturnType<typeof localAudioCounts>;
}

async function status(): Promise<LocalAudioStatus> {
  return {
    folder: getSetting("MUSIC_FOLDER") ?? null,
    ffmpeg: await ffmpegAvailable(),
    soundModel: soundModelReady(),
    progress: getLocalAudioProgress(),
    counts: localAudioCounts(),
  };
}

// Polled by Settings while a scan runs.
export async function GET(request: Request) {
  return checkLocalRequest(request) ?? NextResponse.json(await status());
}

/**
 * Scans the music folder for new and changed files and measures them.
 * { downloadModel: true } first downloads the sound model.
 */
export async function POST(request: Request) {
  const denied = checkLocalRequest(request);
  if (denied) return denied;
  if (!getSetting("MUSIC_FOLDER")) return NextResponse.json({ error: "Set a music folder first." }, { status: 400 });
  if (!(await ffmpegAvailable())) {
    return NextResponse.json({ error: "ffmpeg isn't installed, or isn't on the PATH." }, { status: 400 });
  }
  const body = (await request.json().catch(() => ({}))) as { downloadModel?: unknown };
  startLocalAudioScan(body.downloadModel === true);
  return NextResponse.json(await status());
}
