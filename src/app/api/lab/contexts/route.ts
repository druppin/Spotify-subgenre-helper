import { NextResponse } from "next/server";
import { checkDevRequest } from "@/lib/devMode";
import { contextsByHash } from "@/lib/lab/store";

/** ?hashes=a,b : saved versions of songs' data, keyed by hash. */
export async function GET(request: Request) {
  const denied = checkDevRequest(request);
  if (denied) return denied;
  const hashes = (new URL(request.url).searchParams.get("hashes") ?? "").split(",").filter(Boolean).slice(0, 10);
  return NextResponse.json(contextsByHash(hashes));
}
