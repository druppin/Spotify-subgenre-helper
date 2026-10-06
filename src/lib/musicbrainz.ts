import { fetchWithTimeout } from "@/lib/fetchWithTimeout";
import { getCache } from "@/lib/cache";

const API_BASE = "https://musicbrainz.org/ws/2";
// MusicBrainz requires a descriptive User-Agent and allows ~1 request/sec.
const USER_AGENT = "SpotifySubgenreHelper/0.1 (local personal tool)";
const MIN_INTERVAL_MS = 1100;
const MIN_MATCH_SCORE = 80;
const MAX_ARTISTS = 2;

export interface GenreVote {
  name: string;
  votes: number;
}

export interface MusicBrainzInfo {
  // "Title — Artist, Artist" of the recording matched, or null if none was.
  matchedRecording: string | null;
  // Freeform community tags on the recording itself (mostly genres).
  recordingTags: GenreVote[];
  // Genres voted onto the album/single/EP the recording comes from.
  releaseGroupGenres: GenreVote[];
  artistGenres: { artist: string; genres: GenreVote[] }[];
}

const EMPTY: MusicBrainzInfo = {
  matchedRecording: null,
  recordingTags: [],
  releaseGroupGenres: [],
  artistGenres: [],
};

// Artist and album genre lookups, by request path. Many songs share an
// artist or album, and each lookup is a second of the shared MusicBrainz
// budget. Kept a month, since genre votes do change; `fresh` skips it.
const lookupCache = getCache<unknown>("musicbrainz-lookups");
const LOOKUP_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
// Lookups already on their way, so songs by the same artist running at
// the same time share one request.
const inFlight = new Map<string, Promise<unknown>>();

// Serializes every request in this process onto one ~1/sec schedule.
let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

const MAX_ATTEMPTS = 3;

// A 404 just means nothing's there; anything else that comes back empty
// (errors, timeouts, still rate-limited after retrying) goes to onFailure.
function get<T>(path: string, onFailure?: () => void): Promise<T | null> {
  const run = async (): Promise<T | null> => {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      // Back off further on each retry: 503 is MusicBrainz's rate-limit reply.
      const wait = lastRequestAt + MIN_INTERVAL_MS * attempt - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastRequestAt = Date.now();
      // Optional data, like Last.fm — any failure just means no MusicBrainz votes.
      try {
        const res = await fetchWithTimeout(
          `${API_BASE}${path}${path.includes("?") ? "&" : "?"}fmt=json`,
          { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } },
          10_000
        );
        if (res.ok) return (await res.json()) as T;
        if (res.status === 404) return null;
        if (res.status !== 503) break;
      } catch {
        break;
      }
    }
    onFailure?.();
    return null;
  };
  const result = queue.then(run);
  queue = result.catch(() => {});
  return result;
}

// get, for lookups worth sharing between songs. Only successful answers
// are kept; a failure is retried by the next song that asks.
function getShared<T>(path: string, onFailure: (() => void) | undefined, fresh: boolean): Promise<T | null> {
  const pending = inFlight.get(path);
  if (pending) return pending as Promise<T | null>;
  const lookup = (async () => {
    if (!fresh) {
      const cached = await lookupCache.get(path);
      if (cached !== undefined) return cached as T;
    }
    let failed = false;
    const result = await get<T>(path, () => {
      failed = true;
      onFailure?.();
    });
    if (result && !failed) await lookupCache.set(path, result, LOOKUP_MAX_AGE_MS);
    return result;
  })().finally(() => inFlight.delete(path));
  inFlight.set(path, lookup);
  return lookup;
}

function toVotes(items: { name: string; count: number }[] | undefined): GenreVote[] {
  return (items ?? [])
    .filter((g) => g.count > 0)
    .map((g) => ({ name: g.name, votes: g.count }))
    .sort((a, b) => b.votes - a.votes);
}

function luceneQuote(value: string): string {
  return `"${value.replace(/[\\"]/g, "\\$&")}"`;
}

const VERSION_SUFFIX = /\b(remix|mix|edit|version|dub|vip|rework|bootleg|flip)\b/i;

// Titles to search, most specific first. Spotify writes "Track - Soulwax
// Remix" where MusicBrainz has "Track (Soulwax remix)"; a phrase query on
// "Track Soulwax Remix" matches the latter since punctuation isn't indexed.
// Suffixes that name a different mix are kept (that's a different track);
// others like "- 2012 Remaster" are dropped.
function candidateTitles(trackName: string): string[] {
  const [head, ...rest] = trackName.split(" - ");
  const base = head.replace(/\s*[([](feat|ft|with)\.?[^)\]]*[)\]]/i, "").trim();
  const suffix = rest.join(" ").trim();
  return suffix && VERSION_SUFFIX.test(suffix) ? [`${base} ${suffix}`, base] : [base];
}

function mergeVotes(lists: GenreVote[][]): GenreVote[] {
  const totals = new Map<string, number>();
  for (const list of lists) {
    for (const v of list) totals.set(v.name, (totals.get(v.name) ?? 0) + v.votes);
  }
  return [...totals].map(([name, votes]) => ({ name, votes })).sort((a, b) => b.votes - a.votes);
}

interface SearchRecording {
  score: number;
  title: string;
  tags?: { name: string; count: number }[];
  "artist-credit"?: { name: string; artist: { id: string; name: string } }[];
  releases?: { "release-group"?: { id: string } }[];
}

/**
 * MusicBrainz genre votes for a song. Artist and album lookups come from a
 * month-long cache when they can; fresh pulls the latest from MusicBrainz.
 */
export async function getMusicBrainzInfo(
  artist: string,
  trackName: string,
  onFailure?: () => void,
  fresh = false
): Promise<MusicBrainzInfo> {
  if (!artist || !trackName) return EMPTY;

  let matches: SearchRecording[] = [];
  for (const title of candidateTitles(trackName)) {
    const query = `recording:${luceneQuote(title)} AND artist:${luceneQuote(artist)}`;
    const search = await get<{ recordings?: SearchRecording[] }>(
      `/recording?limit=10&query=${encodeURIComponent(query)}`,
      onFailure
    );
    matches = (search?.recordings ?? []).filter((r) => r.score >= MIN_MATCH_SCORE);
    if (matches.length > 0) break;
  }
  if (matches.length === 0) return EMPTY;

  // The same song is often entered as several recordings (single, album,
  // compilation...) with votes scattered across them — pool them.
  const recording = matches[0];
  // Duplicate entries don't always credit the same artists (a remixer may be
  // credited on only some), so collect from all of them.
  const credits = [
    ...new Map(matches.flatMap((m) => m["artist-credit"] ?? []).map((c) => [c.artist.id, c])).values(),
  ];
  const releaseGroupId = matches
    .flatMap((m) => m.releases ?? [])
    .find((r) => r["release-group"])?.["release-group"]?.id;

  const releaseGroup = releaseGroupId
    ? await getShared<{ genres?: { name: string; count: number }[] }>(
        `/release-group/${releaseGroupId}?inc=genres`,
        onFailure,
        fresh
      )
    : null;

  const artistGenres: MusicBrainzInfo["artistGenres"] = [];
  for (const credit of credits.slice(0, MAX_ARTISTS)) {
    const a = await getShared<{ genres?: { name: string; count: number }[] }>(
      `/artist/${credit.artist.id}?inc=genres`,
      onFailure,
      fresh
    );
    artistGenres.push({ artist: credit.artist.name, genres: toVotes(a?.genres) });
  }

  return {
    matchedRecording: `${recording.title} — ${credits.map((c) => c.name).join(", ")}`,
    recordingTags: mergeVotes(matches.map((m) => toVotes(m.tags))),
    releaseGroupGenres: toVotes(releaseGroup?.genres),
    artistGenres,
  };
}
