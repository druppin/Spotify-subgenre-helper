import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api/auth";
import { tracksInGenre } from "@/lib/api/tracks";

/**
 * GET /api/v1/genres/{genre}/tracks — songs with that genre, including songs
 * tagged with narrower genres that belong to it ("metal" finds "doom metal").
 */
export const GET = apiRoute(async (_request, { params }: { params: Promise<{ genre: string }> }) => {
  const { genre } = await params;
  return NextResponse.json({ tracks: await tracksInGenre(decodeURIComponent(genre)) });
});
