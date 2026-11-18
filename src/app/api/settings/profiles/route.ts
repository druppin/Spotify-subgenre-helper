import { NextResponse } from "next/server";
import { getCache } from "@/lib/cache";
import { getValidAccessToken } from "@/lib/spotify/auth";
import { checkLocalRequest } from "@/lib/localRequest";
import { resetLibraryState } from "@/lib/playlistIndex";
import { getSession, loggedInHere } from "@/lib/session";
import { resetSpotifyBlock, SpotifyClient } from "@/lib/spotify/client";
import { cancelNewProfile, deleteProfile, listProfiles, switchProfile } from "@/lib/settings";

/*
 * Profiles: named sets of every key (Spotify app, AI, Last.fm), each with
 * its own library database and caches (see profileDataDir). GET lists
 * them; PUT { name, create? } switches to one, making it first if create,
 * and PUT { cancelNew: true } throws away a just-made profile, going back;
 * PUT { claimAccount: true } makes the logged-in Spotify account the one
 * the active profile's library belongs to; DELETE ?name= removes one that
 * isn't in use. Every answer also says who's logged in and whose library this is.
 */

type Account = { id: string; name: string };
const accountCache = getCache<Account>("spotify-account");

async function loggedInAs(): Promise<Account | null> {
  if (!loggedInHere(await getSession())) return null;
  try {
    const me = await new SpotifyClient(await getValidAccessToken()).getCurrentUser();
    return { id: me.id, name: me.display_name ?? me.id };
  } catch {
    return null;
  }
}

async function profilesResponse() {
  return NextResponse.json({
    ...listProfiles(),
    account: (await accountCache.get("owner")) ?? null,
    loggedIn: loggedInHere(await getSession()),
    loggedInAs: await loggedInAs(),
  });
}

export async function GET(request: Request) {
  return checkLocalRequest(request) ?? profilesResponse();
}

export async function PUT(request: Request) {
  const denied = checkLocalRequest(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as
    | { name?: unknown; create?: unknown; cancelNew?: unknown; claimAccount?: unknown }
    | null;
  if (body?.claimAccount === true) {
    const me = await loggedInAs();
    if (!me) return NextResponse.json({ error: "Log in to Spotify first." }, { status: 400 });
    await accountCache.set("owner", me);
    return profilesResponse();
  }
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name && body?.cancelNew !== true) return NextResponse.json({ error: "Give the profile a name." }, { status: 400 });
  try {
    if (body?.cancelNew === true) cancelNewProfile();
    else switchProfile(name, body?.create === true);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
  // The Spotify login and playlist listing belong to the old profile.
  (await getSession()).destroy();
  resetLibraryState();
  resetSpotifyBlock();
  return profilesResponse();
}

export async function DELETE(request: Request) {
  const denied = checkLocalRequest(request);
  if (denied) return denied;
  try {
    deleteProfile(new URL(request.url).searchParams.get("name") ?? "");
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
  return profilesResponse();
}
