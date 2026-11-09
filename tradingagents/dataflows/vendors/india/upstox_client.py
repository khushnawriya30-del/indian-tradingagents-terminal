"""Low-level Upstox v2/v3 API client for NSE / BSE / NFO.

Responsibilities kept in one place so every Indian vendor shares them:

* token selection (OAuth token file first, then ``UPSTOX_ACCESS_TOKEN``,
  then the long-lived ``UPSTOX_ANALYTICS_TOKEN``), with a retry on 401 that
  swaps to the analytics token for historical endpoints;
* the instrument master (``NSE_EQ``, ``BSE_EQ``, ``NSE_FO``, indices), cached on
  disk for a day and indexed in memory, which turns a ticker into the
  ``NSE_EQ|ISIN`` key Upstox expects;
* batched quotes, candles, option contracts and the option chain;
* a small token bucket so a dashboard polling dozens of symbols cannot burn
  the account's rate limit.

Nothing here writes synthetic prices. When Upstox cannot answer, the typed
errors from ``tradingagents.dataflows.errors`` are raised and the router moves
to the next configured vendor.
"""

from __future__ import annotations

import gzip
import io
import json
import logging
import os
import threading
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Iterable

import requests

from tradingagents.dataflows.config import get_config
from tradingagents.dataflows.errors import (
    NoMarketDataError,
    VendorNotConfiguredError,
    VendorUnavailableError,
)

logger = logging.getLogger(__name__)

API_BASE = "https://api.upstox.com"
MASTER_URL = "https://assets.upstox.com/market-quote/instruments/exchange/complete.json.gz"
SANDBOX_MASTER_URL = "https://assets.upstox.com/market-quote/instruments/exchange/complete.json.gz"

# Indices have no ISIN. These are Upstox's canonical instrument keys, matched
# case-insensitively against what a user types.
INDEX_ALIASES: dict[str, str] = {
    "NIFTY": "NSE_INDEX|Nifty 50",
    "NIFTY50": "NSE_INDEX|Nifty 50",
    "NIFTY 50": "NSE_INDEX|Nifty 50",
    "NIFTY_50": "NSE_INDEX|Nifty 50",
    "BANKNIFTY": "NSE_INDEX|Nifty Bank",
    "NIFTYBANK": "NSE_INDEX|Nifty Bank",
    "NIFTY BANK": "NSE_INDEX|Nifty Bank",
    "FINNIFTY": "NSE_INDEX|Nifty Fin Service",
    "NIFTY FIN SERVICE": "NSE_INDEX|Nifty Fin Service",
    "MIDCPNIFTY": "NSE_INDEX|NIFTY MIDCAP SELECT",
    "NIFTY MIDCAP SELECT": "NSE_INDEX|NIFTY MIDCAP SELECT",
    "NIFTYNEXT50": "NSE_INDEX|Nifty Next 50",
    "NIFTY IT": "NSE_INDEX|Nifty IT",
    "NIFTYIT": "NSE_INDEX|Nifty IT",
    "NIFTY AUTO": "NSE_INDEX|Nifty Auto",
    "NIFTY PHARMA": "NSE_INDEX|Nifty Pharma",
    "NIFTY FMCG": "NSE_INDEX|Nifty FMCG",
    "NIFTY METAL": "NSE_INDEX|Nifty Metal",
    "NIFTY ENERGY": "NSE_INDEX|Nifty Energy",
    "NIFTY PSU BANK": "NSE_INDEX|Nifty PSU Bank",
    "NIFTY REALTY": "NSE_INDEX|Nifty Realty",
    "INDIAVIX": "NSE_INDEX|India VIX",
    "INDIA VIX": "NSE_INDEX|India VIX",
    "SENSEX": "BSE_INDEX|SENSEX",
    "BSE SENSEX": "BSE_INDEX|SENSEX",
    "BANKEX": "BSE_INDEX|BANKEX",
}

# Index keys the dashboard and the agent tools treat as reference instruments.
BENCHMARK_KEYS = {
    "NSE": "NSE_INDEX|Nifty 50",
    "BSE": "BSE_INDEX|SENSEX",
}

_DEFAULT_TIMEOUT = 20.0
_MASTER_TTL = timedelta(hours=24)


class _RateLimiter:
    """A conservative token bucket: 20 requests/second, burst 20."""

    def __init__(self, rate: float = 20.0, burst: int = 20):
        self.rate = rate
        self.burst = burst
        self._tokens = float(burst)
        self._stamp = time.monotonic()
        self._lock = threading.Lock()

    def acquire(self) -> None:
        with self._lock:
            now = time.monotonic()
            self._tokens = min(self.burst, self._tokens + (now - self._stamp) * self.rate)
            self._stamp = now
            if self._tokens < 1:
                wait = (1 - self._tokens) / self.rate
                time.sleep(wait)
                self._tokens = 0
                self._stamp = time.monotonic()
            else:
                self._tokens -= 1


_limiter = _RateLimiter()


def _cache_dir() -> Path:
    config = get_config()
    base = Path(config.get("data_cache_dir") or Path.home() / ".tradingagents" / "cache")
    path = base / "upstox"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _token_file() -> Path:
    override = os.getenv("UPSTOX_TOKEN_FILE")
    if override:
        return Path(override)
    return Path.home() / ".tradingagents" / "upstox_tokens.json"


def configured_tokens() -> list[tuple[str, str]]:
    """Candidate (label, token) pairs, best first.

    A token written by the OAuth callback outranks the environment, so a fresh
    login keeps working until the process is restarted.
    """
    candidates: list[tuple[str, str]] = []
    path = _token_file()
    if path.exists():
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            token = payload.get("access_token")
            expires = payload.get("expires_at")
            if token and (not expires or datetime.fromisoformat(expires) > datetime.now()):
                candidates.append(("oauth", token))
        except (OSError, ValueError) as exc:
            logger.warning("Ignoring unreadable Upstox token file %s: %s", path, exc)
    for label, env in (
        ("access", "UPSTOX_ACCESS_TOKEN"),
        ("analytics", "UPSTOX_ANALYTICS_TOKEN"),
        ("sandbox", "UPSTOX_SANDBOX_TOKEN"),
    ):
        value = os.getenv(env, "").strip()
        if value and all(value != seen for _, seen in candidates):
            candidates.append((label, value))
    return candidates


def save_oauth_token(access_token: str, expires_at: datetime | None = None, **extra: Any) -> Path:
    """Persist an OAuth access token for the client to pick up on its next call."""
    path = _token_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "access_token": access_token,
        "expires_at": (expires_at or datetime.now() + timedelta(hours=20)).isoformat(),
        **extra,
    }
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    try:
        os.chmod(path, 0o600)
    except OSError:  # Windows ACLs; best effort
        pass
    return path


def _headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "Api-Version": "2.0",
        "User-Agent": "indian-tradingagents-terminal/1.0",
    }


def request_json(
    path: str,
    params: dict[str, Any] | None = None,
    *,
    timeout: float = _DEFAULT_TIMEOUT,
    retries: int = 2,
    allow_missing_token: bool = False,
) -> dict:
    """GET an Upstox endpoint, rotating tokens on 401 and retrying transient errors."""
    tokens = configured_tokens()
    if not tokens:
        if allow_missing_token:
            raise VendorNotConfiguredError(
                "Upstox credentials missing: set UPSTOX_ACCESS_TOKEN or run the OAuth flow"
            )
        raise VendorNotConfiguredError("Upstox credentials missing (UPSTOX_ACCESS_TOKEN)")
    url = f"{API_BASE}{path}"
    last_error: Exception | None = None
    for label, token in tokens:
        for attempt in range(retries + 1):
            _limiter.acquire()
            try:
                response = requests.get(url, params=params, headers=_headers(token), timeout=timeout)
            except requests.RequestException as exc:
                last_error = exc
                if attempt < retries:
                    time.sleep(0.4 * (attempt + 1))
                    continue
                break
            if response.status_code == 401:
                logger.info("Upstox rejected the %s token for %s", label, path)
                last_error = VendorUnavailableError(f"Upstox 401 with {label} token")
                break  # try the next token
            if response.status_code == 429 or response.status_code >= 500:
                last_error = VendorUnavailableError(
                    f"Upstox {response.status_code} for {path}"
                )
                if attempt < retries:
                    time.sleep(0.5 * (attempt + 1))
                    continue
                break
            if response.status_code >= 400:
                detail = ""
                try:
                    detail = str(response.json().get("errors") or response.text[:200])
                except ValueError:
                    detail = response.text[:200]
                raise VendorUnavailableError(
                    f"Upstox {response.status_code} for {path}: {detail}"
                )
            try:
                payload = response.json()
            except ValueError as exc:
                raise VendorUnavailableError(f"Upstox returned non-JSON for {path}: {exc}") from exc
            if payload.get("status") not in (None, "success"):
                raise VendorUnavailableError(f"Upstox error for {path}: {payload.get('errors')}")
            return payload
    raise VendorUnavailableError(f"Upstox unavailable for {path}: {last_error}")


# ---------------------------------------------------------------------------
# Instrument master
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Instrument:
    instrument_key: str
    segment: str
    exchange: str
    trading_symbol: str
    name: str
    isin: str
    instrument_type: str
    lot_size: int
    tick_size: float
    expiry: str
    strike_price: float
    underlying_symbol: str
    short_name: str

    def as_dict(self) -> dict:
        return {
            "instrument_key": self.instrument_key,
            "segment": self.segment,
            "exchange": self.exchange,
            "trading_symbol": self.trading_symbol,
            "name": self.name,
            "isin": self.isin,
            "instrument_type": self.instrument_type,
            "lot_size": self.lot_size,
            "tick_size": self.tick_size,
            "expiry": self.expiry,
            "strike_price": self.strike_price,
            "underlying_symbol": self.underlying_symbol,
            "short_name": self.short_name,
        }


class InstrumentMaster:
    """The Upstox instrument dump, cached on disk and indexed in memory."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._items: list[Instrument] = []
        self._by_key: dict[str, Instrument] = {}
        self._by_symbol: dict[tuple[str, str], Instrument] = {}
        self._loaded_at: datetime | None = None
        self._search: list[tuple[str, Instrument]] = []

    @property
    def path(self) -> Path:
        return _cache_dir() / "instruments.json"

    def _fresh(self) -> bool:
        if not self.path.exists() or self._loaded_at is None:
            return False
        return datetime.now() - self._loaded_at < _MASTER_TTL

    def load(self, force: bool = False) -> None:
        with self._lock:
            if self._items and not force and self._fresh():
                return
            if not force and self._read_cache():
                return
            self._download()
            self._read_cache()

    def _read_cache(self) -> bool:
        if not self.path.exists():
            return False
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            logger.warning("Upstox instrument cache unreadable (%s); downloading", exc)
            return False
        self._index(raw)
        self._loaded_at = datetime.fromtimestamp(self.path.stat().st_mtime)
        return True

    def _download(self) -> None:
        logger.info("Downloading Upstox instrument master")
        try:
            response = requests.get(MASTER_URL, timeout=120)
            response.raise_for_status()
            raw = gzip.decompress(response.content)
            payload = json.loads(raw.decode("utf-8"))
        except (requests.RequestException, OSError, ValueError) as exc:
            raise VendorUnavailableError(f"Upstox instrument master unavailable: {exc}") from exc
        self.path.write_bytes(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
        self._index(payload)
        self._loaded_at = datetime.now()

    def _index(self, payload: Iterable[dict]) -> None:
        items: list[Instrument] = []
        by_key: dict[str, Instrument] = {}
        by_symbol: dict[tuple[str, str], Instrument] = {}
        search: list[tuple[str, Instrument]] = []
        for row in payload:
            segment = str(row.get("segment") or row.get("exchange") or "")
            if segment not in {"NSE_EQ", "BSE_EQ", "NSE_FO", "BSE_FO", "NSE_INDEX", "BSE_INDEX", "MCX_COMM"}:
                continue
            try:
                instrument = Instrument(
                    instrument_key=str(row.get("instrument_key") or ""),
                    segment=segment,
                    exchange=str(row.get("exchange") or segment.split("_")[0]),
                    trading_symbol=str(row.get("trading_symbol") or ""),
                    name=str(row.get("name") or ""),
                    isin=str(row.get("isin") or ""),
                    instrument_type=str(row.get("instrument_type") or ""),
                    lot_size=int(row.get("lot_size") or 1),
                    tick_size=float(row.get("tick_size") or 0.05),
                    expiry=str(row.get("expiry") or ""),
                    strike_price=float(row.get("strike_price") or 0),
                    underlying_symbol=str(row.get("underlying_symbol") or ""),
                    short_name=str(row.get("short_name") or ""),
                )
            except (TypeError, ValueError):
                continue
            if not instrument.instrument_key:
                continue
            items.append(instrument)
            by_key[instrument.instrument_key] = instrument
            if segment in {"NSE_EQ", "BSE_EQ", "NSE_FO", "BSE_FO"}:
                by_symbol.setdefault((segment, instrument.trading_symbol.upper()), instrument)
                search.append((f"{instrument.trading_symbol} {instrument.name}".upper(), instrument))
        self._items = items
        self._by_key = by_key
        self._by_symbol = by_symbol
        self._search = search
        logger.info("Indexed %d Upstox instruments", len(items))

    # -- lookups ------------------------------------------------------------

    def all(self) -> list[Instrument]:
        self.load()
        return self._items

    def by_key(self, key: str) -> Instrument | None:
        self.load()
        return self._by_key.get(key)

    def equity(self, symbol: str, exchange: str = "NSE") -> Instrument | None:
        self.load()
        clean = symbol.strip().upper()
        for segment in (f"{exchange}_EQ", "NSE_EQ", "BSE_EQ"):
            found = self._by_symbol.get((segment, clean))
            if found:
                return found
        return None

    def derivative(self, trading_symbol: str) -> Instrument | None:
        self.load()
        clean = trading_symbol.strip().upper()
        return self._by_symbol.get(("NSE_FO", clean)) or self._by_symbol.get(("BSE_FO", clean))

    def isin(self, isin: str) -> Instrument | None:
        self.load()
        for instrument in self._items:
            if instrument.isin.upper() == isin.strip().upper():
                return instrument
        return None

    def resolve(self, symbol: str) -> Instrument | None:
        """Resolve any user form to an instrument: key, ISIN, index alias, or symbol."""
        raw = str(symbol or "").strip()
        if not raw:
            return None
        upper = raw.upper()
        if upper in INDEX_ALIASES:
            key = INDEX_ALIASES[upper]
            return self.by_key(key) or Instrument(
                instrument_key=key, segment="NSE_INDEX" if key.startswith("NSE_") else "BSE_INDEX",
                exchange=key.split("_")[0], trading_symbol=upper, name=upper, isin="",
                instrument_type="INDEX", lot_size=1, tick_size=0.05, expiry="",
                strike_price=0.0, underlying_symbol=upper, short_name=upper,
            )
        if "|" in raw:
            return self.by_key(raw)
        if raw[:2].isalpha() and len(raw) == 12 and raw.upper() == raw:
            found = self.isin(raw)
            if found:
                return found
        if upper.endswith(".NS") or upper.endswith(".BO"):
            base = raw[:-3]
            return self.equity(base, "NSE" if upper.endswith(".NS") else "BSE")
        if upper.startswith("NSE:") or upper.startswith("BSE:"):
            exchange, _, base = upper.partition(":")
            return self.equity(base, exchange)
        derivative = self.derivative(upper)
        if derivative:
            return derivative
        return self.equity(upper)

    def search(self, query: str, limit: int = 25, segments: Iterable[str] | None = None) -> list[Instrument]:
        self.load()
        needle = query.strip().upper()
        if not needle:
            return []
        allowed = set(segments) if segments else {"NSE_EQ", "BSE_EQ", "NSE_FO", "NSE_INDEX", "BSE_INDEX"}
        scored: list[tuple[int, Instrument]] = []
        for haystack, instrument in self._search:
            if instrument.segment not in allowed:
                continue
            symbol = instrument.trading_symbol.upper()
            if symbol == needle:
                score = 0
            elif symbol.startswith(needle):
                score = 1
            elif needle in symbol:
                score = 2
            elif needle in haystack:
                score = 3
            else:
                continue
            scored.append((score, instrument))
            if len(scored) > 4000:
                break
        scored.sort(key=lambda pair: (pair[0], len(pair[1].trading_symbol), pair[1].trading_symbol))
        out: list[Instrument] = []
        seen: set[str] = set()
        for _, instrument in scored:
            if instrument.instrument_key in seen:
                continue
            seen.add(instrument.instrument_key)
            out.append(instrument)
            if len(out) >= limit:
                break
        return out


master = InstrumentMaster()


def resolve_instrument_key(symbol: str) -> str:
    """Upstox instrument key for a user ticker, or raise ``NoMarketDataError``."""
    instrument = master.resolve(symbol)
    if instrument is None:
        raise NoMarketDataError(symbol, symbol, "not found in the Upstox instrument master")
    return instrument.instrument_key


# ---------------------------------------------------------------------------
# Market data
# ---------------------------------------------------------------------------

def _quote_key(instrument_key: str) -> str:
    """Upstox quotes answer under ``NSE_EQ:SYMBOL``; the request uses ``|``.

    Look the response up by the request key recorded on each row instead of
    rebuilding it, because the response key format is not guaranteed.
    """
    return instrument_key


def quotes(instrument_keys: Iterable[str]) -> dict[str, dict]:
    """Batch quotes including OHLC, 5-level depth, OI and circuit limits."""
    keys = [k for k in dict.fromkeys(instrument_keys) if k]
    out: dict[str, dict] = {}
    for start in range(0, len(keys), 40):
        chunk = keys[start:start + 40]
        payload = request_json(
            "/v2/market-quote/quotes",
            {"instrument_key": ",".join(chunk)},
        )
        for row in (payload.get("data") or {}).values():
            key = row.get("instrument_token")
            if key:
                out[key] = row
    return out


def ltp(instrument_keys: Iterable[str]) -> dict[str, float]:
    keys = [k for k in dict.fromkeys(instrument_keys) if k]
    out: dict[str, float] = {}
    for start in range(0, len(keys), 40):
        chunk = keys[start:start + 40]
        payload = request_json("/v2/market-quote/ltp", {"instrument_key": ",".join(chunk)})
        for row in (payload.get("data") or {}).values():
            key = row.get("instrument_token")
            if key and row.get("last_price") is not None:
                out[key] = float(row["last_price"])
    return out


def ohlc(instrument_keys: Iterable[str], interval: str = "1d") -> dict[str, dict]:
    keys = [k for k in dict.fromkeys(instrument_keys) if k]
    out: dict[str, dict] = {}
    for start in range(0, len(keys), 40):
        chunk = keys[start:start + 40]
        payload = request_json(
            "/v2/market-quote/ohlc",
            {"instrument_key": ",".join(chunk), "interval": interval},
        )
        for row in (payload.get("data") or {}).values():
            key = row.get("instrument_token")
            if key:
                out[key] = row
    return out


_HISTORY_MAX_DAYS = {
    "minutes": 30,
    "hours": 90,
    "days": 3650,
    "weeks": 3650,
    "months": 3650,
}


def historical_candles(
    instrument_key: str,
    *,
    unit: str = "days",
    interval: int = 1,
    from_date: str,
    to_date: str,
) -> list[list]:
    """Candles in Upstox order (newest first), chunking long minute windows."""
    if unit not in _HISTORY_MAX_DAYS:
        raise ValueError(f"unit must be one of {sorted(_HISTORY_MAX_DAYS)}")
    start = datetime.strptime(from_date, "%Y-%m-%d").date()
    end = datetime.strptime(to_date, "%Y-%m-%d").date()
    if start > end:
        start, end = end, start
    candles: list[list] = []
    cursor = end
    while cursor >= start:
        window_start = max(start, cursor - timedelta(days=_HISTORY_MAX_DAYS[unit]))
        payload = request_json(
            f"/v3/historical-candle/{requests.utils.quote(instrument_key, safe='')}"
            f"/{unit}/{int(interval)}/{cursor.isoformat()}/{window_start.isoformat()}"
        )
        rows = ((payload.get("data") or {}).get("candles")) or []
        candles.extend(rows)
        cursor = window_start - timedelta(days=1)
    if not candles:
        raise NoMarketDataError(instrument_key, instrument_key, "no candles in the requested window")
    # The API returns newest first per window; de-duplicate and sort ascending.
    dedup: dict[str, list] = {str(row[0]): row for row in candles}
    return sorted(dedup.values(), key=lambda row: str(row[0]))


def intraday_candles(instrument_key: str, unit: str = "minutes", interval: int = 1) -> list[list]:
    payload = request_json(
        f"/v3/historical-candle/intraday/{requests.utils.quote(instrument_key, safe='')}"
        f"/{unit}/{int(interval)}"
    )
    rows = ((payload.get("data") or {}).get("candles")) or []
    return sorted(rows, key=lambda row: str(row[0]))


def option_contracts(underlying_key: str) -> list[dict]:
    payload = request_json("/v2/option/contract", {"instrument_key": underlying_key})
    return list(payload.get("data") or [])


def option_chain(underlying_key: str, expiry_date: str) -> list[dict]:
    payload = request_json(
        "/v2/option/chain",
        {"instrument_key": underlying_key, "expiry_date": expiry_date},
    )
    return list(payload.get("data") or [])


def expiries(underlying_key: str) -> list[str]:
    rows = option_contracts(underlying_key)
    return sorted({str(r.get("expiry")) for r in rows if r.get("expiry")})


def nearest_expiry(underlying_key: str, today: date | None = None) -> str | None:
    today = today or date.today()
    future = [e for e in expiries(underlying_key) if e >= today.isoformat()]
    return future[0] if future else None


def market_status() -> dict:
    """Upstox's own market-status endpoint, when reachable."""
    try:
        payload = request_json("/v2/market/status/NSE")
        return {"exchange": "NSE", "status": (payload.get("data") or {}).get("status")}
    except Exception as exc:
        logger.info("Upstox market status unavailable: %s", exc)
        return {"exchange": "NSE", "status": "unknown"}


def funds_and_margin() -> dict:
    payload = request_json("/v2/user/get-funds-and-margin")
    return dict(payload.get("data") or {})


def profile() -> dict:
    return dict(request_json("/v2/user/profile").get("data") or {})


def positions() -> list[dict]:
    return list(request_json("/v2/portfolio/short-term-positions").get("data") or [])


def holdings() -> list[dict]:
    return list(request_json("/v2/portfolio/long-term-holdings").get("data") or [])


def order_book() -> list[dict]:
    return list(request_json("/v2/order/retrieve-all").get("data") or [])


def place_order(payload: dict) -> dict:
    tokens = configured_tokens()
    if not tokens:
        raise VendorNotConfiguredError("Upstox credentials missing (UPSTOX_ACCESS_TOKEN)")
    _limiter.acquire()
    response = requests.post(
        f"{API_BASE}/v2/order/place",
        json=payload,
        headers={**_headers(tokens[0][1]), "Content-Type": "application/json"},
        timeout=_DEFAULT_TIMEOUT,
    )
    data = response.json()
    if response.status_code >= 400 or data.get("status") != "success":
        raise VendorUnavailableError(f"Upstox order rejected: {data.get('errors') or data}")
    return dict(data.get("data") or {})


def candles_frame(rows: list[list]):
    """Candles as a pandas DataFrame with the columns the agents expect."""
    import pandas as pd

    frame = pd.DataFrame(rows, columns=["Date", "Open", "High", "Low", "Close", "Volume", "OI"])
    frame["Date"] = pd.to_datetime(frame["Date"], errors="coerce", utc=True).dt.tz_convert("Asia/Kolkata")
    frame = frame.dropna(subset=["Date"]).sort_values("Date")
    for column in ("Open", "High", "Low", "Close", "Volume", "OI"):
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    return frame
