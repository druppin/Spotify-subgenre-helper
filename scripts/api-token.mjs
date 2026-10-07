#!/usr/bin/env node
// Creates, lists and revokes keys for the /api/v1 API.
//   npm run api-token create <name>
//   npm run api-token list
//   npm run api-token revoke <id>

import { createHash, randomBytes } from "crypto";
import { existsSync } from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = path.join(process.cwd(), ".cache", "library.db");
const [command, ...args] = process.argv.slice(2);

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!existsSync(DB_PATH)) fail("No library database yet. Start the app (npm run dev) once first.");
const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA busy_timeout = 5000");
const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'api_tokens'").get();
if (!hasTable) fail("The database predates API keys. Start the app (npm run dev) once, then try again.");

const when = (ms) => (ms ? new Date(ms).toLocaleString() : "never");

switch (command) {
  case "create": {
    const name = args.join(" ").trim();
    if (!name) fail("Usage: npm run api-token create <name>   (e.g. \"mixxx tagger\")");
    const token = `sgh_${randomBytes(24).toString("base64url")}`;
    const hash = createHash("sha256").update(token).digest("hex");
    const { lastInsertRowid } = db
      .prepare("INSERT INTO api_tokens (name, token_hash, created_at) VALUES (?, ?, ?)")
      .run(name, hash, Date.now());
    console.log(`Created key ${lastInsertRowid} ("${name}"). It's shown only this once:\n\n  ${token}\n`);
    console.log("Send it as: Authorization: Bearer <key>");
    break;
  }
  case "list": {
    const rows = db.prepare("SELECT id, name, created_at, last_used_at FROM api_tokens ORDER BY id").all();
    if (rows.length === 0) console.log("No API keys. Create one with: npm run api-token create <name>");
    for (const row of rows) {
      console.log(`${row.id}  ${row.name}  (created ${when(row.created_at)}, last used ${when(row.last_used_at)})`);
    }
    break;
  }
  case "revoke": {
    const id = Number(args[0]);
    if (!Number.isInteger(id)) fail("Usage: npm run api-token revoke <id>   (ids are shown by: npm run api-token list)");
    const { changes } = db.prepare("DELETE FROM api_tokens WHERE id = ?").run(id);
    if (!changes) fail(`No key with id ${id}.`);
    console.log(`Revoked key ${id}.`);
    break;
  }
  default:
    fail("Usage: npm run api-token create <name> | list | revoke <id>");
}
