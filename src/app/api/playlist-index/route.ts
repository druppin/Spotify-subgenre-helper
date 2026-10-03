import { NextResponse } from "next/server";
import { getValidAccessToken } from "@/lib/spotify/auth";
import { SpotifyClient } from "@/lib/spotify/client";
import { spotifyErrorResponse } from "@/lib/spotify/routeError";
import { getPlaylistIndex } from "@/lib/playlistIndex";

export async function GET() {
  try {
    const accessToken = await getValidAccessToken();
    const index = await getPlaylistIndex(new SpotifyClient(accessToken));
    return NextResponse.json({ index });
  } catch (err) {
    return spotifyErrorResponse(err, "GET /api/playlist-index");
  }
}
