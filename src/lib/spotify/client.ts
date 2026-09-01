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
  tracks: { total: number };
  owner: { display_name: string | null };
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
  popularity: number;
  explicit: boolean;
}

export interface SpotifyPlaylistTrackItem {
  added_at: string;
  track: SpotifyTrack | null;
}

class SpotifyApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "SpotifyApiError";
  }
}

export class SpotifyClient {
  constructor(private accessToken: string) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new SpotifyApiError(res.status, `Spotify API ${path} failed: ${res.status} ${body}`);
    }
    if (res.status === 204) return undefined as T;
    return res.json();
  }

  getCurrentUser() {
    return this.request<{ id: string; display_name: string | null; product: string }>("/me");
  }

  async getUserPlaylists(): Promise<SpotifyPlaylist[]> {
    const playlists: SpotifyPlaylist[] = [];
    let url: string | null = "/me/playlists?limit=50";
    while (url) {
      const page: { items: (SpotifyPlaylist | null)[]; next: string | null } =
        await this.request(url);
      // /me/playlists can include null entries for playlists that became
      // inaccessible (deleted, region-locked, etc.) — drop those.
      playlists.push(...page.items.filter((item): item is SpotifyPlaylist => item !== null));
      url = page.next ? page.next.replace(API_BASE, "") : null;
    }
    return playlists;
  }

  async getPlaylistTracks(playlistId: string): Promise<SpotifyPlaylistTrackItem[]> {
    const items: SpotifyPlaylistTrackItem[] = [];
    let url: string | null =
      `/playlists/${playlistId}/tracks?limit=100&fields=` +
      encodeURIComponent(
        "next,items(added_at,track(id,uri,name,artists(id,name),album(id,name,images,release_date),duration_ms,popularity,explicit))"
      );
    while (url) {
      const page: { items: SpotifyPlaylistTrackItem[]; next: string | null } = await this.request(url);
      items.push(...page.items);
      url = page.next ? page.next.replace(API_BASE, "") : null;
    }
    return items;
  }

  getTrack(trackId: string) {
    return this.request<SpotifyTrack>(`/tracks/${trackId}`);
  }

  async getArtists(artistIds: string[]): Promise<SpotifyArtist[]> {
    if (artistIds.length === 0) return [];
    const artists: SpotifyArtist[] = [];
    for (let i = 0; i < artistIds.length; i += 50) {
      const batch = artistIds.slice(i, i + 50);
      const page = await this.request<{ artists: SpotifyArtist[] }>(
        `/artists?ids=${batch.join(",")}`
      );
      artists.push(...page.artists);
    }
    return artists;
  }

  addTrackToPlaylist(playlistId: string, trackUri: string) {
    return this.request(`/playlists/${playlistId}/tracks`, {
      method: "POST",
      body: JSON.stringify({ uris: [trackUri] }),
    });
  }

  removeTrackFromPlaylist(playlistId: string, trackUri: string) {
    return this.request(`/playlists/${playlistId}/tracks`, {
      method: "DELETE",
      body: JSON.stringify({ tracks: [{ uri: trackUri }] }),
    });
  }
}
