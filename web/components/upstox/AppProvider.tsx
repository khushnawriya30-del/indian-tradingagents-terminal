"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { PortfolioSnapshot, Quote, SessionState } from "@/lib/types";

export interface WatchItem {
  instrument_key: string;
  symbol: string;
  display: string;
  name: string;
  segment: string;
  exchange: string;
}

export interface OrderTarget {
  instrument_key: string;
  symbol: string;
  name?: string;
  segment?: string;
  side?: "BUY" | "SELL";
  price?: number;
}

export interface AiTarget {
  instrument_key: string;
  symbol: string;
  name?: string;
  segment?: string;
}

export interface ToastMessage {
  id: number;
  tone: "info" | "success" | "warn" | "error";
  title: string;
  message?: string;
}

interface AppContextValue {
  session: SessionState | null;
  portfolio: PortfolioSnapshot | null;
  watchlist: WatchItem[];
  quotes: Record<string, Quote>;
  quoteFor: (key: string | null | undefined) => Quote | null;
  requestQuotes: (keys: string[]) => void;
  refreshPortfolio: () => Promise<void>;
  placeOrder: (payload: {
    instrument_key: string;
    side: "BUY" | "SELL";
    quantity: number;
    order_type: "MARKET" | "LIMIT" | "SL" | "SL-M";
    product: "CNC" | "MIS";
    limit_price?: number | null;
    trigger_price?: number | null;
  }) => Promise<{ ok: boolean; error?: string }>;
  cancelOrder: (id: string) => Promise<void>;
  addWatch: (key: string) => Promise<void>;
  removeWatch: (key: string) => Promise<void>;
  toasts: ToastMessage[];
  notify: (toast: Omit<ToastMessage, "id">) => void;
  dismissToast: (id: number) => void;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  orderTarget: OrderTarget | null;
  openOrder: (target: OrderTarget) => void;
  closeOrder: () => void;
  aiTarget: AiTarget | null;
  openAi: (target: AiTarget) => void;
  closeAi: () => void;
  hidePnl: boolean;
  togglePnl: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<SessionState | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioSnapshot | null>(null);
  const [watchlist, setWatchlist] = useState<WatchItem[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [orderTarget, setOrderTarget] = useState<OrderTarget | null>(null);
  const [aiTarget, setAiTarget] = useState<AiTarget | null>(null);
  const [hidePnl, setHidePnl] = useState(false);

  const wanted = useRef<Set<string>>(new Set());
  const toastId = useRef(0);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const notify = useCallback(
    (toast: Omit<ToastMessage, "id">) => {
      toastId.current += 1;
      const id = toastId.current;
      setToasts((current) => [...current.slice(-3), { ...toast, id }]);
      const timer = setTimeout(() => {
        setToasts((current) => current.filter((t) => t.id !== id));
        timers.current.delete(id);
      }, toast.tone === "error" ? 6500 : 3800);
      timers.current.set(id, timer);
    },
    []
  );

  const refreshPortfolio = useCallback(async () => {
    try {
      const res = await fetch("/api/portfolio", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as PortfolioSnapshot & {
        watchlist?: WatchItem[];
        quotes?: Record<string, Quote>;
        session?: SessionState;
      };
      setPortfolio(data);
      if (data.watchlist) setWatchlist(data.watchlist);
      if (data.session) setSession(data.session);
      if (data.quotes) {
        setQuotes((current) => ({ ...current, ...data.quotes }));
      }
    } catch {
      // keep previous snapshot
    }
  }, []);

  const requestQuotes = useCallback((keys: string[]) => {
    for (const key of keys) if (key) wanted.current.add(key);
  }, []);

  useEffect(() => {
    refreshPortfolio();
    const interval = setInterval(refreshPortfolio, 15000);
    return () => clearInterval(interval);
  }, [refreshPortfolio]);

  useEffect(() => {
    const tick = async () => {
      const keys = Array.from(wanted.current);
      if (!keys.length) return;
      for (let i = 0; i < keys.length; i += 80) {
        const chunk = keys.slice(i, i + 80);
        try {
          const res = await fetch(`/api/quotes?keys=${encodeURIComponent(chunk.join(","))}`, {
            cache: "no-store",
          });
          if (!res.ok) continue;
          const data = (await res.json()) as { quotes?: Quote[]; session?: SessionState };
          if (data.session) setSession(data.session);
          if (data.quotes?.length) {
            setQuotes((current) => {
              const next = { ...current };
              for (const quote of data.quotes || []) next[quote.instrument_key] = quote;
              return next;
            });
          }
        } catch {
          // ignore transient quote failures
        }
      }
    };
    tick();
    const interval = setInterval(tick, 6000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (!typing && event.key === "/") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const quoteFor = useCallback(
    (key: string | null | undefined) => (key ? quotes[key] || null : null),
    [quotes]
  );

  const placeOrder = useCallback<AppContextValue["placeOrder"]>(
    async (payload) => {
      try {
        const res = await fetch("/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          order?: { status?: string };
        };
        if (!res.ok || !data.ok) {
          return { ok: false, error: data.error || `Order rejected (${res.status})` };
        }
        await refreshPortfolio();
        const status = data.order?.status;
        if (status === "COMPLETE") {
          notify({
            tone: "success",
            title: `${payload.side} ${payload.quantity} filled`,
            message: "Paper ledger updated.",
          });
        } else if (status === "OPEN") {
          notify({
            tone: "info",
            title: "Order accepted",
            message: "Resting order — fills when the trigger is met.",
          });
        } else if (status === "PENDING") {
          notify({
            tone: "info",
            title: "Queued for next open",
            message: "Market is closed. The order will fill at the next session open.",
          });
        } else {
          notify({ tone: "info", title: "Order accepted" });
        }
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "Order failed" };
      }
    },
    [notify, refreshPortfolio]
  );

  const cancelOrder = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/orders/${id}`, { method: "DELETE" });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          notify({ tone: "error", title: "Cancel failed", message: data.error });
          return;
        }
        await refreshPortfolio();
        notify({ tone: "success", title: "Order cancelled" });
      } catch (error) {
        notify({
          tone: "error",
          title: "Cancel failed",
          message: error instanceof Error ? error.message : undefined,
        });
      }
    },
    [notify, refreshPortfolio]
  );

  const addWatch = useCallback(
    async (key: string) => {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instrument_key: key }),
      });
      if (res.ok) {
        await refreshPortfolio();
        notify({ tone: "success", title: "Added to watchlist" });
      } else {
        const data = await res.json().catch(() => ({}));
        notify({ tone: "error", title: "Could not add", message: data.error });
      }
    },
    [notify, refreshPortfolio]
  );

  const removeWatch = useCallback(
    async (key: string) => {
      const res = await fetch(`/api/watchlist?key=${encodeURIComponent(key)}`, {
        method: "DELETE",
      });
      if (res.ok) await refreshPortfolio();
    },
    [refreshPortfolio]
  );

  const value = useMemo<AppContextValue>(
    () => ({
      session,
      portfolio,
      watchlist,
      quotes,
      quoteFor,
      requestQuotes,
      refreshPortfolio,
      placeOrder,
      cancelOrder,
      addWatch,
      removeWatch,
      toasts,
      notify,
      dismissToast,
      searchOpen,
      setSearchOpen,
      orderTarget,
      openOrder: (target) => setOrderTarget(target),
      closeOrder: () => setOrderTarget(null),
      aiTarget,
      openAi: (target) => setAiTarget(target),
      closeAi: () => setAiTarget(null),
      hidePnl,
      togglePnl: () => setHidePnl((v) => !v),
    }),
    [
      session,
      portfolio,
      watchlist,
      quotes,
      quoteFor,
      requestQuotes,
      refreshPortfolio,
      placeOrder,
      cancelOrder,
      addWatch,
      removeWatch,
      toasts,
      notify,
      dismissToast,
      searchOpen,
      orderTarget,
      aiTarget,
      hidePnl,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}

/** Register keys for batch polling and return their live quotes. */
export function useQuotes(keys: string[]): Record<string, Quote> {
  const { requestQuotes, quotes } = useApp();
  const signature = keys.filter(Boolean).join(",");
  useEffect(() => {
    if (signature) requestQuotes(signature.split(","));
  }, [signature, requestQuotes]);
  return useMemo(() => {
    const out: Record<string, Quote> = {};
    for (const key of keys) if (quotes[key]) out[key] = quotes[key];
    return out;
  }, [quotes, signature]); // eslint-disable-line react-hooks/exhaustive-deps
}
