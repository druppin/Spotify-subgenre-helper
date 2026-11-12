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

test("run totals", () => {
  const a = scoreTrack(["house", "techno"], { house: 80, techno: 20 }, { required: ["house"], acceptable: [] });
  const b = scoreTrack(["metal"], { metal: 70 }, { required: ["doom metal"], acceptable: [] });
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
