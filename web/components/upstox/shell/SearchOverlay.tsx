"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ChainPayload } from "@/lib/types";
import { useApp } from "../AppProvider";
import { ClockIcon, CloseIcon, PlusIcon, SearchIcon } from "../icons";
import { Logo } from "../Logo";
import { cx } from "@/lib/client/format";

interface Hit {
  instrument_key: string;
  trading_symbol: string;
  symbol: string;
  display: string;
  name: string;
  segment: string;
  exchange: string;
  is_index?: boolean;
}

interface RecentRow {
  key: string;
  symbol: string;
  name: string;
  segment: string;
  label?: string;
  exchange?: string;
}

const TABS = [
  { id: "all", label: "All", segments: "" },
  { id: "stocks", label: "Stocks", segments: "NSE_EQ,BSE_EQ" },
  { id: "fno", label: "F&O", segments: "NSE_FO,BSE_FO" },
  { id: "commodity", label: "Commodity", segments: "MCX_FO" },
  { id: "etfs", label: "ETFs", segments: "NSE_EQ,BSE_EQ" },
] as const;

type TabID = (typeof TABS)[number]["id"];

const RECENT_KEY = "upstox.recent.v1";

function segmentLabel(segment: string): string {
  if (segment.includes("INDEX")) return "Index";
  if (segment === "MCX_FO") return "Commodity";
  if (segment.includes("_FO")) return "F&O";
  return "Stocks";
}

function loadRecent(): RecentRow[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.slice(0, 8) : [];
  } catch {
    return [];
  }
}

export function SearchOverlay() {
  const router = useRouter();
  const { searchOpen, setSearchOpen, addWatch, openOrder, notify } = useApp();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<TabID>("all");
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<RecentRow[]>([]);
  const [trending, setTrending] = useState<RecentRow[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const remember = useCallback((row: RecentRow) => {
    try {
      const current = loadRecent().filter((item) => item.key !== row.key);
      const next = [row, ...current].slice(0, 8);
      window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      setRecent(next);
    } catch {
      // storage is best effort
    }
  }, []);

  useEffect(() => {
    if (!searchOpen) return;
    setQuery("");
    setHits([]);
    setActive(0);
    setTab("all");
    setRecent(loadRecent());
    const timer = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(timer);
  }, [searchOpen]);

  useEffect(() => {
    if (!searchOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSearchOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchOpen, setSearchOpen]);

  useEffect(() => {
    if (!searchOpen || trending.length) return;
    let alive = true;
    (async () => {
      const rows: RecentRow[] = [];
      try {
        const res = await fetch("/api/chain?symbol=NIFTY", { cache: "no-store" });
        const data = (await res.json()) as ChainPayload & { error?: string };
        if (res.ok && data?.rows?.length && data.spot) {
          const atm = data.rows.reduce(
            (best, row) => (Math.abs(row.strike - data.spot) < Math.abs(best.strike - data.spot) ? row : best),
            data.rows[0]
          );
          rows.push({
            key: atm.call.instrument_key,
            symbol: "NIFTY",
            name: `NIFTY ${atm.strike} PE`,
            segment: "NSE_FO",
            label: "Options",
          });
          rows.push({
            key: atm.put.instrument_key,
            symbol: "NIFTY",
            name: `NIFTY ${atm.strike} CE`,
            segment: "NSE_FO",
            label: "Options",
          });
        }
      } catch {
        // chain is optional here
      }
      try {
        const res = await fetch("/api/search?q=SBIN&limit=1", { cache: "no-store" });
        const data = (await res.json()) as { results?: Hit[] };
        const sbin = data.results?.[0];
        if (sbin) {
          rows.push({
            key: sbin.instrument_key,
            symbol: sbin.symbol,
            name: sbin.name || sbin.symbol,
            segment: sbin.segment,
            exchange: sbin.exchange,
          });
        }
      } catch {
        // ignore
      }
      if (alive) setTrending(rows);
    })();
    return () => {
      alive = false;
    };
  }, [searchOpen, trending.length]);

  useEffect(() => {
    if (!searchOpen) return;
    const q = query.trim();
    if (!q) {
      setHits([]);
      return;
    }
    const segments = TABS.find((item) => item.id === tab)?.segments || "";
    setLoading(true);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q, limit: "30" });
        if (segments) params.set("segments", segments);
        const res = await fetch(`/api/search?${params.toString()}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        const data = (await res.json()) as { results?: Hit[] };
        const rows = data.results || [];
        setHits(
          tab === "etfs"
            ? rows.filter((hit) => `${hit.symbol} ${hit.name}`.toUpperCase().includes("ETF"))
            : rows
        );
        setActive(0);
      } catch {
        // aborted
      } finally {
        setLoading(false);
      }
    }, 160);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, tab, searchOpen]);

  const go = useCallback(
    (row: RecentRow) => {
      remember(row);
      setSearchOpen(false);
      router.push(`/trading-charts?symbol=${encodeURIComponent(row.key)}`);
    },
    [remember, router, setSearchOpen]
  );

  const list = useMemo<RecentRow[]>(() => {
    if (query.trim()) {
      return hits.map((hit) => ({
        key: hit.instrument_key,
        symbol: hit.symbol,
        name: hit.name || hit.display || hit.symbol,
        segment: hit.segment,
        exchange: hit.exchange,
      }));
    }
    return [];
  }, [hits, query]);

  if (!searchOpen) return null;

  const showEmptyState = !query.trim();

  return (
    <>
      <div className="scrim" onClick={() => setSearchOpen(false)} />
      <div className="modal search-modal" role="dialog" aria-label="Search instruments">
        <div className="search-head">
          <SearchIcon size={18} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((v) => Math.min(v + 1, Math.max(list.length - 1, 0)));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((v) => Math.max(v - 1, 0));
              } else if (event.key === "Enter") {
                const hit = list[active];
                if (hit) go(hit);
              }
            }}
            placeholder="Search for Indices, Stocks, F&O and Commodities"
            aria-label="Search instruments"
          />
          <button className="icon-btn" onClick={() => setSearchOpen(false)} aria-label="Close search">
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="search-tabs">
          {TABS.map((item) => (
            <button
              key={item.id}
              className={cx("search-tab", tab === item.id && "active")}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="search-body scroll-thin">
          {showEmptyState ? (
            <>
              {recent.length > 0 && (
                <>
                  <div className="search-group">Recently Viewed</div>
                  {recent.map((row) => (
                    <SearchRow
                      key={`recent-${row.key}`}
                      row={row}
                      onOpen={() => go(row)}
                      onBuy={() => {
                        remember(row);
                        setSearchOpen(false);
                        openOrder({
                          instrument_key: row.key,
                          symbol: row.symbol,
                          name: row.name,
                          segment: row.segment,
                          side: "BUY",
                        });
                      }}
                      onSell={() => {
                        remember(row);
                        setSearchOpen(false);
                        openOrder({
                          instrument_key: row.key,
                          symbol: row.symbol,
                          name: row.name,
                          segment: row.segment,
                          side: "SELL",
                        });
                      }}
                      onWatch={() => addWatch(row.key)}
                    />
                  ))}
                </>
              )}

              {trending.length > 0 && (
                <>
                  <div className="search-group">Trending Now</div>
                  {trending.map((row) => (
                    <SearchRow
                      key={`trend-${row.key}`}
                      row={row}
                      onOpen={() => go(row)}
                      onBuy={() => {
                        remember(row);
                        setSearchOpen(false);
                        openOrder({
                          instrument_key: row.key,
                          symbol: row.symbol,
                          name: row.name,
                          segment: row.segment,
                          side: "BUY",
                        });
                      }}
                      onSell={() => {
                        remember(row);
                        setSearchOpen(false);
                        openOrder({
                          instrument_key: row.key,
                          symbol: row.symbol,
                          name: row.name,
                          segment: row.segment,
                          side: "SELL",
                        });
                      }}
                      onWatch={() => addWatch(row.key)}
                    />
                  ))}
                </>
              )}

              {!recent.length && !trending.length && (
                <div className="search-hint">
                  Type a symbol like <b>RELIANCE</b>, <b>SBIN</b> or an index like <b>NIFTY</b>.
                </div>
              )}
            </>
          ) : (
            <>
              <div className="search-group">{loading ? "Searching…" : `${list.length} result${list.length === 1 ? "" : "s"}`}</div>
              {list.map((row, index) => (
                <div key={row.key} className={cx("search-row-wrap", index === active && "active")} onMouseEnter={() => setActive(index)}>
                  <SearchRow
                    row={row}
                    onOpen={() => go(row)}
                    onBuy={() => {
                      remember(row);
                      setSearchOpen(false);
                      openOrder({
                        instrument_key: row.key,
                        symbol: row.symbol,
                        name: row.name,
                        segment: row.segment,
                        side: "BUY",
                      });
                    }}
                    onSell={() => {
                      remember(row);
                      setSearchOpen(false);
                      openOrder({
                        instrument_key: row.key,
                        symbol: row.symbol,
                        name: row.name,
                        segment: row.segment,
                        side: "SELL",
                      });
                    }}
                    onWatch={() => addWatch(row.key)}
                  />
                </div>
              ))}
              {!loading && !list.length && (
                <div className="search-hint">
                  No instruments matched “{query}”. Try a symbol like <b>RELIANCE</b> or an index like <b>NIFTY</b>.
                </div>
              )}
            </>
          )}
        </div>

        <div className="search-foot">
          <span>Quotes stream from the official Upstox market-data API.</span>
          <button
            className="btn"
            onClick={() => {
              if (!query.trim()) {
                notify({ tone: "warn", title: "Type a symbol first" });
                return;
              }
              setSearchOpen(false);
              router.push(`/screeners?q=${encodeURIComponent(query.trim())}`);
            }}
          >
            Screen results
          </button>
        </div>
      </div>
    </>
  );
}

function SearchRow({
  row,
  onOpen,
  onBuy,
  onSell,
  onWatch,
}: {
  row: RecentRow;
  onOpen: () => void;
  onBuy: () => void;
  onSell: () => void;
  onWatch: () => void;
}) {
  return (
    <div className="search-row" onClick={onOpen} role="button" tabIndex={0} onKeyDown={(event) => event.key === "Enter" && onOpen()}>
      <Logo symbol={row.symbol} exchange={row.exchange} size={40} radius={8} label={row.label || row.symbol} />
      <div className="search-row-main">
        <div className="search-row-title">{row.name}</div>
        <div className="search-row-meta">
          {row.label || segmentLabel(row.segment)}
          <span className="dot-sep">·</span>
          {row.symbol}
        </div>
      </div>
      <div className="search-row-actions">
        <button
          className="trade-btn buy"
          onClick={(event) => {
            event.stopPropagation();
            onBuy();
          }}
          aria-label="Buy"
        >
          B
        </button>
        <button
          className="trade-btn sell"
          onClick={(event) => {
            event.stopPropagation();
            onSell();
          }}
          aria-label="Sell"
        >
          S
        </button>
        <button
          className="soft-btn"
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
          aria-label="Open chart"
        >
          <ClockIcon size={14} />
        </button>
        <button
          className="soft-btn"
          onClick={(event) => {
            event.stopPropagation();
            onWatch();
          }}
          aria-label="Add to watchlist"
        >
          <PlusIcon size={14} />
        </button>
      </div>
    </div>
  );
}
