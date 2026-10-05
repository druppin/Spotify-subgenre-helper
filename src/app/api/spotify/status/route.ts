import { NextResponse } from "next/server";
import { getSpotifyBlockedUntil } from "@/lib/spotify/client";

// Whether Spotify currently has this app blocked. Answered locally — it
// never sends a request to Spotify.
export async function GET() {
  return NextResponse.json({ blockedUntil: await getSpotifyBlockedUntil() });
}
