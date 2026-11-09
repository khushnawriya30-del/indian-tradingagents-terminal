"use client";

import { useMemo, useState } from "react";

import { useApp, useQuotes } from "@/components/upstox/AppProvider";
import { PlusIcon, SearchIcon, TrashIcon } from "@/components/upstox/icons";
import { Change, Empty, Section, SymbolCell } from "@/components/upstox/ui";
import { cx, inr, pct } from "@/lib/client/format";

export function MyListPage() {
  const { watchlist, removeWatch, setSearchOpen, openOrder, refreshPortfolio } = useApp();
  const keys = watchlist.map((item) => item.instrument_key);
  const quotes = useQuotes(keys);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"default" | "change" | "price" | "name">("default");

  const rows = useMemo(() => {
    const mapped = watchlist.map((item) => {
      const quote = quotes[item.instrument_key];
      return {
        ...item,
        ltp: quote?.last_price ?? 0,
        change: quote?.change ?? 0,
        change_percent: quote?.change_percent ?? 0,
        volume: quote?.volume ?? 0,
      };
    });
    const filtered = query.trim()
      ? mapped.filter((row) => `${row.symbol} ${row.name}`.toLowerCase().includes(query.trim().toLowerCase()))
      : mapped;
    if (sort === "change") return [...filtered].sort((a, b) => b.change_percent - a.change_percent);
    if (sort === "price") return [...filtered].sort((a, b) => b.ltp - a.ltp);
    if (sort === "name") return [...filtered].sort((a, b) => a.symbol.localeCompare(b.symbol));
    return filtered;
  }, [watchlist, quotes, query, sort]);

  return (
    <div className="content">
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>My List</h1>
          <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-2)" }}>
            {watchlist.length} instruments · streaming quotes from Upstox
          </p>
        </div>
        <div className="spacer" />
        <div style={{ position: "relative", width: 220 }}>
          <span style={{ position: "absolute", left: 10, top: 9, color: "var(--text-2)" }}>
            <SearchIcon size={13} />
          </span>
          <input
            className="input"
            style={{ paddingLeft: 30 }}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter list"
          />
        </div>
        <select className="select" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} style={{ width: 140 }}>
          <option value="default">Sort: default</option>
          <option value="change">Sort: change</option>
          <option value="price">Sort: price</option>
          <option value="name">Sort: name</option>
        </select>
        <button className="btn btn-primary" onClick={() => setSearchOpen(true)} style={{ gap: 4 }}>
          <PlusIcon size={14} /> Add scrip
        </button>
        <button className="btn" onClick={() => refreshPortfolio()}>
          Refresh
        </button>
      </div>

      <Section title="Watchlist" note={`${rows.length} shown`}>
        {rows.length ? (
          <div className="table-wrap">
            <table className="ux">
              <thead>
                <tr>
                  <th style={{ width: "34%" }}>Instrument</th>
                  <th className="r">LTP</th>
                  <th className="r">Change</th>
                  <th className="r">Volume</th>
                  <th className="r" style={{ width: 200 }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.instrument_key}>
                    <td>
                      <SymbolCell symbol={row.symbol} name={row.name} segment={row.segment} />
                    </td>
                    <td className="r num">{row.ltp ? inr(row.ltp) : "—"}</td>
                    <td className="r">
                      {row.ltp ? <Change value={row.change} percent={row.change_percent} /> : <span className="faint">—</span>}
                    </td>
                    <td className="r num muted">{row.volume ? row.volume.toLocaleString("en-IN") : "—"}</td>
                    <td className="r">
                      <span className="table-actions">
                        <button
                          className="btn btn-buy"
                          onClick={() =>
                            openOrder({
                              instrument_key: row.instrument_key,
                              symbol: row.symbol,
                              name: row.name,
                              segment: row.segment,
                              side: "BUY",
                              price: row.ltp,
                            })
                          }
                        >
                          Buy
                        </button>
                        <button
                          className="btn btn-sell"
                          onClick={() =>
                            openOrder({
                              instrument_key: row.instrument_key,
                              symbol: row.symbol,
                              name: row.name,
                              segment: row.segment,
                              side: "SELL",
                              price: row.ltp,
                            })
                          }
                        >
                          Sell
                        </button>
                        <button className="icon-btn" style={{ width: 26, height: 26 }} aria-label={`Remove ${row.symbol}`} onClick={() => removeWatch(row.instrument_key)}>
                          <TrashIcon size={13} />
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Your list is empty" hint="Use the search or press ⌘K to add scrips to your watchlist." />
        )}
      </Section>
    </div>
  );
}

export function OrderBookPage() {
  const { portfolio, cancelOrder, notify } = useApp();
  const orders = portfolio?.orders || [];
  const trades = portfolio?.trades || [];
  const [tab, setTab] = useState<"orders" | "trades">("orders");
  const [filter, setFilter] = useState<"all" | "OPEN" | "PENDING" | "COMPLETE" | "CANCELLED">("all");

  const filtered = filter === "all" ? orders : orders.filter((order) => order.status === filter);
  const sorted = [...filtered].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  return (
    <div className="content">
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Orders</h1>
        <div className="spacer" />
        <div style={{ display: "inline-flex", border: "1px solid var(--stroke)", borderRadius: 6, overflow: "hidden" }}>
          {(["orders", "trades"] as const).map((id) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              style={{
                height: 30,
                padding: "0 14px",
                border: 0,
                borderRight: id === "orders" ? "1px solid var(--stroke)" : 0,
                background: tab === id ? "var(--brand-callout)" : "#fff",
                color: tab === id ? "var(--brand)" : "var(--text)",
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              {id === "orders" ? `Order book (${orders.length})` : `Trade book (${trades.length})`}
            </button>
          ))}
        </div>
      </div>

      <div className="chips">
        {(["all", "OPEN", "PENDING", "COMPLETE", "CANCELLED"] as const).map((id) => (
          <button key={id} className={cx("chip", filter === id && "active")} onClick={() => setFilter(id)}>
            {id === "all" ? "All" : id.charAt(0) + id.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      {tab === "orders" ? (
        sorted.length ? (
          <div className="table-wrap">
            <table className="ux">
              <thead>
                <tr>
                  <th>Time</th>
                  <th style={{ width: "30%" }}>Instrument</th>
                  <th>Side</th>
                  <th className="r">Qty</th>
                  <th>Type</th>
                  <th>Product</th>
                  <th className="r">Price</th>
                  <th>Status</th>
                  <th className="r">Action</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((order) => (
                  <tr key={order.id}>
                    <td className="num muted" style={{ fontSize: 11 }}>
                      {new Date(order.created_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })}
                    </td>
                    <td>
                      <SymbolCell symbol={order.symbol} segment={order.instrument_key.includes("|") ? order.instrument_key.split("|")[0] : "NSE_EQ"} />
                    </td>
                    <td>
                      <span className={order.side === "BUY" ? "pos" : "neg"} style={{ fontWeight: 600 }}>{order.side}</span>
                    </td>
                    <td className="r num">{order.quantity}</td>
                    <td className="muted">{order.order_type}</td>
                    <td className="muted">{order.product}</td>
                    <td className="r num">
                      {order.average_price
                        ? inr(order.average_price)
                        : order.limit_price
                          ? inr(order.limit_price)
                          : order.trigger_price
                            ? inr(order.trigger_price)
                            : "MKT"}
                    </td>
                    <td>
                      <OrderStatusTag status={order.status} />
                    </td>
                    <td className="r">
                      {order.status === "OPEN" || order.status === "PENDING" ? (
                        <button
                          className="btn btn-sm"
                          onClick={() => {
                            cancelOrder(order.id);
                          }}
                        >
                          Cancel
                        </button>
                      ) : (
                        <span className="faint" style={{ fontSize: 10 }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No orders in this view" hint="Place a paper order from any chart, card or the order pad." />
        )
      ) : trades.length ? (
        <div className="table-wrap">
          <table className="ux">
            <thead>
              <tr>
                <th>Executed</th>
                <th style={{ width: "32%" }}>Instrument</th>
                <th>Side</th>
                <th className="r">Qty</th>
                <th className="r">Price</th>
                <th className="r">Charges</th>
                <th>Product</th>
                <th className="r">Realised P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              {[...trades].reverse().map((trade) => (
                <tr key={trade.id}>
                  <td className="num muted" style={{ fontSize: 11 }}>
                    {new Date(trade.executed_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })}
                  </td>
                  <td>
                    <SymbolCell symbol={trade.symbol} />
                  </td>
                  <td>
                    <span className={trade.side === "BUY" ? "pos" : "neg"} style={{ fontWeight: 600 }}>{trade.side}</span>
                  </td>
                  <td className="r num">{trade.quantity}</td>
                  <td className="r num">{inr(trade.price)}</td>
                  <td className="r num muted">{inr(trade.charges?.total || 0)}</td>
                  <td className="muted">{trade.product}</td>
                  <td className="r">
                    {trade.realized_pnl === undefined ? (
                      <span className="faint">—</span>
                    ) : (
                      <Change value={trade.realized_pnl} showPercent={false} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="No trades yet" hint="Filled orders appear here with their charges and realised P&L." />
      )}
    </div>
  );
}

function OrderStatusTag({ status }: { status: string }) {
  const tone =
    status === "COMPLETE" ? { bg: "var(--pos-subtle)", color: "var(--pos)" }
      : status === "OPEN" ? { bg: "var(--brand-subtle)", color: "var(--brand)" }
        : status === "PENDING" ? { bg: "#fdf3e2", color: "var(--warn)" }
          : { bg: "var(--neg-subtle)", color: "var(--neg)" };
  return (
    <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 4, background: tone.bg, color: tone.color }}>
      {status}
    </span>
  );
}

export function PositionsPage() {
  const { portfolio, openOrder, notify } = useApp();
  const positions = portfolio?.positions || [];
  const totalPnl = positions.reduce((sum, position) => sum + position.pnl, 0);

  return (
    <div className="content">
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 18, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Positions</h1>
          <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-2)" }}>
            {positions.length} open · net unrealised{" "}
            <b className={totalPnl >= 0 ? "pos" : "neg"}>{inr(totalPnl)}</b>
          </p>
        </div>
        <div className="spacer" />
        <button className="btn" onClick={() => notify({ tone: "info", title: "Positions are live", message: "MIS positions square off at 15:20 IST." })}>
          Product info
        </button>
      </div>

      {positions.length ? (
        <div className="table-wrap">
          <table className="ux">
            <thead>
              <tr>
                <th style={{ width: "30%" }}>Instrument</th>
                <th>Product</th>
                <th className="r">Qty</th>
                <th className="r">Avg. price</th>
                <th className="r">LTP</th>
                <th className="r">Day chg</th>
                <th className="r">P&amp;L</th>
                <th className="r" style={{ width: 180 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((position) => (
                <tr key={`${position.instrument_key}-${position.product}`}>
                  <td>
                    <SymbolCell symbol={position.symbol} name={position.name} segment={position.product === "MIS" ? "MIS" : "NSE"} />
                  </td>
                  <td>
                    <span className="tag outline">{position.product}</span>
                  </td>
                  <td className="r num">{position.quantity}</td>
                  <td className="r num">{inr(position.average_price)}</td>
                  <td className="r num">{inr(position.last_price)}</td>
                  <td className="r">
                    <span className={position.day_change_percent >= 0 ? "pos" : "neg"}>{pct(position.day_change_percent)}</span>
                  </td>
                  <td className="r">
                    <Change value={position.pnl} percent={position.pnl_percent} showPercent={false} />
                    <div className="muted num" style={{ fontSize: 10 }}>{pct(position.pnl_percent)}</div>
                  </td>
                  <td className="r">
                    <span className="table-actions">
                      <button
                        className="btn btn-sm"
                        onClick={() =>
                          openOrder({
                            instrument_key: position.instrument_key,
                            symbol: position.symbol,
                            name: position.name,
                            segment: position.product === "MIS" ? "NSE_EQ" : "NSE_EQ",
                            side: position.quantity >= 0 ? "SELL" : "BUY",
                            price: position.last_price,
                          })
                        }
                      >
                        {position.quantity >= 0 ? "Exit long" : "Exit short"}
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="No open positions" hint="Intraday (MIS) and delivery positions will show up here once filled." />
      )}
    </div>
  );
}

export function HoldingsPage() {
  const { portfolio, openOrder } = useApp();
  const holdings = portfolio?.holdings || [];
  const invested = holdings.reduce((sum, holding) => sum + holding.average_price * holding.quantity, 0);
  const value = holdings.reduce((sum, holding) => sum + holding.last_price * holding.quantity, 0);
  const pnl = value - invested;

  return (
    <div className="content">
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 18, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Holdings</h1>
          <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-2)" }}>
            {holdings.length} scrips · invested <b>{inr(invested)}</b> · current <b>{inr(value)}</b> ·{" "}
            <b className={pnl >= 0 ? "pos" : "neg"}>{inr(pnl)}</b>
          </p>
        </div>
      </div>

      {holdings.length ? (
        <div className="table-wrap">
          <table className="ux">
            <thead>
              <tr>
                <th style={{ width: "32%" }}>Instrument</th>
                <th className="r">Qty</th>
                <th className="r">Avg. cost</th>
                <th className="r">LTP</th>
                <th className="r">Invested</th>
                <th className="r">Current value</th>
                <th className="r">P&amp;L</th>
                <th className="r" style={{ width: 110 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((holding) => (
                <tr key={holding.instrument_key}>
                  <td>
                    <SymbolCell symbol={holding.symbol} name={holding.name} segment="CNC" />
                  </td>
                  <td className="r num">{holding.quantity}</td>
                  <td className="r num">{inr(holding.average_price)}</td>
                  <td className="r num">{inr(holding.last_price)}</td>
                  <td className="r num muted">{inr(holding.average_price * holding.quantity)}</td>
                  <td className="r num">{inr(holding.last_price * holding.quantity)}</td>
                  <td className="r">
                    <Change value={holding.pnl} percent={holding.pnl_percent} showPercent={false} />
                    <div className="muted num" style={{ fontSize: 10 }}>{pct(holding.pnl_percent)}</div>
                  </td>
                  <td className="r">
                    <button
                      className="btn btn-sm btn-sell"
                      onClick={() =>
                        openOrder({
                          instrument_key: holding.instrument_key,
                          symbol: holding.symbol,
                          name: holding.name,
                          segment: "NSE_EQ",
                          side: "SELL",
                          price: holding.last_price,
                        })
                      }
                    >
                      Sell
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="No holdings yet" hint="Buy with the CNC product to build a delivery portfolio." />
      )}
    </div>
  );
}

export function FundsPage() {
  const { portfolio, session, hidePnl, togglePnl } = useApp();
  const funds = portfolio?.funds;
  const [tab, setTab] = useState<"wallet" | "breakdown">("wallet");

  const available = funds?.available ?? 0;
  const blocked = funds?.margin_blocked ?? 0;
  const total = funds?.total_value ?? 0;
  const pnl = funds?.total_pnl ?? 0;
  const utilization = total ? (blocked / (total || 1)) * 100 : 0;

  return (
    <div className="content">
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Funds</h1>
          <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-2)" }}>
            Virtual wallet · {session ? `${session.phase.replace("_", " ")} · ${session.session_date}` : "connecting"}
          </p>
        </div>
        <div className="spacer" />
        <button className="btn btn-sm" onClick={togglePnl}>{hidePnl ? "Show figures" : "Hide figures"}</button>
        <div style={{ display: "inline-flex", border: "1px solid var(--stroke)", borderRadius: 6, overflow: "hidden" }}>
          {(["wallet", "breakdown"] as const).map((id) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              style={{
                height: 30,
                padding: "0 14px",
                border: 0,
                borderRight: id === "wallet" ? "1px solid var(--stroke)" : 0,
                background: tab === id ? "var(--brand-callout)" : "#fff",
                color: tab === id ? "var(--brand)" : "var(--text)",
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              {id === "wallet" ? "Wallet" : "Breakdown"}
            </button>
          ))}
        </div>
      </div>

      <div className="tile-grid c4" style={{ marginBottom: 24 }}>
        <FundTile label="Available to trade" value={available} tone="brand" hidden={hidePnl} />
        <FundTile label="Margin blocked" value={blocked} hidden={hidePnl} />
        <FundTile label="Total value" value={total} hidden={hidePnl} />
        <FundTile label="Total P&L" value={pnl} hidden={hidePnl} tone={pnl >= 0 ? "pos" : "neg"} />
      </div>

      {tab === "wallet" ? (
        <div className="panel">
          <div className="panel-head">
            <span className="panel-title">Wallet utilisation</span>
            <span className="spacer" />
            <span className="tag">{utilization.toFixed(1)}% blocked</span>
          </div>
          <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 6 }}>
                <span className="muted">Blocked against open positions</span>
                <span className="num">{hidePnl ? "••••" : inr(blocked)}</span>
              </div>
              <div className="margin-meter" style={{ height: 8 }}>
                <i style={{ width: `${Math.min(100, utilization)}%` }} />
              </div>
            </div>
            <div className="tile-grid c3">
              <div className="tile">
                <div className="stat-label">Starting balance</div>
                <div className="stat-value num">{hidePnl ? "••••" : inr(funds?.starting_balance ?? 0)}</div>
              </div>
              <div className="tile">
                <div className="stat-label">Realised P&amp;L</div>
                <div className={cx("stat-value num", (funds?.realized_pnl ?? 0) >= 0 ? "pos" : "neg")}>
                  {hidePnl ? "••••" : inr(funds?.realized_pnl ?? 0)}
                </div>
              </div>
              <div className="tile">
                <div className="stat-label">Unrealised P&amp;L</div>
                <div className={cx("stat-value num", (funds?.unrealized_pnl ?? 0) >= 0 ? "pos" : "neg")}>
                  {hidePnl ? "••••" : inr(funds?.unrealized_pnl ?? 0)}
                </div>
              </div>
            </div>
            <div style={{ fontSize: 11, color: "var(--text-2)", lineHeight: "18px" }}>
              Paper ledger. CNC buys debit the full notional; MIS blocks 20% margin (5× leverage). Orders placed
              while the exchange is closed queue for the next session open and fill at the opening price with
              5 bps adverse slippage.
            </div>
          </div>
        </div>
      ) : (
        <div className="panel">
          <div className="panel-head">
            <span className="panel-title">Funds breakdown</span>
          </div>
          <div className="panel-body">
            <table className="ux plain">
              <tbody>
                {[
                  ["Opening balance", funds?.starting_balance ?? 0],
                  ["Available cash", available],
                  ["Margin blocked", blocked],
                  ["Holdings value", funds?.holdings_value ?? 0],
                  ["Unrealised P&L", funds?.unrealized_pnl ?? 0],
                  ["Realised P&L", funds?.realized_pnl ?? 0],
                  ["Day P&L", funds?.day_pnl ?? 0],
                  ["Total portfolio value", total],
                ].map(([label, value]) => (
                  <tr key={label as string}>
                    <td className="muted">{label}</td>
                    <td className={cx("r num", (value as number) > 0 && String(label).includes("P&L") ? "pos" : (value as number) < 0 && String(label).includes("P&L") ? "neg" : "")}>
                      {hidePnl ? "••••" : inr(value as number)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function FundTile({ label, value, tone, hidden }: { label: string; value: number; tone?: "brand" | "pos" | "neg"; hidden?: boolean }) {
  return (
    <div className="tile">
      <div className="stat-label">{label}</div>
      <div
        className={cx("stat-value num", tone === "pos" && "pos", tone === "neg" && "neg")}
        style={tone === "brand" ? { color: "var(--brand)" } : undefined}
      >
        {hidden ? "••••••" : inr(value)}
      </div>
    </div>
  );
}
