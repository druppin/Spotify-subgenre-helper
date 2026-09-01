import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { buildAuthorizeUrl } from "@/lib/spotify/auth";
import { getSession } from "@/lib/session";

export async function GET() {
  const state = randomBytes(16).toString("hex");
  const session = await getSession();
  session.oauthState = state;
  await session.save();

  return NextResponse.redirect(buildAuthorizeUrl(state));
}
