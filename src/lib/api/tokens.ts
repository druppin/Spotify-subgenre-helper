import { randomBytes } from "crypto";
import { sql } from "@/lib/db";
import { hashToken } from "@/lib/api/auth";

/*
 * Making, listing and revoking /api/v1 keys from the app's Settings. Same
 * rules as scripts/api-token.mjs: a key is shown once, only its hash is kept.
 */

export interface ApiKeyInfo {
  id: number;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
}

export function listApiKeys(): ApiKeyInfo[] {
  const rows = sql("SELECT id, name, created_at, last_used_at FROM api_tokens ORDER BY id").all() as {
    id: number;
    name: string;
    created_at: number;
    last_used_at: number | null;
  }[];
  return rows.map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at, lastUsedAt: r.last_used_at }));
}

/** Makes a key and returns it; this is the only time it can be read. */
export function createApiKey(name: string): { id: number; token: string } {
  const token = `sgh_${randomBytes(24).toString("base64url")}`;
  const { lastInsertRowid } = sql("INSERT INTO api_tokens (name, token_hash, created_at) VALUES (?, ?, ?)").run(
    name,
    hashToken(token),
    Date.now()
  );
  return { id: Number(lastInsertRowid), token };
}

export function revokeApiKey(id: number): boolean {
  return sql("DELETE FROM api_tokens WHERE id = ?").run(id).changes > 0;
}
