import { findTracksByBaseTitle, findTracksByIsrc, getTrack } from "@/lib/libraryStore";
import { baseTitle, foldText, normalizeTitle } from "@/lib/songIdentity";
import type { LibraryTrack } from "@/lib/spotify/client";
import { describeGenres, getTrackGenreDetails, listTracksWithGenres } from "@/lib/trackGenres";

/*
 * What /api/v1 returns for songs, and how it finds the cached song that an
 * outside program means. Outside programs (DJ software, taggers) don't know
 * Spotify IDs, so songs can also be looked up by ISRC or artist + title.
 */

export interface ApiGenres {
  // The song's own genres, most specific first, in display spelling.
  tags: string[];
  // Broader genres those belong to ("doom metal" -> "metal").
  broader: string[];
  mood: string;
  // The AI model that chose them, and when (ISO 8601).
  model: string;
  updatedAt: string;
}

export interface ApiTrack {
  // Null for songs Spotify has no track ID for (local files, episodes).
  id: string | null;
  uri: string;
  isrc: string | null;
  title: string;
  artists: string[];
  // Null when unknown or not yet collected for this song.
  album: string | null;
  releaseDate: string | null;
  durationMs: number;
  // Null until genres are generated for the song in the app.
  genres: ApiGenres | null;
}

const TRACK_PREFIX = "spotify:track:";

function trackId(uri: string): string | null {
  return uri.startsWith(TRACK_PREFIX) ? uri.slice(TRACK_PREFIX.length) : null;
}

/** API shapes for `tracks`, in the same order, with their genres. */
export async function toApiTracks(tracks: LibraryTrack[]): Promise<ApiTrack[]> {
  const ids = tracks.map((t) => trackId(t.uri)).filter((id): id is string => id !== null);
  const stored = await getTrackGenreDetails([...new Set(ids)]);
  const genres = new Map<string, ApiGenres>();
  for (const [id, entry] of Object.entries(stored)) {
    genres.set(id, {
      tags: entry.own,
      broader: entry.broader,
      mood: entry.moodVibe,
      model: entry.model,
      updatedAt: new Date(entry.updatedAt).toISOString(),
    });
  }
  return tracks.map((t) => {
    const id = trackId(t.uri);
    return {
      id,
      uri: t.uri,
      isrc: t.isrc,
      title: t.name,
      artists: t.artists,
      album: t.album ?? null,
      releaseDate: t.releaseDate ?? null,
      durationMs: t.durationMs,
      genres: (id && genres.get(id)) || null,
    };
  });
}

/** A song by Spotify track ID or URI, or null if it isn't cached. */
export function findTrackById(idOrUri: string): LibraryTrack | null {
  return getTrack(idOrUri.startsWith("spotify:") ? idOrUri : `${TRACK_PREFIX}${idOrUri}`);
}

// ---------------------------------------------------------------------------
// Matching songs from other programs

export interface TrackQuery {
  isrc?: string;
  artist?: string;
  title?: string;
  // Lets the closest-length version of a song rank first.
  durationMs?: number;
}

// How a match was made:
// - "isrc": same recording code — the same recording.
// - "title": same artist and title, ignoring re-release tags like
//   "Remastered" or "Original Mix".
// - "other-version": same artist and song but another mix, edit or remix.
export type MatchKind = "isrc" | "title" | "other-version";

export interface TrackMatch {
  match: MatchKind;
  track: LibraryTrack;
}

// Separators between artist names in a single artist field.
const ARTIST_SEPARATOR = /\s*(?:,|;|\/|&|\s(?:and|x|vs\.?|feat\.?|ft\.?|featuring|with)\s)\s*/i;

function artistNames(artist: string): Set<string> {
  const names = [artist, ...artist.split(ARTIST_SEPARATOR)].map((name) => foldText(name).replace(/^the /, ""));
  return new Set(names.filter(Boolean));
}

function sharesArtist(queryNames: Set<string>, track: LibraryTrack): boolean {
  return track.artists.some((artist) => queryNames.has(foldText(artist).replace(/^the /, "")));
}

const MATCH_ORDER: MatchKind[] = ["isrc", "title", "other-version"];

/**
 * Cached songs matching `query`, best first. Tries the ISRC, then artist +
 * title; an artist, when given, must be one of the song's artists.
 */
export function matchTracks(query: TrackQuery): TrackMatch[] {
  const matches = new Map<string, TrackMatch>();
  if (query.isrc) {
    for (const track of findTracksByIsrc(query.isrc)) matches.set(track.uri, { match: "isrc", track });
  }
  if (query.title) {
    const wantedTitle = foldText(normalizeTitle(query.title));
    const queryArtists = query.artist ? artistNames(query.artist) : null;
    for (const track of findTracksByBaseTitle(baseTitle(query.title))) {
      if (matches.has(track.uri) || (queryArtists && !sharesArtist(queryArtists, track))) continue;
      const sameVersion = foldText(normalizeTitle(track.name)) === wantedTitle;
      matches.set(track.uri, { match: sameVersion ? "title" : "other-version", track });
    }
  }
  const lengthGap = (track: LibraryTrack) =>
    query.durationMs !== undefined ? Math.abs(track.durationMs - query.durationMs) : 0;
  return [...matches.values()].sort(
    (a, b) => MATCH_ORDER.indexOf(a.match) - MATCH_ORDER.indexOf(b.match) || lengthGap(a.track) - lengthGap(b.track)
  );
}

/** Matches for `query` as API tracks, each with how it matched. */
export async function toApiMatches(query: TrackQuery) {
  const matches = matchTracks(query);
  const tracks = await toApiTracks(matches.map((m) => m.track));
  return matches.map((m, i) => ({ match: m.match, ...tracks[i] }));
}

/** A TrackQuery from loosely typed input, or an error message. */
export function parseQuery(input: Record<string, unknown>): TrackQuery | string {
  const text = (key: string) => {
    const value = input[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  };
  const query: TrackQuery = { isrc: text("isrc"), artist: text("artist"), title: text("title") };
  const duration = input.durationMs;
  if (duration !== undefined && duration !== null && duration !== "") {
    const ms = Number(duration);
    if (!Number.isFinite(ms) || ms < 0) return "durationMs must be a number of milliseconds.";
    query.durationMs = ms;
  }
  return query;
}

// ---------------------------------------------------------------------------
// Browsing by genre

/** Every song with genres, as API tracks. */
export async function allTracksWithGenres(): Promise<ApiTrack[]> {
  const tracks = listTracksWithGenres()
    .map((id) => findTrackById(id))
    .filter((t): t is LibraryTrack => t !== null);
  return toApiTracks(tracks);
}

/** How many songs carry each genre, own tags and broader ones counted apart. */
export async function genreCounts(): Promise<{ genre: string; tagged: number; total: number }[]> {
  const counts = new Map<string, { tagged: number; total: number }>();
  const count = (genre: string, own: boolean) => {
    const entry = counts.get(genre) ?? { tagged: 0, total: 0 };
    entry.total++;
    if (own) entry.tagged++;
    counts.set(genre, entry);
  };
  for (const track of await allTracksWithGenres()) {
    track.genres!.tags.forEach((genre) => count(genre, true));
    track.genres!.broader.forEach((genre) => count(genre, false));
  }
  return [...counts]
    .map(([genre, c]) => ({ genre, ...c }))
    .sort((a, b) => b.total - a.total || a.genre.localeCompare(b.genre));
}

/** Songs tagged with `genre` or with a narrower genre belonging to it. */
export async function tracksInGenre(genre: string): Promise<ApiTrack[]> {
  // Brings the query to the same display spelling the songs use.
  const { own } = await describeGenres([genre]);
  const wanted = own[0];
  if (!wanted) return [];
  return (await allTracksWithGenres()).filter(
    (t) => t.genres!.tags.includes(wanted) || t.genres!.broader.includes(wanted)
  );
}
