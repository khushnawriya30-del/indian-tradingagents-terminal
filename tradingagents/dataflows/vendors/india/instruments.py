"""Ticker identity helpers for Indian markets.

Upstox addresses equities by ``NSE_EQ|ISIN``, while agents, prompts and the
dashboard speak in NSE trading symbols. Everything here bridges the two without
touching the dots: ``RELIANCE.NS`` stays ``RELIANCE.NS`` when it reaches a
Yahoo fallback, and resolves to the ISIN key when it reaches Upstox.
"""

from __future__ import annotations

import re

from tradingagents.dataflows.vendors.india import upstox_client as upstox

# The Nifty 50 as of the 2026 reconstitution. Used for market breadth, movers
# and the default watchlist; resolution still goes through the live master, so a
# constituent change needs only this list updated.
NIFTY_50 = [
    "ADANIENT", "ADANIPORTS", "APOLLOHOSP", "ASIANPAINT", "AXISBANK",
    "BAJAJ-AUTO", "BAJFINANCE", "BAJAJFINSV", "BEL", "BHARTIARTL",
    "CIPLA", "COALINDIA", "DRREDDY", "EICHERMOT", "ETERNAL",
    "GRASIM", "HCLTECH", "HDFCBANK", "HDFCLIFE", "HEROMOTOCO",
    "HINDALCO", "HINDUNILVR", "ICICIBANK", "INDUSINDBK", "INFY",
    "ITC", "JIOFIN", "JSWSTEEL", "KOTAKBANK", "LT",
    "M&M", "MARUTI", "MAXHEALTH", "NESTLEIND", "NTPC",
    "ONGC", "POWERGRID", "RELIANCE", "SBILIFE", "SBIN",
    "SHRIRAMFIN", "SUNPHARMA", "TATACONSUM", "TATAMOTORS", "TATASTEEL",
    "TCS", "TECHM", "TITAN", "TRENT", "ULTRACEMCO",
]

NIFTY_BANK = [
    "AXISBANK", "BANKBARODA", "FEDERALBNK", "HDFCBANK", "ICICIBANK",
    "IDFCFIRSTB", "INDUSINDBK", "KOTAKBANK", "PNB", "SBIN",
    "AUBANK", "CANBK", "UNIONBANK",
]

INDEX_WATCHLIST = [
    ("NIFTY 50", "NSE_INDEX|Nifty 50"),
    ("BANKNIFTY", "NSE_INDEX|Nifty Bank"),
    ("SENSEX", "BSE_INDEX|SENSEX"),
    ("FINNIFTY", "NSE_INDEX|Nifty Fin Service"),
    ("INDIA VIX", "NSE_INDEX|India VIX"),
]

_SYMBOL_CLEAN = re.compile(r"[^A-Z0-9&\-.]")
_INDEX_LABELS = {key: label for label, key in INDEX_WATCHLIST}


def display_symbol(symbol: str) -> str:
    """A clean human label: ``RELIANCE.NS`` -> ``RELIANCE``, keys pass through."""
    raw = str(symbol or "").strip()
    if "|" in raw:
        # Index instruments carry opaque trading symbols in the master dump
        # (``NIFTY`` for ``NSE_INDEX|Nifty 50``); the dashboard wants the name
        # people actually say, so the curated table wins.
        if raw in _INDEX_LABELS:
            return _INDEX_LABELS[raw]
        instrument = upstox.master.by_key(raw)
        if instrument and instrument.trading_symbol:
            return instrument.trading_symbol
        return raw.split("|")[-1].upper()
    if raw.upper().endswith((".NS", ".BO")):
        return raw[:-3].upper()
    return raw.upper()


def yahoo_symbol(symbol: str) -> str:
    """Yahoo's spelling of an Indian ticker, preserving the exchange suffix."""
    raw = str(symbol or "").strip()
    upper = raw.upper()
    if upper.endswith((".NS", ".BO")):
        return upper
    instrument = upstox.master.resolve(raw)
    if instrument is not None:
        if instrument.exchange == "BSE" or instrument.segment.startswith("BSE"):
            return f"{instrument.trading_symbol}.BO"
        return f"{instrument.trading_symbol}.NS"
    return f"{upper}.NS"


def nse_symbol(symbol: str) -> str:
    """Bare NSE trading symbol, the form every Indian data source indexes."""
    return display_symbol(symbol).replace(".NS", "").replace(".BO", "")


def quote_links(symbol: str) -> dict[str, str]:
    """Audit links rendered into the research report and the AI drawer."""
    ticker = nse_symbol(symbol)
    return {
        "screener": f"https://www.screener.in/company/{ticker}/consolidated/",
        "moneycontrol": f"https://www.moneycontrol.com/india/stockpricequote/{ticker}",
        "nse": f"https://www.nseindia.com/get-quotes/equity?symbol={ticker}",
        "bse": f"https://www.bseindia.com/stock-share-price/{ticker.lower()}",
        "tradingview": f"https://www.tradingview.com/symbols/NSE-{ticker}/",
    }


def resolve_many(symbols: list[str]) -> dict[str, str]:
    """Map display symbols to Upstox keys, skipping anything the master lacks."""
    out: dict[str, str] = {}
    for symbol in symbols:
        instrument = upstox.master.resolve(symbol)
        if instrument is not None:
            out[display_symbol(symbol)] = instrument.instrument_key
    return out
