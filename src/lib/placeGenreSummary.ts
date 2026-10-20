import { sql } from "@/lib/db";
import { describeGenres } from "@/lib/trackGenres";
import { familyOf, type GenreFamily } from "@/lib/genreFamily";

export interface PlaceGenreSummary {
  // The most common genres among the playlist's songs, most common first.
  top: string[];
  // The genre family most of its tagged songs belong to.
  family: GenreFamily;
}

const TOP = 3;

/**
 * Each saved playlist's (and Liked Songs') most common genres, read from the
 * library database only, so it costs no Spotify requests. Playlists with no
 * tagged songs are left out.
 */
export async function getPlaceGenreSummaries(): Promise<Record<string, PlaceGenreSummary>> {
  const rows = sql(
    `SELECT pt.place_id, tag.genre, count(DISTINCT pt.track_uri) AS songs
     FROM place_tracks pt
     JOIN tracks t ON t.uri = pt.track_uri
     JOIN track_genre_tags tag ON tag.track_id = t.id
     GROUP BY pt.place_id, tag.genre`
  ).all() as { place_id: string; genre: string; songs: number }[];

  const byPlace = new Map<string, Map<string, number>>();
  for (const { place_id, genre, songs } of rows) {
    // Spelling variants count as one genre.
    const [shown] = (await describeGenres([genre])).own;
    if (!shown) continue;
    let counts = byPlace.get(place_id);
    if (!counts) byPlace.set(place_id, (counts = new Map()));
    counts.set(shown, (counts.get(shown) ?? 0) + songs);
  }

  const result: Record<string, PlaceGenreSummary> = {};
  for (const [placeId, counts] of byPlace) {
    const ranked = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const families = new Map<GenreFamily, number>();
    for (const [genre, songs] of ranked) {
      const family = familyOf(genre);
      if (family !== "none") families.set(family, (families.get(family) ?? 0) + songs);
    }
    const [family = "none"] = [...families].sort((a, b) => b[1] - a[1]).map(([f]) => f);
    result[placeId] = { top: ranked.slice(0, TOP).map(([genre]) => genre), family };
  }
  return result;
}
