import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localRequest";

// NEXT_PUBLIC_DEV_MODE=true in .env.local turns on developer tools (the
// Prompt lab tab). Read when the app is built or `next dev` starts.
export const DEV_MODE = process.env.NEXT_PUBLIC_DEV_MODE === "true";

/** Null when a developer-tools route may run, otherwise the response to send. */
export function checkDevRequest(request: Request): NextResponse | null {
  if (!DEV_MODE) return NextResponse.json({ error: "Developer mode is off (NEXT_PUBLIC_DEV_MODE)." }, { status: 404 });
  return checkLocalRequest(request);
}
