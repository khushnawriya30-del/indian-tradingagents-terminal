"""Upstox instrument master: symbol <-> instrument_key resolution and search.

Upstox addresses every security by an ``instrument_key`` such as
``NSE_EQ|INE002A01018`` (equities carry their ISIN, so the key is not guessable from
the ticker). The public instrument files list them all:

    https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz
    https://assets.upstox.com/market-quote/instruments/exchange/BSE.json.gz

The files are downloaded once a day and cached on disk. Ticker conventions follow
Yahoo/TradingView: ``RELIANCE.NS`` (NSE) and ``RELIANCE.BO`` (BSE). The dot suffix is
always preserved, never rewritten to a dash. A bare symbol means NSE.
"""

from __future__ import annotations

import gzip
import json
import logging
import os
import re
import threading
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime

import requests

from tradingagents.dataflows.config import get_config
from tradingagents.dataflows.errors import NoMarketDataError, VendorUnavailableError

logger = logging.getLogger(__name__)

INSTRUMENT_URL = "https://assets.upstox.com/market-quote/instruments/exchange/{exchange}.json.gz"
CACHE_MAX_AGE_SECONDS = 20 * 3600

# Index keys are stable and documented by Upstox; the master only refines them.
INDEX_KEYS: dict[str, tuple[str, str]] = {
    # alias -> (instrument_key, display name)
    "NIFTY": ("NSE_INDEX|Nifty 50", "NIFTY 50"),
    "NIFTY50": ("NSE_INDEX|Nifty 50", "NIFTY 50"),
    "^NSEI": ("NSE_INDEX|Nifty 50", "NIFTY 50"),
    "BANKNIFTY": ("NSE_INDEX|Nifty Bank", "NIFTY BANK"),
    "NIFTYBANK": ("NSE_INDEX|Nifty Bank", "NIFTY BANK"),
    "^NSEBANK": ("NSE_INDEX|Nifty Bank", "NIFTY BANK"),
    "FINNIFTY": ("NSE_INDEX|Nifty Fin Service", "NIFTY FIN SERVICE"),
    "NIFTYFINSERVICE": ("NSE_INDEX|Nifty Fin Service", "NIFTY FIN SERVICE"),
    "MIDCPNIFTY": ("NSE_INDEX|NIFTY MID SELECT", "NIFTY MIDCAP SELECT"),
    "NIFTYMIDCAPSELECT": ("NSE_INDEX|NIFTY MID SELECT", "NIFTY MIDCAP SELECT"),
    "NIFTYNXT50": ("NSE_INDEX|Nifty Next 50", "NIFTY NEXT 50"),
    "NIFTYNEXT50": ("NSE_INDEX|Nifty Next 50", "NIFTY NEXT 50"),
    "SENSEX": ("BSE_INDEX|SENSEX", "SENSEX"),
    "^BSESN": ("BSE_INDEX|SENSEX", "SENSEX"),
    "BANKEX": ("BSE_INDEX|BANKEX", "BANKEX"),
    "INDIAVIX": ("NSE_INDEX|India VIX", "INDIA VIX"),
}

# Underlyings that have index options (option chain keys by index key).
INDEX_OPTION_UNDERLYINGS = {"NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "BANKEX"}

_SUFFIX = re.compile(r"^(?P<base>.+?)\.(?P<sfx>NS|BO)$", re.IGNORECASE)


@dataclass(frozen=True)
class Instrument:
    key: str
    symbol: str                 # trading symbol, e.g. RELIANCE
    name: str
    exchange: str               # NSE | BSE
    segment: str                # NSE_EQ, NSE_INDEX, NSE_FO, BSE_EQ ...
    kind: str                   # EQ | INDEX | CE | PE | FUT
    isin: str = ""
    lot_size: int = 1
    tick_size: float = 0.05
    underlying: str = ""
    expiry: str = ""            # ISO date for derivatives
    strike: float = 0.0
    extra: dict = field(default_factory=dict, compare=False, hash=False)

    @property
    def display(self) -> str:
        if self.kind in ("CE", "PE"):
            return f"{self.underlying} {self.expiry} {self.strike:g} {self.kind}"
        if self.kind == "FUT":
            return f"{self.underlying} {self.expiry} FUT"
        return self.symbol

    @property
    def yahoo_style(self) -> str:
        """Ticker as the agent layer sees it (suffix preserved)."""
        if self.kind == "INDEX":
            return self.symbol
        return f"{self.symbol}.{'NS' if self.exchange == 'NSE' else 'BO'}"

    def as_dict(self) -> dict:
        return {
            "key": self.key, "symbol": self.symbol, "name": self.name,
            "exchange": self.exchange, "segment": self.segment, "kind": self.kind,
            "isin": self.isin, "lot_size": self.lot_size, "tick_size": self.tick_size,
            "underlying": self.underlying, "expiry": self.expiry, "strike": self.strike,
            "ticker": self.yahoo_style,
        }


def _expiry_iso(raw) -> str:
    if raw in (None, "", 0):
        return ""
    try:
        return datetime.fromtimestamp(int(raw) / 1000, tz=UTC).strftime("%Y-%m-%d")
    except (TypeError, ValueError, OverflowError):
        return str(raw)[:10]


def _to_instrument(row: dict) -> Instrument | None:
    key = row.get("instrument_key")
    kind = (row.get("instrument_type") or "").upper()
    segment = row.get("segment") or ""
    if not key or not kind:
        return None
    if kind in ("CE", "PE", "FUT"):
        underlying = (row.get("underlying_symbol") or "").upper()
    else:
        underlying = ""
    return Instrument(
        key=key,
        symbol=(row.get("trading_symbol") or row.get("short_name") or "").upper() if kind != "INDEX"
        else (row.get("trading_symbol") or row.get("name") or "").upper(),
        name=row.get("name") or row.get("short_name") or "",
        exchange=(row.get("exchange") or segment.split("_")[0]).upper(),
        segment=segment,
        kind=kind,
        isin=row.get("isin") or "",
        lot_size=int(row.get("lot_size") or row.get("minimum_lot") or 1),
        tick_size=float(row.get("tick_size") or 0.05),
        underlying=underlying,
        expiry=_expiry_iso(row.get("expiry")),
        strike=float(row.get("strike_price") or 0.0),
    )


class InstrumentMaster:
    """In-memory index over the Upstox instrument files."""

    def __init__(self, rows: list[dict] | None = None):
        self._lock = threading.Lock()
        self._loaded = False
        self.equities: dict[tuple[str, str], Instrument] = {}     # (exchange, symbol)
        self.indices: dict[str, Instrument] = {}                  # alias -> Instrument
        self.derivatives: list[Instrument] = []
        self.by_key: dict[str, Instrument] = {}
        if rows is not None:
            self._ingest(rows)
            self._loaded = True

    # ------------------------------------------------------------------ loading
    def _ingest(self, rows: list[dict]) -> None:
        for row in rows:
            inst = _to_instrument(row)
            if inst is None:
                continue
            self.by_key[inst.key] = inst
            if inst.kind == "EQ" and inst.segment in ("NSE_EQ", "BSE_EQ"):
                self.equities[(inst.exchange, inst.symbol)] = inst
            elif inst.kind == "INDEX":
                self.indices[inst.symbol.replace(" ", "")] = inst
            elif inst.kind in ("CE", "PE", "FUT") and inst.segment in ("NSE_FO", "BSE_FO"):
                self.derivatives.append(inst)

    def _cache_path(self, exchange: str) -> str:
        directory = get_config()["data_cache_dir"]
        os.makedirs(directory, exist_ok=True)
        return os.path.join(directory, f"upstox-instruments-{exchange}.json.gz")

    def _fetch_exchange(self, exchange: str) -> list[dict]:
        path = self._cache_path(exchange)
        fresh = os.path.exists(path) and (time.time() - os.path.getmtime(path)) < CACHE_MAX_AGE_SECONDS
        if not fresh:
            try:
                resp = requests.get(INSTRUMENT_URL.format(exchange=exchange), timeout=60)
                resp.raise_for_status()
                with open(path, "wb") as fh:
                    fh.write(resp.content)
            except requests.RequestException as exc:
                if not os.path.exists(path):
                    raise VendorUnavailableError(f"Upstox instrument file ({exchange}) unreachable: {exc}") from exc
                logger.warning("Using stale instrument cache for %s: %s", exchange, exc)
        with gzip.open(path, "rt", encoding="utf-8") as fh:
            return json.load(fh)

    def ensure_loaded(self) -> None:
        if self._loaded:
            return
        with self._lock:
            if self._loaded:
                return
            for exchange in ("NSE", "BSE"):
                try:
                    self._ingest(self._fetch_exchange(exchange))
                except VendorUnavailableError:
                    if exchange == "NSE":
                        raise
                    logger.warning("BSE instrument file unavailable; BSE symbols will not resolve")
            self._loaded = True

    # --------------------------------------------------------------- resolution
    @staticmethod
    def split_symbol(raw: str) -> tuple[str, str]:
        """``RELIANCE.NS`` -> (``RELIANCE``, ``NSE``). The suffix decides the exchange."""
        text = (raw or "").strip().upper()
        match = _SUFFIX.match(text)
        if match:
            return match.group("base"), "NSE" if match.group("sfx") == "NS" else "BSE"
        return text, "NSE"

    def resolve(self, raw: str) -> Instrument:
        """Instrument for a ticker the agents/UI hold; raises NoMarketDataError if unknown."""
        text = (raw or "").strip()
        if text.upper().startswith(("NSE_", "BSE_")) and "|" in text:
            self.ensure_loaded()
            inst = self.by_key.get(text)
            if inst:
                return inst
            raise NoMarketDataError(raw, detail="unknown instrument_key")

        base, exchange = self.split_symbol(text)
        compact = base.replace(" ", "")

        if compact in INDEX_KEYS:
            key, display = INDEX_KEYS[compact]
            ex = key.split("_")[0]
            return Instrument(key=key, symbol=display, name=display, exchange=ex,
                              segment=key.split("|")[0], kind="INDEX", tick_size=0.05)

        self.ensure_loaded()
        inst = self.equities.get((exchange, base))
        if inst:
            return inst
        idx = self.indices.get(compact)
        if idx:
            return idx
        # A bare symbol that is not on NSE may be BSE-only.
        if not _SUFFIX.match(text.upper()):
            inst = self.equities.get(("BSE", base))
            if inst:
                return inst
        raise NoMarketDataError(raw, detail=f"{base} not found on {exchange} in the Upstox instrument master")

    # -------------------------------------------------------------------- search
    def search(self, query: str, limit: int = 15) -> list[Instrument]:
        """Universal search over equities and indices. Option/futures contracts are
        reached through ``expiries`` / ``contract`` and the option-chain endpoint."""
        q = (query or "").strip().upper()
        if not q:
            return []
        self.ensure_loaded()
        scored: list[tuple[int, Instrument]] = []
        for alias, (key, display) in INDEX_KEYS.items():
            if q in alias or q in display.replace(" ", ""):
                scored.append((0, Instrument(key=key, symbol=display, name=display,
                                             exchange=key.split("_")[0], segment=key.split("|")[0], kind="INDEX")))
        seen_idx = {i.key for _, i in scored}
        for inst in self.indices.values():
            if inst.key not in seen_idx and q in inst.symbol.replace(" ", ""):
                scored.append((1, inst))
        for inst in self.equities.values():
            if inst.symbol == q:
                scored.append((0, inst))
            elif inst.symbol.startswith(q):
                scored.append((1, inst))
            elif q in inst.symbol or q in inst.name.upper():
                scored.append((2, inst))
        scored.sort(key=lambda s: (s[0], 0 if s[1].exchange == "NSE" else 1, len(s[1].symbol), s[1].symbol))
        out: list[Instrument] = []
        seen: set[str] = set()
        for _, inst in scored:
            if inst.key in seen:
                continue
            seen.add(inst.key)
            out.append(inst)
            if len(out) >= limit:
                break
        return out

    # --------------------------------------------------------------- derivatives
    def expiries(self, underlying: str) -> list[str]:
        """Sorted future expiry dates (ISO) listed for an F&O underlying."""
        self.ensure_loaded()
        today = datetime.now().strftime("%Y-%m-%d")
        name = underlying.upper().split(".")[0]
        found = {d.expiry for d in self.derivatives
                 if d.underlying == name and d.kind in ("CE", "PE") and d.expiry >= today}
        return sorted(found)

    def lot_size(self, underlying: str) -> int:
        self.ensure_loaded()
        name = underlying.upper().split(".")[0]
        for d in self.derivatives:
            if d.underlying == name:
                return d.lot_size
        return 1

    def contract(self, underlying: str, expiry: str, strike: float, kind: str) -> Instrument | None:
        self.ensure_loaded()
        name = underlying.upper().split(".")[0]
        for d in self.derivatives:
            if (d.underlying == name and d.expiry == expiry and d.kind == kind.upper()
                    and abs(d.strike - float(strike)) < 1e-6):
                return d
        return None


_MASTER: InstrumentMaster | None = None
_MASTER_LOCK = threading.Lock()


def get_master() -> InstrumentMaster:
    global _MASTER
    with _MASTER_LOCK:
        if _MASTER is None:
            _MASTER = InstrumentMaster()
        return _MASTER


def set_master(master: InstrumentMaster | None) -> None:
    """Swap the process-wide master (tests, or a pre-built one)."""
    global _MASTER
    with _MASTER_LOCK:
        _MASTER = master
