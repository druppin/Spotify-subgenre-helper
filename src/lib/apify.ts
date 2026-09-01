/**
 * Wraps the Apify "Spotify Audio Features Scraper" actor, which replaces
 * Spotify's own Audio Features endpoint (closed to new apps since Nov 2024)
 * with a pay-per-result actor returning the same field shape.
 *
 * NOTE: the actor slug/input schema below is our best guess from the actor's
 * public docs and hasn't been verified against a real run yet (no Apify
 * token in this environment). Once APIFY_API_TOKEN is set, run one track
 * through this and check the shape of `raw` in the result against what
 * comes back — adjust APIFY_ACTOR_ID / the input body / the field mapping
 * below to match.
 */

const RUN_SYNC_URL = (actorId: string) =>
  `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items`;

export interface AudioFeatures {
  danceability: number;
  energy: number;
  key: number;
  loudness: number;
  mode: number;
  speechiness: number;
  acousticness: number;
  instrumentalness: number;
  liveness: number;
  valence: number;
  tempo: number;
  time_signature: number;
}

interface ApifyDatasetItem {
  id?: string;
  trackId?: string;
  track_id?: string;
  danceability?: number;
  energy?: number;
  key?: number;
  loudness?: number;
  mode?: number;
  speechiness?: number;
  acousticness?: number;
  instrumentalness?: number;
  liveness?: number;
  valence?: number;
  tempo?: number;
  time_signature?: number;
  [key: string]: unknown;
}

function actorId(): string {
  return process.env.APIFY_ACTOR_ID ?? "scraping-solutions~spotify-audio-features-scraper";
}

function apiToken(): string | undefined {
  return process.env.APIFY_API_TOKEN;
}

function toAudioFeatures(item: ApifyDatasetItem): AudioFeatures | null {
  if (typeof item.danceability !== "number") return null;
  return {
    danceability: item.danceability,
    energy: item.energy ?? 0,
    key: item.key ?? -1,
    loudness: item.loudness ?? 0,
    mode: item.mode ?? 0,
    speechiness: item.speechiness ?? 0,
    acousticness: item.acousticness ?? 0,
    instrumentalness: item.instrumentalness ?? 0,
    liveness: item.liveness ?? 0,
    valence: item.valence ?? 0,
    tempo: item.tempo ?? 0,
    time_signature: item.time_signature ?? 4,
  };
}

/**
 * Fetches audio features for a batch of Spotify track IDs. Returns null for
 * any request without an APIFY_API_TOKEN configured (feature is optional —
 * callers should degrade gracefully, not fail the whole track context).
 */
export async function getAudioFeatures(
  trackIds: string[]
): Promise<Record<string, AudioFeatures | null>> {
  const token = apiToken();
  const result: Record<string, AudioFeatures | null> = Object.fromEntries(
    trackIds.map((id) => [id, null])
  );
  if (!token || trackIds.length === 0) return result;

  const trackUrls = trackIds.map((id) => `https://open.spotify.com/track/${id}`);
  const res = await fetch(`${RUN_SYNC_URL(actorId())}?token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trackUrls }),
  });

  if (!res.ok) {
    throw new Error(`Apify audio features run failed: ${res.status} ${await res.text()}`);
  }

  const items: ApifyDatasetItem[] = await res.json();
  for (const item of items) {
    const trackId = item.trackId ?? item.track_id ?? item.id;
    if (!trackId || !trackIds.includes(trackId)) continue;
    result[trackId] = toAudioFeatures(item);
  }
  return result;
}
