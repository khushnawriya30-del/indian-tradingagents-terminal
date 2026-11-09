"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useApp } from "../AppProvider";
import { CloseIcon, DownloadIcon, SparkleIcon } from "../icons";
import { cx } from "@/lib/client/format";
import { PIPELINE } from "@/components/terminal/constants";

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

const ALIASES: Record<string, string> = {
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
  if (ALIASES[key]) return ALIASES[key];
  return PIPELINE.find((name) => name.toLowerCase().replaceAll(" ", "_") === key) || raw;
}

export function AIDrawer() {
  const { aiTarget, closeAi, notify } = useApp();
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
    if (!aiTarget) {
      setRunning(false);
      return;
    }
    reset();
  }, [aiTarget, reset]);

  useEffect(() => {
    if (!aiTarget) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeAi();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [aiTarget, closeAi]);

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

  function handleEvent(line: string) {
    let event: Record<string, any>;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    if (event.type === "bridge_started") {
      setNotice(`Bridge up · ${event.ticker} · ${event.date} · ${event.settings?.tool_rounds} tool rounds`);
      return;
    }
    if (event.type === "started") {
      const pipeline: string[] = event.pipeline || PIPELINE;
      setStatuses(Object.fromEntries(pipeline.map((name) => [name, "queued" as AgentStatus])));
      setNotice(`${event.ticker} · ${event.date} · ${event.models?.deep || "LLM"} · ${Object.keys(event.vendors || {}).length} vendor chains`);
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
      push(resolveAgent(String(event.agent || "desk")), "working note", String(event.content || ""));
      return;
    }
    if (event.type === "warning" || event.type === "log") {
      push("Desk", event.type === "warning" ? "warning" : "log", String(event.message || ""));
      return;
    }
    if (event.type === "error") {
      const detail = event.detail ? `\n\n${event.detail}` : "";
      setError(`${event.message}${detail}`);
      push("Desk", "error", String(event.message || "Unknown error"));
      return;
    }
    if (event.type === "report_ready") {
      setReport({ id: event.id, download: event.download, view: event.view || `/api/report/${event.id}` });
      return;
    }
    if (event.type === "final") {
      setFinal(event as FinalPayload);
      setStatuses(Object.fromEntries(PIPELINE.map((name) => [name, "done" as AgentStatus])));
    }
  }

  async function run() {
    if (!aiTarget) return;
    if (!["NSE_EQ", "BSE_EQ"].includes(aiTarget.segment || "")) {
      notify({
        tone: "warn",
        title: "Equities only",
        message: "The 12-agent desk researches NSE/BSE cash equities. Indices are quoted, not researched.",
      });
      return;
    }
    reset();
    setRunning(true);
    setStatuses(Object.fromEntries(PIPELINE.map((name) => [name, "queued" as AgentStatus])));
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: aiTarget.instrument_key,
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

  const rating = useMemo(() => {
    if (!final) return null;
    if (typeof final.rating === "string") return { action: final.rating, confidence: null as number | null, detail: "" };
    return {
      action: String(final.rating?.action || "n/a").toUpperCase(),
      confidence: typeof final.rating?.confidence === "number" ? final.rating.confidence : null,
      detail: String(final.rating?.rationale || ""),
    };
  }, [final]);

  const doneCount = Object.values(statuses).filter((value) => value === "done").length;
  const progress = Math.round((doneCount / PIPELINE.length) * 100);
  const open = Boolean(aiTarget);
  const tone =
    rating && (rating.action.includes("BUY") || rating.action.includes("OVERWEIGHT"))
      ? "pos"
      : rating && (rating.action.includes("SELL") || rating.action.includes("UNDERWEIGHT"))
        ? "neg"
        : "";

  return (
    <>
      {open && <div className="scrim" style={{ zIndex: 85 }} onClick={closeAi} />}
      <aside className={cx("drawer", open && "open")} aria-hidden={!open} aria-label="AI research desk">
        <div className="drawer-head">
          <span style={{ width: 30, height: 30, borderRadius: 8, background: "var(--brand-subtle)", color: "var(--brand)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <SparkleIcon size={16} />
          </span>
          <div className="grow" style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>AI research desk</div>
            <div className="ellipsis" style={{ fontSize: 10, color: "var(--text-2)" }}>
              {aiTarget ? `${aiTarget.symbol} · ${aiTarget.name || aiTarget.segment}` : "No symbol selected"}
            </div>
          </div>
          <button className="icon-btn" onClick={closeAi} aria-label="Close AI desk">
            <CloseIcon size={16} />
          </button>
        </div>

        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--stroke-2)", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <Selector label="Debate" value={debate} options={[1, 2, 3]} onChange={setDebate} />
            <Selector label="Risk" value={risk} options={[1, 2, 3]} onChange={setRisk} />
            <Selector label="Tools" value={tools} options={[2, 4, 6, 8, 10, 12]} onChange={setTools} />
            <span className="spacer" />
            <span className="tag brand">12 agents</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary grow" onClick={run} disabled={running || !aiTarget}>
              {running ? "Pipeline running…" : "Run full coverage"}
            </button>
            {report && (
              <a className="btn" href={report.download} style={{ gap: 6 }}>
                <DownloadIcon size={14} />
                Report
              </a>
            )}
            {report && (
              <a className="btn" href={report.view} target="_blank" rel="noreferrer">
                View
              </a>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ flex: 1, height: 4, borderRadius: 4, background: "var(--bg-alt)", overflow: "hidden" }}>
              <div style={{ width: `${progress}%`, height: "100%", background: "var(--brand)", transition: "width .4s var(--ease)" }} />
            </div>
            <span className="mono" style={{ fontSize: 10, color: "var(--text-2)" }}>{doneCount}/{PIPELINE.length}</span>
          </div>
          {notice && <div style={{ fontSize: 10, color: "var(--text-2)" }}>{notice}</div>}
        </div>

        <div ref={scroller} className="drawer-body scroll-thin" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            {PIPELINE.map((agent) => {
              const status = statuses[agent] || "queued";
              return (
                <div
                  key={agent}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "5px 8px",
                    borderRadius: 4,
                    border: "1px solid var(--stroke-2)",
                    fontSize: 10.5,
                    background: status === "done" ? "var(--pos-subtle)" : status === "active" ? "var(--brand-subtle)" : status === "error" ? "var(--neg-subtle)" : "#fff",
                    color: status === "done" ? "var(--pos)" : status === "active" ? "var(--brand)" : status === "error" ? "var(--neg)" : "var(--text-2)",
                  }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: 999, background: "currentColor", flex: "0 0 auto", opacity: status === "queued" ? 0.35 : 1 }} />
                  <span className="ellipsis">{agent}</span>
                </div>
              );
            })}
          </div>

          {rating && (
            <div style={{ border: "1px solid var(--stroke)", borderLeft: `3px solid ${tone === "neg" ? "var(--neg)" : tone === "pos" ? "var(--pos)" : "var(--warn)"}`, borderRadius: 8, padding: "10px 12px" }}>
              <div className="muted" style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em" }}>Portfolio manager</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 2 }}>
                <span style={{ fontSize: 20, fontWeight: 700 }} className={tone}>{rating.action}</span>
                {rating.confidence !== null && <span className="mono" style={{ fontSize: 10, color: "var(--text-2)" }}>{Math.round(rating.confidence)}% confidence</span>}
              </div>
              {rating.detail && <p style={{ fontSize: 11, lineHeight: "17px", color: "var(--text-2)", marginTop: 4, whiteSpace: "pre-wrap" }}>{rating.detail}</p>}
            </div>
          )}

          {error && (
            <div style={{ border: "1px solid var(--neg)", background: "var(--neg-subtle)", borderRadius: 6, padding: "8px 10px", fontSize: 11, color: "var(--neg)" }}>
              <b>Pipeline error</b>
              <pre style={{ marginTop: 4, whiteSpace: "pre-wrap", fontSize: 10 }}>{error}</pre>
            </div>
          )}

          {!feed.length && !running && !final && (
            <div style={{ border: "1px solid var(--stroke-2)", borderRadius: 6, padding: "12px", fontSize: 11, lineHeight: "18px", color: "var(--text-2)" }}>
              Streams the full TradingAgents India graph — four analysts, the bull/bear debate, research manager,
              trader, three risk lenses and the portfolio manager. The rating and the complete HTML report land here.
            </div>
          )}

          {[...feed].reverse().map((card) => {
            const isOpen = expanded[card.id] ?? false;
            const body = isOpen ? card.content : card.content.slice(0, 220);
            return (
              <div key={card.id} style={{ border: "1px solid var(--stroke-2)", borderRadius: 6, overflow: "hidden" }}>
                <button
                  onClick={() => setExpanded((current) => ({ ...current, [card.id]: !isOpen }))}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", border: 0, background: "var(--bg-subtle)", cursor: "pointer" }}
                >
                  <span className="tag brand">{card.agent}</span>
                  <span style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-2)" }}>{card.title}</span>
                  <span className="spacer" />
                  <span style={{ fontSize: 10, color: "var(--text-2)" }}>{isOpen ? "−" : "+"}</span>
                </button>
                <pre style={{ margin: 0, padding: "8px 10px", fontSize: 10.5, lineHeight: "16px", color: "var(--text-2)", whiteSpace: "pre-wrap", maxHeight: 280, overflow: "auto" }}>
                  {body}
                  {!isOpen && card.content.length > 220 ? "…" : ""}
                </pre>
              </div>
            );
          })}
        </div>

        <div className="drawer-foot" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10, color: "var(--text-3)" }}>Local pipeline · paper desk</span>
          <span className="spacer" />
          <button className="btn btn-sm" onClick={closeAi}>Close</button>
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
    <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-2)" }}>
      {label}
      <select
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="select"
        style={{ height: 26, padding: "0 22px 0 6px", fontSize: 10 }}
      >
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}
