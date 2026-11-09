"""Indian market session and holiday calendar (NSE / BSE equity, NFO derivatives).

One source of truth for "is the exchange open right now", used by the trading
tools and by the paper-trading server. Rules:

* Regular equity session: Mon-Fri, 09:15-15:30 IST.
* Pre-open auction: 09:00-09:15 IST (orders accepted, no continuous trading).
* Saturdays, Sundays and NSE trading holidays are closed.
* When the exchange is closed, callers freeze at the last official close. No
  synthetic drift is ever produced for a closed session.

Holiday data is layered: the bundled seed (``nse_holidays.json``) always works
offline, and ``refresh_holidays()`` will replace it from NSE's public API when
the network allows. The seed is deliberately conservative: a missing holiday
still cannot fabricate prices, because live quotes fall back to the last traded
price and the OHLC previous close.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, asdict
from datetime import date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

IST = ZoneInfo("Asia/Kolkata")
EQUITY_OPEN = time(9, 15)
EQUITY_CLOSE = time(15, 30)
PRE_OPEN = time(9, 0)

_HOLIDAY_FILE = Path(__file__).with_name("nse_holidays.json")

# Bundled seed. NSE publishes the official list every December for the coming
# year; ``python -m tradingagents.dataflows.market_calendar --refresh`` updates
# this file from the exchange and the file can be edited by hand as well.
_SEED_HOLIDAYS: dict[str, list[str]] = {
    "2026": [
        "2026-01-26",  # Republic Day
        "2026-02-15",  # Mahashivratri
        "2026-03-04",  # Holi
        "2026-03-21",  # Id-Ul-Fitr (Ramzan Eid)
        "2026-03-26",  # Ram Navami
        "2026-03-31",  # Mahavir Jayanti
        "2026-04-03",  # Good Friday
        "2026-04-14",  # Dr. Baba Saheb Ambedkar Jayanti
        "2026-05-01",  # Maharashtra Day
        "2026-05-27",  # Bakri Eid
        "2026-08-15",  # Independence Day
        "2026-08-26",  # Ganesh Chaturthi
        "2026-10-02",  # Mahatma Gandhi Jayanti
        "2026-10-20",  # Dussehra
        "2026-11-08",  # Diwali Laxmi Pujan
        "2026-11-09",  # Diwali Balipratipada
        "2026-11-24",  # Guru Nanak Jayanti
        "2026-12-25",  # Christmas
    ],
    "2027": [
        "2027-01-26",  # Republic Day
        "2027-03-22",  # Holi
        "2027-04-02",  # Good Friday
        "2027-04-14",  # Dr. Baba Saheb Ambedkar Jayanti
        "2027-05-01",  # Maharashtra Day
        "2027-08-15",  # Independence Day
        "2027-10-02",  # Mahatma Gandhi Jayanti
        "2027-12-25",  # Christmas
    ],
}


def _load_holidays() -> dict[str, set[date]]:
    raw = _SEED_HOLIDAYS
    if _HOLIDAY_FILE.exists():
        try:
            raw = json.loads(_HOLIDAY_FILE.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:  # pragma: no cover - corrupt file
            logger.warning("Could not read %s (%s); using bundled seed", _HOLIDAY_FILE, exc)
    out: dict[str, set[date]] = {}
    for year, values in raw.items():
        days = set()
        for value in values:
            try:
                days.add(datetime.strptime(str(value), "%Y-%m-%d").date())
            except ValueError:
                logger.warning("Ignoring malformed holiday %r for %s", value, year)
        out[str(year)] = days
    return out


HOLIDAYS: dict[str, set[date]] = _load_holidays()


def refresh_holidays(timeout: float = 15.0) -> bool:
    """Replace the holiday file from NSE's public API. Returns True on success.

    NSE requires a browser-ish cookie handshake; the call degrades quietly when
    the exchange blocks the request, leaving the bundled seed in place.
    """
    global HOLIDAYS
    try:
        import requests

        session = requests.Session()
        session.headers.update({
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
            ),
            "Accept": "application/json, text/plain, */*",
            "Referer": "https://www.nseindia.com/resources/exchange-communication-holidays",
        })
        session.get("https://www.nseindia.com", timeout=timeout)
        response = session.get(
            "https://www.nseindia.com/api/holiday-master?type=trading", timeout=timeout
        )
        response.raise_for_status()
        payload = response.json()
        rows = payload.get("CM") or payload.get("FO") or []
        by_year: dict[str, list[str]] = {}
        for row in rows:
            try:
                day = datetime.strptime(row["tradingDate"], "%d-%b-%Y").date()
            except (KeyError, ValueError):
                continue
            by_year.setdefault(str(day.year), []).append(day.isoformat())
        if not by_year:
            return False
        _HOLIDAY_FILE.write_text(json.dumps(by_year, indent=2) + "\n", encoding="utf-8")
        HOLIDAYS = {year: {date.fromisoformat(d) for d in days} for year, days in by_year.items()}
        return True
    except Exception as exc:  # network/parse: seed stays authoritative
        logger.info("NSE holiday refresh unavailable: %s", exc)
        return False


def is_weekend(day: date) -> bool:
    return day.weekday() >= 5


def is_holiday(day: date) -> bool:
    return day in HOLIDAYS.get(str(day.year), set())


def is_trading_day(day: date) -> bool:
    return not is_weekend(day) and not is_holiday(day)


def now_ist() -> datetime:
    return datetime.now(IST)


def previous_trading_day(day: date) -> date:
    cursor = day - timedelta(days=1)
    for _ in range(30):
        if is_trading_day(cursor):
            return cursor
        cursor -= timedelta(days=1)
    raise RuntimeError("no trading day found in the last 30 days")


def next_trading_day(day: date) -> date:
    cursor = day + timedelta(days=1)
    for _ in range(30):
        if is_trading_day(cursor):
            return cursor
        cursor += timedelta(days=1)
    raise RuntimeError("no trading day found in the next 30 days")


def last_completed_session(now: datetime | None = None) -> date:
    """The trading date whose close is the latest official print.

    Before the 15:30 close on a trading day, today's session has not produced a
    final close, so the previous session is the latest official close.
    """
    moment = (now or now_ist()).astimezone(IST)
    day = moment.date()
    if is_trading_day(day) and moment.time() >= EQUITY_CLOSE:
        return day
    return previous_trading_day(day)


@dataclass(frozen=True)
class SessionState:
    phase: str                  # "open" | "pre_open" | "closed" | "weekend" | "holiday"
    is_open: bool
    is_trading_day: bool
    session_date: date
    last_close_date: date
    server_time_ist: str
    next_open_ist: str
    seconds_to_open: int
    seconds_to_close: int

    def as_dict(self) -> dict:
        data = asdict(self)
        data["session_date"] = self.session_date.isoformat()
        data["last_close_date"] = self.last_close_date.isoformat()
        return data


def session_state(now: datetime | None = None) -> SessionState:
    moment = (now or now_ist()).astimezone(IST)
    day = moment.date()
    clock = moment.time()
    trading_day = is_trading_day(day)
    last_close = last_completed_session(moment)

    if is_weekend(day):
        phase = "weekend"
    elif is_holiday(day):
        phase = "holiday"
    elif clock < PRE_OPEN:
        phase = "closed"
    elif clock < EQUITY_OPEN:
        phase = "pre_open"
    elif clock <= EQUITY_CLOSE:
        phase = "open"
    else:
        phase = "closed"

    # A closed exchange opens next on the next trading day; an open one is open now.
    if phase in ("open", "pre_open"):
        next_open = datetime.combine(day, EQUITY_OPEN, tzinfo=IST)
        seconds_to_open = 0 if phase == "open" else int((next_open - moment).total_seconds())
    else:
        target = day if (trading_day and clock < PRE_OPEN) else next_trading_day(day)
        next_open = datetime.combine(target, EQUITY_OPEN, tzinfo=IST)
        seconds_to_open = int((next_open - moment).total_seconds())

    close_at = datetime.combine(day, EQUITY_CLOSE, tzinfo=IST)
    seconds_to_close = max(0, int((close_at - moment).total_seconds())) if phase == "open" else 0

    return SessionState(
        phase=phase,
        is_open=phase == "open",
        is_trading_day=trading_day,
        session_date=day,
        last_close_date=last_close,
        server_time_ist=moment.isoformat(timespec="seconds"),
        next_open_ist=next_open.isoformat(timespec="minutes"),
        seconds_to_open=seconds_to_open,
        seconds_to_close=seconds_to_close,
    )


def freeze_quote(last_price: float | None, previous_close: float | None) -> dict:
    """A quote payload for a closed session: last price and previous close, no drift."""
    price = last_price if last_price else previous_close
    return {
        "last_price": price,
        "previous_close": previous_close,
        "change": (price - previous_close) if price is not None and previous_close is not None else None,
        "change_percent": (
            ((price - previous_close) / previous_close * 100)
            if price is not None and previous_close not in (None, 0)
            else None
        ),
        "frozen": True,
    }


def cli() -> int:
    import argparse

    parser = argparse.ArgumentParser(description="NSE market calendar")
    parser.add_argument("--refresh", action="store_true", help="download holidays from NSE")
    args = parser.parse_args()
    if args.refresh:
        ok = refresh_holidays()
        print("holidays refreshed" if ok else "refresh failed; bundled seed kept")
    state = session_state()
    print(json.dumps(state.as_dict(), indent=2))
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(cli())
