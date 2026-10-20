# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(Also shipped as an Electron desktop app for Windows, macOS and Linux, which wraps the same web UI.)

## Users

Any Spotify user who keeps their music in many genre playlists and has a pile of songs waiting to be sorted: a Discover Weekly dump, a "sort me later" playlist, or years of Liked Songs. They sort in long sessions, listening to each song while they decide where it goes.

## Product Purpose

Spotify's own genres are broad ("edm", "house"). This app plays through a source playlist one song at a time, has an AI suggest specific subgenres grounded in real data (Last.fm tags, MusicBrainz genres, audio features), and lets the user file each song into their own playlists. Success is a sorted library: each song lives in the playlists where it belongs, and none are lost.

## Positioning

Subgenre suggestions that show their evidence and how sure they are, with the listener always having the final say. The AI explains its reasoning from the data it was given, never from invented backstory. Users can edit any tag, see a confidence score for each one, and ask follow-up questions about a song.

## Operating Context

- Used alongside Spotify, with the song playing through the Spotify Web Playback SDK.
- Two tools: the **Subgenre sorter** (source playlist on the left, the current song and its AI summary in the middle, destination playlists on the right) and **My library** (where each song lives, lost songs, bulk selection and removal).
- Bring-your-own keys for Spotify, the AI provider (Anthropic, OpenAI, Google, Groq or OpenRouter) and Last.fm, entered in Settings.
- Runs locally (127.0.0.1) as a dev server or desktop app, and serves a local library API to other programs (docs/api.md).

## Capabilities and Constraints

- AI mood, subgenre tags, rationale and per-tag confidence (0-100), with tags editable by the user and a follow-up chat per song.
- Bulk genre generation and scoring per playlist.
- Spotify rate limits are strict, so the app saves the library locally and counts requests before scanning.
- Spotify development-mode apps get no artist genres, so the evidence comes from Last.fm, MusicBrainz and ReccoBeats.

## Brand Commitments

- The name stays **Spotify Subgenre Assistant**.

## Evidence on Hand

- `public/promo.png`: the existing promo image.
- No testimonials, user counts or press exist; don't invent any.

## Product Principles

- The listener decides; the AI advises and shows how sure it is.
- Every claim about a song is grounded in data the user can see.
- Sorting is a long, repetitive session: speed and calm beat novelty.
- Never lose a song: make where each song lives obvious.
