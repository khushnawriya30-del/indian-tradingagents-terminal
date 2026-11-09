"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { useApp, useQuotes } from "../AppProvider";
import {
  ChevronLeft,
  ChevronRight,
  FilterIcon,
  KebabIcon,
  PlusIcon,
  SearchIcon,
} from "../icons";
import { changeText, cx, inr, pct } from "@/lib/client/format";

type ListMap = Record<string, string[]>;

const LS_KEY = "upstox.paper.lists";

function readLists(): ListMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as ListMap) : {};
  } catch {
    return {};
  }
}

export function Sidebar() {
  const router = useRouter();
  const { watchlist, quoteFor, requestQuotes, removeWatch, addWatch, setSearchOpen } = useApp();
  const [tab, setTab] = useState("1");
  const [lists, setLists] = useState<ListMap>({});
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLists(readLists());
  }, []);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function persist(next: ListMap) {
    setLists(next);
    try {
      window.localStorage.setItem(LS_KEY, JSON.stringify(next));
    } catch {
      // storage can be unavailable in private mode
    }
  }

  const localKeys = lists[tab] || [];
  const keys = tab === "1" ? watchlist.map((w) => w.instrument_key) : localKeys;
  const quotes = useQuotes(keys);
  useEffect(() => {
    requestQuotes(keys);
  }, [keys.join(","), requestQuotes]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(
    () =>
      keys.map((key) => {
        const server = watchlist.find((w) => w.instrument_key === key);
        return {
          key,
          symbol: server?.symbol || quotes[key]?.symbol || key.split("|")[1] || key,
          segment: server?.segment || quotes[key]?.segment || (key.includes("INDEX") ? "NSE_INDEX" : "NSE_EQ"),
          exchange: server?.exchange || (key.startsWith("BSE") ? "BSE" : "NSE"),
        };
      }),
    [keys.join(","), watchlist, quotes] // eslint-disable-line react-hooks/exhaustive-deps
  );

  function addKey(key: string) {
    if (tab === "1") {
      addWatch(key);
      return;
    }
    if (localKeys.includes(key)) return;
    persist({ ...lists, [tab]: [...localKeys, key] });
  }

  function removeKey(key: string) {
    if (tab === "1") {
      removeWatch(key);
      return;
    }
    persist({ ...lists, [tab]: localKeys.filter((k) => k !== key) });
  }

  return (
    <aside className="sidebar" aria-label="Watchlist">
      <div className="wl-tabs">
        <button className="icon-btn" style={{ width: 22, height: 26 }} aria-label="Previous list">
          <ChevronLeft size={13} />
        </button>
        {["1", "2", "3"].map((id) => (
          <button
            key={id}
            className={cx("wl-tab", tab === id && "active")}
            onClick={() => setTab(id)}
          >
            {id}
          </button>
        ))}
        <button className="wl-tab wl-tab-add" onClick={() => setSearchOpen(true)} aria-label="Add list">
          <PlusIcon size={12} />
        </button>
        <div className="spacer" />
        <div ref={menuRef} style={{ position: "relative" }}>
          <button className="icon-btn" style={{ width: 26, height: 26 }} onClick={() => setMenuOpen((v) => !v)} aria-label="Watchlist options">
            <KebabIcon size={14} />
          </button>
          {menuOpen && (
            <div className="menu" style={{ top: 32, right: 0, width: 200 }}>
              <button className="menu-item" onClick={() => { setMenuOpen(false); setSearchOpen(true); }}>Add scrip</button>
              <button className="menu-item" onClick={() => setMenuOpen(false)}>Sort by name</button>
              <button className="menu-item" onClick={() => setMenuOpen(false)}>Sort by change</button>
              <div className="menu-sep" />
              <button className="menu-item" onClick={() => { setMenuOpen(false); persist({ ...lists, [tab]: [] }); }}>Clear list</button>
            </div>
          )}
        </div>
      </div>

      <div className="wl-head">
        <span className="wl-head-title ellipsis">{tab === "1" ? "My watchlist · top 20 by market cap" : `List ${tab}`}</span>
        <span className="wl-count">1 / {Math.max(rows.length, 1)}</span>
        <div className="wl-head-actions">
          <button className="icon-btn" onClick={() => setSearchOpen(true)} aria-label="Search and add">
            <SearchIcon size={14} />
          </button>
          <button className="icon-btn" aria-label="Sort">
            <FilterIcon size={14} />
          </button>
          <button className="wl-add" onClick={() => setSearchOpen(true)} aria-label="Add instrument">
            <PlusIcon size={14} />
          </button>
        </div>
      </div>

      <div className="wl-scroll scroll-thin">
        <div className="wl-sublabel">by You</div>
        {rows.map((row) => {
          const q = quotes[row.key] || quoteFor(row.key);
          const up = (q?.change ?? 0) >= 0;
          return (
            <div
              key={row.key}
              className="wl-row"
              role="button"
              tabIndex={0}
              onClick={() => router.push(`/trading-charts?symbol=${encodeURIComponent(row.key)}`)}
              onKeyDown={(event) => {
                if (event.key === "Enter") router.push(`/trading-charts?symbol=${encodeURIComponent(row.key)}`);
              }}
            >
              <div className="wl-row-main">
                <div className="wl-sym">
                  <span className="ellipsis">{row.symbol}</span>
                </div>
                <div className="wl-exch">
                  {row.segment.includes("INDEX") ? `${row.exchange} INDEX` : `${row.exchange} ${row.segment.endsWith("EQ") ? "EQ" : row.segment.split("_")[1] || "EQ"}`}
                </div>
              </div>
              <div className="wl-right">
                <div className="wl-ltp">{q ? inr(q.last_price) : "-"}</div>
                <div className={cx("wl-chg", q ? (up ? "pos" : "neg") : "faint")}>{q ? changeText(q) : "—"}</div>
              </div>
              <div className="wl-quickbuy">
                <button
                  className="b"
                  aria-label={`Buy ${row.symbol}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    router.push(`/trading-charts?symbol=${encodeURIComponent(row.key)}&side=BUY`);
                  }}
                >
                  B
                </button>
                <button
                  className="s"
                  aria-label={`Sell ${row.symbol}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    router.push(`/trading-charts?symbol=${encodeURIComponent(row.key)}&side=SELL`);
                  }}
                >
                  S
                </button>
              </div>
            </div>
          );
        })}
        {!rows.length && (
          <div className="wl-empty">
            Your list is empty. Press <b>A</b> to add a scrip to your watchlist.
          </div>
        )}
      </div>

      <div style={{ borderTop: "1px solid var(--stroke-2)", padding: "8px 12px", display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 10, color: "var(--text-3)" }}>Paper book</span>
        <span className="spacer" />
        <Link href="/my-list" style={{ fontSize: 10, color: "var(--brand)", fontWeight: 600 }}>
          Manage lists
        </Link>
      </div>
    </aside>
  );
}

export function useWatchlistRows() {
  const { watchlist } = useApp();
  return watchlist;
}
