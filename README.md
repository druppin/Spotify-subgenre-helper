# Spotify Subgenre Assistant

![Spotify Subgenre Assistant](public/promo.png)

A personal dashboard for triaging tracks into playlists. Point it at a messy
source playlist (a Discover Weekly dump, a "sort me later" pile, whatever),
play through it one track at a time, and let an LLM tell you what it actually
*is* — mood, vibe, and specific subgenre guesses grounded in real metadata —
before you file it into one of your own playlists.

## Why

Spotify's own genre tags are broad ("edm", "house") and don't help much when
you're trying to route tracks into a dozen different subgenre playlists. This
app pulls together everything Spotify + a couple of free APIs already know
about a track — artist genres, Last.fm tags/bio, and low-level audio features
like tempo/energy/danceability — and asks an LLM to turn that into a specific,
justified subgenre guess (e.g. "UK bass house" instead of just "house"),
without ever inventing context that isn't actually in the data.

## How it works

1. **Pick a source playlist** from the picker in the header.
2. The **left panel** lists the source playlist's tracks; the current one is
   highlighted and plays automatically via the Spotify Web Playback SDK.
3. The **center panel** shows transport controls (prev/play-pause/next) plus
   the AI-generated context for the track: mood/vibe, subgenre guesses, and
   the rationale behind them — along with the raw genres, tags, and audio
   features it was built from.
4. The **right panel** lists your playlists as filing destinations. Pin the
   ones you use most so they stay at the top. Adding a track can optionally
   remove it from the source playlist at the same time — that removal is
   deferred until you move to the next track, so you can still file the same
   track into a second or third destination first.
5. Repeat until the source playlist is empty.

## Features

- AI-generated mood/vibe + freeform subgenre labels per track, with a
  rationale that cites only the data it was actually given (no invented
  backstory, no reasoning from the track title)
- Audio features (danceability, energy, valence, tempo, key, etc.) via
  [ReccoBeats](https://reccobeats.com) — a free replacement for Spotify's own
  Audio Features endpoint, which has been closed to new apps since Nov 2024
- Optional Last.fm tags and artist bio for extra context
- Per-track and per-context-hash caching so re-visiting a track (or re-running
  a prompt tweak) doesn't re-hit the LLM or external APIs unnecessarily
- Pinnable destination playlists, with a per-track "already added here" cue
- Bring-your-own LLM key: switch between Anthropic, OpenAI, Google, Groq, or
  OpenRouter via a couple of env vars, no code changes
- Full Spotify playback control (play/pause/seek/skip) via the Web Playback
  SDK, so you can actually listen before you decide
- A local, key-protected [library API](docs/api.md) so other programs (DJ
  software, file taggers) can look up a song's genres by ISRC or artist +
  title, or export them all

## Tech stack

- [Next.js](https://nextjs.org) (App Router) + React 19 + TypeScript
- Tailwind CSS v4
- [iron-session](https://github.com/vvo/iron-session) for encrypted,
  cookie-based session storage (Spotify OAuth tokens)
- Spotify Web API + Web Playback SDK, [ReccoBeats](https://reccobeats.com),
  [Last.fm API](https://www.last.fm/api) — all called server-side except
  playback itself

## Install

Download the installer for your computer from the
[Releases page](https://github.com/druppin/Spotify-subgenre-helper/releases):
`.exe` for Windows, `.dmg` for macOS (arm64 for Apple Silicon, x64 for Intel),
`.AppImage` for Linux. Open it, and the app opens in your browser at
`http://127.0.0.1:3000` and walks you through setup. A small window shows it's
running; close it to stop the app.

The installers aren't signed yet, so the first launch warns about it:

- **Windows:** on "Windows protected your PC", click **More info → Run anyway**.
- **macOS:** if it says the app can't be opened or is damaged, run
  `xattr -cr "/Applications/Spotify Subgenre Assistant.app"` in Terminal, then
  open it again.
- **Linux:** make the AppImage executable (`chmod +x`), then run it.

Your settings and library are kept in the app's data folder (the window links
to it), so they survive updates.

To run from source instead, follow Setup below.

### Building the installers

`npm run desktop` builds and runs the desktop app from a checkout, and
`npm run desktop:dist` builds this OS's installer into `dist/`. To release,
bump `version` in `package.json`, then push a matching tag (`v0.2.0`):
GitHub Actions builds all three installers and attaches them to a draft
release to review and publish.

## Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Run the dev server**

   ```bash
   npm run dev
   ```

3. **Open [http://127.0.0.1:3000](http://127.0.0.1:3000)** (use `127.0.0.1`,
   not `localhost`, to match the Spotify redirect URI). The first time, the app
   asks for:
   - **A Spotify app's Client ID and secret.** The setup screen walks you
     through registering one at the
     [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and
     shows the Redirect URI to add. Playback needs **Spotify Premium** (the Web
     Playback SDK doesn't work otherwise).
   - **An AI provider and API key**, for genre guesses. Bring your own key;
     `anthropic` is pay-as-you-go from
     [console.anthropic.com](https://console.anthropic.com) (a claude.ai Pro/Max
     subscription does NOT cover API usage — separate billing). Google AI
     Studio's Gemini Flash, Groq, and OpenRouter `:free` models are free
     options.
   - **A Last.fm API key** (optional, free from
     [last.fm/api](https://www.last.fm/api/account/create)). Track context
     still builds without it, just without Last.fm tags/bio.

   Then click "Connect Spotify". Everything can be changed later under
   Settings. Nothing to configure for [MusicBrainz](https://musicbrainz.org)
   (community-voted genres; ~1 request/sec, so a track's first load takes a few
   extra seconds) or [ReccoBeats](https://reccobeats.com) (audio features, a
   free replacement for Spotify's closed Audio Features endpoint).

   Prefer a config file? Copy `.env.example` to `.env.local` and fill it in
   instead; values saved in Settings take priority over it.

Everything the app saves (settings, the library database, caches, logs) goes in
`.cache/` in the project folder. Set `SGH_DATA_DIR` to keep it somewhere else.

## Project structure

```
src/
  app/
    api/
      auth/            # Spotify OAuth login/callback/logout/status
      playlists/       # list playlists, list/add/remove tracks
      spotify/token/   # short-lived access token for the Web Playback SDK
      track/[id]/summary/  # builds context + runs the LLM summary
    page.tsx           # entry point behind AuthGate
  components/
    Dashboard.tsx           # top-level layout + playlist/track state machine
    SourcePlaylistPanel.tsx # left: track list for the current source playlist
    NowPlayingPanel.tsx     # center: transport controls + AI context
    TrackDataPanel.tsx      # raw genres/tags/audio features display
    DestinationPlaylistsPanel.tsx  # right: pinnable filing targets
    PlayerProvider.tsx      # Web Playback SDK wrapper (client-side)
  lib/
    spotify/          # OAuth (auth.ts) + Web API client (client.ts)
    session.ts         # encrypted session cookie, token refresh
    context.ts          # buildTrackContext(): merges Spotify + Last.fm + ReccoBeats
    llm/                 # provider-agnostic summarize.ts + per-provider adapters
    reccobeats.ts, lastfm.ts   # external API clients
    cache.ts             # swappable Cache interface (in-memory today)
```

## Architecture notes

- `src/lib/spotify/` — OAuth (`auth.ts`) and Web API client (`client.ts`).
  Tokens live in an encrypted session cookie (`src/lib/session.ts`), refreshed
  transparently by `getValidAccessToken()`.
- `src/lib/context.ts` — `buildTrackContext()`: combines Spotify metadata,
  artist genres, Last.fm tags/bio, and ReccoBeats audio features into one
  object per track, cached by track ID.
- `src/lib/llm/summarize.ts` — `summarizeTrack()`: sends that context to the
  configured LLM provider and returns a structured `{ moodVibe, subgenres,
  rationale }` summary. Subgenres are freeform (not a fixed list) by design,
  and the cache key is derived from a hash of the prompt itself, so editing
  the prompt automatically invalidates stale cached summaries.
- `src/lib/cache.ts` — a small `Cache` interface with an in-memory
  implementation. Swap in a file- or DB-backed implementation later without
  touching callers.
- `src/components/PlayerProvider.tsx` — wraps the Spotify Web Playback SDK
  (loaded client-side; requires Premium). Play/pause/seek go through the
  Spotify REST API rather than the SDK instance methods, which are flakier
  about reflecting state back.

Single-user today (one session cookie, no per-user LLM key storage yet), but
built to extend to multi-user later: OAuth tokens are already per-session
rather than global, and `summarizeTrack` already takes a provider/model
argument rather than being hard-coded to one.

## Learn more about Next.js

- [Next.js Documentation](https://nextjs.org/docs)
- [Learn Next.js](https://nextjs.org/learn)
