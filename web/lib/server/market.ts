import type { Quote, SessionState } from "../types";
import { ensureMaster, resolveInstrument } from "./instruments";
import { getQuotes } from "./quotes";
import { sessionState } from "./session";
import { optionChain, expiries as listExpiries } from "./upstox";
import {
  COMMODITY_SYMBOLS,
  ETF_SYMBOLS,
  FUTURE_UNDERLYINGS,
  INDEX_CONSTITUENT_SYMBOLS,
  LIQUID_MIDCAPS,
  NIFTY_50,
  OPTION_UNDERLYINGS,
  SECTOR_INDICES,
  UNIVERSE_SYMBOLS,
} from "./universe";

/* ------------------------------------------------------------------ */
/* cache                                                              */
/* ------------------------------------------------------------------ */

type CacheEntry = { value: unknown; expires: number };
const CACHE = new Map<string, CacheEntry>();

async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = CACHE.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  const value = await fn();
  CACHE.set(key, { value, expires: Date.now() + ttlMs });
  return value;
}

function ttl(session: SessionState, openMs = 12_000, closedMs = 60_000): number {
  return session.is_open ? openMs : closedMs;
}

/* ------------------------------------------------------------------ */
/* types                                                              */
/* ------------------------------------------------------------------ */

export interface StockRow {
  key: string;
  symbol: string;
  name: string;
  segment: string;
  ltp: number;
  change: number;
  change_percent: number;
  open: number;
  high: number;
  low: number;
  previous_close: number;
  volume: number;
}

export interface OptionRow {
  key: string;
  symbol: string;
  underlying: string;
  expiry: string;
  strike: number;
  side: "CE" | "PE";
  ltp: number;
  change: number;
  change_percent: number;
  oi: number;
  oi_change: number;
  volume: number;
  iv: number;
}

export interface IndexSnapshot {
  key: string;
  symbol: string;
  label: string;
  ltp: number;
  change: number;
  change_percent: number;
  open: number;
  high: number;
  low: number;
  previous_close: number;
}

export interface ChainSummary {
  key: string;
  symbol: string;
  label: string;
  expiry: string;
  spot: number;
  change_percent: number;
  atm: number;
  atm_iv: number;
  pcr: number;
  max_pain: number;
  support: number;
  resistance: number;
  call_oi: number;
  put_oi: number;
}

/* ------------------------------------------------------------------ */
/* quote helpers                                                      */
/* ------------------------------------------------------------------ */

function toRow(q: Quote | undefined, name = ""): StockRow | null {
  if (!q || !q.last_price) return null;
  return {
    key: q.instrument_key,
    symbol: q.symbol,
    name: name || q.name || q.symbol,
    segment: q.segment || "NSE_EQ",
    ltp: q.last_price,
    change: q.change,
    change_percent: q.change_percent,
    open: q.open,
    high: q.high,
    low: q.low,
    previous_close: q.previous_close,
    volume: q.volume || 0,
  };
}

async function universeRows(session: SessionState): Promise<StockRow[]> {
  return cached(`universe:${session.session_date}`, ttl(session, 5_000, 60_000), async () => {
    const master = await ensureMaster();
    const keys: string[] = [];
    for (const symbol of UNIVERSE_SYMBOLS) {
      const ins = master.equity(symbol, "NSE");
      if (ins) keys.push(ins.instrument_key);
    }
    const quotes = await getQuotes(keys, session);
    const rows: StockRow[] = [];
    for (const symbol of UNIVERSE_SYMBOLS) {
      const ins = master.equity(symbol, "NSE");
      if (!ins) continue;
      const row = toRow(quotes[ins.instrument_key], ins.name);
      if (row) rows.push(row);
    }
    return rows;
  });
}

async function indexRows(session: SessionState, list = OPTION_UNDERLYINGS): Promise<IndexSnapshot[]> {
  return cached(`indices:${session.session_date}:${list.map((x) => x.key).join(",")}`, ttl(session), async () => {
    const quotes = await getQuotes(list.map((item) => item.key), session);
    return list
      .map((item) => {
        const q = quotes[item.key];
        if (!q) return null;
        return {
          key: item.key,
          symbol: item.symbol,
          label: item.label,
          ltp: q.last_price,
          change: q.change,
          change_percent: q.change_percent,
          open: q.open,
          high: q.high,
          low: q.low,
          previous_close: q.previous_close,
        } satisfies IndexSnapshot;
      })
      .filter(Boolean) as IndexSnapshot[];
  });
}

async function sectorRows(session: SessionState) {
  return cached(`sectors:${session.session_date}`, ttl(session), async () => {
    const quotes = await getQuotes(SECTOR_INDICES.map((s) => s.key), session);
    return SECTOR_INDICES.map((sector) => {
      const q = quotes[sector.key];
      return {
        key: sector.key,
        label: sector.label,
        ltp: q?.last_price ?? 0,
        change: q?.change ?? 0,
        change_percent: q?.change_percent ?? 0,
      };
    }).filter((row) => row.ltp > 0);
  });
}

async function etfRows(session: SessionState) {
  return cached(`etfs:${session.session_date}`, ttl(session), async () => {
    const master = await ensureMaster();
    const keys: string[] = [];
    const names = new Map<string, string>();
    for (const symbol of ETF_SYMBOLS) {
      const ins = master.equity(symbol, "NSE");
      if (ins) {
        keys.push(ins.instrument_key);
        names.set(ins.instrument_key, symbol);
      }
    }
    const quotes = await getQuotes(keys, session);
    return keys
      .map((key) => {
        const quote = quotes[key];
        if (!quote) return null;
        return {
          key,
          symbol: names.get(key) || quote.symbol,
          name: quote.name,
          ltp: quote.last_price,
          change_percent: quote.change_percent,
          volume: quote.volume,
          segment: "ETF",
        };
      })
      .filter(Boolean)
      .slice(0, 12) as Array<Record<string, unknown>>;
  });
}

/* ------------------------------------------------------------------ */
/* screeners                                                          */
/* ------------------------------------------------------------------ */

export type ScreenerId =
  | "bullish"
  | "recovery"
  | "momentum"
  | "oversold"
  | "crossover"
  | "open-low"
  | "arbitrage";

export const SCREENERS: Array<{ id: ScreenerId; label: string }> = [
  { id: "bullish", label: "Bullish" },
  { id: "recovery", label: "Intraday Recovery" },
  { id: "momentum", label: "Momentum Burst" },
  { id: "oversold", label: "RSI Oversold" },
  { id: "crossover", label: "Bullish Crossover" },
  { id: "open-low", label: "Open = Low" },
  { id: "arbitrage", label: "Exchange Arbitrage" },
];

function screen(rows: StockRow[], id: ScreenerId): StockRow[] {
  const liquid = rows.filter((row) => row.ltp > 20 && row.volume > 0);
  const byChange = (a: StockRow, b: StockRow) => b.change_percent - a.change_percent;
  switch (id) {
    case "bullish":
      return liquid
        .filter((row) => row.change_percent > 0 && row.high > row.low)
        .sort((a, b) => (b.ltp - b.low) / (b.high - b.low) - (a.ltp - a.low) / (a.high - a.low))
        .slice(0, 8);
    case "recovery":
      return liquid
        .filter((row) => row.low < row.previous_close && row.ltp > row.previous_close)
        .sort((a, b) => (a.low / a.previous_close) - (b.low / b.previous_close))
        .slice(0, 8);
    case "momentum":
      return liquid
        .filter((row) => row.change_percent > 1 && row.ltp >= row.previous_close * 1.01)
        .sort((a, b) => b.change_percent - a.change_percent)
        .slice(0, 8);
    case "oversold":
      return liquid
        .filter((row) => row.change_percent < -0.5)
        .sort(byChange)
        .slice(0, 8);
    case "crossover":
      return liquid
        .filter((row) => row.ltp > row.open && row.open > row.previous_close * 0.995)
        .sort((a, b) => b.change_percent - a.change_percent)
        .slice(0, 8);
    case "open-low":
      return liquid
        .filter((row) => row.low > 0 && Math.abs(row.open - row.low) / row.low < 0.0025)
        .sort((a, b) => b.change_percent - a.change_percent)
        .slice(0, 8);
    case "arbitrage":
      return liquid
        .filter((row) => row.change_percent > 0.2)
        .sort((a, b) => b.volume - a.volume)
        .slice(0, 8);
    default:
      return [];
  }
}

/* ------------------------------------------------------------------ */
/* option chain maths                                                 */
/* ------------------------------------------------------------------ */

function summariseChain(
  underlying: { key: string; symbol: string; label: string },
  expiry: string,
  rows: any[],
  spot: number,
  changePercent: number
): ChainSummary | null {
  if (!rows.length) return null;
  const strikes = rows.map((row) => Number(row.strike_price)).filter((n) => Number.isFinite(n));
  if (!strikes.length) return null;
  const atm = strikes.reduce((best, strike) => (Math.abs(strike - spot) < Math.abs(best - spot) ? strike : best), strikes[0]);

  let callOi = 0;
  let putOi = 0;
  let ivSum = 0;
  let ivCount = 0;
  let maxPainCandidate = atm;
  let maxPainValue = Number.POSITIVE_INFINITY;
  let support = atm;
  let supportOi = 0;
  let resistance = atm;
  let resistanceOi = 0;

  for (const row of rows) {
    const strike = Number(row.strike_price);
    const c = row.call_options?.market_data || {};
    const p = row.put_options?.market_data || {};
    const cg = row.call_options?.option_greeks || {};
    const pg = row.put_options?.option_greeks || {};
    const coi = Number(c.oi || 0);
    const poi = Number(p.oi || 0);
    callOi += coi;
    putOi += poi;
    if (Math.abs(strike - atm) <= Math.max(atm * 0.01, 100)) {
      const civ = Number(cg.iv || 0);
      const piv = Number(pg.iv || 0);
      if (civ > 0) { ivSum += civ; ivCount += 1; }
      if (piv > 0) { ivSum += piv; ivCount += 1; }
    }
    if (strike <= spot && poi > supportOi) { support = strike; supportOi = poi; }
    if (strike >= spot && coi > resistanceOi) { resistance = strike; resistanceOi = coi; }
  }

  for (const candidate of strikes) {
    let pain = 0;
    for (const row of rows) {
      const strike = Number(row.strike_price);
      const coi = Number(row.call_options?.market_data?.oi || 0);
      const poi = Number(row.put_options?.market_data?.oi || 0);
      if (candidate > strike) pain += (candidate - strike) * coi;
      if (candidate < strike) pain += (strike - candidate) * poi;
    }
    if (pain < maxPainValue) {
      maxPainValue = pain;
      maxPainCandidate = candidate;
    }
  }

  return {
    ...underlying,
    expiry,
    spot,
    change_percent: changePercent,
    atm,
    atm_iv: ivCount ? ivSum / ivCount : 0,
    pcr: callOi ? putOi / callOi : 0,
    max_pain: maxPainCandidate,
    support,
    resistance,
    call_oi: callOi,
    put_oi: putOi,
  };
}

async function chainFor(
  underlying: { key: string; symbol: string; label: string },
  session: SessionState
): Promise<{ summary: ChainSummary | null; rows: any[]; expiries: string[]; expiry: string }> {
  return cached(`chain:${underlying.key}:${session.session_date}`, ttl(session, 15_000, 120_000), async () => {
    try {
      const all = await listExpiries(underlying.key);
      const today = session.session_date;
      // Contracts expiring today have no quotes once the session is closed.
      const live = session.is_open ? all.filter((e) => e >= today) : all.filter((e) => e > today);
      const pool = live.length ? live : all.filter((e) => e >= today);
      const expiry = (pool.length ? pool : all)[0];
      if (!expiry) return { summary: null, rows: [], expiries: all, expiry: "" };
      const rows = await optionChain(underlying.key, expiry);
      return { summary: null, rows, expiries: all, expiry };
    } catch {
      return { summary: null, rows: [], expiries: [], expiry: "" };
    }
  }).then(async (result) => {
    const master = await ensureMaster();
    const quoteKey = underlying.key;
    const quotes = await getQuotes([quoteKey], session);
    const q = quotes[quoteKey];
    const spot = q?.last_price || 0;
    return {
      ...result,
      summary: summariseChain(underlying, result.expiry, result.rows, spot, q?.change_percent || 0),
    };
  });
}

/* ------------------------------------------------------------------ */
/* futures                                                            */
/* ------------------------------------------------------------------ */

export interface FutureRow {
  key: string;
  symbol: string;
  underlying: string;
  expiry: number;
  ltp: number;
  change: number;
  change_percent: number;
  oi: number;
  oi_change: number;
  spot: number;
  premium: number;
  lot_size: number;
  segment: string;
}

const PREV_OI = new Map<string, number>();

async function futuresRows(session: SessionState): Promise<FutureRow[]> {
  return cached(`futures:${session.session_date}`, ttl(session), async () => {
    const master = await ensureMaster();
    const contracts = FUTURE_UNDERLYINGS.map((symbol) => master.nearestFuture(symbol)).filter(Boolean);
    const keys = contracts.map((c) => c!.instrument_key);
    const underlyings = Array.from(new Set(contracts.map((c) => c!.underlying_key)));
    const quotes = await getQuotes([...keys, ...underlyings, "NSE_INDEX|Nifty 50"], session);
    const out: FutureRow[] = [];
    for (const contract of contracts) {
      const q = quotes[contract!.instrument_key];
      if (!q || !(q.last_price > 0)) continue;
      const spotQuote = quotes[contract!.underlying_key];
      const spot = spotQuote?.last_price || q.last_price;
      const oi = q.oi || 0;
      const previousOi = PREV_OI.get(contract!.instrument_key);
      if (!previousOi && oi) PREV_OI.set(contract!.instrument_key, oi);
      out.push({
        key: contract!.instrument_key,
        symbol: contract!.trading_symbol,
        underlying: contract!.underlying_symbol,
        expiry: contract!.expiry,
        ltp: q.last_price,
        change: q.change,
        change_percent: q.change_percent,
        oi,
        oi_change: previousOi ? oi - previousOi : 0,
        spot,
        premium: q.last_price - spot,
        lot_size: contract!.lot_size,
        segment: contract!.segment,
      });
    }
    if (out.length) {
      for (const row of out) PREV_OI.set(row.key, row.oi);
    }
    return out;
  });
}

function commodityRows(session: SessionState) {
  return cached(`commodities:${session.session_date}`, ttl(session), async () => {
    const master = await ensureMaster();
    const contracts = COMMODITY_SYMBOLS.map((symbol) => master.nearestFuture(symbol)).filter(Boolean);
    const keys = contracts.map((c) => c!.instrument_key);
    const quotes = await getQuotes(keys, session);
    return contracts
      .map((contract) => {
        const q = quotes[contract!.instrument_key];
        if (!q || !(q.last_price > 0)) return null;
        return {
          key: contract!.instrument_key,
          symbol: contract!.underlying_symbol,
          trading_symbol: contract!.trading_symbol,
          expiry: contract!.expiry,
          lot_size: contract!.lot_size,
          ltp: q.last_price,
          change: q.change,
          change_percent: q.change_percent,
          volume: q.volume || 0,
          oi: q.oi || 0,
        };
      })
      .filter(Boolean) as Array<{
        key: string;
        symbol: string;
        trading_symbol: string;
        expiry: number;
        lot_size: number;
        ltp: number;
        change: number;
        change_percent: number;
        volume: number;
        oi: number;
      }>;
  });
}

/* ------------------------------------------------------------------ */
/* home payloads                                                      */
/* ------------------------------------------------------------------ */

export const IPO_ROWS = [
  { name: "Tata Capital", symbol: "TATACAP", segment: "Mainboard", open: "2026-11-12", close: "2026-11-14", price: "₹326–₹343", status: "Upcoming", subscription: "—" },
  { name: "NSDL", symbol: "NSDL", segment: "Mainboard", open: "2026-11-04", close: "2026-11-06", price: "₹760–₹800", status: "Listed", subscription: "3.42×" },
  { name: "HDB Financial Services", symbol: "HDBFS", segment: "Mainboard", open: "2026-11-02", close: "2026-11-04", price: "₹700–₹740", status: "Listed", subscription: "1.19×" },
  { name: "Wakefit Innovations", symbol: "WAKEFIT", segment: "Mainboard", open: "2026-11-17", close: "2026-11-19", price: "₹1,236–₹1,300", status: "Upcoming", subscription: "—" },
];

const ADVISORY_BASKETS = [
  { id: "quality", name: "Large cap quality", note: "50 bellwethers · low churn", icon: "star" },
  { id: "momentum", name: "Momentum leaders", note: "Trend + volume · 20 names", icon: "bolt" },
  { id: "dividend", name: "Dividend compounders", note: "Yield + payout history", icon: "shield" },
];

export async function getHomePayload(tab: string) {
  const session = sessionState();
  const [indices, rows, sectors, etfs, futures, commodities] = await Promise.all([
    indexRows(session),
    universeRows(session),
    sectorRows(session),
    etfRows(session),
    futuresRows(session),
    commodityRows(session),
  ]);

  const ranked = [...rows].sort((a, b) => b.change_percent - a.change_percent);
  const breadth = {
    advancing: rows.filter((r) => r.change > 0).length,
    declining: rows.filter((r) => r.change < 0).length,
    unchanged: rows.filter((r) => r.change === 0).length,
    total: rows.length,
  };

  const mostBought = [...rows].sort((a, b) => b.volume - a.volume).slice(0, 8);
  const gainers = ranked.slice(0, 8);
  const losers = [...ranked].reverse().slice(0, 8);
  const buzzing = [...rows]
    .filter((row) => row.volume > 0)
    .sort((a, b) => b.volume / Math.max(b.ltp, 1) - a.volume / Math.max(a.ltp, 1))
    .slice(0, 6);
  const under500 = rows.filter((row) => row.ltp < 500).sort((a, b) => b.change_percent - a.change_percent).slice(0, 6);
  const trendingStocks = [...rows]
    .filter((row) => INDEX_CONSTITUENT_SYMBOLS.has(row.symbol))
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 3);
  const momentum = gainers.slice(0, 6);

  const screeners = SCREENERS.map((screener) => ({
    ...screener,
    rows: screen(rows, screener.id).slice(0, 5),
  }));

  let options: Record<string, unknown> = {};
  if (tab === "ideas" || tab === "options") {
    const targets = tab === "options" ? OPTION_UNDERLYINGS : OPTION_UNDERLYINGS.slice(0, 4);
    const chains = await Promise.all(targets.map((underlying) => chainFor(underlying, session)));
    const summaries = chains.map((chain) => chain.summary).filter(Boolean) as ChainSummary[];

    const niftyChain = chains[0];
    const trendingOptions: OptionRow[] = [];
    for (const row of (niftyChain?.rows || []).slice(0, 120)) {
      for (const side of ["call_options", "put_options"] as const) {
        const leg = row[side];
        if (!leg?.market_data) continue;
        const data = leg.market_data;
        const prevOi = Number(data.prev_oi || 0);
        const oi = Number(data.oi || 0);
        trendingOptions.push({
          key: leg.instrument_key,
          symbol: String(leg.trading_symbol || `${niftyChain?.summary?.symbol} ${row.strike_price} ${side === "call_options" ? "CE" : "PE"}`),
          underlying: niftyChain?.summary?.symbol || "NIFTY",
          expiry: niftyChain?.expiry || "",
          strike: Number(row.strike_price),
          side: side === "call_options" ? "CE" : "PE",
          ltp: Number(data.ltp || 0),
          change: Number(data.close_price || 0) ? Number(data.ltp || 0) - Number(data.close_price || 0) : 0,
          change_percent: Number(data.close_price || 0)
            ? ((Number(data.ltp || 0) - Number(data.close_price || 0)) / Number(data.close_price || 0)) * 100
            : 0,
          oi,
          oi_change: oi - prevOi,
          volume: Number(data.volume || 0),
          iv: Number(leg.option_greeks?.iv || 0),
        });
      }
    }
    trendingOptions.sort((a, b) => b.volume - a.volume);
    const topOptions = trendingOptions.slice(0, 5);

    // OI ladder around ATM for the ideas page
    const atm = niftyChain?.summary?.atm || 0;
    const ladderRows = (niftyChain?.rows || [])
      .filter((row) => Math.abs(Number(row.strike_price) - atm) <= 250)
      .sort((a, b) => Number(b.strike_price) - Number(a.strike_price))
      .slice(0, 7)
      .map((row) => ({
        strike: Number(row.strike_price),
        call_oi: Number(row.call_options?.market_data?.oi || 0),
        put_oi: Number(row.put_options?.market_data?.oi || 0),
        call_oi_change: Number(row.call_options?.market_data?.oi || 0) - Number(row.call_options?.market_data?.prev_oi || 0),
        put_oi_change: Number(row.put_options?.market_data?.oi || 0) - Number(row.put_options?.market_data?.prev_oi || 0),
        call_ltp: Number(row.call_options?.market_data?.ltp || 0),
        put_ltp: Number(row.put_options?.market_data?.ltp || 0),
        call_iv: Number(row.call_options?.option_greeks?.iv || 0),
        put_iv: Number(row.put_options?.option_greeks?.iv || 0),
      }));

    options = {
      summaries: summaries.length ? summaries : OPTION_UNDERLYINGS.map((u) => ({
        ...u,
        expiry: "",
        spot: indices.find((i) => i.key === u.key)?.ltp || 0,
        change_percent: indices.find((i) => i.key === u.key)?.change_percent || 0,
        atm: 0,
        atm_iv: 0,
        pcr: 0,
        max_pain: 0,
        support: 0,
        resistance: 0,
        call_oi: 0,
        put_oi: 0,
      })),
      trending: topOptions,
      ladder: ladderRows,
      exclusions: [],
    };
  }

  const futureHeatmap = futures
    .filter((row) => row.segment === "NSE_FO")
    .sort((a, b) => b.change_percent - a.change_percent);
  const commodityMovers = [...commodities].sort((a, b) => b.change_percent - a.change_percent);
  const expiringSoon = [...commodities].sort((a, b) => a.expiry - b.expiry).slice(0, 6);

  return {
    tab,
    session,
    generated_at: new Date().toISOString(),
    indices,
    breadth,
    sections: {
      trendingStocks: {
        chips: [
          { id: "most-bought", label: "Most Bought", rows: mostBought },
          { id: "under-500", label: "Trending under ₹500", rows: under500 },
          { id: "gainers", label: "Top Gainers", rows: gainers },
          { id: "losers", label: "Top Losers", rows: losers },
        ],
        cards: trendingStocks,
      },
      movers: { gainers, losers },
      mostBought: { rows: mostBought },
      buzzing: { rows: buzzing },
      momentum: { rows: momentum },
      screeners: { tabs: screeners },
      under500: { rows: under500 },
      sectors: { rows: sectors },
      etfs: { rows: etfs },
      simpleInvesting: {
        baskets: [
          { id: "large", name: "Large cap", note: "Top 100 by market cap", return_1y: 18.4 },
          { id: "mid", name: "Mid cap", note: "Next 150 companies", return_1y: 24.1 },
          { id: "small", name: "Small cap", note: "High growth, higher risk", return_1y: 21.7 },
          { id: "gold", name: "Gold ETF", note: "Hedge against inflation", return_1y: 14.2 },
        ],
      },
      advisory: { baskets: ADVISORY_BASKETS },
      ipo: { rows: IPO_ROWS },
      options,
      futures: {
        rows: futures.filter((row) => row.segment === "NSE_FO"),
        heatmap: futureHeatmap.slice(0, 18),
        oiScanners: {
          oi_change: [...futures].filter((r) => r.segment === "NSE_FO").sort((a, b) => b.oi - a.oi).slice(0, 10),
          ltp: [...futures].filter((r) => r.segment === "NSE_FO").slice(0, 10),
          change: futureHeatmap.slice(0, 10),
        },
      },
      commodities: {
        rows: commodities,
        movers: commodityMovers.slice(0, 6),
        laggards: [...commodityMovers].reverse().slice(0, 6),
        expiring: expiringSoon,
        options: commodityMovers.slice(0, 5),
      },
    },
  };
}

export type HomePayload = Awaited<ReturnType<typeof getHomePayload>>;

/* ------------------------------------------------------------------ */
/* instrument detail helpers                                          */
/* ------------------------------------------------------------------ */

export async function resolveMany(symbols: string[]) {
  const master = await ensureMaster();
  return symbols.map((symbol) => master.equity(symbol, "NSE")).filter(Boolean);
}

export async function quoteOne(key: string): Promise<Quote | null> {
  const session = sessionState();
  const quotes = await getQuotes([key], session);
  return quotes[key] || null;
}

export async function sectorConstituents(): Promise<Record<string, string[]>> {
  // Static, India-specific baskets used by the sector drawer. Constituents are
  // intentionally broad — the paper terminal only needs a representative set.
  return {
    "Nifty Bank": ["HDFCBANK", "ICICIBANK", "SBIN", "AXISBANK", "KOTAKBANK", "BANKBARODA", "PNB", "CANBK", "INDUSINDBK", "AUBANK"],
    "Nifty IT": ["TCS", "INFY", "HCLTECH", "TECHM", "LTIM", "PERSISTENT", "COFORGE", "MPHASIS", "LTTS", "KPITTECH"],
    "Nifty Auto": ["MARUTI", "TATAMOTORS", "M&M", "BAJAJ-AUTO", "EICHERMOT", "HEROMOTOCO", "TVSMOTOR", "BHARATFORG", "MOTHERSON", "BOSCHLTD"],
    "Nifty Pharma": ["SUNPHARMA", "DRREDDY", "CIPLA", "DIVISLAB", "LUPIN", "AUROPHARMA", "ALKEM", "BIOCON", "GLENMARK", "ZYDUSLIFE"],
    "Nifty FMCG": ["HINDUNILVR", "ITC", "NESTLEIND", "BRITANNIA", "DABUR", "MARICO", "COLPAL", "GODREJCP", "TATACONSUM", "EMAMILTD"],
    "Nifty Metal": ["TATASTEEL", "JSWSTEEL", "HINDALCO", "VEDL", "JINDALSTEL", "SAIL", "NMDC", "NATIONALUM", "HINDCOPPER", "JSL"],
    "Nifty Energy": ["RELIANCE", "ONGC", "NTPC", "POWERGRID", "BPCL", "IOC", "GAIL", "TATAPOWER", "ADANIGREEN", "JSWENERGY"],
    "Nifty Realty": ["DLF", "LODHA", "OBEROIRLTY", "GODREJPROP", "PRESTIGE", "PHOENIXLTD", "BRIGADE", "SOBHA"],
    "PSU Bank": ["SBIN", "BANKBARODA", "PNB", "CANBK", "UNIONBANK", "IOB", "MAHABANK"],
    "Private Bank": ["HDFCBANK", "ICICIBANK", "AXISBANK", "KOTAKBANK", "INDUSINDBK", "FEDERALBNK", "IDFCFIRSTB", "AUBANK"],
    "Nifty Media": ["ZEEL", "SUNTV", "NAZARA", "PVRINOX", "SAREGAMA", "NETWORK18"],
    "Nifty Infra": ["LT", "ADANIPORTS", "GMRINFRA", "IRB", "RVNL", "NBCC", "IRCON", "POWERGRID"],
    "Consumption": ["HINDUNILVR", "ITC", "NESTLEIND", "TITAN", "DMART", "TRENT", "JUBLFOOD", "VBL"],
    "Chemicals": ["PIDILITIND", "SRF", "PIIND", "UPL", "DEEPAKNTR", "TATACHEM", "GNFC", "COROMANDEL"],
    "Capital Markets": ["BSE", "CDSL", "ANGELONE", "HDFCAMC", "ICICIGI", "JIOFIN", "CHOLAFIN", "MUTHOOTFIN"],
    "Defence": ["HAL", "BEL", "MAZDOCK", "COCHINSHIP", "BHEL", "SOLARINDS", "DATAPATTNS"],
    "EV & Mobility": ["TATAMOTORS", "M&M", "OLAELEC", "TVSMOTOR", "EXIDEIND", "SONACOMS", "AMBER"],
    "CPSE": ["ONGC", "NTPC", "POWERGRID", "COALINDIA", "BEL", "BHEL", "SAIL", "GAIL"],
    "Financial Services": ["JIOFIN", "BAJFINANCE", "BAJAJFINSV", "HDFCLIFE", "SBILIFE", "ICICIGI", "ICICIPRULI", "CHOLAFIN"],
    "Healthcare": ["MAXHEALTH", "APOLLOHOSP", "FORTIS", "SUNPHARMA", "DRREDDY", "CIPLA", "DIVISLAB", "LUPIN"],
  };
}

export function universeSymbolList(): string[] {
  return UNIVERSE_SYMBOLS;
}

export async function getScreenerPayload(limit = 24) {
  const session = sessionState();
  const rows = await universeRows(session);
  const ranked = [...rows].sort((a, b) => b.change_percent - a.change_percent);
  return {
    session,
    generated_at: new Date().toISOString(),
    breadth: {
      advancing: rows.filter((row) => row.change > 0).length,
      declining: rows.filter((row) => row.change < 0).length,
      unchanged: rows.filter((row) => row.change === 0).length,
      total: rows.length,
    },
    gainers: ranked.slice(0, limit),
    losers: ranked.slice(-limit).reverse(),
    screeners: SCREENERS.map((screener) => ({
      ...screener,
      rows: screen(rows, screener.id).slice(0, limit),
    })),
  };
}

export async function symbolByKey(key: string) {
  return resolveInstrument(key);
}
