import { NextResponse } from "next/server";

import { resolveInstrument } from "@/lib/server/instruments";
import { sessionState } from "@/lib/server/session";
import { historicalCandles, intradayCandles } from "@/lib/server/upstox";
import type { Candle } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toCandle(row: any[], daily: boolean): Candle | null {
  if (!Array.isArray(row) || row.length < 5) return null;
  const open = Number(row[1]);
  const high = Number(row[2]);
  const low = Number(row[3]);
  const close = Number(row[4]);
  if (![open, high, low, close].every(Number.isFinite)) return null;
  let time: number;
  if (daily) {
    const day = String(row[0]).slice(0, 10);
    time = Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000);
  } else {
    time = Math.floor(Date.parse(String(row[0])) / 1000);
  }
  if (!Number.isFinite(time)) return null;
  return {
    time,
    open,
    high,
    low,
    close,
    volume: Number(row[5] || 0),
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbol = url.searchParams.get("key") || url.searchParams.get("symbol");
  const interval = url.searchParams.get("interval") || "15m";
  if (!symbol) return NextResponse.json({ error: "key required" }, { status: 400 });

  const instrument = await resolveInstrument(symbol);
  if (!instrument) return NextResponse.json({ error: `Unknown instrument ${symbol}` }, { status: 404 });

  const today = new Date();
  const session = sessionState();
  let candles: Candle[] = [];
  let resolution = interval;
  let warning: string | undefined;

  try {
    if (interval === "1D") {
      const from = new Date(today);
      from.setUTCDate(from.getUTCDate() - 730);
      const rows = await historicalCandles(instrument.instrument_key, {
        unit: "days",
        interval: 1,
        fromDate: isoDay(from),
        toDate: isoDay(today),
      });
      candles = rows.map((row) => toCandle(row, true)).filter((row): row is Candle => !!row);
      if (!candles.length) {
        const week = new Date(today);
        week.setUTCDate(week.getUTCDate() - 10);
        const fallback = await historicalCandles(instrument.instrument_key, {
          unit: "weeks",
          interval: 1,
          fromDate: isoDay(week),
          toDate: isoDay(today),
        });
        candles = fallback.map((row) => toCandle(row, true)).filter((row): row is Candle => !!row);
        resolution = "1W";
      }
    } else {
      const map: Record<string, { unit: string; interval: number }> = {
        "1m": { unit: "minutes", interval: 1 },
        "5m": { unit: "minutes", interval: 5 },
        "15m": { unit: "minutes", interval: 15 },
        "30m": { unit: "minutes", interval: 30 },
        "1h": { unit: "hours", interval: 1 },
      };
      const spec = map[interval] || map["15m"];
      const rows = await intradayCandles(instrument.instrument_key, spec.unit, spec.interval);
      candles = rows.map((row) => toCandle(row, false)).filter((row): row is Candle => !!row);
      if (candles.length < 2) {
        const from = new Date(today);
        from.setUTCDate(from.getUTCDate() - 10);
        const rows = await historicalCandles(instrument.instrument_key, {
          unit: spec.unit,
          interval: spec.interval,
          fromDate: isoDay(from),
          toDate: isoDay(today),
        });
        candles = rows.map((row) => toCandle(row, false)).filter((row): row is Candle => !!row);
        if (candles.length) warning = "Intraday session empty; showing last traded session";
      }
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "candle error", candles: [] },
      { status: 502 }
    );
  }

  candles.sort((a, b) => a.time - b.time);
  const dedup = new Map<number, Candle>();
  for (const candle of candles) dedup.set(candle.time, candle);
  return NextResponse.json({
    symbol: instrument.trading_symbol,
    instrument_key: instrument.instrument_key,
    requested_interval: interval,
    interval: resolution,
    candles: [...dedup.values()].slice(-1500),
    session,
    warning,
  });
}
