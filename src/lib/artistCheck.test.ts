import { test } from "node:test";
import assert from "node:assert/strict";
import { clashes } from "./artistCheck.ts";

test("artist tags clash only when no genre family is shared", () => {
  // Rova the DnB producer vs ROVA the saxophone quartet.
  assert.equal(clashes(["Avant-Garde Jazz", "free jazz", "saxophone"], ["drum and bass"]), true);
  // Dunk's Last.fm page mixes two artists, but one of them fits.
  assert.equal(clashes(["Drum and bass", "alternative rock"], ["drum and bass"]), false);
  // Nothing to compare against: keep the tags.
  assert.equal(clashes(["jazz"], []), false);
  assert.equal(clashes(["british", "seen live"], ["drum and bass"]), false);
});
