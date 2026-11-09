"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useApp } from "../AppProvider";
import {
  BellIcon,
  ChevronDown,
  GridIcon,
  SearchIcon,
  WalletIcon,
} from "../icons";
import { inr } from "@/lib/client/format";

const TABS = [
  { label: "Home", href: "/home" },
  { label: "My List", href: "/my-list" },
  { label: "Orders", href: "/orders" },
  { label: "Positions", href: "/positions" },
  { label: "Holdings", href: "/holdings" },
];

const MORE = [
  { label: "Reports", href: "/reports" },
  { label: "Ledger", href: "/ledger" },
  { label: "My Alerts", href: "/my-alerts" },
  { label: "Funds", href: "/funds" },
  { label: "IPO", href: "/home/ipo" },
  { label: "Screeners", href: "/screeners" },
  { label: "Trading charts", href: "/trading-charts" },
  { label: "Option chain", href: "/option-chain" },
  { label: "Strategy builder", href: "/strategy-builder" },
  { label: "F&O tools", href: "/fno-tools/oi-analysis" },
  { label: "Profile", href: "/profile" },
  { label: "Settings", href: "/settings" },
];

export function TopNav() {
  const pathname = usePathname() || "/home";
  const router = useRouter();
  const { portfolio, setSearchOpen, hidePnl, togglePnl } = useApp();
  const [moreOpen, setMoreOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [platformOpen, setPlatformOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);
  const platformRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      const node = event.target as Node;
      if (moreRef.current && !moreRef.current.contains(node)) setMoreOpen(false);
      if (accountRef.current && !accountRef.current.contains(node)) setAccountOpen(false);
      if (platformRef.current && !platformRef.current.contains(node)) setPlatformOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const pnl = portfolio?.funds.total_pnl ?? 0;
  const active = (href: string) =>
    pathname === href || (href === "/home" && (pathname.startsWith("/home") || pathname === "/"));

  return (
    <div className="topbar">
      <Link className="brand" href="/home" aria-label="Upstox home">
        <span className="brand-mark">up</span>
        <span className="brand-chevron">
          <ChevronDown size={12} />
        </span>
      </Link>

      <div className="divider-v" style={{ marginLeft: 4 }} />

      <div className="pnl-cluster">
        <span>
          Hol. Total P&amp;L <b className={hidePnl ? "" : pnl >= 0 ? "pos" : "neg"}>{hidePnl ? "••••" : inr(pnl)}</b>
        </span>
        <span>
          Pos. Total P&amp;L: <b className={hidePnl ? "" : pnl >= 0 ? "pos" : "neg"}>{hidePnl ? "••••" : inr(pnl)}</b>
        </span>
        <button className="icon-btn" style={{ width: 24, height: 24 }} onClick={togglePnl} aria-label="Toggle P&L visibility">
          {hidePnl ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M3 3l18 18" />
              <path d="M10.6 6.1A9.7 9.7 0 0 1 12 6c6 0 9.5 6 9.5 6a16 16 0 0 1-3.4 4M6.3 7.9A16 16 0 0 0 2.5 12S6 18 12 18c1.2 0 2.3-.2 3.3-.6" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>

      <nav className="nav-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.href}
            className={`nav-tab ${active(tab.href) ? "active" : ""}`}
            onClick={() => router.push(tab.href)}
          >
            {tab.label}
          </button>
        ))}
        <div ref={moreRef} style={{ position: "relative", display: "flex" }}>
          <button
            className={`nav-tab ${moreOpen ? "active" : ""}`}
            onClick={() => setMoreOpen((v) => !v)}
          >
            More
            <span className="caret">
              <ChevronDown size={12} />
            </span>
          </button>
          {moreOpen && (
            <div className="menu" style={{ top: 48, left: 0, width: 230, maxHeight: 420, overflowY: "auto" }}>
              {MORE.map((item) => (
                <button
                  key={item.href}
                  className="menu-item"
                  onClick={() => {
                    setMoreOpen(false);
                    router.push(item.href);
                  }}
                >
                  <span className="grow">{item.label}</span>
                  <span className="faint">›</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </nav>

      <div className="top-actions">
        <button className="search-trigger" onClick={() => setSearchOpen(true)}>
          <SearchIcon size={14} />
          <span>Search</span>
          <kbd>⌘K</kbd>
        </button>

        <Link className="btn btn-sm" href="/funds" style={{ gap: 4 }}>
          <WalletIcon size={14} />
          Funds
        </Link>

        <div ref={accountRef} style={{ position: "relative" }}>
          <button className="account-pill" onClick={() => setAccountOpen((v) => !v)} aria-label="Account menu">
            <span className="avatar">VN</span>
            <span className="brand-chevron">
              <ChevronDown size={12} />
            </span>
          </button>
          {accountOpen && (
            <div className="menu" style={{ top: 40, right: 0, width: 220 }}>
              <div className="menu-label">Vishal Nair · Paper</div>
              <button className="menu-item" onClick={() => { setAccountOpen(false); router.push("/profile"); }}>My profile</button>
              <button className="menu-item" onClick={() => { setAccountOpen(false); router.push("/reports"); }}>AI reports</button>
              <button className="menu-item" onClick={() => { setAccountOpen(false); router.push("/ledger"); }}>Ledger</button>
              <button className="menu-item" onClick={() => { setAccountOpen(false); router.push("/settings"); }}>Settings</button>
              <div className="menu-sep" />
              <button className="menu-item" disabled style={{ opacity: 0.5 }}>
                Sign out
              </button>
            </div>
          )}
        </div>

        <div ref={platformRef} style={{ position: "relative" }}>
          <button className="account-pill" onClick={() => setPlatformOpen((v) => !v)} aria-label="Platforms">
            <GridIcon size={16} />
          </button>
          {platformOpen && (
            <div className="menu" style={{ top: 40, right: 0, width: 210 }}>
              <div className="menu-label">Upstox platforms</div>
              <button className="menu-item" onClick={() => setPlatformOpen(false)}>Pro terminal · active</button>
              <button className="menu-item" onClick={() => setPlatformOpen(false)}>Mobile app</button>
              <button className="menu-item" onClick={() => setPlatformOpen(false)}>Developer API</button>
            </div>
          )}
        </div>

        <button className="icon-btn" aria-label="Alerts" onClick={() => router.push("/my-alerts")}>
          <BellIcon size={16} />
        </button>
      </div>
    </div>
  );
}
