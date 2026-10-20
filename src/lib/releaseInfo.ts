import { sql } from "@/lib/db";
import { getOriginalReleaseDate } from "@/lib/musicbrainz";
import type { SpotifyClient } from "@/lib/spotify/client";

/*
 * When each song came out, for comparing versions of a song: its original
 * release date (from MusicBrainz, so a remaster gets the date the song first
 * came out and a remix the remix's own) next to the date and kind of the
 * Spotify release the copy is on. Looked up once per song and kept on its
 * tracks row.
 */

export type AlbumType = "album" | "single" | "compilation";

export interface ReleaseInfo {
  album: string | null;
  // The release's largest cover, when known.
  image: string | null;
  // The Spotify release this copy is on.
  albumDate: string | null;
  albumType: AlbumType | null;
  // When the song first came out; null when MusicBrainz doesn't know.
  originalDate: string | null;
}

interface Row {
  uri: string;
  name: string;
  artists: string;
  isrc: string | null;
  duration_ms: number;
  album: string | null;
  image_large: string | null;
  release_date: string | null;
  album_type: string | null;
  original_release_date: string | null;
  original_release_checked_at: number | null;
}

const ALBUM_TYPES: AlbumType[] = ["album", "single", "compilation"];

function readRows(uris: string[]): Map<string, Row> {
  const rows = new Map<string, Row>();
  for (const uri of uris) {
    const row = sql(
      `SELECT uri, name, artists, isrc, duration_ms, album, image_large, release_date, album_type,
              original_release_date, original_release_checked_at
       FROM tracks WHERE uri = ?`
    ).get(uri) as Row | undefined;
    if (row) rows.set(uri, row);
  }
  return rows;
}

function toInfo(row: Row): ReleaseInfo {
  return {
    album: row.album,
    image: row.image_large,
    albumDate: row.release_date || null,
    albumType: ALBUM_TYPES.find((t) => t === row.album_type) ?? null,
    originalDate: row.original_release_date ?? (row.original_release_checked_at ? row.release_date || null : null),
  };
}

/**
 * Release info for these songs, looking up what isn't known yet: the
 * release kind from Spotify, the original date from MusicBrainz (about a
 * second per song). Songs the library doesn't have are left out.
 */
export async function getReleaseInfo(spotify: SpotifyClient, uris: string[]): Promise<Record<string, ReleaseInfo>> {
  const rows = readRows(uris);
  for (const row of rows.values()) {
    if (!row.album_type && row.uri.startsWith("spotify:track:")) {
      // Nice to have: without it the release kind just shows as unknown.
      const albumType = await spotify.getAlbumType(row.uri.slice("spotify:track:".length)).catch((err) => {
        console.error(`Couldn't get the release kind of ${row.uri}:`, err);
        return null;
      });
      if (albumType) {
        sql("UPDATE tracks SET album_type = ? WHERE uri = ?").run(albumType, row.uri);
        row.album_type = albumType;
      }
    }
    if (row.original_release_checked_at === null) {
      const artists = JSON.parse(row.artists) as string[];
      const { date, failed } = await getOriginalReleaseDate({
        isrc: row.isrc,
        artist: artists[0] ?? "",
        title: row.name,
        durationMs: row.duration_ms,
      });
      // A failed lookup is tried again next time; a finished one, found or
      // not, isn't.
      if (!failed || date) {
        const checkedAt = Date.now();
        sql("UPDATE tracks SET original_release_date = ?, original_release_checked_at = ? WHERE uri = ?").run(
          date,
          checkedAt,
          row.uri
        );
        row.original_release_date = date;
        row.original_release_checked_at = checkedAt;
      }
    }
  }
  return Object.fromEntries([...rows].map(([uri, row]) => [uri, toInfo(row)]));
}

/** Original release dates already looked up, without looking any up. */
export function knownOriginalReleaseDates(uris: string[]): Map<string, string> {
  const dates = new Map<string, string>();
  for (const [uri, row] of readRows(uris)) {
    const date = toInfo(row).originalDate;
    if (date && row.original_release_checked_at !== null) dates.set(uri, date);
  }
  return dates;
}
