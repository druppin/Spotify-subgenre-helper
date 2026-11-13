/*
 * How sparse or dense a song's mix is, from measurements of one minute of
 * the audio file (see localAudio.ts). Pure, so it's tested with `npm test`.
 */

/** The measurements of one file, all relative to the song's overall loudness. */
export interface AudioMeasures {
  // dB from typical loudness down to the quiet moments (median minus the
  // 10th percentile of 25 ms slices): deep dips mean space between hits.
  dipDb: number;
  // Share of 25 ms slices more than 6 dB below typical loudness.
  gapShare: number;
  // Loudness below 100 Hz and in 200-2000 Hz, in dB against the whole mix.
  subDb: number;
  midDb: number;
  // Spectral flatness, 0-1: higher means noisier, more filled-in sound.
  flatness: number;
}

export interface MixDensity extends AudioMeasures {
  // Higher is sparser; 0 is the middle of the drum and bass it was tuned on.
  sparseness: number;
  label: "sparse" | "medium" | "dense";
  // Sent with the numbers so the AI knows how far to trust them.
  meaning: string;
}

// Means and spreads of dipDb, subDb, midDb and flatness over 91 songs from
// the user's dark and neurofunk drum and bass playlists. Sparse mixes have
// deep dips and heavy sub, and less mid and noise. The combined score told
// those two playlists apart 74% of the time: a tendency, not a verdict.
const REFERENCE = [
  { key: "dipDb", mean: 7.95, sd: 3.353, sign: 1 },
  { key: "subDb", mean: -3.228, sd: 1.227, sign: 1 },
  { key: "midDb", mean: -6.405, sd: 1.565, sign: -1 },
  { key: "flatness", mean: 0.139, sd: 0.038, sign: -1 },
] as const;

const MEANING =
  "Measured from one minute of the user's own audio file. sparseness above 0 is sparser than typical drum and bass " +
  "(deep dips between hits, heavy sub, less midrange and noise), below 0 denser. Only a tie-breaker: when the " +
  "tags already point to one of two drum and bass styles, sparse leans rollers/minimal/deep and dense leans " +
  "neurofunk. It is right only about 3 times in 4 and many dense tracks are not neurofunk, so never add or " +
  "remove a style because of it alone, and ignore it outside drum and bass.";

export function mixDensity(measures: AudioMeasures): MixDensity {
  const sparseness = REFERENCE.reduce((sum, r) => sum + (r.sign * (measures[r.key] - r.mean)) / r.sd, 0);
  const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;
  return {
    dipDb: round(measures.dipDb, 1),
    gapShare: round(measures.gapShare, 2),
    subDb: round(measures.subDb, 1),
    midDb: round(measures.midDb, 1),
    flatness: round(measures.flatness, 3),
    sparseness: round(sparseness, 1),
    label: sparseness >= 1 ? "sparse" : sparseness <= -1 ? "dense" : "medium",
    meaning: MEANING,
  };
}

/** dipDb and gapShare from the loudness (dB) of consecutive short slices, or null if there are too few. */
export function dipsFromSlices(db: number[]): { dipDb: number; gapShare: number } | null {
  if (db.length < 100) return null;
  const sorted = [...db].sort((a, b) => a - b);
  const median = quantile(sorted, 0.5);
  return {
    dipDb: median - quantile(sorted, 0.1),
    gapShare: db.filter((x) => x < median - 6).length / db.length,
  };
}

// Linear interpolation between ranks (numpy's default).
function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (pos - lo);
}

/** The Spotify track ID in a file's SPOTIFY_ID tag (a bare ID, URI or link), or null. */
export function spotifyIdFromTag(value: string | undefined): string | null {
  return value?.match(/(?:^|track[:/])([0-9A-Za-z]{22})(?:$|[?\s])/)?.[1] ?? null;
}
