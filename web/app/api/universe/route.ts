import { NextResponse } from "next/server";

import { ensureMaster } from "@/lib/server/instruments";
import { NIFTY_500 } from "@/lib/server/nifty500";
import { getQuotes } from "@/lib/server/quotes";
import { sessionState } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const master = await ensureMaster();
    const symbols = [...new Set(NIFTY_500)];
    const keys: string[] = [];
    for (const symbol of symbols) {
      const instrument = master.equity(symbol, "NSE");
      if (instrument) keys.push(instrument.instrument_key);
    }
    const session = sessionState();
    const quotes = await getQuotes(keys, session);
    const rows = Object.values(quotes).filter((row) => row.last_price > 0);
    const ranked = rows
      .filter((row) => row.change_percent !== null)
      .sort((a, b) => (b.change_percent || 0) - (a.change_percent || 0));
    const advancing = rows.filter((row) => (row.change || 0) > 0).length;
    const declining = rows.filter((row) => (row.change || 0) < 0).length;
    return NextResponse.json({
      universe: "NIFTY500",
      quotes: rows,
      gainers: ranked.slice(0, 8),
      losers: ranked.slice(-8).reverse(),
      breadth: { advancing, declining, unchanged: rows.length - advancing - declining },
      session,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "universe failed" },
      { status: 502 }
    );
  }
}
