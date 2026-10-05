// Shared between /api/library and the views that read it.

// The place ID used for Liked Songs alongside playlist IDs.
export const LIKED_SONGS_ID = "liked";

export interface LibraryTrackDetails {
  name: string;
  artists: string[];
  image: string | null;
  isrc: string | null;
  durationMs: number;
}

export interface LibraryResponse {
  // uri -> details, sent once per track however many places it's in
  tracks: Record<string, LibraryTrackDetails>;
  // Liked Songs (if readable) and each editable playlist, as [uri, addedAt]
  places: { id: string; entries: [string, string][] }[];
  // "missing_scope" when the session predates the Liked Songs permission
  likedSongs: "ok" | "missing_scope";
}
