"use client";

import { useEffect, useMemo, useState } from "react";

import { useApp } from "@/components/upstox/AppProvider";
import { SearchIcon, SparkleIcon } from "@/components/upstox/icons";
import { Change, Empty, Section, Skeleton, Tag } from "@/components/upstox/ui";
import { compactInr, cx, inr, pct } from "@/lib/client/format";
import type { HomeStock } from "@/lib/client/home-types";

interface ScreenerPayload {
  generated_at: string;
  breadth: { advancing: number; declining: number; unchanged: number; total: number };
  gainers: HomeStock[];
  losers: HomeStock[];
  screeners: Array<{ id: string; label: string; rows: HomeStock[] }>;
}

export function ScreenersPage() {
  const { openOrder } = useApp();
  const [data, setData] = useState<ScreenerPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState("bullish");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"screeners" | "gainers" | "losers">("screeners");

  useEffect(() => {
    let alive = true;
    fetch("/api/screeners", { cache: "no-store" })
      .then(async (res) => {
        const payload = (await res.json()) as ScreenerPayload & { error?: string };
        if (!res.ok) throw new Error(payload.error || "Screener feed failed");
        if (alive) setData(payload);
      })
      .catch((reason) => {
        if (alive) setError(reason instanceof Error ? reason.message : "Screener feed failed");
      });
    return () => {
      alive = false;
    };
  }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    const pool = view === "gainers" ? data.gainers : view === "losers" ? data.losers : data.screeners.find((item) => item.id === tab)?.rows || [];
    const trimmed = query.trim().toLowerCase();
    return trimmed ? pool.filter((row) => `${row.symbol} ${row.name}`.toLowerCase().includes(trimmed)) : pool;
  }, [data, tab, view, query]);

  return (
    <div className="content">
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Screeners</h1>
          <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-2)" }}>
            Technical and momentum screens over the liquid NSE universe
          </p>
        </div>
        <div className="spacer" />
        <div style={{ position: "relative", width: 220 }}>
          <span style={{ position: "absolute", left: 10, top: 9, color: "var(--text-2)" }}>
            <SearchIcon size={13} />
          </span>
          <input className="input" style={{ paddingLeft: 30 }} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter results" />
        </div>
      </div>

      {data && (
        <div className="chips">
          <button className={cx("chip", view === "screeners" && "active")} onClick={() => setView("screeners")}>Screeners</button>
          <button className={cx("chip", view === "gainers" && "active")} onClick={() => setView("gainers")}>Top gainers</button>
          <button className={cx("chip", view === "losers" && "active")} onClick={() => setView("losers")}>Top losers</button>
          <span className="spacer" />
          <Tag tone="outline">{data.breadth.advancing} adv · {data.breadth.declining} dec</Tag>
        </div>
      )}

      {view === "screeners" && data && (
        <div className="chips">
          {data.screeners.map((screener) => (
            <button key={screener.id} className={cx("chip", tab === screener.id && "active")} onClick={() => setTab(screener.id)}>
              {screener.label}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div style={{ border: "1px solid var(--neg)", background: "var(--neg-subtle)", color: "var(--neg)", borderRadius: 8, padding: "8px 12px", fontSize: 12, marginBottom: 14 }}>
          {error}
        </div>
      )}

      {!data && !error && <Skeleton height={420} />}

      {data && (
        <Section
          title={view === "screeners" ? data.screeners.find((item) => item.id === tab)?.label || "Screen" : view === "gainers" ? "Top gainers" : "Top losers"}
          note={`${rows.length} results`}
          actions={
            <button
              className="btn btn-sm"
              style={{ gap: 4 }}
              onClick={() => {
                const first = rows[0];
                if (!first) return;
                window.location.href = `/trading-charts?symbol=${encodeURIComponent(first.key)}`;
              }}
            >
              <SparkleIcon size={12} /> Open top name
            </button>
          }
        >
          {rows.length ? (
            <div className="table-wrap">
              <table className="ux">
                <thead>
                  <tr>
                    <th style={{ width: "32%" }}>Instrument</th>
                    <th className="r">LTP</th>
                    <th className="r">Change</th>
                    <th className="r">Open</th>
                    <th className="r">High</th>
                    <th className="r">Low</th>
                    <th className="r">Volume</th>
                    <th className="r" style={{ width: 150 }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.key}>
                      <td>
                        <div className="symcell">
                          <div className="symcell-text">
                            <div className="symcell-name">{row.symbol}</div>
                            <div className="symcell-meta">{row.name}</div>
                          </div>
                        </div>
                      </td>
                      <td className="r num">{inr(row.ltp)}</td>
                      <td className="r"><Change value={row.change} percent={row.change_percent} /></td>
                      <td className="r num muted">{inr(row.open)}</td>
                      <td className="r num pos">{inr(row.high)}</td>
                      <td className="r num neg">{inr(row.low)}</td>
                      <td className="r num muted">{compactInr(row.volume)}</td>
                      <td className="r">
                        <span className="table-actions">
                          <button
                            className="btn btn-buy"
                            onClick={() => openOrder({ instrument_key: row.key, symbol: row.symbol, name: row.name, segment: row.segment, side: "BUY", price: row.ltp })}
                          >
                            Buy
                          </button>
                          <button
                            className="btn btn-sell"
                            onClick={() => openOrder({ instrument_key: row.key, symbol: row.symbol, name: row.name, segment: row.segment, side: "SELL", price: row.ltp })}
                          >
                            Sell
                          </button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No names match this screen" hint="Screens refresh with the market feed; try another tab." />
          )}
        </Section>
      )}
    </div>
  );
}
