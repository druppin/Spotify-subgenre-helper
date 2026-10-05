import { fetchWithTimeout } from "@/lib/fetchWithTimeout";

const API_BASE = "https://api.spotify.com/v1";

export interface SpotifyImage {
  url: string;
  width: number | null;
  height: number | null;
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  images: SpotifyImage[];
  // Spotify's Feb 2026 migration renamed the playlist object's track-count
  // field from "tracks" to "items"; we normalize back to "tracks" at the
  // client boundary (see getUserPlaylists) so the rest of the app doesn't
  // have to know about that rename. Still optional: Spotify omits it for
  // some playlists (e.g. ones you can only partially see) even when the
  // playlist entry itself is otherwise present.
  tracks?: { total: number };
  owner: { id: string; display_name: string | null };
  collaborative: boolean;
  // Not a raw Spotify field — computed in getUserPlaylists() from
  // owner.id/collaborative vs. the current user, so callers don't each
  // have to know the "own or collaborate" rule for which playlists accept
  // track adds (see getPlaylistTracks's note on the same restriction).
  canModify: boolean;
  // Changes whenever the playlist's contents change.
  snapshot_id?: string;
}

export interface SpotifyArtist {
  id: string;
  name: string;
  genres?: string[];
}

export interface SpotifyTrack {
  id: string;
  uri: string;
  name: string;
  artists: SpotifyArtist[];
  album: { id: string; name: string; images: SpotifyImage[]; release_date: string };
  duration_ms: number;
  // Removed from the Track object entirely by Spotify's Feb 2026 migration —
  // kept optional so a leftover request for it just quietly comes back empty
  // rather than lying about always being present.
  popularity?: number;
  explicit: boolean;
}

export interface SpotifyPlaylistTrackItem {
  added_at: string;
  track: SpotifyTrack | null;
}

// One entry of a playlist or Liked Songs, trimmed to what library-wide views
// (the playlist index, the lost tracks finder) need to show it.
export interface LibraryTrack {
  uri: string;
  name: string;
  artists: string[];
  // Smallest album image, for a thumbnail.
  image: string | null;
  // Recording code: a single and its album re-release usually share it.
  isrc: string | null;
  durationMs: number;
  addedAt: string;
}

interface RawLibraryTrack {
  uri: string;
  name: string;
  duration_ms?: number;
  external_ids?: { isrc?: string };
  artists: { name: string }[];
  album?: { images?: SpotifyImage[] };
}

function toLibraryTrack(raw: RawLibraryTrack, addedAt: string): LibraryTrack {
  const images = raw.album?.images ?? [];
  return {
    uri: raw.uri,
    name: raw.name,
    artists: raw.artists.map((a) => a.name),
    image: images[images.length - 1]?.url ?? null,
    isrc: raw.external_ids?.isrc?.toUpperCase() ?? null,
    durationMs: raw.duration_ms ?? 0,
    addedAt,
  };
}

// Spotify's Feb 2026 migration renamed /playlists/{id}/tracks to
// /playlists/{id}/items and, within it, each entry's "track" field to
// "item". These describe the raw wire shape; getUserPlaylists() and
// getPlaylistTracks() normalize back to our stable SpotifyPlaylist /
// SpotifyPlaylistTrackItem shapes above so the rest of the app is
// insulated from that rename.
interface RawSpotifyPlaylist extends Omit<SpotifyPlaylist, "tracks" | "canModify"> {
  items?: { total: number };
}
interface RawSpotifyPlaylistItem {
  added_at: string;
  item: SpotifyTrack | null;
}

export class SpotifyApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "SpotifyApiError";
  }
}

const TRANSIENT_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
// Spotify can answer a 429 with a Retry-After of minutes or hours. Waiting
// that out silently looks like a hang, so longer waits fail instead.
const MAX_RETRY_WAIT_MS = 30_000;

function formatWait(ms: number): string {
  const minutes = Math.ceil(ms / 60_000);
  if (ms < 60_000) return `${Math.ceil(ms / 1000)} seconds`;
  if (minutes < 120) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  return `${Math.round(minutes / 60)} hours`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class SpotifyClient {
  // Called before sleeping out a rate limit, so long-running callers can
  // show that they're waiting rather than stuck.
  onRateLimitWait?: (waitMs: number) => void;

  constructor(private accessToken: string) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    // Spotify's per-app rate limit (and the occasional 5xx) is easy to hit
    // once a track summary fires off several requests at once (track +
    // per-artist fetches) — retry transient failures a few times, honoring
    // Retry-After on a 429 rather than guessing at a backoff. A short
    // per-attempt timeout (Spotify is normally sub-second) keeps the worst
    // case bounded — a track summary chains this behind an LLM call too,
    // and the client that's waiting on the whole thing has its own ceiling.
    const MAX_ATTEMPTS = 3;
    const TIMEOUT_MS = 8_000;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const isLastAttempt = attempt === MAX_ATTEMPTS;
      let res: Response;
      try {
        res = await fetchWithTimeout(
          `${API_BASE}${path}`,
          {
            ...init,
            headers: {
              Authorization: `Bearer ${this.accessToken}`,
              "Content-Type": "application/json",
              ...init?.headers,
            },
          },
          TIMEOUT_MS
        );
      } catch (err) {
        // Network error or our own timeout — treat the same as a transient
        // HTTP failure rather than letting a single stalled request kill
        // the whole call outright.
        if (isLastAttempt) throw err;
        await sleep(500 * attempt);
        continue;
      }

      if (res.ok) return this.parseResponse<T>(res);

      if (TRANSIENT_STATUS_CODES.has(res.status) && !isLastAttempt) {
        const retryAfterHeader = res.headers.get("Retry-After");
        const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : NaN;
        const waitMs = Number.isFinite(retryAfterMs) ? retryAfterMs : 500 * attempt;
        if (res.status === 429) {
          if (waitMs > MAX_RETRY_WAIT_MS) {
            console.warn(`Spotify rate limit on ${path}: asked to wait ${formatWait(waitMs)}; giving up`);
            throw new SpotifyApiError(
              429,
              `Spotify is rate-limiting this app and asked to wait ${formatWait(waitMs)} before trying again.`
            );
          }
          console.warn(`Spotify rate limit on ${path}: waiting ${formatWait(waitMs)}`);
          this.onRateLimitWait?.(waitMs);
        }
        await sleep(waitMs);
        continue;
      }

      const body = await res.text();
      throw new SpotifyApiError(res.status, `Spotify API ${path} failed: ${res.status} ${body}`);
    }
    throw new Error("unreachable");
  }

  private async parseResponse<T>(res: Response): Promise<T> {
    if (res.status === 204) return undefined as T;
    return res.json();
  }

  getCurrentUser() {
    return this.request<{ id: string; display_name: string | null }>("/me");
  }

  async getUserPlaylists(): Promise<SpotifyPlaylist[]> {
    const [currentUser, rawPlaylists] = await Promise.all([
      this.getCurrentUser(),
      (async () => {
        const raw: RawSpotifyPlaylist[] = [];
        let url: string | null = "/me/playlists?limit=50";
        while (url) {
          const page: { items: (RawSpotifyPlaylist | null)[]; next: string | null } =
            await this.request(url);
          // /me/playlists can include null entries for playlists that became
          // inaccessible (deleted, region-locked, etc.) — drop those.
          raw.push(...page.items.filter((item): item is RawSpotifyPlaylist => item !== null));
          url = page.next ? page.next.replace(API_BASE, "") : null;
        }
        return raw;
      })(),
    ]);

    return rawPlaylists.map((raw) => {
      const { items, ...rest } = raw;
      return {
        ...rest,
        tracks: items,
        canModify: raw.owner.id === currentUser.id || raw.collaborative,
      };
    });
  }

  // NOTE: as of Spotify's Feb 2026 API migration, this only returns track
  // data for playlists the authenticated user owns or collaborates on —
  // playlists you just follow (including other users' or Spotify's own)
  // now 403 here even though they still show up in getUserPlaylists().
  async getPlaylistTracks(playlistId: string): Promise<SpotifyPlaylistTrackItem[]> {
    const items: SpotifyPlaylistTrackItem[] = [];
    let url: string | null =
      `/playlists/${playlistId}/items?limit=100&fields=` +
      encodeURIComponent(
        "next,items(added_at,item(id,uri,name,artists(id,name),album(id,name,images,release_date),duration_ms,explicit))"
      );
    while (url) {
      const page: { items: RawSpotifyPlaylistItem[]; next: string | null } = await this.request(url);
      items.push(...page.items.map((raw) => ({ added_at: raw.added_at, track: raw.item })));
      url = page.next ? page.next.replace(API_BASE, "") : null;
    }
    return items;
  }

  async getPlaylistLibraryTracks(playlistId: string): Promise<LibraryTrack[]> {
    const tracks: LibraryTrack[] = [];
    let url: string | null =
      `/playlists/${playlistId}/items?limit=100&fields=` +
      encodeURIComponent(
        "next,items(added_at,item(uri,name,duration_ms,external_ids(isrc),artists(name),album(images)))"
      );
    while (url) {
      const page: { items: { added_at: string; item: RawLibraryTrack | null }[]; next: string | null } =
        await this.request(url);
      for (const raw of page.items) if (raw.item?.uri) tracks.push(toLibraryTrack(raw.item, raw.added_at));
      url = page.next ? page.next.replace(API_BASE, "") : null;
    }
    return tracks;
  }

  // Liked Songs entries use "track" for the item; accept "item" too in case
  // the Feb 2026 rename (see RawSpotifyPlaylistItem) reaches this endpoint.
  async getLikedTracks(onPage?: (fetched: number, total: number) => void): Promise<LibraryTrack[]> {
    type Page = {
      items: { added_at: string; track?: RawLibraryTrack | null; item?: RawLibraryTrack | null }[];
      next: string | null;
      total: number;
    };
    const tracks: LibraryTrack[] = [];
    let url: string | null = "/me/tracks?limit=50";
    while (url) {
      const page: Page = await this.request(url);
      for (const raw of page.items) {
        const track = raw.track ?? raw.item;
        if (track?.uri) tracks.push(toLibraryTrack(track, raw.added_at));
      }
      onPage?.(tracks.length, page.total);
      url = page.next ? page.next.replace(API_BASE, "") : null;
    }
    return tracks;
  }

  // Liked Songs has no snapshot_id; its size plus its newest entry changes
  // whenever a track is liked or unliked, which is close enough to tell
  // when a cached copy is stale.
  async getLikedTracksMarker(): Promise<string> {
    const page = await this.request<{
      total: number;
      items: { added_at: string; track?: { uri: string } | null; item?: { uri: string } | null }[];
    }>("/me/tracks?limit=1");
    const newest = page.items[0];
    return `${page.total}:${newest?.added_at ?? ""}:${(newest?.track ?? newest?.item)?.uri ?? ""}`;
  }

  getTrack(trackId: string) {
    return this.request<SpotifyTrack>(`/tracks/${trackId}`);
  }

  // Spotify's Feb 2026 migration removed the batch GET /artists?ids=... —
  // "fetch items individually instead" is their own guidance, so that's
  // what this does now.
  getArtists(artistIds: string[]): Promise<SpotifyArtist[]> {
    return Promise.all(artistIds.map((id) => this.request<SpotifyArtist>(`/artists/${id}`)));
  }

  async createPlaylist(options: {
    name: string;
    description: string;
    isPublic: boolean;
    collaborative: boolean;
  }): Promise<SpotifyPlaylist> {
    const raw = await this.request<RawSpotifyPlaylist>("/me/playlists", {
      method: "POST",
      body: JSON.stringify({
        name: options.name,
        description: options.description,
        // Spotify rejects collaborative playlists that are also public.
        public: options.collaborative ? false : options.isPublic,
        collaborative: options.collaborative,
      }),
    });
    const { items, ...rest } = raw;
    return { ...rest, images: rest.images ?? [], tracks: items ?? { total: 0 }, canModify: true };
  }

  addTrackToPlaylist(playlistId: string, trackUri: string) {
    return this.request(`/playlists/${playlistId}/items`, {
      method: "POST",
      body: JSON.stringify({ uris: [trackUri] }),
    });
  }

  async addTracksToPlaylist(playlistId: string, trackUris: string[]) {
    // Spotify takes at most 100 URIs per request.
    for (let i = 0; i < trackUris.length; i += 100) {
      await this.request(`/playlists/${playlistId}/items`, {
        method: "POST",
        body: JSON.stringify({ uris: trackUris.slice(i, i + 100) }),
      });
    }
  }

  removeTrackFromPlaylist(playlistId: string, trackUri: string) {
    return this.request(`/playlists/${playlistId}/items`, {
      method: "DELETE",
      body: JSON.stringify({ items: [{ uri: trackUri }] }),
    });
  }
}
