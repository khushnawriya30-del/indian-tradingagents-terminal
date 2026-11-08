"""NSE/BSE trading sessions and holidays, in IST.

Single source of truth for "is the Indian market live right now, and if not, which
session's close is the current price?". Everything that shows a price (the paper
trading terminal, the Upstox vendor, the snapshot tool) asks this module first so
that a closed market freezes at the last official close instead of drifting.

Regular equity / F&O session: Monday-Friday, 09:15-15:30 IST (pre-open 09:00-09:15).

Holiday data
------------
``NSE_HOLIDAYS`` is the equity-segment list for calendar 2026, cross-checked
against two broker publications. It is a convenience default, not an authority:
NSE can move or add holidays by circular. Extend or correct it without code
changes through either of:

* ``NSE_HOLIDAYS_FILE``      path to a JSON object ``{"YYYY-MM-DD": "Occasion", ...}``
* ``NSE_SPECIAL_SESSIONS``   ``"YYYY-MM-DD=HH:MM-HH:MM[,...]"`` for muhurat or other
                             special sessions, e.g. ``2026-11-08=18:15-19:15``

Special-session timings are deliberately never assumed: until NSE's circular is
entered via the variable above, a weekend muhurat day is reported as closed.

Dates past the last year the table covers are reported with ``calendar_covered =
False`` so callers can warn that holiday knowledge has run out.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

IST = ZoneInfo("Asia/Kolkata")

PRE_OPEN = time(9, 0)
MARKET_OPEN = time(9, 15)
MARKET_CLOSE = time(15, 30)

# Equity segment trading holidays that fall on weekdays (weekend holidays need no
# entry: the market is shut anyway). Source: NSE circulars as republished by
# cleartax.in and upstox.com (both fetched 2026-11-08).
NSE_HOLIDAYS: dict[str, str] = {
    "2026-01-15": "Maharashtra municipal elections",
    "2026-01-26": "Republic Day",
    "2026-03-03": "Holi",
    "2026-03-26": "Shri Ram Navami",
    "2026-03-31": "Shri Mahavir Jayanti",
    "2026-04-03": "Good Friday",
    "2026-04-14": "Dr. Baba Saheb Ambedkar Jayanti",
    "2026-05-01": "Maharashtra Day",
    "2026-05-28": "Bakri Id",
    "2026-06-26": "Muharram",
    "2026-09-14": "Ganesh Chaturthi",
    "2026-10-02": "Mahatma Gandhi Jayanti",
    "2026-10-20": "Dussehra",
    "2026-11-10": "Diwali (Balipratipada)",
    "2026-11-24": "Prakash Gurpurb Sri Guru Nanak Dev",
    "2026-12-25": "Christmas",
}

# Last calendar year the built-in table is known to cover.
CALENDAR_COVERED_THROUGH_YEAR = 2026


def _load_extra_holidays() -> dict[str, str]:
    path = os.environ.get("NSE_HOLIDAYS_FILE", "").strip()
    if not path:
        return {}
    try:
        with open(path, encoding="utf-8") as fh:
            raw = json.load(fh)
        return {str(k): str(v) for k, v in raw.items()}
    except (OSError, ValueError, AttributeError) as exc:
        logger.warning("NSE_HOLIDAYS_FILE %r unreadable: %s", path, exc)
        return {}


def _parse_special_sessions() -> dict[str, tuple[time, time]]:
    """Parse ``NSE_SPECIAL_SESSIONS`` into ``{date: (start, end)}``."""
    out: dict[str, tuple[time, time]] = {}
    raw = os.environ.get("NSE_SPECIAL_SESSIONS", "").strip()
    for item in filter(None, (p.strip() for p in raw.split(","))):
        try:
            day, window = item.split("=", 1)
            start_s, end_s = window.split("-", 1)
            start = datetime.strptime(start_s.strip(), "%H:%M").time()
            end = datetime.strptime(end_s.strip(), "%H:%M").time()
            datetime.strptime(day.strip(), "%Y-%m-%d")
        except ValueError:
            logger.warning("Ignoring malformed NSE_SPECIAL_SESSIONS entry %r", item)
            continue
        out[day.strip()] = (start, end)
    return out


def holidays() -> dict[str, str]:
    """Built-in holidays overlaid with ``NSE_HOLIDAYS_FILE`` (file wins)."""
    merged = dict(NSE_HOLIDAYS)
    merged.update(_load_extra_holidays())
    return merged


def now_ist() -> datetime:
    return datetime.now(IST)


def _as_date(value: date | datetime | str) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()


def holiday_name(value: date | datetime | str) -> str | None:
    return holidays().get(_as_date(value).isoformat())


def is_weekend(value: date | datetime | str) -> bool:
    return _as_date(value).weekday() >= 5


def is_trading_day(value: date | datetime | str) -> bool:
    """Regular trading day: a weekday that is not an exchange holiday."""
    d = _as_date(value)
    return not is_weekend(d) and holiday_name(d) is None


def previous_trading_day(value: date | datetime | str) -> date:
    """The most recent trading day strictly before ``value``."""
    d = _as_date(value) - timedelta(days=1)
    while not is_trading_day(d):
        d -= timedelta(days=1)
    return d


def next_trading_day(value: date | datetime | str) -> date:
    """The first trading day strictly after ``value``."""
    d = _as_date(value) + timedelta(days=1)
    while not is_trading_day(d):
        d += timedelta(days=1)
    return d


def on_or_before_trading_day(value: date | datetime | str) -> date:
    d = _as_date(value)
    return d if is_trading_day(d) else previous_trading_day(d)


@dataclass(frozen=True)
class MarketStatus:
    """Where the Indian market is right now.

    ``state`` is one of ``OPEN``, ``PRE_OPEN``, ``SPECIAL`` or ``CLOSED``.
    ``is_live`` is True only when prices should be streaming (OPEN or SPECIAL).
    ``price_date`` is the session whose close a quote must show when not live
    (the previous trading day before the open, today after the close).
    """

    state: str
    is_live: bool
    reason: str
    now: datetime
    price_date: date
    next_open: datetime
    calendar_covered: bool

    def as_dict(self) -> dict:
        return {
            "state": self.state,
            "is_live": self.is_live,
            "reason": self.reason,
            "now_ist": self.now.isoformat(timespec="seconds"),
            "price_date": self.price_date.isoformat(),
            "next_open_ist": self.next_open.isoformat(timespec="minutes"),
            "calendar_covered": self.calendar_covered,
        }


def _at(d: date, t: time) -> datetime:
    return datetime.combine(d, t, tzinfo=IST)


def next_open(now: datetime | None = None) -> datetime:
    """The next time the regular session opens (09:15 IST on a trading day)."""
    now = (now or now_ist()).astimezone(IST)
    today = now.date()
    if is_trading_day(today) and now.time() < MARKET_OPEN:
        return _at(today, MARKET_OPEN)
    return _at(next_trading_day(today), MARKET_OPEN)


def market_status(now: datetime | None = None) -> MarketStatus:
    """Classify ``now`` (default: the current IST time) against the NSE calendar."""
    now = (now or now_ist()).astimezone(IST)
    today = now.date()
    clock = now.time()
    covered = today.year <= CALENDAR_COVERED_THROUGH_YEAR
    nxt = next_open(now)

    special = _parse_special_sessions().get(today.isoformat())
    if special and special[0] <= clock < special[1]:
        return MarketStatus("SPECIAL", True, "Special session in progress", now, today, nxt, covered)

    if is_trading_day(today):
        if MARKET_OPEN <= clock < MARKET_CLOSE:
            return MarketStatus("OPEN", True, "Regular session", now, today, nxt, covered)
        if PRE_OPEN <= clock < MARKET_OPEN:
            return MarketStatus(
                "PRE_OPEN", False, "Pre-open session; prices frozen at previous close",
                now, previous_trading_day(today), nxt, covered,
            )
        if clock >= MARKET_CLOSE:
            return MarketStatus("CLOSED", False, "Market closed for the day", now, today, nxt, covered)
        return MarketStatus(
            "CLOSED", False, "Before market open", now, previous_trading_day(today), nxt, covered
        )

    if is_weekend(today):
        reason = "Weekend"
    else:
        reason = f"Market holiday: {holiday_name(today)}"
    if special:
        reason += f" (special session {special[0]:%H:%M}-{special[1]:%H:%M} IST not in progress)"
    return MarketStatus("CLOSED", False, reason, now, previous_trading_day(today), nxt, covered)


def last_close_date(now: datetime | None = None) -> date:
    """Session date whose official close is the current price when closed."""
    return market_status(now).price_date
