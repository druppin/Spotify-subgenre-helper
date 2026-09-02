"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";

// Minimal shape of the bits of the Web Playback SDK we use. The SDK ships no
// official types; this covers what this app touches.
interface SpotifyPlayerState {
  paused: boolean;
  position: number;
  duration: number;
  track_window: { current_track: { uri: string; name: string } };
}
interface SpotifyPlayer {
  connect(): Promise<boolean>;
  disconnect(): void;
  addListener(event: string, cb: (arg: unknown) => void): void;
  togglePlay(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  setVolume(volume: number): Promise<void>;
}
declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady?: () => void;
    Spotify?: {
      Player: new (options: {
        name: string;
        getOAuthToken: (cb: (token: string) => void) => void;
        volume?: number;
      }) => SpotifyPlayer;
    };
  }
}

interface PlayerContextValue {
  ready: boolean;
  isPaused: boolean;
  currentUri: string | null;
  position: number;
  duration: number;
  volume: number;
  playbackError: string | null;
  playTrack: (uri: string) => Promise<void>;
  togglePlay: () => Promise<void>;
  seek: (positionMs: number) => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

// The Web Playback SDK calls getOAuthToken on its own schedule, and
// playTrack calls this on every attempt — uncached, that's enough
// concurrent same-origin requests to exhaust the browser's per-origin
// connection limit and leave one queued long enough to hit our own fetch
// timeout, even though our server answered every other request fine. Cache
// the token briefly and dedupe concurrent callers onto one in-flight
// request instead of each firing their own.
let cachedToken: { value: string; fetchedAt: number } | null = null;
let inFlightTokenFetch: Promise<string> | null = null;
const TOKEN_CACHE_TTL_MS = 30_000;

async function fetchAccessToken(): Promise<string> {
  if (cachedToken && Date.now() - cachedToken.fetchedAt < TOKEN_CACHE_TTL_MS) {
    return cachedToken.value;
  }
  if (inFlightTokenFetch) return inFlightTokenFetch;

  inFlightTokenFetch = (async () => {
    try {
      const res = await fetchWithTimeout("/api/spotify/token");
      if (!res.ok) throw new Error("Not authenticated with Spotify");
      const body = await res.json();
      cachedToken = { value: body.accessToken, fetchedAt: Date.now() };
      return body.accessToken as string;
    } finally {
      inFlightTokenFetch = null;
    }
  })();
  return inFlightTokenFetch;
}

const TRANSIENT_STATUS_CODES = new Set([502, 503, 504]);

class PermanentPlaybackError extends Error {}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [isPaused, setIsPaused] = useState(true);
  const [currentUri, setCurrentUri] = useState<string | null>(null);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(0.8);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const playerRef = useRef<SpotifyPlayer | null>(null);
  const deviceIdRef = useRef<string | null>(null);
  // The URI the user actually wants playing right now, and a promise chain
  // that serializes play requests onto Spotify. Without this, switching
  // tracks quickly can fire overlapping "start playback" requests whose
  // network responses arrive out of order — a slow request for a track the
  // user has already skipped past can land after a faster one for the
  // track they're actually on, and Spotify ends up playing the stale one
  // even though the UI has already moved on to the right track's info.
  const latestRequestedUriRef = useRef<string | null>(null);
  const playChainRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://sdk.scdn.co/spotify-player.js";
    script.async = true;
    document.body.appendChild(script);

    window.onSpotifyWebPlaybackSDKReady = () => {
      const player = new window.Spotify!.Player({
        name: "Spotify Subgenre Assistant",
        getOAuthToken: (cb) => fetchAccessToken().then(cb),
        volume: 0.8,
      });

      player.addListener("ready", (arg) => {
        const { device_id } = arg as { device_id: string };
        deviceIdRef.current = device_id;
        setReady(true);
      });
      player.addListener("not_ready", () => setReady(false));
      player.addListener("player_state_changed", (arg) => {
        const state = arg as SpotifyPlayerState | null;
        if (!state) return;
        console.debug("[player_state_changed]", {
          actuallyPlayingUri: state.track_window.current_track.uri,
          actuallyPlayingName: state.track_window.current_track.name,
          latestRequestedUri: latestRequestedUriRef.current,
          paused: state.paused,
        });
        setIsPaused(state.paused);
        setPosition(state.position);
        setDuration(state.duration);
        setCurrentUri(state.track_window.current_track.uri);
      });
      player.addListener("initialization_error", (arg) => console.error("Spotify SDK init error", arg));
      player.addListener("authentication_error", (arg) => console.error("Spotify SDK auth error", arg));
      player.addListener("account_error", (arg) =>
        console.error("Spotify SDK account error (Premium required)", arg)
      );

      player.connect();
      playerRef.current = player;
    };

    return () => {
      playerRef.current?.disconnect();
      document.body.removeChild(script);
    };
  }, []);

  // player_state_changed only fires on actual state transitions (play,
  // pause, seek, track change) — tick position forward locally in between
  // so the progress bar moves smoothly instead of jumping once a second.
  useEffect(() => {
    if (isPaused) return;
    const interval = setInterval(() => {
      setPosition((p) => Math.min(p + 1000, duration || p + 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [isPaused, duration]);

  const playTrack = useCallback((uri: string): Promise<void> => {
    console.debug("[playTrack] requested", { uri });
    latestRequestedUriRef.current = uri;
    const deviceId = deviceIdRef.current;

    // Chain onto whatever's currently in flight so play requests always
    // reach Spotify in the order the user actually wants, one at a time —
    // never racing a previous request that might still be mid-retry.
    const next = playChainRef.current.then(async () => {
      // Superseded by a newer request before this one's turn came up (the
      // user has since moved on) — no need to actually play it at all.
      if (latestRequestedUriRef.current !== uri) {
        console.debug("[playTrack] skipped (superseded before its turn)", {
          uri,
          latest: latestRequestedUriRef.current,
        });
        return;
      }
      if (!deviceId) throw new Error("Player not ready yet");

      setPlaybackError(null);
      // Spotify's Connect "play" endpoint is known to be flaky (502/503/504,
      // or an outright network failure) right after a device connects or on
      // rapid track switches — worth a couple of retries before treating it
      // as real. A non-transient failure (bad auth, bad request, etc.) is
      // marked with PermanentPlaybackError below and always fails immediately.
      const MAX_ATTEMPTS = 3;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        if (latestRequestedUriRef.current !== uri) return;
        const isLastAttempt = attempt === MAX_ATTEMPTS;
        try {
          const accessToken = await fetchAccessToken();
          console.debug("[playTrack] sending PUT", { uri, attempt });
          const res = await fetchWithTimeout(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ uris: [uri] }),
          });
          console.debug("[playTrack] PUT response", { uri, attempt, status: res.status });
          if (res.ok || res.status === 204) return;

          const message = `Failed to start playback: ${res.status} ${await res.text()}`;
          throw TRANSIENT_STATUS_CODES.has(res.status)
            ? new Error(message)
            : new PermanentPlaybackError(message);
        } catch (err) {
          if (err instanceof PermanentPlaybackError || isLastAttempt) {
            if (latestRequestedUriRef.current === uri) {
              const message = err instanceof Error ? err.message : String(err);
              setPlaybackError(message);
            }
            throw err;
          }
          // transient — fall through and retry after a short backoff
        }
        await sleep(400 * attempt);
      }
    });

    // The chain itself must never reject (or every later call would inherit
    // a dead chain) — swallow here, while `next` still rejects normally for
    // this call's own caller.
    playChainRef.current = next.catch(() => {});
    return next;
  }, []);

  const togglePlay = useCallback(async () => {
    await playerRef.current?.togglePlay();
  }, []);

  const seek = useCallback(async (positionMs: number) => {
    await playerRef.current?.seek(positionMs);
    setPosition(positionMs);
  }, []);

  const setVolume = useCallback(async (v: number) => {
    await playerRef.current?.setVolume(v);
    setVolumeState(v);
  }, []);

  return (
    <PlayerContext.Provider
      value={{
        ready,
        isPaused,
        currentUri,
        position,
        duration,
        volume,
        playbackError,
        playTrack,
        togglePlay,
        seek,
        setVolume,
      }}
    >
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used within a PlayerProvider");
  return ctx;
}
