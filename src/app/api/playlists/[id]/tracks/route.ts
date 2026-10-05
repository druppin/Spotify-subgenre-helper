import { NextRequest, NextResponse } from "next/server";
import { getValidAccessToken } from "@/lib/spotify/auth";
import { SpotifyClient } from "@/lib/spotify/client";
import { spotifyErrorResponse } from "@/lib/spotify/routeError";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const accessToken = await getValidAccessToken();
    const client = new SpotifyClient(accessToken);
    const items = await client.getPlaylistTracks(id);
    return NextResponse.json({ items });
  } catch (err) {
    return spotifyErrorResponse(err, "GET /api/playlists/[id]/tracks");
  }
}

// Removes a track from this playlist (used by the source-playlist "also
// remove from source" toggle after a track has been filed elsewhere).
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { trackUri, trackUris } = await request.json();
  if (!trackUri && !(Array.isArray(trackUris) && trackUris.length > 0)) {
    return NextResponse.json({ error: "trackUri or trackUris is required" }, { status: 400 });
  }
  try {
    const accessToken = await getValidAccessToken();
    const client = new SpotifyClient(accessToken);
    if (trackUri) await client.removeTrackFromPlaylist(id, trackUri);
    else await client.removeTracksFromPlaylist(id, trackUris);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return spotifyErrorResponse(err, "DELETE /api/playlists/[id]/tracks");
  }
}
