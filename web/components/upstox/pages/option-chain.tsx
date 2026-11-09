"use client";

import { useEffect, useMemo, useState } from "react";

import { useApp } from "@/components/upstox/AppProvider";
import { ChevronDown, FilterIcon, RefreshIcon } from "@/components/upstox/icons";
import { Change, Empty, Section, Skeleton, Tag } from "@/components/upstox/ui";
import { compactInr, cx, expiryLabel, inr, pct } from "@/lib/client/format";
import type { ChainPayload, ChainRow } from "@/lib/types";

const UNDERLYINGS = [
  { symbol: "NIFTY", label: "NIFTY 50" },
  { symbol: "BANKNIFTY", label: "BANKNIFTY" },
  { symbol: "FINNIFTY", label: "FINNIFTY" },
  { symbol: "MIDCPNIFTY", label: "MIDCPNIFTY" },
  { symbol: "SENSEX", label: "SENSEX" },
];

export function OptionChainPage({ initialSymbol = "NIFTY" }: { initialSymbol?: string }) {
  const { openOrder } = useApp();
  const [symbol, setSymbol] = useState(initialSymbol.toUpperCase());
  const [expiry, setExpiry] = useState<string | null>(null);
  const [payload, setPayload] = useState<ChainPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [width, setWidth] = useState(6);
  const [showGreeks, setShowGreeks] = useState(false);

  async function load(nextSymbol = symbol, nextExpiry = expiry, silent = false) {
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams({ symbol: nextSymbol });
      if (nextExpiry) params.set("expiry", nextExpiry);
      const res = await fetch(`/api/chain?${params.toString()}`, { cache: "no-store" });
      const data = (await res.json()) as ChainPayload & { error?: string };
      if (!res.ok) throw new Error(data.error || `Chain failed (${res.status})`);
      setPayload(data);
      setExpiry(data.expiry);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Chain unavailable");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(symbol, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (!payload) return;
      load(symbol, payload.expiry, true);
    }, 15_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, payload?.expiry]);

  const rows = useMemo(() => {
    if (!payload?.rows?.length) return [];
    const spot = payload.spot || 0;
    const atmIndex = payload.rows.reduce(
      (best, row, index) => (Math.abs(row.strike - spot) < Math.abs(payload.rows[best].strike - spot) ? index : best),
      0
    );
    const start = Math.max(0, atmIndex - width);
    return payload.rows.slice(start, start + width * 2 + 1);
  }, [payload, width]);

  const atm = payload?.spot
    ? rows.reduce((best, row) => (Math.abs(row.strike - (payload.spot || 0)) < Math.abs(best - (payload.spot || 0)) ? row.strike : best), rows[0]?.strike || 0)
    : 0;

  const maxCallOi = Math.max(...rows.map((row) => row.call.oi), 1);
  const maxPutOi = Math.max(...rows.map((row) => row.put.oi), 1);

  return (
    <div className="content">
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Option chain</h1>
          <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-2)" }}>
            Live NSE chain · Greeks, OI, PCR and max pain
          </p>
        </div>
        <div className="spacer" />
        <button className="btn btn-sm" onClick={() => load(symbol, expiry)} style={{ gap: 4 }}>
          <RefreshIcon size={13} /> Refresh
        </button>
        <button className={cx("btn btn-sm", showGreeks && "btn-subtle")} onClick={() => setShowGreeks((v) => !v)} style={{ gap: 4 }}>
          <FilterIcon size={13} /> Greeks
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 10, color: "var(--text-2)" }}>Strikes</span>
          <select className="select" style={{ width: 80, height: 30 }} value={width} onChange={(event) => setWidth(Number(event.target.value))}>
            {[3, 6, 10, 15].map((value) => (
              <option key={value} value={value}>±{value}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="chips">
        {UNDERLYINGS.map((item) => (
          <button key={item.symbol} className={cx("chip", symbol === item.symbol && "active")} onClick={() => setSymbol(item.symbol)}>
            {item.label}
          </button>
        ))}
        {payload?.expiries?.length ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
            <span style={{ fontSize: 10, color: "var(--text-2)" }}>Expiry</span>
            <select className="select" style={{ height: 30 }} value={payload.expiry} onChange={(event) => { setExpiry(event.target.value); load(symbol, event.target.value); }}>
              {payload.expiries.map((item) => (
                <option key={item} value={item}>{expiryLabel(item)}</option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      {error && (
        <div style={{ border: "1px solid var(--neg)", background: "var(--neg-subtle)", borderRadius: 8, padding: "10px 12px", fontSize: 12, color: "var(--neg)", marginBottom: 16 }}>
          {error}
        </div>
      )}

      {loading && !payload && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Skeleton height={70} />
          <Skeleton height={420} />
        </div>
      )}

      {payload && (
        <>
          <div className="tile-grid c4" style={{ marginBottom: 18 }}>
            <div className="tile">
              <div className="stat-label">{payload.underlying} spot</div>
              <div className="stat-value num" style={{ color: (payload.rows[0]?.call.change ?? 0) >= 0 ? "var(--pos)" : "var(--neg)" }}>
                {payload.spot ? inr(payload.spot) : "—"}
              </div>
              <div className="stat-label">Expiry {expiryLabel(payload.expiry)}</div>
            </div>
            <div className="tile">
              <div className="stat-label">PCR (OI)</div>
              <div className="stat-value num" style={{ color: payload.totals.pcr >= 1 ? "var(--pos)" : "var(--neg)" }}>
                {payload.totals.pcr.toFixed(2)}
              </div>
              <div className="stat-label">{payload.totals.pcr >= 1 ? "Put writers dominate" : "Call writers dominate"}</div>
            </div>
            <div className="tile">
              <div className="stat-label">Max pain</div>
              <div className="stat-value num">{payload.totals.max_pain ? inr(payload.totals.max_pain, 0) : "—"}</div>
              <div className="stat-label">Expiry pin</div>
            </div>
            <div className="tile">
              <div className="stat-label">Total OI</div>
              <div className="stat-value num">{compactInr(payload.totals.call_oi + payload.totals.put_oi)}</div>
              <div className="stat-label">
                <span className="pos">{compactInr(payload.totals.call_oi)} CE</span> · <span className="neg">{compactInr(payload.totals.put_oi)} PE</span>
              </div>
            </div>
          </div>

          {rows.length ? (
            <div className="table-wrap">
              <table className="chain-table">
                <thead>
                  <tr>
                    <th colSpan={showGreeks ? 7 : 5} style={{ textAlign: "center", background: "var(--pos-subtle)", color: "var(--pos)" }}>CALLS</th>
                    <th style={{ textAlign: "center" }}>STRIKE</th>
                    <th colSpan={showGreeks ? 7 : 5} style={{ textAlign: "center", background: "var(--neg-subtle)", color: "var(--neg)" }}>PUTS</th>
                  </tr>
                  <tr>
                    <th className="r">OI</th>
                    <th className="r">Chg OI</th>
                    <th className="r">Vol</th>
                    <th className="r">IV</th>
                    {showGreeks && <th className="r">Δ</th>}
                    {showGreeks && <th className="r">Θ</th>}
                    <th className="r">LTP</th>
                    <th style={{ textAlign: "center" }}>Strike</th>
                    <th className="r">LTP</th>
                    {showGreeks && <th className="r">Δ</th>}
                    {showGreeks && <th className="r">Θ</th>}
                    <th className="r">IV</th>
                    <th className="r">Vol</th>
                    <th className="r">Chg OI</th>
                    <th className="r">OI</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const isAtm = row.strike === atm;
                    return (
                      <tr key={row.strike} className={isAtm ? "atm" : undefined}>
                        <td className="r oi-bar">
                          <span className="oi-fill" style={{ width: `${(row.call.oi / maxCallOi) * 60}%` }} />
                          <span className="cell-inner">{compactInr(row.call.oi)}</span>
                        </td>
                        <td className={cx("r", row.call.oi - row.call.prev_oi >= 0 ? "pos" : "neg")}>
                          {compactInr(row.call.oi - row.call.prev_oi)}
                        </td>
                        <td className="r muted">{compactInr(row.call.volume)}</td>
                        <td className="r">{row.call.iv ? row.call.iv.toFixed(1) : "—"}</td>
                        {showGreeks && <td className="r muted">{row.call.delta ? row.call.delta.toFixed(2) : "—"}</td>}
                        {showGreeks && <td className="r muted">{row.call.theta ? row.call.theta.toFixed(1) : "—"}</td>}
                        <td className="r">
                          <button
                            className="num"
                            style={{ border: 0, background: "transparent", color: "var(--pos)", fontWeight: 600, cursor: "pointer" }}
                            onClick={() =>
                              openOrder({ instrument_key: row.call.instrument_key, symbol: `${payload.underlying} ${row.strike} CE`, segment: "NSE_FO", side: "BUY", price: row.call.ltp })
                            }
                          >
                            {inr(row.call.ltp)}
                          </button>
                        </td>
                        <td className="strike" style={isAtm ? { background: "#fdf7e3" } : undefined}>
                          {inr(row.strike, 0)}
                          {isAtm && <div style={{ fontSize: 9, color: "var(--brand)", fontWeight: 600 }}>ATM</div>}
                        </td>
                        <td className="r">
                          <button
                            className="num"
                            style={{ border: 0, background: "transparent", color: "var(--neg)", fontWeight: 600, cursor: "pointer" }}
                            onClick={() =>
                              openOrder({ instrument_key: row.put.instrument_key, symbol: `${payload.underlying} ${row.strike} PE`, segment: "NSE_FO", side: "BUY", price: row.put.ltp })
                            }
                          >
                            {inr(row.put.ltp)}
                          </button>
                        </td>
                        {showGreeks && <td className="r muted">{row.put.delta ? row.put.delta.toFixed(2) : "—"}</td>}
                        {showGreeks && <td className="r muted">{row.put.theta ? row.put.theta.toFixed(1) : "—"}</td>}
                        <td className="r">{row.put.iv ? row.put.iv.toFixed(1) : "—"}</td>
                        <td className="r muted">{compactInr(row.put.volume)}</td>
                        <td className={cx("r", row.put.oi - row.put.prev_oi >= 0 ? "pos" : "neg")}>
                          {compactInr(row.put.oi - row.put.prev_oi)}
                        </td>
                        <td className="r oi-bar">
                          <span className="oi-fill neg-side" style={{ width: `${(row.put.oi / maxPutOi) * 60}%` }} />
                          <span className="cell-inner">{compactInr(row.put.oi)}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No contracts for this expiry" hint="Pick a later expiry, or refresh — Upstox publishes the chain at the start of the session." />
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <Tag tone="outline">Lot size {payload.lot_size ?? "—"}</Tag>
            <Tag tone="outline">Source Upstox</Tag>
            <Tag tone="outline">Refreshes every 15s</Tag>
          </div>
        </>
      )}
    </div>
  );
}
