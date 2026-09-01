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
  popularity: number;
  artistGenres: string[];
  lastfmTrackTags: string[];
  lastfmArtistTags: string[];
  lastfmArtistBio: string | null;
  audioFeatures: import("@/lib/apify").AudioFeatures | null;
}

export interface TrackSummary {
  moodVibe: string;
  subgenres: string[];
  rationale: string;
}
