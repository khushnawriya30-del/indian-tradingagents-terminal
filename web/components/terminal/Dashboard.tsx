"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AIDrawer } from "./AIDrawer";
import { BookPanel } from "./BookPanel";
import { ChartPanel } from "./ChartPanel";
import { Header } from "./Header";
import { OptionChainPanel } from "./OptionChainPanel";
import { OrderPad } from "./OrderPad";
import { PortfolioCard } from "./PortfolioCard";
import { Toast, type ToastMessage } from "./Toast";
import { Watchlist } from "./Watchlist";
import { INDEX_KEYS } from "./constants";
import type {
  AuditLinks,
  InstrumentHit,
  PortfolioSnapshot,
  Quote,
  SessionState,
  WatchlistItem,
} from "@/lib/types";

export interface TerminalContext {
  session: SessionState | null;
  portfolio: PortfolioSnapshot | null;
  quotes: Record<string, Quote>;
  refreshPortfolio: () => Promise<void>;
  notify: (message: Omit<ToastMessage, "id">) => void;
  select: (item: WatchlistItem) => void;
  selected: WatchlistItem | null;
}

export function Dashboard() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioSnapshot | null>(null);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [selected, setSelected] = useState<WatchlistItem | null>(null);
  const [panel, setPanel] = useState<"chart" | "chain">("chart");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [connection, setConnection] = useState<"connecting" | "live" | "down">("connecting");
  const toastCounter = useRef(0);

  const notify = useCallback((message: Omit<ToastMessage, "id">) => {
    toastCounter.current += 1;
    setToast({ ...message, id: toastCounter.current });
  }, []);

  const refreshPortfolio = useCallback(async () => {
    try {
      const response = await fetch("/api/portfolio", { cache: "no-store" });
      if (!response.ok) throw new Error(`portfolio ${response.status}`);
      const payload = (await response.json()) as PortfolioSnapshot & {
        watchlist: WatchlistItem[];
        quotes: Record<string, Quote>;
      };
      setPortfolio(payload);
      if (payload.session) setSession(payload.session);
      if (payload.watchlist?.length) setWatchlist(payload.watchlist);
      if (payload.quotes) setQuotes((current) => ({ ...current, ...payload.quotes }));
      setSelected((current) => {
        if (current) return current;
        const items = payload.watchlist || [];
        const equity = items.find((item) => item.segment === "NSE_EQ");
        return equity || items[0] || null;
      });
    } catch (error) {
      notify({
        tone: "error",
        title: "Portfolio sync failed",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }, [notify]);

  useEffect(() => {
    void refreshPortfolio();
    const timer = setInterval(() => {
      if (!document.hidden) void refreshPortfolio();
    }, 6000);
    return () => clearInterval(timer);
  }, [refreshPortfolio]);

  const selectedKey = selected?.instrument_key || "";
  const watchlistSignature = useMemo(
    () => watchlist.map((item) => item.instrument_key).join(","),
    [watchlist]
  );

  useEffect(() => {
    if (!watchlistSignature && !selectedKey) return;
    const keys = [
      ...watchlist.map((item) => item.instrument_key),
      ...(selectedKey ? [selectedKey] : []),
    ];
    const source = new EventSource(`/api/stream?keys=${encodeURIComponent(keys.join(","))}`);

    source.onopen = () => setConnection("live");
    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as {
          type: string;
          session?: SessionState;
          quotes?: Record<string, Quote>;
        };
        if (payload.type === "hello") return;
        if (payload.session) setSession(payload.session);
        if (payload.quotes) {
          setQuotes((current) => ({ ...current, ...payload.quotes }));
        }
        setConnection("live");
      } catch {
        // ignore malformed ticks
      }
    };
    source.onerror = () => setConnection("down");

    return () => source.close();
  }, [watchlistSignature, selectedKey]);

  const sessionFallback = useCallback(async () => {
    try {
      const response = await fetch("/api/session", { cache: "no-store" });
      const payload = (await response.json()) as {
        session: SessionState;
        indices: Quote[];
        warning?: string;
      };
      setSession(payload.session);
      if (payload.indices?.length) {
        setQuotes((current) => {
          const next = { ...current };
          for (const quote of payload.indices) next[quote.key] = quote;
          return next;
        });
      }
    } catch {
      // stream will retry
    }
  }, []);

  useEffect(() => {
    void sessionFallback();
  }, [sessionFallback]);

  const indices = useMemo(
    () => INDEX_KEYS.map((key) => quotes[key]).filter(Boolean) as Quote[],
    [quotes]
  );

  const select = useCallback((item: WatchlistItem) => {
    setSelected(item);
  }, []);

  const addSymbol = useCallback(
    async (hit: InstrumentHit) => {
      try {
        const response = await fetch("/api/watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instrument_key: hit.instrument_key }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Could not add symbol");
        setWatchlist(payload.watchlist);
        setSelected({
          instrument_key: hit.instrument_key,
          symbol: hit.trading_symbol,
          display: hit.display || hit.trading_symbol,
          name: hit.name,
          segment: hit.segment,
          exchange: hit.exchange || "NSE",
        });
        notify({
          tone: "success",
          title: "Added to watchlist",
          message: `${hit.trading_symbol} is now streaming on the desk.`,
        });
        void refreshPortfolio();
      } catch (error) {
        notify({
          tone: "error",
          title: "Watchlist unchanged",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
    [notify, refreshPortfolio]
  );

  const removeSymbol = useCallback(
    async (item: WatchlistItem) => {
      try {
        const response = await fetch(`/api/watchlist?key=${encodeURIComponent(item.instrument_key)}`, {
          method: "DELETE",
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Could not remove symbol");
        setWatchlist(payload.watchlist);
        if (selected?.instrument_key === item.instrument_key) {
          const next = (payload.watchlist as WatchlistItem[]).find((row) => row.segment === "NSE_EQ");
          setSelected(next || payload.watchlist[0] || null);
        }
      } catch (error) {
        notify({
          tone: "error",
          title: "Watchlist unchanged",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
    [notify, selected?.instrument_key]
  );

  const context: TerminalContext = {
    session,
    portfolio,
    quotes,
    refreshPortfolio,
    notify,
    select,
    selected,
  };

  return (
    <div className="min-h-screen bg-[var(--ink-950)] text-zinc-200">
      <Header
        session={session}
        portfolio={portfolio}
        indices={indices}
        connection={connection}
        onOpenAI={() => setDrawerOpen(true)}
        onPick={addSymbol}
      />
      <main className="mx-auto grid max-w-[1800px] grid-cols-12 gap-3 px-3 pb-6 pt-3">
        <aside className="col-span-12 flex flex-col gap-3 xl:col-span-2">
          <Watchlist
            items={watchlist}
            quotes={quotes}
            selectedKey={selectedKey}
            onSelect={select}
            onRemove={removeSymbol}
          />
          <PortfolioCard portfolio={portfolio} onOpenAI={() => setDrawerOpen(true)} />
        </aside>

        <section className="col-span-12 flex min-w-0 flex-col gap-3 xl:col-span-7">
          <div className="flex items-center gap-1 rounded-lg border border-[var(--line)] bg-[var(--panel)] p-1">
            {(
              [
                ["chart", "Price & Volume"],
                ["chain", "Option Chain"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setPanel(value)}
                className={`rounded-md px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] transition ${
                  panel === value
                    ? "bg-[var(--panel-hi)] text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {label}
              </button>
            ))}
            <span className="ml-auto pr-2 text-[10px] uppercase tracking-[0.16em] text-zinc-600">
              NSE · BSE · NFO
            </span>
          </div>

          {panel === "chart" ? (
            <ChartPanel selected={selected} quote={quotes[selectedKey]} context={context} />
          ) : (
            <OptionChainPanel selected={selected} session={session} />
          )}

          <BookPanel context={context} />
        </section>

        <aside className="col-span-12 flex flex-col gap-3 xl:col-span-3">
          <OrderPad context={context} />
        </aside>
      </main>

      <footer className="mx-auto flex max-w-[1800px] flex-wrap items-center gap-x-6 gap-y-1 px-4 pb-4 text-[10px] uppercase tracking-[0.16em] text-zinc-600">
        <span>TradingAgents India · paper desk</span>
        <span>Data: Upstox v2/v3 · News: ET / Moneycontrol / Mint / CNBC-TV18 / Zee</span>
        <span>Fundamentals: Screener.in</span>
        <span>AI: 12-agent research pipeline</span>
        <a className="ml-auto text-sky-500 hover:text-sky-300" href="/api/upstox/login">
          Reconnect Upstox
        </a>
      </footer>

      <AIDrawer
        open={drawerOpen}
        selected={selected}
        portfolio={portfolio}
        onClose={() => setDrawerOpen(false)}
        notify={notify}
      />
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}

export type { AuditLinks };
