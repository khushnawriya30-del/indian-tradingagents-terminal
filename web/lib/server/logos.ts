import fs from "node:fs";
import path from "node:path";

import { dataDir } from "./env";

const CACHE_FILE = "logos.json";
const SEARCH_URL = "https://symbol-search.tradingview.com/symbol_search/";
const LOGO_BASE = "https://s3-symbol-logo.tradingview.com";

let memory: Record<string, string | null> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
const inflight = new Map<string, Promise<string | null>>();

function cachePath(): string {
  return path.join(dataDir(), CACHE_FILE);
}

function load(): Record<string, string | null> {
  if (memory) return memory;
  let loaded: Record<string, string | null> = {};
  try {
    const raw = JSON.parse(fs.readFileSync(cachePath(), "utf-8"));
    if (raw && typeof raw === "object") loaded = raw as Record<string, string | null>;
  } catch {
    loaded = {};
  }
  memory = loaded;
  return loaded;
}

function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      fs.writeFileSync(cachePath(), JSON.stringify(load()), "utf-8");
    } catch {
      // best effort
    }
  }, 1500);
}

export type LogoKind = "stock" | "index";

export function logoUrl(logoid: string): string {
  // TradingView index logos live under a sub-folder slug such as "indices/nifty-50".
  const slug = logoid
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `${LOGO_BASE}/${slug}--big.svg`;
}

async function search(symbol: string, exchange: string, kind: LogoKind): Promise<string | null> {
  const type = kind === "index" ? "index" : "stock";
  const url = `${SEARCH_URL}?text=${encodeURIComponent(symbol)}&exchange=${encodeURIComponent(exchange)}&type=${type}`;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        Origin: "https://www.tradingview.com",
        Referer: "https://www.tradingview.com/",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const list = (await res.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(list)) return null;
    const cleaned = list.map((item) => ({
      symbol: String(item.symbol || "").replace(/<\/?em>/g, "").toUpperCase(),
      logoid: item.logoid ? String(item.logoid) : "",
      type: String(item.type || ""),
      exchange: String(item.exchange || ""),
    }));
    const exact = cleaned.find(
      (item) =>
        item.symbol === symbol.toUpperCase() &&
        item.logoid &&
        item.exchange === exchange &&
        (kind === "index" ? item.type === "index" : item.type !== "index")
    );
    if (exact) return exact.logoid;
    const loose = cleaned.find(
      (item) => item.logoid && item.exchange === exchange && (kind === "index" ? item.type === "index" : item.type !== "index")
    );
    return loose?.logoid || null;
  } catch {
    return null;
  }
}

const queue: Array<() => void> = [];
let running = 0;
const MAX_CONCURRENT = 3;

function schedule<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      running += 1;
      task()
        .then(resolve, reject)
        .finally(() => {
          running -= 1;
          const next = queue.shift();
          if (next) next();
        });
    };
    if (running < MAX_CONCURRENT) run();
    else queue.push(run);
  });
}

export async function resolveLogoId(
  symbol: string,
  exchange = "NSE",
  kind: LogoKind = "stock"
): Promise<string | null> {
  const clean = symbol.trim().toUpperCase();
  if (!clean) return null;
  const store = load();
  const key = kind === "index" ? `${exchange}:index:${clean}` : `${exchange}:${clean}`;
  if (key in store) return store[key];

  const existing = inflight.get(key);
  if (existing) return existing;

  const task = schedule(() => search(clean, exchange, kind)).then((result) => {
    const current = load();
    current[key] = result;
    schedulePersist();
    inflight.delete(key);
    return result;
  });

  inflight.set(key, task);
  return task;
}
