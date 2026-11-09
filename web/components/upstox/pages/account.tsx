"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useApp, useQuotes } from "@/components/upstox/AppProvider";
import { BellIcon, DownloadIcon, RefreshIcon, SparkleIcon, TrashIcon } from "@/components/upstox/icons";
import { Empty, Section, Skeleton, Tag } from "@/components/upstox/ui";
import { computeCharges } from "@/lib/charges";
import { cx, dateTimeLabel, inr, pct } from "@/lib/client/format";

interface ReportEntry {
  id: string;
  symbol: string;
  name: string;
  date: string;
  created_at: string;
  rating?: string;
  has_html: boolean;
}

export function ReportsPage() {
  const { openAi } = useApp();
  const [reports, setReports] = useState<ReportEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/reports", { cache: "no-store" })
      .then(async (res) => {
        const data = (await res.json()) as { reports?: ReportEntry[]; error?: string };
        if (!res.ok) throw new Error(data.error || "Reports failed");
        setReports(data.reports || []);
      })
      .catch((reason) => {
        setError(reason instanceof Error ? reason.message : "Reports failed");
        setReports([]);
      });
  }, []);

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const report of reports || []) {
      const key = (report.rating || "unrated").toUpperCase();
      out[key] = (out[key] || 0) + 1;
    }
    return out;
  }, [reports]);

  return (
    <div className="content">
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>AI research reports</h1>
          <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-2)" }}>
            Full TradingAgents India output — four analysts, debate, trader and risk lenses
          </p>
        </div>
        <div className="spacer" />
        <button
          className="btn btn-primary"
          style={{ gap: 6 }}
          onClick={() => openAi({ instrument_key: "NSE_EQ|INE002A01018", symbol: "RELIANCE", name: "Reliance Industries", segment: "NSE_EQ" })}
        >
          <SparkleIcon size={14} /> Run new coverage
        </button>
      </div>

      <div className="chips">
        {Object.entries(counts).map(([rating, count]) => (
          <Tag key={rating} tone={rating.includes("BUY") || rating.includes("OVER") ? "pos" : rating.includes("SELL") || rating.includes("UNDER") ? "neg" : "outline"}>
            {rating} · {count}
          </Tag>
        ))}
      </div>

      {error && <div style={{ color: "var(--neg)", fontSize: 12, marginBottom: 12 }}>{error}</div>}

      {!reports && !error && <Skeleton height={300} />}

      {reports && (
        <Section title="Library" note={`${reports.length} reports`}>
          {reports.length ? (
            <div className="table-wrap">
              <table className="ux">
                <thead>
                  <tr>
                    <th style={{ width: "30%" }}>Symbol</th>
                    <th>Decision date</th>
                    <th>House view</th>
                    <th>Generated</th>
                    <th className="r" style={{ width: 210 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((report) => (
                    <tr key={report.id}>
                      <td>
                        <div className="symcell-stack">
                          <span className="name">{report.symbol}</span>
                          <span className="meta">{report.name || report.id}</span>
                        </div>
                      </td>
                      <td className="num">{report.date}</td>
                      <td>
                        {report.rating ? (
                          <Tag tone={report.rating.toUpperCase().includes("BUY") || report.rating.toUpperCase().includes("OVER") ? "pos" : report.rating.toUpperCase().includes("SELL") || report.rating.toUpperCase().includes("UNDER") ? "neg" : "outline"}>
                            {report.rating.toUpperCase()}
                          </Tag>
                        ) : (
                          <span className="faint">—</span>
                        )}
                      </td>
                      <td className="muted" style={{ fontSize: 11 }}>{report.created_at ? dateTimeLabel(report.created_at) : "—"}</td>
                      <td className="r">
                        <span className="table-actions">
                          <a className="btn" href={`/api/report/${report.id}`} target="_blank" rel="noreferrer">View</a>
                          <a className="btn" href={`/api/report/${report.id}?download=1`} style={{ gap: 4 }}>
                            <DownloadIcon size={12} /> HTML
                          </a>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No reports yet" hint="Run the 12-agent desk on any NSE or BSE equity to generate the first one." />
          )}
        </Section>
      )}
    </div>
  );
}

export function LedgerPage() {
  const { portfolio } = useApp();
  const trades = portfolio?.trades || [];
  const orders = portfolio?.orders || [];

  const rows = useMemo(() => {
    return [...trades].reverse().map((trade) => {
      const charges = computeCharges(trade.side, trade.product, trade.price, trade.quantity);
      return { ...trade, breakdown: charges };
    });
  }, [trades]);

  const totals = rows.reduce(
    (sum, row) => ({
      turnover: sum.turnover + row.price * row.quantity,
      brokerage: sum.brokerage + row.breakdown.brokerage,
      stt: sum.stt + row.breakdown.stt,
      exchange: sum.exchange + row.breakdown.exchange,
      gst: sum.gst + row.breakdown.gst,
      stamp: sum.stamp + row.breakdown.stamp,
      sebi: sum.sebi + row.breakdown.sebi,
      total: sum.total + row.breakdown.total,
    }),
    { turnover: 0, brokerage: 0, stt: 0, exchange: 0, gst: 0, stamp: 0, sebi: 0, total: 0 }
  );

  return (
    <div className="content">
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Ledger</h1>
          <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-2)" }}>Every fill with the full Indian charges stack</p>
        </div>
      </div>

      <div className="tile-grid c4" style={{ marginBottom: 20 }}>
        <div className="tile">
          <div className="stat-label">Turnover</div>
          <div className="stat-value num">{inr(totals.turnover)}</div>
        </div>
        <div className="tile">
          <div className="stat-label">Total charges</div>
          <div className="stat-value num">{inr(totals.total)}</div>
        </div>
        <div className="tile">
          <div className="stat-label">Trades</div>
          <div className="stat-value num">{trades.length}</div>
        </div>
        <div className="tile">
          <div className="stat-label">Orders</div>
          <div className="stat-value num">{orders.length}</div>
        </div>
      </div>

      <Section title="Contract notes" note="Charges computed with the same model the ledger applies">
        {rows.length ? (
          <div className="table-wrap">
            <table className="ux">
              <thead>
                <tr>
                  <th>Executed</th>
                  <th style={{ width: "22%" }}>Instrument</th>
                  <th>Side</th>
                  <th className="r">Qty</th>
                  <th className="r">Price</th>
                  <th className="r">Brokerage</th>
                  <th className="r">STT</th>
                  <th className="r">Exchange</th>
                  <th className="r">GST</th>
                  <th className="r">Stamp</th>
                  <th className="r">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="num muted" style={{ fontSize: 11 }}>{dateTimeLabel(row.executed_at)}</td>
                    <td>
                      <div className="symcell-stack">
                        <span className="name">{row.symbol}</span>
                        <span className="meta">{row.product}</span>
                      </div>
                    </td>
                    <td><span className={row.side === "BUY" ? "pos" : "neg"} style={{ fontWeight: 600 }}>{row.side}</span></td>
                    <td className="r num">{row.quantity}</td>
                    <td className="r num">{inr(row.price)}</td>
                    <td className="r num muted">{inr(row.breakdown.brokerage)}</td>
                    <td className="r num muted">{inr(row.breakdown.stt)}</td>
                    <td className="r num muted">{inr(row.breakdown.exchange)}</td>
                    <td className="r num muted">{inr(row.breakdown.gst)}</td>
                    <td className="r num muted">{inr(row.breakdown.stamp)}</td>
                    <td className="r num">{inr(row.breakdown.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Ledger is empty" hint="Once an order fills, the contract note shows up here with every charge line." />
        )}
      </Section>
    </div>
  );
}

export function ProfilePage() {
  const { session, portfolio } = useApp();
  const funds = portfolio?.funds;

  return (
    <div className="content">
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Profile</h1>
          <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-2)" }}>Paper trading identity and account footprint</p>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.2fr) minmax(0,1fr)", gap: 16, alignItems: "start" }}>
        <div className="panel">
          <div className="panel-head">
            <span className="panel-title">Account</span>
          </div>
          <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <span style={{ width: 56, height: 56, borderRadius: "50%", background: "var(--brand-subtle)", color: "var(--brand)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700 }}>
                VN
              </span>
              <div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>Vishal Nair</div>
                <div style={{ fontSize: 11, color: "var(--text-2)" }}>Paper desk · NSE / BSE / NFO / MCX</div>
                <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                  <Tag tone="brand">Demo</Tag>
                  <Tag tone="outline">₹10,00,000 virtual</Tag>
                </div>
              </div>
            </div>
            <div style={{ height: 1, background: "var(--stroke-2)" }} />
            {[
              ["Client code", "PAPER-VN-001"],
              ["KYC", "Simulated · verified"],
              ["Demat", "Virtual CDSL account"],
              ["Market data", "Official Upstox API"],
              ["Research", "TradingAgents India · 12 agents"],
            ].map(([label, value]) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                <span className="muted">{label}</span>
                <span>{value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <span className="panel-title">Session</span>
          </div>
          <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="muted">Phase</span>
              <span style={{ fontWeight: 600 }}>{session ? session.phase.replace("_", " ") : "—"}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="muted">Session date</span>
              <span>{session?.session_date || "—"}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="muted">Last close</span>
              <span>{session?.last_close_date || "—"}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="muted">Next open</span>
              <span>{session?.next_open_ist ? new Date(session.next_open_ist).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : "—"}</span>
            </div>
            <div style={{ height: 1, background: "var(--stroke-2)" }} />
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="muted">Available</span>
              <span className="num">{inr(funds?.available ?? 0)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="muted">Total value</span>
              <span className="num">{inr(funds?.total_value ?? 0)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="muted">Total P&amp;L</span>
              <span className={cx("num", (funds?.total_pnl ?? 0) >= 0 ? "pos" : "neg")}>{inr(funds?.total_pnl ?? 0)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SettingsPage() {
  const { notify } = useApp();
  const [state, setState] = useState({
    showTicker: true,
    confirmOrders: false,
    soundAlerts: false,
    compactTables: false,
    defaultProduct: "MIS" as "MIS" | "CNC",
    defaultQty: 1,
  });

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("upstox.paper.settings");
      if (raw) setState((current) => ({ ...current, ...JSON.parse(raw) }));
    } catch {
      // ignore
    }
  }, []);

  function save(patch: Partial<typeof state>) {
    const next = { ...state, ...patch };
    setState(next);
    try {
      window.localStorage.setItem("upstox.paper.settings", JSON.stringify(next));
    } catch {
      // ignore
    }
  }

  return (
    <div className="content">
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Settings</h1>
          <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-2)" }}>Terminal behaviour, stored on this device</p>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 16 }}>
        <div className="panel">
          <div className="panel-head"><span className="panel-title">Interface</span></div>
          <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Toggle label="Show the index ticker" value={state.showTicker} onChange={(value) => save({ showTicker: value })} />
            <Toggle label="Compact table rows" value={state.compactTables} onChange={(value) => save({ compactTables: value })} />
            <Toggle label="Sound alerts" value={state.soundAlerts} onChange={(value) => save({ soundAlerts: value })} />
          </div>
        </div>

        <div className="panel">
          <div className="panel-head"><span className="panel-title">Order defaults</span></div>
          <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Toggle label="Confirm before placing" value={state.confirmOrders} onChange={(value) => save({ confirmOrders: value })} />
            <div className="field">
              <label>Default product</label>
              <select className="select" value={state.defaultProduct} onChange={(event) => save({ defaultProduct: event.target.value as "MIS" | "CNC" })}>
                <option value="MIS">MIS · Intraday</option>
                <option value="CNC">CNC · Delivery</option>
              </select>
            </div>
            <div className="field">
              <label>Default quantity</label>
              <input className="input num" value={state.defaultQty} onChange={(event) => save({ defaultQty: Math.max(1, Number(event.target.value) || 1) })} inputMode="numeric" />
            </div>
            <button className="btn btn-primary" onClick={() => notify({ tone: "success", title: "Settings saved" })}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", border: 0, background: "transparent", padding: 0, cursor: "pointer" }}
    >
      <span style={{ fontSize: 12 }}>{label}</span>
      <span style={{ width: 34, height: 20, borderRadius: 999, background: value ? "var(--brand)" : "var(--stroke)", position: "relative", transition: "background .15s var(--ease)" }}>
        <span style={{ position: "absolute", top: 2, left: value ? 16 : 2, width: 16, height: 16, borderRadius: "50%", background: "#fff", transition: "left .15s var(--ease)" }} />
      </span>
    </button>
  );
}

interface AlertRow {
  id: number;
  key: string;
  symbol: string;
  above: number;
  below: number;
  note: string;
  triggered?: "above" | "below";
}

const ALERTS_KEY = "upstox.paper.alerts";

export function AlertsPage() {
  const { setSearchOpen, notify, addWatch } = useApp();
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [form, setForm] = useState({ symbol: "", key: "", above: "", below: "" });
  const keys = alerts.map((alert) => alert.key);
  const quotes = useQuotes(keys);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(ALERTS_KEY);
      if (raw) setAlerts(JSON.parse(raw));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    for (const alert of alerts) {
      const quote = quotes[alert.key];
      if (!quote) continue;
      if (alert.above && quote.last_price >= alert.above && alert.triggered !== "above") {
        notify({ tone: "success", title: `${alert.symbol} crossed above ${inr(alert.above)}`, message: `LTP ${inr(quote.last_price)}` });
        persist(alerts.map((row) => (row.id === alert.id ? { ...row, triggered: "above" } : row)));
      }
      if (alert.below && quote.last_price <= alert.below && alert.triggered !== "below") {
        notify({ tone: "warn", title: `${alert.symbol} fell below ${inr(alert.below)}`, message: `LTP ${inr(quote.last_price)}` });
        persist(alerts.map((row) => (row.id === alert.id ? { ...row, triggered: "below" } : row)));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotes]);

  function persist(next: AlertRow[]) {
    setAlerts(next);
    try {
      window.localStorage.setItem(ALERTS_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }

  async function resolveSymbol(symbol: string) {
    const res = await fetch(`/api/search?q=${encodeURIComponent(symbol)}&limit=1`);
    const data = (await res.json()) as { results?: Array<{ instrument_key: string; symbol: string }> };
    return data.results?.[0] || null;
  }

  async function add() {
    if (!form.symbol.trim()) {
      notify({ tone: "warn", title: "Enter a symbol" });
      return;
    }
    const hit = form.key ? { instrument_key: form.key, symbol: form.symbol } : await resolveSymbol(form.symbol);
    if (!hit) {
      notify({ tone: "error", title: "Symbol not found", message: form.symbol });
      return;
    }
    persist([
      ...alerts,
      {
        id: Date.now(),
        key: hit.instrument_key,
        symbol: hit.symbol,
        above: Number(form.above) || 0,
        below: Number(form.below) || 0,
        note: "",
      },
    ]);
    setForm({ symbol: "", key: "", above: "", below: "" });
    notify({ tone: "success", title: "Alert armed", message: `${hit.symbol} will trigger on the quote feed.` });
  }

  return (
    <div className="content">
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>My alerts</h1>
          <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-2)" }}>Price triggers checked against the live quote feed</p>
        </div>
        <div className="spacer" />
        <button className="btn" style={{ gap: 4 }} onClick={() => setSearchOpen(true)}>
          <BellIcon size={14} /> Search instruments
        </button>
      </div>

      <div className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-head"><span className="panel-title">Create alert</span></div>
        <div className="panel-body" style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: 10, alignItems: "end" }}>
          <div className="field">
            <label>Symbol</label>
            <input className="input" value={form.symbol} onChange={(event) => setForm({ ...form, symbol: event.target.value, key: "" })} placeholder="RELIANCE" />
          </div>
          <div className="field">
            <label>Above</label>
            <input className="input num" value={form.above} onChange={(event) => setForm({ ...form, above: event.target.value })} placeholder="1450" />
          </div>
          <div className="field">
            <label>Below</label>
            <input className="input num" value={form.below} onChange={(event) => setForm({ ...form, below: event.target.value })} placeholder="1380" />
          </div>
          <button className="btn btn-primary" onClick={add}>Create alert</button>
        </div>
      </div>

      <Section title="Armed alerts" note={`${alerts.length} tracked`}>
        {alerts.length ? (
          <div className="table-wrap">
            <table className="ux">
              <thead>
                <tr>
                  <th style={{ width: "28%" }}>Instrument</th>
                  <th className="r">LTP</th>
                  <th className="r">Above</th>
                  <th className="r">Below</th>
                  <th>Status</th>
                  <th className="r" style={{ width: 170 }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((alert) => {
                  const quote = quotes[alert.key];
                  return (
                    <tr key={alert.id}>
                      <td>
                        <div className="symcell-stack">
                          <span className="name">{alert.symbol}</span>
                          <span className="meta">{alert.key.split("|")[0]}</span>
                        </div>
                      </td>
                      <td className="r num">{quote ? inr(quote.last_price) : "—"}</td>
                      <td className="r num">{alert.above ? inr(alert.above) : "—"}</td>
                      <td className="r num">{alert.below ? inr(alert.below) : "—"}</td>
                      <td>
                        {alert.triggered ? (
                          <Tag tone={alert.triggered === "above" ? "pos" : "neg"}>Triggered {alert.triggered}</Tag>
                        ) : (
                          <Tag tone="outline">Armed</Tag>
                        )}
                      </td>
                      <td className="r">
                        <span className="table-actions">
                          <button className="btn" onClick={() => addWatch(alert.key)}>Watch</button>
                          <button className="icon-btn" style={{ width: 26, height: 26 }} aria-label="Delete alert" onClick={() => persist(alerts.filter((row) => row.id !== alert.id))}>
                            <TrashIcon size={13} />
                          </button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No alerts armed" hint="Add a symbol with an above and/or below price to start monitoring." />
        )}
      </Section>
    </div>
  );
}
