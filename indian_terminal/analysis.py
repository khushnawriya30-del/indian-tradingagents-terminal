"""Runs the full TradingAgents pipeline on an Indian stock and reports progress.

The pipeline is the unmodified upstream graph (market, sentiment, news and fundamentals
analysts, bull/bear researchers, research manager, trader, three risk analysts and the
portfolio manager). This module only drives it from a worker thread, turns its streamed
state into stage progress for the UI, and keeps the finished report.
"""

from __future__ import annotations

import logging
import re
import threading
import traceback
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

from tradingagents.dataflows.vendors.india import nse_calendar

from . import report

logger = logging.getLogger(__name__)

STAGES = [
    ("market", "Market Analyst"),
    ("sentiment", "Sentiment Analyst"),
    ("news", "News Analyst"),
    ("fundamentals", "Fundamentals Analyst"),
    ("debate", "Bull vs Bear Researchers"),
    ("research_manager", "Research Manager"),
    ("trader", "Trader"),
    ("risk", "Risk Analysts (aggressive / neutral / conservative)"),
    ("portfolio", "Portfolio Manager"),
]
_ANALYST_KEYS = {"market": "market_report", "sentiment": "sentiment_report",
                 "news": "news_report", "fundamentals": "fundamentals_report"}
MAX_JOBS = 40


def analysis_date(now: datetime | None = None) -> str:
    """Trade date for a run: today on a trading day, else the last session."""
    now = now or nse_calendar.now_ist()
    day = nse_calendar.on_or_before_trading_day(now.date())
    return day.isoformat()


def _stage_status(final: dict) -> dict[str, str]:
    """Stage -> pending | running | done, inferred from which state fields are filled.

    The graph streams state, not stage names, so a stage counts as done when its output
    exists. Analysts run in parallel (all unfinished ones show running); after that the
    pipeline is sequential, and the debate / risk stages stay "running" until the research
    plan / final decision lands (their per-round output is shown in the debate panels).
    """
    done = {key: bool(final.get(field)) for key, field in _ANALYST_KEYS.items()}
    plan = bool(final.get("investment_plan"))
    done.update(debate=plan, research_manager=plan,
                trader=bool(final.get("trader_investment_plan")),
                risk=bool(final.get("final_trade_decision")), portfolio=bool(final.get("final_trade_decision")))
    status = {key: "done" if done[key] else "pending" for key, _ in STAGES}
    started = bool(final)
    for key in _ANALYST_KEYS:
        if not done[key] and started:
            status[key] = "running"
    if all(done[k] for k in _ANALYST_KEYS):
        for key in ("debate", "trader", "risk"):     # first unfinished sequential stage
            if not done[key]:
                status[key] = "running"
                break
    return status


def _split_turns(history: str) -> list[str]:
    """Debate histories are 'Bull Analyst: ...\\nBull Analyst: ...' blobs; one entry per turn."""
    if not history:
        return []
    parts = re.split(r"\n(?=(?:Bull|Bear|Aggressive|Conservative|Neutral)[^\n:]{0,25}:)", history.strip())
    return [p.strip() for p in parts if p.strip()]


def _summary(final: dict) -> dict:
    inv = final.get("investment_debate_state") or {}
    risk = final.get("risk_debate_state") or {}
    return {
        "reports": {k: final.get(f) or "" for k, f in _ANALYST_KEYS.items()},
        "debate": {
            "bull": _split_turns(inv.get("bull_history", "")),
            "bear": _split_turns(inv.get("bear_history", "")),
            "rounds": inv.get("count", 0),
            "research_plan": final.get("investment_plan") or "",
        },
        "trader_plan": final.get("trader_investment_plan") or "",
        "risk": {
            "aggressive": _split_turns(risk.get("aggressive_history", "")),
            "conservative": _split_turns(risk.get("conservative_history", "")),
            "neutral": _split_turns(risk.get("neutral_history", "")),
            "rounds": risk.get("count", 0),
        },
        "decision": final.get("final_trade_decision") or "",
    }


def default_graph_factory(analysts, config):
    from tradingagents.graph.trading_graph import TradingAgentsGraph

    return TradingAgentsGraph(selected_analysts=analysts, debug=False, config=config)


class AnalysisManager:
    def __init__(self, config_factory: Callable[[], dict], graph_factory: Callable = default_graph_factory,
                 max_workers: int = 2, output_dir: str | Path | None = None):
        self._config_factory = config_factory
        self._graph_factory = graph_factory
        self._pool = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="analysis")
        self._jobs: dict[str, dict] = {}
        self._html: dict[str, str] = {}
        self._lock = threading.Lock()
        self._output_dir = Path(output_dir) if output_dir else None

    def start(self, ticker: str, analysts: tuple[str, ...] = ("market", "social", "news", "fundamentals")) -> dict:
        ticker = ticker.strip().upper()
        if not re.fullmatch(r"[A-Z0-9&\-\.\^ ]{1,30}", ticker):
            raise ValueError("Invalid ticker")
        job = {
            "id": uuid.uuid4().hex[:10], "ticker": ticker, "trade_date": analysis_date(),
            "status": "queued", "started": nse_calendar.now_ist().isoformat(timespec="seconds"),
            "finished": None, "rating": None, "error": None, "report_ready": False,
            "stages": [{"id": k, "label": v, "status": "pending"} for k, v in STAGES],
            "result": _summary({}),
        }
        with self._lock:
            self._jobs[job["id"]] = job
            for old in list(self._jobs)[:-MAX_JOBS]:
                self._jobs.pop(old, None)
                self._html.pop(old, None)
        self._pool.submit(self._run, job["id"], analysts)
        return self.get(job["id"])

    def get(self, job_id: str) -> dict | None:
        with self._lock:
            job = self._jobs.get(job_id)
            return dict(job) if job else None

    def report_html(self, job_id: str) -> str | None:
        with self._lock:
            return self._html.get(job_id)

    # ------------------------------------------------------------------ worker
    def _update(self, job_id: str, **fields) -> None:
        with self._lock:
            self._jobs[job_id].update(fields)

    def _run(self, job_id: str, analysts) -> None:
        job = self.get(job_id)
        ticker, trade_date = job["ticker"], job["trade_date"]
        self._update(job_id, status="running")
        try:
            from tradingagents.agents.rating import run_rating
            from tradingagents.dataflows.config import run_config

            config = self._config_factory()
            graph = self._graph_factory(analysts, config)
            final: dict = {}
            with run_config(graph.config):
                init = graph.create_run_state(ticker, trade_date, "stock", None)
                args = graph.propagator.get_graph_args()
                for _messages, state in graph.stream_run(graph.checkpoint_input(init), **args):
                    if state:
                        final.update(state)
                        stages = _stage_status(final)
                        self._update(job_id, result=_summary(final), stages=[
                            {"id": k, "label": v, "status": stages[k]} for k, v in STAGES])
                graph.record_decision(ticker, trade_date, final)
            rating = run_rating(final)
            html = report.render_html(ticker, final, graph.run_settings())
            self._store_report(job_id, ticker, trade_date, html)
            with self._lock:
                self._html[job_id] = html
            self._update(job_id, status="done", rating=str(rating), report_ready=True,
                         result=_summary(final), finished=nse_calendar.now_ist().isoformat(timespec="seconds"),
                         stages=[{"id": k, "label": v, "status": "done"} for k, v in STAGES])
        except Exception as exc:
            logger.error("analysis %s failed:\n%s", job_id, traceback.format_exc())
            self._update(job_id, status="error", error=f"{type(exc).__name__}: {exc}"[:500],
                         finished=nse_calendar.now_ist().isoformat(timespec="seconds"))

    def _store_report(self, job_id: str, ticker: str, trade_date: str, html: str) -> None:
        if not self._output_dir:
            return
        try:
            self._output_dir.mkdir(parents=True, exist_ok=True)
            safe = re.sub(r"[^A-Za-z0-9_.-]", "_", ticker)
            (self._output_dir / f"{safe}_{trade_date}_{job_id}.html").write_text(html, encoding="utf-8")
        except OSError:
            logger.warning("could not save report to %s", self._output_dir)
