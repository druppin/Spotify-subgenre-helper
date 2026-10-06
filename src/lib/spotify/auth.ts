import { getSession } from "@/lib/session";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";

const AUTH_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";

// Scopes needed: Web Playback SDK ("streaming" + user read), reading/pinning
// playlists, modifying both the destination and source playlists, and
// reading Liked Songs for the lost tracks finder.
export const SPOTIFY_SCOPES = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-read-playback-state",
  "user-modify-playback-state",
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-public",
  "playlist-modify-private",
  "user-library-read",
].join(" ");

export function hasScope(grantedScope: string | undefined, scope: string): boolean {
  return (grantedScope ?? "").split(" ").includes(scope);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export function getRedirectUri(): string {
  return requireEnv("SPOTIFY_REDIRECT_URI");
}

export function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: requireEnv("SPOTIFY_CLIENT_ID"),
    response_type: "code",
    redirect_uri: getRedirectUri(),
    scope: SPOTIFY_SCOPES,
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

interface SpotifyTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  expires_in: number;
  refresh_token?: string;
}

function basicAuthHeader(): string {
  const clientId = requireEnv("SPOTIFY_CLIENT_ID");
  const clientSecret = requireEnv("SPOTIFY_CLIENT_SECRET");
  return "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
}

export async function exchangeCodeForToken(code: string): Promise<SpotifyTokenResponse> {
  const res = await fetchWithTimeout(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(),
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: getRedirectUri(),
    }),
  });
  if (!res.ok) {
    throw new Error(`Spotify token exchange failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export async function refreshAccessToken(refreshToken: string): Promise<SpotifyTokenResponse> {
  const res = await fetchWithTimeout(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(),
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    throw new Error(`Spotify token refresh failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/**
 * Returns a valid access token for the current session, refreshing it (and
 * persisting the refreshed token back into the session) if it's expired or
 * close to expiring. Throws if there's no session to work with.
 */
// Requests that find the token expired at the same moment (bulk genre
// generation runs several at once) share one refresh instead of each
// sending their own — and possibly saving a refresh token another
// response's refresh has already replaced.
const inFlightRefreshes = new Map<string, Promise<SpotifyTokenResponse>>();

function refreshOnce(refreshToken: string): Promise<SpotifyTokenResponse> {
  let refresh = inFlightRefreshes.get(refreshToken);
  if (!refresh) {
    refresh = refreshAccessToken(refreshToken).finally(() => inFlightRefreshes.delete(refreshToken));
    inFlightRefreshes.set(refreshToken, refresh);
  }
  return refresh;
}

export async function getValidAccessToken(): Promise<string> {
  const session = await getSession();
  if (!session.accessToken || !session.refreshToken || !session.expiresAt) {
    throw new Error("Not authenticated with Spotify");
  }

  const EXPIRY_BUFFER_MS = 60_000;
  if (Date.now() < session.expiresAt - EXPIRY_BUFFER_MS) {
    return session.accessToken;
  }

  const refreshed = await refreshOnce(session.refreshToken);
  session.accessToken = refreshed.access_token;
  session.expiresAt = Date.now() + refreshed.expires_in * 1000;
  if (refreshed.scope) session.scope = refreshed.scope;
  if (refreshed.refresh_token) {
    session.refreshToken = refreshed.refresh_token;
  }
  await session.save();
  return session.accessToken;
}
