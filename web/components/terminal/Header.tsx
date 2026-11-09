"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { countdown, moneyCompact, percent, price, signed, toneClass } from "@/lib/format";
import type { InstrumentHit, PortfolioSnapshot, Quote, SessionState } from "@/lib/types";
import { PHASE_LABEL, PHASE_TONE } from "./constants";

interface HeaderProps {
  session: SessionState | null;
  portfolio: PortfolioSnapshot | null;
  indices: Quote[];
  connection: "connecting" | "live" | "down";
  onOpenAI: () => void;
  onPick: (hit: InstrumentHit) => void;
}

function istClock(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function istDate(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(date);
}

function nextOpenLabel(iso: string | undefined): string {
  if (!iso) return "—";
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return iso;
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
  const label = new Intl.DateTimeFormat("en-IN", {
    timeZone: "UTC",
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(date);
  return `${label} · ${match[4]}:${match[5]} IST`;
}

function useIstNow(): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function useCountdown(session: SessionState | null): number {
  const base = useRef({ seconds: 0, stamp: Date.now() });
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    base.current = { seconds: session?.seconds_to_open || 0, stamp: Date.now() };
  }, [session?.next_open_ist, session?.phase, session?.seconds_to_open]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const elapsed = (now - base.current.stamp) / 1000;
  return Math.max(0, Math.floor(base.current.seconds - elapsed));
}

function SearchBox({ onPick }: { onPick: (hit: InstrumentHit) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<InstrumentHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (query.trim().length < 1) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `/api/search?q=${encodeURIComponent(query.trim())}&limit=12&segments=NSE_EQ,BSE_EQ,NSE_INDEX,BSE_INDEX`,
          { signal: controller.signal }
        );
        const payload = (await response.json()) as { results: InstrumentHit[] };
        setResults(payload.results || []);
        setCursor(0);
        setOpen(true);
      } catch {
        // aborted
      } finally {
        setLoading(false);
      }
    }, 160);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const choose = (hit: InstrumentHit) => {
    onPick(hit);
    setQuery("");
    setResults([]);
    setOpen(false);
  };

  return (
    <div className="relative w-full max-w-xl">
      <div className="flex h-9 items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--panel)] px-3 focus-within:border-sky-500/40">
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-zinc-500" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.2-3.2" />
        </svg>
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => query && setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setCursor((value) => Math.min(value + 1, results.length - 1));
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setCursor((value) => Math.max(value - 1, 0));
            }
            if (event.key === "Enter" && results[cursor]) {
              choose(results[cursor]);
            }
          }}
          placeholder="Search NSE / BSE — RELIANCE, HDFCBANK, NIFTY…"
          className="w-full bg-transparent text-[12px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
          spellCheck={false}
        />
        {loading ? (
          <span className="h-3 w-3 animate-spin rounded-full border border-zinc-600 border-t-zinc-300" />
        ) : (
          <kbd className="hidden rounded border border-zinc-700 px-1.5 py-0.5 text-[9px] text-zinc-500 sm:block">
            Ctrl K
          </kbd>
        )}
      </div>

      {open && results.length > 0 && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 top-11 z-50 overflow-hidden rounded-md border border-[var(--line)] bg-[#0c1219] shadow-2xl shadow-black/60">
            {results.map((hit, index) => (
              <button
                key={hit.instrument_key}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(hit)}
                onMouseEnter={() => setCursor(index)}
                className={`flex w-full items-center gap-3 px-3 py-2 text-left transition ${
                  index === cursor ? "bg-sky-500/10" : "hover:bg-white/[0.03]"
                }`}
              >
                <span
                  className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${
                    hit.is_index
                      ? "bg-amber-500/10 text-amber-300"
                      : hit.segment === "BSE_EQ"
                        ? "bg-fuchsia-500/10 text-fuchsia-300"
                        : "bg-sky-500/10 text-sky-300"
                  }`}
                >
                  {hit.is_index ? "IDX" : hit.exchange}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-semibold text-zinc-100">
                    {hit.display}
                  </span>
                  <span className="block truncate text-[10px] text-zinc-500">{hit.name}</span>
                </span>
                <span className="text-[10px] text-zinc-600">{hit.segment}</span>
              </button>
            ))}
            <div className="border-t border-[var(--line)] px-3 py-1.5 text-[9px] uppercase tracking-[0.16em] text-zinc-600">
              ↑↓ navigate · Enter to open
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function Header({ session, portfolio, indices, connection, onOpenAI, onPick }: HeaderProps) {
  const now = useIstNow();
  const remaining = useCountdown(session);
  const funds = portfolio?.funds;
  const phase = session?.phase || "closed";

  const tape = useMemo(() => indices, [indices]);

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-[#070b10]/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1800px] items-center gap-4 px-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md border border-sky-500/30 bg-sky-500/10">
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-sky-400" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 17 9 8l4 6 3-9 4 12" />
            </svg>
          </div>
          <div className="leading-none">
            <div className="text-[11px] font-bold tracking-[0.22em] text-zinc-100">TRADINGAGENTS</div>
            <div className="mt-1 text-[9px] tracking-[0.28em] text-sky-500/80">INDIA TERMINAL</div>
          </div>
        </div>

        <SearchBox onPick={onPick} />

        <div className="ml-auto flex items-center gap-2">
          <span
            className={`hidden items-center gap-1.5 rounded border px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] md:flex ${PHASE_TONE[phase]}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${phase === "open" ? "animate-pulse bg-emerald-400" : "bg-current"}`} />
            {PHASE_LABEL[phase]}
          </span>
          <div className="hidden text-right leading-tight lg:block">
            <div className="font-mono text-[13px] tabular-nums text-zinc-200">
              {now ? istClock(now) : "--:--:--"}
            </div>
            <div className="text-[9px] uppercase tracking-[0.14em] text-zinc-500">
              {now ? `${istDate(now)} IST` : "IST"}
            </div>
          </div>
          {funds && (
            <div className="hidden rounded-md border border-[var(--line)] bg-[var(--panel)] px-3 py-1.5 text-right leading-tight md:block">
              <div className="font-mono text-[12px] tabular-nums text-zinc-100">
                {moneyCompact(funds.total_value)}
              </div>
              <div className={`font-mono text-[9px] tabular-nums ${toneClass(funds.day_pnl)}`}>
                {signed(funds.day_pnl)} today · {percent(funds.total_pnl_percent)}
              </div>
            </div>
          )}
          <button
            onClick={onOpenAI}
            className="flex items-center gap-1.5 rounded-md border border-sky-500/30 bg-sky-500/10 px-2.5 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-sky-300 transition hover:bg-sky-500/20"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1M7.7 16.3l-2.1 2.1" />
              <circle cx="12" cy="12" r="3.5" />
            </svg>
            AI Desk
          </button>
        </div>
      </div>

      <div className="border-t border-[var(--line)]/70">
        <div className="mx-auto flex h-8 max-w-[1800px] items-center gap-5 overflow-x-auto px-3 text-[11px]">
          {tape.map((quote) => (
            <div key={quote.key} className="flex shrink-0 items-baseline gap-2">
              <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                {quote.symbol}
              </span>
              <span className="font-mono tabular-nums text-zinc-200">{price(quote.last_price)}</span>
              <span className={`font-mono text-[10px] tabular-nums ${toneClass(quote.change_percent)}`}>
                {percent(quote.change_percent)}
              </span>
            </div>
          ))}
          <div className="ml-auto flex shrink-0 items-center gap-4 text-[9px] uppercase tracking-[0.14em] text-zinc-600">
            <span className="flex items-center gap-1.5">
              <span
                className={`h-1 w-1 rounded-full ${
                  connection === "live" ? "bg-emerald-400" : connection === "down" ? "bg-rose-400" : "bg-amber-400"
                }`}
              />
              {connection === "live" ? "Live feed" : connection === "down" ? "Feed retrying" : "Connecting"}
            </span>
            <span>
              {phase === "open"
                ? `Closes in ${countdown(remaining)}`
                : `Next open ${nextOpenLabel(session?.next_open_ist)}`}
            </span>
            <span className="hidden sm:inline">Last close {session?.last_close_date || "—"}</span>
          </div>
        </div>
      </div>
    </header>
  );
}
