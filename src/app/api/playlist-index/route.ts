import { NextRequest, NextResponse } from "next/server";
import { getValidAccessToken } from "@/lib/spotify/auth";
import { SpotifyClient } from "@/lib/spotify/client";
import { spotifyErrorResponse } from "@/lib/spotify/routeError";
import { getPlaylistIndex } from "@/lib/playlistIndex";

// Cached playlist membership. Only the playlists named in ?sync= (comma-
// separated) are re-downloaded if they've changed; everything else is
// returned as cached, so opening the sorter never sets off a library scan.
export async function GET(request: NextRequest) {
  const sync = new URL(request.url).searchParams.get("sync");
  const syncIds = sync ? sync.split(",").filter(Boolean) : [];
  try {
    const accessToken = await getValidAccessToken();
    const spotify = new SpotifyClient(accessToken);
    const index = syncIds.length
      ? await getPlaylistIndex(spotify, "update", syncIds)
      : await getPlaylistIndex(spotify, "none");
    return NextResponse.json({ index });
  } catch (err) {
    return spotifyErrorResponse(err, "GET /api/playlist-index");
  }
}
