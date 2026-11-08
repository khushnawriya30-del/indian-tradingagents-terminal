"""FastAPI backend for the Indian paper-trading terminal.

Serves the single-page UI and a JSON/SSE API. Binds to localhost by default: it holds
broker tokens and a trading ledger and has no login of its own.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import secrets
import time
from contextlib import asynccontextmanager
from pathlib import Path

import requests
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import (
    HTMLResponse,
    JSONResponse,
    RedirectResponse,
    Response,
    StreamingResponse,
)
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from tradingagents.dataflows.errors import (
    NoMarketDataError,
    VendorError,
    VendorNotConfiguredError,
    VendorUnavailableError,
)
from tradingagents.dataflows.vendors.india import nse_calendar, upstox
from tradingagents.dataflows.vendors.india.instruments import (
    INDEX_KEYS,
    InstrumentMaster,
    get_master,
    set_master,
)
from tradingagents.default_config import india_config

from . import mock_feed, options
from .analysis import AnalysisManager
from .paper import OrderRejected, PaperAccount
from .quotes import QuoteService

logger = logging.getLogger(__name__)

STATIC_DIR = Path(__file__).parent / "static"
DEFAULT_WATCHLIST = ["NIFTY", "BANKNIFTY", "SENSEX", "RELIANCE.NS", "TCS.NS", "HDFCBANK.NS",
                     "INFY.NS", "ICICIBANK.NS", "SBIN.NS", "ITC.NS"]
UPSTOX_AUTH_URL = "https://api.upstox.com/v2/login/authorization/dialog"
UPSTOX_TOKEN_URL = "https://api.upstox.com/v2/login/authorization/token"
TOKEN_MAX_AGE = 20 * 3600
MAX_KEYS = 100


class OrderIn(BaseModel):
    key: str = Field(min_length=3, max_length=80)
    side: str
    qty: int = Field(gt=0, le=10_000_000)
    order_type: str = "MARKET"
    product: str = "MIS"
    price: float | None = Field(default=None, ge=0)
    trigger_price: float | None = Field(default=None, ge=0)


class ResetIn(BaseModel):
    initial_balance: float | None = Field(default=None, gt=0, le=1e12)


class AnalysisIn(BaseModel):
    ticker: str = Field(min_length=1, max_length=30)


class WatchlistsIn(BaseModel):
    lists: dict[str, list[str]]


def _client_error(exc: Exception) -> HTTPException:
    if isinstance(exc, VendorNotConfiguredError):
        return HTTPException(503, {"code": "not_configured", "message": str(exc)})
    if isinstance(exc, VendorUnavailableError):
        return HTTPException(503, {"code": "unavailable", "message": str(exc)})
    if isinstance(exc, NoMarketDataError):
        return HTTPException(404, {"code": "no_data", "message": str(exc)})
    return HTTPException(500, {"code": "error", "message": f"{type(exc).__name__}"})


def create_app(mock: bool | None = None, data_dir: str | os.PathLike | None = None,
               client=None, master: InstrumentMaster | None = None, graph_factory=None,
               start_feed: bool = True) -> FastAPI:
    mock = bool(int(os.environ.get("TERMINAL_MOCK", "0"))) if mock is None else mock
    data = Path(data_dir or os.environ.get("TERMINAL_DATA_DIR") or Path.home() / ".tradingagents" / "terminal")
    data.mkdir(parents=True, exist_ok=True)

    if mock:
        master = master or mock_feed.build_master()
        client = client or mock_feed.MockClient(master)
    else:
        master = master or get_master()
        client = client or upstox.get_client()
    set_master(master)
    upstox.set_client(client)

    account = PaperAccount(path=data / "paper_state.json")
    quotes = QuoteService(client, extra_keys=account.open_keys,
                          on_quotes=lambda snap, status: account.on_quotes(snap, status))
    analysis_kwargs = {"graph_factory": graph_factory} if graph_factory else {}
    analysis = AnalysisManager(india_config, output_dir=data / "reports", **analysis_kwargs)
    oauth_states: dict[str, float] = {}

    _restore_saved_token(data)

    @asynccontextmanager
    async def lifespan(_app):
        if start_feed:
            quotes.start()
        yield
        quotes.stop()

    app = FastAPI(title="Indian TradingAgents Terminal", lifespan=lifespan)
    app.state.account, app.state.quotes, app.state.analysis, app.state.master = account, quotes, analysis, master

    @app.middleware("http")
    async def no_store(request: Request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.exception_handler(OrderRejected)
    async def _rejected(_request, exc: OrderRejected):
        return JSONResponse({"detail": {"code": "rejected", "message": str(exc)}}, status_code=400)

    @app.exception_handler(VendorError)
    async def _vendor(_request, exc: VendorError):
        err = _client_error(exc)
        return JSONResponse({"detail": err.detail}, status_code=err.status_code)

    # ------------------------------------------------------------------ status
    @app.get("/api/status")
    def status():
        st = nse_calendar.market_status()
        return {
            "market": st.as_dict(),
            "feed": {
                "mode": "mock" if mock else "upstox",
                "tokens_configured": bool(upstox.configured_tokens()) or mock,
                "last_error": quotes.last_error,
                "last_ok_age_s": round(time.time() - quotes.last_ok, 1) if quotes.last_ok else None,
                "oauth_available": bool(os.environ.get("UPSTOX_API_KEY") and os.environ.get("UPSTOX_API_SECRET")),
            },
            "paper": {"initial_balance": account.initial_balance},
        }

    # ------------------------------------------------------------------ search
    @app.get("/api/search")
    def search(q: str = Query(min_length=1, max_length=40), limit: int = Query(15, ge=1, le=50)):
        return {"results": [i.as_dict() for i in master.search(q, limit)]}

    @app.get("/api/instrument")
    def instrument(ticker: str = Query(min_length=1, max_length=60)):
        return master.resolve(ticker).as_dict()

    # ------------------------------------------------------------------ quotes
    def _keys(raw: str) -> list[str]:
        keys = [k.strip() for k in raw.split(",") if k.strip()]
        if not keys or len(keys) > MAX_KEYS:
            raise HTTPException(400, {"code": "bad_request", "message": f"1-{MAX_KEYS} instrument keys required"})
        return keys

    @app.get("/api/quotes")
    def get_quotes(keys: str):
        wanted = _keys(keys)
        have = quotes.snapshot(wanted)
        if len(have) < len(wanted):
            quotes.fetch_now(wanted)
        quotes.subscribe(wanted)
        return {"market": nse_calendar.market_status().as_dict(), "quotes": quotes.snapshot(wanted)}

    @app.get("/api/candles")
    def candles(key: str = Query(min_length=3, max_length=80), tf: str = "1D"):
        if tf not in upstox.TIMEFRAMES:
            raise HTTPException(400, {"code": "bad_request", "message": f"tf must be one of {list(upstox.TIMEFRAMES)}"})
        frame = client.candles(key, tf)
        daily = tf in ("1D", "1W")
        out = []
        for row in frame.itertuples():
            if daily:
                t = row.time.strftime("%Y-%m-%d")
            else:  # lightweight-charts shows UTC; shift the IST wall-clock so the axis reads IST
                t = int(row.time.tz_localize("UTC").timestamp())
            out.append({"time": t, "open": row.open, "high": row.high, "low": row.low, "close": row.close,
                        "volume": row.volume})
        return {"key": key, "tf": tf, "candles": out, "market": nse_calendar.market_status().as_dict()}

    # ----------------------------------------------------------- live stream
    @app.get("/api/stream")
    async def stream(request: Request, keys: str = ""):
        wanted = [k.strip() for k in keys.split(",") if k.strip()][:MAX_KEYS]
        quotes.subscribe(wanted)

        async def events():
            last_version, last_portfolio, last_status = -1, 0.0, 0.0
            while not await request.is_disconnected():
                quotes.subscribe(wanted)
                now = time.time()
                if quotes.version != last_version:
                    last_version = quotes.version
                    yield _sse("quotes", quotes.snapshot(wanted))
                if now - last_portfolio >= 1.0:
                    last_portfolio = now
                    yield _sse("portfolio", account.snapshot(quotes.snapshot()))
                if now - last_status >= 5.0:
                    last_status = now
                    yield _sse("status", nse_calendar.market_status().as_dict())
                await asyncio.sleep(0.4)

        return StreamingResponse(events(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    # ------------------------------------------------------------ option chain
    def _underlying_key(underlying: str) -> str:
        compact = underlying.upper().replace(" ", "")
        if compact in INDEX_KEYS and compact.lstrip("^") in options_underlyings():
            return INDEX_KEYS[compact][0]
        inst = master.resolve(underlying if "." in underlying else f"{underlying}.NS")
        return inst.key

    def options_underlyings() -> set[str]:
        return {"NIFTY", "NIFTY50", "BANKNIFTY", "NIFTYBANK", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "BANKEX"}

    @app.get("/api/expiries")
    def expiries(underlying: str = Query(min_length=1, max_length=30)):
        name = {"NIFTY50": "NIFTY", "NIFTYBANK": "BANKNIFTY"}.get(underlying.upper().replace(" ", ""),
                                                                   underlying.upper().split(".")[0])
        return {"underlying": name, "expiries": master.expiries(name), "lot_size": master.lot_size(name)}

    @app.get("/api/optionchain")
    def option_chain(underlying: str = Query(min_length=1, max_length=30), expiry: str = Query(pattern=r"^\d{4}-\d{2}-\d{2}$")):
        key = _underlying_key(underlying)
        rows = client.option_chain(key, expiry)
        name = underlying.upper().split(".")[0]
        spot = None
        try:
            spot = (quotes.snapshot([key]).get(key) or quotes.fetch_now([key]).get(key) or {}).get("ltp")
        except VendorError:
            pass
        chain = options.enrich_chain(rows, expiry, spot)
        lot = master.lot_size({"NIFTY50": "NIFTY"}.get(name, name))
        for row in chain["rows"]:
            for side in ("call", "put"):
                inst = master.by_key.get(row[side].get("key") or "")
                row[side]["symbol"] = inst.symbol if inst else None
                row[side]["lot_size"] = inst.lot_size if inst else lot
        chain.update(underlying=name, underlying_key=key, lot_size=lot,
                     market=nse_calendar.market_status().as_dict())
        return chain

    # ---------------------------------------------------------- paper trading
    @app.get("/api/portfolio")
    def portfolio():
        return account.snapshot(quotes.snapshot())

    @app.post("/api/orders")
    def place_order(body: OrderIn):
        inst = master.by_key.get(body.key)
        if inst is None:
            raise HTTPException(404, {"code": "no_data", "message": "Unknown instrument key"})
        quote = quotes.snapshot([body.key]).get(body.key) or quotes.fetch_now([body.key]).get(body.key)
        spec = {**body.model_dump(), "symbol": inst.symbol, "name": inst.name, "kind": inst.kind,
                "exchange": inst.exchange, "lot_size": inst.lot_size, "tick_size": inst.tick_size}
        marks = {k: q["ltp"] for k, q in quotes.snapshot().items() if q.get("ltp")}
        order = account.place_order(spec, quote, nse_calendar.market_status(), marks)
        return {"order": account._order_dict(order), "portfolio": account.snapshot(quotes.snapshot())}

    @app.delete("/api/orders/{order_id}")
    def cancel_order(order_id: str):
        order = account.cancel(order_id)
        return {"order": account._order_dict(order), "portfolio": account.snapshot(quotes.snapshot())}

    @app.post("/api/account/reset")
    def reset(body: ResetIn):
        account.reset(body.initial_balance)
        return account.snapshot(quotes.snapshot())

    # -------------------------------------------------------------- watchlists
    wl_path = data / "watchlists.json"

    def _load_lists() -> dict[str, list[str]]:
        try:
            raw = json.loads(wl_path.read_text(encoding="utf-8"))
            lists = raw.get("lists")
            if isinstance(lists, dict) and lists:
                return {str(k): [str(t) for t in v] for k, v in lists.items()}
        except (OSError, ValueError):
            pass
        return {"Watchlist 1": list(DEFAULT_WATCHLIST)}

    @app.get("/api/watchlists")
    def get_watchlists():
        out = {}
        for name, tickers in _load_lists().items():
            items = []
            for ticker in tickers:
                try:
                    items.append(master.resolve(ticker).as_dict())
                except VendorError:
                    continue
            out[name] = items
        return {"lists": out}

    @app.put("/api/watchlists")
    def put_watchlists(body: WatchlistsIn):
        if len(body.lists) > 10 or any(len(v) > 100 for v in body.lists.values()):
            raise HTTPException(400, {"code": "bad_request", "message": "Up to 10 lists of 100 symbols"})
        clean = {n[:40]: [t[:40] for t in v] for n, v in body.lists.items() if n.strip()}
        tmp = wl_path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"lists": clean}), encoding="utf-8")
        os.replace(tmp, wl_path)
        return get_watchlists()

    # ------------------------------------------------------------ AI analysis
    @app.post("/api/analysis")
    def start_analysis(body: AnalysisIn):
        try:
            return analysis.start(body.ticker)
        except ValueError as exc:
            raise HTTPException(400, {"code": "bad_request", "message": str(exc)}) from exc

    @app.get("/api/analysis/{job_id}")
    def get_analysis(job_id: str):
        job = analysis.get(job_id)
        if not job:
            raise HTTPException(404, {"code": "no_data", "message": "Unknown analysis job"})
        return job

    @app.get("/api/analysis/{job_id}/report.html")
    def download_report(job_id: str):
        html = analysis.report_html(job_id)
        job = analysis.get(job_id)
        if not html or not job:
            raise HTTPException(404, {"code": "no_data", "message": "Report not ready"})
        name = "".join(c if c.isalnum() or c in "._-" else "_" for c in job["ticker"])
        return Response(html, media_type="text/html; charset=utf-8", headers={
            "Content-Disposition": f'attachment; filename="{name}_{job["trade_date"]}_report.html"'})

    # --------------------------------------------------------------- Upstox OAuth
    @app.get("/api/oauth/login")
    def oauth_login():
        key, redirect = os.environ.get("UPSTOX_API_KEY"), os.environ.get("UPSTOX_REDIRECT_URI")
        if not key or not redirect or not os.environ.get("UPSTOX_API_SECRET"):
            raise HTTPException(400, {"code": "not_configured",
                                      "message": "Set UPSTOX_API_KEY, UPSTOX_API_SECRET and UPSTOX_REDIRECT_URI"})
        state = secrets.token_urlsafe(16)
        oauth_states[state] = time.time()
        for old in [s for s, t in oauth_states.items() if time.time() - t > 600]:
            oauth_states.pop(old, None)
        from urllib.parse import urlencode

        query = urlencode({"client_id": key, "redirect_uri": redirect, "response_type": "code", "state": state})
        return RedirectResponse(f"{UPSTOX_AUTH_URL}?{query}")

    @app.get("/api/oauth/callback")
    def oauth_callback(code: str = "", state: str = ""):
        if not code or oauth_states.pop(state, None) is None:
            raise HTTPException(400, {"code": "bad_request", "message": "Missing code or unknown state"})
        try:
            resp = requests.post(UPSTOX_TOKEN_URL, headers={"Accept": "application/json"}, timeout=20, data={
                "code": code, "client_id": os.environ.get("UPSTOX_API_KEY", ""),
                "client_secret": os.environ.get("UPSTOX_API_SECRET", ""),
                "redirect_uri": os.environ.get("UPSTOX_REDIRECT_URI", ""), "grant_type": "authorization_code"})
            token = resp.json().get("access_token") if resp.status_code == 200 else None
        except (requests.RequestException, ValueError):
            token = None
        if not token:
            raise HTTPException(502, {"code": "unavailable", "message": "Upstox did not return an access token"})
        os.environ["UPSTOX_ACCESS_TOKEN"] = token
        _save_token(data, token)
        return HTMLResponse("<h3>Upstox connected.</h3><p>You can close this tab and return to the terminal.</p>"
                            "<script>setTimeout(()=>location.href='/',1200)</script>")

    # ------------------------------------------------------------------ static
    @app.get("/", response_class=HTMLResponse)
    def index():
        return HTMLResponse((STATIC_DIR / "index.html").read_text(encoding="utf-8"))

    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
    return app


def _sse(event: str, payload) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, default=str)}\n\n"


def _save_token(data: Path, token: str) -> None:
    path = data / "upstox_token.json"
    path.write_text(json.dumps({"access_token": token, "saved": time.time()}), encoding="utf-8")
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def _restore_saved_token(data: Path) -> None:
    """Reuse a token saved by a recent OAuth login (they expire daily, so only fresh ones)."""
    path = data / "upstox_token.json"
    try:
        saved = json.loads(path.read_text(encoding="utf-8"))
        if time.time() - float(saved["saved"]) < TOKEN_MAX_AGE and saved.get("access_token"):
            os.environ["UPSTOX_ACCESS_TOKEN"] = saved["access_token"]
    except (OSError, ValueError, KeyError):
        pass
