import { NextResponse } from "next/server";
import { getPlaceGenreSummaries } from "@/lib/placeGenreSummary";

// Top genres and genre family per saved playlist, from the library database.
export async function GET() {
  return NextResponse.json({ summaries: await getPlaceGenreSummaries() });
}
