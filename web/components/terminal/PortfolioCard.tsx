"use client";

import { money, moneyCompact, percent, signed, toneClass } from "@/lib/format";
import type { PortfolioSnapshot } from "@/lib/types";

interface PortfolioCardProps {
  portfolio: PortfolioSnapshot | null;
  onOpenAI: () => void;
}

export function PortfolioCard({ portfolio, onOpenAI }: PortfolioCardProps) {
  const funds = portfolio?.funds;
  const invested = (funds?.holdings_value || 0) + (funds?.margin_blocked || 0);
  const allocation = funds?.total_value ? Math.min(100, (invested / funds.total_value) * 100) : 0;
  const positionCount = (portfolio?.holdings.length || 0) + (portfolio?.positions.length || 0);

  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--panel)]">
      <div className="flex items-center justify-between border-b border-[var(--line)] px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
          Paper portfolio
        </span>
        <span className="text-[9px] uppercase tracking-[0.14em] text-zinc-600">₹10L book</span>
      </div>
      <div className="space-y-3 px-3 py-3">
        <div>
          <div className="text-[9px] uppercase tracking-[0.14em] text-zinc-500">Net liquidation</div>
          <div className="mt-0.5 font-mono text-[22px] tabular-nums leading-none text-zinc-50">
            {funds ? money(funds.total_value) : "—"}
          </div>
          <div className={`mt-1.5 flex items-center gap-2 font-mono text-[10px] tabular-nums ${toneClass(funds?.total_pnl)}`}>
            <span>{funds ? `${signed(funds.total_pnl)} total` : "—"}</span>
            <span className="text-zinc-600">·</span>
            <span>{funds ? percent(funds.total_pnl_percent) : "—"}</span>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between text-[9px] uppercase tracking-[0.12em] text-zinc-600">
            <span>Deployed</span>
            <span>{allocation.toFixed(1)}%</span>
          </div>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/[0.05]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-sky-500 to-emerald-400"
              style={{ width: `${allocation}%` }}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          <Metric label="Available" value={moneyCompact(funds?.available)} />
          <Metric label="Margin used" value={moneyCompact(funds?.margin_blocked)} />
          <Metric
            label="Day P&L"
            value={funds ? signed(funds.day_pnl) : "—"}
            tone={toneClass(funds?.day_pnl)}
          />
          <Metric
            label="Unrealised"
            value={funds ? signed(funds.unrealized_pnl) : "—"}
            tone={toneClass(funds?.unrealized_pnl)}
          />
          <Metric label="Holdings" value={moneyCompact(funds?.holdings_value)} />
          <Metric label="Positions" value={String(positionCount)} />
        </div>

        <button
          onClick={onOpenAI}
          className="w-full rounded-md border border-sky-500/25 bg-sky-500/10 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-300 transition hover:bg-sky-500/20"
        >
          Run 12-agent coverage
        </button>
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className="text-[8.5px] uppercase tracking-[0.12em] text-zinc-600">{label}</div>
      <div className={`font-mono text-[11px] tabular-nums ${tone || "text-zinc-300"}`}>{value}</div>
    </div>
  );
}
