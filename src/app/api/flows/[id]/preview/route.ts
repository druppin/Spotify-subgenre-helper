import { NextRequest, NextResponse } from "next/server";
import { cleanSource, getFlow, previewFlow, type FlowSource } from "@/lib/flows";

const LISTED_SONGS = 50;

/**
 * What running the flow would add, from the saved library (no Spotify
 * requests). Body (optional): { sources } to preview unsaved filter changes.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const flow = getFlow(Number(id));
  if (!flow) return NextResponse.json({ error: "No such flow." }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const sources: FlowSource[] = Array.isArray(body.sources) ? body.sources.map(cleanSource) : flow.sources;
  const result = await previewFlow(sources, flow.targetId);
  return NextResponse.json({
    sources: result.sources,
    targetTotal: result.targetTotal,
    newTotal: result.newSongs.length,
    newSongs: result.newSongs.slice(0, LISTED_SONGS).map(({ track, from }) => ({
      uri: track.uri,
      name: track.name,
      artists: track.artists,
      image: track.image,
      from,
    })),
  });
}
