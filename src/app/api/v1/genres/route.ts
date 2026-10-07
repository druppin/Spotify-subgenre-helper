import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api/auth";
import { genreCounts } from "@/lib/api/tracks";

/**
 * GET /api/v1/genres — every genre with how many songs have it: `tagged`
 * counts songs tagged with it directly, `total` also counts songs tagged with
 * a narrower genre that belongs to it.
 */
export const GET = apiRoute(async () => NextResponse.json({ genres: await genreCounts() }));
