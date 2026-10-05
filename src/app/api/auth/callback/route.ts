import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForToken } from "@/lib/spotify/auth";
import { getSession } from "@/lib/session";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const session = await getSession();
  const expectedState = session.oauthState;
  session.oauthState = undefined;

  if (error) {
    return NextResponse.redirect(new URL(`/?auth_error=${encodeURIComponent(error)}`, request.url));
  }
  if (!code || !state || state !== expectedState) {
    return NextResponse.redirect(new URL("/?auth_error=state_mismatch", request.url));
  }

  const token = await exchangeCodeForToken(code);
  session.accessToken = token.access_token;
  session.refreshToken = token.refresh_token;
  session.expiresAt = Date.now() + token.expires_in * 1000;
  session.scope = token.scope;
  await session.save();

  return NextResponse.redirect(new URL("/", request.url));
}
