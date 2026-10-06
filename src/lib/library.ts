// Shared between /api/library and the views that read it.
import type { SpotifyPlaylist } from "@/lib/spotify/client";

// The place ID used for Liked Songs alongside playlist IDs.
export const LIKED_SONGS_ID = "liked";

// Lets Liked Songs be picked in a PlaylistPicker alongside real playlists.
export const LIKED_SONGS_PICKER_ENTRY: SpotifyPlaylist = {
  id: LIKED_SONGS_ID,
  name: "Liked Songs",
  images: [],
  owner: { id: "", display_name: null },
  collaborative: false,
  canModify: false,
};

export interface LibraryTrackDetails {
  name: string;
  artists: string[];
  image: string | null;
  isrc: string | null;
  durationMs: number;
}

// How much of the library is cached, and how current it is. "incomplete"
// entries have the right songs but were cached before album details were
// collected. Request counts estimate what bringing them current would cost.
export interface LibraryCoverage {
  playlists: {
    total: number;
    fresh: number;
    incomplete: number;
    changed: number;
    notScanned: number;
    requestsToUpdate: number;
    requestsToComplete: number;
  };
  // "unchecked": cached, but whether it's changed isn't known without asking.
  likedSongs: "fresh" | "incomplete" | "unchecked" | "notScanned" | "unreadable";
}

export type LibraryFetchMode = "none" | "update" | "complete";

export interface LibraryResponse {
  // uri -> details, sent once per track however many places it's in
  tracks: Record<string, LibraryTrackDetails>;
  // Liked Songs (if readable) and each editable playlist, as [uri, addedAt]
  places: { id: string; entries: [string, string][] }[];
  // "missing_scope" when the session predates the Liked Songs permission
  likedSongs: "ok" | "missing_scope";
  coverage: LibraryCoverage;
}
