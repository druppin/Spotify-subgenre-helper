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
  // How sure the AI is of each subgenre, 0-100, keyed by the subgenre as it
  // was given. Missing from summaries made before scores were asked for.
  confidence?: Record<string, number>;
}

// A song's stored tags with how sure the AI is of them.
export interface StoredTags {
  // The song's own tags, then the broader genres they roll up into.
  own: string[];
  broader: string[];
  // The user changed the tags by hand.
  edited: boolean;
  // 0-100 per own tag, for the tags the AI has scored.
  confidence: Record<string, number>;
  // Own tags the user added, which the AI doesn't score.
  userTags: string[];
  // The average of the scored tags (the user's own count as 100), or null
  // if none are scored.
  songConfidence: number | null;
}

// A summary as the app shows it: subgenres are the stored tags (own, then
// the broader genres they belong to), which the user may have edited.
export interface ShownSummary extends Omit<TrackSummary, "confidence">, StoredTags {}
