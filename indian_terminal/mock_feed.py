"""Offline development feed (``TERMINAL_MOCK=1``).

Lets the whole terminal run without Upstox access, for UI work and tests. Everything it
serves is fictional and the UI shows a permanent "MOCK DATA" banner. It never drifts:
quotes are fixed so the screen behaves like a closed market. Do not use it for decisions.
"""

from __future__ import annotations

import random
from datetime import datetime, timedelta

import pandas as pd

from tradingagents.dataflows.errors import NoMarketDataError
from tradingagents.dataflows.vendors.india import nse_calendar
from tradingagents.dataflows.vendors.india.instruments import INDEX_KEYS, InstrumentMaster

from . import options as opt

# symbol -> (isin-ish id, name, base price)
EQUITIES = {
    "RELIANCE": ("INE002A01018", "RELIANCE INDUSTRIES LTD", 1420.0),
    "TCS": ("INE467B01029", "TATA CONSULTANCY SERV LT", 3150.0),
    "HDFCBANK": ("INE040A01034", "HDFC BANK LTD", 1010.0),
    "INFY": ("INE009A01021", "INFOSYS LTD", 1560.0),
    "ICICIBANK": ("INE090A01021", "ICICI BANK LTD.", 1385.0),
    "SBIN": ("INE062A01020", "STATE BANK OF INDIA", 870.0),
    "ITC": ("INE154A01025", "ITC LTD", 415.0),
    "LT": ("INE018A01030", "LARSEN & TOUBRO LTD.", 3720.0),
    "BHARTIARTL": ("INE397D01024", "BHARTI AIRTEL LIMITED", 1960.0),
    "M&M": ("INE101A01026", "MAHINDRA & MAHINDRA LTD", 3340.0),
}
INDEX_BASE = {"NSE_INDEX|Nifty 50": 25_480.0, "NSE_INDEX|Nifty Bank": 57_200.0, "BSE_INDEX|SENSEX": 83_150.0}
LOT = {"NIFTY": 75, "BANKNIFTY": 35}
STRIKE_STEP = {"NIFTY": 50, "BANKNIFTY": 100}


def _next_thursdays(n: int = 4) -> list[str]:
    day = nse_calendar.now_ist().date()
    out = []
    while len(out) < n:
        day += timedelta(days=1)
        if day.weekday() == 3:
            out.append(day.isoformat())
    return out


def build_master() -> InstrumentMaster:
    rows = []
    for sym, (isin, name, _p) in EQUITIES.items():
        for ex in ("NSE", "BSE"):
            rows.append({"instrument_key": f"{ex}_EQ|{isin}", "trading_symbol": sym, "name": name,
                         "exchange": ex, "segment": f"{ex}_EQ", "instrument_type": "EQ", "isin": isin,
                         "tick_size": 0.05})
    for key, (_k, display) in {v[0]: v for v in INDEX_KEYS.values()}.items():
        rows.append({"instrument_key": key, "trading_symbol": display, "name": display,
                     "exchange": key.split("_")[0], "segment": key.split("|")[0], "instrument_type": "INDEX"})
    token = 70000
    for under, step in STRIKE_STEP.items():
        spot = INDEX_BASE["NSE_INDEX|Nifty 50" if under == "NIFTY" else "NSE_INDEX|Nifty Bank"]
        atm = round(spot / step) * step
        for expiry in _next_thursdays():
            ms = int(datetime.strptime(expiry, "%Y-%m-%d").timestamp() * 1000)
            for i in range(-10, 11):
                strike = atm + i * step
                for kind in ("CE", "PE"):
                    token += 1
                    rows.append({"instrument_key": f"NSE_FO|{token}", "trading_symbol": f"{under} {strike} {kind}",
                                 "name": under, "exchange": "NSE", "segment": "NSE_FO", "instrument_type": kind,
                                 "underlying_symbol": under, "strike_price": strike, "expiry": ms,
                                 "lot_size": LOT[under], "tick_size": 0.05})
    return InstrumentMaster(rows=rows)


def _base_price(key: str, master: InstrumentMaster) -> float:
    if key in INDEX_BASE:
        return INDEX_BASE[key]
    inst = master.by_key.get(key)
    if inst and inst.symbol in EQUITIES:
        return EQUITIES[inst.symbol][2]
    raise NoMarketDataError(key, detail="not in the mock universe")


class MockClient:
    """Same surface as ``UpstoxClient`` for what the terminal calls."""

    def __init__(self, master: InstrumentMaster):
        self.master = master

    def _series(self, key: str, n: int) -> list[float]:
        rng = random.Random(key)
        price = _base_price(key, self.master) * 0.9
        out = []
        for _ in range(n):
            price *= 1 + rng.gauss(0.0004, 0.011)
            out.append(price)
        scale = _base_price(key, self.master) / out[-1]
        return [p * scale for p in out]

    def historical_candles(self, key, unit, interval, from_date, to_date) -> pd.DataFrame:
        return self.candles(key, "1D", None)

    def candles(self, key: str, timeframe: str = "1D", days: int | None = None) -> pd.DataFrame:
        if key.startswith("NSE_FO"):
            raise NoMarketDataError(key, detail="mock has no option candles")
        daily = timeframe in ("1D", "1W")
        n = {"1D": 260, "1W": 120}.get(timeframe)
        status = nse_calendar.market_status()
        if daily:
            dates = pd.bdate_range(end=status.price_date, periods=n)
            closes = self._series(key, n)
            times = list(dates)
        else:
            step = {"1m": 1, "5m": 5, "15m": 15, "30m": 30, "1h": 60}[timeframe]
            per_day = 375 // step
            days_back = []
            d = status.price_date
            while len(days_back) < 5:
                if nse_calendar.is_trading_day(d):
                    days_back.append(d)
                d -= timedelta(days=1)
            times = [pd.Timestamp(datetime.combine(day, datetime.min.time())) + pd.Timedelta(minutes=555 + step * i)
                     for day in reversed(days_back) for i in range(per_day)]
            closes = self._series(key, len(times))
        rng = random.Random(key + timeframe)
        rows = []
        prev = closes[0]
        for t, c in zip(times, closes):
            hi = max(prev, c) * (1 + abs(rng.gauss(0, 0.003)))
            lo = min(prev, c) * (1 - abs(rng.gauss(0, 0.003)))
            rows.append([t, prev, hi, lo, c, int(rng.uniform(1e5, 9e5)), 0])
            prev = c
        return pd.DataFrame(rows, columns=["time", "open", "high", "low", "close", "volume", "oi"])

    def quotes(self, keys: list[str]) -> dict[str, dict]:
        out = {}
        for key in keys:
            if key.startswith("NSE_FO"):
                out[key] = self._option_quote(key)
                continue
            try:
                closes = self._series(key, 260)
            except NoMarketDataError:
                continue
            last, prev = closes[-1], closes[-2]
            tick = 0.05
            out[key] = {
                "key": key, "symbol": key.split("|")[-1], "ltp": round(last, 2), "prev_close": round(prev, 2),
                "change": round(last - prev, 2), "change_pct": round((last - prev) / prev * 100, 2),
                "open": round(prev, 2), "high": round(max(last, prev) * 1.004, 2),
                "low": round(min(last, prev) * 0.996, 2), "volume": 1_250_000.0, "avg_price": round(last, 2),
                "oi": None, "upper_circuit": round(prev * 1.1, 2), "lower_circuit": round(prev * 0.9, 2),
                "total_buy_qty": 90000.0, "total_sell_qty": 82000.0, "last_trade_time": None,
                "bids": [{"price": round(last - tick * (i + 1), 2), "qty": 400 + 150 * i, "orders": 5 + i} for i in range(5)],
                "asks": [{"price": round(last + tick * (i + 1), 2), "qty": 380 + 140 * i, "orders": 4 + i} for i in range(5)],
            }
        return out

    def _option_quote(self, key: str) -> dict:
        inst = self.master.by_key.get(key)
        if not inst:
            raise NoMarketDataError(key, detail="unknown option")
        spot = INDEX_BASE["NSE_INDEX|Nifty 50" if inst.underlying == "NIFTY" else "NSE_INDEX|Nifty Bank"]
        t = opt.years_to_expiry(inst.expiry)
        price = max(opt.bs_price(spot, inst.strike, t, 0.15, inst.kind == "CE"), 0.05)
        ltp = round(price / 0.05) * 0.05
        return {"key": key, "symbol": inst.symbol, "ltp": round(ltp, 2), "prev_close": round(ltp * 0.97, 2),
                "change": round(ltp * 0.03, 2), "change_pct": 3.09, "open": round(ltp, 2), "high": round(ltp * 1.1, 2),
                "low": round(ltp * 0.9, 2), "volume": 50000.0, "oi": 120000.0, "bids": [
                    {"price": round(ltp - 0.05 * (i + 1), 2), "qty": inst.lot_size * (3 + i), "orders": 3} for i in range(5)],
                "asks": [{"price": round(ltp + 0.05 * (i + 1), 2), "qty": inst.lot_size * (3 + i), "orders": 3} for i in range(5)]}

    def option_chain(self, underlying_key: str, expiry: str) -> list[dict]:
        under = "NIFTY" if "Nifty 50" in underlying_key else "BANKNIFTY"
        spot = INDEX_BASE[underlying_key]
        step = STRIKE_STEP[under]
        t = opt.years_to_expiry(expiry)
        rows = []
        for inst in self.master.derivatives:
            if inst.underlying == under and inst.expiry == expiry and inst.kind == "CE":
                rows.append(inst.strike)
        out = []
        for strike in sorted(rows):
            row = {"strike": strike, "pcr": None, "spot": spot, "expiry": expiry}
            dist = abs(strike - spot) / step
            for side, kind in (("call", "CE"), ("put", "PE")):
                inst = self.master.contract(under, expiry, strike, kind)
                vol = 0.14 + 0.004 * dist
                px = max(opt.bs_price(spot, strike, t, vol, kind == "CE"), 0.05)
                g = opt.bs_greeks(spot, strike, t, vol, kind == "CE")
                oi = max(1000.0, 900_000 * 2.718 ** (-dist / 4)) * (1.15 if (kind == "PE") == (strike < spot) else 0.9)
                row[side] = {"key": inst.key if inst else None, "ltp": round(px, 2), "close": round(px, 2),
                             "volume": round(oi / 8), "oi": round(oi), "prev_oi": round(oi * 0.96),
                             "bid": round(px - 0.05, 2), "ask": round(px + 0.05, 2), "iv": round(vol * 100, 2),
                             **{k: round(v, 5) for k, v in g.items()}}
            out.append(row)
        return out
