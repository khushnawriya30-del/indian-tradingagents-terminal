"""Upstox market-data vendor: OHLCV, indicators, live quotes and option chains.

Replaces the Yahoo price/indicator path for Indian tickers. Endpoints used:

    GET /v3/historical-candle/{key}/{unit}/{interval}/{to}/{from}   past candles
    GET /v3/historical-candle/intraday/{key}/{unit}/{interval}      today's candles
    GET /v2/market-quote/quotes?instrument_key=a,b,c                quotes + depth
    GET /v2/option/chain?instrument_key=..&expiry_date=..           chain + greeks

Authentication is a bearer token, read from the environment at call time and never
logged: ``UPSTOX_ANALYTICS_TOKEN`` (long-lived, read-only market data) first, then
``UPSTOX_ACCESS_TOKEN`` (daily session token) as the fallback.

Nothing here invents prices. When the exchange is shut the newest candle simply is the
last official close, and an in-progress daily bar is dropped from analysis so a run
never mistakes a partial session for a settled one.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from datetime import datetime, timedelta
from typing import Annotated
from urllib.parse import quote

import pandas as pd
import requests

from tradingagents.dataflows.errors import (
    NoMarketDataError,
    VendorNotConfiguredError,
    VendorUnavailableError,
)
from tradingagents.dataflows.vendors.india import nse_calendar
from tradingagents.dataflows.vendors.india.instruments import Instrument, get_master
from tradingagents.dataflows.vendors.yahoo.market import get_stock_stats_indicators_window
from tradingagents.dataflows.vendors.yahoo.ohlcv import _assert_ohlcv_not_stale

logger = logging.getLogger(__name__)

BASE_URL = os.environ.get("UPSTOX_BASE_URL", "https://api.upstox.com")
TOKEN_ENV_ORDER = ("UPSTOX_ANALYTICS_TOKEN", "UPSTOX_ACCESS_TOKEN")
QUOTE_BATCH = 100
OHLCV_TTL_SECONDS = 900
HISTORY_YEARS = 5

# Timeframes the terminal's chart offers -> (unit, interval, days of history to load).
TIMEFRAMES = {
    "1m": ("minutes", 1, 5),
    "5m": ("minutes", 5, 20),
    "15m": ("minutes", 15, 30),
    "30m": ("minutes", 30, 60),
    "1h": ("hours", 1, 90),
    "1D": ("days", 1, 730),
    "1W": ("weeks", 1, 1825),
}


def configured_tokens() -> list[str]:
    return [t for t in (os.environ.get(name, "").strip() for name in TOKEN_ENV_ORDER) if t]


class UpstoxClient:
    """Thin REST client. One instance is safe to share between threads."""

    def __init__(self, session: requests.Session | None = None, timeout: float = 15.0):
        self._session = session or requests.Session()
        self._timeout = timeout

    # ---------------------------------------------------------------- transport
    def _get(self, path: str, params: dict | None = None) -> dict:
        tokens = configured_tokens()
        if not tokens:
            raise VendorNotConfiguredError(
                "Upstox is not configured: set UPSTOX_ANALYTICS_TOKEN or UPSTOX_ACCESS_TOKEN"
            )
        url = f"{BASE_URL}{path}"
        rejected = 0
        last_exc: Exception | None = None
        for token in tokens:
            headers = {"Accept": "application/json", "Authorization": f"Bearer {token}"}
            try:
                resp = self._session.get(url, params=params, headers=headers, timeout=self._timeout)
            except requests.RequestException as exc:
                last_exc = VendorUnavailableError(f"Upstox request failed: {type(exc).__name__}")
                continue
            if resp.status_code in (401, 403):
                rejected += 1
                continue
            if resp.status_code == 429:
                raise VendorUnavailableError("Upstox rate limit hit (429)")
            if resp.status_code >= 500:
                last_exc = VendorUnavailableError(f"Upstox server error {resp.status_code}")
                continue
            if resp.status_code >= 400:
                detail = _error_detail(resp)
                raise NoMarketDataError(path, detail=f"Upstox {resp.status_code}: {detail}")
            try:
                payload = resp.json()
            except ValueError as exc:
                raise VendorUnavailableError("Upstox returned a non-JSON body") from exc
            if payload.get("status") not in (None, "success"):
                raise NoMarketDataError(path, detail=str(payload.get("errors") or payload)[:200])
            return payload
        if last_exc is not None:
            raise last_exc
        raise VendorNotConfiguredError(
            f"Upstox rejected all {rejected} configured token(s); the daily access token expires "
            "every day and the analytics token on its own expiry"
        )

    # ------------------------------------------------------------------ candles
    def historical_candles(self, key: str, unit: str, interval: int,
                           from_date: str, to_date: str) -> pd.DataFrame:
        path = f"/v3/historical-candle/{quote(key, safe='')}/{unit}/{interval}/{to_date}/{from_date}"
        return candles_to_frame(self._get(path))

    def intraday_candles(self, key: str, unit: str, interval: int) -> pd.DataFrame:
        path = f"/v3/historical-candle/intraday/{quote(key, safe='')}/{unit}/{interval}"
        return candles_to_frame(self._get(path))

    def candles(self, key: str, timeframe: str = "1D", days: int | None = None) -> pd.DataFrame:
        """Chart candles for a timeframe, joining past data with today's session."""
        if timeframe not in TIMEFRAMES:
            raise ValueError(f"timeframe must be one of {list(TIMEFRAMES)}")
        unit, interval, default_days = TIMEFRAMES[timeframe]
        today = nse_calendar.now_ist().date()
        start = today - timedelta(days=days or default_days)
        parts = []
        try:
            parts.append(self.historical_candles(key, unit, interval, start.isoformat(), today.isoformat()))
        except NoMarketDataError:
            pass
        if unit in ("minutes", "hours"):
            try:
                parts.append(self.intraday_candles(key, unit, interval))
            except NoMarketDataError:
                pass
        parts = [p for p in parts if not p.empty]
        if not parts:
            raise NoMarketDataError(key, detail=f"no {timeframe} candles returned")
        frame = pd.concat(parts).drop_duplicates(subset="time", keep="last").sort_values("time")
        return frame.reset_index(drop=True)

    # ------------------------------------------------------------------- quotes
    def quotes(self, keys: list[str]) -> dict[str, dict]:
        """Full market quotes keyed by instrument_key."""
        out: dict[str, dict] = {}
        for i in range(0, len(keys), QUOTE_BATCH):
            batch = keys[i:i + QUOTE_BATCH]
            payload = self._get("/v2/market-quote/quotes", {"instrument_key": ",".join(batch)})
            for entry in (payload.get("data") or {}).values():
                parsed = parse_quote(entry)
                if parsed["key"]:
                    out[parsed["key"]] = parsed
        return out

    # ------------------------------------------------------------- option chain
    def option_chain(self, underlying_key: str, expiry: str) -> list[dict]:
        payload = self._get("/v2/option/chain", {"instrument_key": underlying_key, "expiry_date": expiry})
        return parse_option_chain(payload.get("data") or [])


def _error_detail(resp: requests.Response) -> str:
    try:
        body = resp.json()
        errors = body.get("errors") or []
        if errors and isinstance(errors, list):
            return str(errors[0].get("message") or errors[0])[:160]
        return str(body)[:160]
    except ValueError:
        return resp.text[:160]


# --------------------------------------------------------------------- parsers
def candles_to_frame(payload: dict) -> pd.DataFrame:
    """Upstox candles ``[ts, o, h, l, c, v, oi]`` (newest first) -> ascending frame."""
    rows = ((payload.get("data") or {}).get("candles")) or []
    if not rows:
        return pd.DataFrame(columns=["time", "open", "high", "low", "close", "volume", "oi"])
    frame = pd.DataFrame(
        [r[:7] + [0] * (7 - len(r)) for r in rows],
        columns=["time", "open", "high", "low", "close", "volume", "oi"],
    )
    # Upstox stamps bars in IST (+05:30). Keep that wall-clock: the first 19 characters
    # ("YYYY-MM-DDTHH:MM:SS") are already the exchange-local time.
    frame["time"] = pd.to_datetime(frame["time"].astype(str).str[:19])
    for col in ("open", "high", "low", "close", "volume", "oi"):
        frame[col] = pd.to_numeric(frame[col], errors="coerce")
    return frame.sort_values("time").reset_index(drop=True)


def parse_quote(entry: dict) -> dict:
    last = _num(entry.get("last_price"))
    net = _num(entry.get("net_change"))
    ohlc = entry.get("ohlc") or {}
    depth = entry.get("depth") or {}
    return {
        "key": entry.get("instrument_token") or "",
        "symbol": entry.get("symbol") or "",
        "ltp": last,
        # last_price - net_change is the previous official close on both live and closed days.
        "prev_close": round(last - net, 2) if last is not None and net is not None else _num(ohlc.get("close")),
        "change": net,
        "change_pct": round(net / (last - net) * 100, 2) if last and net is not None and (last - net) else None,
        "open": _num(ohlc.get("open")),
        "high": _num(ohlc.get("high")),
        "low": _num(ohlc.get("low")),
        "volume": _num(entry.get("volume")),
        "avg_price": _num(entry.get("average_price")),
        "oi": _num(entry.get("oi")),
        "upper_circuit": _num(entry.get("upper_circuit_limit")),
        "lower_circuit": _num(entry.get("lower_circuit_limit")),
        "total_buy_qty": _num(entry.get("total_buy_quantity")),
        "total_sell_qty": _num(entry.get("total_sell_quantity")),
        "last_trade_time": entry.get("last_trade_time"),
        "bids": [{"price": _num(lv.get("price")), "qty": _num(lv.get("quantity")), "orders": lv.get("orders")}
                 for lv in (depth.get("buy") or [])],
        "asks": [{"price": _num(lv.get("price")), "qty": _num(lv.get("quantity")), "orders": lv.get("orders")}
                 for lv in (depth.get("sell") or [])],
    }


def parse_option_chain(rows: list[dict]) -> list[dict]:
    chain = []
    for row in rows:
        entry = {"strike": _num(row.get("strike_price")), "pcr": _num(row.get("pcr")),
                 "spot": _num(row.get("underlying_spot_price")), "expiry": row.get("expiry")}
        for side, field in (("call", "call_options"), ("put", "put_options")):
            leg = row.get(field) or {}
            market = leg.get("market_data") or {}
            greeks = leg.get("option_greeks") or {}
            entry[side] = {
                "key": leg.get("instrument_key"),
                "ltp": _num(market.get("ltp")),
                "close": _num(market.get("close_price")),
                "volume": _num(market.get("volume")),
                "oi": _num(market.get("oi")),
                "prev_oi": _num(market.get("prev_oi")),
                "bid": _num(market.get("bid_price")),
                "ask": _num(market.get("ask_price")),
                "iv": _num(greeks.get("iv")),
                "delta": _num(greeks.get("delta")),
                "gamma": _num(greeks.get("gamma")),
                "theta": _num(greeks.get("theta")),
                "vega": _num(greeks.get("vega")),
            }
        chain.append(entry)
    chain.sort(key=lambda r: r["strike"] or 0)
    return chain


def _num(value):
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


# ------------------------------------------------------------- shared instances
_CLIENT: UpstoxClient | None = None
_CLIENT_LOCK = threading.Lock()


def get_client() -> UpstoxClient:
    global _CLIENT
    with _CLIENT_LOCK:
        if _CLIENT is None:
            _CLIENT = UpstoxClient()
        return _CLIENT


def set_client(client: UpstoxClient | None) -> None:
    global _CLIENT
    with _CLIENT_LOCK:
        _CLIENT = client


# ------------------------------------------------------------- OHLCV for agents
_OHLCV_CACHE: dict[str, tuple[float, pd.DataFrame]] = {}
_OHLCV_LOCK = threading.Lock()


def _daily_history(inst: Instrument) -> pd.DataFrame:
    """Settled daily bars for ``inst`` (newest included only once the session is over)."""
    now = time.time()
    with _OHLCV_LOCK:
        hit = _OHLCV_CACHE.get(inst.key)
        if hit and now - hit[0] < OHLCV_TTL_SECONDS:
            return hit[1].copy()

    today = nse_calendar.now_ist().date()
    start = today - timedelta(days=365 * HISTORY_YEARS)
    frame = get_client().historical_candles(inst.key, "days", 1, start.isoformat(), today.isoformat())
    if frame.empty:
        raise NoMarketDataError(inst.symbol, inst.key, "Upstox returned no daily candles")

    frame["Date"] = frame["time"].dt.normalize()
    # A bar dated today is final only once the session has closed; before that it is partial.
    status = nse_calendar.market_status()
    if not (status.state == "CLOSED" and status.price_date == today):
        frame = frame[frame["Date"] < pd.Timestamp(today)]
    out = frame.rename(columns={"open": "Open", "high": "High", "low": "Low",
                                "close": "Close", "volume": "Volume"})[
        ["Date", "Open", "High", "Low", "Close", "Volume"]
    ].reset_index(drop=True)
    with _OHLCV_LOCK:
        _OHLCV_CACHE[inst.key] = (now, out)
    return out.copy()


def clear_cache() -> None:
    with _OHLCV_LOCK:
        _OHLCV_CACHE.clear()


def load_ohlcv(symbol: str, as_of_date: str) -> pd.DataFrame:
    """OHLCV up to ``as_of_date`` (no look-ahead), shaped for stockstats."""
    inst = get_master().resolve(symbol)
    data = _daily_history(inst)
    data = data[data["Date"] <= pd.Timestamp(as_of_date)].copy()
    if data.empty:
        raise NoMarketDataError(symbol, inst.key, f"no daily bars on or before {as_of_date}")
    _assert_ohlcv_not_stale(data, as_of_date, symbol, inst.key)
    return data.reset_index(drop=True)


# ----------------------------------------------------------- router entry points
def get_stock_data(
    symbol: Annotated[str, "ticker symbol, e.g. RELIANCE.NS"],
    start_date: Annotated[str, "Start date in yyyy-mm-dd format"],
    end_date: Annotated[str, "End date in yyyy-mm-dd format"],
):
    datetime.strptime(start_date, "%Y-%m-%d")
    datetime.strptime(end_date, "%Y-%m-%d")
    inst = get_master().resolve(symbol)
    data = load_ohlcv(symbol, end_date)
    window = data[data["Date"] >= pd.Timestamp(start_date)]
    if window.empty:
        raise NoMarketDataError(symbol, inst.key, f"no rows between {start_date} and {end_date}")
    shown = window.copy()
    shown["Date"] = shown["Date"].dt.strftime("%Y-%m-%d")
    for col in ("Open", "High", "Low", "Close"):
        shown[col] = shown[col].round(2)
    shown["Volume"] = shown["Volume"].astype("int64")
    status = nse_calendar.market_status()
    header = f"# Stock data for {inst.yahoo_style} ({inst.key}) from {start_date} to {end_date}\n"
    header += f"# Total records: {len(shown)}\n"
    header += "# Source: Upstox daily candles (INR); settled sessions only\n"
    header += f"# Market state: {status.state} - {status.reason}\n\n"
    return header + shown.to_csv(index=False)


def get_indicators(
    symbol: Annotated[str, "ticker symbol"],
    indicator: Annotated[str, "technical indicator"],
    as_of_date: Annotated[str, "The current trading date, YYYY-mm-dd"],
    look_back_days: Annotated[int, "how many days to look back"],
) -> str:
    """Indicators over Upstox candles, through the same stockstats pipeline as Yahoo."""
    return get_stock_stats_indicators_window(
        symbol, indicator, as_of_date, look_back_days, loader=load_ohlcv
    )
