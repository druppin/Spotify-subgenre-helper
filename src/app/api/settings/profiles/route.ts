import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localRequest";
import { getSession } from "@/lib/session";
import { cancelNewProfile, deleteProfile, listProfiles, switchProfile } from "@/lib/settings";

/*
 * Profiles: named sets of every key (Spotify app, AI, Last.fm). GET lists
 * them; PUT { name, create? } switches to one, making it first if create,
 * and PUT { cancelNew: true } throws away a just-made profile, going back;
 * DELETE ?name= removes one that isn't in use.
 */

export async function GET(request: Request) {
  return checkLocalRequest(request) ?? NextResponse.json(listProfiles());
}

export async function PUT(request: Request) {
  const denied = checkLocalRequest(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as { name?: unknown; create?: unknown; cancelNew?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name && body?.cancelNew !== true) return NextResponse.json({ error: "Give the profile a name." }, { status: 400 });
  try {
    if (body?.cancelNew === true) cancelNewProfile();
    else switchProfile(name, body?.create === true);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
  // The Spotify login belongs to the old profile's app and account.
  (await getSession()).destroy();
  return NextResponse.json(listProfiles());
}

export async function DELETE(request: Request) {
  const denied = checkLocalRequest(request);
  if (denied) return denied;
  try {
    deleteProfile(new URL(request.url).searchParams.get("name") ?? "");
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
  return NextResponse.json(listProfiles());
}
