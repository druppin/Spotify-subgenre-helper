import { NextResponse } from "next/server";
import { getValidAccessToken } from "@/lib/spotify/auth";
import { SpotifyClient } from "@/lib/spotify/client";
import { spotifyErrorResponse } from "@/lib/spotify/routeError";

// Saved albums, for picking as a sorter source.
export async function GET() {
  try {
    const accessToken = await getValidAccessToken();
    const albums = await new SpotifyClient(accessToken).getSavedAlbums();
    return NextResponse.json({ albums });
  } catch (err) {
    return spotifyErrorResponse(err, "GET /api/albums");
  }
}
