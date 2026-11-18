import { NextResponse } from "next/server";
import { getCache } from "@/lib/cache";
import { getSession, loggedInHere } from "@/lib/session";
import { listProfiles, spotifyConfigured } from "@/lib/settings";

export async function GET() {
  // Which profile is in use, and the Spotify account its library belongs to.
  const profile = {
    profile: listProfiles().active,
    account: (await getCache<{ name: string }>("spotify-account").get("owner"))?.name ?? null,
  };
  // Until a Spotify app is entered in Settings there's nothing to log in with.
  if (!spotifyConfigured()) return NextResponse.json({ authenticated: false, configured: false, ...profile });
  const session = await getSession();
  return NextResponse.json({
    authenticated: loggedInHere(session),
    configured: true,
    ...profile,
  });
}
