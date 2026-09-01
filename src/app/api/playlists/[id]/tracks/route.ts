import { NextRequest, NextResponse } from "next/server";
import { getValidAccessToken } from "@/lib/spotify/auth";
import { SpotifyClient } from "@/lib/spotify/client";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const accessToken = await getValidAccessToken();
    const client = new SpotifyClient(accessToken);
    const items = await client.getPlaylistTracks(id);
    return NextResponse.json({ items });
  } catch (err) {
    console.error("GET /api/playlists/[id]/tracks failed:", err);
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
}

// Removes a track from this playlist (used by the source-playlist "also
// remove from source" toggle after a track has been filed elsewhere).
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { trackUri } = await request.json();
  if (!trackUri) {
    return NextResponse.json({ error: "trackUri is required" }, { status: 400 });
  }
  try {
    const accessToken = await getValidAccessToken();
    const client = new SpotifyClient(accessToken);
    await client.removeTrackFromPlaylist(id, trackUri);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/playlists/[id]/tracks failed:", err);
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
}
