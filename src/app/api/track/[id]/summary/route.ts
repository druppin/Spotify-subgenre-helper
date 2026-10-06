import { NextRequest } from "next/server";
import { summarizeTrackById } from "@/lib/trackSummary";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const forceRegenerate = new URL(request.url).searchParams.get("force") === "true";
  return summarizeTrackById(id, forceRegenerate);
}
