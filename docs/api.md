# Library API (v1)

A read-only HTTP API over the app's library database: your cached playlists, songs, and the genres generated for them. It's meant for other programs on the same computer, such as a DJ tool that shows genres for the song that's playing, or a tagger that writes genres into your music files.

The app serves the API while it runs (`npm run dev` or `npm start`) at `http://127.0.0.1:3000/api/v1`. It only listens on 127.0.0.1, so it can't be reached from other machines.

The API only reads what the app has already cached. It never downloads from Spotify and never generates genres. Use the app to scan playlists and generate genres first.

## Keys

Every request needs an API key:

```
npm run api-token create "mixxx tagger"   # prints the key once
npm run api-token list
npm run api-token revoke <id>
```

Send the key in a header: `Authorization: Bearer sgh_…`. A missing or revoked key gets a `401`.

## Songs

Every endpoint returns songs in this shape:

```json
{
  "id": "0pwObEOHolQZSldJ2q1wpy",
  "uri": "spotify:track:0pwObEOHolQZSldJ2q1wpy",
  "isrc": "USZE19600081",
  "title": "Stinkfist",
  "artists": ["TOOL"],
  "album": "Ænima",
  "releaseDate": "1996-09-17",
  "durationMs": 311293,
  "genres": {
    "tags": ["progressive metal", "alternative metal"],
    "broader": ["metal"],
    "mood": "dark, aggressive, introspective intensity",
    "model": "openrouter:…",
    "updatedAt": "2026-10-05T01:18:28.334Z"
  }
}
```

- `genres.tags` holds the song's own genres, most specific first. Spelling variants ("drum & bass", "dnb") are merged into one spelling.
- `genres.broader` holds the wider genres those belong to. They aren't tags the song has itself. A tagger might write `tags` to a Genre field and `tags` + `broader` to a Grouping or Comment field.
- `genres` is `null` until genres have been generated for the song.
- `id` is `null` for songs Spotify has no track ID for (local files, episodes).
- `album` and `releaseDate` can be `null` for songs cached before album details were collected.

## Endpoints

### Find songs from another program

```
GET /api/v1/tracks?isrc=USZE19600081
GET /api/v1/tracks?artist=Tool&title=Stinkfist&durationMs=311000
```

Returns `{ "matches": [ { "match": "...", ...song } ] }`, best match first, or an empty list.

`isrc` is the most reliable lookup: many purchased files carry it in their tags. Otherwise, use `title` with an optional `artist`. The artist field can name several artists ("A, B & C", "A feat. B"); a song matches if any of them is one of its artists. The optional `durationMs` ranks the closest-length version first.

`match` says how sure the match is:

| `match` | Meaning |
|---|---|
| `isrc` | Same recording code: the same recording. |
| `title` | Same artist and title. Re-release tags like "Remastered", "Original Mix" and "feat." credits are ignored, so "Hey Now (Arty Remix)" matches Spotify's "Hey Now - Arty Remix". |
| `other-version` | Same artist and song, but a different mix, edit or remix. Its genres may differ. |

### Look up many songs at once

```
POST /api/v1/tracks/match
{ "queries": [ { "isrc": "…" }, { "artist": "…", "title": "…", "durationMs": 215000 } ] }
```

Returns `{ "results": [ { "matches": [...] }, … ] }` in query order. The limit is 1000 queries per request, and each query needs an `isrc` or a `title`.

### Everything with genres

```
GET /api/v1/tracks
```

Returns `{ "tracks": [...] }`: every song that has genres. This is useful for a full export.

### One song

```
GET /api/v1/tracks/{Spotify track ID or URI}
```

Returns `{ "track": {...} }`, or `404` if the song isn't cached.

### Playlists

```
GET /api/v1/playlists
GET /api/v1/playlists/{id}/tracks
```

The list is `{ "playlists": [ { "id", "name", "kind", "trackCount", "fetchedAt" } ] }`. Liked Songs has the id `liked`. A playlist's `name` fills in once the app has loaded your playlist list.

A playlist's songs come back as `{ "playlist": {...}, "tracks": [ { "position", "addedAt", ...song } ] }`, in playlist order, as last cached.

### Genres

```
GET /api/v1/genres
GET /api/v1/genres/{genre}/tracks
```

The genre list is `{ "genres": [ { "genre", "tagged", "total" } ] }`. `tagged` counts songs tagged with the genre itself. `total` also counts songs that only have it as a broader genre.

`/genres/{genre}/tracks` includes songs in narrower genres, so `metal` also finds `doom metal`. Spelling variants work too (`dnb` finds `drum and bass`).

## Errors

Errors come back as `{ "error": "message" }` with status `400` (bad request), `401` (key), `404` (not cached) or `500`.

## Querying the database directly

The same data is in `.cache/library.db`, a SQLite file you can open read-only. See the views described in `src/lib/db.ts`.
