import { NextRequest, NextResponse } from "next/server";
import { getValidAccessToken } from "@/lib/spotify/auth";
import { SpotifyClient } from "@/lib/spotify/client";
import { spotifyErrorResponse } from "@/lib/spotify/routeError";
import { undoKeepVersion, type VersionChange } from "@/lib/versions";

/** Body: { keep, changes }, as /api/versions/keep returned them. Puts the old versions back. */
export async function POST(request: NextRequest) {
  const { keep, changes } = (await request.json().catch(() => ({}))) as { keep?: unknown; changes?: unknown };
  if (typeof keep !== "string" || !Array.isArray(changes)) {
    return NextResponse.json({ error: "keep and changes are required" }, { status: 400 });
  }
  try {
    await undoKeepVersion(new SpotifyClient(await getValidAccessToken()), keep, changes as VersionChange[]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return spotifyErrorResponse(err, "POST /api/versions/undo");
  }
}
