import { NextResponse } from "next/server";
import { getOrganizeStats } from "@/lib/organizeLog";

// How many songs this app has filed into playlists. Read locally; never
// touches Spotify.
export async function GET() {
  return NextResponse.json(await getOrganizeStats());
}
