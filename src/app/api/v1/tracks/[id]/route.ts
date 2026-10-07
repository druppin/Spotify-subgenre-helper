import { NextResponse } from "next/server";
import { apiError, apiRoute } from "@/lib/api/auth";
import { findTrackById, toApiTracks } from "@/lib/api/tracks";

/** GET /api/v1/tracks/{Spotify track ID or URI} */
export const GET = apiRoute(async (_request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const track = findTrackById(decodeURIComponent(id));
  if (!track) return apiError(404, "No cached song with that ID.");
  const [result] = await toApiTracks([track]);
  return NextResponse.json({ track: result });
});
