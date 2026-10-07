import { NextResponse } from "next/server";
import { apiError, apiRoute } from "@/lib/api/auth";
import { parseQuery, toApiMatches } from "@/lib/api/tracks";

const MAX_QUERIES = 1000;

/**
 * POST /api/v1/tracks/match  { "queries": [{ "isrc", "artist", "title", "durationMs" }, …] }
 * Looks up many songs at once (e.g. a whole DJ library). Results come back
 * in query order: { "results": [{ "matches": [...] }, …] }.
 */
export const POST = apiRoute(async (request) => {
  const body = await request.json().catch(() => null);
  const queries: unknown = body?.queries;
  if (!Array.isArray(queries)) return apiError(400, "Send { \"queries\": [...] }.");
  if (queries.length > MAX_QUERIES) return apiError(400, `At most ${MAX_QUERIES} queries per request.`);
  const results = [];
  for (const [i, raw] of queries.entries()) {
    const query = parseQuery(typeof raw === "object" && raw ? (raw as Record<string, unknown>) : {});
    if (typeof query === "string") return apiError(400, `queries[${i}]: ${query}`);
    if (!query.isrc && !query.title) return apiError(400, `queries[${i}]: needs an isrc or a title.`);
    results.push({ matches: await toApiMatches(query) });
  }
  return NextResponse.json({ results });
});
