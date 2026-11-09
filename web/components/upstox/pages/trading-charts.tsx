"use client";

import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useApp, useQuotes } from "@/components/upstox/AppProvider";
import { ChevronDown, SparkleIcon } from "@/components/upstox/icons";
import { Change, Empty, Skeleton, Tag } from "@/components/upstox/ui";
import { compactInr, cx, inr, pct } from "@/lib/client/format";
import type { Candle, Quote } from "@/lib/types";
import { TradingViewWidget, toTradingViewSymbol } from "./TradingViewWidget";

const INTERVALS = ["1m", "5m", "15m", "1D"] as const;
type Interval = (typeof INTERVALS)[number];

export function TradingChartPage({
  initialKey,
  initialSide,
}: {
  initialKey: string;
  initialSide?: "BUY" | "SELL";
}) {
  const router = useRouter();
  const { openOrder, openAi, notify, session } = useApp();
  const [key, setKey] = useState(initialKey);
  const [interval, setIntervalValue] = useState<Interval>("15m");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [side, setSide] = useState<"BUY" | "SELL">(initialSide || "BUY");
  const [qty, setQty] = useState(1);
  const [orderType, setOrderType] = useState<"MARKET" | "LIMIT">("MARKET");
  const [limit, setLimit] = useState("");
  const [product, setProduct] = useState<"CNC" | "MIS">("MIS");

  const quotes = useQuotes([key]);
  const quote: Quote | null = quotes[key] || null;
  const segment = quote?.segment || key.split("|")[0] || "NSE_EQ";
  const isDerivative = segment.includes("_FO");
  const tvSymbol = toTradingViewSymbol(
    quote?.symbol || key.split("|")[1] || "",
    segment,
    segment.startsWith("BSE") ? "BSE" : "NSE"
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const lineRef = useRef<ISeriesApi<"Line"> | null>(null);

  useEffect(() => {
    setKey(initialKey);
  }, [initialKey]);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const res = await fetch(`/api/candles?key=${encodeURIComponent(key)}&interval=${interval}`, { cache: "no-store" });
        const data = (await res.json()) as { candles?: Candle[]; warning?: string; error?: string };
        if (!res.ok) throw new Error(data.error || `Candles failed (${res.status})`);
        setCandles(data.candles || []);
        setWarning(data.warning || null);
        setError(null);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Chart unavailable");
      } finally {
        setLoading(false);
      }
    },
    [key, interval]
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const intervalId = setInterval(() => load(true), 45_000);
    return () => clearInterval(intervalId);
  }, [load]);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#6e6e6e",
        fontFamily: "Inter, Helvetica, Arial, sans-serif",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "#f4f4f4" },
        horzLines: { color: "#f4f4f4" },
      },
      rightPriceScale: { borderColor: "#e1e1e1", scaleMargins: { top: 0.08, bottom: 0.24 } },
      timeScale: { borderColor: "#e1e1e1", timeVisible: true, secondsVisible: false, rightOffset: 4 },
      crosshair: {
        mode: 0,
        vertLine: { color: "#c6c6c6", width: 1, style: 2, labelBackgroundColor: "#262626" },
        horzLine: { color: "#c6c6c6", width: 1, style: 2, labelBackgroundColor: "#262626" },
      },
      handleScale: { axisPressedMouseMove: true },
    });
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#007a4f",
      downColor: "#c63224",
      borderUpColor: "#007a4f",
      borderDownColor: "#c63224",
      wickUpColor: "#007a4f",
      wickDownColor: "#c63224",
      priceLineVisible: true,
      priceLineColor: "#8d4dd1",
      lastValueVisible: true,
    });
    candleRef.current = candleSeries;

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      color: "#c9b6de",
    });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    volumeRef.current = volumeSeries;

    const lineSeries = chart.addSeries(LineSeries, {
      color: "#8d4dd1",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    lineRef.current = lineSeries;

    const observer = new ResizeObserver(() => chart.applyOptions({}));
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
      lineRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!candleRef.current || !volumeRef.current || !lineRef.current) return;
    const series = candles
      .filter((candle) => candle.open > 0 && candle.close > 0)
      .map((candle) => ({
        time: candle.time as UTCTimestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      }));
    candleRef.current.setData(series);
    volumeRef.current.setData(
      candles.map((candle) => ({
        time: candle.time as UTCTimestamp,
        value: candle.volume || 0,
        color: candle.close >= candle.open ? "rgba(0,122,79,.35)" : "rgba(198,50,36,.28)",
      }))
    );

    const period = 20;
    const closes = candles.map((candle) => candle.close);
    const averages: Array<{ time: UTCTimestamp; value: number }> = [];
    closes.forEach((_, index) => {
      if (index < period - 1) return;
      let sum = 0;
      for (let offset = 0; offset < period; offset += 1) sum += closes[index - offset];
      averages.push({ time: candles[index].time as UTCTimestamp, value: sum / period });
    });
    lineRef.current.setData(averages);
    if (series.length) chartRef.current?.timeScale().fitContent();
  }, [candles]);

  const price = orderType === "MARKET" ? quote?.last_price || 0 : Number(limit) || 0;
  const notional = price * qty;
  const margin = product === "CNC" ? notional : notional / 5;

  const bid = quote?.bid || quote?.depth?.buy?.[0]?.price || quote?.last_price || 0;
  const ask = quote?.ask || quote?.depth?.sell?.[0]?.price || quote?.last_price || 0;
  const spread = ask && bid ? ask - bid : 0;

  const header = useMemo(() => {
    if (!candles.length) return null;
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const change = last.close - (prev?.close ?? last.open);
    return { close: last.close, change };
  }, [candles]);

  return (
    <div className="content" style={{ paddingTop: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>{quote?.symbol || key.split("|")[1] || "Chart"}</h1>
            <Tag tone="outline">{key.split("|")[0]?.replace("_", " ")}</Tag>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 2 }}>
            <span style={{ fontSize: 18, fontWeight: 600 }} className="num">
              {quote ? inr(quote.last_price) : "—"}
            </span>
            {quote && <Change value={quote.change} percent={quote.change_percent} />}
            <span style={{ fontSize: 10, color: "var(--text-2)" }}>
              {quote ? `O ${inr(quote.open)} · H ${inr(quote.high)} · L ${inr(quote.low)} · Vol ${compactInr(quote.volume)}` : ""}
            </span>
          </div>
        </div>
        <div className="spacer" />
        <div style={{ display: "inline-flex", border: "1px solid var(--stroke)", borderRadius: 6, overflow: "hidden" }}>
          {INTERVALS.map((item) => (
            <button
              key={item}
              onClick={() => setIntervalValue(item)}
              style={{
                height: 30,
                padding: "0 12px",
                border: 0,
                borderRight: item === INTERVALS[INTERVALS.length - 1] ? 0 : "1px solid var(--stroke)",
                background: interval === item ? "var(--brand-callout)" : "#fff",
                color: interval === item ? "var(--brand)" : "var(--text)",
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              {item}
            </button>
          ))}
        </div>
        <button
          className="btn btn-sm"
          style={{ gap: 4 }}
          onClick={() => {
            if (!quote) return;
            openAi({ instrument_key: key, symbol: quote.symbol, name: quote.name, segment: quote.segment });
          }}
        >
          <SparkleIcon size={13} /> AI desk
        </button>
        <button
          className="btn btn-sm"
          onClick={() => router.push(`/option-chain?symbol=${encodeURIComponent((quote?.symbol || "").split(" ")[0])}`)}
        >
          Option chain
        </button>
      </div>

      {error && (
        <div style={{ border: "1px solid var(--neg)", background: "var(--neg-subtle)", color: "var(--neg)", borderRadius: 8, padding: "8px 12px", fontSize: 12, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {!isDerivative && (
        <div className="panel" style={{ marginBottom: 16, padding: 0, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: "1px solid var(--stroke-2)", fontSize: 10.5, color: "var(--text-2)" }}>
            <b style={{ color: "var(--text)", fontSize: 11 }}>{tvSymbol}</b>
            <span className="tag outline">TradingView</span>
            <span className="faint">|</span>
            <span>Indicators, drawing tools and full timeframes</span>
            <span className="spacer" />
            <a
              className="btn btn-sm"
              href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSymbol)}`}
              target="_blank"
              rel="noreferrer"
            >
              Open full chart
            </a>
          </div>
          {quote?.symbol ? (
            <TradingViewWidget symbol={tvSymbol} interval={interval} height={560} />
          ) : (
            <div style={{ height: 560, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-2)", fontSize: 12 }}>
              Loading live chart…
            </div>
          )}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 300px", gap: 16, alignItems: "start" }}>
        <div style={{ border: "1px solid var(--stroke)", borderRadius: 10, overflow: "hidden", background: "#fff" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", borderBottom: "1px solid var(--stroke-2)", fontSize: 10, color: "var(--text-2)" }}>
            <span>Upstox candles</span>
            <span className="faint">|</span>
            <span>MA 20</span>
            <span className="faint">|</span>
            <span>{interval}</span>
            <span className="faint">|</span>
            <span>{session ? session.phase.replace("_", " ") : "—"}</span>
            {warning && <span style={{ marginLeft: "auto", color: "var(--warn)" }}>{warning}</span>}
          </div>
          <div style={{ position: "relative" }}>
            {loading && !candles.length && (
              <div style={{ position: "absolute", inset: 0, padding: 16, background: "#fff", zIndex: 2 }}>
                <Skeleton height={380} />
              </div>
            )}
            <div ref={containerRef} style={{ width: "100%", height: 320 }} />
            {!loading && !candles.length && !error && (
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Empty title="No candles returned" hint="The exchange may be closed and the vendor has no intraday history for this instrument." />
              </div>
            )}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="panel">
            <div className="ordertabs" style={{ padding: "0 14px" }}>
              <button className={cx("ordertab", side === "BUY" && "active buy")} onClick={() => setSide("BUY")}>BUY</button>
              <button className={cx("ordertab", side === "SELL" && "active sell")} onClick={() => setSide("SELL")}>SELL</button>
            </div>
            <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              <div className="field-row">
                <div className="field">
                  <label>Product</label>
                  <select className="select" value={product} onChange={(event) => setProduct(event.target.value as "CNC" | "MIS")}>
                    <option value="MIS">MIS · Intraday</option>
                    <option value="CNC">CNC · Delivery</option>
                  </select>
                </div>
                <div className="field">
                  <label>Type</label>
                  <select className="select" value={orderType} onChange={(event) => setOrderType(event.target.value as "MARKET" | "LIMIT")}>
                    <option value="MARKET">Market</option>
                    <option value="LIMIT">Limit</option>
                  </select>
                </div>
              </div>

              <div className="field">
                <label>Quantity</label>
                <div className="qty-stepper">
                  <button onClick={() => setQty((v) => Math.max(1, v - 1))} aria-label="Decrease">−</button>
                  <input value={qty} onChange={(event) => setQty(Math.max(1, Number(event.target.value) || 1))} inputMode="numeric" aria-label="Quantity" />
                  <button onClick={() => setQty((v) => v + 1)} aria-label="Increase">+</button>
                </div>
              </div>

              {orderType === "LIMIT" && (
                <div className="field">
                  <label>Limit price</label>
                  <input className="input" value={limit} onChange={(event) => setLimit(event.target.value)} placeholder={quote ? inr(quote.last_price) : "0.00"} inputMode="decimal" />
                </div>
              )}

              <div className="field-row">
                <div className="field">
                  <label>Bid</label>
                  <div className="input num" style={{ display: "flex", alignItems: "center", color: "var(--pos)" }}>{bid ? inr(bid) : "—"}</div>
                </div>
                <div className="field">
                  <label>Ask</label>
                  <div className="input num" style={{ display: "flex", alignItems: "center", color: "var(--neg)" }}>{ask ? inr(ask) : "—"}</div>
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-2)" }}>
                <span>Spread {spread ? inr(spread) : "—"}</span>
                <span>Margin {inr(margin)}</span>
              </div>

              <button
                className={cx("btn btn-lg", side === "BUY" ? "btn-buy" : "btn-sell")}
                disabled={!price}
                onClick={() => {
                  openOrder({
                    instrument_key: key,
                    symbol: quote?.symbol || key.split("|")[1] || key,
                    name: quote?.name,
                    segment: quote?.segment,
                    side,
                    price: price,
                  });
                  notify({ tone: "info", title: `${side} ticket opened`, message: `${qty} × ${quote?.symbol || key}` });
                }}
              >
                {side} {quote?.symbol || "—"} @ {price ? inr(price) : "—"}
              </button>
              <div style={{ fontSize: 10, color: "var(--text-3)", lineHeight: "15px" }}>
                Fills route through the paper ledger with 5 bps adverse slippage and full Indian charges.
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head" style={{ padding: "10px 14px" }}>
              <span className="panel-title" style={{ fontSize: 12 }}>Depth</span>
              <span className="spacer" />
              <span className="tag outline">L5</span>
            </div>
            <div style={{ padding: 12 }}>
              {(["sell", "buy"] as const).map((bookSide) => {
                const levels = (bookSide === "sell" ? quote?.depth?.sell || quote?.depth?.ask : quote?.depth?.buy || quote?.depth?.bid) || [];
                return (
                  <div key={bookSide} style={{ marginBottom: bookSide === "sell" ? 10 : 0 }}>
                    <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-3)", marginBottom: 4 }}>
                      {bookSide === "sell" ? "Ask" : "Bid"}
                    </div>
                    {(levels.length ? levels.slice(0, 5) : []).map((level: any, index: number) => (
                      <div key={index} style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, padding: "3px 0" }}>
                        <span className={bookSide === "sell" ? "neg" : "pos"}>{inr(Number(level.price || 0))}</span>
                        <span className="num muted">{Number(level.quantity || 0).toLocaleString("en-IN")}</span>
                      </div>
                    ))}
                    {!levels.length && <div style={{ fontSize: 10, color: "var(--text-3)" }}>No depth available</div>}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="panel">
            <div className="panel-head" style={{ padding: "10px 14px" }}>
              <span className="panel-title" style={{ fontSize: 12 }}>Statistics</span>
            </div>
            <div style={{ padding: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 10 }}>
              {[
                ["Open", quote ? inr(quote.open) : "—"],
                ["High", quote ? inr(quote.high) : "—"],
                ["Low", quote ? inr(quote.low) : "—"],
                ["Prev close", quote ? inr(quote.previous_close) : "—"],
                ["Volume", quote ? compactInr(quote.volume) : "—"],
                ["OI", quote?.oi ? compactInr(quote.oi) : "—"],
                ["Day range", quote ? `${pct(quote.high && quote.low ? ((quote.high - quote.low) / quote.low) * 100 : 0)}` : "—"],
                ["Chg", quote ? pct(quote.change_percent) : "—"],
              ].map(([label, value]) => (
                <div key={label as string} style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="muted">{label}</span>
                  <span className="num">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ChartPicker({ initialKey }: { initialKey: string }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Array<{ instrument_key: string; symbol: string; name?: string; segment?: string }>>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setHits([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}&limit=10`, { signal: controller.signal });
        const data = (await res.json()) as { results?: typeof hits };
        setHits(data.results || []);
      } catch {
        // aborted
      }
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  return (
    <div style={{ position: "relative", width: 240 }}>
      <input
        className="input"
        placeholder="Switch symbol…"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      <span style={{ position: "absolute", right: 8, top: 8, color: "var(--text-2)", pointerEvents: "none" }}>
        <ChevronDown size={14} />
      </span>
      {open && hits.length > 0 && (
        <div className="menu" style={{ top: 36, left: 0, width: 240, maxHeight: 300, overflowY: "auto" }}>
          {hits.map((hit) => (
            <button
              key={hit.instrument_key}
              className="menu-item"
              onClick={() => {
                router.push(`/trading-charts?symbol=${encodeURIComponent(hit.instrument_key)}`);
                setQuery("");
                setOpen(false);
              }}
            >
              <span className="grow">{hit.symbol}</span>
              <span className="faint" style={{ fontSize: 9 }}>{(hit.segment || "").replace("_", " ")}</span>
            </button>
          ))}
        </div>
      )}
      <span style={{ display: "none" }}>{initialKey}</span>
    </div>
  );
}
