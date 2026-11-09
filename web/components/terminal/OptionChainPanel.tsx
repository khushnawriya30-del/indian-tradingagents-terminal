"use client";

import { useEffect, useMemo, useState } from "react";

import { compactNumber, percent, price, toneClass } from "@/lib/format";
import type { ChainPayload, SessionState, WatchlistItem } from "@/lib/types";
import { INDEX_UNDERLYINGS } from "./constants";

interface OptionChainPanelProps {
  selected: WatchlistItem | null;
  session: SessionState | null;
}

export function OptionChainPanel({ selected, session }: OptionChainPanelProps) {
  const [underlying, setUnderlying] = useState("NIFTY");
  const [expiry, setExpiry] = useState("");
  const [data, setData] = useState<ChainPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (selected?.segment === "NSE_INDEX") {
      const map: Record<string, string> = {
        "NIFTY 50": "NIFTY",
        BANKNIFTY: "BANKNIFTY",
        FINNIFTY: "FINNIFTY",
      };
      if (map[selected.symbol]) setUnderlying(map[selected.symbol]);
    }
  }, [selected?.symbol, selected?.segment]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const query = new URLSearchParams({ symbol: underlying });
    if (expiry) query.set("expiry", expiry);
    fetch(`/api/chain?${query.toString()}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Chain failed");
        setData(payload);
        if (payload.expiry && payload.expiry !== expiry) setExpiry(payload.expiry);
      })
      .catch((reason) => {
        if (reason?.name !== "AbortError") setError(reason instanceof Error ? reason.message : "Chain failed");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [underlying, expiry]);

  const atm = useMemo(() => {
    if (!data?.spot || !data.rows.length) return null;
    return data.rows.reduce((best, row) =>
      Math.abs(row.strike - data.spot!) < Math.abs(best.strike - data.spot!) ? row : best
    ).strike;
  }, [data]);

  const maxOi = useMemo(() => {
    if (!data) return 1;
    return Math.max(1, ...data.rows.flatMap((row) => [row.call.oi, row.put.oi]));
  }, [data]);

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--panel)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-3 py-2">
        <div className="flex items-center gap-1 rounded-md border border-[var(--line)] bg-[#0a0f15] p-0.5">
          {INDEX_UNDERLYINGS.map((value) => (
            <button
              key={value}
              onClick={() => {
                setUnderlying(value);
                setExpiry("");
              }}
              className={`rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] transition ${
                underlying === value
                  ? "bg-white/[0.08] text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {value}
            </button>
          ))}
        </div>
        <select
          value={expiry}
          onChange={(event) => setExpiry(event.target.value)}
          className="h-7 rounded border border-[var(--line)] bg-[#0a0f15] px-2 text-[10px] text-zinc-300 outline-none"
        >
          {(data?.expiries || []).map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <div className="ml-auto flex flex-wrap items-center gap-4 text-[10px]">
          <span className="text-zinc-500">
            Spot <span className="font-mono tabular-nums text-zinc-200">{price(data?.spot)}</span>
          </span>
          <span className="text-zinc-500">
            PCR <span className="font-mono tabular-nums text-sky-300">{data ? data.totals.pcr.toFixed(2) : "—"}</span>
          </span>
          <span className="text-zinc-500">
            Max pain <span className="font-mono tabular-nums text-amber-300">{data?.totals.max_pain ?? "—"}</span>
          </span>
          <span className="text-zinc-500">
            Lot <span className="font-mono tabular-nums text-zinc-300">{data?.lot_size ?? "—"}</span>
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 border-b border-[var(--line)] px-4 py-2.5">
        <OiBar label="Call OI" value={data?.totals.call_oi || 0} max={Math.max(data?.totals.call_oi || 0, data?.totals.put_oi || 0)} tone="rose" />
        <OiBar label="Put OI" value={data?.totals.put_oi || 0} max={Math.max(data?.totals.call_oi || 0, data?.totals.put_oi || 0)} tone="emerald" />
      </div>

      <div className="max-h-[520px] overflow-auto minimal-scroll">
        <table className="w-full border-collapse text-[10.5px]">
          <thead className="sticky top-0 z-10 bg-[#0b1118]">
            <tr className="text-[8.5px] uppercase tracking-[0.12em] text-zinc-600">
              <th colSpan={5} className="border-b border-r border-[var(--line)] px-2 py-1.5 text-left text-rose-400/80">
                Calls
              </th>
              <th className="border-b border-[var(--line)] px-2 py-1.5 text-center text-zinc-400">Strike</th>
              <th colSpan={5} className="border-b border-l border-[var(--line)] px-2 py-1.5 text-left text-emerald-400/80">
                Puts
              </th>
            </tr>
            <tr className="text-[8.5px] uppercase tracking-[0.1em] text-zinc-600">
              {["OI", "Vol", "IV", "LTP", "Δ"].map((label) => (
                <th key={`c-${label}`} className="border-b border-r border-[var(--line)] px-2 py-1 text-right font-medium">
                  {label}
                </th>
              ))}
              <th className="border-b border-[var(--line)] px-2 py-1 text-center font-medium">Price</th>
              {["LTP", "Δ", "IV", "Vol", "OI"].map((label) => (
                <th key={`p-${label}`} className="border-b border-l border-[var(--line)] px-2 py-1 text-right font-medium">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && !data && (
              <tr>
                <td colSpan={11} className="px-3 py-16 text-center text-[11px] text-zinc-500">
                  Loading option chain…
                </td>
              </tr>
            )}
            {error && (
              <tr>
                <td colSpan={11} className="px-3 py-16 text-center text-[11px] text-rose-300">
                  {error}
                  <div className="mt-2 text-[10px] text-zinc-500">
                    Option chains need an F&O underlying. Try NIFTY or BANKNIFTY above.
                  </div>
                </td>
              </tr>
            )}
            {data?.rows.map((row) => {
              const isAtm = row.strike === atm;
              const callItm = data.spot !== null && row.strike < data.spot;
              const putItm = data.spot !== null && row.strike > data.spot;
              return (
                <tr
                  key={row.strike}
                  className={`border-b border-[var(--line)]/50 ${
                    isAtm ? "bg-sky-500/[0.07]" : "hover:bg-white/[0.02]"
                  }`}
                >
                  <Cell value={compactNumber(row.call.oi)} align="right" tone="text-zinc-400" muted={!callItm} bar={(row.call.oi / maxOi) * 100} barTone="rose" />
                  <Cell value={compactNumber(row.call.volume)} align="right" tone="text-zinc-500" />
                  <Cell value={row.call.iv ? row.call.iv.toFixed(1) : "—"} align="right" tone="text-zinc-500" />
                  <Cell value={price(row.call.ltp)} align="right" tone="text-zinc-100" strong />
                  <Cell value={row.call.change.toFixed(2)} align="right" tone={toneClass(row.call.change)} />

                  <td className={`border-x border-[var(--line)] px-2 py-1.5 text-center font-mono text-[11px] tabular-nums ${isAtm ? "font-bold text-sky-300" : "text-zinc-200"}`}>
                    {row.strike.toLocaleString("en-IN")}
                  </td>

                  <Cell value={price(row.put.ltp)} align="right" tone="text-zinc-100" strong />
                  <Cell value={row.put.change.toFixed(2)} align="right" tone={toneClass(row.put.change)} />
                  <Cell value={row.put.iv ? row.put.iv.toFixed(1) : "—"} align="right" tone="text-zinc-500" />
                  <Cell value={compactNumber(row.put.volume)} align="right" tone="text-zinc-500" />
                  <Cell value={compactNumber(row.put.oi)} align="right" tone="text-zinc-400" muted={!putItm} bar={(row.put.oi / maxOi) * 100} barTone="emerald" />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-[var(--line)] px-3 py-2 text-[9px] uppercase tracking-[0.12em] text-zinc-600">
        <span>Greeks & OI: Upstox v2</span>
        <span>ATM {atm ? atm.toLocaleString("en-IN") : "—"}</span>
        <span>Expiry {data?.expiry || "—"}</span>
        <span className="ml-auto">
          {session?.is_open ? "Live chain" : "Frozen at last official close"}
        </span>
      </div>
    </div>
  );
}

function Cell({
  value,
  align,
  tone,
  strong,
  muted,
  bar,
  barTone,
}: {
  value: string;
  align: "left" | "right";
  tone?: string;
  strong?: boolean;
  muted?: boolean;
  bar?: number;
  barTone?: "rose" | "emerald";
}) {
  return (
    <td className={`relative px-2 py-1.5 font-mono tabular-nums ${align === "right" ? "text-right" : "text-left"} ${tone || "text-zinc-300"} ${strong ? "font-semibold" : ""} ${muted ? "opacity-55" : ""}`}>
      {typeof bar === "number" && (
        <span
          className={`absolute inset-y-0 right-0 ${barTone === "rose" ? "bg-rose-500/[0.07]" : "bg-emerald-500/[0.07]"}`}
          style={{ width: `${Math.min(100, bar)}%` }}
        />
      )}
      <span className="relative">{value}</span>
    </td>
  );
}

function OiBar({ label, value, max, tone }: { label: string; value: number; max: number; tone: "rose" | "emerald" }) {
  const pct = max ? (value / max) * 100 : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-[9px] uppercase tracking-[0.12em]">
        <span className="text-zinc-500">{label}</span>
        <span className="font-mono tabular-nums text-zinc-300">{compactNumber(value)}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.04]">
        <div
          className={`h-full rounded-full ${tone === "rose" ? "bg-rose-500/70" : "bg-emerald-500/70"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
