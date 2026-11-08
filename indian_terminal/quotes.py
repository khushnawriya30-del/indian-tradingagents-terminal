"""Session-aware quote service.

One background thread keeps the quotes for every subscribed instrument fresh and hands
them to the paper engine. Behaviour follows the exchange calendar:

* Market live (09:15-15:30 IST, trading day): poll Upstox every ``live_interval``
  seconds (default 1 s) and mark quotes ``frozen = False``.
* Market closed (night, weekend, holiday): quotes are frozen at the last official close,
  taken from that session's settled daily candle, and are *not* polled again until the
  next session. No price is ever generated or drifted; if the feed fails, the last good
  quote is kept and marked stale, and an instrument with no quote has none.
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable
from datetime import timedelta

from tradingagents.dataflows.errors import VendorError
from tradingagents.dataflows.vendors.india import nse_calendar

logger = logging.getLogger(__name__)


class QuoteService:
    def __init__(self, client, live_interval: float = 1.0, closed_recheck: float = 300.0,
                 extra_keys: Callable[[], set[str]] | None = None,
                 on_quotes: Callable[[dict, nse_calendar.MarketStatus], None] | None = None):
        self.client = client
        self.live_interval = live_interval
        self.closed_recheck = closed_recheck
        self._extra_keys = extra_keys or (lambda: set())
        self._on_quotes = on_quotes
        self._subs: dict[str, float] = {}           # key -> last time a client asked for it
        self._quotes: dict[str, dict] = {}
        self._frozen_cache: dict[tuple[str, str], tuple[float, float | None]] = {}
        self._lock = threading.RLock()
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.version = 0
        self.last_error: str | None = None
        self.last_ok: float | None = None

    # ---------------------------------------------------------------- lifecycle
    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="quote-service", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._wake.set()
        if self._thread:
            self._thread.join(timeout=3)

    # ------------------------------------------------------------------- access
    def subscribe(self, keys: list[str]) -> None:
        now = time.time()
        fresh = False
        with self._lock:
            for key in keys:
                if key not in self._subs and key not in self._quotes:
                    fresh = True
                self._subs[key] = now
        if fresh:
            self._wake.set()

    def snapshot(self, keys: list[str] | None = None) -> dict[str, dict]:
        with self._lock:
            if keys is None:
                return {k: dict(v) for k, v in self._quotes.items()}
            return {k: dict(self._quotes[k]) for k in keys if k in self._quotes}

    def get(self, key: str) -> dict | None:
        with self._lock:
            quote = self._quotes.get(key)
            return dict(quote) if quote else None

    def status(self) -> nse_calendar.MarketStatus:
        return nse_calendar.market_status()

    def fetch_now(self, keys: list[str]) -> dict[str, dict]:
        """Synchronous fetch for keys the caller needs right now (e.g. an order ticket)."""
        self.subscribe(keys)
        self._refresh(set(keys), force=True)
        return self.snapshot(keys)

    # --------------------------------------------------------------------- loop
    def _active_keys(self) -> set[str]:
        horizon = time.time() - 300
        with self._lock:
            self._subs = {k: t for k, t in self._subs.items() if t >= horizon}
            keys = set(self._subs)
        return keys | self._extra_keys()

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                keys = self._active_keys()
                if keys:
                    self._refresh(keys)
            except Exception:  # the loop must outlive any single failure
                logger.exception("quote refresh failed")
            status = self.status()
            wait = self.live_interval if status.is_live else min(self.closed_recheck, 5.0)
            self._wake.wait(timeout=wait)
            self._wake.clear()

    def _refresh(self, keys: set[str], force: bool = False) -> None:
        status = self.status()
        with self._lock:
            missing = {k for k in keys if k not in self._quotes}
            stale_closed = {
                k for k in keys
                if k in self._quotes and not status.is_live
                and (not self._quotes[k].get("frozen")
                     or self._quotes[k].get("price_date") != status.price_date.isoformat()
                     )
            }
        if status.is_live:
            todo = list(keys)
        else:
            todo = list(missing | stale_closed)
        if not todo:
            return
        try:
            fetched = self.client.quotes(todo)
        except VendorError as exc:
            self.last_error = f"{type(exc).__name__}: {exc}"
            logger.warning("quote fetch failed: %s", self.last_error)
            with self._lock:
                for key in todo:
                    if key in self._quotes:
                        self._quotes[key]["stale"] = True
            return
        except Exception as exc:  # network layer surprises
            self.last_error = f"{type(exc).__name__}: {exc}"
            logger.warning("quote fetch failed: %s", self.last_error)
            return

        stamp = nse_calendar.now_ist().isoformat(timespec="seconds")
        out: dict[str, dict] = {}
        for key, quote in fetched.items():
            quote = dict(quote)
            quote.update(frozen=not status.is_live, stale=False, as_of=stamp,
                         price_date=status.price_date.isoformat())
            if not status.is_live:
                self._freeze(key, quote, status)
            out[key] = quote
        with self._lock:
            self._quotes.update(out)
            self.version += 1
        self.last_error = None
        self.last_ok = time.time()
        if self._on_quotes and out:
            try:
                self._on_quotes(self.snapshot(), status)
            except Exception:
                logger.exception("quote consumer failed")

    def _freeze(self, key: str, quote: dict, status: nse_calendar.MarketStatus) -> None:
        """Pin a closed-market quote to the last settled daily close, with no depth."""
        close, prev = self._official_close(key, status.price_date)
        if close is not None:
            quote["ltp"] = close
            quote["prev_close"] = prev if prev is not None else quote.get("prev_close")
            if quote["prev_close"]:
                quote["change"] = round(close - quote["prev_close"], 2)
                quote["change_pct"] = round(quote["change"] / quote["prev_close"] * 100, 2)
        quote["bids"], quote["asks"] = [], []     # no live book while the exchange is shut

    def _official_close(self, key: str, price_date) -> tuple[float | None, float | None]:
        cache_key = (key, price_date.isoformat())
        cached = self._frozen_cache.get(cache_key)
        if cached:
            return cached[1], cached[0]
        try:
            frame = self.client.historical_candles(
                key, "days", 1, (price_date - timedelta(days=10)).isoformat(), price_date.isoformat())
        except Exception as exc:
            logger.warning("official close lookup failed for %s: %s", key, exc)
            return None, None
        frame = frame[frame["time"].dt.date <= price_date]
        if frame.empty:
            return None, None
        close = float(frame["close"].iloc[-1])
        prev = float(frame["close"].iloc[-2]) if len(frame) > 1 else None
        self._frozen_cache[cache_key] = (prev, close)
        return close, prev
