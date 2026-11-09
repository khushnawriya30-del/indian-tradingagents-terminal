import { NextResponse } from "next/server";

import { getQuotes } from "@/lib/server/quotes";
import { sessionState } from "@/lib/server/session";
import {
  buildPortfolio,
  ensureState,
  instrumentKeysForState,
  mutateState,
  processOrders,
  watchlistLabels,
} from "@/lib/server/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = sessionState();
  try {
    let state = await ensureState();
    const keys = instrumentKeysForState(state);
    const quotes = await getQuotes(keys, session).catch(() => ({}));
    state = await mutateState(async (current) => {
      await processOrders(current, quotes, session);
      return current;
    });
    const portfolio = buildPortfolio(state, quotes, session);
    return NextResponse.json({
      ...portfolio,
      watchlist: await watchlistLabels(state.watchlist),
      quotes,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "portfolio unavailable" },
      { status: 500 }
    );
  }
}
