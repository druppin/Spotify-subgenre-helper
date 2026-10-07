import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api/auth";
import { listPlaces } from "@/lib/libraryStore";

/**
 * GET /api/v1/playlists — every cached playlist, and Liked Songs (id
 * "liked"). Names fill in once the app has listed your playlists.
 */
export const GET = apiRoute(async () => {
  const playlists = listPlaces().map((place) => ({
    ...place,
    fetchedAt: new Date(place.fetchedAt).toISOString(),
  }));
  return NextResponse.json({ playlists });
});
