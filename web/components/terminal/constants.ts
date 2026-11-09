import type { SessionPhase } from "@/lib/types";

export const INDEX_KEYS = [
  "NSE_INDEX|Nifty 50",
  "NSE_INDEX|Nifty Bank",
  "BSE_INDEX|SENSEX",
  "NSE_INDEX|India VIX",
];

export const CHART_INTERVALS = ["1m", "5m", "15m", "1D"] as const;
export type ChartInterval = (typeof CHART_INTERVALS)[number];

export const PHASE_LABEL: Record<SessionPhase, string> = {
  open: "Market open",
  pre_open: "Pre-open",
  closed: "Market closed",
  weekend: "Weekend",
  holiday: "Exchange holiday",
};

export const PHASE_TONE: Record<SessionPhase, string> = {
  open: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
  pre_open: "text-amber-300 border-amber-500/30 bg-amber-500/10",
  closed: "text-zinc-400 border-zinc-600/40 bg-zinc-700/20",
  weekend: "text-zinc-400 border-zinc-600/40 bg-zinc-700/20",
  holiday: "text-fuchsia-300 border-fuchsia-500/30 bg-fuchsia-500/10",
};

export const PIPELINE = [
  "Market Analyst",
  "Sentiment Analyst",
  "News Analyst",
  "Fundamentals Analyst",
  "Bull Researcher",
  "Bear Researcher",
  "Research Manager",
  "Trader",
  "Aggressive Analyst",
  "Conservative Analyst",
  "Neutral Analyst",
  "Portfolio Manager",
];

export const INDEX_UNDERLYINGS = ["NIFTY", "BANKNIFTY", "FINNIFTY"];
