"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    TradingView?: {
      widget: new (options: Record<string, unknown>) => unknown;
    };
  }
}

let loader: Promise<void> | null = null;

function loadTv(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.TradingView?.widget) return Promise.resolve();
  if (loader) return loader;
  loader = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-tv-widget="1"]');
    if (existing) {
      if (window.TradingView?.widget) return resolve();
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("TradingView widget failed to load")));
      return;
    }
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/tv.js";
    script.async = true;
    script.dataset.tvWidget = "1";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("TradingView widget failed to load"));
    document.head.appendChild(script);
  });
  return loader;
}

const INTERVAL_MAP: Record<string, string> = {
  "1m": "1",
  "5m": "5",
  "15m": "15",
  "30m": "30",
  "1h": "60",
  "1D": "D",
};

const SYMBOL_MAP: Record<string, string> = {
  NIFTY: "NSE:NIFTY",
  "NIFTY 50": "NSE:NIFTY",
  BANKNIFTY: "NSE:BANKNIFTY",
  "NIFTY BANK": "NSE:BANKNIFTY",
  FINNIFTY: "NSE:CNXFINANCE",
  "NIFTY FIN SERVICE": "NSE:CNXFINANCE",
  MIDCPNIFTY: "NSE:NIFTYMIDCAP150",
  "NIFTY MID SELECT": "NSE:NIFTYMIDCAP150",
  INDIAVIX: "NSE:INDIAVIX",
  "INDIA VIX": "NSE:INDIAVIX",
  SENSEX: "BSE:SENSEX",
  BANKEX: "BSE:BANKEX",
};

export function toTradingViewSymbol(symbol: string, segment: string, exchange?: string): string {
  const upper = (symbol || "").trim().toUpperCase();
  const mapped = SYMBOL_MAP[upper];
  if (mapped) return mapped;
  if (segment.startsWith("BSE") || exchange === "BSE") return `BSE:${upper}`;
  if (segment === "MCX_FO") return `MCX:${upper}`;
  return `NSE:${upper}`;
}

export function TradingViewWidget({
  symbol,
  interval = "15m",
  studies,
  height = 520,
}: {
  symbol: string;
  interval?: string;
  studies?: string[];
  height?: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const studiesKey = (studies || []).join(",");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;

    // tv.js owns everything inside this node; React never reconciles it.
    const mount = document.createElement("div");
    mount.style.width = "100%";
    mount.style.height = "100%";
    mount.id = `tv_mount_${Math.random().toString(36).slice(2, 10)}`;
    host.appendChild(mount);

    (async () => {
      try {
        await loadTv();
      } catch {
        return;
      }
      if (disposed || !window.TradingView?.widget) return;
      try {
        new window.TradingView.widget({
          container_id: mount.id,
          autosize: true,
          symbol,
          // tv.js otherwise prefers the host page's ?symbol= query, which is our instrument key.
          tvwidgetsymbol: symbol,
          interval: INTERVAL_MAP[interval] || "15",
          timezone: "Asia/Kolkata",
          theme: "light",
          style: "1",
          locale: "en",
          toolbar_bg: "#ffffff",
          enable_publishing: false,
          allow_symbol_change: true,
          withdateranges: true,
          hide_side_toolbar: false,
          hide_top_toolbar: false,
          details: false,
          save_image: true,
          doNotStoreSettings: true,
          disabled_features: ["use_localstorage_for_settings"],
          studies: studiesKey ? studiesKey.split(",") : ["Volume@tv-basicstudies"],
        });
      } catch {
        // widget errors are non-fatal; the Upstox candle panel remains available
      }
    })();

    return () => {
      disposed = true;
      mount.remove();
    };
  }, [symbol, interval, studiesKey]);

  return <div ref={hostRef} style={{ height, width: "100%", position: "relative" }} />;
}
