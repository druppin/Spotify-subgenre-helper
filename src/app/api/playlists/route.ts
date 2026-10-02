import { NextRequest, NextResponse } from "next/server";
import { getValidAccessToken } from "@/lib/spotify/auth";
import { SpotifyClient } from "@/lib/spotify/client";
import { spotifyErrorResponse } from "@/lib/spotify/routeError";

export async function GET() {
  try {
    const accessToken = await getValidAccessToken();
    const client = new SpotifyClient(accessToken);
    const playlists = await client.getUserPlaylists();
    return NextResponse.json({ playlists });
  } catch (err) {
    return spotifyErrorResponse(err, "GET /api/playlists");
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  try {
    const accessToken = await getValidAccessToken();
    const client = new SpotifyClient(accessToken);
    const playlist = await client.createPlaylist({
      name,
      description: typeof body.description === "string" ? body.description.trim() : "",
      isPublic: Boolean(body.isPublic),
      collaborative: Boolean(body.collaborative),
    });
    return NextResponse.json({ playlist });
  } catch (err) {
    return spotifyErrorResponse(err, "POST /api/playlists");
  }
}
