import { NextResponse } from "next/server";

import { resolveInstrument } from "@/lib/server/instruments";
import { sessionState } from "@/lib/server/session";
import { expiries as listExpiries } from "@/lib/server/upstox";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Nearest live F&O expiry for an underlying. The ticker uses this so the
 * "Exp." label always matches the contract the exchange is actually trading,
 * including weeks where a scheduled expiry is pushed by a holiday.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbol = url.searchParams.get("symbol") || "NIFTY";
  try {
    const instrument = await resolveInstrument(symbol);
    if (!instrument) {
      return NextResponse.json({ error: `Unknown underlying ${symbol}` }, { status: 404 });
    }
    const state = sessionState();
    const all = await listExpiries(instrument.instrument_key);
    const live = state.is_open
      ? all.filter((expiry) => expiry >= state.session_date)
      : all.filter((expiry) => expiry > state.session_date);
    return NextResponse.json({
      symbol: instrument.trading_symbol,
      underlying_key: instrument.instrument_key,
      expiry: (live.length ? live : all)[0] ?? null,
      expiries: all.slice(0, 12),
      session: state,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "expiry lookup failed" },
      { status: 502 }
    );
  }
}
