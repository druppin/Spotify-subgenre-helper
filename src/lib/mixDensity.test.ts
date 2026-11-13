import { test } from "node:test";
import assert from "node:assert/strict";
import { dipsFromSlices, mixDensity, spotifyIdFromTag } from "./mixDensity.ts";

test("the reference means score 0, medium; sparser numbers score higher", () => {
  const typical = { dipDb: 7.95, gapShare: 0.1, subDb: -3.228, midDb: -6.405, flatness: 0.139 };
  assert.equal(mixDensity(typical).sparseness, 0);
  assert.equal(mixDensity(typical).label, "medium");
  const sparse = mixDensity({ ...typical, dipDb: 14, subDb: -2, midDb: -8, flatness: 0.1 });
  assert.equal(sparse.label, "sparse");
  assert.ok(sparse.sparseness > 3);
  assert.equal(mixDensity({ ...typical, dipDb: 4, flatness: 0.18 }).label, "dense");
});

test("dips from slice loudness", () => {
  assert.equal(dipsFromSlices([-10, -20]), null);
  // 80 loud slices, 20 quiet ones 12 dB down.
  const db = [...Array(80).fill(-10), ...Array(20).fill(-22)];
  const dips = dipsFromSlices(db)!;
  assert.equal(dips.gapShare, 0.2);
  assert.equal(dips.dipDb, 12);
});

test("Spotify IDs from tags", () => {
  const id = "02e1DvRmyqlc5H3YA5jeGs";
  assert.equal(spotifyIdFromTag(id), id);
  assert.equal(spotifyIdFromTag(`spotify:track:${id}`), id);
  assert.equal(spotifyIdFromTag(`https://open.spotify.com/track/${id}?si=x`), id);
  assert.equal(spotifyIdFromTag("2026-11-05"), null);
  assert.equal(spotifyIdFromTag(undefined), null);
});
