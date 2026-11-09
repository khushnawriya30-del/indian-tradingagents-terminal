"""Run the full TradingAgents pipeline for one Indian ticker and stream progress.

The Next.js AI desk spawns this script, reads JSONL from stdout, and renders the
debate as it happens. The graph itself is untouched: same 12-agent hierarchy,
same analysts, researchers, risk debate and portfolio manager. Only the data
vendors and the market context are Indian.

Usage:
    python scripts/analyze.py --ticker RELIANCE.NS --date 2026-11-06 --out out/job.json
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import traceback
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tradingagents.agents.rating import run_rating  # noqa: E402
from tradingagents.default_config import build_default_config  # noqa: E402
from tradingagents.graph.trading_graph import TradingAgentsGraph  # noqa: E402

ANALYST_LABELS = {
    "market_report": "Market Analyst",
    "sentiment_report": "Sentiment Analyst",
    "news_report": "News Analyst",
    "fundamentals_report": "Fundamentals Analyst",
}

PIPELINE = [
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
]


def emit(event: dict) -> None:
    sys.stdout.write(json.dumps(event, default=str) + "\n")
    sys.stdout.flush()


def _clean(value):
    """JSON-safe copy of a report field (dicts of strings, lists, scalars)."""
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {str(k): _clean(v) for k, v in value.items() if k != "messages"}
    if isinstance(value, (list, tuple)):
        return [_clean(v) for v in value]
    return str(value)


def build_config(args) -> dict:
    config = build_default_config()
    config.update({
        "max_debate_rounds": args.debate_rounds,
        "max_risk_discuss_rounds": args.risk_rounds,
        "max_tool_rounds": args.tool_rounds,
        "max_recur_limit": max(config.get("max_recur_limit", 100), 2 * args.tool_rounds + 20),
        "results_dir": str(ROOT / "results"),
        "data_cache_dir": str(ROOT / ".tradingagents-cache"),
        "memory_log_path": str(ROOT / "results" / "memory" / "trading_memory.md"),
    })
    if args.analysts:
        config["selected_analysts"] = [a.strip() for a in args.analysts.split(",") if a.strip()]
    return config


def main() -> int:
    parser = argparse.ArgumentParser(description="TradingAgents India analysis bridge")
    parser.add_argument("--ticker", required=True)
    parser.add_argument("--date", default=datetime.now().strftime("%Y-%m-%d"))
    parser.add_argument("--analysts", default="market,social,news,fundamentals")
    parser.add_argument("--debate-rounds", type=int, default=int(os.getenv("TRADINGAGENTS_MAX_DEBATE_ROUNDS", "1")))
    parser.add_argument("--risk-rounds", type=int, default=int(os.getenv("TRADINGAGENTS_MAX_RISK_ROUNDS", "1")))
    parser.add_argument("--tool-rounds", type=int, default=int(os.getenv("TRADINGAGENTS_MAX_TOOL_ROUNDS", "12")))
    parser.add_argument("--out", required=True, help="path for the final JSON payload")
    args = parser.parse_args()

    selected = [a.strip() for a in args.analysts.split(",") if a.strip()]
    ticker = args.ticker.strip().upper()
    if not ticker.endswith((".NS", ".BO")) and "|" not in ticker and "=" not in ticker:
        ticker = f"{ticker}.NS"

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    report_dir = out_path.parent / "report"

    emit({
        "type": "started",
        "ticker": ticker,
        "date": args.date,
        "pipeline": PIPELINE,
        "models": {
            "deep": os.getenv("TRADINGAGENTS_DEEP_THINK_LLM", "high-availability"),
            "quick": os.getenv("TRADINGAGENTS_QUICK_THINK_LLM", "high-availability"),
        },
        "vendors": build_config(args)["data_vendors"],
    })

    graph = TradingAgentsGraph(selected_analysts=selected, debug=False, config=build_config(args))
    init_state = graph.create_run_state(ticker, args.date)
    args_ = graph.propagator.get_graph_args()

    final_state: dict = {}
    seen: dict[str, str] = {}

    def report_progress(state: dict) -> None:
        for key, label in ANALYST_LABELS.items():
            if state.get(key) and seen.get(key) != state[key]:
                seen[key] = state[key]
                emit({"type": "report", "agent": label, "key": key, "content": state[key]})
                emit({"type": "status", "agent": label, "status": "done"})

        debate = state.get("investment_debate_state") or {}
        for key, label in (("bull_history", "Bull Researcher"), ("bear_history", "Bear Researcher")):
            if debate.get(key) and seen.get(key) != debate[key]:
                seen[key] = debate[key]
                emit({"type": "report", "agent": label, "key": key, "content": debate[key]})

        for key, label in (
            ("investment_plan", "Research Manager"),
            ("trader_investment_plan", "Trader"),
            ("final_trade_decision", "Portfolio Manager"),
        ):
            if state.get(key) and seen.get(key) != state[key]:
                seen[key] = state[key]
                emit({"type": "report", "agent": label, "key": key, "content": state[key]})
                emit({"type": "status", "agent": label, "status": "done"})

        risk = state.get("risk_debate_state") or {}
        for key, label in (
            ("aggressive_history", "Aggressive Analyst"),
            ("conservative_history", "Conservative Analyst"),
            ("neutral_history", "Neutral Analyst"),
        ):
            if risk.get(key) and seen.get(key) != risk[key]:
                seen[key] = risk[key]
                emit({"type": "report", "agent": label, "key": key, "content": risk[key]})

    try:
        for messages, state in graph.stream_run(init_state, **args_):
            for message in messages:
                content = getattr(message, "content", None)
                if not content or not isinstance(content, str):
                    continue
                name = getattr(message, "name", None) or type(message).__name__
                emit({"type": "message", "agent": name, "content": content[:4000]})
            if state:
                final_state.update(state)
                report_progress(final_state)
    except Exception as exc:  # surfaced to the UI with the traceback tail
        traceback.print_exc()
        emit({"type": "error", "message": str(exc), "detail": traceback.format_exc()[-2000:]})
        return 1

    rating = run_rating(final_state)
    graph.record_decision(ticker, args.date, final_state)

    report_paths: dict[str, str] = {}
    try:
        graph.save_reports(final_state, ticker, save_path=report_dir)
        html = report_dir / "complete_report.html"
        markdown = report_dir / "complete_report.md"
        if html.exists():
            report_paths["html"] = str(html)
        if markdown.exists():
            report_paths["markdown"] = str(markdown)
    except Exception as exc:  # a report write must not lose the analysis
        emit({"type": "warning", "message": f"report files not written: {exc}"})

    payload = {
        "type": "final",
        "ticker": ticker,
        "date": args.date,
        "rating": rating,
        "settings": _clean(graph.run_settings()),
        "reports": {
            "market": final_state.get("market_report"),
            "sentiment": final_state.get("sentiment_report"),
            "news": final_state.get("news_report"),
            "fundamentals": final_state.get("fundamentals_report"),
        },
        "research_debate": _clean(final_state.get("investment_debate_state")),
        "investment_plan": final_state.get("investment_plan"),
        "trader_plan": final_state.get("trader_investment_plan"),
        "risk_debate": _clean(final_state.get("risk_debate_state")),
        "final_decision": final_state.get("final_trade_decision"),
        "report_paths": report_paths,
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "analysts": selected,
    }
    out_path.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    emit({"type": "saved", "path": str(out_path)})
    emit(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
