"""JSON bridge for the Next.js terminal's Indian data panels.

Every subcommand prints exactly one JSON document on stdout and keeps logs on
stderr, so the Node layer can parse it without stripping noise.

    python scripts/indian_data.py quote --symbols RELIANCE,TCS
    python scripts/indian_data.py candles --symbol RELIANCE --unit minutes --interval 5 --days 5
    python scripts/indian_data.py fundamentals --symbol RELIANCE
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tradingagents.dataflows.market_calendar import session_state  # noqa: E402
from tradingagents.dataflows.vendors.india import fundamentals as fundamentals_vendor  # noqa: E402
from tradingagents.dataflows.vendors.india import macro as macro_vendor  # noqa: E402
from tradingagents.dataflows.vendors.india import news as news_vendor  # noqa: E402
from tradingagents.dataflows.vendors.india import upstox_client as upstox  # noqa: E402
from tradingagents.dataflows.vendors.india.instruments import (  # noqa: E402
    INDEX_WATCHLIST,
    NIFTY_50,
    NIFTY_BANK,
    display_symbol,
    nse_symbol,
    quote_links,
    yahoo_symbol,
)


def _previous_close(payload: dict) -> float | None:
    last = payload.get("last_price")
    change = payload.get("net_change")
    if last is not None and change is not None:
        return float(last) - float(change)
    close = (payload.get("ohlc") or {}).get("close")
    return float(close) if close is not None else None


def normalize_quote(key: str, payload: dict, state) -> dict:
    previous = _previous_close(payload)
    last = payload.get("last_price")
    if last is None:
        last = previous
    change = (last - previous) if last is not None and previous is not None else None
    depth = payload.get("depth") or {}
    instrument = upstox.master.by_key(key)
    return {
        "symbol": display_symbol(key),
        "name": (instrument.name if instrument else "") or payload.get("symbol") or "",
        "instrument_key": key,
        "exchange": key.split("|")[0].split("_")[0],
        "segment": key.split("|")[0],
        "last_price": last,
        "previous_close": previous,
        "change": change,
        "change_percent": (change / previous * 100) if change is not None and previous else None,
        "open": (payload.get("ohlc") or {}).get("open"),
        "high": (payload.get("ohlc") or {}).get("high"),
        "low": (payload.get("ohlc") or {}).get("low"),
        "volume": payload.get("volume"),
        "average_price": payload.get("average_price"),
        "oi": payload.get("oi"),
        "net_change": payload.get("net_change"),
        "lower_circuit": payload.get("lower_circuit_limit"),
        "upper_circuit": payload.get("upper_circuit_limit"),
        "last_trade_time": payload.get("last_trade_time"),
        "depth": {
            "buy": (depth.get("buy") or [])[:5],
            "sell": (depth.get("sell") or [])[:5],
        },
        "frozen": not state.is_open,
        "session": state.phase,
        "source": "upstox",
        "links": quote_links(key),
    }


def cmd_session(_args) -> dict:
    state = session_state()
    return {
        "session": state.as_dict(),
        "indices": _index_quotes(),
        "last_close_date": state.last_close_date.isoformat(),
    }


def _index_quotes() -> list[dict]:
    keys = [key for _, key in INDEX_WATCHLIST]
    quotes = upstox.quotes(keys)
    state = session_state()
    return [
        normalize_quote(key, quotes[key], state)
        for key in keys
        if key in quotes
    ]


def cmd_quote(args) -> dict:
    state = session_state()
    keys: list[str] = []
    for symbol in args.symbols.split(","):
        instrument = upstox.master.resolve(symbol.strip())
        if instrument is not None:
            keys.append(instrument.instrument_key)
    if not keys:
        return {"quotes": [], "error": "no instruments resolved"}
    quotes = upstox.quotes(keys)
    return {
        "quotes": [normalize_quote(k, quotes[k], state) for k in keys if k in quotes],
        "session": state.as_dict(),
    }


def cmd_candles(args) -> dict:
    instrument = upstox.master.resolve(args.symbol)
    if instrument is None:
        return {"candles": [], "error": f"unknown symbol {args.symbol}"}
    end = date.today() if not args.to_date else datetime.strptime(args.to_date, "%Y-%m-%d").date()
    start = end - timedelta(days=args.days)
    if args.unit == "days" and args.intraday:
        rows = upstox.intraday_candles(instrument.instrument_key, "minutes", args.interval)
    elif args.intraday:
        rows = upstox.intraday_candles(instrument.instrument_key, args.unit, args.interval)
    else:
        rows = upstox.historical_candles(
            instrument.instrument_key,
            unit=args.unit,
            interval=args.interval,
            from_date=start.isoformat(),
            to_date=end.isoformat(),
        )
    candles = [
        {
            "time": str(row[0]),
            "open": float(row[1]),
            "high": float(row[2]),
            "low": float(row[3]),
            "close": float(row[4]),
            "volume": float(row[5] or 0),
            "oi": float(row[6] or 0) if len(row) > 6 else 0,
        }
        for row in rows
        if len(row) >= 6
    ]
    return {
        "symbol": display_symbol(args.symbol),
        "instrument_key": instrument.instrument_key,
        "interval": f"{args.interval}{args.unit[0]}",
        "candles": candles[-args.limit:],
        "source": "upstox",
    }


def cmd_search(args) -> dict:
    results = []
    for instrument in upstox.master.search(args.query, limit=args.limit):
        is_equity = instrument.segment in {"NSE_EQ", "BSE_EQ"}
        results.append(
            {
                **instrument.as_dict(),
                "display": instrument.trading_symbol,
                "links": quote_links(instrument.trading_symbol) if is_equity else {},
            }
        )
    return {"query": args.query, "results": results}


def cmd_fundamentals(args) -> dict:
    text = fundamentals_vendor.get_fundamentals(args.symbol, args.date)
    return {
        "symbol": nse_symbol(args.symbol),
        "markdown": text,
        "links": quote_links(args.symbol),
    }


def cmd_news(args) -> dict:
    return news_vendor.news_digest(args.symbol, limit=args.limit)


def cmd_macro(_args) -> dict:
    return macro_vendor.macro_snapshot()


def cmd_chain(args) -> dict:
    instrument = upstox.master.resolve(args.symbol)
    if instrument is None:
        return {"error": f"unknown underlying {args.symbol}"}
    contracts = upstox.option_contracts(instrument.instrument_key)
    expiries = sorted({str(c.get("expiry")) for c in contracts if c.get("expiry")})
    if not expiries:
        return {"error": "no option contracts listed"}
    # The contract dump keeps expired series around; the nearest live expiry is
    # the first one that has not already passed.
    today = date.today().isoformat()
    live = [e for e in expiries if e >= today] or expiries
    expiry = args.expiry if args.expiry in expiries else live[0]
    chain = upstox.option_chain(instrument.instrument_key, expiry)
    spot_payload = upstox.quotes([instrument.instrument_key]).get(instrument.instrument_key) or {}
    lot = next((c.get("lot_size") for c in contracts if str(c.get("expiry")) == expiry), None)
    return {
        "underlying": display_symbol(args.symbol),
        "underlying_key": instrument.instrument_key,
        "expiry": expiry,
        "expiries": expiries[:12],
        "lot_size": lot,
        "spot": spot_payload.get("last_price") or _previous_close(spot_payload),
        "previous_close": _previous_close(spot_payload),
        "chain": chain,
        "session": session_state().as_dict(),
        "source": "upstox",
    }


def cmd_universe(_args) -> dict:
    state = session_state()
    symbols = list(dict.fromkeys(NIFTY_50 + NIFTY_BANK))
    keys = {
        symbol: instrument.instrument_key
        for symbol in symbols
        if (instrument := upstox.master.resolve(symbol)) is not None
    }
    quotes = upstox.quotes(keys.values())
    rows = []
    for symbol, key in keys.items():
        if key in quotes:
            rows.append(normalize_quote(key, quotes[key], state))
    return {"universe": "NIFTY50+BANKNIFTY", "quotes": rows, "session": state.as_dict()}


def main() -> int:
    parser = argparse.ArgumentParser(description="Indian market data JSON bridge")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("session")
    p_quote = sub.add_parser("quote")
    p_quote.add_argument("--symbols", required=True)
    p_candles = sub.add_parser("candles")
    p_candles.add_argument("--symbol", required=True)
    p_candles.add_argument("--unit", default="minutes", choices=["minutes", "hours", "days", "weeks", "months"])
    p_candles.add_argument("--interval", type=int, default=5)
    p_candles.add_argument("--days", type=int, default=10)
    p_candles.add_argument("--limit", type=int, default=500)
    p_candles.add_argument("--to-date", default=None)
    p_candles.add_argument("--intraday", action="store_true")
    p_search = sub.add_parser("search")
    p_search.add_argument("--query", required=True)
    p_search.add_argument("--limit", type=int, default=20)
    p_fund = sub.add_parser("fundamentals")
    p_fund.add_argument("--symbol", required=True)
    p_fund.add_argument("--date", default=date.today().isoformat())
    p_news = sub.add_parser("news")
    p_news.add_argument("--symbol", required=True)
    p_news.add_argument("--limit", type=int, default=12)
    sub.add_parser("macro")
    p_chain = sub.add_parser("chain")
    p_chain.add_argument("--symbol", default="NIFTY")
    p_chain.add_argument("--expiry", default=None)
    sub.add_parser("universe")

    args = parser.parse_args()
    handlers = {
        "session": cmd_session,
        "quote": cmd_quote,
        "candles": cmd_candles,
        "search": cmd_search,
        "fundamentals": cmd_fundamentals,
        "news": cmd_news,
        "macro": cmd_macro,
        "chain": cmd_chain,
        "universe": cmd_universe,
    }
    try:
        result = handlers[args.command](args)
    except Exception as exc:
        print(json.dumps({"error": str(exc), "command": args.command}))
        return 1
    print(json.dumps(result, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
