import { cookies } from "next/headers";
import { getIronSession, type IronSession, type SessionOptions } from "iron-session";
import { DEFAULT_PROFILE, getSessionSecret, listProfiles } from "@/lib/settings";

export interface SpotifySessionData {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number; // epoch ms
  // Space-separated scopes Spotify actually granted, so features needing a
  // scope added after login can ask for a reconnect instead of failing.
  scope?: string;
  oauthState?: string;
  // The profile that was in use at login. A login only counts in that
  // profile: it's for that profile's Spotify app and account.
  profile?: string;
}

/** Whether the session is a Spotify login made in the profile now in use. */
export function loggedInHere(session: SpotifySessionData): boolean {
  // Logins from before profiles carry none, and were made in Default.
  const profile = session.profile ?? DEFAULT_PROFILE;
  return Boolean(session.accessToken && session.refreshToken && profile === listProfiles().active);
}

function sessionOptions(): SessionOptions {
  return {
    cookieName: "subgenre_helper_session",
    // SESSION_SECRET from .env.local, or one the app made and saved.
    password: getSessionSecret(),
    cookieOptions: {
      // Always plain http on 127.0.0.1, which Safari won't send secure
      // cookies to, so the login would never stick there.
      secure: false,
      sameSite: "lax",
    },
  };
}

export async function getSession(): Promise<IronSession<SpotifySessionData>> {
  const cookieStore = await cookies();
  return getIronSession<SpotifySessionData>(cookieStore, sessionOptions());
}
