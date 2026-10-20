import { NextRequest, NextResponse } from "next/server";
import { cleanSource, deleteFlow, updateFlow, type FlowSource } from "@/lib/flows";
import { LIKED_SONGS_ID } from "@/lib/library";

type Params = { params: Promise<{ id: string }> };

/** Body: any of { name, targetId, sources } (sources: the whole list, in order). */
export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  if (body.targetId === LIKED_SONGS_ID) {
    return NextResponse.json({ error: "A flow fills a playlist, not Liked Songs." }, { status: 400 });
  }
  const sources: FlowSource[] | undefined = Array.isArray(body.sources)
    ? body.sources
        .filter((s: { sourceId?: unknown }) => typeof s?.sourceId === "string")
        .map(cleanSource)
        .filter((s: FlowSource) => s.sourceId !== (body.targetId ?? undefined))
    : undefined;
  const flow = updateFlow(Number(id), {
    name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : undefined,
    targetId: body.targetId === undefined ? undefined : typeof body.targetId === "string" ? body.targetId : null,
    sources,
  });
  if (!flow) return NextResponse.json({ error: "No such flow." }, { status: 404 });
  return NextResponse.json({ flow });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  deleteFlow(Number(id));
  return NextResponse.json({ ok: true });
}
