#!/usr/bin/env node
// Adds the dev library (.cache/, what npm run dev uses) to the desktop app's
// data folder, keeping the two separate afterwards. Anything the desktop
// folder already has wins; dev only fills in the rest.
//   npm run merge-dev-data               into the npm run desktop folder
//   npm run merge-dev-data -- --installed  into the installed app's folder
//   npm run merge-dev-data -- <from> <to>  between any two data folders
//
// Songs and genres are added when the desktop copy doesn't have them. A
// playlist the desktop app has already scanned keeps its own track list, so
// two snapshots never mix. Organize history is copied only if the desktop
// app hasn't logged any yet. The desktop folder is backed up first.

import { DatabaseSync } from "node:sqlite";
import { cpSync, copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

function fail(message) {
  console.error(message);
  process.exit(1);
}

// Electron's userData folder: named after package.json's name when run from
// a checkout, and after productName (electron-builder.yml) when installed.
function desktopDataDir(installed) {
  const name = installed ? "Spotify Subgenre Assistant" : "spotify-subgenre-helper";
  const base =
    process.platform === "win32"
      ? process.env.APPDATA
      : process.platform === "darwin"
        ? path.join(os.homedir(), "Library", "Application Support")
        : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(base, name, "data");
}

const args = process.argv.slice(2);
const installed = args.includes("--installed");
const paths = args.filter((a) => !a.startsWith("--"));
const devDir = paths[0] ?? path.join(process.cwd(), ".cache");
const deskDir = paths[1] ?? desktopDataDir(installed);

for (const dir of [devDir, deskDir]) {
  if (!existsSync(path.join(dir, "library.db"))) {
    fail(`No library in ${dir}. The desktop app makes one the first time it opens.`);
  }
}

// The app keeps caches in memory and rewrites their files whole, so it
// would undo the merge if it were running.
const portBusy = await new Promise((resolve) => {
  const probe = net.createServer();
  probe.once("error", () => resolve(true));
  probe.once("listening", () => probe.close(() => resolve(false)));
  probe.listen(3000, "127.0.0.1");
});
if (portBusy) fail("Something is using port 3000. Close the desktop app and npm run dev, then try again.");

const backup = `${deskDir}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
cpSync(deskDir, backup, { recursive: true });
console.log(`Backed up ${deskDir}\n       to ${backup}\n`);

const db = new DatabaseSync(path.join(deskDir, "library.db"));
db.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
db.prepare("ATTACH DATABASE ? AS dev").run(path.join(devDir, "library.db"));

const count = (schema, table) => db.prepare(`SELECT count(*) n FROM ${schema}.${table}`).get().n;
const tables = ["tracks", "places", "place_tracks", "track_genres", "track_genre_tags"];
const before = Object.fromEntries(tables.map((t) => [t, count("main", t)]));

// Stored columns only; tracks.id is generated.
const cols = (table) =>
  db
    .prepare(`PRAGMA main.table_xinfo(${table})`)
    .all()
    .filter((c) => c.hidden === 0)
    .map((c) => c.name)
    .join(", ");
const copyRows = (table, where) =>
  db.exec(`INSERT INTO main.${table} (${cols(table)}) SELECT ${cols(table)} FROM dev.${table} WHERE ${where}`);

db.exec("BEGIN");
try {
  // Decided up front, before inserts make dev's rows look already present.
  db.exec("CREATE TEMP TABLE new_places AS SELECT id FROM dev.places WHERE id NOT IN (SELECT id FROM main.places)");
  db.exec(
    "CREATE TEMP TABLE new_genres AS SELECT track_id FROM dev.track_genres WHERE track_id NOT IN (SELECT track_id FROM main.track_genres)"
  );
  db.exec(`INSERT OR IGNORE INTO main.tracks (${cols("tracks")}) SELECT ${cols("tracks")} FROM dev.tracks`);
  copyRows("places", "id IN (SELECT id FROM new_places)");
  copyRows("place_tracks", "place_id IN (SELECT id FROM new_places)");
  copyRows("track_genres", "track_id IN (SELECT track_id FROM new_genres)");
  copyRows("track_genre_tags", "track_id IN (SELECT track_id FROM new_genres)");
  db.exec("INSERT OR IGNORE INTO main.done_once (key) SELECT key FROM dev.done_once");
  db.exec("COMMIT");
} catch (err) {
  db.exec("ROLLBACK");
  throw err;
}
const after = Object.fromEntries(tables.map((t) => [t, count("main", t)]));
const fkProblems = db.prepare("PRAGMA main.foreign_key_check").all().length;
db.exec("DETACH DATABASE dev");
db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
db.close();

const labels = {
  tracks: "songs",
  places: "playlists",
  place_tracks: "playlist entries",
  track_genres: "songs with genres",
  track_genre_tags: "genre tags",
};
for (const t of tables) console.log(`${labels[t]}: ${before[t]} -> ${after[t]}`);
if (fkProblems) console.warn(`Warning: ${fkProblems} rows point at missing songs or playlists.`);

// The JSON caches still in use (see getCache calls in src/lib).
for (const ns of ["track-context-v4", "musicbrainz-lookups", "track-summary"]) {
  const read = (dir) => {
    const file = path.join(dir, `${ns}.json`);
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf-8")) : {};
  };
  const desk = read(deskDir);
  const merged = { ...read(devDir), ...desk };
  writeFileSync(path.join(deskDir, `${ns}.json`), JSON.stringify(merged));
  console.log(`${ns}: ${Object.keys(desk).length} -> ${Object.keys(merged).length} entries`);
}

// Two logs can't be combined into one meaningful baseline, so dev's history
// only moves over when the desktop app has none of its own.
if (!existsSync(path.join(deskDir, "organize-log.jsonl")) && existsSync(path.join(devDir, "organize-log.jsonl"))) {
  for (const f of ["organize-log.jsonl", "organize-baseline.json"]) {
    if (existsSync(path.join(devDir, f))) copyFileSync(path.join(devDir, f), path.join(deskDir, f));
  }
  console.log("organize history: copied from dev");
} else {
  console.log("organize history: left as is");
}
