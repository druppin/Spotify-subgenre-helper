import { NextResponse } from "next/server";

/*
 * Settings routes change keys and can make API keys, so only this app's own
 * pages may call them. A web page elsewhere can still send requests to
 * 127.0.0.1 from the user's browser: Origin shows where a request came from,
 * and Host catches a site that points its own name at 127.0.0.1.
 */

const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Null when the request comes from this app's own page, otherwise the 403 to send. */
export function checkLocalRequest(request: Request): NextResponse | null {
  const host = request.headers.get("host") ?? "";
  const hostname = host.replace(/:\d+$/, "");
  const origin = request.headers.get("origin");
  let sameOrigin = true;
  if (origin) {
    try {
      sameOrigin = new URL(origin).host === host;
    } catch {
      sameOrigin = false;
    }
  }
  if (!LOCAL_HOSTNAMES.has(hostname) || !sameOrigin) {
    return NextResponse.json({ error: "Settings can only be changed from the app itself." }, { status: 403 });
  }
  return null;
}
