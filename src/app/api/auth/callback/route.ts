import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForToken } from "@/lib/spotify/auth";
import { getCache } from "@/lib/cache";
import { getSession } from "@/lib/session";
import { getRedirectUri, listProfiles } from "@/lib/settings";
import { SpotifyClient } from "@/lib/spotify/client";

// The Spotify account whose library the active profile holds (see profileDataDir).
const accountCache = getCache<{ id: string; name: string }>("spotify-account");

// Back to the app at the address Spotify returned to. Not request.url: the
// production server reports its host as localhost, and the login cookie
// lives on 127.0.0.1, so landing on localhost would look logged out.
function backToApp(path: string): NextResponse {
  return NextResponse.redirect(new URL(path, getRedirectUri()));
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const session = await getSession();
  const expectedState = session.oauthState;
  session.oauthState = undefined;

  if (error) {
    return backToApp(`/?auth_error=${encodeURIComponent(error)}`);
  }
  if (!code || !state || state !== expectedState) {
    return backToApp("/?auth_error=state_mismatch");
  }

  const token = await exchangeCodeForToken(code);
  // A profile's library is one account's: refuse another's rather than mix them.
  let me: { id: string; display_name: string | null } | null = null;
  try {
    me = await new SpotifyClient(token.access_token).getCurrentUser();
  } catch (err) {
    // Spotify lets any account log in to an app in development mode, then
    // refuses its every request unless the account is on the app's list.
    if (/\b403\b/.test(String(err))) {
      await session.save();
      return backToApp("/?auth_error=not_registered");
    }
  }
  if (me) {
    const owner = await accountCache.get("owner");
    if (owner && owner.id !== me.id) {
      await session.save();
      return backToApp(`/?auth_error=wrong_account`);
    }
    if (!owner) await accountCache.set("owner", { id: me.id, name: me.display_name ?? me.id });
  }
  session.accessToken = token.access_token;
  session.refreshToken = token.refresh_token;
  session.expiresAt = Date.now() + token.expires_in * 1000;
  session.scope = token.scope;
  session.profile = listProfiles().active;
  await session.save();

  return backToApp("/");
}
