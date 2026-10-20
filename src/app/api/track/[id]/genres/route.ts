import { NextRequest, NextResponse } from "next/server";
import { setTrackGenresByUser } from "@/lib/trackGenres";

/** Body: { tags: string[] }. Replaces the song's tags with the user's own. */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { tags } = await request.json().catch(() => ({}));
  if (!Array.isArray(tags) || !tags.every((t) => typeof t === "string")) {
    return NextResponse.json({ error: "tags must be an array of strings" }, { status: 400 });
  }
  try {
    const { own, broader } = await setTrackGenresByUser(id, tags);
    return NextResponse.json({ own, broader, subgenres: [...own, ...broader], edited: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
