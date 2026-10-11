import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { spotifyConfigured } from "@/lib/settings";

export async function GET() {
  // Until a Spotify app is entered in Settings there's nothing to log in with.
  if (!spotifyConfigured()) return NextResponse.json({ authenticated: false, configured: false });
  const session = await getSession();
  return NextResponse.json({ authenticated: Boolean(session.accessToken && session.refreshToken), configured: true });
}
