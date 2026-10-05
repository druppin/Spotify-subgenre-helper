export interface PlaylistGenreTrack {
  id: string;
  name: string;
  artists: string[];
  // null when no genre info has been generated for this track yet.
  subgenres: string[] | null;
}

export async function fetchPlaylistGenres(playlistId: string): Promise<PlaylistGenreTrack[]> {
  const res = await fetch(`/api/playlists/${playlistId}/genres`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `Failed to load playlist genres (${res.status})`);
  return body.tracks;
}

export interface GenreCount {
  genre: string;
  tracks: number;
}

// Counts each genre once per track (a playlist that lists the same track
// twice counts it twice, matching what you'd hear playing it through).
export function summarizeGenres(tracks: PlaylistGenreTrack[]): {
  counts: GenreCount[];
  withInfo: number;
} {
  const counts = new Map<string, number>();
  let withInfo = 0;
  for (const track of tracks) {
    if (!track.subgenres) continue;
    withInfo++;
    for (const genre of new Set(track.subgenres)) counts.set(genre, (counts.get(genre) ?? 0) + 1);
  }
  return {
    counts: [...counts]
      .map(([genre, n]) => ({ genre, tracks: n }))
      .sort((a, b) => b.tracks - a.tracks || a.genre.localeCompare(b.genre)),
    withInfo,
  };
}
