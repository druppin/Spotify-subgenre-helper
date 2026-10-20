import { NextRequest, NextResponse } from "next/server";
import { getValidAccessToken, hasScope } from "@/lib/spotify/auth";
import { SpotifyClient } from "@/lib/spotify/client";
import { spotifyErrorResponse } from "@/lib/spotify/routeError";
import { LIKED_SONGS_ID } from "@/lib/library";
import { getSession } from "@/lib/session";
import { keepVersion, previewKeepVersion } from "@/lib/versions";

/**
 * Body: { keep, others, preview? }. Puts the `keep` version in place of
 * `others` in every playlist (and Liked Songs) they're in, and returns the
 * changes for undoing. With preview, only says what would change.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { keep?: unknown; others?: unknown; preview?: unknown };
  const { keep, others } = body;
  if (typeof keep !== "string" || !Array.isArray(others) || others.some((u) => typeof u !== "string")) {
    return NextResponse.json({ error: "keep must be a track URI and others an array of them" }, { status: 400 });
  }
  const changes = previewKeepVersion(keep, others as string[]);
  if (body.preview) return NextResponse.json({ changes });
  try {
    const accessToken = await getValidAccessToken();
    if (changes.some((c) => c.placeId === LIKED_SONGS_ID)) {
      const session = await getSession();
      if (!hasScope(session.scope, "user-library-modify")) {
        return NextResponse.json(
          { error: "Spotify needs one more permission to change Liked Songs.", needsReconnect: true },
          { status: 403 }
        );
      }
    }
    return NextResponse.json({ changes: await keepVersion(new SpotifyClient(accessToken), keep, others as string[]) });
  } catch (err) {
    return spotifyErrorResponse(err, "POST /api/versions/keep");
  }
}
