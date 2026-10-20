import { NextRequest, NextResponse } from "next/server";
import { getTrackGenreDetails } from "@/lib/trackGenres";

// Stored genres for many tracks at once (POST so a whole library's worth of
// IDs fits). Only reads — generating goes through /api/track/[id]/summary.
// Each entry has subgenres (own, then broader) plus own and broader apart,
// which editing needs.
export async function POST(request: NextRequest) {
  const { ids } = await request.json();
  if (!Array.isArray(ids)) {
    return NextResponse.json({ error: "ids must be an array of track IDs" }, { status: 400 });
  }
  const details = await getTrackGenreDetails(ids.filter((id): id is string => typeof id === "string"));
  const genres = Object.fromEntries(
    Object.entries(details).map(([id, entry]) => [id, { ...entry, subgenres: [...entry.own, ...entry.broader] }])
  );
  return NextResponse.json({ genres });
}
