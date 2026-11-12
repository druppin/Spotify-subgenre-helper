import { test } from "node:test";
import assert from "node:assert/strict";
import { STARTER_SET } from "./starterSet.ts";

test("starter songs are unique and each has expected genres", () => {
  const labels = STARTER_SET.map((s) => `${s.artist} – ${s.title}`.toLowerCase());
  assert.equal(new Set(labels).size, labels.length);
  for (const song of STARTER_SET) {
    assert.ok(song.truth.required.length > 0, `${song.title} has no required genres`);
    assert.ok(song.note.trim(), `${song.title} has no note`);
  }
});
