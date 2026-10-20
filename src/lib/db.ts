import { mkdirSync } from "fs";
import path from "path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { DATA_DIR } from "@/lib/dataDir";

/*
 * The library database: library.db in the data folder (.cache/ unless
 * SGH_DATA_DIR says otherwise — see dataDir.ts), a SQLite file that can also be
 * opened directly (`sqlite3 .cache/library.db`) to look things up, e.g.
 *
 *   -- every song in a playlist, in order
 *   SELECT position, name, artists FROM place_songs WHERE place_name = 'Doom';
 *   -- a song's genre tags
 *   SELECT genre FROM song_genres WHERE name = 'Stinkfist';
 *   -- which playlists a song is in
 *   SELECT place_name FROM place_songs WHERE name = 'Stinkfist';
 *
 * Genre tags are stored as the AI gave them (normalized, not yet merged
 * into display spellings or given parent genres — see trackGenres.ts).
 */

const DB_PATH = path.join(DATA_DIR, "library.db");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tracks (
  uri TEXT PRIMARY KEY,
  -- The bare Spotify ID (uri minus 'spotify:track:'), which genres are keyed by.
  id TEXT GENERATED ALWAYS AS (substr(uri, 15)) STORED,
  name TEXT NOT NULL,
  -- JSON array of artist names
  artists TEXT NOT NULL,
  image TEXT,
  image_large TEXT,
  isrc TEXT,
  duration_ms INTEGER NOT NULL,
  album TEXT,
  release_date TEXT,
  -- 0 when cached before album details were collected
  complete INTEGER NOT NULL,
  -- Title without any version or credit (see baseTitle), for lookups by name.
  base_title TEXT
);
CREATE INDEX IF NOT EXISTS tracks_id ON tracks(id);
CREATE INDEX IF NOT EXISTS tracks_isrc ON tracks(isrc);

-- Playlists and Liked Songs (id 'liked'), as of their last download.
CREATE TABLE IF NOT EXISTS places (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('playlist', 'liked')),
  name TEXT,
  -- Playlists: Spotify's snapshot_id. Liked Songs: its change marker.
  snapshot_id TEXT,
  -- Cache format the songs were downloaded with (see playlistIndex.ts).
  version INTEGER NOT NULL,
  fetched_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS place_tracks (
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  track_uri TEXT NOT NULL REFERENCES tracks(uri),
  added_at TEXT NOT NULL,
  PRIMARY KEY (place_id, position)
);
CREATE INDEX IF NOT EXISTS place_tracks_uri ON place_tracks(track_uri);

CREATE TABLE IF NOT EXISTS track_genres (
  track_id TEXT PRIMARY KEY,
  mood_vibe TEXT NOT NULL,
  model TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  -- 1 once the user has changed the tags; the AI then leaves them alone
  -- unless asked to regenerate.
  edited INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS track_genre_tags (
  track_id TEXT NOT NULL REFERENCES track_genres(track_id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  genre TEXT NOT NULL,
  -- How sure the AI is of the tag, 0-100. Null until it's been scored, and
  -- for tags the user added.
  confidence INTEGER,
  -- 1 for a tag the user added; the AI doesn't score these.
  by_user INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (track_id, position)
);
CREATE INDEX IF NOT EXISTS track_genre_tags_genre ON track_genre_tags(genre);

-- Follow-up questions about a song and the AI's answers.
CREATE TABLE IF NOT EXISTS track_chat_messages (
  id INTEGER PRIMARY KEY,
  track_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  -- JSON {tags: [{genre, confidence}]} when the AI proposed new tags in
  -- this answer, and whether the user applied them.
  suggestion TEXT,
  applied INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS track_chat_messages_track ON track_chat_messages(track_id, id);

-- Flows: playlists (and Liked Songs) wired into one target playlist, which
-- running the flow tops up with their songs (see flows.ts).
CREATE TABLE IF NOT EXISTS flows (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  -- The playlist songs are added to; null until one is picked.
  target_id TEXT,
  created_at INTEGER NOT NULL,
  last_run_at INTEGER,
  last_run_added INTEGER
);

-- One wire per source: which place feeds the flow, and its filters. With
-- no filters set, every song passes.
CREATE TABLE IF NOT EXISTS flow_sources (
  flow_id INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  -- JSON arrays: genre families and exact genres a song must have one of.
  families TEXT NOT NULL DEFAULT '[]',
  genres TEXT NOT NULL DEFAULT '[]',
  -- Minimum average tag confidence (0-100), or null for none.
  min_confidence INTEGER,
  -- Whether songs with no tags pass when filters are set.
  include_untagged INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (flow_id, source_id)
);

-- One-time imports already done (see once).
CREATE TABLE IF NOT EXISTS done_once (key TEXT PRIMARY KEY);

-- Keys for the /api/v1 API. Only a hash of each key is kept.
-- Managed with scripts/api-token.mjs.
CREATE TABLE IF NOT EXISTS api_tokens (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);

CREATE VIEW IF NOT EXISTS place_songs AS
SELECT p.id AS place_id, p.name AS place_name, pt.position, pt.added_at,
       t.uri, t.id, t.name,
       (SELECT group_concat(value, ', ') FROM json_each(t.artists)) AS artists,
       t.album, t.release_date, t.duration_ms
FROM place_tracks pt
JOIN places p ON p.id = pt.place_id
JOIN tracks t ON t.uri = pt.track_uri;

CREATE VIEW IF NOT EXISTS song_genres AS
SELECT g.track_id, t.uri, t.name,
       (SELECT group_concat(value, ', ') FROM json_each(t.artists)) AS artists,
       tag.position, tag.genre, g.mood_vibe
FROM track_genres g
JOIN track_genre_tags tag ON tag.track_id = g.track_id
LEFT JOIN tracks t ON t.id = g.track_id;
`;

// Columns added after their table was first created, which CREATE TABLE IF
// NOT EXISTS won't add to an existing database.
const ADDED_COLUMNS: { table: string; column: string; declaration: string }[] = [
  { table: "tracks", column: "base_title", declaration: "TEXT" },
  { table: "track_genres", column: "edited", declaration: "INTEGER NOT NULL DEFAULT 0" },
  { table: "track_genre_tags", column: "confidence", declaration: "INTEGER" },
  { table: "track_genre_tags", column: "by_user", declaration: "INTEGER NOT NULL DEFAULT 0" },
  { table: "track_chat_messages", column: "suggestion", declaration: "TEXT" },
  { table: "track_chat_messages", column: "applied", declaration: "INTEGER NOT NULL DEFAULT 0" },
];
// Indexes on added columns, created once the columns exist.
const LATE_INDEXES = "CREATE INDEX IF NOT EXISTS tracks_base_title ON tracks(base_title);";
// Bumped whenever the schema changes, so a dev server's open connection
// picks the change up without a restart.
const SCHEMA_VERSION = 6;

interface DbState {
  db: DatabaseSync;
  statements: Map<string, StatementSync>;
  schemaVersion: number;
}

// On globalThis so dev-server reloads reuse one connection.
const holder = globalThis as typeof globalThis & { __libraryDb?: DbState };

function setUpSchema(db: DatabaseSync) {
  db.exec(SCHEMA);
  for (const { table, column, declaration } of ADDED_COLUMNS) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!columns.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
  }
  db.exec(LATE_INDEXES);
}

function state(): DbState {
  let current = holder.__libraryDb;
  if (!current) {
    mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const db = new DatabaseSync(DB_PATH);
    // WAL lets a sqlite3 shell read while the app writes.
    db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    current = holder.__libraryDb = { db, statements: new Map(), schemaVersion: 0 };
  }
  if (current.schemaVersion !== SCHEMA_VERSION) {
    setUpSchema(current.db);
    current.statements.clear();
    current.schemaVersion = SCHEMA_VERSION;
  }
  return current;
}

/** A prepared statement, reused across calls with the same SQL. */
export function sql(text: string): StatementSync {
  const { db, statements } = state();
  let statement = statements.get(text);
  if (!statement) statements.set(text, (statement = db.prepare(text)));
  return statement;
}

/** Runs `fn` in one transaction: all of its writes land, or none do. */
export function transaction<T>(fn: () => T): T {
  const { db } = state();
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/** Runs `fn` (inside a transaction) the first time `key` is seen, never again. */
export function once(key: string, fn: () => void) {
  if (sql("SELECT 1 FROM done_once WHERE key = ?").get(key)) return;
  transaction(() => {
    fn();
    sql("INSERT INTO done_once (key) VALUES (?)").run(key);
  });
}
