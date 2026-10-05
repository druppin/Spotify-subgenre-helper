import { NextResponse } from "next/server";
import { getValidAccessToken, hasScope } from "@/lib/spotify/auth";
import { SpotifyClient, type LibraryTrack } from "@/lib/spotify/client";
import { LIKED_SONGS_ID, type LibraryResponse } from "@/lib/library";
import { spotifyErrorResponse } from "@/lib/spotify/routeError";
import { getLibraryIndex, getLikedSongs } from "@/lib/playlistIndex";
import { getSession } from "@/lib/session";

/**
 * Every track in the user's editable playlists and Liked Songs. Track details
 * are sent once per URI; each place lists its entries as [uri, addedAt].
 */
export async function GET() {
  try {
    const accessToken = await getValidAccessToken();
    const spotify = new SpotifyClient(accessToken);
    const session = await getSession();
    const canReadLiked = hasScope(session.scope, "user-library-read");

    const [library, liked] = await Promise.all([
      getLibraryIndex(spotify),
      canReadLiked ? getLikedSongs(spotify) : null,
    ]);

    const tracks: LibraryResponse["tracks"] = {};
    const places: LibraryResponse["places"] = [];
    const addPlace = (id: string, placeTracks: LibraryTrack[]) => {
      for (const t of placeTracks) {
        tracks[t.uri] ??= { name: t.name, artists: t.artists, image: t.image, isrc: t.isrc, durationMs: t.durationMs };
      }
      places.push({ id, entries: placeTracks.map((t) => [t.uri, t.addedAt]) });
    };
    if (liked) addPlace(LIKED_SONGS_ID, liked);
    for (const [id, placeTracks] of Object.entries(library)) addPlace(id, placeTracks);

    const body: LibraryResponse = { tracks, places, likedSongs: canReadLiked ? "ok" : "missing_scope" };
    return NextResponse.json(body);
  } catch (err) {
    return spotifyErrorResponse(err, "GET /api/library");
  }
}
