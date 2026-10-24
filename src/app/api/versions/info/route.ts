import { NextRequest, NextResponse } from "next/server";
import { getValidAccessToken } from "@/lib/spotify/auth";
import { SpotifyClient } from "@/lib/spotify/client";
import { spotifyErrorResponse } from "@/lib/spotify/routeError";
import { getReleaseInfo } from "@/lib/releaseInfo";
import { getTrackDetailsCached } from "@/lib/playlistIndex";

// A song's versions are a handful; this keeps one request from turning
// into minutes of MusicBrainz lookups.
const MAX_URIS = 12;

/** Body: { uris }. When each came out and on what kind of release (see releaseInfo.ts). */
export async function POST(request: NextRequest) {
  const { uris } = (await request.json().catch(() => ({}))) as { uris?: unknown };
  if (!Array.isArray(uris) || uris.some((u) => typeof u !== "string")) {
    return NextResponse.json({ error: "uris must be an array of track URIs" }, { status: 400 });
  }
  try {
    const spotify = new SpotifyClient(await getValidAccessToken());
    const wanted = (uris as string[]).slice(0, MAX_URIS);
    // A song the library hasn't seen (the sorter's listen mode) is looked up
    // once so it has a row; free for songs it already knows.
    for (const uri of wanted) {
      if (!uri.startsWith("spotify:track:")) continue;
      await getTrackDetailsCached(spotify, uri.slice("spotify:track:".length)).catch((err) =>
        console.error(`Couldn't look up ${uri}:`, err)
      );
    }
    return NextResponse.json({ info: await getReleaseInfo(spotify, wanted) });
  } catch (err) {
    return spotifyErrorResponse(err, "POST /api/versions/info");
  }
}
