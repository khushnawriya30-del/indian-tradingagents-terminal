import fs from "node:fs";
import path from "node:path";

import type { Quote, SessionState } from "../types";
import { dataDir } from "./env";
import { quotes as upstoxQuotes } from "./upstox";
import { resolveInstrument } from "./instruments";

interface CachedQuote {
  last_price: number;
  previous_close: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  oi: number;
  ts: number;
}

const CACHE_FILE = "quote-cache.json";
const PERSIST_INTERVAL_MS = 30_000;

let memory: Record<string, CachedQuote> | null = null;
let lastPersist = 0;

function cachePath(): string {
  return path.join(dataDir(), CACHE_FILE);
}

function loadCache(): Record<string, CachedQuote> {
  if (memory) return memory;
  let loaded: Record<string, CachedQuote> = {};
  try {
    const raw = JSON.parse(fs.readFileSync(cachePath(), "utf-8"));
    if (raw && typeof raw === "object") loaded = raw as Record<string, CachedQuote>;
  } catch {
    loaded = {};
  }
  memory = loaded;
  return loaded;
}

function remember(key: string, value: CachedQuote, force = false) {
  const store = loadCache();
  store[key] = value;
  const now = Date.now();
  if (!force && now - lastPersist < PERSIST_INTERVAL_MS) return;
  lastPersist = now;
  try {
    fs.writeFileSync(cachePath(), JSON.stringify(store), "utf-8");
  } catch {
    // cache is best-effort; live quotes remain authoritative
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function buildQuote(
  key: string,
  symbol: string,
  name: string,
  segment: string,
  frozen: boolean,
  price: {
    last_price: number;
    previous_close: number;
    open: number;
    high: number;
    low: number;
    volume: number;
    average_price?: number;
    oi?: number;
    bid?: number;
    ask?: number;
    depth?: Quote["depth"];
  }
): Quote {
  const ltp = price.last_price;
  const cp = price.previous_close || ltp;
  const change = ltp && cp ? ltp - cp : 0;
  const pct = cp > 0 ? (change / cp) * 100 : 0;
  const buy = price.depth?.buy ?? [];
  const sell = price.depth?.sell ?? [];
  return {
    key,
    instrument_key: key,
    symbol,
    name,
    segment,
    frozen,
    last_price: ltp,
    change: round2(change),
    change_percent: round2(pct),
    open: price.open || ltp,
    high: price.high || ltp,
    low: price.low || ltp,
    previous_close: cp,
    volume: price.volume || 0,
    average_price: price.average_price ?? ltp,
    oi: price.oi || 0,
    bid: price.bid || buy[0]?.[0] || 0,
    ask: price.ask || sell[0]?.[0] || 0,
    depth: { buy, sell, bid: buy, ask: sell },
    ts: Date.now(),
  };
}

export async function getQuotes(
  keys: string[],
  session?: SessionState
): Promise<Record<string, Quote>> {
  const uniq = Array.from(new Set(keys.filter(Boolean)));
  if (!uniq.length) return {};

  const out: Record<string, Quote> = {};
  let liveData: Record<string, any> = {};

  try {
    liveData = await upstoxQuotes(uniq);
  } catch {
    liveData = {};
  }

  const cached = loadCache();
  const byToken: Record<string, any> = {};
  for (const value of Object.values(liveData)) {
    const token = (value as any)?.instrument_token;
    if (token) byToken[String(token)] = value;
  }

  for (const k of uniq) {
    const ins = await resolveInstrument(k).catch(() => null);
    const sym = ins?.trading_symbol || k.split("|")[1] || k;
    const name = ins?.name || sym;
    const seg = ins?.segment || (k.includes("INDEX") ? "NSE_INDEX" : "NSE_EQ");
    const isin = k.split("|")[1] || "";

    const q =
      liveData[k] ||
      byToken[isin] ||
      liveData[`${seg}|${sym}`] ||
      liveData[`NSE_EQ|${sym}`] ||
      liveData[`BSE_EQ|${sym}`] ||
      (seg === "NSE_INDEX" ? liveData[`NSE_INDEX|${name}`] : undefined);
    const frozen = session ? !session.is_open : false;

    if (q && Number(q.last_price) > 0) {
      const ltp = Number(q.last_price);
      const netChange = Number(q.net_change);
      const hasNet = q.net_change !== undefined && q.net_change !== null && Number.isFinite(netChange);
      const cp = hasNet ? ltp - netChange : Number(q.ohlc?.close ?? q.close_price ?? ltp);
      const buyDepth = (q.depth?.buy || [])
        .map((x: any) => [Number(x.price), Number(x.quantity)])
        .filter((level: number[]) => level[0] > 0);
      const sellDepth = (q.depth?.sell || [])
        .map((x: any) => [Number(x.price), Number(x.quantity)])
        .filter((level: number[]) => level[0] > 0);

      const quote = buildQuote(k, sym, name, seg, frozen, {
        last_price: ltp,
        previous_close: cp,
        open: Number(q.ohlc?.open || ltp),
        high: Number(q.ohlc?.high || ltp),
        low: Number(q.ohlc?.low || ltp),
        volume: Number(q.volume || 0),
        average_price: Number(q.average_price || 0) || ltp,
        oi: Number(q.oi || 0),
        bid: buyDepth[0]?.[0],
        ask: sellDepth[0]?.[0],
        depth: { buy: buyDepth, sell: sellDepth, bid: buyDepth, ask: sellDepth },
      });

      out[k] = quote;
      remember(k, {
        last_price: quote.last_price,
        previous_close: quote.previous_close,
        open: quote.open,
        high: quote.high,
        low: quote.low,
        volume: quote.volume,
        oi: quote.oi ?? 0,
        ts: Date.now(),
      });
      continue;
    }

    const hit = cached[k];
    if (hit && hit.last_price > 0) {
      out[k] = buildQuote(k, sym, name, seg, true, {
        last_price: hit.last_price,
        previous_close: hit.previous_close,
        open: hit.open,
        high: hit.high,
        low: hit.low,
        volume: hit.volume,
        oi: hit.oi ?? 0,
      });
      continue;
    }

    out[k] = buildQuote(k, sym, name, seg, true, {
      last_price: 0,
      previous_close: 0,
      open: 0,
      high: 0,
      low: 0,
      volume: 0,
      oi: 0,
    });
  }

  return out;
}
