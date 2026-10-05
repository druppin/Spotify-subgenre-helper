import { NextRequest, NextResponse } from "next/server";
import { getValidAccessToken, hasScope } from "@/lib/spotify/auth";
import { SpotifyClient, type LibraryTrack } from "@/lib/spotify/client";
import { LIKED_SONGS_ID, type LibraryFetchMode, type LibraryResponse } from "@/lib/library";
import { spotifyErrorResponse } from "@/lib/spotify/routeError";
import { getLibrary, getLikedSongs } from "@/lib/playlistIndex";
import { getSession } from "@/lib/session";

const FETCH_MODES: LibraryFetchMode[] = ["none", "update", "complete"];

/**
 * Every cached track in the user's editable playlists and Liked Songs, plus
 * how current that cache is. ?fetch= picks how much to download first:
 * "none" (the default — just what's cached), "update" (changed and never-
 * scanned playlists), or "complete" (also fill in missing album details).
 * Track details are sent once per URI; each place lists [uri, addedAt].
 */
export async function GET(request: NextRequest) {
  const requested = new URL(request.url).searchParams.get("fetch") as LibraryFetchMode | null;
  const mode: LibraryFetchMode = requested && FETCH_MODES.includes(requested) ? requested : "none";
  try {
    const accessToken = await getValidAccessToken();
    const spotify = new SpotifyClient(accessToken);
    const session = await getSession();
    const canReadLiked = hasScope(session.scope, "user-library-read");

    // Playlists first, then Liked Songs: the two share one download queue.
    const library = await getLibrary(spotify, mode);
    const liked = canReadLiked ? await getLikedSongs(spotify, mode) : null;

    const tracks: LibraryResponse["tracks"] = {};
    const places: LibraryResponse["places"] = [];
    const addPlace = (id: string, placeTracks: LibraryTrack[]) => {
      for (const t of placeTracks) {
        tracks[t.uri] ??= { name: t.name, artists: t.artists, image: t.image, isrc: t.isrc, durationMs: t.durationMs };
      }
      places.push({ id, entries: placeTracks.map((t) => [t.uri, t.addedAt]) });
    };
    if (liked?.tracks) addPlace(LIKED_SONGS_ID, liked.tracks);
    for (const [id, placeTracks] of Object.entries(library.index)) addPlace(id, placeTracks);

    const body: LibraryResponse = {
      tracks,
      places,
      likedSongs: canReadLiked ? "ok" : "missing_scope",
      coverage: { playlists: library.coverage, likedSongs: liked?.status ?? "unreadable" },
    };
    return NextResponse.json(body);
  } catch (err) {
    return spotifyErrorResponse(err, "GET /api/library");
  }
}
