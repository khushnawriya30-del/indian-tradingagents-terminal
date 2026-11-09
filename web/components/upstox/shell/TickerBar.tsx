"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useQuotes } from "../AppProvider";
import { useApp } from "../AppProvider";
import { pct } from "@/lib/client/format";
import { KebabIcon, LockIcon, SearchIcon } from "../icons";

const TICKER_KEYS = ["NSE_INDEX|Nifty 50", "NSE_INDEX|Nifty Bank", "BSE_INDEX|SENSEX"];

function labelExpiry(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00+05:30`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" });
}

export function TickerBar() {
  const quotes = useQuotes(TICKER_KEYS);
  const { openAi, setSearchOpen } = useApp();
  const [expiry, setExpiry] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/expiry?symbol=NIFTY", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => {
        if (active && payload?.expiry) setExpiry(labelExpiry(payload.expiry));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="ticker">
      {TICKER_KEYS.map((key) => {
        const q = quotes[key];
        const up = (q?.change ?? 0) >= 0;
        return (
          <div key={key} className="ticker-item">
            <span className="ticker-sym">{q?.symbol || key.split("|")[1]}</span>
            <span className="ticker-ltp">{q ? q.last_price.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}</span>
            <span className={`ticker-chg ${up ? "pos" : "neg"}`}>
              {q ? `${up ? "+" : ""}${q.change.toFixed(2)} (${pct(q.change_percent)})` : "—"}
            </span>
            <span className="ticker-exp">Exp. {expiry || "—"}</span>
          </div>
        );
      })}
      <div className="ticker-actions">
        <button className="icon-btn" aria-label="Search instruments" onClick={() => setSearchOpen(true)}>
          <SearchIcon size={14} />
        </button>
        <button className="icon-btn" aria-label="Ticker settings" onClick={() => openAi({ instrument_key: "NSE_INDEX|Nifty 50", symbol: "NIFTY 50", name: "NIFTY 50", segment: "NSE_INDEX" })}>
          <KebabIcon size={14} />
        </button>
      </div>
    </div>
  );
}

export function FloatingRail() {
  const { openOrder, setSearchOpen } = useApp();
  return (
    <div className="float-rail">
      <button
        className="icon-btn"
        aria-label="Place order"
        onClick={() => openOrder({ instrument_key: "NSE_INDEX|Nifty 50", symbol: "NIFTY" })}
      >
        <span style={{ position: "relative", display: "flex" }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
            <path d="M4 7h16l-1.4 12H5.4L4 7Z" />
            <path d="M9 7V5.5a3 3 0 0 1 6 0V7" />
          </svg>
          <span style={{ position: "absolute", right: -4, top: -4, width: 6, height: 6, borderRadius: 999, background: "var(--brand-bright)" }} />
        </span>
      </button>
      <Link href="/settings" className="icon-btn" aria-label="Preferences">
        <LockIcon size={14} />
      </Link>
      <button className="icon-btn" aria-label="Search" onClick={() => setSearchOpen(true)}>
        <SearchIcon size={14} />
      </button>
    </div>
  );
}
