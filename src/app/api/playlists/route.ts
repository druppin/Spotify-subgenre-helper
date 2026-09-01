import { NextResponse } from "next/server";
import { getValidAccessToken } from "@/lib/spotify/auth";
import { SpotifyClient } from "@/lib/spotify/client";

export async function GET() {
  try {
    const accessToken = await getValidAccessToken();
    const client = new SpotifyClient(accessToken);
    const playlists = await client.getUserPlaylists();
    return NextResponse.json({ playlists });
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
}
