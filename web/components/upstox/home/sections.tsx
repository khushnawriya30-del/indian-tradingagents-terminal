"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { useApp } from "../AppProvider";
import { BoltIcon, CalendarIcon, ChevronRight, FireIcon, IdeasIcon, OptionsIcon, SparkleIcon, StarIcon, TrendIcon } from "../icons";
import { Change, Chip, Section, Sparkline, StockCard, SymbolCell, Tag } from "../ui";
import { compactInr, cx, expiryLabel, inr, logoColor, monogram, pct } from "@/lib/client/format";
import type { ChainSummary, HomeCommodity, HomeData, HomeFuture, HomeOption, HomeStock, LadderRow } from "@/lib/client/home-types";

const OI_LAKH = 100_000;

function useNav() {
  const router = useRouter();
  const { openOrder } = useApp();
  return {
    chart: (key: string, side?: "BUY" | "SELL") =>
      router.push(`/trading-charts?symbol=${encodeURIComponent(key)}${side ? `&side=${side}` : ""}`),
    chain: (symbol: string) => router.push(`/option-chain?symbol=${encodeURIComponent(symbol)}`),
    order: openOrder,
    router,
  };
}

function stockRowsTable(
  rows: HomeStock[],
  nav: ReturnType<typeof useNav>,
  options?: { sparkline?: boolean; actions?: boolean; volume?: boolean }
) {
  return (
    <div className="table-wrap">
      <table className="ux">
        <thead>
          <tr>
            <th style={{ width: "38%" }}>Symbol</th>
            {options?.sparkline && <th style={{ width: 100 }}>1D Sparkline</th>}
            {options?.volume && <th className="r">Volume</th>}
            <th className="r">LTP</th>
            <th className="r">Change</th>
            {options?.actions && <th className="r" style={{ width: 110 }}>Action</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} onClick={() => nav.chart(row.key)} style={{ cursor: "pointer" }}>
              <td>
                <SymbolCell symbol={row.symbol} name={row.name} segment={row.segment} />
              </td>
              {options?.sparkline && (
                <td>
                  <Sparkline open={row.open} high={row.high} low={row.low} close={row.ltp} up={row.change >= 0} />
                </td>
              )}
              {options?.volume && <td className="r num muted">{compactInr(row.volume)}</td>}
              <td className="r num">{inr(row.ltp)}</td>
              <td className="r">
                <Change value={row.change} percent={row.change_percent} />
              </td>
              {options?.actions && (
                <td className="r">
                  <span className="table-actions">
                    <button
                      className="btn btn-buy"
                      onClick={(event) => {
                        event.stopPropagation();
                        nav.order({ instrument_key: row.key, symbol: row.symbol, name: row.name, segment: row.segment, side: "BUY" });
                      }}
                    >
                      Buy
                    </button>
                    <button
                      className="btn btn-sell"
                      onClick={(event) => {
                        event.stopPropagation();
                        nav.order({ instrument_key: row.key, symbol: row.symbol, name: row.name, segment: row.segment, side: "SELL" });
                      }}
                    >
                      Sell
                    </button>
                  </span>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Ideas                                                              */
/* ------------------------------------------------------------------ */

export function TrendingStocks({ data }: { data: HomeData }) {
  const nav = useNav();
  const chips = data.sections.trendingStocks.chips;
  const [chip, setChip] = useState(chips[0]?.id || "most-bought");
  const active = chips.find((item) => item.id === chip) || chips[0];

  return (
    <Section
      title="Trending stocks"
      icon={<IdeasIcon size={16} />}
      href="/home/stocks"
      actions={
        <span style={{ fontSize: 11, color: "var(--text-2)" }}>
          {data.breadth.advancing} advancing · {data.breadth.declining} declining
        </span>
      }
    >
      <div className="chips">
        {chips.map((item) => (
          <Chip key={item.id} active={item.id === chip} onClick={() => setChip(item.id)}>
            {item.label}
          </Chip>
        ))}
      </div>
      <div className="card-grid">
        {(active?.rows || []).slice(0, 3).map((row) => (
          <StockCard
            key={row.key}
            symbol={row.symbol}
            price={row.ltp}
            change={row.change}
            changePercent={row.change_percent}
            onClick={() => nav.chart(row.key)}
          />
        ))}
        <div className="seemore" onClick={() => nav.router.push("/home/stocks")} role="button" tabIndex={0}>
          <div className="seemore-grid">
            {["#f2b21b", "#1a1a1a", "#1a73e8", "#e94b35"].map((color, index) => (
              <span className="seemore-tile" key={color} style={{ background: `${color}14`, color }}>
                {index % 2 === 0 ? <TrendIcon size={15} /> : <OptionsIcon size={15} />}
              </span>
            ))}
          </div>
          <span className="seemore-label">
            See more <ChevronRight size={12} />
          </span>
        </div>
      </div>
    </Section>
  );
}

export function TrendingOptions({ data }: { data: HomeData }) {
  const nav = useNav();
  const [side, setSide] = useState<"CE" | "PE">("CE");
  const rows = data.sections.options.trending.filter((row) => row.side === side).slice(0, 5);
  const summary = data.sections.options.summaries[0];

  return (
    <Section
      title="Trending options"
      icon={<OptionsIcon size={16} />}
      href={`/option-chain?symbol=${summary?.symbol || "NIFTY"}`}
    >
      <div className="chips">
        <Link className="chip" href={`/option-chain?symbol=${summary?.symbol || "NIFTY"}`}>
          {summary?.label || "NIFTY 50"}
          <span className="caret"><ChevronRight size={12} style={{ transform: "rotate(90deg)" }} /></span>
        </Link>
        <Chip caret>{summary?.expiry ? expiryLabel(summary.expiry) : "Expiry"}</Chip>
        <Chip active={side === "CE"} onClick={() => setSide("CE")}>Call</Chip>
        <Chip active={side === "PE"} onClick={() => setSide("PE")}>Put</Chip>
      </div>
      <div className="table-wrap">
        <table className="ux">
          <thead>
            <tr>
              <th style={{ width: "42%" }}>Symbol</th>
              <th className="r">LTP</th>
              <th className="r">Change</th>
              <th className="r">OI (Lakhs)</th>
              <th className="r" style={{ width: 110 }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} onClick={() => nav.chart(row.key)} style={{ cursor: "pointer" }}>
                <td>
                  <OptionSymbol row={row} />
                </td>
                <td className="r num">{inr(row.ltp)}</td>
                <td className="r">
                  <Change value={row.change} percent={row.change_percent} />
                </td>
                <td className="r">
                  <div className="num" style={{ color: row.oi_change >= 0 ? "var(--pos)" : "var(--neg)" }}>
                    {row.oi_change >= 0 ? "+" : ""}
                    {(row.oi_change / OI_LAKH).toFixed(2)} ({row.oi ? pct((row.oi_change / row.oi) * 100) : "—"})
                  </div>
                  <div className="num muted" style={{ fontSize: 10 }}>{(row.oi / OI_LAKH).toFixed(2)}L</div>
                </td>
                <td className="r">
                  <span className="table-actions">
                    <button
                      className="btn btn-buy"
                      onClick={(event) => {
                        event.stopPropagation();
                        nav.order({ instrument_key: row.key, symbol: row.symbol, segment: "NSE_FO", side: "BUY", price: row.ltp });
                      }}
                    >
                      Buy
                    </button>
                    <button
                      className="btn btn-sell"
                      onClick={(event) => {
                        event.stopPropagation();
                        nav.order({ instrument_key: row.key, symbol: row.symbol, segment: "NSE_FO", side: "SELL", price: row.ltp });
                      }}
                    >
                      Sell
                    </button>
                  </span>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={5} style={{ textAlign: "center", color: "var(--text-2)" }}>
                  Option feed is warming up — the chain refreshes every 15 seconds.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function OptionSymbol({ row }: { row: HomeOption }) {
  let distance = 0;
  if (row.strike && row.underlying) {
    // OTM/ITM tag is derived from the parent summary when available; the row
    // itself only carries the strike, so show the strike and the series.
    distance = 0;
  }
  return (
    <div className="symcell">
      <div className="symcell-stack">
        <span className="name">
          {row.underlying} {row.expiry ? expiryLabel(row.expiry) : ""} {row.strike} {row.side}
        </span>
        <span className="meta">
          <Tag tone="outline">NFO</Tag>
          {distance !== 0 && <Tag>{distance > 0 ? `OTM +${distance}` : `ITM ${distance}`}</Tag>}
          <span>{row.volume ? `${compactInr(row.volume)} vol` : ""}</span>
        </span>
      </div>
    </div>
  );
}

export function OIAnalysis({ data }: { data: HomeData }) {
  const nav = useNav();
  const summary = data.sections.options.summaries[0];
  const ladder = data.sections.options.ladder;
  const [metric, setMetric] = useState<"oi" | "change" | "pcr">("oi");
  if (!summary) return null;
  const maxOi = Math.max(...ladder.map((row) => Math.max(row.call_oi, row.put_oi)), 1);
  const maxChange = Math.max(...ladder.map((row) => Math.max(Math.abs(row.call_oi_change), Math.abs(row.put_oi_change))), 1);

  return (
    <Section
      title="OI analysis"
      icon={<TrendIcon size={16} />}
      href={`/fno-tools/oi-analysis?symbol=${summary.symbol}`}
      actions={<span className="tag brand">{summary.symbol}</span>}
    >
      <div className="chips">
        <Chip active={metric === "change"} onClick={() => setMetric("change")}>Chg. OI</Chip>
        <Chip active={metric === "pcr"} onClick={() => setMetric("pcr")}>PCR</Chip>
        <Chip active={metric === "oi"} onClick={() => setMetric("oi")}>OI</Chip>
        <span className="spacer" />
        <span style={{ fontSize: 11, color: "var(--text-2)" }}>
          Spot {inr(summary.spot)} · {pct(summary.change_percent)}
        </span>
      </div>

      {metric === "pcr" ? (
        <div className="tile-grid c4">
          <div className="tile">
            <div className="stat-label">Put-call ratio</div>
            <div className="stat-value" style={{ color: summary.pcr >= 1 ? "var(--pos)" : "var(--neg)" }}>{summary.pcr.toFixed(2)}</div>
            <div className="stat-label">{summary.pcr >= 1 ? "Put writers active" : "Call writers active"}</div>
          </div>
          <div className="tile">
            <div className="stat-label">Max pain</div>
            <div className="stat-value">{inr(summary.max_pain, 0)}</div>
            <div className="stat-label">Expiry pin</div>
          </div>
          <div className="tile">
            <div className="stat-label">Support (put OI)</div>
            <div className="stat-value">{inr(summary.support, 0)}</div>
            <div className="stat-label">{(summary.put_oi / OI_LAKH).toFixed(2)}L puts</div>
          </div>
          <div className="tile">
            <div className="stat-label">Resistance (call OI)</div>
            <div className="stat-value">{inr(summary.resistance, 0)}</div>
            <div className="stat-label">{(summary.call_oi / OI_LAKH).toFixed(2)}L calls</div>
          </div>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="ux">
            <thead>
              <tr>
                <th className="r" style={{ width: "32%" }}>Put OI</th>
                <th className="c" style={{ width: "18%" }}>Strike</th>
                <th style={{ width: "32%" }}>Call OI</th>
                <th className="r">ATM</th>
              </tr>
            </thead>
            <tbody>
              {ladder.map((row: LadderRow) => {
                const call = metric === "change" ? row.call_oi_change : row.call_oi;
                const put = metric === "change" ? row.put_oi_change : row.put_oi;
                const base = metric === "change" ? maxChange : maxOi;
                return (
                  <tr key={row.strike} className={row.strike === summary.atm ? "atm-row" : undefined}>
                    <td className="r">
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
                        <span className="num" style={{ color: put >= 0 ? "var(--pos)" : "var(--neg)" }}>
                          {put >= 0 ? "+" : ""}
                          {(put / OI_LAKH).toFixed(2)}
                        </span>
                        <span style={{ width: 90, height: 6, background: "var(--bg-alt)", borderRadius: 3, overflow: "hidden", display: "inline-block" }}>
                          <i style={{ display: "block", height: "100%", width: `${Math.min(100, (Math.abs(put) / base) * 100)}%`, marginLeft: "auto", background: put >= 0 ? "var(--pos)" : "var(--neg)", opacity: 0.55 }} />
                        </span>
                      </div>
                    </td>
                    <td className="c">
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <b className="num">{inr(row.strike, 0)}</b>
                        {row.strike === summary.atm && <Tag tone="brand">ATM</Tag>}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ width: 90, height: 6, background: "var(--bg-alt)", borderRadius: 3, overflow: "hidden", display: "inline-block" }}>
                          <i style={{ display: "block", height: "100%", width: `${Math.min(100, (Math.abs(call) / base) * 100)}%`, background: call >= 0 ? "var(--pos)" : "var(--neg)", opacity: 0.55 }} />
                        </span>
                        <span className="num" style={{ color: call >= 0 ? "var(--pos)" : "var(--neg)" }}>
                          {call >= 0 ? "+" : ""}
                          {(call / OI_LAKH).toFixed(2)}
                        </span>
                      </div>
                    </td>
                    <td className="r">
                      <span className="tag outline">IV {row.strike === summary.atm ? summary.atm_iv.toFixed(1) : (row.call_iv || row.put_iv || 0).toFixed(1)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
        <button className="btn btn-sm" onClick={() => nav.router.push(`/fno-tools/oi-analysis?symbol=${summary.symbol}`)}>
          View OI analysis
        </button>
      </div>
    </Section>
  );
}

export function OptionChainCards({ data }: { data: HomeData }) {
  const nav = useNav();
  const cards = data.sections.options.summaries;
  if (!cards.length) return null;
  return (
    <Section title="Option chain" icon={<OptionsIcon size={16} />} href="/option-chain">
      <div className="tile-grid c4">
        {cards.map((card: ChainSummary) => (
          <div key={card.key} className="index-card" onClick={() => nav.chain(card.symbol)} role="button" tabIndex={0}>
            <div className="index-card-top">
              <span className="index-card-name">{card.label}</span>
              <ChevronRight size={13} />
            </div>
            <div className="index-card-price">{inr(card.spot)}</div>
            <div style={{ fontSize: 11 }} className={card.change_percent >= 0 ? "pos" : "neg"}>{pct(card.change_percent)}</div>
            <div className="index-card-meta" style={{ marginTop: 6 }}>
              <span>PCR <b className="num">{card.pcr ? card.pcr.toFixed(2) : "—"}</b></span>
              <span>Max pain <b className="num">{card.max_pain ? inr(card.max_pain, 0) : "—"}</b></span>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Futures / commodities                                              */
/* ------------------------------------------------------------------ */

export function FuturesSmartlist({ data }: { data: HomeData }) {
  const nav = useNav();
  const rows = data.sections.futures.rows;
  const [tab, setTab] = useState<"spot" | "premium" | "ltp" | "change">("spot");
  const sorted = useMemo(() => {
    const copy = [...rows];
    if (tab === "premium") return copy.sort((a, b) => b.premium - a.premium);
    if (tab === "ltp") return copy.sort((a, b) => b.ltp - a.ltp);
    if (tab === "change") return copy.sort((a, b) => b.change_percent - a.change_percent);
    return copy;
  }, [rows, tab]);

  return (
    <Section title="Futures smartlist" icon={<TrendIcon size={16} />} href="/fno-tools/future-smartlist">
      <div className="chips">
        <Chip active={tab === "spot"} onClick={() => setTab("spot")}>Spot</Chip>
        <Chip active={tab === "premium"} onClick={() => setTab("premium")}>Premium</Chip>
        <Chip active={tab === "ltp"} onClick={() => setTab("ltp")}>LTP</Chip>
        <Chip active={tab === "change"} onClick={() => setTab("change")}>Change</Chip>
      </div>
      <div className="table-wrap">
        <table className="ux">
          <thead>
            <tr>
              <th style={{ width: "34%" }}>Contract</th>
              <th className="r">Spot</th>
              <th className="r">{tab === "premium" ? "Premium" : "LTP"}</th>
              <th className="r">Change</th>
              <th className="r">OI</th>
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, 8).map((row: HomeFuture) => (
              <tr key={row.key} onClick={() => nav.chart(row.key)} style={{ cursor: "pointer" }}>
                <td>
                  <div className="symcell-stack">
                    <span className="name">{row.underlying}</span>
                    <span className="meta">{expiryLabel(row.expiry)} · lot {row.lot_size} <Tag tone="outline">NFO</Tag></span>
                  </div>
                </td>
                <td className="r num">{inr(row.spot)}</td>
                <td className="r num">{tab === "premium" ? inr(row.premium) : inr(row.ltp)}</td>
                <td className="r"><Change value={row.change} percent={row.change_percent} /></td>
                <td className="r num muted">{(row.oi / OI_LAKH).toFixed(2)}L</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

export function OIScanners({ data }: { data: HomeData }) {
  const nav = useNav();
  const [tab, setTab] = useState<"oi_change" | "ltp" | "change">("oi_change");
  const rows = data.sections.futures.oiScanners[tab];
  return (
    <Section title="OI scanners" icon={<OptionsIcon size={16} />} href={`/fno-tools/oi-analysis`}>
      <div className="chips">
        <Chip active={tab === "oi_change"} onClick={() => setTab("oi_change")}>OI Change</Chip>
        <Chip active={tab === "ltp"} onClick={() => setTab("ltp")}>LTP</Chip>
        <Chip active={tab === "change"} onClick={() => setTab("change")}>Change</Chip>
      </div>
      <div className="table-wrap">
        <table className="ux">
          <thead>
            <tr>
              <th style={{ width: "38%" }}>Contract</th>
              <th className="r">LTP</th>
              <th className="r">Change</th>
              <th className="r">OI (Lakhs)</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 6).map((row: HomeFuture) => (
              <tr key={row.key} onClick={() => nav.chart(row.key)} style={{ cursor: "pointer" }}>
                <td>
                  <div className="symcell-stack">
                    <span className="name">{row.underlying}</span>
                    <span className="meta">{expiryLabel(row.expiry)}</span>
                  </div>
                </td>
                <td className="r num">{inr(row.ltp)}</td>
                <td className="r"><Change value={row.change} percent={row.change_percent} /></td>
                <td className="r num">
                  {row.oi_change >= 0 ? "+" : ""}
                  {(row.oi_change / OI_LAKH).toFixed(2)}
                  <span className="muted" style={{ fontSize: 10 }}> · {(row.oi / OI_LAKH).toFixed(2)}L</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

export function FuturesHeatmap({ data }: { data: HomeData }) {
  const nav = useNav();
  const rows = data.sections.futures.heatmap;
  const max = Math.max(...rows.map((row) => Math.abs(row.change_percent)), 1);
  return (
    <Section title="Futures heatmap" icon={<FireIcon size={16} />} href="/fno-tools/future-heatmap">
      <div className="heatmap">
        {rows.map((row: HomeFuture) => {
          const intensity = Math.min(1, Math.abs(row.change_percent) / max);
          const positive = row.change_percent >= 0;
          const base = positive ? [0, 122, 79] : [198, 50, 36];
          const alpha = 0.12 + intensity * 0.7;
          return (
            <div
              key={row.key}
              className="heat-cell"
              style={{ background: `rgba(${base.join(",")},${alpha})`, color: intensity > 0.4 ? "#fff" : "var(--text)" }}
              onClick={() => nav.chart(row.key)}
              role="button"
              tabIndex={0}
            >
              <b>{row.underlying}</b>
              <span>{pct(row.change_percent)}</span>
              <span style={{ fontSize: 9 }}>{inr(row.ltp)}</span>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function commodityTable(rows: HomeCommodity[], nav: ReturnType<typeof useNav>, limit = 6) {
  return (
    <div className="table-wrap">
      <table className="ux">
        <thead>
          <tr>
            <th style={{ width: "36%" }}>Commodity</th>
            <th>Expiry</th>
            <th className="r">LTP</th>
            <th className="r">Change</th>
            <th className="r">Volume</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, limit).map((row) => (
            <tr key={row.key} onClick={() => nav.chart(row.key)} style={{ cursor: "pointer" }}>
              <td>
                <div className="symcell-stack">
                  <span className="name">{row.symbol}</span>
                  <span className="meta">{row.trading_symbol} <Tag tone="outline">MCX</Tag></span>
                </div>
              </td>
              <td className="num muted">{expiryLabel(row.expiry)}</td>
              <td className="r num">{inr(row.ltp)}</td>
              <td className="r"><Change value={row.change} percent={row.change_percent} /></td>
              <td className="r num muted">{compactInr(row.volume)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CommoditiesSection({ data, title = "Trending commodities" }: { data: HomeData; title?: string }) {
  const nav = useNav();
  return (
    <Section title={title} icon={<BoltIcon size={16} />} href="/home/commodity">
      {commodityTable(data.sections.commodities.rows, nav)}
    </Section>
  );
}

export function CommodityHome({ data }: { data: HomeData }) {
  const nav = useNav();
  const movers = data.sections.commodities.movers;
  const laggards = data.sections.commodities.laggards;
  return (
    <>
      <Section title="Commodity movers" icon={<FireIcon size={16} />} href="/home/commodity">
        <div className="card-grid">
          {movers.slice(0, 3).map((row) => (
            <StockCard key={row.key} symbol={row.symbol} price={row.ltp} change={row.change} changePercent={row.change_percent} onClick={() => nav.chart(row.key)} />
          ))}
          {laggards.slice(0, 1).map((row) => (
            <StockCard key={row.key} symbol={row.symbol} price={row.ltp} change={row.change} changePercent={row.change_percent} onClick={() => nav.chart(row.key)} />
          ))}
        </div>
      </Section>

      <Section title="Expiring soon" icon={<CalendarIcon size={16} />} href="/home/commodity">
        {commodityTable(data.sections.commodities.expiring, nav, 4)}
      </Section>

      <Section title="Commodity options" icon={<OptionsIcon size={16} />} href="/option-chain">
        {commodityTable(data.sections.commodities.options, nav, 5)}
      </Section>

      <Section title="Commodity futures" icon={<TrendIcon size={16} />} href="/home/commodity">
        {commodityTable(data.sections.commodities.rows, nav, 8)}
      </Section>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Stocks tab                                                         */
/* ------------------------------------------------------------------ */

export function MoversTable({ data }: { data: HomeData }) {
  const nav = useNav();
  const [side, setSide] = useState<"gainers" | "losers">("gainers");
  const rows = data.sections.movers[side];
  return (
    <Section title="Movers and Shakers" icon={<FireIcon size={16} />} href="/home/movers-and-shakers">
      <div className="chips">
        <Chip active={side === "gainers"} onClick={() => setSide("gainers")}>Gainers</Chip>
        <Chip active={side === "losers"} onClick={() => setSide("losers")}>Losers</Chip>
      </div>
      {stockRowsTable(rows.slice(0, 6), nav, { sparkline: true, actions: true })}
    </Section>
  );
}

export function MostBoughtTable({ data }: { data: HomeData }) {
  const nav = useNav();
  return (
    <Section title="Most Bought on Upstox" icon={<BagIconLocal />} href="/home/most-bought">
      {stockRowsTable(data.sections.mostBought.rows.slice(0, 6), nav, { sparkline: true })}
    </Section>
  );
}

function BagIconLocal() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M6 8h12l-1 12H7L6 8Z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </svg>
  );
}

export function BuzzingStocks({ data }: { data: HomeData }) {
  const nav = useNav();
  return (
    <Section title="Buzzing stocks" icon={<BoltIcon size={16} />} href="/home/buzzing-stocks">
      {stockRowsTable(data.sections.buzzing.rows.slice(0, 5), nav, { volume: true })}
    </Section>
  );
}

export function MomentumGainers({ data }: { data: HomeData }) {
  const nav = useNav();
  return (
    <Section title="Momentum gainers" icon={<TrendIcon size={16} />} href="/home/momentum-gainers">
      <div className="card-grid">
        {data.sections.momentum.rows.slice(0, 4).map((row) => (
          <StockCard key={row.key} symbol={row.symbol} price={row.ltp} change={row.change} changePercent={row.change_percent} onClick={() => nav.chart(row.key)} />
        ))}
      </div>
    </Section>
  );
}

export function IntradayScreeners({ data }: { data: HomeData }) {
  const nav = useNav();
  const tabs = data.sections.screeners.tabs;
  const [active, setActive] = useState(tabs[0]?.id || "bullish");
  const rows = tabs.find((tab) => tab.id === active)?.rows || [];
  return (
    <Section title="Intraday screeners" icon={<SparkleIcon size={16} />} href="/screeners">
      <div className="chips">
        {tabs.map((tab) => (
          <Chip key={tab.id} active={tab.id === active} onClick={() => setActive(tab.id)}>
            {tab.label}
          </Chip>
        ))}
      </div>
      {stockRowsTable(rows.slice(0, 5), nav, { sparkline: true, actions: true })}
    </Section>
  );
}

export function Under500({ data }: { data: HomeData }) {
  const nav = useNav();
  return (
    <Section title="Start for less than ₹500" icon={<BoltIcon size={16} />} href="/screeners?max=500">
      {stockRowsTable(data.sections.under500.rows.slice(0, 5), nav, { sparkline: true, actions: true })}
    </Section>
  );
}

export function Sectors({ data }: { data: HomeData }) {
  const nav = useNav();
  return (
    <Section title="Sectors" icon={<TrendIcon size={16} />} href="/screeners?sector=all">
      <div className="tile-grid" style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 8 }}>
        {data.sections.sectors.rows.slice(0, 10).map((sector) => (
          <div
            key={sector.key}
            className="sector-cell"
            onClick={() => nav.router.push(`/screeners?sector=${encodeURIComponent(sector.label)}`)}
            role="button"
            tabIndex={0}
          >
            <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }} className="ellipsis">{sector.label}</div>
            <div style={{ fontSize: 13, fontWeight: 600 }} className="num">{inr(sector.ltp)}</div>
            <div style={{ fontSize: 11 }} className={sector.change_percent >= 0 ? "pos" : "neg"}>{pct(sector.change_percent)}</div>
          </div>
        ))}
      </div>
    </Section>
  );
}

export function ETFs({ data }: { data: HomeData }) {
  const nav = useNav();
  const rows = data.sections.etfs.rows;
  return (
    <Section title="ETFs" icon={<BagIconLocal />} href="/home/etfs">
      <div className="table-wrap">
        <table className="ux">
          <thead>
            <tr>
              <th style={{ width: "40%" }}>ETF</th>
              <th className="r">LTP</th>
              <th className="r">Change</th>
              <th className="r">Volume</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 6).map((row) => (
              <tr key={row.key} onClick={() => nav.chart(row.key)} style={{ cursor: "pointer" }}>
                <td>
                  <SymbolCell symbol={row.symbol} name={row.name} segment="NSE ETF" />
                </td>
                <td className="r num">{inr(row.ltp)}</td>
                <td className="r"><Change value={row.change_percent} showPercent /></td>
                <td className="r num muted">{compactInr(row.volume)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

export function SimpleInvesting({ data }: { data: HomeData }) {
  const nav = useNav();
  return (
    <Section title="Simple Investing" icon={<StarIcon size={16} />} href="/screeners">
      <div className="tile-grid c4">
        {data.sections.simpleInvesting.baskets.map((basket) => (
          <div
            key={basket.id}
            className="tile clickable"
            onClick={() => nav.router.push(`/screeners?basket=${basket.id}`)}
            role="button"
            tabIndex={0}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>{basket.name}</span>
              <ChevronRight size={13} />
            </div>
            <div className="muted" style={{ fontSize: 10, marginTop: 2 }}>{basket.note}</div>
            <div className="pos" style={{ fontSize: 16, fontWeight: 600, marginTop: 10 }}>+{basket.return_1y.toFixed(1)}%</div>
            <div className="muted" style={{ fontSize: 10 }}>1Y return · paper basket</div>
          </div>
        ))}
      </div>
    </Section>
  );
}

export function Advisory({ data }: { data: HomeData }) {
  const { openAi } = useApp();
  return (
    <Section title="Advisory" icon={<SparkleIcon size={16} />} href="/reports">
      <div
        style={{
          border: "1px solid var(--stroke)",
          borderRadius: 12,
          padding: 16,
          display: "grid",
          gridTemplateColumns: "1.2fr 2fr",
          gap: 20,
          background: "linear-gradient(135deg, #fbf8fd 0%, #ffffff 70%)",
        }}
      >
        <div>
          <span className="tag brand">12-agent desk</span>
          <div style={{ fontSize: 20, fontWeight: 600, marginTop: 8, lineHeight: "28px" }}>
            Every stock, researched end to end.
          </div>
          <p style={{ fontSize: 12, color: "var(--text-2)", marginTop: 6, lineHeight: "18px" }}>
            Four analysts, a bull/bear debate, a trader and three risk lenses. Run the full pipeline and
            download the report with Screener, Moneycontrol and NSE audit links.
          </p>
          <button
            className="btn btn-primary"
            style={{ marginTop: 10 }}
            onClick={() => openAi({ instrument_key: "NSE_EQ|INE002A01018", symbol: "RELIANCE", name: "Reliance Industries", segment: "NSE_EQ" })}
          >
            Run AI coverage
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {data.sections.advisory.baskets.map((basket) => (
            <div key={basket.id} className="tile" style={{ padding: 10 }}>
              <div style={{ color: "var(--brand)", marginBottom: 6 }}>
                {basket.icon === "bolt" ? <BoltIcon size={15} /> : basket.icon === "shield" ? <StarIcon size={15} /> : <StarIcon size={15} />}
              </div>
              <div style={{ fontSize: 11, fontWeight: 600 }}>{basket.name}</div>
              <div style={{ fontSize: 10, color: "var(--text-2)", marginTop: 2 }}>{basket.note}</div>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

export function IPOSection({ data }: { data: HomeData }) {
  const nav = useNav();
  return (
    <Section title="IPO" icon={<CalendarIcon size={16} />} href="/home/ipo">
      <div className="tile-grid c4">
        {data.sections.ipo.rows.slice(0, 4).map((ipo) => (
          <div key={ipo.symbol} className="tile clickable" onClick={() => nav.router.push("/home/ipo")} role="button" tabIndex={0}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }} className="ellipsis">{ipo.name}</span>
              <Tag tone={ipo.status === "Listed" ? "pos" : "brand"}>{ipo.status}</Tag>
            </div>
            <div className="muted" style={{ fontSize: 10, marginTop: 2 }}>{ipo.segment} · {ipo.price}</div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 10, color: "var(--text-2)" }}>
              <span>{ipo.open} → {ipo.close}</span>
              <span>{ipo.subscription}</span>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Compose tabs                                                       */
/* ------------------------------------------------------------------ */

export function OptionsHome({ data }: { data: HomeData }) {
  const nav = useNav();
  return (
    <>
      <Section title="Options" icon={<OptionsIcon size={16} />} href="/option-chain">
        <div className="chips">
          <Chip onClick={() => nav.router.push("/option-chain")} caret>Option chain</Chip>
          <Chip onClick={() => nav.router.push("/strategy-builder")} caret>Strategy builder</Chip>
          <Chip onClick={() => nav.router.push("/fno-tools/oi-analysis")} caret>OI analysis</Chip>
          <Chip onClick={() => nav.router.push("/trading-charts")} caret>Chart 360</Chip>
        </div>
        <div className="tile-grid c4">
          {data.sections.options.summaries.map((card) => (
            <div key={card.key} className="index-card" onClick={() => nav.chain(card.symbol)} role="button" tabIndex={0}>
              <div className="index-card-top">
                <span className="index-card-name">{card.label}</span>
                <span className="muted" style={{ fontSize: 10 }}>{card.expiry ? expiryLabel(card.expiry) : "—"}</span>
              </div>
              <div className="index-card-price">{inr(card.spot)}</div>
              <div style={{ fontSize: 11 }} className={card.change_percent >= 0 ? "pos" : "neg"}>{pct(card.change_percent)}</div>
              <div className="index-card-meta" style={{ marginTop: 6 }}>
                <span>ATM <b>{card.atm ? inr(card.atm, 0) : "—"}</b></span>
                <span>IV <b>{card.atm_iv ? `${card.atm_iv.toFixed(1)}%` : "—"}</b></span>
              </div>
            </div>
          ))}
        </div>
      </Section>
      <TrendingOptions data={data} />
      <OIAnalysis data={data} />
      <OptionChainCards data={data} />
    </>
  );
}

export function StocksHome({ data }: { data: HomeData }) {
  return (
    <>
      <IPOSection data={data} />
      <MoversTable data={data} />
      <MostBoughtTable data={data} />
      <IntradayScreeners data={data} />
      <Under500 data={data} />
      <Sectors data={data} />
      <ETFs data={data} />
      <SimpleInvesting data={data} />
      <Advisory data={data} />
    </>
  );
}

export function FuturesHome({ data }: { data: HomeData }) {
  return (
    <>
      <FuturesSmartlist data={data} />
      <OIScanners data={data} />
      <FuturesHeatmap data={data} />
    </>
  );
}
