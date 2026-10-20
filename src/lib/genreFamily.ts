/*
 * The six genre families the app colours tags and playlists by, like the
 * card-stock dividers in a record shop. A genre's family comes from words in
 * its name (with the broader genres it rolls up into as a fallback); the
 * colours themselves live in globals.css (--fam-*), per theme.
 */

export type GenreFamily = "house" | "bass" | "rock" | "pop" | "hiphop" | "roots" | "none";

export const FAMILY_NAMES: Record<GenreFamily, string> = {
  house: "House and techno",
  bass: "Bass music",
  rock: "Rock, punk and metal",
  pop: "Pop, disco and soul",
  hiphop: "Hip hop and R&B",
  roots: "Folk, jazz and roots",
  none: "Other",
};

// Checked in order, so "bass house" is bass music and "pop punk" is punk.
const RULES: [GenreFamily, RegExp][] = [
  ["bass", /\b(drum (and|&|'?n'?) bass|dnb|jungle|dubstep|riddim|bass|breakbeat|breaks|neurofunk|liquid|garage|grime)\b/],
  ["hiphop", /\b(hip[ -]?hop|rap|trap|drill|r ?(and|&|'?n'?) ?b|rnb|boom bap|phonk)\b/],
  ["rock", /(rock|punk|metal|grunge|emo|shoegaze|hardcore|post-punk|sludge|doom|djent|indie)/],
  ["pop", /(pop|disco|funk|soul|new wave|synth|motown|dance|eurobeat|city)/],
  ["house", /(house|techno|trance|electro|edm|electronic|minimal|idm|ambient|hardstyle|gabber|rave|downtempo|chillwave|club)/],
  ["roots", /(folk|country|jazz|blues|reggae|ska|dub|classical|acoustic|singer-songwriter|latin|bossa|americana|bluegrass|world|gospel)/],
];

function match(genre: string): GenreFamily | null {
  const g = genre.toLowerCase();
  for (const [family, pattern] of RULES) if (pattern.test(g)) return family;
  return null;
}

/** The family of one genre, or of the first broader genre that has one. */
export function familyOf(genre: string, broader: string[] = []): GenreFamily {
  return match(genre) ?? broader.map(match).find((f): f is GenreFamily => f !== null) ?? "none";
}

/** The family most of these genres belong to (ties go to the first seen). */
export function dominantFamily(genres: string[]): GenreFamily {
  const counts = new Map<GenreFamily, number>();
  for (const genre of genres) {
    const family = match(genre);
    if (family) counts.set(family, (counts.get(family) ?? 0) + 1);
  }
  let best: GenreFamily = "none";
  let bestCount = 0;
  for (const [family, count] of counts) {
    if (count > bestCount) [best, bestCount] = [family, count];
  }
  return best;
}

/** The card-stock colour (divider tabs; dark text sits on it in both themes). */
export function familyTab(family: GenreFamily): string {
  return `var(--fam-${family})`;
}

/** The mark colour (dots and confidence bars), darker in light mode. */
export function familyMark(family: GenreFamily): string {
  return `var(--fam-${family}-mark)`;
}
