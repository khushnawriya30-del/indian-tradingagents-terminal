"use client";

import { useEffect, useMemo, useState } from "react";

import { useApp } from "@/components/upstox/AppProvider";
import { Change, Empty, Section, Skeleton, Tag } from "@/components/upstox/ui";
import { compactInr, cx, expiryLabel, inr, pct } from "@/lib/client/format";
import type { HomeData, HomeFuture } from "@/lib/client/home-types";
import type { ChainPayload as ChainPayloadType } from "@/lib/types";

const OI_LAKH = 100_000;

function useFutures() {
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/market?tab=futures", { cache: "no-store" })
      .then(async (res) => {
        const payload = (await res.json()) as HomeData & { error?: string };
        if (!res.ok) throw new Error(payload.error || "Futures feed failed");
        if (alive) setData(payload);
      })
      .catch((reason) => {
        if (alive) setError(reason instanceof Error ? reason.message : "Futures feed failed");
      });
    return () => {
      alive = false;
    };
  }, []);
  return { data, error };
}

function futuresTable(rows: HomeFuture[], openOrder: ReturnType<typeof useApp>["openOrder"], limit = 30) {
  return (
    <div className="table-wrap">
      <table className="ux">
        <thead>
          <tr>
            <th style={{ width: "26%" }}>Contract</th>
            <th className="r">Spot</th>
            <th className="r">LTP</th>
            <th className="r">Premium</th>
            <th className="r">Change</th>
            <th className="r">OI</th>
            <th className="r">OI chg</th>
            <th className="r" style={{ width: 110 }}>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, limit).map((row) => (
            <tr key={row.key}>
              <td>
                <div className="symcell-stack">
                  <span className="name">{row.underlying}</span>
                  <span className="meta">{expiryLabel(row.expiry)} · lot {row.lot_size} <Tag tone="outline">{row.segment === "MCX_FO" ? "MCX" : "NFO"}</Tag></span>
                </div>
              </td>
              <td className="r num muted">{inr(row.spot)}</td>
              <td className="r num">{inr(row.ltp)}</td>
              <td className={cx("r num", row.premium >= 0 ? "pos" : "neg")}>{inr(row.premium)}</td>
              <td className="r"><Change value={row.change} percent={row.change_percent} /></td>
              <td className="r num">{compactInr(row.oi)}</td>
              <td className={cx("r num", row.oi_change >= 0 ? "pos" : "neg")}>{compactInr(row.oi_change)}</td>
              <td className="r">
                <span className="table-actions">
                  <button className="btn btn-buy" onClick={() => openOrder({ instrument_key: row.key, symbol: row.underlying, segment: row.segment, side: "BUY", price: row.ltp })}>Buy</button>
                  <button className="btn btn-sell" onClick={() => openOrder({ instrument_key: row.key, symbol: row.underlying, segment: row.segment, side: "SELL", price: row.ltp })}>Sell</button>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FutureSmartlistPage() {
  const { openOrder } = useApp();
  const { data, error } = useFutures();
  const [sort, setSort] = useState<"oi" | "change" | "premium" | "ltp">("oi");
  const rows = useMemo(() => {
    if (!data) return [];
    const copy = [...data.sections.futures.rows];
    if (sort === "change") return copy.sort((a, b) => b.change_percent - a.change_percent);
    if (sort === "premium") return copy.sort((a, b) => b.premium - a.premium);
    if (sort === "ltp") return copy.sort((a, b) => b.ltp - a.ltp);
    return copy.sort((a, b) => b.oi - a.oi);
  }, [data, sort]);

  return (
    <div className="content">
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Futures smartlist</h1>
          <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-2)" }}>Nearest NSE and MCX contracts, ranked by OI, premium and change</p>
        </div>
      </div>
      <div className="chips">
        {(["oi", "change", "premium", "ltp"] as const).map((id) => (
          <button key={id} className={cx("chip", sort === id && "active")} onClick={() => setSort(id)}>
            {id === "oi" ? "OI" : id === "change" ? "Change" : id === "premium" ? "Premium" : "LTP"}
          </button>
        ))}
      </div>
      {error && <div style={{ color: "var(--neg)", fontSize: 12, marginBottom: 12 }}>{error}</div>}
      {!data && !error ? <Skeleton height={420} /> : data ? <Section title="Contracts" note={`${rows.length} contracts`}>{futuresTable(rows, openOrder)}</Section> : null}
    </div>
  );
}

export function FutureHeatmapPage() {
  const { openOrder } = useApp();
  const { data, error } = useFutures();
  const rows = data?.sections.futures.heatmap || [];
  const max = Math.max(...rows.map((row) => Math.abs(row.change_percent)), 1);

  return (
    <div className="content">
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Futures heatmap</h1>
          <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-2)" }}>One glance at where the derivatives market is moving</p>
        </div>
      </div>
      {error && <div style={{ color: "var(--neg)", fontSize: 12, marginBottom: 12 }}>{error}</div>}
      {!data && !error ? <Skeleton height={320} /> : null}
      {data && (
        <Section title="Heatmap" note={`${rows.length} contracts`}>
          <div className="heatmap">
            {rows.map((row) => {
              const intensity = Math.min(1, Math.abs(row.change_percent) / max);
              const positive = row.change_percent >= 0;
              const base = positive ? [0, 122, 79] : [198, 50, 36];
              return (
                <div
                  key={row.key}
                  className="heat-cell"
                  style={{ background: `rgba(${base.join(",")},${0.12 + intensity * 0.75})`, color: intensity > 0.35 ? "#fff" : "var(--text)", minHeight: 74 }}
                  onClick={() => openOrder({ instrument_key: row.key, symbol: row.underlying, segment: row.segment, side: "BUY", price: row.ltp })}
                  role="button"
                  tabIndex={0}
                >
                  <b>{row.underlying}</b>
                  <span>{pct(row.change_percent)}</span>
                  <span style={{ fontSize: 9 }}>{inr(row.ltp)}</span>
                  <span style={{ fontSize: 9, opacity: 0.85 }}>OI {compactInr(row.oi)}</span>
                </div>
              );
            })}
          </div>
        </Section>
      )}
    </div>
  );
}

export function OIScannerPage() {
  const { openOrder } = useApp();
  const { data, error } = useFutures();
  const [metric, setMetric] = useState<"oi" | "oi_change" | "volume">("oi");
  const rows = useMemo(() => {
    if (!data) return [];
    const copy = [...data.sections.futures.rows];
    if (metric === "oi_change") return copy.sort((a, b) => b.oi_change - a.oi_change);
    return copy.sort((a, b) => b.oi - a.oi);
  }, [data, metric]);

  return (
    <div className="content">
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>OI scanner</h1>
          <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-2)" }}>Open-interest build-up across futures contracts</p>
        </div>
      </div>
      <div className="chips">
        <button className={cx("chip", metric === "oi" && "active")} onClick={() => setMetric("oi")}>Highest OI</button>
        <button className={cx("chip", metric === "oi_change" && "active")} onClick={() => setMetric("oi_change")}>OI gainers</button>
      </div>
      {error && <div style={{ color: "var(--neg)", fontSize: 12, marginBottom: 12 }}>{error}</div>}
      {!data && !error ? <Skeleton height={420} /> : data ? <Section title="Build-up" note={`${rows.length} contracts`}>{futuresTable(rows, openOrder)}</Section> : null}
    </div>
  );
}

export function OIAnalysisPage({ initialSymbol = "NIFTY" }: { initialSymbol?: string }) {
  const { openOrder } = useApp();
  const [symbol, setSymbol] = useState(initialSymbol.toUpperCase());
  const [payload, setPayload] = useState<ChainPayloadType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"oi" | "change">("oi");

  useEffect(() => {
    let alive = true;
    fetch(`/api/chain?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" })
      .then(async (res) => {
        const data = (await res.json()) as ChainPayloadType & { error?: string };
        if (!res.ok) throw new Error(data.error || "Chain failed");
        if (alive) setPayload(data);
      })
      .catch((reason) => {
        if (alive) setError(reason instanceof Error ? reason.message : "Chain failed");
      });
    return () => {
      alive = false;
    };
  }, [symbol]);

  const maxCall = Math.max(...(payload?.rows || []).map((row) => (mode === "oi" ? row.call.oi : Math.abs(row.call.oi - row.call.prev_oi))), 1);
  const maxPut = Math.max(...(payload?.rows || []).map((row) => (mode === "oi" ? row.put.oi : Math.abs(row.put.oi - row.put.prev_oi))), 1);
  const atm = payload?.spot
    ? (payload.rows || []).reduce((best, row) => (Math.abs(row.strike - (payload.spot || 0)) < Math.abs(best.strike - (payload.spot || 0)) ? row : best), payload.rows[0])
    : null;

  return (
    <div className="content">
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>OI analysis</h1>
          <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-2)" }}>Call vs put build-up, support and resistance from open interest</p>
        </div>
        <div className="spacer" />
        <select className="select" value={symbol} onChange={(event) => setSymbol(event.target.value)} style={{ width: 160 }}>
          {["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX"].map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
      </div>

      <div className="chips">
        <button className={cx("chip", mode === "oi" && "active")} onClick={() => setMode("oi")}>Total OI</button>
        <button className={cx("chip", mode === "change" && "active")} onClick={() => setMode("change")}>Change in OI</button>
        {payload && <Tag tone="outline">Expiry {expiryLabel(payload.expiry)}</Tag>}
        {payload?.spot && <Tag tone="outline">Spot {inr(payload.spot)}</Tag>}
      </div>

      {error && <div style={{ color: "var(--neg)", fontSize: 12, marginBottom: 12 }}>{error}</div>}
      {!payload && !error && <Skeleton height={420} />}

      {payload && (
        <>
          <div className="tile-grid c4" style={{ marginBottom: 16 }}>
            <div className="tile">
              <div className="stat-label">PCR</div>
              <div className="stat-value num" style={{ color: payload.totals.pcr >= 1 ? "var(--pos)" : "var(--neg)" }}>{payload.totals.pcr.toFixed(2)}</div>
            </div>
            <div className="tile">
              <div className="stat-label">Max pain</div>
              <div className="stat-value num">{payload.totals.max_pain ? inr(payload.totals.max_pain, 0) : "—"}</div>
            </div>
            <div className="tile">
              <div className="stat-label">Call OI</div>
              <div className="stat-value num pos">{compactInr(payload.totals.call_oi)}</div>
            </div>
            <div className="tile">
              <div className="stat-label">Put OI</div>
              <div className="stat-value num neg">{compactInr(payload.totals.put_oi)}</div>
            </div>
          </div>

          <Section title="Strike ladder" note="Calls on the right, puts on the left">
            <div className="table-wrap">
              <table className="ux">
                <thead>
                  <tr>
                    <th className="r">Put OI</th>
                    <th style={{ width: "30%" }}>Build-up</th>
                    <th className="c">Strike</th>
                    <th style={{ width: "30%" }}>Build-up</th>
                    <th className="r">Call OI</th>
                  </tr>
                </thead>
                <tbody>
                  {[...payload.rows].reverse().map((row) => {
                    const putValue = mode === "oi" ? row.put.oi : row.put.oi - row.put.prev_oi;
                    const callValue = mode === "oi" ? row.call.oi : row.call.oi - row.call.prev_oi;
                    return (
                      <tr key={row.strike} className={atm && row.strike === atm.strike ? "atm-row" : undefined}>
                        <td className={cx("r num", putValue >= 0 ? "pos" : "neg")}>{compactInr(putValue)}</td>
                        <td>
                          <div style={{ display: "flex", justifyContent: "flex-end" }}>
                            <span style={{ width: "100%", height: 8, background: "var(--bg-alt)", borderRadius: 3, overflow: "hidden" }}>
                              <i style={{ display: "block", height: "100%", width: `${Math.min(100, (Math.abs(putValue) / maxPut) * 100)}%`, marginLeft: "auto", background: "var(--pos)", opacity: 0.5 }} />
                            </span>
                          </div>
                        </td>
                        <td className="c">
                          <b className="num">{inr(row.strike, 0)}</b>
                          {atm && row.strike === atm.strike && <Tag tone="brand"> ATM</Tag>}
                        </td>
                        <td>
                          <span style={{ display: "block", width: "100%", height: 8, background: "var(--bg-alt)", borderRadius: 3, overflow: "hidden" }}>
                            <i style={{ display: "block", height: "100%", width: `${Math.min(100, (Math.abs(callValue) / maxCall) * 100)}%`, background: "var(--neg)", opacity: 0.5 }} />
                          </span>
                        </td>
                        <td className={cx("r num", callValue >= 0 ? "pos" : "neg")}>{compactInr(callValue)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
