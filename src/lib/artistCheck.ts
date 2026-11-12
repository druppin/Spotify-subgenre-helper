import { familyOf } from "./genreFamily.ts";

/*
 * Last.fm finds artists by name, so a song by "Rova" (drum and bass) can get
 * the tags of ROVA (a jazz saxophone quartet). These say how far the Last.fm
 * artist data was checked against the artist MusicBrainz credits on the
 * matched recording, and what was done about a mismatch.
 */
export type LastfmArtistCheck =
  // Last.fm's artist has the MusicBrainz id credited on the recording.
  | "confirmed"
  // Nothing to check against (no MusicBrainz match, or no id on Last.fm), and no clash.
  | "unconfirmed"
  // Last.fm's artist was someone else with the same name; their tags were left out.
  | "removed: different artist"
  // Tags that share no genre family with the song's other genre data; left out
  // (even with a matching id, since Last.fm merges same-named artists).
  | "removed: clashes with this song's genres";

/**
 * Whether an artist's tags look like they belong to a different artist: they
 * and the song's other genres each name at least one genre family, and none
 * in common. Tags that name no family ("british", "seen live") don't count.
 */
export function clashes(artistTags: string[], songGenres: string[]): boolean {
  const families = (genres: string[]) => new Set(genres.map((g) => familyOf(g)).filter((f) => f !== "none"));
  const artist = families(artistTags);
  const song = families(songGenres);
  return artist.size > 0 && song.size > 0 && ![...artist].some((f) => song.has(f));
}
