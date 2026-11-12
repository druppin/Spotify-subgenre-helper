import { test } from "node:test";
import assert from "node:assert/strict";
import { diffLines, scoreRun, scoreTrack } from "./score.ts";

test("matches spellings, alternatives and acceptable tags", () => {
  const score = scoreTrack(
    ["Liquid Funk", "drum & bass", "electronic", "gabber"],
    { "Liquid Funk": 90, gabber: 40 },
    { required: ["liquid dnb | liquid funk", "dnb", "jungle"], acceptable: ["electronic"] }
  );
  assert.deepEqual(
    score.tags.map((t) => t.verdict),
    ["hit", "hit", "ok", "wrong"]
  );
  assert.deepEqual(score.missed, ["jungle"]);
  assert.equal(score.found, 2);
  assert.equal(score.required, 3);
  assert.equal(score.familyMatch, true);
});

test("narrower or broader versions of expected genres are close, not wrong", () => {
  // Burial "Archangel", as one run answered it.
  const score = scoreTrack(
    ["future garage", "ambient dubstep", "2-step garage", "post‑dubstep", "hauntology", "dub", "garage"],
    {},
    { required: ["future garage | uk garage"], acceptable: ["dubstep", "ambient", "2-step"] }
  );
  assert.deepEqual(
    score.tags.map((t) => t.verdict),
    ["hit", "close", "close", "close", "wrong", "wrong", "close"]
  );
  // Close tags don't fill a required genre.
  const vague = scoreTrack(["drum and bass"], {}, { required: ["liquid dnb"], acceptable: [] });
  assert.deepEqual(vague.tags.map((t) => t.verdict), ["close"]);
  assert.equal(vague.found, 0);
  assert.equal(scoreRun([vague]).precision, 1);
});

test("run totals", () => {
  const a = scoreTrack(["house", "techno"], { house: 80, techno: 20 }, { required: ["house"], acceptable: [] });
  const b = scoreTrack(["grunge"], { grunge: 70 }, { required: ["doom metal"], acceptable: [] });
  const run = scoreRun([a, b]);
  assert.equal(run.precision, 1 / 3);
  assert.equal(run.recall, 1 / 2);
  assert.equal(run.familyAccuracy, 1);
  assert.equal(run.hitConfidence, 80);
  assert.equal(run.wrongConfidence, 45);
  assert.equal(scoreRun([]).f1, null);
});

test("line diff", () => {
  assert.deepEqual(diffLines("a\nb\nc", "a\nx\nc"), [
    { kind: "same", text: "a" },
    { kind: "del", text: "b" },
    { kind: "add", text: "x" },
    { kind: "same", text: "c" },
  ]);
});
