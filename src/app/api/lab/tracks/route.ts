import { NextResponse } from "next/server";
import { checkDevRequest } from "@/lib/devMode";
import { buildTrackContext } from "@/lib/context";
import { getValidAccessToken } from "@/lib/spotify/auth";
import { SpotifyClient } from "@/lib/spotify/client";
import { spotifyErrorResponse } from "@/lib/spotify/routeError";
import { addTrack, latestContext, listTracks, removeTrack, resultsForTrack, setNote, setTruth, truthHistory } from "@/lib/lab/store";
import { STARTER_SET } from "@/lib/lab/starterSet";

// A Spotify track link, URI or bare id.
const TRACK_ID = /(?:track[/:])?([A-Za-z0-9]{22})\b/;

/** ?id= : one song's answers in every run, its truth history, and the latest data saved for it. */
export async function GET(request: Request) {
  const denied = checkDevRequest(request);
  if (denied) return denied;
  const id = new URL(request.url).searchParams.get("id") ?? "";
  return NextResponse.json({
    results: resultsForTrack(id),
    truths: truthHistory(id),
    context: latestContext(id)?.context ?? null,
  });
}

/**
 * Body: { input: string, note?: string }. Adds each song linked in input (one per line) to the test set.
 * Body: { starter: n }. Adds song n of the starter set, with its note and expected genres.
 */
export async function POST(request: Request) {
  const denied = checkDevRequest(request);
  if (denied) return denied;
  const { input, note, starter } = await request.json().catch(() => ({}));
  if (starter !== undefined) {
    if (!Number.isInteger(starter) || !STARTER_SET[starter]) {
      return NextResponse.json({ error: "starter must be a starter-set index" }, { status: 400 });
    }
    return addStarterSong(starter);
  }
  if (typeof input !== "string") return NextResponse.json({ error: "input must be text" }, { status: 400 });
  const ids = [...new Set(input.split(/\s+/).flatMap((part) => TRACK_ID.exec(part)?.[1] ?? []))];
  if (ids.length === 0) return NextResponse.json({ error: "No Spotify track links or ids found." }, { status: 400 });
  try {
    const client = new SpotifyClient(await getValidAccessToken());
    const failed: string[] = [];
    for (const id of ids) {
      // Uses the app's cached lookup when there is one, so adding is quick.
      const { context, lookupFailed } = await buildTrackContext(id, client);
      if (lookupFailed) failed.push(context.trackName || id);
      addTrack(context, typeof note === "string" ? note : "");
    }
    return NextResponse.json({ added: ids.length, failed });
  } catch (err) {
    return spotifyErrorResponse(err, "prompt lab (add songs)");
  }
}

// One song per request: each lookup takes seconds (MusicBrainz allows about
// one request a second), so the page adds them one by one and shows progress.
async function addStarterSong(index: number) {
  const song = STARTER_SET[index];
  try {
    const client = new SpotifyClient(await getValidAccessToken());
    const id = await client.findTrackId(song.artist, song.title);
    if (!id) return NextResponse.json({ status: "notFound" });
    // Songs already in the set keep their notes and expected genres.
    if (listTracks().some((t) => t.trackId === id)) return NextResponse.json({ status: "present" });
    const { context, lookupFailed } = await buildTrackContext(id, client);
    addTrack(context, song.note);
    setTruth(id, song.truth);
    return NextResponse.json({ status: "added", lookupFailed });
  } catch (err) {
    return spotifyErrorResponse(err, "prompt lab (add starter song)");
  }
}

/** Body: { trackId, note?, truth?: { required: string[], acceptable: string[] } }. */
export async function PUT(request: Request) {
  const denied = checkDevRequest(request);
  if (denied) return denied;
  const { trackId, note, truth } = await request.json().catch(() => ({}));
  if (typeof trackId !== "string") return NextResponse.json({ error: "trackId is required" }, { status: 400 });
  const isList = (x: unknown) => Array.isArray(x) && x.every((s) => typeof s === "string");
  if (truth !== undefined && !(isList(truth?.required) && isList(truth?.acceptable))) {
    return NextResponse.json({ error: "truth needs required and acceptable lists of genres" }, { status: 400 });
  }
  if (typeof note === "string") setNote(trackId, note);
  if (truth) setTruth(trackId, truth);
  return NextResponse.json({ ok: true });
}

/** ?id= : takes a song out of the test set (its past answers stay). */
export async function DELETE(request: Request) {
  const denied = checkDevRequest(request);
  if (denied) return denied;
  removeTrack(new URL(request.url).searchParams.get("id") ?? "");
  return NextResponse.json({ ok: true });
}
