const API_BASE = "https://ws.audioscrobbler.com/2.0/";

export interface LastfmTrackInfo {
  tags: string[];
}

export interface LastfmArtistInfo {
  tags: string[];
  bioSummary: string | null;
}

function apiKey(): string | undefined {
  return process.env.LASTFM_API_KEY;
}

async function call<T>(params: Record<string, string>): Promise<T | null> {
  const key = apiKey();
  if (!key) return null;

  const url = new URL(API_BASE);
  url.search = new URLSearchParams({ ...params, api_key: key, format: "json" }).toString();
  const res = await fetch(url);
  if (!res.ok) return null;
  const body = await res.json();
  if (body.error) return null;
  return body;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

export async function getTrackTags(artist: string, track: string): Promise<string[]> {
  const body = await call<{ toptags?: { tag?: { name: string }[] } }>({
    method: "track.getTopTags",
    artist,
    track,
  });
  return body?.toptags?.tag?.map((t) => t.name) ?? [];
}

export async function getArtistInfo(artist: string): Promise<LastfmArtistInfo> {
  const body = await call<{
    artist?: { tags?: { tag?: { name: string }[] }; bio?: { summary?: string } };
  }>({ method: "artist.getInfo", artist });

  const tags = body?.artist?.tags?.tag?.map((t) => t.name) ?? [];
  const rawSummary = body?.artist?.bio?.summary;
  const bioSummary = rawSummary ? stripHtml(rawSummary) : null;
  return { tags, bioSummary };
}
