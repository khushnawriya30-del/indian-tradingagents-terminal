import { NextResponse } from "next/server";

import { getQuotes } from "@/lib/server/quotes";
import { sessionState } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const keys = (url.searchParams.get("keys") || "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean)
    .slice(0, 500);
  if (!keys.length) return NextResponse.json({ quotes: [] });
  const session = sessionState();
  try {
    const quotes = await getQuotes(keys, session);
    return NextResponse.json({ quotes: Object.values(quotes), session });
  } catch (error) {
    return NextResponse.json(
      { quotes: [], session, error: error instanceof Error ? error.message : "quote error" },
      { status: 502 }
    );
  }
}
