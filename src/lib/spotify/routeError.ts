import { NextResponse } from "next/server";
import { SpotifyApiError } from "./client";

/**
 * Turns an error caught around getValidAccessToken()/SpotifyClient calls
 * into an appropriate response — a real Spotify API error (403 on a
 * Spotify-owned algorithmic playlist, 404, rate limiting, etc.) is not the
 * same thing as "you're not logged in," and collapsing them into a generic
 * 401 hides what actually went wrong.
 */
export function spotifyErrorResponse(err: unknown, label: string): NextResponse {
  console.error(`${label} failed:`, err);
  if (err instanceof SpotifyApiError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
}
