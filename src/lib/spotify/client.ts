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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class SpotifyClient {
  constructor(private accessToken: string) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    // Spotify's per-app rate limit (and the occasional 5xx) is easy to hit
    // once a track summary fires off several requests at once (track +
    // per-artist fetches) — retry transient failures a few times, honoring
    // Retry-After on a 429 rather than guessing at a backoff.
    const MAX_ATTEMPTS = 4;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const isLastAttempt = attempt === MAX_ATTEMPTS;
      let res: Response;
      try {
        res = await fetchWithTimeout(`${API_BASE}${path}`, {
          ...init,
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            "Content-Type": "application/json",
            ...init?.headers,
          },
        });
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
        await sleep(Number.isFinite(retryAfterMs) ? retryAfterMs : 500 * attempt);
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

  getTrack(trackId: string) {
    return this.request<SpotifyTrack>(`/tracks/${trackId}`);
  }

  // Spotify's Feb 2026 migration removed the batch GET /artists?ids=... —
  // "fetch items individually instead" is their own guidance, so that's
  // what this does now.
  getArtists(artistIds: string[]): Promise<SpotifyArtist[]> {
    return Promise.all(artistIds.map((id) => this.request<SpotifyArtist>(`/artists/${id}`)));
  }

  addTrackToPlaylist(playlistId: string, trackUri: string) {
    return this.request(`/playlists/${playlistId}/items`, {
      method: "POST",
      body: JSON.stringify({ uris: [trackUri] }),
    });
  }

  removeTrackFromPlaylist(playlistId: string, trackUri: string) {
    return this.request(`/playlists/${playlistId}/items`, {
      method: "DELETE",
      body: JSON.stringify({ items: [{ uri: trackUri }] }),
    });
  }
}
