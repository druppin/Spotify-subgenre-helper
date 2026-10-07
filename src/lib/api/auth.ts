import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

/*
 * Keys for the /api/v1 API, sent as `Authorization: Bearer <key>`. Keys are
 * made and revoked with scripts/api-token.mjs; only their hashes are stored.
 */

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Null when the request carries a valid key, otherwise the 401 to send. */
export function checkApiToken(request: Request): NextResponse | null {
  const header = request.headers.get("authorization") ?? "";
  const token = header.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) {
    return apiError(401, "Send an API key as 'Authorization: Bearer <key>'. Create one with: npm run api-token create <name>");
  }
  const row = sql("SELECT id FROM api_tokens WHERE token_hash = ?").get(hashToken(token)) as { id: number } | undefined;
  if (!row) return apiError(401, "Unknown or revoked API key.");
  sql("UPDATE api_tokens SET last_used_at = ? WHERE id = ?").run(Date.now(), row.id);
  return null;
}

export function apiError(status: number, message: string): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

type Handler<C> = (request: Request, context: C) => Promise<Response>;

/** Wraps a v1 route handler with key checking and JSON errors. */
export function apiRoute<C>(handler: Handler<C>): Handler<C> {
  return async (request, context) => {
    try {
      return checkApiToken(request) ?? (await handler(request, context));
    } catch (err) {
      console.error(`${request.method} ${new URL(request.url).pathname} failed:`, err);
      return apiError(500, "Internal error.");
    }
  };
}
