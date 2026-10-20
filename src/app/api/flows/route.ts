import { NextRequest, NextResponse } from "next/server";
import { createFlow, listFlows, previewFlow } from "@/lib/flows";
import { LIKED_SONGS_ID } from "@/lib/library";

/** Every flow, each with how many songs running it would add (from the saved library). */
export async function GET() {
  const flows = await Promise.all(
    listFlows().map(async (flow) => {
      const preview = await previewFlow(flow.sources, flow.targetId);
      return { ...flow, waiting: preview.newSongs.length };
    })
  );
  return NextResponse.json({ flows });
}

/** Body: { name, targetId? }. */
export async function POST(request: NextRequest) {
  const { name, targetId } = await request.json().catch(() => ({}));
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "Give the flow a name." }, { status: 400 });
  }
  if (targetId === LIKED_SONGS_ID) {
    return NextResponse.json({ error: "A flow fills a playlist, not Liked Songs." }, { status: 400 });
  }
  return NextResponse.json({ flow: createFlow(name.trim(), typeof targetId === "string" ? targetId : null) });
}
