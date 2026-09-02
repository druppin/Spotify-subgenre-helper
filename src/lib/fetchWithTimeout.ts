/**
 * fetch() with no timeout can hang forever if a remote server stalls
 * (accepts the connection but never responds) — none of the external APIs
 * this app calls (Spotify, ReccoBeats, Last.fm, the LLM providers) are
 * guaranteed not to do that. This wraps fetch with an AbortController-based
 * timeout so a stalled call fails with a clear, catchable error instead of
 * leaving a request (and the UI waiting on it) stuck indefinitely.
 */
export class FetchTimeoutError extends Error {}

export async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit = {},
  timeoutMs = 15_000
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new FetchTimeoutError(`Request to ${url} timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
