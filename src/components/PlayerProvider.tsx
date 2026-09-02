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

// Minimal shape of the bits of the Web Playback SDK we use. The SDK ships no
// official types; this covers what this app touches.
interface SpotifyPlayerState {
  paused: boolean;
  track_window: { current_track: { uri: string; name: string } };
}
interface SpotifyPlayer {
  connect(): Promise<boolean>;
  disconnect(): void;
  addListener(event: string, cb: (arg: unknown) => void): void;
  togglePlay(): Promise<void>;
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
  playbackError: string | null;
  playTrack: (uri: string) => Promise<void>;
  togglePlay: () => Promise<void>;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

async function fetchAccessToken(): Promise<string> {
  const res = await fetch("/api/spotify/token");
  if (!res.ok) throw new Error("Not authenticated with Spotify");
  const body = await res.json();
  return body.accessToken;
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
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const playerRef = useRef<SpotifyPlayer | null>(null);
  const deviceIdRef = useRef<string | null>(null);

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
        setIsPaused(state.paused);
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

  const playTrack = useCallback(async (uri: string) => {
    const deviceId = deviceIdRef.current;
    if (!deviceId) throw new Error("Player not ready yet");

    setPlaybackError(null);
    // Spotify's Connect "play" endpoint is known to be flaky (502/503/504, or
    // an outright network failure) right after a device connects or on rapid
    // track switches — worth a couple of retries before treating it as real.
    // A non-transient failure (bad auth, bad request, etc.) is marked with
    // PermanentPlaybackError below and always fails immediately.
    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const isLastAttempt = attempt === MAX_ATTEMPTS;
      try {
        const accessToken = await fetchAccessToken();
        const res = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ uris: [uri] }),
        });
        if (res.ok || res.status === 204) return;

        const message = `Failed to start playback: ${res.status} ${await res.text()}`;
        throw TRANSIENT_STATUS_CODES.has(res.status)
          ? new Error(message)
          : new PermanentPlaybackError(message);
      } catch (err) {
        if (err instanceof PermanentPlaybackError || isLastAttempt) {
          const message = err instanceof Error ? err.message : String(err);
          setPlaybackError(message);
          throw err;
        }
        // transient — fall through and retry after a short backoff
      }
      await sleep(400 * attempt);
    }
  }, []);

  const togglePlay = useCallback(async () => {
    await playerRef.current?.togglePlay();
  }, []);

  return (
    <PlayerContext.Provider
      value={{ ready, isPaused, currentUri, playbackError, playTrack, togglePlay }}
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
