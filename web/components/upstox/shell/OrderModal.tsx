"use client";

import { useEffect, useMemo, useState } from "react";

import { computeCharges } from "@/lib/charges";
import { inr } from "@/lib/client/format";
import { useApp, useQuotes } from "../AppProvider";
import { CloseIcon } from "../icons";

const TYPES = ["MARKET", "LIMIT", "SL", "SL-M"] as const;

export function OrderModal() {
  const { orderTarget, closeOrder, placeOrder, portfolio, notify } = useApp();
  const key = orderTarget?.instrument_key || "";
  const quotes = useQuotes(key ? [key] : []);
  const quote = quotes[key];

  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [product, setProduct] = useState<"CNC" | "MIS">("CNC");
  const [orderType, setOrderType] = useState<(typeof TYPES)[number]>("MARKET");
  const [qty, setQty] = useState(1);
  const [limit, setLimit] = useState("");
  const [trigger, setTrigger] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orderTarget) return;
    setSide(orderTarget.side || "BUY");
    setProduct("CNC");
    setOrderType("MARKET");
    setQty(1);
    setLimit(orderTarget.price ? String(orderTarget.price) : "");
    setTrigger("");
    setError(null);
  }, [orderTarget]);

  useEffect(() => {
    if (!orderTarget) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeOrder();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [orderTarget, closeOrder]);

  const price = useMemo(() => {
    if (orderType === "MARKET") return quote?.last_price || orderTarget?.price || 0;
    if (orderType === "LIMIT") return Number(limit) || 0;
    return Number(limit) || Number(trigger) || quote?.last_price || 0;
  }, [orderType, quote, limit, trigger, orderTarget]);

  if (!orderTarget) return null;

  const notional = price * qty;
  const charges = computeCharges(side, product, price || 0, qty);
  const margin = product === "CNC" ? (side === "BUY" ? notional + charges.total : charges.total) : notional / 5 + charges.total;
  const available = portfolio?.funds.available ?? 0;
  const shortfall = margin > available;

  async function submit() {
    setError(null);
    if (!qty || qty <= 0) {
      setError("Quantity must be at least 1.");
      return;
    }
    if (orderType !== "MARKET" && (!limit || Number(limit) <= 0)) {
      setError("Enter a valid limit price.");
      return;
    }
    if (orderType === "SL" || orderType === "SL-M") {
      if (!trigger || Number(trigger) <= 0) {
        setError("Enter a valid trigger price.");
        return;
      }
    }
    setBusy(true);
    const result = await placeOrder({
      instrument_key: key,
      side,
      quantity: Math.floor(qty),
      order_type: orderType,
      product,
      limit_price: orderType === "LIMIT" || orderType === "SL" ? Number(limit) : null,
      trigger_price: orderType === "SL" || orderType === "SL-M" ? Number(trigger) : null,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error || "Order rejected");
      notify({ tone: "error", title: "Order rejected", message: result.error });
      return;
    }
    closeOrder();
  }

  return (
    <>
      <div className="scrim" onClick={closeOrder} />
      <div className="modal" role="dialog" aria-label="Place order" style={{ width: "min(420px, calc(100vw - 32px))" }}>
        <div className="modal-head">
          <div className="grow">
            <div className="modal-title">{orderTarget.symbol}</div>
            <div style={{ fontSize: 10, color: "var(--text-2)" }}>
              {orderTarget.name || orderTarget.segment?.replace("_", " ")} · LTP {quote ? inr(quote.last_price) : "—"}
            </div>
          </div>
          <button className="icon-btn" onClick={closeOrder} aria-label="Close order pad">
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="ordertabs" style={{ padding: "0 16px" }}>
          <button className={`ordertab ${side === "BUY" ? "active buy" : ""}`} onClick={() => setSide("BUY")}>BUY</button>
          <button className={`ordertab ${side === "SELL" ? "active sell" : ""}`} onClick={() => setSide("SELL")}>SELL</button>
        </div>

        <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="field-row">
            <div className="field">
              <label>Product</label>
              <select className="select" value={product} onChange={(event) => setProduct(event.target.value as "CNC" | "MIS")}>
                <option value="CNC">CNC · Delivery</option>
                <option value="MIS">MIS · Intraday</option>
              </select>
            </div>
            <div className="field">
              <label>Order type</label>
              <select className="select" value={orderType} onChange={(event) => setOrderType(event.target.value as (typeof TYPES)[number])}>
                {TYPES.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="field">
            <label>Quantity</label>
            <div className="qty-stepper">
              <button onClick={() => setQty((v) => Math.max(1, v - 1))} aria-label="Decrease quantity">−</button>
              <input
                value={qty}
                onChange={(event) => setQty(Math.max(1, Math.floor(Number(event.target.value) || 1)))}
                inputMode="numeric"
                aria-label="Quantity"
              />
              <button onClick={() => setQty((v) => v + 1)} aria-label="Increase quantity">+</button>
            </div>
          </div>

          {orderType !== "MARKET" && (
            <div className="field-row">
              <div className="field">
                <label>{orderType === "SL-M" ? "Limit (optional)" : "Price"}</label>
                <input
                  className="input"
                  value={limit}
                  onChange={(event) => setLimit(event.target.value)}
                  placeholder={quote ? inr(quote.last_price) : "0.00"}
                  inputMode="decimal"
                />
              </div>
              {(orderType === "SL" || orderType === "SL-M") && (
                <div className="field">
                  <label>Trigger</label>
                  <input
                    className="input"
                    value={trigger}
                    onChange={(event) => setTrigger(event.target.value)}
                    placeholder={quote ? inr(quote.last_price) : "0.00"}
                    inputMode="decimal"
                  />
                </div>
              )}
            </div>
          )}

          <div style={{ background: "var(--bg-subtle)", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
              <span className="muted">Order value</span>
              <span className="num">{price ? inr(notional) : "—"}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
              <span className="muted">Charges (est.)</span>
              <span className="num">{inr(charges.total)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
              <span className="muted">Margin required</span>
              <span className="num">{inr(margin)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
              <span className="muted">Available</span>
              <span className={`num ${shortfall ? "neg" : ""}`}>{inr(available)}</span>
            </div>
            <div className="margin-meter">
              <i style={{ width: `${Math.min(100, available ? (margin / available) * 100 : 100)}%`, background: shortfall ? "var(--neg)" : "var(--brand)" }} />
            </div>
          </div>

          {error && (
            <div style={{ fontSize: 11, color: "var(--neg)", background: "var(--neg-subtle)", borderRadius: 6, padding: "8px 10px" }}>
              {error}
            </div>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn" onClick={closeOrder}>Cancel</button>
          <button
            className={`btn ${side === "BUY" ? "btn-buy" : "btn-sell"}`}
            onClick={submit}
            disabled={busy}
          >
            {busy ? "Placing…" : `${side} ${orderTarget.symbol}`}
          </button>
        </div>
      </div>
    </>
  );
}
