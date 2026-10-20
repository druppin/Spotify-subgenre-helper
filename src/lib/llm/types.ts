export type LlmProvider = "openai" | "anthropic" | "google" | "groq" | "openrouter";

export interface LlmConfig {
  provider: LlmProvider;
  apiKey: string;
  model: string;
}

export interface TrackContext {
  trackId: string;
  trackName: string;
  artistNames: string[];
  albumName: string;
  releaseDate: string;
  artistGenres: string[];
  lastfmTrackTags: string[];
  lastfmArtistTags: string[];
  lastfmArtistBio: string | null;
  musicbrainz: import("@/lib/musicbrainz").MusicBrainzInfo;
  audioFeatures: import("@/lib/reccobeats").AudioFeatures | null;
}

export interface TrackSummary {
  moodVibe: string;
  subgenres: string[];
  rationale: string;
}

// A summary as the app shows it: subgenres are the stored tags (own, then
// the broader genres they belong to), which the user may have edited.
export interface ShownSummary extends TrackSummary {
  own: string[];
  broader: string[];
  edited: boolean;
}
