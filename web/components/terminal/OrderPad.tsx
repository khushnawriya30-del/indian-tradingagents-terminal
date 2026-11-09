"use client";

import { useEffect, useMemo, useState } from "react";

import { computeCharges, round2 } from "@/lib/charges";
import { money, percent, price, toneClass } from "@/lib/format";
import type { OrderType, Product, Side } from "@/lib/types";
import type { TerminalContext } from "./Dashboard";

const ORDER_TYPES: Array<{ value: OrderType; label: string }> = [
  { value: "MARKET", label: "Market" },
  { value: "LIMIT", label: "Limit" },
  { value: "SL", label: "SL" },
  { value: "SL-M", label: "SL-M" },
];

const PRODUCTS: Array<{ value: Product; label: string; hint: string }> = [
  { value: "CNC", label: "CNC", hint: "Delivery · full cash debit" },
  { value: "MIS", label: "MIS", hint: "Intraday · 5× margin" },
];

const MIS_LEVERAGE = 5;

function lotsOf(value: string): number {
  const parsed = Number(value.replace(/[^0-9]/g, ""));
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

export function OrderPad({ context }: { context: TerminalContext }) {
  const { selected, quotes, portfolio, session, notify, refreshPortfolio } = context;
  const quote = selected ? quotes[selected.instrument_key] : undefined;

  const [side, setSide] = useState<Side>("BUY");
  const [product, setProduct] = useState<Product>("CNC");
  const [orderType, setOrderType] = useState<OrderType>("MARKET");
  const [quantity, setQuantity] = useState("1");
  const [limitPrice, setLimitPrice] = useState("");
  const [triggerPrice, setTriggerPrice] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setLimitPrice(quote?.last_price ? quote.last_price.toFixed(2) : "");
    setTriggerPrice(quote?.last_price ? quote.last_price.toFixed(2) : "");
  }, [selected?.instrument_key]);

  const qty = lotsOf(quantity);
  const reference = useMemo(() => {
    if (orderType === "LIMIT" || orderType === "SL") {
      const typed = Number(limitPrice);
      if (Number.isFinite(typed) && typed > 0) return typed;
    }
    return quote?.last_price || 0;
  }, [orderType, limitPrice, quote?.last_price]);

  const needsLimit = orderType === "LIMIT" || orderType === "SL";
  const needsTrigger = orderType === "SL" || orderType === "SL-M";

  const position = portfolio?.positions.find((row) => row.instrument_key === selected?.instrument_key);
  const heldQty = position?.quantity || 0;

  const estimate = useMemo(() => {
    if (!selected || !reference || qty <= 0) return null;
    const charges = computeCharges(side, product, reference, qty);
    let margin = 0;
    if (product === "CNC") {
      margin = side === "BUY" ? reference * qty + charges.total : charges.total;
    } else {
      const opening =
        side === "BUY" && heldQty < 0
          ? Math.max(0, qty - Math.min(qty, -heldQty))
          : side === "SELL" && heldQty > 0
            ? Math.max(0, qty - Math.min(qty, heldQty))
            : qty;
      margin = (opening * reference) / MIS_LEVERAGE + charges.total;
    }
    return {
      notional: round2(reference * qty),
      margin: round2(margin),
      charges,
    };
  }, [selected, reference, qty, side, product, heldQty]);

  const buyingPower = portfolio?.funds.available ?? 0;
  const shortfall = estimate ? estimate.margin - buyingPower : 0;
  const blockedReason = !selected
    ? "Pick a symbol first"
    : qty <= 0
      ? "Quantity must be at least 1"
      : !reference
        ? "No live price for this instrument"
        : needsLimit && !(Number(limitPrice) > 0)
          ? "Enter a valid limit price"
          : needsTrigger && !(Number(triggerPrice) > 0)
            ? "Enter a valid trigger price"
            : shortfall > 0.01
              ? "Margin exceeds available cash"
              : null;

  async function submit() {
    if (!selected || blockedReason) {
      if (blockedReason) notify({ tone: "warn", title: "Order not sent", message: blockedReason });
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instrument_key: selected.instrument_key,
          side,
          quantity: qty,
          order_type: orderType,
          product,
          limit_price: needsLimit ? Number(limitPrice) : null,
          trigger_price: needsTrigger ? Number(triggerPrice) : null,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        const message = payload.error || payload.order?.status_message || `Order rejected (${response.status})`;
        notify({ tone: "error", title: "Order rejected", message });
        await refreshPortfolio();
        return;
      }
      const order = payload.order;
      notify({
        tone: order.status === "COMPLETE" ? "success" : "info",
        title:
          order.status === "COMPLETE"
            ? `${side} ${qty} ${selected.symbol} filled`
            : `${side} ${qty} ${selected.symbol} ${order.status.toLowerCase()}`,
        message:
          order.status === "COMPLETE"
            ? `${money(order.average_price ? order.average_price * qty : 0)} at ${price(order.average_price)} · ${order.product}`
            : order.status_message,
      });
      await refreshPortfolio();
    } catch (error) {
      notify({
        tone: "error",
        title: "Order failed",
        message: error instanceof Error ? error.message : "Network error",
      });
    } finally {
      setSubmitting(false);
    }
  }

  const sells = quote?.depth?.sell ? quote.depth.sell.slice(0, 5) : [];
  const buys = quote?.depth?.buy ? quote.depth.buy.slice(0, 5) : [];

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--panel)]">
      <div className="flex items-center justify-between border-b border-[var(--line)] px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
          Order pad
        </span>
        <span className="text-[9px] uppercase tracking-[0.14em] text-zinc-600">
          {session?.is_open ? "Live routing" : "Queued to open"}
        </span>
      </div>

      {!selected ? (
        <div className="px-3 py-8 text-center text-[11px] text-zinc-500">
          Select a symbol from the watchlist to stage an order.
        </div>
      ) : (
        <div className="space-y-3 px-3 py-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-[12.5px] font-semibold text-zinc-100">{selected.symbol}</div>
              <div className="truncate text-[9.5px] text-zinc-600">{selected.name || selected.segment}</div>
            </div>
            <div className="text-right">
              <div className="font-mono text-[12px] tabular-nums text-zinc-200">{price(quote?.last_price)}</div>
              <div className={`font-mono text-[9.5px] tabular-nums ${toneClass(quote?.change_percent)}`}>
                {percent(quote?.change_percent)}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1">
            {(["BUY", "SELL"] as const).map((value) => (
              <button
                key={value}
                onClick={() => setSide(value)}
                className={`rounded-md border py-1.5 text-[10.5px] font-bold uppercase tracking-[0.16em] transition ${
                  side === value
                    ? value === "BUY"
                      ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                      : "border-rose-500/40 bg-rose-500/15 text-rose-300"
                    : "border-[var(--line)] bg-white/[0.02] text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {value}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-1">
            {PRODUCTS.map((item) => (
              <button
                key={item.value}
                onClick={() => setProduct(item.value)}
                title={item.hint}
                className={`rounded border px-2 py-1 text-[10px] font-semibold tracking-wide transition ${
                  product === item.value
                    ? "border-sky-500/35 bg-sky-500/10 text-sky-300"
                    : "border-[var(--line)] text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="flex gap-1">
            {ORDER_TYPES.map((item) => (
              <button
                key={item.value}
                onClick={() => setOrderType(item.value)}
                className={`flex-1 rounded px-1 py-1 text-[9.5px] font-semibold uppercase tracking-[0.06em] transition ${
                  orderType === item.value
                    ? "bg-white/[0.07] text-zinc-100"
                    : "text-zinc-600 hover:text-zinc-300"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Quantity" suffix="qty">
              <input
                inputMode="numeric"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                className="w-full bg-transparent font-mono text-[12px] tabular-nums text-zinc-100 focus:outline-none"
              />
            </Field>
            <Field label={needsLimit ? "Limit price" : "Est. price"} suffix="₹">
              <input
                inputMode="decimal"
                value={needsLimit ? limitPrice : reference ? reference.toFixed(2) : ""}
                onChange={(event) => setLimitPrice(event.target.value)}
                disabled={!needsLimit}
                className={`w-full bg-transparent font-mono text-[12px] tabular-nums focus:outline-none ${
                  needsLimit ? "text-zinc-100" : "text-zinc-500"
                }`}
              />
            </Field>
          </div>

          {needsTrigger && (
            <Field label="Trigger price" suffix="₹">
              <input
                inputMode="decimal"
                value={triggerPrice}
                onChange={(event) => setTriggerPrice(event.target.value)}
                className="w-full bg-transparent font-mono text-[12px] tabular-nums text-zinc-100 focus:outline-none"
              />
            </Field>
          )}

          {(sells.length > 0 || buys.length > 0) && (
            <div className="overflow-hidden rounded border border-[var(--line)]">
              <div className="grid grid-cols-3 border-b border-[var(--line)] px-2 py-1 text-[8px] uppercase tracking-[0.12em] text-zinc-600">
                <span>Qty</span>
                <span className="text-right">Bid</span>
                <span className="text-right">Ask</span>
              </div>
              {Array.from({ length: Math.max(sells.length, buys.length) }).map((_, index) => {
                const bid = buys[index];
                const ask = sells[index];
                return (
                  <div
                    key={index}
                    className="grid grid-cols-3 px-2 py-[3px] font-mono text-[9.5px] tabular-nums odd:bg-white/[0.015]"
                  >
                    <span className="text-zinc-600">{bid?.quantity ?? ask?.quantity ?? "—"}</span>
                    <span className="text-right text-emerald-400/90">{bid ? price(bid.price) : "—"}</span>
                    <span className="text-right text-rose-400/90">{ask ? price(ask.price) : "—"}</span>
                  </div>
                );
              })}
            </div>
          )}

          <div className="space-y-1 rounded border border-[var(--line)] bg-black/20 px-2.5 py-2 text-[9.5px]">
            <Row label="Notional" value={estimate ? money(estimate.notional) : "—"} />
            <Row label="Margin blocked" value={estimate ? money(estimate.margin) : "—"} />
            <Row
              label="Charges"
              value={estimate ? money(estimate.charges.total) : "—"}
              hint={estimate ? `incl. GST ${money(estimate.charges.gst)}` : undefined}
            />
            <Row label="Available" value={money(buyingPower)} tone={toneClass(buyingPower - (estimate?.margin || 0))} />
          </div>

          {product === "MIS" && (
            <div className="text-[9px] leading-relaxed text-zinc-600">
              MIS shorts can be opened without holdings. Margin is marked to market each tick; the
              ledger blocks 20% of notional.
            </div>
          )}

          {shortfall > 0.01 && (
            <div className="rounded border border-rose-500/25 bg-rose-500/[0.07] px-2 py-1.5 text-[9.5px] text-rose-300">
              Short by {money(shortfall)} — reduce quantity or switch product.
            </div>
          )}

          {!session?.is_open && (
            <div className="rounded border border-amber-500/25 bg-amber-500/[0.06] px-2 py-1.5 text-[9.5px] leading-relaxed text-amber-300/90">
              Exchange closed. Orders are accepted into the queue and fill against the next official
              open print with 5 bps slippage.
            </div>
          )}

          <button
            onClick={submit}
            disabled={submitting || Boolean(blockedReason)}
            className={`w-full rounded-md border py-2 text-[11px] font-bold uppercase tracking-[0.18em] transition disabled:cursor-not-allowed disabled:opacity-40 ${
              side === "BUY"
                ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
                : "border-rose-500/40 bg-rose-500/15 text-rose-300 hover:bg-rose-500/25"
            }`}
          >
            {submitting ? "Routing…" : `${side} ${qty || 0} ${selected.symbol}`}
          </button>

          <div className="text-center text-[8.5px] uppercase tracking-[0.16em] text-zinc-600">
            {blockedReason || "Paper execution · no real money moved"}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  suffix,
  children,
}: {
  label: string;
  suffix: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block rounded border border-[var(--line)] bg-black/20 px-2 py-1.5">
      <span className="flex items-center justify-between text-[8px] uppercase tracking-[0.12em] text-zinc-600">
        {label}
        <span className="text-zinc-700">{suffix}</span>
      </span>
      {children}
    </label>
  );
}

function Row({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-zinc-600">
        {label}
        {hint && <span className="ml-1 text-zinc-700">({hint})</span>}
      </span>
      <span className={`font-mono tabular-nums ${tone || "text-zinc-300"}`}>{value}</span>
    </div>
  );
}
