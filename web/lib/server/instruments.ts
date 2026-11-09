import fs from "node:fs";
import path from "node:path";

import type { InstrumentHit } from "../types";
import { UNIVERSE_SYMBOLS } from "./universe";

export interface InstrumentRecord {
  instrument_key: string;
  trading_symbol: string;
  name: string;
  segment: string;
  exchange: string;
  isin?: string;
  is_index?: boolean;
}

export interface FutureRecord {
  instrument_key: string;
  trading_symbol: string;
  underlying_key: string;
  underlying_symbol: string;
  expiry: number;
  lot_size: number;
  asset_type: string;
  segment: string;
}

interface RawInstrument {
  k: string;
  s: string;
  n: string;
  i?: string;
  e?: string;
}

const PRIORITY = new Map<string, number>();
UNIVERSE_SYMBOLS.forEach((symbol, index) => PRIORITY.set(symbol, index));

function dataFile(name: string): string {
  return path.join(process.cwd(), "data", name);
}

function segmentFromKey(key: string): string {
  return key.split("|")[0] || "NSE_EQ";
}

function exchangeFromKey(key: string): string {
  if (key.startsWith("BSE")) return "BSE";
  if (key.startsWith("MCX")) return "MCX";
  return "NSE";
}

export class InstrumentMaster {
  private records: InstrumentRecord[] = [];
  private keyMap = new Map<string, InstrumentRecord>();
  private symMap = new Map<string, InstrumentRecord>();
  private futuresList: FutureRecord[] = [];
  private bySymbol = new Map<string, InstrumentRecord[]>();

  constructor() {
    this.loadEquities();
    this.loadIndexes();
    this.loadFutures();
  }

  private loadEquities() {
    try {
      const raw = fs.readFileSync(dataFile("instruments.json"), "utf8");
      const parsed = JSON.parse(raw) as { eq: RawInstrument[]; idx: RawInstrument[] };
      for (const r of parsed.eq) {
        this.addRecord({
          instrument_key: r.k,
          trading_symbol: r.s,
          name: r.n || r.s,
          segment: "NSE_EQ",
          exchange: "NSE",
          isin: r.i,
        });
      }
      this.indexRecords = parsed.idx || [];
    } catch {
      this.indexRecords = [];
    }
  }

  private indexRecords: RawInstrument[] = [];

  private loadIndexes() {
    for (const r of this.indexRecords) {
      this.addRecord({
        instrument_key: r.k,
        trading_symbol: r.s,
        name: r.n || r.s,
        segment: segmentFromKey(r.k),
        exchange: r.e || exchangeFromKey(r.k),
        is_index: true,
      });
    }
  }

  private loadFutures() {
    try {
      const raw = fs.readFileSync(dataFile("fno.json"), "utf8");
      const rows = JSON.parse(raw) as Array<[string, string, string, string, number, number, string, string]>;
      this.futuresList = rows.map((row) => ({
        instrument_key: row[0],
        trading_symbol: row[1],
        underlying_key: row[2],
        underlying_symbol: row[3],
        expiry: row[4],
        lot_size: row[5] || 1,
        asset_type: row[6],
        segment: row[7],
      }));
    } catch {
      this.futuresList = [];
    }
  }

  addRecord(r: InstrumentRecord) {
    this.records.push(r);
    this.keyMap.set(r.instrument_key, r);
    const sym = r.trading_symbol.toUpperCase();
    if (!this.symMap.has(sym)) this.symMap.set(sym, r);
    this.symMap.set(`${sym}.NS`, r);
    this.symMap.set(`${sym}.BO`, r);
    const bucket = this.bySymbol.get(sym) || [];
    bucket.push(r);
    this.bySymbol.set(sym, bucket);
  }

  get all(): InstrumentRecord[] {
    return this.records;
  }

  get futures(): FutureRecord[] {
    return this.futuresList;
  }

  equity(symbol: string, exchange = "NSE"): InstrumentRecord | null {
    const raw = (symbol || "").trim().toUpperCase().replace(".NS", "").replace(".BO", "");
    const bucket = this.bySymbol.get(raw) || [];
    const equityOnly = bucket.filter((r) => r.segment.endsWith("_EQ"));
    if (exchange === "BSE") {
      return equityOnly.find((r) => r.exchange === "BSE") || equityOnly[0] || null;
    }
    return equityOnly.find((r) => r.exchange === "NSE") || equityOnly[0] || null;
  }

  index(alias: string): InstrumentRecord | null {
    const raw = (alias || "").trim().toUpperCase();
    const direct = this.bySymbol.get(raw);
    if (direct?.length) {
      const idx = direct.find((r) => r.is_index);
      if (idx) return idx;
    }
    const normalized = raw.replace(/\s+/g, " ");
    const match = this.records.find(
      (r) => r.is_index && (r.trading_symbol.toUpperCase() === normalized || r.name.toUpperCase() === normalized)
    );
    return match || null;
  }

  resolve(keyOrSymbol: string): InstrumentRecord | null {
    const raw = (keyOrSymbol || "").trim().toUpperCase();
    if (!raw) return null;
    if (this.keyMap.has(raw)) return this.keyMap.get(raw)!;
    if (this.keyMap.has(keyOrSymbol)) return this.keyMap.get(keyOrSymbol)!;
    if (this.symMap.has(raw)) return this.symMap.get(raw)!;
    const clean = raw.replace(".NS", "").replace(".BO", "");
    if (this.symMap.has(clean)) return this.symMap.get(clean)!;
    return null;
  }

  search(query: string, limit = 20, segments?: string[]): InstrumentRecord[] {
    const q = query.trim().toUpperCase();
    if (!q) return [];
    const segSet = segments && segments.length ? new Set(segments) : null;
    const scored: Array<{ record: InstrumentRecord; score: number }> = [];

    for (const r of this.records) {
      if (segSet && !segSet.has(r.segment)) continue;
      const sym = r.trading_symbol.toUpperCase();
      const name = (r.name || "").toUpperCase();
      let score = Number.POSITIVE_INFINITY;
      if (sym === q) score = 0;
      else if (sym.startsWith(q)) score = 1;
      else if (name.startsWith(q)) score = 2;
      else if (sym.includes(q)) score = 3;
      else if (name.includes(q)) score = 4;
      if (!Number.isFinite(score)) continue;

      const priority = PRIORITY.get(sym);
      if (priority !== undefined) score -= 0.5;
      if (r.exchange === "BSE" && score >= 1) score += 0.4;
      if (r.is_index) score -= 0.2;
      scored.push({ record: r, score });
      if (scored.length > 900) break;
    }

    scored.sort((a, b) => a.score - b.score || a.record.trading_symbol.length - b.record.trading_symbol.length);
    return scored.slice(0, limit).map((row) => row.record);
  }

  futuresFor(underlyingSymbol: string): FutureRecord[] {
    const symbol = (underlyingSymbol || "").toUpperCase();
    return this.futuresList
      .filter((f) => f.underlying_symbol.toUpperCase() === symbol)
      .sort((a, b) => a.expiry - b.expiry);
  }

  nearestFuture(underlyingSymbol: string): FutureRecord | null {
    const today = Date.now() - 24 * 60 * 60 * 1000;
    const rows = this.futuresFor(underlyingSymbol).filter((f) => f.expiry >= today);
    return rows[0] || this.futuresFor(underlyingSymbol)[0] || null;
  }
}

let masterSingleton: InstrumentMaster | null = null;

export async function ensureMaster(): Promise<InstrumentMaster> {
  if (!masterSingleton) masterSingleton = new InstrumentMaster();
  return masterSingleton;
}

export function toHit(ins: InstrumentRecord): InstrumentHit {
  return {
    instrument_key: ins.instrument_key,
    trading_symbol: ins.trading_symbol,
    symbol: ins.trading_symbol,
    display: ins.trading_symbol,
    name: ins.name || ins.trading_symbol,
    segment: ins.segment,
    exchange: ins.exchange,
    is_index: ins.is_index || ins.segment.includes("INDEX"),
  };
}

export async function resolveInstrument(keyOrSymbol: string): Promise<InstrumentRecord | null> {
  const master = await ensureMaster();
  const hit = master.resolve(keyOrSymbol);
  if (hit) return hit;

  const clean = keyOrSymbol.replace(".NS", "").replace(".BO", "").trim().toUpperCase();
  if (clean.startsWith("NSE_INDEX|") || clean.startsWith("BSE_INDEX|") || clean.startsWith("NSE_EQ|") || clean.startsWith("BSE_EQ|")) {
    const sym = clean.split("|")[1] || clean;
    return {
      instrument_key: keyOrSymbol,
      trading_symbol: sym,
      name: sym,
      segment: segmentFromKey(keyOrSymbol),
      exchange: exchangeFromKey(keyOrSymbol),
      is_index: keyOrSymbol.includes("INDEX"),
    };
  }
  return {
    instrument_key: `NSE_EQ|${clean}`,
    trading_symbol: clean,
    name: clean,
    segment: "NSE_EQ",
    exchange: "NSE",
    is_index: false,
  };
}

export function yahooSymbol(symbol: string, instrument?: any): string {
  const upper = (symbol || "").trim().toUpperCase();
  if (upper.endsWith(".NS") || upper.endsWith(".BO")) return upper;
  if (instrument?.exchange === "BSE" || instrument?.segment?.startsWith("BSE")) {
    return `${upper}.BO`;
  }
  return `${upper}.NS`;
}

export function nseSymbol(symbol: string): string {
  return (symbol || "")
    .trim()
    .toUpperCase()
    .replace(".NS", "")
    .replace(".BO", "");
}
