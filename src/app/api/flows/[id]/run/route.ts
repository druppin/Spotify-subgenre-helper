import { NextRequest, NextResponse } from "next/server";
import { getValidAccessToken } from "@/lib/spotify/auth";
import { SpotifyClient } from "@/lib/spotify/client";
import { spotifyErrorResponse } from "@/lib/spotify/routeError";
import { getFlow, runFlow } from "@/lib/flows";

/** Runs the flow: adds the songs its target is missing. Responds with how many, per source. */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const flow = getFlow(Number(id));
  if (!flow) return NextResponse.json({ error: "No such flow." }, { status: 404 });
  if (!flow.targetId) return NextResponse.json({ error: "Pick the playlist this flow fills first." }, { status: 400 });
  try {
    const client = new SpotifyClient(await getValidAccessToken());
    const result = await runFlow(flow, client);
    return NextResponse.json({ added: result.newSongs.length, sources: result.sources });
  } catch (err) {
    return spotifyErrorResponse(err, "POST /api/flows/[id]/run");
  }
}
