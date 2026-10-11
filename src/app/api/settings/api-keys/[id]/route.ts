import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localRequest";
import { revokeApiKey } from "@/lib/api/tokens";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = checkLocalRequest(request);
  if (denied) return denied;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || !revokeApiKey(id)) {
    return NextResponse.json({ error: "No key with that ID." }, { status: 404 });
  }
  return NextResponse.json({ revoked: id });
}
