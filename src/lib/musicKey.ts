const PITCH_CLASSES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

/** Formats Spotify/ReccoBeats-style numeric key (0-11, -1 = unknown) + mode (1=major, 0=minor). */
export function formatMusicalKey(key: number, mode: number): string {
  if (key < 0 || key > 11) return "Unknown";
  return `${PITCH_CLASSES[key]} ${mode === 1 ? "major" : "minor"}`;
}
