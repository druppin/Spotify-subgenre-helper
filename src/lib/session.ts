import { cookies } from "next/headers";
import { getIronSession, type IronSession, type SessionOptions } from "iron-session";

export interface SpotifySessionData {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number; // epoch ms
  oauthState?: string;
}

const sessionPassword = process.env.SESSION_SECRET;
if (!sessionPassword || sessionPassword.length < 32) {
  throw new Error(
    "SESSION_SECRET env var must be set to a random string of at least 32 characters (see .env.example)"
  );
}

export const sessionOptions: SessionOptions = {
  cookieName: "subgenre_helper_session",
  password: sessionPassword,
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  },
};

export async function getSession(): Promise<IronSession<SpotifySessionData>> {
  const cookieStore = await cookies();
  return getIronSession<SpotifySessionData>(cookieStore, sessionOptions);
}
