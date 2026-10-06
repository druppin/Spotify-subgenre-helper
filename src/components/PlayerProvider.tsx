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
  track_window: { current_track: SpotifyPlayerTrack };
}
interface SpotifyPlayerTrack {
  uri: string;
  name: string;
  // Set when Spotify "relinked" the requested track to a different version
  // playable in the user's market: uri is then the substitute's, and this
  // holds the uri that was actually requested.
  linked_from?: { uri: string | null };
}
interface SpotifyPlayer {
  connect(): Promise<boolean>;
  disconnect(): void;
  addListener(event: string, cb: (arg: unknown) => void): void;
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
  onTrackEnd: (handler: ((uri: string) => void) | null) => void;
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

function isRequestedTrack(track: SpotifyPlayerTrack, requestedUri: string): boolean {
  return track.uri === requestedUri || track.linked_from?.uri === requestedUri;
}

const BOUNCE_WINDOW_MS = 15_000;
// How close to its end a track must have gotten before a stop counts as it
// finishing (state events are sparse, so this is estimated from wall time).
const TRACK_END_MARGIN_MS = 5_000;
const MAX_BOUNCE_CORRECTIONS = 2;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Pause/resume/seek go through Spotify's REST Connect API rather than the
// Web Playback SDK's own instance methods (player.togglePlay()/seek()) —
// those silently no-op in some cases (this device not fully recognized as
// the active Connect device yet), where the REST endpoints — the same ones
// playTrack already uses reliably — just work.
async function spotifyPlayerCommand(
  endpoint: "play" | "pause" | "seek",
  deviceId: string,
  extraParams: Record<string, string> = {}
): Promise<void> {
  const params = new URLSearchParams({ device_id: deviceId, ...extraParams });
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const isLastAttempt = attempt === MAX_ATTEMPTS;
    try {
      const accessToken = await fetchAccessToken();
      const res = await fetchWithTimeout(`https://api.spotify.com/v1/me/player/${endpoint}?${params}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok || res.status === 204) return;

      const message = `Spotify ${endpoint} failed: ${res.status} ${await res.text()}`;
      throw TRANSIENT_STATUS_CODES.has(res.status)
        ? new Error(message)
        : new PermanentPlaybackError(message);
    } catch (err) {
      if (err instanceof PermanentPlaybackError || isLastAttempt) throw err;
    }
    await sleep(400 * attempt);
  }
  throw new Error("unreachable");
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
  const lastStateRef = useRef<SpotifyPlayerState | null>(null);
  const lastStateAtRef = useRef(0);
  const endedUriRef = useRef<string | null>(null);
  const trackEndHandlerRef = useRef<((uri: string) => void) | null>(null);
  // Guards against Spotify jumping back to a track we didn't ask for right
  // after starting the one we did (observed after skipping: the requested
  // track starts, then the previous one restarts with no request from us).
  const requestedAtRef = useRef(0);
  const sawRequestedPlayingRef = useRef(false);
  const bounceCorrectionsRef = useRef(0);
  const playTrackRef = useRef<((uri: string) => Promise<void>) | null>(null);

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
        const prev = lastStateRef.current;
        const prevAt = lastStateAtRef.current;
        lastStateRef.current = state;
        lastStateAtRef.current = Date.now();
        console.debug("[player] state", {
          uri: state.track_window.current_track.uri,
          linkedFrom: state.track_window.current_track.linked_from?.uri ?? undefined,
          paused: state.paused,
          position: state.position,
          duration: state.duration,
        });
        // The SDK has no "ended" event: a finished track shows up as a
        // playing → paused transition back at position 0. Requiring the
        // track to still be the one we last requested filters out the same
        // transition that happens briefly while switching to a new track.
        // It must also have actually played to near its end: right after
        // startup Spotify often starts a track and immediately stops it back
        // at 0 (device not fully active yet), which would otherwise count as
        // "ended" and auto-advance — over and over, racing through the
        // playlist.
        const requestedUri = latestRequestedUriRef.current;
        const prevEstimatedPosition = prev ? prev.position + (Date.now() - prevAt) : 0;
        if (
          prev &&
          requestedUri &&
          isRequestedTrack(prev.track_window.current_track, requestedUri) &&
          !prev.paused &&
          state.paused &&
          state.position === 0 &&
          prev.duration > 0 &&
          prevEstimatedPosition >= prev.duration - TRACK_END_MARGIN_MS &&
          endedUriRef.current !== requestedUri
        ) {
          endedUriRef.current = requestedUri;
          trackEndHandlerRef.current?.(requestedUri);
        }
        const stateUri = state.track_window.current_track.uri;
        if (requestedUri && isRequestedTrack(state.track_window.current_track, requestedUri)) {
          sawRequestedPlayingRef.current = true;
        } else if (
          requestedUri &&
          sawRequestedPlayingRef.current &&
          Date.now() - requestedAtRef.current < BOUNCE_WINDOW_MS &&
          bounceCorrectionsRef.current < MAX_BOUNCE_CORRECTIONS
        ) {
          bounceCorrectionsRef.current++;
          sawRequestedPlayingRef.current = false;
          console.debug("[play] Spotify switched to a track we didn't request; re-requesting", {
            requestedUri,
            stateUri,
          });
          playTrackRef.current?.(requestedUri).catch((err) => console.error(err));
        }
        setIsPaused(state.paused);
        setPosition(state.position);
        setDuration(state.duration);
        const track = state.track_window.current_track;
        setCurrentUri(track.linked_from?.uri ?? track.uri);
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
    if (uri !== latestRequestedUriRef.current) bounceCorrectionsRef.current = 0;
    latestRequestedUriRef.current = uri;
    requestedAtRef.current = Date.now();
    sawRequestedPlayingRef.current = false;
    console.debug("[play] requested", uri);
    endedUriRef.current = null;
    const deviceId = deviceIdRef.current;

    // Chain onto whatever's currently in flight so play requests always
    // reach Spotify in the order the user actually wants, one at a time —
    // never racing a previous request that might still be mid-retry.
    const next = playChainRef.current.then(async () => {
      // Superseded by a newer request before this one's turn came up (the
      // user has since moved on) — no need to actually play it at all.
      if (latestRequestedUriRef.current !== uri) {
        console.debug("[play] superseded before sending", uri);
        return;
      }
      if (!deviceId) throw new Error("Player not ready yet");

      setPlaybackError(null);
      // Spotify's Connect "play" endpoint is known to be flaky (502/503/504,
      // or an outright network failure) right after a device connects or on
      // rapid track switches — worth a couple of retries before treating it
      // as real. A non-transient failure (bad auth, bad request, etc.) is
      // marked with PermanentPlaybackError below and always fails immediately.
      const MAX_ATTEMPTS = 4;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        if (latestRequestedUriRef.current !== uri) return;
        const isLastAttempt = attempt === MAX_ATTEMPTS;
        try {
          const accessToken = await fetchAccessToken();
          const res = await fetchWithTimeout(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ uris: [uri] }),
          });
          if (res.ok || res.status === 204) {
            console.debug("[play] Spotify accepted", uri, `attempt ${attempt}`);
            return;
          }

          const body = await res.text();
          console.debug("[play] Spotify rejected", uri, res.status, body.slice(0, 200));
          const message = `Failed to start playback: ${res.status} ${body}`;
          // Spotify answers 403 "Restriction violated" for a moment right
          // after a track finishes (exactly when autoplay fires), and 404
          // "Device not found" right after the SDK reports ready, before
          // Connect has registered the device — both go through on retry.
          const isTransient =
            TRANSIENT_STATUS_CODES.has(res.status) ||
            (res.status === 403 && body.includes("Restriction violated")) ||
            (res.status === 404 && body.includes("Device not found"));
          throw isTransient ? new Error(message) : new PermanentPlaybackError(message);
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

  useEffect(() => {
    playTrackRef.current = playTrack;
  }, [playTrack]);

  const togglePlay = useCallback(async () => {
    const deviceId = deviceIdRef.current;
    if (!deviceId) return;
    setPlaybackError(null);
    try {
      await spotifyPlayerCommand(isPaused ? "play" : "pause", deviceId);
    } catch (err) {
      setPlaybackError(err instanceof Error ? err.message : String(err));
    }
  }, [isPaused]);

  const seek = useCallback(async (positionMs: number) => {
    const deviceId = deviceIdRef.current;
    if (!deviceId) return;
    setPlaybackError(null);
    setPosition(positionMs); // optimistic — player_state_changed will correct it if this fails
    try {
      await spotifyPlayerCommand("seek", deviceId, { position_ms: String(Math.round(positionMs)) });
    } catch (err) {
      setPlaybackError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const setVolume = useCallback(async (v: number) => {
    await playerRef.current?.setVolume(v);
    setVolumeState(v);
  }, []);

  const onTrackEnd = useCallback((handler: ((uri: string) => void) | null) => {
    trackEndHandlerRef.current = handler;
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
        onTrackEnd,
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
