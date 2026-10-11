import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localRequest";
import { createApiKey, listApiKeys } from "@/lib/api/tokens";

export async function GET(request: Request) {
  return checkLocalRequest(request) ?? NextResponse.json({ keys: listApiKeys() });
}

/** Body: { name }. Returns the new key, which is never shown again. */
export async function POST(request: Request) {
  const denied = checkLocalRequest(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "Give the key a name." }, { status: 400 });
  return NextResponse.json(createApiKey(name));
}
