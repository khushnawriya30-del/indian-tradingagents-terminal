"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { PortfolioSnapshot, WatchlistItem } from "@/lib/types";
import { PIPELINE } from "./constants";
import type { ToastMessage } from "./Toast";

interface AIDrawerProps {
  open: boolean;
  selected: WatchlistItem | null;
  portfolio: PortfolioSnapshot | null;
  onClose: () => void;
  notify: (message: Omit<ToastMessage, "id">) => void;
}

type AgentStatus = "queued" | "active" | "done" | "error";

interface FeedCard {
  id: number;
  agent: string;
  title: string;
  content: string;
}

interface FinalPayload {
  ticker: string;
  date: string;
  rating: string | { action?: string; confidence?: number; rationale?: string };
  final_decision: string | null;
  trader_plan: string | null;
  investment_plan: string | null;
  reports: Record<string, string | null>;
  report_paths: Record<string, string>;
  generated_at: string;
}

const AGENT_ALIASES: Record<string, string> = {
  market_analyst: "Market Analyst",
  social_analyst: "Sentiment Analyst",
  sentiment_analyst: "Sentiment Analyst",
  news_analyst: "News Analyst",
  fundamentals_analyst: "Fundamentals Analyst",
  bull_researcher: "Bull Researcher",
  bear_researcher: "Bear Researcher",
  research_manager: "Research Manager",
  trader: "Trader",
  aggressive_analyst: "Aggressive Analyst",
  conservative_analyst: "Conservative Analyst",
  neutral_analyst: "Neutral Analyst",
  portfolio_manager: "Portfolio Manager",
};

function resolveAgent(raw: string): string {
  const key = raw.trim().toLowerCase().replaceAll(" ", "_");
  if (AGENT_ALIASES[key]) return AGENT_ALIASES[key];
  const match = PIPELINE.find((name) => name.toLowerCase().replaceAll(" ", "_") === key);
  return match || raw;
}

function ratingLabel(rating: FinalPayload["rating"]): { action: string; confidence: number | null; detail: string } {
  if (typeof rating === "string") return { action: rating, confidence: null, detail: "" };
  return {
    action: String(rating?.action || "n/a").toUpperCase(),
    confidence: typeof rating?.confidence === "number" ? rating.confidence : null,
    detail: String(rating?.rationale || ""),
  };
}

function actionTone(action: string): string {
  const value = action.toUpperCase();
  if (value.includes("BUY") || value.includes("OVERWEIGHT")) {
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  }
  if (value.includes("SELL") || value.includes("UNDERWEIGHT")) {
    return "border-rose-500/40 bg-rose-500/10 text-rose-300";
  }
  return "border-amber-500/40 bg-amber-500/10 text-amber-300";
}

export function AIDrawer({ open, selected, portfolio, onClose, notify }: AIDrawerProps) {
  const [running, setRunning] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, AgentStatus>>({});
  const [feed, setFeed] = useState<FeedCard[]>([]);
  const [final, setFinal] = useState<FinalPayload | null>(null);
  const [report, setReport] = useState<{ id: string; download: string; view: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [debate, setDebate] = useState(1);
  const [risk, setRisk] = useState(1);
  const [tools, setTools] = useState(6);
  const counter = useRef(0);
  const scroller = useRef<HTMLDivElement>(null);

  const reset = useCallback(() => {
    setStatuses(Object.fromEntries(PIPELINE.map((name) => [name, "queued" as AgentStatus])));
    setFeed([]);
    setFinal(null);
    setReport(null);
    setError(null);
    setNotice(null);
    setExpanded({});
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!scroller.current) return;
    scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [feed.length, final, error]);

  const markAgent = useCallback((agent: string, status: AgentStatus) => {
    setStatuses((current) => ({ ...current, [agent]: status }));
  }, []);

  const push = useCallback((agent: string, title: string, content: string) => {
    counter.current += 1;
    const id = counter.current;
    setFeed((current) => [...current.slice(-79), { id, agent, title, content }]);
  }, []);

  async function run() {
    if (!selected) {
      notify({ tone: "warn", title: "Pick a symbol", message: "The 12-agent desk needs a ticker." });
      return;
    }
    if (!["NSE_EQ", "BSE_EQ"].includes(selected.segment)) {
      notify({
        tone: "warn",
        title: "Equities only",
        message: "Full AI coverage targets NSE/BSE cash equities. Indices are quoted but not researched.",
      });
      return;
    }

    reset();
    setRunning(true);
    const queued = Object.fromEntries(PIPELINE.map((name) => [name, "queued" as AgentStatus]));
    setStatuses(queued);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: selected.instrument_key,
          debate_rounds: debate,
          risk_rounds: risk,
          tool_rounds: tools,
          analysts: "market,social,news,fundamentals",
        }),
      });

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `Analysis failed (${response.status})`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line) handleEvent(line);
          newline = buffer.indexOf("\n");
        }
      }
      if (buffer.trim()) handleEvent(buffer.trim());
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Analysis failed";
      setError(message);
      notify({ tone: "error", title: "Analysis interrupted", message });
    } finally {
      setRunning(false);
      setStatuses((current) => {
        const next = { ...current };
        for (const key of Object.keys(next)) if (next[key] === "active") next[key] = "error";
        return next;
      });
    }
  }

  function handleEvent(line: string) {
    let event: Record<string, any>;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }

    if (event.type === "bridge_started") {
      setNotice(
        `Bridge up · ${event.ticker} · ${event.date} · ${event.settings?.tool_rounds} tool rounds`
      );
      return;
    }
    if (event.type === "started") {
      const pipeline: string[] = event.pipeline || PIPELINE;
      setStatuses(Object.fromEntries(pipeline.map((name) => [name, "queued" as AgentStatus])));
      setNotice(
        `${event.ticker} · ${event.date} · ${event.models?.deep || "LLM"} · ${Object.keys(event.vendors || {}).length} vendor chains`
      );
      return;
    }
    if (event.type === "status") {
      markAgent(resolveAgent(String(event.agent)), event.status === "done" ? "done" : "active");
      return;
    }
    if (event.type === "report") {
      const agent = resolveAgent(String(event.agent));
      markAgent(agent, "done");
      push(agent, String(event.key || "report"), String(event.content || ""));
      return;
    }
    if (event.type === "message") {
      const agent = resolveAgent(String(event.agent || "desk"));
      push(agent, "working note", String(event.content || ""));
      return;
    }
    if (event.type === "warning" || event.type === "log") {
      push("Desk", event.type === "warning" ? "warning" : "log", String(event.message || ""));
      return;
    }
    if (event.type === "error") {
      const detail = event.detail ? `\n\n${event.detail}` : "";
      setError(`${event.message}${detail}`);
      push("Desk", "error", String(event.message || "unknown error"));
      return;
    }
    if (event.type === "report_ready") {
      setReport({ id: event.id, download: event.download, view: event.view || `/api/report/${event.id}` });
      return;
    }
    if (event.type === "final") {
      setFinal(event as FinalPayload);
      setStatuses(Object.fromEntries(PIPELINE.map((name) => [name, "done" as AgentStatus])));
      return;
    }
  }

  const rating = useMemo(() => (final ? ratingLabel(final.rating) : null), [final]);
  const doneCount = useMemo(
    () => Object.values(statuses).filter((value) => value === "done").length,
    [statuses]
  );
  const progress = PIPELINE.length ? Math.round((doneCount / PIPELINE.length) * 100) : 0;

  return (
    <>
      <div
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px] transition-opacity duration-200 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <aside
        className={`fixed right-0 top-0 z-50 flex h-full w-full max-w-[640px] flex-col border-l border-[var(--line)] bg-[#070b10] shadow-2xl shadow-black/80 transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        aria-hidden={!open}
      >
        <div className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md border border-sky-500/30 bg-sky-500/10">
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-sky-400" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1M7.7 16.3l-2.1 2.1" />
              <circle cx="12" cy="12" r="3.5" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-100">AI Desk</div>
            <div className="truncate text-[10px] text-zinc-500">
              {selected ? `${selected.symbol} · ${selected.name || selected.segment}` : "No symbol selected"}
            </div>
          </div>
          <button onClick={onClose} className="rounded border border-[var(--line)] px-2 py-1 text-[10px] text-zinc-500 hover:text-zinc-200">
            Esc ✕
          </button>
        </div>

        <div className="space-y-2 border-b border-[var(--line)] px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <Selector label="Debate" value={debate} options={[1, 2, 3]} onChange={setDebate} />
            <Selector label="Risk" value={risk} options={[1, 2, 3]} onChange={setRisk} />
            <Selector label="Tool rounds" value={tools} options={[2, 4, 6, 8, 10, 12]} onChange={setTools} />
            <div className="ml-auto flex items-center gap-2 text-[9px] uppercase tracking-[0.12em] text-zinc-600">
              <span>{portfolio?.funds ? `Book ${Math.round(portfolio.funds.total_pnl_percent)}%` : "Paper"}</span>
              <span className="h-1 w-1 rounded-full bg-zinc-700" />
              <span>12 agents</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={run}
              disabled={running || !selected}
              className="flex-1 rounded-md border border-sky-500/35 bg-sky-500/10 py-2 text-[10.5px] font-bold uppercase tracking-[0.18em] text-sky-300 transition hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {running ? "Pipeline running…" : "Run full coverage"}
            </button>
            {report && (
              <>
                <a
                  href={report.download}
                  className="rounded-md border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-300 transition hover:bg-emerald-500/20"
                >
                  Download report
                </a>
                <a
                  href={report.view}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md border border-[var(--line)] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-300 hover:bg-white/[0.04]"
                >
                  View
                </a>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-sky-500 to-emerald-400 transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="font-mono text-[9px] tabular-nums text-zinc-500">
              {doneCount}/{PIPELINE.length}
            </span>
          </div>
          {notice && <div className="text-[9px] text-zinc-600">{notice}</div>}
        </div>

        <div ref={scroller} className="minimal-scroll flex-1 space-y-2 overflow-y-auto px-4 py-3">
          <div className="grid grid-cols-2 gap-1.5">
            {PIPELINE.map((agent) => {
              const status = statuses[agent] || "queued";
              return (
                <div
                  key={agent}
                  className={`flex items-center gap-2 rounded border px-2 py-1 text-[9.5px] transition ${
                    status === "done"
                      ? "border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-300"
                      : status === "active"
                        ? "border-sky-500/30 bg-sky-500/[0.08] text-sky-300"
                        : status === "error"
                          ? "border-rose-500/30 bg-rose-500/[0.08] text-rose-300"
                          : "border-[var(--line)] text-zinc-600"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      status === "done"
                        ? "bg-emerald-400"
                        : status === "active"
                          ? "animate-pulse bg-sky-400"
                          : status === "error"
                            ? "bg-rose-400"
                            : "bg-zinc-700"
                    }`}
                  />
                  <span className="truncate">{agent}</span>
                  {status === "active" && <span className="ml-auto h-2 w-2 animate-spin rounded-full border border-sky-400/40 border-t-sky-300" />}
                </div>
              );
            })}
          </div>

          {rating && (
            <div className={`rounded-lg border px-3 py-2.5 ${actionTone(rating.action)}`}>
              <div className="flex items-center gap-2">
                <span className="text-[9px] uppercase tracking-[0.16em] opacity-70">Portfolio manager</span>
                <span className="ml-auto font-mono text-[9px] opacity-70">
                  {final?.generated_at ? final.generated_at.replace("T", " ") : ""}
                </span>
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-[20px] font-bold tracking-wide">{rating.action}</span>
                {rating.confidence !== null && (
                  <span className="font-mono text-[10px] opacity-80">{Math.round(rating.confidence)}% confidence</span>
                )}
              </div>
              {rating.detail && <p className="mt-1 whitespace-pre-wrap text-[10px] leading-relaxed opacity-90">{rating.detail}</p>}
            </div>
          )}

          {error && (
            <div className="rounded border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2 text-[10px] leading-relaxed text-rose-300">
              <div className="font-semibold uppercase tracking-[0.12em]">Pipeline error</div>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-[9px] text-rose-200/80">{error}</pre>
            </div>
          )}

          {feed.length === 0 && !running && !final && (
            <div className="rounded border border-[var(--line)] bg-white/[0.01] px-3 py-4 text-[11px] leading-relaxed text-zinc-500">
              The drawer streams the full TradingAgents India graph: four analysts, bull/bear debate,
              research manager, trader, three risk lenses and the portfolio manager. Final rating and
              the complete HTML report land here.
            </div>
          )}

          {[...feed].reverse().map((card) => {
            const isOpen = expanded[card.id] ?? false;
            const body = isOpen ? card.content : card.content.slice(0, 220);
            return (
              <div key={card.id} className="rounded border border-[var(--line)] bg-[var(--panel)]">
                <button
                  onClick={() => setExpanded((current) => ({ ...current, [card.id]: !isOpen }))}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left"
                >
                  <span className="rounded bg-white/[0.05] px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-[0.1em] text-sky-300/80">
                    {card.agent}
                  </span>
                  <span className="text-[9px] uppercase tracking-[0.12em] text-zinc-600">{card.title}</span>
                  <span className="ml-auto text-[9px] text-zinc-600">{isOpen ? "−" : "+"}</span>
                </button>
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap border-t border-[var(--line)] px-3 py-2 text-[10px] leading-relaxed text-zinc-400">
                  {body}
                  {!isOpen && card.content.length > 220 ? "…" : ""}
                </pre>
              </div>
            );
          })}
        </div>
      </aside>
    </>
  );
}

function Selector({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: number;
  options: number[];
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.12em] text-zinc-600">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="rounded border border-[var(--line)] bg-[var(--panel)] px-1.5 py-1 font-mono text-[10px] tabular-nums text-zinc-200 focus:outline-none"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}
