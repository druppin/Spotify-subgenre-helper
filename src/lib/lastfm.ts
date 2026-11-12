import { fetchWithTimeout } from "@/lib/fetchWithTimeout";
import { getSetting } from "@/lib/settings";

const API_BASE = "https://ws.audioscrobbler.com/2.0/";

export interface LastfmTrackInfo {
  tags: string[];
}

export interface LastfmArtistInfo {
  tags: string[];
  bioSummary: string | null;
}

function apiKey(): string | undefined {
  return getSetting("LASTFM_API_KEY");
}

// Last.fm's "not found" error: the artist or track just isn't there, as
// opposed to a failed lookup that's worth trying again later.
const NOT_FOUND = 6;

async function call<T>(params: Record<string, string>, onFailure?: () => void): Promise<T | null> {
  const key = apiKey();
  if (!key) return null;

  const url = new URL(API_BASE);
  url.search = new URLSearchParams({ ...params, api_key: key, format: "json" }).toString();
  // Last.fm data is optional and should degrade gracefully — a network
  // error or timeout here shouldn't take down the whole track-context
  // build any more than a non-OK HTTP response already doesn't. onFailure
  // hears about it so an empty answer from a failed lookup isn't cached.
  try {
    const res = await fetchWithTimeout(url, {}, 10_000);
    // Errors come back as JSON too, sometimes with a non-OK status.
    const body = await res.json().catch(() => null);
    if (body?.error === NOT_FOUND) return null;
    if (!res.ok || !body || body.error) {
      onFailure?.();
      return null;
    }
    return body;
  } catch {
    onFailure?.();
    return null;
  }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

export async function getTrackTags(artist: string, track: string, onFailure?: () => void): Promise<string[]> {
  const body = await call<{ toptags?: { tag?: { name: string }[] } }>(
    { method: "track.getTopTags", artist, track },
    onFailure
  );
  return body?.toptags?.tag?.map((t) => t.name) ?? [];
}

/**
 * An artist by name, with their MusicBrainz id when Last.fm knows it; null
 * when Last.fm doesn't have them (or the lookup failed).
 */
export async function getArtistInfo(
  artist: string,
  onFailure?: () => void
): Promise<(LastfmArtistInfo & { mbid: string | null }) | null> {
  const body = await call<{
    artist?: { mbid?: string; tags?: { tag?: { name: string }[] }; bio?: { summary?: string } };
  }>({ method: "artist.getInfo", artist }, onFailure);
  if (!body?.artist) return null;

  const tags = body.artist.tags?.tag?.map((t) => t.name) ?? [];
  const rawSummary = body.artist.bio?.summary;
  const bioSummary = rawSummary ? stripHtml(rawSummary) : null;
  return { tags, bioSummary, mbid: body.artist.mbid || null };
}
