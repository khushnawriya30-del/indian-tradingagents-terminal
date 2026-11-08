"""Option-chain helpers: Black-Scholes Greeks and chain assembly.

Upstox returns Greeks and IV with the chain; this module fills a leg's Greeks from its
own traded price only where the feed left them out (a thinly traded strike, or the
chain from a closed session), so every row on the ladder is comparable. Computed values
are tagged ``"greeks_source": "model"``; the feed's are ``"feed"``.
"""

from __future__ import annotations

import math
from datetime import datetime, time

from tradingagents.dataflows.vendors.india import nse_calendar

RISK_FREE = 0.07


def _cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _pdf(x: float) -> float:
    return math.exp(-0.5 * x * x) / math.sqrt(2.0 * math.pi)


def bs_price(spot: float, strike: float, t: float, vol: float, is_call: bool, r: float = RISK_FREE) -> float:
    if t <= 0 or vol <= 0:
        return max(0.0, (spot - strike) if is_call else (strike - spot))
    d1 = (math.log(spot / strike) + (r + 0.5 * vol * vol) * t) / (vol * math.sqrt(t))
    d2 = d1 - vol * math.sqrt(t)
    if is_call:
        return spot * _cdf(d1) - strike * math.exp(-r * t) * _cdf(d2)
    return strike * math.exp(-r * t) * _cdf(-d2) - spot * _cdf(-d1)


def implied_vol(price: float, spot: float, strike: float, t: float, is_call: bool,
                r: float = RISK_FREE) -> float | None:
    """Bisection IV; None when the price is below intrinsic or otherwise unsolvable."""
    if price <= 0 or spot <= 0 or strike <= 0 or t <= 0:
        return None
    intrinsic = max(0.0, (spot - strike * math.exp(-r * t)) if is_call else (strike * math.exp(-r * t) - spot))
    if price < intrinsic - 1e-6:
        return None
    lo, hi = 1e-4, 5.0
    if bs_price(spot, strike, t, hi, is_call, r) < price:
        return None
    for _ in range(80):
        mid = (lo + hi) / 2
        if bs_price(spot, strike, t, mid, is_call, r) < price:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def bs_greeks(spot: float, strike: float, t: float, vol: float, is_call: bool, r: float = RISK_FREE) -> dict:
    """Delta, gamma, theta (per calendar day), vega (per 1 vol point)."""
    if t <= 0 or vol <= 0 or spot <= 0 or strike <= 0:
        return {"delta": None, "gamma": None, "theta": None, "vega": None}
    sqrt_t = math.sqrt(t)
    d1 = (math.log(spot / strike) + (r + 0.5 * vol * vol) * t) / (vol * sqrt_t)
    d2 = d1 - vol * sqrt_t
    delta = _cdf(d1) if is_call else _cdf(d1) - 1.0
    gamma = _pdf(d1) / (spot * vol * sqrt_t)
    first = -spot * _pdf(d1) * vol / (2 * sqrt_t)
    if is_call:
        theta = first - r * strike * math.exp(-r * t) * _cdf(d2)
    else:
        theta = first + r * strike * math.exp(-r * t) * _cdf(-d2)
    vega = spot * _pdf(d1) * sqrt_t / 100.0
    return {"delta": delta, "gamma": gamma, "theta": theta / 365.0, "vega": vega}


def years_to_expiry(expiry_iso: str, now: datetime | None = None) -> float:
    """Time to 15:30 IST on the expiry date, in years (floored at a tiny positive value)."""
    now = (now or nse_calendar.now_ist()).astimezone(nse_calendar.IST)
    expiry = datetime.combine(datetime.strptime(expiry_iso, "%Y-%m-%d").date(), time(15, 30),
                              tzinfo=nse_calendar.IST)
    return max((expiry - now).total_seconds() / (365.0 * 86400.0), 1e-6)


def enrich_chain(rows: list[dict], expiry_iso: str, spot: float | None, now: datetime | None = None) -> dict:
    """Chain payload for the UI: rows, ATM strike, totals and PCR; fills missing Greeks by model."""
    t = years_to_expiry(expiry_iso, now)
    spot = spot or next((r["spot"] for r in rows if r.get("spot")), None)
    for row in rows:
        for side, is_call in (("call", True), ("put", False)):
            leg = row[side]
            leg["greeks_source"] = "feed"
            if leg.get("delta") is not None and leg.get("iv"):
                continue
            ltp = leg.get("ltp") or 0.0
            if not spot or not ltp or not row["strike"]:
                continue
            iv = implied_vol(ltp, spot, row["strike"], t, is_call)
            if iv is None:
                continue
            greeks = bs_greeks(spot, row["strike"], t, iv, is_call)
            for name, value in greeks.items():
                if leg.get(name) is None:
                    leg[name] = round(value, 6)
            if not leg.get("iv"):
                leg["iv"] = round(iv * 100, 2)
            leg["greeks_source"] = "model"
    strikes = [r["strike"] for r in rows if r.get("strike")]
    atm = min(strikes, key=lambda k: abs(k - spot)) if strikes and spot else None
    call_oi = sum((r["call"].get("oi") or 0) for r in rows)
    put_oi = sum((r["put"].get("oi") or 0) for r in rows)
    return {
        "expiry": expiry_iso, "spot": spot, "atm": atm, "rows": rows,
        "total_call_oi": call_oi, "total_put_oi": put_oi,
        "pcr": round(put_oi / call_oi, 3) if call_oi else None,
        "max_call_oi_strike": max(rows, key=lambda r: r["call"].get("oi") or 0)["strike"] if rows else None,
        "max_put_oi_strike": max(rows, key=lambda r: r["put"].get("oi") or 0)["strike"] if rows else None,
    }
