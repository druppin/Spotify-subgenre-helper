/*
 * Which of the user's playlists a song sounds like, from an audio model's
 * embedding of the user's own file (see localAudio.ts). The model is
 * Discogs-EffNet (MTG, Universitat Pompeu Fabra): it turns 16 kHz mono
 * audio, as mel spectrogram patches, into 1280 numbers per patch, averaged
 * over the song. Songs that sound alike get similar numbers. Pure, so it's
 * tested with `npm test`.
 */

export const EMBEDDING_SIZE = 1280;
const SAMPLE_RATE = 16000;
const FRAME = 512;
const HOP = 256;
const BANDS = 96;
// Frames per patch, and frames between patch starts, as Essentia feeds the model.
export const PATCH_FRAMES = 128;
const PATCH_HOP = 62;
export const PATCH_SIZE = PATCH_FRAMES * BANDS;
// How many of the most alike songs vote. Tested against 20, and against a
// model trained per playlist, which did no better than 1-2 points.
const NEIGHBOURS = 10;

export interface SoundsLike {
  // Playlists holding more of the song's 10 closest-sounding songs than
  // chance, most above chance first: songs is how many of the 10 each
  // holds (a song can be in several), typical how many 10 songs picked at
  // random would. Catch-all playlists hold many by chance alone.
  playlists: { name: string; songs: number; typical: number }[];
  // Sent with the numbers so the AI knows how far to trust them.
  meaning: string;
}

const MEANING =
  "From the user's own audio file: an audio model (Discogs-EffNet) found the 10 songs in the user's playlists that " +
  "sound most like this one. songs is how many of those 10 are in each playlist (a song can be in several), and " +
  "typical how many 10 random songs from the user's playlists would be, so broad catch-all playlists score high by " +
  "chance; playlists are listed by how far songs beats typical. In tests on this library the playlist with the most " +
  "of the 10 was the right one about 3 times in 4, and the right one was in " +
  "the top two about 9 times in 10, across drum and bass, house, dubstep, techno and hardstyle. It is weakest " +
  "between close styles (dark vs neurofunk drum and bass, deep vs progressive house) and where the user's own " +
  "playlists overlap. The names are the user's playlists, not genres: use it as evidence about the sound, " +
  "alongside the tags, not as a verdict.";

// Slaney's mel scale: linear below 1 kHz, logarithmic above.
const hzToMel = (hz: number) => (hz >= 1000 ? 15 + Math.log(hz / 1000) / (Math.log(6.4) / 27) : hz / (200 / 3));
const melToHz = (mel: number) => (mel >= 15 ? 1000 * Math.exp(((mel - 15) * Math.log(6.4)) / 27) : (mel * 200) / 3);

// 96 triangles of equal area spaced evenly in mel from 0 to 8 kHz, over the
// 257 bins of a 512-point spectrum. Matches Essentia's MelBands with
// slaneyMel warping and unit_tri normalisation. Each keeps only the bins it
// covers, from `first`.
const FILTERS = (() => {
  const edges = Array.from({ length: BANDS + 2 }, (_, i) => melToHz((hzToMel(SAMPLE_RATE / 2) * i) / (BANDS + 1)));
  return Array.from({ length: BANDS }, (_, b) => {
    const [lo, mid, hi] = edges.slice(b, b + 3);
    const weights = Array.from({ length: FRAME / 2 + 1 }, (_, k) => {
      const hz = (k * SAMPLE_RATE) / FRAME;
      return Math.max(0, Math.min((hz - lo) / (mid - lo), (hi - hz) / (hi - mid))) * (2 / (hi - lo));
    });
    const first = weights.findIndex((w) => w > 0);
    const last = weights.findLastIndex((w) => w > 0);
    return first < 0 ? { first: 0, weights: new Float64Array() } : { first, weights: Float64Array.from(weights.slice(first, last + 1)) };
  });
})();
// Symmetric Hann window, as Essentia's.
const WINDOW = Float64Array.from({ length: FRAME }, (_, n) => 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (FRAME - 1)));

/** The model's input for one 512-sample frame: log-compressed mel band power. */
export function melFrame(samples: ArrayLike<number>): Float32Array {
  const re = Float64Array.from(WINDOW, (w, i) => w * (samples[i] ?? 0));
  const power = powerSpectrum(re);
  return Float32Array.from(FILTERS, ({ first, weights }) => {
    let sum = 0;
    for (let k = 0; k < weights.length; k++) sum += weights[k] * power[first + k];
    return Math.log10(1 + 10000 * sum);
  });
}

/**
 * Every whole patch of a song's 16 kHz mono audio, back to back
 * (patches x 128 frames x 96 bands). Frames are centred on every 256th
 * sample from the first, as Essentia's FrameCutter does.
 */
export function melPatches(pcm: Float32Array): { data: Float32Array; count: number } {
  const frameCount = Math.floor(pcm.length / HOP) + 1;
  const frames = new Float32Array(frameCount * BANDS);
  const window = new Float32Array(FRAME);
  for (let f = 0; f < frameCount; f++) {
    const start = f * HOP - FRAME / 2;
    for (let i = 0; i < FRAME; i++) window[i] = pcm[start + i] ?? 0;
    frames.set(melFrame(window), f * BANDS);
  }
  const count = frameCount < PATCH_FRAMES ? 0 : Math.floor((frameCount - PATCH_FRAMES) / PATCH_HOP) + 1;
  const data = new Float32Array(count * PATCH_SIZE);
  for (let p = 0; p < count; p++) data.set(frames.subarray(p * PATCH_HOP * BANDS, (p * PATCH_HOP + PATCH_FRAMES) * BANDS), p * PATCH_SIZE);
  return { data, count };
}

const COS = Float64Array.from({ length: FRAME / 2 }, (_, k) => Math.cos((-2 * Math.PI * k) / FRAME));
const SIN = Float64Array.from({ length: FRAME / 2 }, (_, k) => Math.sin((-2 * Math.PI * k) / FRAME));

// In-place radix-2 FFT of a 512-sample frame, returning |X[k]|^2 for k = 0..256.
function powerSpectrum(re: Float64Array): Float64Array {
  const n = FRAME;
  const im = new Float64Array(n);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [re[i], re[j]] = [re[j], re[i]];
  }
  for (let len = 2; len <= n; len <<= 1) {
    const step = n / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = COS[k * step];
        const wi = SIN[k * step];
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
  return Float64Array.from({ length: n / 2 + 1 }, (_, k) => re[k] * re[k] + im[k] * im[k]);
}

/**
 * The playlists of the 10 songs that sound most like `target`, by cosine
 * similarity after scaling each of the 1280 numbers to the library's own
 * spread. Null when fewer than 10 songs are in playlists.
 */
export function soundsLike(target: Float32Array, library: { embedding: Float32Array; playlists: string[] }[]): SoundsLike | null {
  if (library.length < NEIGHBOURS) return null;
  const mean = new Float64Array(EMBEDDING_SIZE);
  const sd = new Float64Array(EMBEDDING_SIZE);
  for (const { embedding } of library) for (let i = 0; i < EMBEDDING_SIZE; i++) mean[i] += embedding[i] / library.length;
  for (const { embedding } of library) for (let i = 0; i < EMBEDDING_SIZE; i++) sd[i] += (embedding[i] - mean[i]) ** 2 / library.length;
  for (let i = 0; i < EMBEDDING_SIZE; i++) sd[i] = Math.sqrt(sd[i]) || 1;
  const scaled = (e: Float32Array) => {
    const z = Float64Array.from({ length: EMBEDDING_SIZE }, (_, i) => (e[i] - mean[i]) / sd[i]);
    const norm = Math.hypot(...z) || 1;
    return z.map((x) => x / norm);
  };
  const t = scaled(target);
  const nearest = library
    .map((song) => {
      const s = scaled(song.embedding);
      let dot = 0;
      for (let i = 0; i < EMBEDDING_SIZE; i++) dot += t[i] * s[i];
      return { dot, playlists: song.playlists };
    })
    .sort((a, b) => b.dot - a.dot)
    .slice(0, NEIGHBOURS);
  const count = (songs: { playlists: string[] }[]) => {
    const counts = new Map<string, number>();
    for (const song of songs) for (const name of new Set(song.playlists)) counts.set(name, (counts.get(name) ?? 0) + 1);
    return counts;
  };
  const sizes = count(library);
  const playlists = [...count(nearest)]
    .map(([name, songs]) => ({ name, songs, typical: Math.round((NEIGHBOURS * sizes.get(name)!) / library.length * 10) / 10 }))
    // One song is too few to tell from chance.
    .filter((p) => p.songs >= 2 && p.songs > p.typical)
    .sort((a, b) => b.songs - b.typical - (a.songs - a.typical) || a.name.localeCompare(b.name))
    .slice(0, 4);
  return { playlists, meaning: MEANING };
}
