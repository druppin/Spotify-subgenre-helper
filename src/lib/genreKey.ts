// LLMs mix in non-breaking hyphens/spaces and inconsistent case, which
// would split one genre into several when counting.
export function normalizeGenre(genre: string): string {
  return genre
    .replace(/[‐-―]/g, "-")
    .replace(/[  ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Abbreviations and symbols that name the same thing, applied before
// comparing (the shown spelling is still one the AI actually used).
const GENRE_ALIASES: [RegExp, string][] = [
  [/&/g, " and "], // drum & bass, r&b
  [/\s'?n'?\s/g, " and "], // drum 'n' bass, rock n roll
  [/\b(dnb|d and b)\b/g, "drum and bass"],
  [/\brnb\b/g, "r and b"],
  [/\balt\b/g, "alternative"], // alt rock, alt-rock
  [/\bpsych\b/g, "psychedelic"], // psych rock, psych-pop
];

// Spellings that differ only by hyphens or spaces ("pop-punk", "pop punk",
// "synthpop" / "synth-pop") or by an alias above are one genre and share
// a key. Expects a normalized genre.
export function genreKey(genre: string): string {
  return aliased(genre).replace(/[-\s]/g, "");
}

/** A normalized genre's words, aliases spelled out: "post-dubstep" → post, dubstep. */
export function genreWords(genre: string): string[] {
  return aliased(genre).split(/[-\s]+/).filter(Boolean);
}

function aliased(genre: string): string {
  let out = genre;
  for (const [pattern, replacement] of GENRE_ALIASES) out = out.replace(pattern, replacement);
  return out;
}
