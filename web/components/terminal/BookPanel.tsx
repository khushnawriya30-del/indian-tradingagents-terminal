"use client";

import { useMemo, useState } from "react";

import { money, percent, price, signed, toneClass } from "@/lib/format";
import type { EnrichedPosition, Order } from "@/lib/types";
import type { TerminalContext } from "./Dashboard";

type Tab = "positions" | "holdings" | "orders" | "trades";

const TABS: Array<{ value: Tab; label: string }> = [
  { value: "positions", label: "Positions" },
  { value: "holdings", label: "Holdings" },
  { value: "orders", label: "Orders" },
  { value: "trades", label: "Trades" },
];

const STATUS_TONE: Record<string, string> = {
  COMPLETE: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  OPEN: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  PENDING: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  CANCELLED: "border-zinc-600/40 bg-zinc-700/20 text-zinc-400",
  REJECTED: "border-rose-500/30 bg-rose-500/10 text-rose-300",
};

export function BookPanel({ context }: { context: TerminalContext }) {
  const { portfolio, notify, refreshPortfolio, select } = context;
  const [tab, setTab] = useState<Tab>("positions");
  const [busy, setBusy] = useState<string | null>(null);

  const counts = useMemo(
    () => ({
      positions: portfolio?.positions.length || 0,
      holdings: portfolio?.holdings.length || 0,
      orders: portfolio?.orders.length || 0,
      trades: portfolio?.trades.length || 0,
    }),
    [portfolio]
  );

  async function cancel(order: Order) {
    setBusy(order.id);
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(order.id)}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Cancel failed");
      notify({
        tone: "info",
        title: `Cancelled ${order.id}`,
        message: `${order.side} ${order.quantity} ${order.symbol} · margin released`,
      });
      await refreshPortfolio();
    } catch (error) {
      notify({
        tone: "error",
        title: "Cancel failed",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setBusy(null);
    }
  }

  function open(symbol: string) {
    const row = portfolio?.positions.find((entry) => entry.symbol === symbol);
    if (row) {
      select({ instrument_key: row.instrument_key, symbol: row.symbol, display: row.symbol, name: row.name || row.symbol, segment: "NSE_EQ", exchange: "NSE" });
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--panel)]">
      <div className="flex items-center gap-1 border-b border-[var(--line)] px-2 py-1.5">
        {TABS.map((item) => (
          <button
            key={item.value}
            onClick={() => setTab(item.value)}
            className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] transition ${
              tab === item.value
                ? "bg-white/[0.07] text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {item.label}
            <span className="rounded bg-white/[0.05] px-1 text-[8.5px] tabular-nums text-zinc-500">
              {counts[item.value]}
            </span>
          </button>
        ))}
        <span className="ml-auto pr-1 text-[9px] uppercase tracking-[0.14em] text-zinc-600">
          {portfolio?.session?.is_open ? "Marked live" : "Frozen at last close"}
        </span>
      </div>

      <div className="max-h-[300px] overflow-auto minimal-scroll">
        {tab === "positions" && <Positions context={context} onOpen={open} />}
        {tab === "holdings" && <Holdings context={context} />}
        {tab === "orders" && <Orders context={context} busy={busy} onCancel={cancel} />}
        {tab === "trades" && <Trades context={context} />}
      </div>
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return <div className="px-3 py-8 text-center text-[11px] text-zinc-600">{label}</div>;
}

function Positions({ context, onOpen }: { context: TerminalContext; onOpen: (symbol: string) => void }) {
  const rows = context.portfolio?.positions || [];
  if (!rows.length) return <Empty label="No intraday exposure. MIS fills appear here." />;

  return (
    <table className="w-full text-left">
      <Head columns={["Symbol", "Side", "Qty", "Avg", "LTP", "P&L", "P&L %", "Margin"]} />
      <tbody>
        {rows.map((row: EnrichedPosition) => (
          <tr
            key={row.instrument_key}
            onClick={() => onOpen(row.symbol)}
            className="cursor-pointer border-b border-[var(--line)]/50 text-[10.5px] last:border-0 hover:bg-white/[0.02]"
          >
            <td className="px-3 py-1.5 font-semibold text-zinc-200">{row.symbol}</td>
            <td className="px-2 py-1.5">
              <span
                className={`rounded px-1 py-0.5 text-[8.5px] font-bold uppercase tracking-wider ${
                  row.side === "LONG" ? "bg-emerald-500/10 text-emerald-300" : "bg-rose-500/10 text-rose-300"
                }`}
              >
                {row.side}
              </span>
            </td>
            <Cell value={String(Math.abs(row.quantity))} mono />
            <Cell value={price(row.average_price)} mono />
            <Cell value={price(row.last_price)} mono />
            <Cell value={signed(row.pnl)} mono tone={toneClass(row.pnl)} />
            <Cell value={percent(row.pnl_percent)} mono tone={toneClass(row.pnl_percent)} />
            <Cell value={money(row.margin_blocked)} mono muted />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Holdings({ context }: { context: TerminalContext }) {
  const rows = context.portfolio?.holdings || [];
  if (!rows.length) return <Empty label="No delivery holdings yet. CNC buys settle here." />;

  return (
    <table className="w-full text-left">
      <Head columns={["Symbol", "Qty", "Avg", "LTP", "Day %", "Value", "P&L", "P&L %"]} />
      <tbody>
        {rows.map((row) => (
          <tr key={row.instrument_key} className="border-b border-[var(--line)]/50 text-[10.5px] last:border-0 hover:bg-white/[0.02]">
            <td className="px-3 py-1.5 font-semibold text-zinc-200">{row.symbol}</td>
            <Cell value={String(row.quantity)} mono />
            <Cell value={price(row.average_price)} mono />
            <Cell value={price(row.last_price)} mono />
            <Cell value={percent(row.day_change_percent)} mono tone={toneClass(row.day_change_percent)} />
            <Cell value={money(row.value)} mono />
            <Cell value={signed(row.pnl)} mono tone={toneClass(row.pnl)} />
            <Cell value={percent(row.pnl_percent)} mono tone={toneClass(row.pnl_percent)} />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Orders({
  context,
  busy,
  onCancel,
}: {
  context: TerminalContext;
  busy: string | null;
  onCancel: (order: Order) => void;
}) {
  const rows = context.portfolio?.orders || [];
  if (!rows.length) return <Empty label="No orders today. Stage one from the pad on the right." />;

  return (
    <table className="w-full text-left">
      <Head columns={["Time", "Symbol", "Side", "Type", "Product", "Qty", "Price", "Status", ""]} />
      <tbody>
        {rows.map((order) => {
          const cancellable = order.status === "OPEN" || order.status === "PENDING";
          return (
            <tr key={order.id} className="border-b border-[var(--line)]/50 text-[10.5px] last:border-0 hover:bg-white/[0.02]">
              <td className="px-3 py-1.5 font-mono text-[9px] tabular-nums text-zinc-500">
                {new Date(order.created_at).toLocaleTimeString("en-IN", {
                  timeZone: "Asia/Kolkata",
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                  hour12: false,
                })}
              </td>
              <td className="px-2 py-1.5 font-semibold text-zinc-200">{order.symbol}</td>
              <td className={`px-2 py-1.5 text-[9px] font-bold ${order.side === "BUY" ? "text-emerald-400" : "text-rose-400"}`}>
                {order.side}
              </td>
              <Cell value={order.order_type} mono />
              <Cell value={order.product} mono muted />
              <Cell value={String(order.quantity)} mono />
              <Cell
                value={price(order.average_price ?? order.limit_price ?? order.trigger_price)}
                mono
              />
              <td className="px-2 py-1.5">
                <span
                  className={`rounded border px-1 py-0.5 text-[8.5px] font-semibold uppercase tracking-wider ${
                    STATUS_TONE[order.status] || STATUS_TONE.CANCELLED
                  }`}
                  title={order.status_message}
                >
                  {order.status}
                </span>
              </td>
              <td className="px-2 py-1.5 text-right">
                {cancellable && (
                  <button
                    onClick={() => onCancel(order)}
                    disabled={busy === order.id}
                    className="rounded border border-zinc-700 px-1.5 py-0.5 text-[8.5px] uppercase tracking-wider text-zinc-400 transition hover:border-rose-500/40 hover:text-rose-300 disabled:opacity-40"
                  >
                    {busy === order.id ? "…" : "Cancel"}
                  </button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Trades({ context }: { context: TerminalContext }) {
  const rows = context.portfolio?.trades || [];
  if (!rows.length) return <Empty label="No executions yet. Filled orders land here with charges." />;

  return (
    <table className="w-full text-left">
      <Head columns={["Time", "Symbol", "Side", "Qty", "Price", "Charges", "Realised", "Product"]} />
      <tbody>
        {rows.map((trade) => (
          <tr key={trade.id} className="border-b border-[var(--line)]/50 text-[10.5px] last:border-0 hover:bg-white/[0.02]">
            <td className="px-3 py-1.5 font-mono text-[9px] tabular-nums text-zinc-500">
              {new Date(trade.executed_at).toLocaleTimeString("en-IN", {
                timeZone: "Asia/Kolkata",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false,
              })}
            </td>
            <td className="px-2 py-1.5 font-semibold text-zinc-200">{trade.symbol}</td>
            <td className={`px-2 py-1.5 text-[9px] font-bold ${trade.side === "BUY" ? "text-emerald-400" : "text-rose-400"}`}>
              {trade.side}
            </td>
            <Cell value={String(trade.quantity)} mono />
            <Cell value={price(trade.price)} mono />
            <Cell value={money(trade.charges.total)} mono muted />
            <Cell value={signed(trade.realized_pnl)} mono tone={toneClass(trade.realized_pnl)} />
            <Cell value={trade.product} mono muted />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Head({ columns }: { columns: string[] }) {
  return (
    <thead className="sticky top-0 z-10 bg-[#0a1017]">
      <tr>
        {columns.map((column) => (
          <th
            key={column}
            className="px-2 py-1.5 text-[8px] font-semibold uppercase tracking-[0.12em] text-zinc-600 first:pl-3 last:pr-3"
          >
            {column}
          </th>
        ))}
      </tr>
    </thead>
  );
}

function Cell({ value, mono, tone, muted }: { value: string; mono?: boolean; tone?: string; muted?: boolean }) {
  return (
    <td
      className={`px-2 py-1.5 tabular-nums ${mono ? "font-mono" : ""} ${
        tone || (muted ? "text-zinc-500" : "text-zinc-300")
      }`}
    >
      {value}
    </td>
  );
}
