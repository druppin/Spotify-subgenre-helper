import { NextResponse } from "next/server";
import { apiError, apiRoute } from "@/lib/api/auth";
import { toApiTracks } from "@/lib/api/tracks";
import { getPlaceSummary, getPlaceTracks } from "@/lib/libraryStore";

/**
 * GET /api/v1/playlists/{id}/tracks — a playlist's songs in order, as last
 * cached by the app (this never downloads from Spotify).
 */
export const GET = apiRoute(async (_request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const place = getPlaceSummary(id);
  if (!place) return apiError(404, "No cached playlist with that ID.");
  const entries = getPlaceTracks(id);
  const tracks = await toApiTracks(entries);
  return NextResponse.json({
    playlist: { ...place, fetchedAt: new Date(place.fetchedAt).toISOString() },
    tracks: tracks.map((track, position) => ({ position, addedAt: entries[position].addedAt, ...track })),
  });
});
