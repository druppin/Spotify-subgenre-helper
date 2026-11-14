import { NextRequest, NextResponse } from "next/server";
import {
  compareTagSnapshot,
  deleteTagSnapshot,
  listTagSnapshots,
  restoreTagSnapshot,
  saveTagSnapshot,
} from "@/lib/trackGenres";

/*
 * Snapshots of a playlist's songs' tags. GET ?playlistId= lists them;
 * GET ?id= gives the songs whose tags have changed since. POST
 * { name, playlistId, trackIds } saves one; PUT { id, trackIds? } restores
 * it (only those songs, if given); DELETE ?id= removes it.
 */

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  if (id) {
    const changes = compareTagSnapshot(Number(id));
    return changes ? NextResponse.json({ changes }) : NextResponse.json({ error: "No such snapshot" }, { status: 404 });
  }
  const playlistId = params.get("playlistId");
  if (!playlistId) return NextResponse.json({ error: "playlistId or id is required" }, { status: 400 });
  return NextResponse.json({ snapshots: listTagSnapshots(playlistId) });
}

export async function POST(request: NextRequest) {
  const { name, playlistId, trackIds } = await request.json();
  if (typeof name !== "string" || !name.trim() || typeof playlistId !== "string" || !isStrings(trackIds)) {
    return NextResponse.json({ error: "name, playlistId and trackIds are required" }, { status: 400 });
  }
  return NextResponse.json({ snapshot: saveTagSnapshot(name.trim(), playlistId, trackIds) });
}

export async function PUT(request: NextRequest) {
  const { id, trackIds } = await request.json();
  if (typeof id !== "number" || (trackIds !== undefined && !isStrings(trackIds))) {
    return NextResponse.json({ error: "id is required; trackIds must be track IDs" }, { status: 400 });
  }
  return NextResponse.json({ restored: restoreTagSnapshot(id, trackIds) });
}

export async function DELETE(request: NextRequest) {
  deleteTagSnapshot(Number(new URL(request.url).searchParams.get("id")));
  return NextResponse.json({ ok: true });
}
