import { NextResponse } from "next/server";
import { apiError, apiRoute } from "@/lib/api/auth";
import { allTracksWithGenres, parseQuery, toApiMatches } from "@/lib/api/tracks";

/**
 * GET /api/v1/tracks?isrc=…            songs with that ISRC
 * GET /api/v1/tracks?artist=…&title=…  songs matching by name (artist optional;
 *                                      &durationMs=… ranks the closest length first)
 * GET /api/v1/tracks                   every song that has genres
 */
export const GET = apiRoute(async (request) => {
  const params = new URL(request.url).searchParams;
  const query = parseQuery({
    isrc: params.get("isrc"),
    artist: params.get("artist"),
    title: params.get("title"),
    durationMs: params.get("durationMs"),
  });
  if (typeof query === "string") return apiError(400, query);
  if (!query.isrc && !query.title) {
    if (query.artist) return apiError(400, "artist needs a title to go with it.");
    return NextResponse.json({ tracks: await allTracksWithGenres() });
  }
  return NextResponse.json({ matches: await toApiMatches(query) });
});
