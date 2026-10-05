import { NextRequest, NextResponse } from "next/server";
import { getValidAccessToken } from "@/lib/spotify/auth";
import { SpotifyClient, toPlaylistTrackItem } from "@/lib/spotify/client";
import { getPlaylistTracksCached, recordOwnEdit } from "@/lib/playlistIndex";
import { spotifyErrorResponse } from "@/lib/spotify/routeError";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const accessToken = await getValidAccessToken();
    // One request when the cached copy is current; a download (which then
    // counts toward the library scan) when it isn't.
    const tracks = await getPlaylistTracksCached(new SpotifyClient(accessToken), id);
    return NextResponse.json({ items: tracks.map(toPlaylistTrackItem) });
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
    const uris: string[] = trackUri ? [trackUri] : trackUris;
    const snapshotId = await client.removeTracksFromPlaylist(id, uris);
    await recordOwnEdit(id, { removed: uris }, snapshotId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return spotifyErrorResponse(err, "DELETE /api/playlists/[id]/tracks");
  }
}
