// Runs once when the server starts (Next's instrumentation hook).
export async function register() {
  // The music folder watch needs Node's fs, so not in the edge runtime.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { watchMusicFolder } = await import("@/lib/localAudio");
    watchMusicFolder();
  }
}
