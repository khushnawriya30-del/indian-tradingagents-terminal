"use client";

import { useEffect, useRef, useState } from "react";

import { compactNumber, percent, price, signed, toneClass } from "@/lib/format";
import type { Candle, Quote, WatchlistItem } from "@/lib/types";
import { CHART_INTERVALS, type ChartInterval } from "./constants";
import type { TerminalContext } from "./Dashboard";

interface ChartPanelProps {
  selected: WatchlistItem | null;
  quote: Quote | undefined;
  context: TerminalContext;
}

function timeLabel(seconds: number, daily: boolean): string {
  const date = new Date(seconds * 1000);
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    ...(daily
      ? { day: "2-digit", month: "short", year: "2-digit" }
      : { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }),
  }).format(date);
}

export function ChartPanel({ selected, quote, context }: ChartPanelProps) {
  const [interval, setInterval] = useState<ChartInterval>("15m");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const holder = useRef<HTMLDivElement>(null);
  const seriesRef = useRef<any>(null);
  const priceLineRef = useRef<any>(null);

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setWarning(null);
    fetch(
      `/api/candles?key=${encodeURIComponent(selected.instrument_key)}&interval=${interval}`,
      { signal: controller.signal, cache: "no-store" }
    )
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Chart failed");
        setCandles(payload.candles || []);
        if (payload.warning) setWarning(payload.warning);
      })
      .catch((reason) => {
        if (reason?.name !== "AbortError") setError(reason instanceof Error ? reason.message : "Chart failed");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [selected?.instrument_key, interval]);

  useEffect(() => {
    if (!holder.current || candles.length === 0) return;
    let disposed = false;
    let chart: import("lightweight-charts").IChartApi | null = null;
    let resize: ResizeObserver | null = null;

    void (async () => {
      const {
        createChart,
        CandlestickSeries,
        HistogramSeries,
        ColorType,
        CrosshairMode,
        LineStyle,
      } = await import("lightweight-charts");
      if (disposed || !holder.current) return;

      chart = createChart(holder.current, {
        autoSize: true,
        layout: {
          background: { type: ColorType.Solid, color: "transparent" },
          textColor: "#64748b",
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
          fontSize: 10,
        },
        grid: {
          vertLines: { color: "rgba(148,163,184,0.05)" },
          horzLines: { color: "rgba(148,163,184,0.05)" },
        },
        rightPriceScale: {
          borderColor: "rgba(148,163,184,0.12)",
          scaleMargins: { top: 0.08, bottom: 0.24 },
        },
        timeScale: {
          borderColor: "rgba(148,163,184,0.12)",
          rightOffset: 4,
          barSpacing: 6,
          timeVisible: interval !== "1D",
          secondsVisible: false,
        },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: { color: "rgba(56,189,248,0.35)", labelBackgroundColor: "#0c4a6e" },
          horzLine: { color: "rgba(56,189,248,0.35)", labelBackgroundColor: "#0c4a6e" },
        },
        localization: {
          timeFormatter: (time: unknown) =>
            typeof time === "number" ? timeLabel(time, interval === "1D") : String(time),
        },
      });

      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: "#22c55e",
        downColor: "#f43f5e",
        wickUpColor: "#22c55e",
        wickDownColor: "#f43f5e",
        borderVisible: false,
        priceFormat: { type: "price", precision: 2, minMove: 0.05 },
      });
      candleSeries.setData(
        candles.map((candle) => ({
          time: candle.time as import("lightweight-charts").UTCTimestamp,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
        }))
      );

      const volumeSeries = chart.addSeries(HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "",
      });
      chart.priceScale("").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      volumeSeries.setData(
        candles.map((candle) => ({
          time: candle.time as import("lightweight-charts").UTCTimestamp,
          value: candle.volume,
          color: candle.close >= candle.open ? "rgba(34,197,94,0.28)" : "rgba(244,63,94,0.28)",
        }))
      );

      if (quote?.last_price) {
        priceLineRef.current = candleSeries.createPriceLine({
          price: quote.last_price,
          color: "rgba(56,189,248,0.65)",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: "LTP",
        });
      }
      seriesRef.current = candleSeries;

      chart.timeScale().fitContent();
      resize = new ResizeObserver(() => chart?.applyOptions({ width: holder.current?.clientWidth }));
      if (holder.current) resize.observe(holder.current);
    })();

    return () => {
      disposed = true;
      resize?.disconnect();
      chart?.remove();
      seriesRef.current = null;
      priceLineRef.current = null;
    };
  }, [candles, interval]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !quote?.last_price) return;
    if (priceLineRef.current) {
      try {
        series.removePriceLine(priceLineRef.current);
      } catch {
        // series was replaced
      }
    }
    priceLineRef.current = series.createPriceLine({
      price: quote.last_price,
      color: "rgba(56,189,248,0.65)",
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: true,
      title: "LTP",
    });
  }, [quote?.last_price]);

  if (!selected) {
    return (
      <div className="flex h-[520px] items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--panel)] text-[12px] text-zinc-500">
        Select a symbol from the watchlist to load the tape.
      </div>
    );
  }

  const range =
    quote?.high && quote?.low && quote.last_price
      ? Math.min(100, Math.max(0, ((quote.last_price - quote.low) / (quote.high - quote.low)) * 100))
      : 50;

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--panel)]">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--line)] px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-[17px] font-semibold tracking-wide text-zinc-100">
              {quote?.symbol || selected.symbol}
            </h1>
            <span className="rounded bg-white/[0.04] px-1.5 py-0.5 text-[8.5px] uppercase tracking-[0.14em] text-zinc-500">
              {quote?.segment?.replace("_", " ") || selected.segment.replace("_", " ")}
            </span>
            {quote?.frozen && (
              <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-[0.14em] text-amber-300">
                Frozen at last close
              </span>
            )}
          </div>
          <div className="mt-0.5 truncate text-[10px] text-zinc-500">{quote?.name || selected.name}</div>
          <div className="mt-2 flex items-baseline gap-3">
            <span className="font-mono text-[28px] leading-none tabular-nums text-zinc-50">
              {price(quote?.last_price)}
            </span>
            <span className={`font-mono text-[12px] tabular-nums ${toneClass(quote?.change)}`}>
              {signed(quote?.change)} ({percent(quote?.change_percent)})
            </span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[9px] tabular-nums text-zinc-500">{price(quote?.low)}</span>
            <div className="relative h-1 w-40 overflow-hidden rounded-full bg-white/[0.06]">
              <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-rose-500/70 via-amber-400/60 to-emerald-400/80" style={{ width: "100%" }} />
              <div
                className="absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full border border-[#05080c] bg-zinc-100"
                style={{ left: `calc(${range}% - 4px)` }}
              />
            </div>
            <span className="text-[9px] tabular-nums text-zinc-500">{price(quote?.high)}</span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-x-5 gap-y-1.5 text-[10px] sm:grid-cols-3">
          <Stat label="Open" value={price(quote?.open)} />
          <Stat label="High" value={price(quote?.high)} tone="text-emerald-400/90" />
          <Stat label="Low" value={price(quote?.low)} tone="text-rose-400/90" />
          <Stat label="Prev close" value={price(quote?.previous_close)} />
          <Stat label="Volume" value={compactNumber(quote?.volume)} />
          <Stat label="Avg price" value={price(quote?.average_price)} />
        </div>
      </div>

      <div className="flex items-center gap-1 border-b border-[var(--line)] px-3 py-1.5">
        {CHART_INTERVALS.map((value) => (
          <button
            key={value}
            onClick={() => setInterval(value)}
            className={`rounded px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] transition ${
              interval === value
                ? "bg-white/[0.07] text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {value}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-2 text-[9px] uppercase tracking-[0.14em] text-zinc-600">
          {warning && <span className="text-amber-400/80">{warning}</span>}
          <span>Upstox · exchange prints</span>
        </span>
      </div>

      <div className="relative">
        <div ref={holder} className="h-[430px] w-full" />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--panel)]/60 text-[10px] uppercase tracking-[0.2em] text-zinc-500">
            Loading candles…
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-[11px] text-rose-300">
            {error}
          </div>
        )}
        {!loading && !error && candles.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-[11px] text-zinc-500">
            No prints for this window.
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-[74px]">
      <div className="text-[8.5px] uppercase tracking-[0.12em] text-zinc-600">{label}</div>
      <div className={`font-mono text-[11px] tabular-nums ${tone || "text-zinc-300"}`}>{value}</div>
    </div>
  );
}
