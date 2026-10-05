import { NextRequest, NextResponse } from "next/server";
import { getValidAccessToken } from "@/lib/spotify/auth";
import { SpotifyClient } from "@/lib/spotify/client";
import { spotifyErrorResponse } from "@/lib/spotify/routeError";
import { getTrackGenres } from "@/lib/trackGenres";
import { getPlaylistTracksCached } from "@/lib/playlistIndex";
import type { PlaylistGenreTrack } from "@/lib/playlistGenres";

// Only reads stored genres — never generates. Generation goes through the
// per-track summary route so it's always an explicit, user-triggered cost.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const accessToken = await getValidAccessToken();
    const cached = await getPlaylistTracksCached(new SpotifyClient(accessToken), id);
    // Episodes and local files have no Spotify track id to key genres by.
    const tracks = cached
      .filter((t) => t.uri.startsWith("spotify:track:"))
      .map((t) => ({ ...t, id: t.uri.slice("spotify:track:".length) }));
    const genres = await getTrackGenres([...new Set(tracks.map((t) => t.id))]);
    const result: PlaylistGenreTrack[] = tracks.map((t) => ({
      id: t.id,
      name: t.name,
      artists: t.artists,
      subgenres: genres[t.id]?.subgenres ?? null,
    }));
    return NextResponse.json({ tracks: result });
  } catch (err) {
    return spotifyErrorResponse(err, "GET /api/playlists/[id]/genres");
  }
}
