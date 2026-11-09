"""Indian macro context for the news analyst and the dashboard.

US runs read FRED. Indian runs need a different set: RBI policy, FII/DII cash
flows, index levels, India VIX, the rupee and crude. Each comes from the venue
that owns it:

* RBI policy rates -- rbi.org.in homepage table
* FII/DII cash-market flows -- NSE's public FII/DII endpoint
* Index, VIX -- Upstox quotes
* USD/INR, Brent, gold, US 10Y -- Yahoo's public chart endpoint

Anything that cannot be read is returned as unavailable, never estimated.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime

import requests

from tradingagents.dataflows.errors import VendorUnavailableError
from tradingagents.dataflows.vendors.india import upstox_client as upstox
from tradingagents.dataflows.vendors.india.prices import quote

logger = logging.getLogger(__name__)

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Accept": "application/json, text/html;q=0.9, */*;q=0.8",
}

_ALIASES = {
    "nifty": "nifty", "nifty50": "nifty", "nifty 50": "nifty", "^nsei": "nifty",
    "banknifty": "banknifty", "bank nifty": "banknifty", "niftybank": "banknifty",
    "sensex": "sensex", "bse": "sensex",
    "vix": "vix", "indiavix": "vix", "india vix": "vix",
    "rupee": "usdinr", "usdinr": "usdinr", "inr": "usdinr", "dollar": "usdinr",
    "crude": "brent", "brent": "brent", "oil": "brent",
    "gold": "gold", "us10y": "us10y", "10y": "us10y",
    "fii": "fii", "dii": "dii", "flows": "flows", "fii/dii": "flows",
    "repo": "repo", "repo_rate": "repo", "policy_rate": "repo", "rbi": "repo",
    "cpi": "cpi", "inflation": "cpi",
    "macro": "macro", "summary": "macro", "overview": "macro",
}

_YAHOO = {
    "usdinr": ("INR=X", "USD/INR"),
    "brent": ("BZ=F", "Brent crude (USD/bbl)"),
    "gold": ("GC=F", "Gold (USD/oz)"),
    "us10y": ("^TNX", "US 10Y yield (%)"),
}

_INDEX_KEYS = {
    "nifty": ("NSE_INDEX|Nifty 50", "NIFTY 50"),
    "banknifty": ("NSE_INDEX|Nifty Bank", "BANKNIFTY"),
    "sensex": ("BSE_INDEX|SENSEX", "SENSEX"),
    "vix": ("NSE_INDEX|India VIX", "INDIA VIX"),
}


def yahoo_chart(symbol: str, range_: str = "6mo", interval: str = "1d") -> list[tuple[str, float]]:
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
    try:
        response = requests.get(
            url, params={"range": range_, "interval": interval}, headers=_HEADERS, timeout=20
        )
        response.raise_for_status()
        payload = response.json()
        result = (payload.get("chart") or {}).get("result") or []
        if not result:
            raise VendorUnavailableError(f"Yahoo has no chart for {symbol}")
        stamps = result[0].get("timestamp") or []
        closes = ((result[0].get("indicators") or {}).get("quote") or [{}])[0].get("close") or []
        rows: list[tuple[str, float]] = []
        for stamp, close in zip(stamps, closes):
            if close is None:
                continue
            rows.append((datetime.utcfromtimestamp(stamp).strftime("%Y-%m-%d"), float(close)))
        return rows
    except requests.RequestException as exc:
        raise VendorUnavailableError(f"Yahoo chart unavailable for {symbol}: {exc}") from exc


def rbi_policy_rates() -> dict[str, str]:
    try:
        response = requests.get("https://www.rbi.org.in/", headers=_HEADERS, timeout=25)
        response.raise_for_status()
        text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", response.text))
        out: dict[str, str] = {}
        for label in ("Policy Repo Rate", "Standing Deposit Facility Rate", "Marginal Standing Facility Rate", "Bank Rate"):
            match = re.search(rf"{re.escape(label)}\s*:?\s*([0-9]+\.[0-9]{{2}})\s*%", text)
            if match:
                out[label] = f"{match.group(1)}%"
        if not out:
            raise VendorUnavailableError("RBI page did not expose policy rates")
        return out
    except requests.RequestException as exc:
        raise VendorUnavailableError(f"RBI unavailable: {exc}") from exc


def fii_dii_flows() -> list[dict]:
    session = requests.Session()
    session.headers.update({**_HEADERS, "Referer": "https://www.nseindia.com/"})
    try:
        session.get("https://www.nseindia.com", timeout=15)
        response = session.get("https://www.nseindia.com/api/fiidiiTradeReact", timeout=20)
        response.raise_for_status()
        rows = response.json()
    except (requests.RequestException, ValueError) as exc:
        raise VendorUnavailableError(f"NSE FII/DII unavailable: {exc}") from exc
    out = []
    for row in rows:
        try:
            out.append({
                "category": row.get("category", ""),
                "date": row.get("date", ""),
                "buy": float(row.get("buyValue") or 0),
                "sell": float(row.get("sellValue") or 0),
                "net": float(row.get("netValue") or 0),
            })
        except (TypeError, ValueError):
            continue
    return out


def _previous_close(payload: dict) -> float | None:
    """Previous session close from an Upstox quote.

    ``ohlc.close`` is the latest close; ``net_change`` is measured against the
    previous close, so subtract it. Falls back to the OHLC close when the field
    is absent.
    """
    last = payload.get("last_price")
    change = payload.get("net_change")
    if last is not None and change is not None:
        return float(last) - float(change)
    close = (payload.get("ohlc") or {}).get("close")
    return float(close) if close is not None else None


def _index_section(key: str, name: str) -> str:
    instrument_key, _ = _INDEX_KEYS[key]
    payload = upstox.quotes([instrument_key]).get(instrument_key) or {}
    prev = _previous_close(payload)
    last = payload.get("last_price") or prev
    if last is None:
        return f"- **{name}**: unavailable"
    change = (last - prev) if prev else None
    pct = (change / prev * 100) if change is not None and prev else None
    stamp = payload.get("timestamp") or ""
    line = f"- **{name}**: {last:,.2f}"
    if change is not None:
        line += f" ({change:+,.2f}, {pct:+.2f}%)"
    if stamp:
        line += f" -- last print {stamp}"
    return line


def _yahoo_section(key: str) -> str:
    symbol, label = _YAHOO[key]
    try:
        rows = yahoo_chart(symbol)
    except VendorUnavailableError as exc:
        return f"- **{label}**: unavailable ({exc})"
    if not rows:
        return f"- **{label}**: unavailable"
    latest_date, latest = rows[-1]
    previous = rows[-2][1] if len(rows) > 1 else latest
    change = latest - previous
    pct = (change / previous * 100) if previous else 0.0
    return f"- **{label}**: {latest:,.2f} on {latest_date} ({change:+.2f}, {pct:+.2f}% d/d)"


def _flows_section() -> str:
    try:
        rows = fii_dii_flows()
    except VendorUnavailableError as exc:
        return f"- **FII/DII cash flows**: unavailable ({exc})"
    if not rows:
        return "- **FII/DII cash flows**: no rows"
    lines = []
    for row in rows:
        lines.append(
            f"- **{row['category']}** {row['date']}: buy INR {row['buy']:,.2f} cr, "
            f"sell INR {row['sell']:,.2f} cr, net INR {row['net']:+,.2f} cr"
        )
    return "\n".join(lines)


def _repo_section() -> str:
    try:
        rates = rbi_policy_rates()
    except VendorUnavailableError as exc:
        return f"- **RBI policy rates**: unavailable ({exc})"
    return "\n".join(f"- **{label}**: {value}" for label, value in rates.items())


def _cpi_section() -> str:
    """India CPI from FRED when a key is configured; otherwise an explicit gap."""
    import os

    if not os.getenv("FRED_API_KEY"):
        return (
            "- **India CPI**: unavailable without FRED_API_KEY. "
            "Configure it, or read the latest print from the RBI/MOSPI news flow."
        )
    try:
        from tradingagents.dataflows.vendors.fred import get_macro_data

        return get_macro_data("INDCPIALLMINMEI", datetime.now().strftime("%Y-%m-%d"), 400)
    except Exception as exc:
        return f"- **India CPI**: unavailable ({exc})"


def get_macro_indicators(indicator: str, curr_date: str, look_back_days: int | None = None) -> str:
    """Indian macro context in the shape the news analyst expects."""
    key = _ALIASES.get(str(indicator or "").strip().lower())
    if key is None:
        raise ValueError(
            f"Unknown macro indicator {indicator!r}. Use one of: "
            "nifty, banknifty, sensex, vix, rupee, crude, gold, us10y, fii, dii, "
            "repo, cpi, or 'macro' for the full dashboard."
        )

    header = (
        f"# India macro snapshot for {curr_date}\n"
        "Sources: RBI, NSE (FII/DII), Upstox quotes, Yahoo chart endpoint, FRED when configured. "
        "INR crore for flows.\n"
    )
    if key == "nifty":
        body = _index_section("nifty", "NIFTY 50")
    elif key == "banknifty":
        body = _index_section("banknifty", "BANKNIFTY")
    elif key == "sensex":
        body = _index_section("sensex", "SENSEX")
    elif key == "vix":
        body = _index_section("vix", "INDIA VIX")
    elif key in _YAHOO:
        body = _yahoo_section(key)
    elif key == "fii":
        body = _flows_section()
    elif key == "dii":
        body = _flows_section()
    elif key == "flows":
        body = _flows_section()
    elif key == "repo":
        body = _repo_section()
    elif key == "cpi":
        body = _cpi_section()
    else:  # macro
        body = "\n".join([
            "## Index levels",
            _index_section("nifty", "NIFTY 50"),
            _index_section("banknifty", "BANKNIFTY"),
            _index_section("sensex", "SENSEX"),
            _index_section("vix", "INDIA VIX"),
            "",
            "## Flows",
            _flows_section(),
            "",
            "## Policy",
            _repo_section(),
            "",
            "## Global proxies",
            _yahoo_section("usdinr"),
            _yahoo_section("brent"),
            _yahoo_section("gold"),
            _yahoo_section("us10y"),
        ])
    return f"{header}\n{body}\n\nReport only these prints. Do not estimate a missing series."


def macro_snapshot() -> dict:
    """Structured copy for the dashboard header and the AI drawer."""
    snapshot: dict = {"indices": [], "flows": [], "policy": {}, "global": []}
    for key, (instrument_key, name) in _INDEX_KEYS.items():
        try:
            payload = upstox.quotes([instrument_key]).get(instrument_key) or {}
            prev = _previous_close(payload)
            last = payload.get("last_price") or prev
            snapshot["indices"].append({
                "key": key,
                "name": name,
                "last_price": last,
                "change_percent": ((last - prev) / prev * 100) if last and prev else None,
            })
        except Exception:
            continue
    try:
        snapshot["flows"] = fii_dii_flows()
    except VendorUnavailableError:
        pass
    try:
        snapshot["policy"] = rbi_policy_rates()
    except VendorUnavailableError:
        pass
    for key in _YAHOO:
        try:
            rows = yahoo_chart(_YAHOO[key][0], range_="5d")
            if rows:
                snapshot["global"].append({"key": key, "label": _YAHOO[key][1], "value": rows[-1][1], "date": rows[-1][0]})
        except VendorUnavailableError:
            continue
    return snapshot


def quote_summary(symbol: str) -> dict:
    """Convenience wrapper used by the API bridge."""
    return quote(symbol)
