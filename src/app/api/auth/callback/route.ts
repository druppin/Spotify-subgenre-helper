import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForToken } from "@/lib/spotify/auth";
import { getSession } from "@/lib/session";
import { getRedirectUri } from "@/lib/settings";

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
  session.accessToken = token.access_token;
  session.refreshToken = token.refresh_token;
  session.expiresAt = Date.now() + token.expires_in * 1000;
  session.scope = token.scope;
  await session.save();

  return backToApp("/");
}
