import { NextRequest, NextResponse } from "next/server";
import { getValidAccessToken, hasScope } from "@/lib/spotify/auth";
import { SpotifyClient } from "@/lib/spotify/client";
import { spotifyErrorResponse } from "@/lib/spotify/routeError";
import { recordLikedAdd, recordOwnEdit } from "@/lib/playlistIndex";
import { LIKED_SONGS_ID } from "@/lib/library";
import { getSession } from "@/lib/session";
import { ORGANIZE_SOURCES, recordOrganizeEvent, type OrganizeSource } from "@/lib/organizeLog";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json();
  const { trackUri, trackUris } = body;
  if (!trackUri && !(Array.isArray(trackUris) && trackUris.length > 0)) {
    return NextResponse.json({ error: "trackUri or trackUris is required" }, { status: 400 });
  }
  try {
    const accessToken = await getValidAccessToken();
    const client = new SpotifyClient(accessToken);
    const uris: string[] = trackUri ? [trackUri] : trackUris;
    // Liked Songs isn't a playlist: adding to it likes the songs.
    if (id === LIKED_SONGS_ID) {
      const session = await getSession();
      if (!hasScope(session.scope, "user-library-modify")) {
        return NextResponse.json(
          { error: "Spotify needs one more permission to add to Liked Songs.", needsReconnect: true },
          { status: 403 }
        );
      }
      await client.saveToLibrary(uris);
      await recordLikedAdd(uris);
    } else {
      const snapshotId = await client.addTracksToPlaylist(id, uris);
      await recordOwnEdit(id, { added: uris }, snapshotId);
    }
    await recordOrganizeEvent({ action: "add", playlistId: id, uris, source: sourceOf(body) });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return spotifyErrorResponse(err, "POST /api/playlists/[id]/add");
  }
}

function sourceOf(body: { source?: unknown }): OrganizeSource | undefined {
  return ORGANIZE_SOURCES.find((s) => s === body.source);
}
