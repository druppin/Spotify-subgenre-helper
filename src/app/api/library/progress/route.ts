import { NextResponse } from "next/server";
import { getScanProgress } from "@/lib/playlistIndex";

export interface ScanProgressResponse {
  playlists: ReturnType<typeof getScanProgress>["playlists"];
  liked: ReturnType<typeof getScanProgress>["liked"];
  // How much longer Spotify asked us to hold off, if at all.
  rateLimitWaitMs: number;
}

// Polled by the lost tracks view while /api/library is still scanning.
export async function GET() {
  const { playlists, liked, rateLimitedUntil } = getScanProgress();
  const body: ScanProgressResponse = {
    playlists,
    liked,
    rateLimitWaitMs: rateLimitedUntil ? Math.max(0, rateLimitedUntil - Date.now()) : 0,
  };
  return NextResponse.json(body);
}
