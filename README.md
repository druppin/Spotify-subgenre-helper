# Spotify Subgenre Assistant

Personal dashboard for sorting tracks into playlists: pick a source playlist,
play through it one track at a time, see AI-generated genre/mood context for
each track, and file it into a destination playlist (with an option to remove
it from the source playlist at the same time).

## Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Register a Spotify app** at the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
   - Add a Redirect URI of exactly `http://127.0.0.1:3000/api/auth/callback`
     (Spotify requires the loopback IP literal, not `localhost`, for non-HTTPS
     redirect URIs).
   - Copy the Client ID and Client Secret.
   - Playback requires a **Spotify Premium** account — the Web Playback SDK
     doesn't work otherwise.

3. **Copy `.env.example` to `.env.local`** and fill in:
   - `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` from step 2.
   - `SESSION_SECRET` — any random 32+ character string (`openssl rand -base64 32`).
   - `LASTFM_API_KEY` — optional, free key from [last.fm/api](https://www.last.fm/api/account/create).
     Track context still builds without it, just without Last.fm tags/bio.
   - Nothing to configure for audio features (danceability/energy/valence/
     tempo/etc.) — they come from [ReccoBeats](https://reccobeats.com), a free
     replacement for Spotify's own Audio Features endpoint (closed to new
     apps since Nov 2024), no API key required. Tracks it doesn't have
     coverage for just come back with no audio features.
   - `LLM_PROVIDER` / `LLM_API_KEY` / `LLM_MODEL` — required for AI summaries.
     Bring your own key; `anthropic` is pay-as-you-go from
     [console.anthropic.com](https://console.anthropic.com) (a claude.ai Pro/Max
     subscription does NOT cover API usage — separate billing). Free tiers to
     prototype with instead are listed in `.env.example` (Google AI Studio's
     Gemini Flash, Groq, or an OpenRouter `:free` model).

4. **Run the dev server**

   ```bash
   npm run dev
   ```

   Open [http://127.0.0.1:3000](http://127.0.0.1:3000) (use `127.0.0.1`, not
   `localhost`, to match the Spotify redirect URI) and click "Connect Spotify".

## Architecture notes

- `src/lib/spotify/` — OAuth (`auth.ts`) and Web API client (`client.ts`).
  Tokens live in an encrypted session cookie (`src/lib/session.ts`), refreshed
  transparently by `getValidAccessToken()`.
- `src/lib/context.ts` — `buildTrackContext()`: combines Spotify metadata,
  artist genres, Last.fm tags/bio, and ReccoBeats audio features into one
  object per track, cached by track ID.
- `src/lib/llm/summarize.ts` — `summarizeTrack()`: sends that context to the
  configured LLM provider and returns a structured `{ moodVibe, subgenres,
  rationale }` summary. Subgenres are freeform (not a fixed list) by design.
- `src/lib/cache.ts` — a small `Cache` interface with an in-memory
  implementation. Swap in a file- or DB-backed implementation later without
  touching callers.
- `src/components/PlayerProvider.tsx` — wraps the Spotify Web Playback SDK
  (loaded client-side; requires Premium).

Single-user today (one session cookie, no per-user LLM key storage yet), but
built to extend to multi-user later: OAuth tokens are already per-session
rather than global, and `summarize_track` already takes a provider/model
argument rather than being hard-coded to one.

## Learn more about Next.js

- [Next.js Documentation](https://nextjs.org/docs)
- [Learn Next.js](https://nextjs.org/learn)
