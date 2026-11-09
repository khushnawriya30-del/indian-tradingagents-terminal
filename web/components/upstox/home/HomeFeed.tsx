"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { HomeData } from "@/lib/client/home-types";
import { cx, pct } from "@/lib/client/format";
import { useApp } from "../AppProvider";
import { RefreshIcon } from "../icons";
import { Skeleton } from "../ui";
import {
  Advisory,
  BuzzingStocks,
  CommoditiesSection,
  CommodityHome,
  ETFs,
  FuturesHeatmap,
  FuturesHome,
  FuturesSmartlist,
  IntradayScreeners,
  IPOSection,
  MomentumGainers,
  MostBoughtTable,
  MoversTable,
  OIAnalysis,
  OIScanners,
  OptionChainCards,
  OptionsHome,
  Sectors,
  SimpleInvesting,
  StocksHome,
  TrendingOptions,
  TrendingStocks,
  Under500,
} from "./sections";

const TABS = [
  { id: "ideas", label: "Ideas" },
  { id: "stocks", label: "Stocks" },
  { id: "options", label: "Options" },
  { id: "futures", label: "Futures" },
  { id: "commodity", label: "Commodities" },
];

export function HomeFeed({ tab = "ideas" }: { tab?: string }) {
  const { session, notify } = useApp();
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setRefreshing(true);
      try {
        const res = await fetch(`/api/market?tab=${encodeURIComponent(tab)}`, { cache: "no-store" });
        const payload = (await res.json()) as HomeData & { error?: string };
        if (!res.ok) throw new Error(payload.error || `Feed failed (${res.status})`);
        setData(payload);
        setError(null);
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : "Feed unavailable";
        setError(message);
      } finally {
        setRefreshing(false);
        setLoading(false);
      }
    },
    [tab]
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const interval = setInterval(() => load(true), session?.is_open ? 10_000 : 90_000);
    return () => clearInterval(interval);
  }, [load, session?.is_open]);

  return (
    <div className="content">
      <div className="home-tabs">
        {TABS.map((item) => (
          <Link key={item.id} href={item.id === "ideas" ? "/home" : `/home/${item.id}`} className={cx("home-tab", tab === item.id && "active")}>
            {item.label}
          </Link>
        ))}
        <div className="spacer" />
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10, color: "var(--text-3)" }}>
            {session ? `${session.phase.replace("_", " ")} · ${session.session_date}` : "Connecting"}
          </span>
          <button
            className="icon-btn"
            style={{ width: 26, height: 26 }}
            aria-label="Refresh feed"
            onClick={() => {
              load(true);
              notify({ tone: "info", title: "Refreshing market feed" });
            }}
          >
            <RefreshIcon size={14} />
          </button>
        </div>
      </div>

      {error && (
        <div
          style={{
            marginTop: 16,
            border: "1px solid var(--neg)",
            background: "var(--neg-subtle)",
            borderRadius: 8,
            padding: "10px 12px",
            fontSize: 12,
            color: "var(--neg)",
          }}
        >
          <b>Market feed unavailable.</b> {error}
        </div>
      )}

      {loading && !data && (
        <div style={{ display: "flex", flexDirection: "column", gap: 18, marginTop: 24 }}>
          <Skeleton height={30} />
          <Skeleton height={138} />
          <Skeleton height={200} />
          <Skeleton height={200} />
        </div>
      )}

      {data && (
        <div style={{ opacity: refreshing && !loading ? 0.75 : 1, transition: "opacity .2s var(--ease)" }}>
          {tab === "ideas" && (
            <>
              <BreadthStrip data={data} />
              <TrendingStocks data={data} />
              <TrendingOptions data={data} />
              <OIAnalysis data={data} />
              <OptionChainCards data={data} />
              <CommoditiesSection data={data} />
              <IPOSection data={data} />
              <Advisory data={data} />
            </>
          )}
          {tab === "stocks" && <StocksHome data={data} />}
          {tab === "options" && <OptionsHome data={data} />}
          {tab === "futures" && <FuturesHome data={data} />}
          {tab === "commodity" && <CommodityHome data={data} />}
        </div>
      )}
    </div>
  );
}

function BreadthStrip({ data }: { data: HomeData }) {
  const { advancing, declining, unchanged, total } = data.breadth;
  const advPct = total ? (advancing / total) * 100 : 0;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 20,
        padding: "10px 14px",
        border: "1px solid var(--stroke)",
        borderRadius: 10,
        marginBottom: 26,
        background: "var(--bg-subtle)",
        flexWrap: "wrap",
      }}
    >
      <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-2)" }}>Market breadth</span>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
        <span className="pos num">{advancing} advancing</span>
        <span className="faint">·</span>
        <span className="neg num">{declining} declining</span>
        {unchanged > 0 && (
          <>
            <span className="faint">·</span>
            <span className="muted num">{unchanged} unchanged</span>
          </>
        )}
      </div>
      <div style={{ width: 160, height: 4, borderRadius: 4, background: "var(--neg)", overflow: "hidden" }}>
        <i style={{ display: "block", height: "100%", width: `${advPct}%`, background: "var(--pos)" }} />
      </div>
      <div style={{ display: "flex", gap: 16, marginLeft: "auto", flexWrap: "wrap" }}>
        {data.indices.slice(0, 3).map((index) => (
          <span key={index.key} style={{ display: "inline-flex", alignItems: "baseline", gap: 6, fontSize: 11 }}>
            <b style={{ fontWeight: 600 }}>{index.label}</b>
            <span className="num">{index.ltp.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            <span className={cx("num", index.change_percent >= 0 ? "pos" : "neg")}>{pct(index.change_percent)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
