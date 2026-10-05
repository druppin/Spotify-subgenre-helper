import type { LibraryTrackDetails } from "@/lib/library";

// Two releases closer in length than this are taken to be the same
// recording; a radio edit vs. an extended mix is well outside it.
const SAME_RECORDING_MAX_DIFF_MS = 3_000;

const VERSION_TAG = /\b(remaster(ed)?|single version|album version|mono|stereo|explicit|clean)\b/;

/**
 * Lowercased title without featured-artist credits or tags that only mark a
 * re-release ("Remastered 2011", "Single Version"). Mix/edit/remix names are
 * kept, since those are usually different recordings.
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s*[([]\s*(feat\.?|ft\.?|featuring|with)\s[^)\]]*[)\]]/g, "")
    .replace(/\s*[([]([^)\]]*)[)\]]/g, (whole, inner: string) => (VERSION_TAG.test(inner) ? "" : whole))
    .replace(/\s+-\s+(.*)$/, (whole, tail: string) => (VERSION_TAG.test(tail) ? "" : whole))
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Groups track URIs that are the same song released more than once (e.g. a
 * single later re-released on an album): same ISRC, or same normalized title
 * and lead artist with near-identical length. Returns uri -> song ID, where
 * the song ID is one of the group's URIs.
 */
export function groupSongs(tracks: Record<string, LibraryTrackDetails>): Map<string, string> {
  const parent = new Map<string, string>();
  const find = (uri: string): string => {
    let root = uri;
    while (parent.get(root) !== root) root = parent.get(root)!;
    // Path compression keeps later lookups flat.
    for (let node = uri; node !== root; ) {
      const next = parent.get(node)!;
      parent.set(node, root);
      node = next;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
  };

  const byIsrc = new Map<string, string>();
  const byTitle = new Map<string, { uri: string; durationMs: number }[]>();
  for (const [uri, details] of Object.entries(tracks)) {
    parent.set(uri, uri);
    if (details.isrc) {
      const first = byIsrc.get(details.isrc);
      if (first) union(first, uri);
      else byIsrc.set(details.isrc, uri);
    }
    const key = `${normalizeTitle(details.name)}|${(details.artists[0] ?? "").toLowerCase()}`;
    const bucket = byTitle.get(key);
    if (bucket) bucket.push({ uri, durationMs: details.durationMs });
    else byTitle.set(key, [{ uri, durationMs: details.durationMs }]);
  }

  for (const bucket of byTitle.values()) {
    if (bucket.length < 2) continue;
    bucket.sort((a, b) => a.durationMs - b.durationMs);
    for (let i = 1; i < bucket.length; i++) {
      const prev = bucket[i - 1];
      const cur = bucket[i];
      if (prev.durationMs > 0 && cur.durationMs - prev.durationMs <= SAME_RECORDING_MAX_DIFF_MS) {
        union(prev.uri, cur.uri);
      }
    }
  }

  const songOf = new Map<string, string>();
  for (const uri of parent.keys()) songOf.set(uri, find(uri));
  return songOf;
}
