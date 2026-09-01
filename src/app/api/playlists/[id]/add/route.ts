import { NextRequest, NextResponse } from "next/server";
import { getValidAccessToken } from "@/lib/spotify/auth";
import { SpotifyClient } from "@/lib/spotify/client";
import { spotifyErrorResponse } from "@/lib/spotify/routeError";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { trackUri } = await request.json();
  if (!trackUri) {
    return NextResponse.json({ error: "trackUri is required" }, { status: 400 });
  }
  try {
    const accessToken = await getValidAccessToken();
    const client = new SpotifyClient(accessToken);
    await client.addTrackToPlaylist(id, trackUri);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return spotifyErrorResponse(err, "POST /api/playlists/[id]/add");
  }
}
