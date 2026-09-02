/**
 * Wraps ReccoBeats' audio-features API, a free replacement for Spotify's own
 * Audio Features endpoint (closed to new apps since Nov 2024). No API key
 * required. Confirmed live (2026-09-02) via:
 *   GET https://api.reccobeats.com/v1/audio-features?ids=<spotify_track_id>[,<spotify_track_id>...]
 * which accepts Spotify track IDs directly and returns the same field names
 * Spotify used to, except no `time_signature` — ReccoBeats just doesn't have
 * that field, so we default it to 4 (by far the most common value) rather
 * than treat its absence as a missing-data case like the other fields.
 * Tracks ReccoBeats doesn't have are silently omitted from the response
 * (not an error), matched back to our track IDs by parsing the Spotify
 * track ID out of each result's `href`.
 */

const API_BASE = "https://api.reccobeats.com/v1";
const BATCH_SIZE = 40;

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

interface ReccoBeatsAudioFeaturesItem {
  href: string;
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
}

const SPOTIFY_TRACK_ID_FROM_HREF = /\/track\/([A-Za-z0-9]+)/;

function toAudioFeatures(item: ReccoBeatsAudioFeaturesItem): AudioFeatures {
  return {
    danceability: item.danceability,
    energy: item.energy,
    key: item.key,
    loudness: item.loudness,
    mode: item.mode,
    speechiness: item.speechiness,
    acousticness: item.acousticness,
    instrumentalness: item.instrumentalness,
    liveness: item.liveness,
    valence: item.valence,
    tempo: item.tempo,
    time_signature: 4,
  };
}

async function fetchBatch(trackIds: string[]): Promise<ReccoBeatsAudioFeaturesItem[]> {
  const res = await fetch(`${API_BASE}/audio-features?ids=${trackIds.join(",")}`, {
    headers: { Accept: "application/json" },
  });
  if (res.status === 429) {
    // ReccoBeats rate-limits without a documented budget — a single retry
    // after a short pause is enough for this app's low request volume.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return fetchBatch(trackIds);
  }
  if (!res.ok) {
    throw new Error(`ReccoBeats audio-features request failed: ${res.status} ${await res.text()}`);
  }
  const body: { content: ReccoBeatsAudioFeaturesItem[] } = await res.json();
  return body.content;
}

/**
 * Fetches audio features for a batch of Spotify track IDs. Tracks ReccoBeats
 * doesn't have coverage for come back null — callers should degrade
 * gracefully rather than fail the whole track context on a miss.
 */
export async function getAudioFeatures(
  trackIds: string[]
): Promise<Record<string, AudioFeatures | null>> {
  const result: Record<string, AudioFeatures | null> = Object.fromEntries(
    trackIds.map((id) => [id, null])
  );
  if (trackIds.length === 0) return result;

  for (let i = 0; i < trackIds.length; i += BATCH_SIZE) {
    const batch = trackIds.slice(i, i + BATCH_SIZE);
    const items = await fetchBatch(batch);
    for (const item of items) {
      const trackId = item.href.match(SPOTIFY_TRACK_ID_FROM_HREF)?.[1];
      if (trackId && trackId in result) {
        result[trackId] = toAudioFeatures(item);
      }
    }
  }
  return result;
}
