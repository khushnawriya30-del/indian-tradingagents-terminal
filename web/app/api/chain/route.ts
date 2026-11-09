import { NextResponse } from "next/server";

import { resolveInstrument } from "@/lib/server/instruments";
import { sessionState } from "@/lib/server/session";
import { expiries as listExpiries, optionChain, optionContracts, quotes } from "@/lib/server/upstox";
import type { ChainRow, OptionLeg } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function leg(side: any): OptionLeg {
  const data = side?.market_data || {};
  const greeks = side?.option_greeks || {};
  const ltp = Number(data.ltp || 0);
  const close = Number(data.close_price || 0);
  return {
    instrument_key: String(side?.instrument_key || ""),
    ltp,
    change: close ? ltp - close : 0,
    oi: Number(data.oi || 0),
    prev_oi: Number(data.prev_oi || 0),
    volume: Number(data.volume || 0),
    iv: Number(greeks.iv || 0),
    delta: Number(greeks.delta || 0),
    gamma: Number(greeks.gamma || 0),
    theta: Number(greeks.theta || 0),
    vega: Number(greeks.vega || 0),
    pop: Number(greeks.pop || 0),
    bid: Number(data.bid_price || 0),
    ask: Number(data.ask_price || 0),
  };
}

function maxPain(rows: any[]): number | null {
  if (!rows.length) return null;
  const strikes = [...new Set(rows.map((row) => Number(row.strike_price)))].sort((a, b) => a - b);
  let best: { strike: number; pain: number } | null = null;
  for (const candidate of strikes) {
    let pain = 0;
    for (const row of rows) {
      const strike = Number(row.strike_price);
      const callOi = Number(row.call_options?.market_data?.oi || 0);
      const putOi = Number(row.put_options?.market_data?.oi || 0);
      if (candidate > strike) pain += (candidate - strike) * callOi;
      if (candidate < strike) pain += (strike - candidate) * putOi;
    }
    if (!best || pain < best.pain) best = { strike: candidate, pain };
  }
  return best?.strike ?? null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbol = url.searchParams.get("symbol") || "NIFTY";
  const expiryParam = url.searchParams.get("expiry");
  const instrument = await resolveInstrument(symbol);
  if (!instrument) return NextResponse.json({ error: `Unknown underlying ${symbol}` }, { status: 404 });

  try {
    const expiries = await listExpiries(instrument.instrument_key);
    if (!expiries.length) {
      return NextResponse.json({ error: "No option contracts listed for this underlying" }, { status: 404 });
    }
    const state = sessionState();
    const today = state.session_date;
    // A contract expiring today has no quotes once the session is closed.
    const live = state.is_open
      ? expiries.filter((expiry) => expiry >= today)
      : expiries.filter((expiry) => expiry > today);
    const pool = live.length ? live : expiries.filter((expiry) => expiry >= today);
    const expiry = expiryParam && expiries.includes(expiryParam) ? expiryParam : (pool[0] ?? expiries[0]);
    const chain = await optionChain(instrument.instrument_key, expiry);

    const contracts = await optionContracts(instrument.instrument_key);
    const lotSize = contracts.find((row) => String(row.expiry) === expiry)?.lot_size ?? null;

    let spot: number | null = null;
    let previousClose: number | null = null;
    try {
      const payload = await quotes([instrument.instrument_key]);
      const raw = payload[instrument.instrument_key];
      spot = raw?.last_price ?? null;
      const net = Number(raw?.net_change);
      if (raw && Number.isFinite(net)) previousClose = Number(raw.last_price) - net;
    } catch {
      // chain rows carry the spot as a fallback
    }
    if (!spot && chain.length) spot = Number(chain[0].underlying_spot_price) || null;

    const rows: ChainRow[] = chain
      .map((row) => ({
        strike: Number(row.strike_price),
        call: leg(row.call_options),
        put: leg(row.put_options),
      }))
      .filter((row) => Number.isFinite(row.strike))
      .sort((a, b) => a.strike - b.strike);

    const callOi = rows.reduce((sum, row) => sum + row.call.oi, 0);
    const putOi = rows.reduce((sum, row) => sum + row.put.oi, 0);
    const callVolume = rows.reduce((sum, row) => sum + row.call.volume, 0);
    const putVolume = rows.reduce((sum, row) => sum + row.put.volume, 0);

    let visible = rows;
    if (spot && rows.length > 25) {
      const pivot = rows.reduce(
        (best, row, index) =>
          Math.abs(row.strike - spot) < Math.abs(rows[best].strike - spot) ? index : best,
        0
      );
      const start = Math.max(0, pivot - 12);
      visible = rows.slice(start, start + 25);
    }

    return NextResponse.json({
      underlying: instrument.trading_symbol,
      underlying_key: instrument.instrument_key,
      expiry,
      expiries: live.slice(0, 12),
      lot_size: lotSize,
      spot,
      previous_close: previousClose,
      rows: visible,
      totals: {
        call_oi: callOi,
        put_oi: putOi,
        pcr: callOi ? putOi / callOi : 0,
        call_volume: callVolume,
        put_volume: putVolume,
        max_pain: maxPain(chain),
      },
      session: sessionState(),
      source: "upstox",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "option chain failed" },
      { status: 502 }
    );
  }
}
