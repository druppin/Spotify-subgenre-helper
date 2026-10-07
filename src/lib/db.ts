import { mkdirSync } from "fs";
import path from "path";
import { DatabaseSync, type StatementSync } from "node:sqlite";

/*
 * The library database: .cache/library.db, a SQLite file that can also be
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

const DB_PATH = path.join(process.cwd(), ".cache", "library.db");

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
  complete INTEGER NOT NULL
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
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS track_genre_tags (
  track_id TEXT NOT NULL REFERENCES track_genres(track_id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  genre TEXT NOT NULL,
  PRIMARY KEY (track_id, position)
);
CREATE INDEX IF NOT EXISTS track_genre_tags_genre ON track_genre_tags(genre);

-- One-time imports already done (see markDone).
CREATE TABLE IF NOT EXISTS done_once (key TEXT PRIMARY KEY);

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

interface DbState {
  db: DatabaseSync;
  statements: Map<string, StatementSync>;
}

// On globalThis so dev-server reloads reuse one connection.
const holder = globalThis as typeof globalThis & { __libraryDb?: DbState };

function state(): DbState {
  if (!holder.__libraryDb) {
    mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const db = new DatabaseSync(DB_PATH);
    // WAL lets a sqlite3 shell read while the app writes.
    db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    db.exec(SCHEMA);
    holder.__libraryDb = { db, statements: new Map() };
  }
  return holder.__libraryDb;
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
