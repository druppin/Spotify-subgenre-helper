import { NextResponse } from "next/server";
import { getValidAccessToken } from "@/lib/spotify/auth";
import { spotifyErrorResponse } from "@/lib/spotify/routeError";

// Returns a valid access token for the Web Playback SDK to use client-side.
// The SDK needs the raw token in the browser; there's no way around that
// with Spotify's current playback API.
export async function GET() {
  try {
    const accessToken = await getValidAccessToken();
    return NextResponse.json({ accessToken });
  } catch (err) {
    return spotifyErrorResponse(err, "GET /api/spotify/token");
  }
}
