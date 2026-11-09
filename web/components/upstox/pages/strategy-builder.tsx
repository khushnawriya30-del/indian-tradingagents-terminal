"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useApp } from "@/components/upstox/AppProvider";
import { PlusIcon, TrashIcon } from "@/components/upstox/icons";
import { Empty, Skeleton, Tag } from "@/components/upstox/ui";
import { cx, expiryLabel, inr } from "@/lib/client/format";
import type { ChainPayload, ChainRow } from "@/lib/types";

type Side = "BUY" | "SELL";
type OptionSide = "CE" | "PE";

interface Leg {
  id: number;
  side: Side;
  option: OptionSide;
  strike: number;
  lots: number;
}

const UNDERLYINGS = [
  { symbol: "NIFTY", label: "NIFTY 50", lot: 75 },
  { symbol: "BANKNIFTY", label: "BANKNIFTY", lot: 35 },
  { symbol: "FINNIFTY", label: "FINNIFTY", lot: 65 },
  { symbol: "MIDCPNIFTY", label: "MIDCPNIFTY", lot: 120 },
  { symbol: "SENSEX", label: "SENSEX", lot: 20 },
];

const STRATEGY_TEMPLATES: Array<{
  id: string;
  name: string;
  legs: Array<{ side: Side; option: OptionSide; offset: number }>;
}> = [
  { id: "straddle", name: "Short straddle", legs: [{ side: "SELL", option: "CE", offset: 0 }, { side: "SELL", option: "PE", offset: 0 }] },
  { id: "strangle", name: "Short strangle", legs: [{ side: "SELL", option: "CE", offset: 3 }, { side: "SELL", option: "PE", offset: -3 }] },
  { id: "iron-condor", name: "Iron condor", legs: [
    { side: "SELL", option: "CE", offset: 2 },
    { side: "BUY", option: "CE", offset: 5 },
    { side: "SELL", option: "PE", offset: -2 },
    { side: "BUY", option: "PE", offset: -5 },
  ] },
  { id: "bull-call", name: "Bull call spread", legs: [{ side: "BUY", option: "CE", offset: 0 }, { side: "SELL", option: "CE", offset: 4 }] },
  { id: "bear-put", name: "Bear put spread", legs: [{ side: "BUY", option: "PE", offset: 0 }, { side: "SELL", option: "PE", offset: -4 }] },
];

export function StrategyBuilderPage({ initialSymbol = "NIFTY" }: { initialSymbol?: string }) {
  const { placeOrder, notify, portfolio } = useApp();
  const [symbol, setSymbol] = useState(initialSymbol.toUpperCase());
  const [expiry, setExpiry] = useState<string | null>(null);
  const [payload, setPayload] = useState<ChainPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [legs, setLegs] = useState<Leg[]>([]);
  const [placing, setPlacing] = useState(false);
  const [lots, setLots] = useState(1);

  const lotSize = useMemo(() => {
    const preset = UNDERLYINGS.find((item) => item.symbol === symbol);
    return payload?.lot_size || preset?.lot || 75;
  }, [payload?.lot_size, symbol]);

  const load = useCallback(
    async (nextSymbol = symbol, nextExpiry: string | null = expiry) => {
      try {
        const params = new URLSearchParams({ symbol: nextSymbol });
        if (nextExpiry) params.set("expiry", nextExpiry);
        const res = await fetch(`/api/chain?${params.toString()}`, { cache: "no-store" });
        const data = (await res.json()) as ChainPayload & { error?: string };
        if (!res.ok) throw new Error(data.error || "Chain unavailable");
        setPayload(data);
        setExpiry(data.expiry);
        setError(null);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Chain unavailable");
      }
    },
    [symbol, expiry]
  );

  useEffect(() => {
    load(symbol, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  const strikes = useMemo(() => (payload?.rows || []).map((row) => row.strike), [payload]);
  const atm = useMemo(() => {
    if (!payload?.rows?.length) return 0;
    const spot = payload.spot || 0;
    return payload.rows.reduce((best, row) => (Math.abs(row.strike - spot) < Math.abs(best - spot) ? row.strike : best), payload.rows[0].strike);
  }, [payload]);

  const atmIndex = useMemo(() => strikes.findIndex((strike) => strike === atm), [strikes, atm]);

  const rowFor = (strike: number): ChainRow | undefined => payload?.rows.find((row) => row.strike === strike);

  const priced = useMemo(() => {
    return legs
      .map((leg) => {
        const row = rowFor(leg.strike);
        if (!row) return null;
        const optionLeg = leg.option === "CE" ? row.call : row.put;
        const sign = leg.side === "BUY" ? 1 : -1;
        return {
          ...leg,
          premium: optionLeg.ltp,
          delta: optionLeg.delta * sign * leg.lots * lotSize,
          gamma: optionLeg.gamma * sign * leg.lots * lotSize,
          theta: optionLeg.theta * sign * leg.lots * lotSize,
          vega: optionLeg.vega * sign * leg.lots * lotSize,
          value: optionLeg.ltp * leg.lots * lotSize * sign,
          instrument_key: optionLeg.instrument_key,
          symbol_label: `${symbol} ${expiryLabel(expiry)} ${leg.strike} ${leg.option}`,
        };
      })
      .filter(Boolean) as Array<Leg & {
        premium: number;
        delta: number;
        gamma: number;
        theta: number;
        vega: number;
        value: number;
        instrument_key: string;
        symbol_label: string;
      }>;
  }, [legs, payload, lotSize, symbol, expiry]);

  const netPremium = priced.reduce((sum, leg) => sum + leg.value, 0);
  const netDelta = priced.reduce((sum, leg) => sum + leg.delta, 0);
  const netGamma = priced.reduce((sum, leg) => sum + leg.gamma, 0);
  const netTheta = priced.reduce((sum, leg) => sum + leg.theta, 0);
  const netVega = priced.reduce((sum, leg) => sum + leg.vega, 0);

  const margin = useMemo(() => {
    const shortValue = priced.filter((leg) => leg.side === "SELL").reduce((sum, leg) => sum + leg.premium * leg.lots * lotSize, 0);
    return shortValue ? shortValue * 0.2 + shortValue : netPremium < 0 ? -netPremium : 0;
  }, [priced, lotSize, netPremium]);

  const payoff = useMemo(() => {
    if (!priced.length || !payload?.spot) return null;
    const spot = payload.spot;
    const min = Math.min(...legs.map((leg) => leg.strike), spot) * 0.92;
    const max = Math.max(...legs.map((leg) => leg.strike), spot) * 1.08;
    const steps = 160;
    const points: Array<{ price: number; pnl: number }> = [];
    for (let index = 0; index <= steps; index += 1) {
      const price = min + ((max - min) * index) / steps;
      let pnl = 0;
      for (const leg of priced) {
        const intrinsic = leg.option === "CE" ? Math.max(0, price - leg.strike) : Math.max(0, leg.strike - price);
        const sign = leg.side === "BUY" ? 1 : -1;
        pnl += sign * (intrinsic - leg.premium) * leg.lots * lotSize;
      }
      points.push({ price, pnl });
    }
    return { points, min, max, spot };
  }, [priced, legs, payload?.spot, lotSize]);

  const breakevens = useMemo(() => {
    if (!payoff) return [];
    const out: number[] = [];
    for (let index = 1; index < payoff.points.length; index += 1) {
      const previous = payoff.points[index - 1];
      const current = payoff.points[index];
      if ((previous.pnl <= 0 && current.pnl > 0) || (previous.pnl >= 0 && current.pnl < 0)) {
        out.push(current.price);
      }
    }
    return out.slice(0, 4);
  }, [payoff]);

  const maxProfit = payoff ? Math.max(...payoff.points.map((point) => point.pnl)) : 0;
  const maxLoss = payoff ? Math.min(...payoff.points.map((point) => point.pnl)) : 0;

  function applyTemplate(id: string) {
    const template = STRATEGY_TEMPLATES.find((item) => item.id === id);
    if (!template || !strikes.length) return;
    const base = atmIndex >= 0 ? atmIndex : Math.floor(strikes.length / 2);
    const next = template.legs.map((leg, index) => {
      const strike = strikes[Math.min(strikes.length - 1, Math.max(0, base + leg.offset))];
      return { id: Date.now() + index, side: leg.side, option: leg.option, strike, lots: 1 };
    });
    setLegs(next);
  }

  function addLeg() {
    const strike = strikes[atmIndex >= 0 ? atmIndex : 0] || 0;
    setLegs((current) => [...current, { id: Date.now(), side: "BUY", option: "CE", strike, lots: 1 }]);
  }

  function updateLeg(id: number, patch: Partial<Leg>) {
    setLegs((current) => current.map((leg) => (leg.id === id ? { ...leg, ...patch } : leg)));
  }

  async function placeBasket() {
    if (!priced.length) {
      notify({ tone: "warn", title: "Add a leg first" });
      return;
    }
    setPlacing(true);
    let filled = 0;
    let failed = 0;
    for (const leg of priced) {
      const result = await placeOrder({
        instrument_key: leg.instrument_key,
        side: leg.side,
        quantity: leg.lots * lotSize,
        order_type: "MARKET",
        product: "MIS",
      });
      if (result.ok) filled += 1;
      else failed += 1;
    }
    setPlacing(false);
    notify({
      tone: failed ? "warn" : "success",
      title: failed ? `${filled} placed · ${failed} rejected` : `${filled}-leg basket placed`,
      message: failed ? "Check the order book for rejections." : "Paper ledger updated with the full basket.",
    });
  }

  return (
    <div className="content">
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Strategy builder</h1>
          <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-2)" }}>
            Multi-leg option baskets · payoff, Greeks and basket execution
          </p>
        </div>
        <div className="spacer" />
        <Tag tone="brand">Available {inr(portfolio?.funds.available ?? 0)}</Tag>
        <button className="btn" onClick={addLeg} style={{ gap: 4 }}>
          <PlusIcon size={14} /> Add leg
        </button>
      </div>

      <div className="chips">
        {UNDERLYINGS.map((item) => (
          <button key={item.symbol} className={cx("chip", symbol === item.symbol && "active")} onClick={() => { setSymbol(item.symbol); setLegs([]); }}>
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
        <div style={{ border: "1px solid var(--neg)", background: "var(--neg-subtle)", color: "var(--neg)", borderRadius: 8, padding: "8px 12px", fontSize: 12, marginBottom: 14 }}>
          {error}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.55fr) minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
        <div className="panel">
          <div className="panel-head">
            <span className="panel-title">Legs</span>
            <span className="spacer" />
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "var(--text-2)" }}>
              Lots
              <select className="select" style={{ height: 26, fontSize: 10 }} value={lots} onChange={(event) => setLots(Number(event.target.value))}>
                {[1, 2, 3, 5, 10].map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </label>
          </div>

          <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            {legs.map((leg) => (
              <div key={leg.id} style={{ display: "grid", gridTemplateColumns: "90px 90px 1fr 70px 34px", gap: 8, alignItems: "center" }}>
                <select
                  className="select"
                  value={leg.side}
                  onChange={(event) => updateLeg(leg.id, { side: event.target.value as Side })}
                  style={{ color: leg.side === "BUY" ? "var(--pos)" : "var(--neg)", fontWeight: 600 }}
                >
                  <option value="BUY">Buy</option>
                  <option value="SELL">Sell</option>
                </select>
                <select className="select" value={leg.option} onChange={(event) => updateLeg(leg.id, { option: event.target.value as OptionSide })}>
                  <option value="CE">Call</option>
                  <option value="PE">Put</option>
                </select>
                <select className="select" value={leg.strike} onChange={(event) => updateLeg(leg.id, { strike: Number(event.target.value) })}>
                  {strikes.map((strike) => (
                    <option key={strike} value={strike}>{inr(strike, 0)}</option>
                  ))}
                </select>
                <input
                  className="input num"
                  value={leg.lots}
                  onChange={(event) => updateLeg(leg.id, { lots: Math.max(1, Number(event.target.value) || 1) })}
                  inputMode="numeric"
                  aria-label="Lots"
                />
                <button className="icon-btn" style={{ width: 30, height: 30 }} aria-label="Remove leg" onClick={() => setLegs((current) => current.filter((item) => item.id !== leg.id))}>
                  <TrashIcon size={13} />
                </button>
              </div>
            ))}
            {!legs.length && <Empty title="No legs yet" hint="Pick a template below, or add a leg manually." />}

            <div style={{ borderTop: "1px solid var(--stroke-2)", paddingTop: 10, marginTop: 4 }}>
              <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-3)", marginBottom: 6 }}>
                Templates
              </div>
              <div className="chips" style={{ marginBottom: 0 }}>
                {STRATEGY_TEMPLATES.map((template) => (
                  <button key={template.id} className="chip sm" onClick={() => applyTemplate(template.id)} disabled={!strikes.length}>
                    {template.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <span className="panel-title">Summary</span>
            <span className="spacer" />
            <Tag tone="outline">Lot {lotSize}</Tag>
          </div>
          <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8, fontSize: 11 }}>
            <Row label="Net premium" value={inr(netPremium)} tone={netPremium >= 0 ? "pos" : "neg"} />
            <Row label="Max profit" value={payoff ? inr(maxProfit) : "—"} tone="pos" />
            <Row label="Max loss" value={payoff ? inr(maxLoss) : "—"} tone="neg" />
            <Row label="Margin est." value={inr(margin)} />
            <Row label="Breakevens" value={breakevens.length ? breakevens.map((value) => inr(value, 0)).join(" · ") : "—"} />
            <div style={{ height: 1, background: "var(--stroke-2)", margin: "4px 0" }} />
            <Row label="Delta" value={netDelta.toFixed(2)} />
            <Row label="Gamma" value={netGamma.toFixed(3)} />
            <Row label="Theta" value={netTheta.toFixed(2)} />
            <Row label="Vega" value={netVega.toFixed(2)} />
            <button
              className="btn btn-primary btn-lg"
              style={{ marginTop: 6 }}
              disabled={placing || !priced.length}
              onClick={placeBasket}
            >
              {placing ? "Placing basket…" : `Place ${priced.length}-leg basket`}
            </button>
            <div style={{ fontSize: 10, color: "var(--text-3)", lineHeight: "15px" }}>
              Basket legs are sent as separate MIS market orders and fill through the paper ledger.
            </div>
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel-head">
          <span className="panel-title">Payoff at expiry</span>
          <span className="spacer" />
          {payload?.spot && <span style={{ fontSize: 10, color: "var(--text-2)" }}>Spot {inr(payload.spot)}</span>}
        </div>
        <div style={{ padding: 12 }}>
          {!payoff ? (
            <Skeleton height={240} />
          ) : (
            <PayoffChart payoff={payoff} />
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
      <span className="muted">{label}</span>
      <span className={cx("num", tone === "pos" && "pos", tone === "neg" && "neg")} style={{ fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function PayoffChart({ payoff }: { payoff: { points: Array<{ price: number; pnl: number }>; min: number; max: number; spot: number } }) {
  const width = 900;
  const height = 240;
  const padLeft = 4;
  const padRight = 4;
  const maxAbs = Math.max(...payoff.points.map((point) => Math.abs(point.pnl)), 1);
  const x = (price: number) => padLeft + ((price - payoff.min) / (payoff.max - payoff.min || 1)) * (width - padLeft - padRight);
  const y = (pnl: number) => height / 2 - (pnl / maxAbs) * (height / 2 - 12);
  const path = payoff.points.map((point, index) => `${index === 0 ? "M" : "L"}${x(point.price).toFixed(1)},${y(point.pnl).toFixed(1)}`).join(" ");
  const zeroY = y(0);
  const positive = payoff.points.map((point) => ({ ...point, pnl: Math.max(0, point.pnl) }));
  const areaPath = `${path} L${x(payoff.points[payoff.points.length - 1].price).toFixed(1)},${zeroY} L${x(payoff.points[0].price).toFixed(1)},${zeroY} Z`;
  const spotX = x(payoff.spot);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="payoff" style={{ width: "100%", height: 240 }}>
      <defs>
        <linearGradient id="payoffFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(0,122,79,.22)" />
          <stop offset="100%" stopColor="rgba(0,122,79,0)" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((fraction) => (
        <line key={fraction} x1={0} x2={width} y1={height * fraction} y2={height * fraction} stroke="var(--stroke-2)" strokeWidth="1" />
      ))}
      <line x1={0} x2={width} y1={zeroY} y2={zeroY} stroke="var(--stroke)" strokeWidth="1" />
      <path d={areaPath} fill="url(#payoffFill)" />
      <path d={path} fill="none" stroke="var(--brand)" strokeWidth="1.8" strokeLinejoin="round" />
      <line x1={spotX} x2={spotX} y1={8} y2={height - 8} stroke="var(--pos)" strokeWidth="1" strokeDasharray="4 3" />
      <text x={spotX + 4} y={16} fontSize="10" fill="var(--pos)">Spot</text>
      <text x={padLeft} y={height - 2} fontSize="10" fill="var(--text-3)">{inr(payoff.min, 0)}</text>
      <text x={width - padRight} y={height - 2} fontSize="10" fill="var(--text-3)" textAnchor="end">{inr(payoff.max, 0)}</text>
      <text x={width - padRight} y={12} fontSize="10" fill="var(--text-3)" textAnchor="end">Positive {inr(maxAbs)}</text>
      <text x={width - padRight} y={height - 14} fontSize="10" fill="var(--text-3)" textAnchor="end">Negative −{inr(maxAbs)}</text>
      <path d={positive.map((point, index) => `${index === 0 ? "M" : "L"}${x(point.price).toFixed(1)},${zeroY}`).join(" ")} fill="none" stroke="transparent" />
    </svg>
  );
}
