import { NextResponse } from "next/server";

import { getQuotes } from "@/lib/server/quotes";
import { sessionState } from "@/lib/server/session";
import { addWatchlist, ensureState, removeWatchlist, watchlistLabels } from "@/lib/server/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const state = await ensureState();
  const session = sessionState();
  const quotes = await getQuotes(state.watchlist, session).catch(() => ({}));
  return NextResponse.json({
    items: await watchlistLabels(state.watchlist),
    quotes: Object.values(quotes),
    session,
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { instrument_key?: string };
  if (!body.instrument_key) {
    return NextResponse.json({ error: "instrument_key required" }, { status: 400 });
  }
  try {
    const keys = await addWatchlist(body.instrument_key);
    return NextResponse.json({ ok: true, watchlist: await watchlistLabels(keys) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not add" },
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });
  const keys = await removeWatchlist(key);
  return NextResponse.json({ ok: true, watchlist: await watchlistLabels(keys) });
}
