import { fetchWithTimeout } from "@/lib/fetchWithTimeout";
import { getCache } from "@/lib/cache";

/*
 * Record labels from Deezer's public API (no key needed): a song is found by
 * its ISRC, then its album carries the label. Spotify stopped giving labels
 * to development-mode apps in its February 2026 changes.
 */

const API_BASE = "https://api.deezer.com";
// Deezer is reported to allow about 50 requests per 5 seconds; stay well under.
const MIN_INTERVAL_MS = 150;
// Deezer's "no data": the song or album isn't there, as opposed to a failed lookup.
const NO_DATA = 800;

// Labels don't change, so lookups are kept for good: by ISRC, and by album
// so songs from the same album share one album request.
const labelCache = getCache<{ label: string | null }>("deezer-labels");

let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

// One request at a time, spaced out.
function throttled<T>(run: () => Promise<T>): Promise<T> {
  const next = queue.then(async () => {
    const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
    return run();
  });
  queue = next.catch(() => {});
  return next;
}

// The JSON body, or null when Deezer has no such item; undefined when the lookup failed.
async function get<T>(path: string, onFailure?: () => void): Promise<T | null | undefined> {
  try {
    const res = await throttled(() => fetchWithTimeout(`${API_BASE}${path}`, {}, 10_000));
    const body = await res.json().catch(() => null);
    if (body?.error?.code === NO_DATA) return null;
    if (!res.ok || !body || body.error) {
      onFailure?.();
      return undefined;
    }
    return body as T;
  } catch {
    onFailure?.();
    return undefined;
  }
}

/** The record label of the release a song is on, or null if Deezer doesn't know it. */
export async function getRecordLabel(isrc: string | null, onFailure?: () => void): Promise<string | null> {
  if (!isrc) return null;
  const cached = await labelCache.get(`isrc:${isrc}`);
  if (cached) return cached.label;

  const track = await get<{ album?: { id?: number } }>(`/track/isrc:${encodeURIComponent(isrc)}`, onFailure);
  if (track === undefined) return null;
  const albumId = track?.album?.id;
  let label: string | null = null;
  if (albumId) {
    const album = await labelCache.get(`album:${albumId}`);
    if (album) {
      label = album.label;
    } else {
      const body = await get<{ label?: string }>(`/album/${albumId}`, onFailure);
      if (body === undefined) return null;
      label = body?.label?.trim() || null;
      await labelCache.set(`album:${albumId}`, { label });
    }
  }
  await labelCache.set(`isrc:${isrc}`, { label });
  return label;
}
