import { test } from "node:test";
import assert from "node:assert/strict";
import { EMBEDDING_SIZE, melFrame, melPatches, PATCH_SIZE, soundsLike } from "./soundsLike.ts";

test("mel bands match Essentia's TensorflowInputMusiCNN", () => {
  // Tones at 100 Hz, 1, 3 and 6.5 kHz; expected values from Essentia 2.1.
  const frame = Array.from({ length: 512 }, (_, n) =>
    [[0.5, 100], [0.3, 1000], [0.2, 3000], [0.1, 6500]].reduce((s, [a, hz]) => s + a * Math.sin((2 * Math.PI * hz * n) / 16000), 0)
  );
  const bands = melFrame(frame);
  for (const [band, expected] of [[2, 6.0899], [5, 2.3123], [30, 5.0027], [50, 0], [90, 3.7811]]) {
    assert.ok(Math.abs(bands[band] - expected) < 1e-3, `band ${band}: ${bands[band]} vs ${expected}`);
  }
});

test("patches: whole ones only", () => {
  assert.equal(melPatches(new Float32Array(16000)).count, 0);
  // 10 s gives 626 frames: patches start every 62 frames (0 to 496) while 128 fit.
  const { data, count } = melPatches(new Float32Array(160000));
  assert.equal(count, 9);
  assert.equal(data.length, 9 * PATCH_SIZE);
});

test("the closest songs' playlists vote", () => {
  // Two clusters of songs, each a shared pattern plus a little noise.
  const vector = (cluster: number, noise: number) =>
    Float32Array.from({ length: EMBEDDING_SIZE }, (_, i) => Math.sin(i * (cluster + 1) * 0.37) + Math.sin(i * 13.1 + noise) * 0.1);
  const library = [
    ...Array.from({ length: 6 }, (_, i) => ({ embedding: vector(0, i), playlists: ["Liquid", "Dnb"] })),
    ...Array.from({ length: 10 }, (_, i) => ({ embedding: vector(1, i + 10), playlists: ["Techno"] })),
  ];
  const result = soundsLike(vector(0, 99), library)!;
  // Techno holds the other 4, fewer than 10 random songs would (6.25).
  assert.deepEqual(result.playlists, [
    { name: "Dnb", songs: 6, typical: 3.8 },
    { name: "Liquid", songs: 6, typical: 3.8 },
  ]);
  assert.equal(soundsLike(vector(0, 1), library.slice(0, 5)), null);
});
