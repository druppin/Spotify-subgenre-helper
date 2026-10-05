import { NextRequest, NextResponse } from "next/server";
import { getTrackGenres } from "@/lib/trackGenres";

// Stored genres for many tracks at once (POST so a whole library's worth of
// IDs fits). Only reads — generating goes through /api/track/[id]/summary.
export async function POST(request: NextRequest) {
  const { ids } = await request.json();
  if (!Array.isArray(ids)) {
    return NextResponse.json({ error: "ids must be an array of track IDs" }, { status: 400 });
  }
  const genres = await getTrackGenres(ids.filter((id): id is string => typeof id === "string"));
  return NextResponse.json({ genres });
}
