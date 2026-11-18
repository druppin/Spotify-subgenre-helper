import { execFile } from "child_process";
import { existsSync, watch, type FSWatcher } from "fs";
import { mkdir, readdir, rename, stat, writeFile } from "fs/promises";
import path from "path";
import { promisify } from "util";
import { DATA_DIR } from "@/lib/dataDir";
import { sql, transaction } from "@/lib/db";
import { dipsFromSlices, mixDensity, spotifyIdFromTag, type AudioMeasures, type MixDensity } from "@/lib/mixDensity";
import { getSetting } from "@/lib/settings";
import { EMBEDDING_SIZE, melPatches, PATCH_FRAMES, PATCH_SIZE, soundsLike, type SoundsLike } from "@/lib/soundsLike";

/*
 * Mix density from the user's own audio files. A scan walks the music
 * folder, reads each file's SPOTIFY_ID tag (set by the user's download
 * tool), then measures one file per song with ffmpeg. Both steps skip
 * files that haven't changed since the last scan. Off until a music folder
 * is set, and needs ffmpeg on the PATH. Once the user downloads the sound
 * model, a scan also has it listen to each song (see soundsLike.ts). The
 * folder is watched, so songs added to it are scanned without asking.
 */

const run = promisify(execFile);
const AUDIO_EXTENSIONS = new Set([".mp3", ".flac", ".m4a", ".ogg", ".opus", ".wav", ".aiff", ".aif"]);
// Files measured at once; each runs five ffmpegs side by side.
const PARALLEL = 2;
// Discogs-EffNet, free for non-commercial use (CC BY-NC-SA 4.0), so it's
// downloaded on request rather than shipped.
const MODEL_URL = "https://essentia.upf.edu/models/feature-extractors/discogs-effnet/discogs-effnet-bsdynamic-1.onnx";
const MODEL_PATH = path.join(DATA_DIR, "models", "discogs-effnet-bsdynamic-1.onnx");
// Patches per model run.
const BATCH = 32;
// How long the folder must stay still before a watched change is scanned,
// so a download or a batch of new files is scanned once, whole.
const SETTLE_MS = 10_000;

export interface LocalAudioProgress {
  phase: "idle" | "downloading" | "scanning" | "measuring" | "listening" | "done" | "error";
  // Audio files found, and how many of them have had their tags read.
  files: number;
  scanned: number;
  toMeasure: number;
  measured: number;
  toListen: number;
  listened: number;
  error: string | null;
}

// On globalThis so the status route sees the job the scan route started.
const holder = globalThis as typeof globalThis & {
  __localAudio?: {
    progress: LocalAudioProgress;
    ffmpeg?: boolean;
    model?: Promise<import("onnxruntime-web").InferenceSession>;
    watched?: { folder: string; watcher: FSWatcher };
    settleTimer?: NodeJS.Timeout;
  };
};
const IDLE: LocalAudioProgress = { phase: "idle", files: 0, scanned: 0, toMeasure: 0, measured: 0, toListen: 0, listened: 0, error: null };
holder.__localAudio ??= { progress: IDLE };
const state = holder.__localAudio;

export function getLocalAudioProgress(): LocalAudioProgress {
  return state.progress;
}

/** Whether ffmpeg and ffprobe can be run; checked once per server start. */
export async function ffmpegAvailable(): Promise<boolean> {
  if (state.ffmpeg === undefined) {
    const works = (tool: string) => run(tool, ["-version"]).then(() => true, () => false);
    state.ffmpeg = (await works("ffmpeg")) && (await works("ffprobe"));
  }
  return state.ffmpeg;
}

export function localAudioCounts(): { files: number; matched: number; measured: number; listened: number } {
  const row = sql(
    `SELECT (SELECT count(*) FROM local_files) AS files,
            (SELECT count(DISTINCT track_id) FROM local_files WHERE track_id IS NOT NULL) AS matched,
            (SELECT count(*) FROM track_audio WHERE dip_db IS NOT NULL) AS measured,
            (SELECT count(*) FROM track_audio WHERE length(embedding) > 0) AS listened`
  ).get() as { files: number; matched: number; measured: number; listened: number };
  return { ...row };
}

/** Whether the sound model has been downloaded. */
export function soundModelReady(): boolean {
  return existsSync(MODEL_PATH);
}

/**
 * Starts a scan of the music folder unless one is running, first
 * downloading the sound model if asked; progress shows in
 * getLocalAudioProgress.
 */
export function startLocalAudioScan(downloadModel = false): void {
  if (!["idle", "done", "error"].includes(state.progress.phase)) return;
  const folder = getSetting("MUSIC_FOLDER");
  state.progress = { ...IDLE, phase: downloadModel && !soundModelReady() ? "downloading" : "scanning" };
  void (async () => {
    if (!folder) throw new Error("No music folder is set.");
    if (!(await ffmpegAvailable())) throw new Error("ffmpeg isn't installed, or isn't on the PATH.");
    if (state.progress.phase === "downloading") await fetchSoundModel();
    state.progress.phase = "scanning";
    await scanFolder(folder);
    await measureChanged();
    if (soundModelReady()) await listenToChanged();
    state.progress.phase = "done";
  })().catch((err) => {
    console.error("Music folder scan failed:", err);
    state.progress = { ...state.progress, phase: "error", error: err instanceof Error ? err.message : String(err) };
  });
}

/**
 * Watches the music folder (stopping any watch on a previous one) and scans
 * once it has settled after audio files change. Called at server start and
 * when the folder setting is saved.
 */
export function watchMusicFolder(): void {
  const folder = getSetting("MUSIC_FOLDER") ?? null;
  if (state.watched?.folder === folder) return;
  state.watched?.watcher.close();
  state.watched = undefined;
  if (!folder) return;
  const scanWhenSettled = () => {
    clearTimeout(state.settleTimer);
    state.settleTimer = setTimeout(async () => {
      // A scan still running would miss this change: try again after it.
      if (!["idle", "done", "error"].includes(state.progress.phase)) return scanWhenSettled();
      if (await ffmpegAvailable()) startLocalAudioScan();
    }, SETTLE_MS);
  };
  try {
    const watcher = watch(folder, { recursive: true }, (_event, name) => {
      // Folder renames and deletes come without an audio extension, and can take songs with them.
      if (name && path.extname(name) && !AUDIO_EXTENSIONS.has(path.extname(name).toLowerCase())) return;
      scanWhenSettled();
    });
    watcher.on("error", (err) => {
      console.warn(`Stopped watching the music folder ${folder}:`, err.message);
      watcher.close();
      if (state.watched?.watcher === watcher) state.watched = undefined;
    });
    state.watched = { folder, watcher };
  } catch (err) {
    console.warn(`Couldn't watch the music folder ${folder}:`, err instanceof Error ? err.message : err);
  }
}

async function scanFolder(folder: string) {
  const files: { path: string; mtimeMs: number }[] = [];
  for (const entry of await readdir(folder, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    const full = path.join(entry.parentPath, entry.name);
    files.push({ path: full, mtimeMs: Math.round((await stat(full)).mtimeMs) });
  }
  state.progress.files = files.length;

  const known = new Map(
    (sql("SELECT path, mtime_ms FROM local_files").all() as { path: string; mtime_ms: number }[]).map((r) => [r.path, r.mtime_ms])
  );
  const changed = files.filter((f) => known.get(f.path) !== f.mtimeMs);
  state.progress.scanned = files.length - changed.length;
  await inParallel(changed, async (file) => {
    const trackId = await readSpotifyId(file.path).catch(() => null);
    sql("INSERT OR REPLACE INTO local_files (path, mtime_ms, track_id) VALUES (?, ?, ?)").run(file.path, file.mtimeMs, trackId);
    state.progress.scanned++;
  });

  // Files that are gone, or outside a newly chosen folder.
  const present = new Set(files.map((f) => f.path));
  transaction(() => {
    for (const p of known.keys()) if (!present.has(p)) sql("DELETE FROM local_files WHERE path = ?").run(p);
  });
}

async function readSpotifyId(file: string): Promise<string | null> {
  const { stdout } = await run("ffprobe", ["-v", "quiet", "-show_entries", "format_tags:stream_tags", "-of", "json", file]);
  const parsed = JSON.parse(stdout) as { format?: { tags?: Record<string, string> }; streams?: { tags?: Record<string, string> }[] };
  // Tag names vary in case between formats (ID3 TXXX, Vorbis comments).
  for (const tags of [parsed.format?.tags, ...(parsed.streams ?? []).map((s) => s.tags)]) {
    for (const [name, value] of Object.entries(tags ?? {})) {
      if (name.toUpperCase() === "SPOTIFY_ID") return spotifyIdFromTag(value);
    }
  }
  return null;
}

async function measureChanged() {
  // One file per song: the first by path, unless it's already measured as is.
  const todo = sql(
    `SELECT f.track_id, f.path, f.mtime_ms FROM local_files f
     LEFT JOIN track_audio a ON a.track_id = f.track_id
     WHERE f.track_id IS NOT NULL
       AND f.path = (SELECT min(path) FROM local_files WHERE track_id = f.track_id)
       AND (a.track_id IS NULL OR a.path != f.path OR a.mtime_ms != f.mtime_ms)`
  ).all() as { track_id: string; path: string; mtime_ms: number }[];
  state.progress.phase = "measuring";
  state.progress.toMeasure = todo.length;
  await inParallel(todo, async (row) => {
    const m = await measureFile(row.path).catch((err) => {
      console.warn(`Couldn't measure ${row.path}:`, err instanceof Error ? err.message : err);
      return null;
    });
    sql(
      `INSERT OR REPLACE INTO track_audio (track_id, path, mtime_ms, dip_db, gap_share, sub_db, mid_db, flatness, measured_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(row.track_id, row.path, row.mtime_ms, m?.dipDb ?? null, m?.gapShare ?? null, m?.subDb ?? null, m?.midDb ?? null, m?.flatness ?? null, Date.now());
    state.progress.measured++;
  });
}

/**
 * Measures one minute from 35% into the file, usually past the intro and
 * in a drop. Null when the file is too short or silent to say.
 */
async function measureFile(file: string): Promise<AudioMeasures | null> {
  const { stdout } = await run("ffprobe", ["-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  const start = String((Number(stdout) || 0) * 0.35);
  const window = ["-nostdin", "-hide_banner", "-ss", start, "-t", "60", "-i", file];

  const rms = async (filters: string) => {
    const { stderr } = await ffmpeg([...window, "-af", `${filters}astats=measure_overall=RMS_level:measure_perchannel=none`, "-f", "null", "-"]);
    const value = stderr.split("Overall").at(-1)?.match(/RMS level dB: (-?[\d.]+|-inf)/)?.[1];
    return value === undefined || value === "-inf" ? null : Number(value);
  };
  const metadata = async (filters: string, key: string) => {
    const { stdout } = await ffmpeg([...window, "-ac", "1", "-af", `${filters},ametadata=print:file=-`, "-f", "null", "-"]);
    return [...stdout.matchAll(new RegExp(`${key}=(-?[\\d.]+)`, "g"))].map((m) => Number(m[1]));
  };

  const [overall, sub, mid, slices, flatness] = await Promise.all([
    rms(""),
    rms("lowpass=f=100,"),
    rms("highpass=f=200,lowpass=f=2000,"),
    // Loudness of each 1102-sample slice (25 ms at 44.1 kHz), as the
    // reference numbers in mixDensity.ts were measured.
    metadata(
      "asetnsamples=n=1102,astats=metadata=1:reset=1:measure_perchannel=RMS_level:measure_overall=none",
      "lavfi.astats.1.RMS_level"
    ),
    metadata("aspectralstats=measure=flatness", "lavfi.aspectralstats.1.flatness"),
  ]);
  const dips = dipsFromSlices(slices);
  // Below -60 dB the window is effectively silence.
  if (overall === null || overall < -60 || sub === null || mid === null || !dips || flatness.length === 0) return null;
  return {
    ...dips,
    subDb: sub - overall,
    midDb: mid - overall,
    flatness: flatness.reduce((a, b) => a + b, 0) / flatness.length,
  };
}

function ffmpeg(args: string[]) {
  // Per-slice metadata runs to a few hundred KB.
  return run("ffmpeg", args, { maxBuffer: 64 * 1024 * 1024 });
}

async function inParallel<T>(items: T[], fn: (item: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, items.length) }, worker));
}

async function fetchSoundModel() {
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`Couldn't download the sound model (HTTP ${res.status}).`);
  const body = Buffer.from(await res.arrayBuffer());
  // The model's server has been seen to cut downloads short.
  const expected = Number(res.headers.get("content-length"));
  if (expected && body.length !== expected) throw new Error("The sound model download was cut short. Try again.");
  await mkdir(path.dirname(MODEL_PATH), { recursive: true });
  await writeFile(`${MODEL_PATH}.part`, body);
  await rename(`${MODEL_PATH}.part`, MODEL_PATH);
}

function soundModel() {
  state.model ??= import("onnxruntime-web").then((ort) => ort.InferenceSession.create(MODEL_PATH));
  // A failed load is tried again next time.
  state.model.catch(() => (state.model = undefined));
  return state.model;
}

// Songs measured since the model last listened (a changed file is measured
// afresh, which clears its embedding).
async function listenToChanged() {
  const todo = sql("SELECT track_id, path FROM track_audio WHERE embedding IS NULL").all() as { track_id: string; path: string }[];
  state.progress.phase = "listening";
  state.progress.toListen = todo.length;
  for (const row of todo) {
    const embedding = await embedFile(row.path).catch((err) => {
      console.warn(`Couldn't listen to ${row.path}:`, err instanceof Error ? err.message : err);
      return null;
    });
    const blob = embedding ? new Uint8Array(embedding.buffer) : new Uint8Array();
    sql("UPDATE track_audio SET embedding = ? WHERE track_id = ?").run(blob, row.track_id);
    state.progress.listened++;
  }
}

/** The sound model's numbers for a whole file, averaged over its patches; null if it's too short. */
async function embedFile(file: string): Promise<Float32Array | null> {
  const { stdout } = await run("ffmpeg", ["-nostdin", "-v", "error", "-i", file, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"], {
    encoding: "buffer",
    // About 4 MB a minute.
    maxBuffer: 1024 * 1024 * 1024,
  });
  const pcm = new Float32Array(stdout.buffer.slice(stdout.byteOffset, stdout.byteOffset + stdout.byteLength - (stdout.byteLength % 4)));
  const { data, count } = melPatches(pcm);
  if (count === 0) return null;
  const session = await soundModel();
  const { Tensor } = await import("onnxruntime-web");
  const sum = new Float32Array(EMBEDDING_SIZE);
  for (let start = 0; start < count; start += BATCH) {
    const n = Math.min(BATCH, count - start);
    const input = new Tensor("float32", data.subarray(start * PATCH_SIZE, (start + n) * PATCH_SIZE), [n, PATCH_FRAMES, PATCH_SIZE / PATCH_FRAMES]);
    const { embeddings } = await session.run({ melspectrogram: input });
    const values = embeddings.data as Float32Array;
    for (let i = 0; i < values.length; i++) sum[i % EMBEDDING_SIZE] += values[i] / count;
  }
  return sum;
}

/** The playlists of the songs that sound most like this one, if its file has been listened to. */
export function getSoundsLike(trackId: string): SoundsLike | null {
  if (!getSetting("MUSIC_FOLDER")) return null;
  const embeddings = sql("SELECT track_id, embedding FROM track_audio WHERE length(embedding) > 0").all() as {
    track_id: string;
    embedding: Uint8Array;
  }[];
  const asFloats = (blob: Uint8Array) => new Float32Array(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength));
  const target = embeddings.find((e) => e.track_id === trackId);
  if (!target) return null;
  const playlistsOf = new Map<string, string[]>();
  for (const row of sql(
    `SELECT DISTINCT t.id, p.name FROM place_tracks pt
     JOIN places p ON p.id = pt.place_id JOIN tracks t ON t.uri = pt.track_uri
     WHERE p.kind = 'playlist' AND p.name IS NOT NULL`
  ).all() as { id: string; name: string }[]) {
    playlistsOf.set(row.id, [...(playlistsOf.get(row.id) ?? []), row.name]);
  }
  // Every other song that's in a playlist; songs in none have no vote.
  const library = embeddings
    .filter((e) => e.track_id !== trackId && playlistsOf.has(e.track_id))
    .map((e) => ({ embedding: asFloats(e.embedding), playlists: playlistsOf.get(e.track_id)! }));
  return soundsLike(asFloats(target.embedding), library);
}

/** The song's mix density, if its file in the music folder has been measured. */
export function getMixDensity(trackId: string): MixDensity | null {
  if (!getSetting("MUSIC_FOLDER")) return null;
  const row = sql("SELECT dip_db, gap_share, sub_db, mid_db, flatness FROM track_audio WHERE track_id = ? AND dip_db IS NOT NULL").get(
    trackId
  ) as { dip_db: number; gap_share: number; sub_db: number; mid_db: number; flatness: number } | undefined;
  if (!row) return null;
  return mixDensity({ dipDb: row.dip_db, gapShare: row.gap_share, subDb: row.sub_db, midDb: row.mid_db, flatness: row.flatness });
}
