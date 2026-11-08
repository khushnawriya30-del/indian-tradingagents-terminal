"""Indian terminal HTTP API, run in mock-feed mode against a pinned clock."""

from __future__ import annotations

import time
from datetime import datetime
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient

from indian_terminal import server
from tradingagents.dataflows.vendors.india import nse_calendar as cal, upstox
from tradingagents.dataflows.vendors.india.instruments import set_master
from tradingagents.default_config import india_config

IST = cal.IST
MONDAY_LIVE = datetime(2026, 11, 9, 10, 0, tzinfo=IST)
SUNDAY = datetime(2026, 11, 8, 12, 0, tzinfo=IST)
RELIANCE = "NSE_EQ|INE002A01018"


class FakeGraph:
    """Stands in for TradingAgentsGraph: same surface the analysis runner drives."""

    def __init__(self, fail: bool = False):
        self.config = india_config()
        self.propagator = SimpleNamespace(get_graph_args=lambda: {})
        self.fail = fail

    def create_run_state(self, ticker, trade_date, asset_type, portfolio):
        return {"company_of_interest": ticker, "trade_date": trade_date}

    def checkpoint_input(self, state):
        return state

    def stream_run(self, graph_input, **args):
        if self.fail:
            raise ConnectionError("LLM endpoint unreachable")
        yield [], {"market_report": "Market looks constructive."}
        yield [], {"sentiment_report": "Sentiment neutral.", "news_report": "News fine.", "fundamentals_report": "P/E 24."}
        yield [], {"investment_debate_state": {"bull_history": "Bull Analyst: growth.\nBull Analyst: margins.",
                                               "bear_history": "Bear Analyst: valuation.", "count": 2},
                   "investment_plan": "Research plan: Buy"}
        yield [], {"trader_investment_plan": "Trader: buy on dips"}
        yield [], {"risk_debate_state": {"aggressive_history": "Aggressive Analyst: size up",
                                         "conservative_history": "Conservative Analyst: trim",
                                         "neutral_history": "Neutral Analyst: hold", "count": 3},
                   "final_trade_decision": "**Rating**: Overweight\n\nAccumulate. <script>alert(1)</script>"}

    def record_decision(self, *a):
        pass

    def run_settings(self):
        return {}


def make_client(tmp_path, monkeypatch, now, graph=None):
    monkeypatch.setattr(cal, "now_ist", lambda: now)
    app = server.create_app(mock=True, data_dir=tmp_path, start_feed=False,
                            graph_factory=lambda analysts, cfg: graph or FakeGraph())
    return TestClient(app)


@pytest.fixture
def live(tmp_path, monkeypatch):
    c = make_client(tmp_path, monkeypatch, MONDAY_LIVE)
    yield c
    set_master(None)
    upstox.set_client(None)


@pytest.fixture
def closed(tmp_path, monkeypatch):
    c = make_client(tmp_path, monkeypatch, SUNDAY)
    yield c
    set_master(None)
    upstox.set_client(None)


def order(client, **kw):
    body = {"key": RELIANCE, "side": "BUY", "qty": 10, "order_type": "MARKET", "product": "MIS"}
    body.update(kw)
    return client.post("/api/orders", json=body)


# ------------------------------------------------------------------- basics
def test_status_reports_market_and_mock_feed(live):
    r = live.get("/api/status").json()
    assert r["market"]["state"] == "OPEN" and r["market"]["is_live"] is True
    assert r["feed"]["mode"] == "mock" and r["paper"]["initial_balance"] == 1_000_000


def test_index_page_and_static_assets(live):
    page = live.get("/")
    assert page.status_code == 200 and "Indian TradingAgents Terminal" in page.text
    assert live.get("/static/app.js").status_code == 200
    assert live.get("/static/vendor/lightweight-charts.standalone.production.js").status_code == 200
    assert live.get("/api/status").headers["cache-control"] == "no-store"


def test_search_finds_equities_indices(live):
    names = {r["symbol"] for r in live.get("/api/search", params={"q": "rel"}).json()["results"]}
    assert "RELIANCE" in names
    assert any(r["kind"] == "INDEX" for r in live.get("/api/search", params={"q": "nifty"}).json()["results"])
    assert live.get("/api/search", params={"q": ""}).status_code == 422


def test_instrument_lookup_keeps_suffix(live):
    r = live.get("/api/instrument", params={"ticker": "RELIANCE.BO"}).json()
    assert r["exchange"] == "BSE" and r["ticker"] == "RELIANCE.BO"
    assert live.get("/api/instrument", params={"ticker": "NOSUCH.NS"}).status_code == 404


# ------------------------------------------------------------------- quotes
def test_live_quote_has_depth_and_is_not_frozen(live):
    q = live.get("/api/quotes", params={"keys": RELIANCE}).json()["quotes"][RELIANCE]
    assert q["frozen"] is False and q["bids"] and q["asks"]


def test_closed_market_freezes_quote_without_depth_and_never_drifts(closed):
    first = closed.get("/api/quotes", params={"keys": RELIANCE}).json()["quotes"][RELIANCE]
    time.sleep(0.05)
    second = closed.get("/api/quotes", params={"keys": RELIANCE}).json()["quotes"][RELIANCE]
    assert first["frozen"] and first["price_date"] == "2026-11-06"
    assert first["bids"] == [] and first["asks"] == []
    assert first["ltp"] == second["ltp"]


def test_quote_key_limits(live):
    assert live.get("/api/quotes", params={"keys": ""}).status_code == 400
    assert live.get("/api/quotes", params={"keys": ",".join(f"k{i}" for i in range(101))}).status_code == 400


def test_candles_daily_vs_intraday_time_formats(live):
    daily = live.get("/api/candles", params={"key": RELIANCE, "tf": "1D"}).json()["candles"]
    intra = live.get("/api/candles", params={"key": RELIANCE, "tf": "5m"}).json()["candles"]
    assert isinstance(daily[-1]["time"], str) and len(daily[-1]["time"]) == 10
    assert isinstance(intra[0]["time"], int)
    assert live.get("/api/candles", params={"key": RELIANCE, "tf": "7y"}).status_code == 400


# -------------------------------------------------------------- option chain
def test_option_chain_with_greeks_and_lot_size(live):
    exp = live.get("/api/expiries", params={"underlying": "NIFTY"}).json()
    assert exp["expiries"] and exp["lot_size"] == 75
    chain = live.get("/api/optionchain", params={"underlying": "NIFTY", "expiry": exp["expiries"][0]}).json()
    atm = next(r for r in chain["rows"] if r["strike"] == chain["atm"])
    for leg in (atm["call"], atm["put"]):
        assert all(leg[g] is not None for g in ("delta", "gamma", "theta", "vega", "iv")) and leg["oi"]
    assert atm["call"]["delta"] > 0 > atm["put"]["delta"]
    assert atm["call"]["lot_size"] == 75 and chain["pcr"]


def test_option_chain_validates_expiry(live):
    assert live.get("/api/optionchain", params={"underlying": "NIFTY", "expiry": "tomorrow"}).status_code == 422


def test_option_order_uses_server_side_lot_size(live):
    exp = live.get("/api/expiries", params={"underlying": "NIFTY"}).json()["expiries"][0]
    chain = live.get("/api/optionchain", params={"underlying": "NIFTY", "expiry": exp}).json()
    atm = next(r for r in chain["rows"] if r["strike"] == chain["atm"])
    key = atm["call"]["key"]
    bad = live.post("/api/orders", json={"key": key, "side": "BUY", "qty": 80, "product": "NRML"})
    assert bad.status_code == 400 and "lot size" in bad.json()["detail"]["message"]
    good = live.post("/api/orders", json={"key": key, "side": "BUY", "qty": 75, "product": "NRML"})
    assert good.status_code == 200 and good.json()["order"]["status"] == "COMPLETE"


# ------------------------------------------------------------ paper trading
def test_live_market_order_fills_and_updates_portfolio(live):
    r = order(live)
    assert r.status_code == 200 and r.json()["order"]["status"] == "COMPLETE"
    pf = live.get("/api/portfolio").json()
    assert pf["positions"][0]["qty"] == 10 and pf["trades"][0]["side"] == "BUY"
    assert pf["funds"]["margin_used"] > 0 and pf["funds"]["available"] < 1_000_000


def test_exit_round_trip_flat(live):
    order(live)
    r = order(live, side="SELL")
    assert r.json()["order"]["status"] == "COMPLETE"
    pf = live.get("/api/portfolio").json()
    assert pf["funds"]["margin_used"] == 0 and pf["funds"]["charges_paid"] > 0
    assert pf["funds"]["total_pnl"] < 0   # spread + charges on a flat round trip


def test_closed_market_order_becomes_amo_then_cancel(closed):
    o = order(closed, product="CNC").json()["order"]
    assert o["status"] == "AMO"
    c = closed.delete(f"/api/orders/{o['id']}")
    assert c.status_code == 200 and c.json()["order"]["status"] == "CANCELLED"
    assert closed.delete(f"/api/orders/{o['id']}").status_code == 400


def test_rejections_use_400_with_message(live):
    r = order(live, qty=10_000_000, product="CNC")
    assert r.status_code == 400 and "Insufficient funds" in r.json()["detail"]["message"]
    assert order(live, side="SELL", product="CNC").status_code == 400
    assert order(live, key="NSE_EQ|NOPE").status_code == 404
    assert live.post("/api/orders", json={"key": RELIANCE, "side": "BUY", "qty": -1}).status_code == 422


def test_index_orders_are_rejected(live):
    r = live.post("/api/orders", json={"key": "NSE_INDEX|Nifty 50", "side": "BUY", "qty": 1})
    assert r.status_code == 400 and "Indices" in r.json()["detail"]["message"]


def test_reset_account(live):
    order(live)
    pf = live.post("/api/account/reset", json={"initial_balance": 250000}).json()
    assert pf["funds"]["cash"] == 250000 and pf["positions"] == [] and pf["orders"] == []
    assert live.post("/api/account/reset", json={"initial_balance": -5}).status_code == 422


def test_state_survives_restart(tmp_path, monkeypatch):
    c1 = make_client(tmp_path, monkeypatch, MONDAY_LIVE)
    order(c1, product="CNC")
    c2 = make_client(tmp_path, monkeypatch, MONDAY_LIVE)
    assert c2.get("/api/portfolio").json()["holdings"][0]["qty"] == 10
    set_master(None)
    upstox.set_client(None)


# --------------------------------------------------------------- watchlists
def test_watchlist_default_and_roundtrip(live):
    lists = live.get("/api/watchlists").json()["lists"]
    assert "NIFTY 50" in [i["symbol"] for i in lists["Watchlist 1"]]
    r = live.put("/api/watchlists", json={"lists": {"Banks": ["HDFCBANK.NS", "SBIN.NS", "NOSUCH.NS"]}})
    assert [i["symbol"] for i in r.json()["lists"]["Banks"]] == ["HDFCBANK", "SBIN"]
    assert list(live.get("/api/watchlists").json()["lists"]) == ["Banks"]
    assert live.put("/api/watchlists", json={"lists": {"x": ["A"] * 101}}).status_code == 400


def test_index_display_names_round_trip_through_watchlists(live):
    r = live.put("/api/watchlists", json={"lists": {"Idx": ["NIFTY 50", "NIFTY BANK", "NIFTY FIN SERVICE", "SENSEX"]}})
    assert len(r.json()["lists"]["Idx"]) == 4


# ---------------------------------------------------------------- AI analysis
def wait_job(client, job_id, timeout=10):
    end = time.time() + timeout
    while time.time() < end:
        job = client.get(f"/api/analysis/{job_id}").json()
        if job["status"] in ("done", "error"):
            return job
        time.sleep(0.05)
    raise AssertionError("analysis did not finish")


def test_analysis_runs_all_stages_and_serves_report(live):
    job = live.post("/api/analysis", json={"ticker": "RELIANCE.NS"}).json()
    assert job["trade_date"] == "2026-11-09" and job["status"] in ("queued", "running", "done")
    done = wait_job(live, job["id"])
    assert done["status"] == "done" and done["rating"] == "Overweight" and done["report_ready"]
    assert all(s["status"] == "done" for s in done["stages"]) and len(done["stages"]) == 9
    res = done["result"]
    assert res["debate"]["bull"] == ["Bull Analyst: growth.", "Bull Analyst: margins."]
    assert res["debate"]["bear"] == ["Bear Analyst: valuation."] and res["risk"]["conservative"]
    assert res["reports"]["fundamentals"] == "P/E 24."

    rep = live.get(f"/api/analysis/{job['id']}/report.html")
    assert rep.status_code == 200 and "attachment" in rep.headers["content-disposition"]
    assert "RELIANCE.NS_2026-11-09_report.html" in rep.headers["content-disposition"]
    html = rep.text
    for needle in ("screener.in/company/RELIANCE/consolidated", "nseindia.com/get-quotes/equity?symbol=RELIANCE",
                   "moneycontrol.com", "tradingview.com/symbols/NSE-RELIANCE", "Overweight", "Audit links"):
        assert needle in html, needle
    assert "<script>alert(1)</script>" not in html            # agent output is never injected as markup


def test_analysis_on_weekend_uses_last_session(closed):
    job = closed.post("/api/analysis", json={"ticker": "TCS.NS"}).json()
    assert job["trade_date"] == "2026-11-06"
    wait_job(closed, job["id"])


def test_analysis_failure_is_reported_not_raised(tmp_path, monkeypatch):
    c = make_client(tmp_path, monkeypatch, MONDAY_LIVE, graph=FakeGraph(fail=True))
    job = c.post("/api/analysis", json={"ticker": "INFY.NS"}).json()
    done = wait_job(c, job["id"])
    assert done["status"] == "error" and "unreachable" in done["error"] and not done["report_ready"]
    assert c.get(f"/api/analysis/{job['id']}/report.html").status_code == 404
    set_master(None)
    upstox.set_client(None)


def test_analysis_input_validation(live):
    assert live.post("/api/analysis", json={"ticker": "../../etc/passwd"}).status_code == 400
    assert live.post("/api/analysis", json={"ticker": ""}).status_code == 422
    assert live.get("/api/analysis/nope").status_code == 404


# --------------------------------------------------------------------- OAuth
def test_oauth_requires_configuration(live, monkeypatch):
    for name in ("UPSTOX_API_KEY", "UPSTOX_API_SECRET", "UPSTOX_REDIRECT_URI"):
        monkeypatch.delenv(name, raising=False)
    assert live.get("/api/oauth/login", follow_redirects=False).status_code == 400


def test_oauth_flow_exchanges_code_and_stores_token(live, monkeypatch, tmp_path):
    monkeypatch.setenv("UPSTOX_API_KEY", "key-123")
    monkeypatch.setenv("UPSTOX_API_SECRET", "shh")
    monkeypatch.setenv("UPSTOX_REDIRECT_URI", "http://localhost:3000/api/oauth/callback")
    monkeypatch.setenv("UPSTOX_ACCESS_TOKEN", "old")
    r = live.get("/api/oauth/login", follow_redirects=False)
    assert r.status_code in (302, 307)
    url = urlparse(r.headers["location"])
    q = parse_qs(url.query)
    assert url.netloc == "api.upstox.com" and q["client_id"] == ["key-123"] and q["response_type"] == ["code"]
    assert live.get("/api/oauth/callback", params={"code": "abc", "state": "forged"}).status_code == 400

    posted = {}

    class Resp:
        status_code = 200

        def json(self):
            return {"access_token": "fresh-token"}

    def fake_post(url, data=None, headers=None, timeout=None):
        posted.update(url=url, data=data)
        return Resp()

    monkeypatch.setattr(server.requests, "post", fake_post)
    cb = live.get("/api/oauth/callback", params={"code": "abc", "state": q["state"][0]})
    assert cb.status_code == 200 and "Upstox connected" in cb.text
    assert posted["url"].endswith("/v2/login/authorization/token")
    assert posted["data"]["code"] == "abc" and posted["data"]["grant_type"] == "authorization_code"
    import os
    assert os.environ["UPSTOX_ACCESS_TOKEN"] == "fresh-token"
    # a state is single-use
    assert live.get("/api/oauth/callback", params={"code": "abc", "state": q["state"][0]}).status_code == 400
    saved = list(tmp_path.glob("upstox_token.json"))
    assert saved and (saved[0].stat().st_mode & 0o077) == 0           # owner-only file


def test_status_never_leaks_tokens(live, monkeypatch):
    monkeypatch.setenv("UPSTOX_ANALYTICS_TOKEN", "SUPER-SECRET-TOKEN")
    monkeypatch.setenv("UPSTOX_API_SECRET", "SUPER-SECRET-KEY")
    body = live.get("/api/status").text
    assert "SUPER-SECRET" not in body
