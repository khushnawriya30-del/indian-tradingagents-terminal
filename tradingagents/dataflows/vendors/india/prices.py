"""Indian price, indicator and verification-snapshot tools backed by Upstox.

These keep the exact call signatures of the Yahoo implementations so the vendor
router can swap them without touching a single agent prompt or graph edge. The
output format is the same markdown/CSV shape the analysts already read.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta

import pandas as pd
from dateutil.relativedelta import relativedelta
from stockstats import wrap

from tradingagents.dataflows.date_window import get_current_date
from tradingagents.dataflows.errors import NoMarketDataError
from tradingagents.dataflows.market_calendar import last_completed_session, session_state
from tradingagents.dataflows.symbols import normalize_symbol
from tradingagents.dataflows.vendors.india import upstox_client as upstox
from tradingagents.dataflows.vendors.india.instruments import (
    display_symbol,
    yahoo_symbol,
)

logger = logging.getLogger(__name__)

INDICATOR_DESCRIPTIONS = {
    "close_50_sma": (
        "50 SMA: A medium-term trend indicator. "
        "Usage: Identify trend direction and serve as dynamic support/resistance. "
        "Tips: It lags price; combine with faster indicators for timely signals."
    ),
    "close_200_sma": (
        "200 SMA: A long-term trend benchmark. "
        "Usage: Confirm overall market trend and identify golden/death cross setups. "
        "Tips: It reacts slowly; best for strategic trend confirmation rather than frequent trading entries."
    ),
    "close_10_ema": (
        "10 EMA: A responsive short-term average. "
        "Usage: Capture quick shifts in momentum and potential entry points. "
        "Tips: Prone to noise in choppy markets; use alongside longer averages for filtering false signals."
    ),
    "macd": (
        "MACD: Computes momentum via differences of EMAs. "
        "Usage: Look for crossovers and divergence as signals of trend changes. "
        "Tips: Confirm with other indicators in low-volatility or sideways markets."
    ),
    "macds": "MACD Signal: An EMA smoothing of the MACD line.",
    "macdh": "MACD Histogram: Shows the gap between the MACD line and its signal.",
    "rsi": (
        "RSI: Measures momentum to flag overbought/oversold conditions. "
        "Usage: Apply 70/30 thresholds and watch for divergence to signal reversals. "
        "Tips: In strong trends, RSI may remain extreme; always cross-check with trend analysis."
    ),
    "boll": "Bollinger Middle: A 20 SMA serving as the basis for Bollinger Bands.",
    "boll_ub": "Bollinger Upper Band: Typically 2 standard deviations above the middle line.",
    "boll_lb": "Bollinger Lower Band: Typically 2 standard deviations below the middle line.",
    "atr": (
        "ATR: Averages true range to measure volatility. "
        "Usage: Set stop-loss levels and adjust position sizes based on current market volatility."
    ),
    "vwma": "VWMA: A moving average weighted by volume. Usage: Confirm trends with volume.",
    "mfi": (
        "MFI: Money Flow Index uses price and volume to measure buying and selling pressure. "
        "Usage: >80 overbought, <20 oversold; divergence with price can flag reversals."
    ),
}


def _to_frame(symbol: str, start_date: str, end_date: str) -> pd.DataFrame:
    """Daily candles from Upstox over an inclusive window, ascending by date."""
    instrument_key = upstox.resolve_instrument_key(symbol)
    # Extra history so a 200-DMA and long indicator windows have enough rows.
    padded_start = (datetime.strptime(start_date, "%Y-%m-%d") - timedelta(days=400)).date()
    rows = upstox.historical_candles(
        instrument_key,
        unit="days",
        interval=1,
        from_date=padded_start.isoformat(),
        to_date=end_date,
    )
    frame = upstox.candles_frame(rows)
    frame = frame[frame["Date"].dt.strftime("%Y-%m-%d") <= end_date]
    if frame.empty:
        raise NoMarketDataError(symbol, instrument_key, f"no rows up to {end_date}")
    return frame


def _frame_between(frame: pd.DataFrame, start_date: str, end_date: str) -> pd.DataFrame:
    dates = frame["Date"].dt.strftime("%Y-%m-%d")
    return frame[(dates >= start_date) & (dates <= end_date)].copy()


def _price(value) -> str:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return "N/A"
    if number != number:  # NaN
        return "N/A"
    return f"{number:,.2f}"


def get_stock_data(symbol: str, start_date: str, end_date: str) -> str:
    """OHLCV for an Indian instrument between two inclusive dates."""
    datetime.strptime(start_date, "%Y-%m-%d")
    datetime.strptime(end_date, "%Y-%m-%d")
    frame = _to_frame(symbol, start_date, end_date)
    window = _frame_between(frame, start_date, end_date)
    if window.empty:
        raise NoMarketDataError(symbol, symbol, f"no rows between {start_date} and {end_date}")

    out = window.copy()
    out["Date"] = out["Date"].dt.tz_localize(None).dt.strftime("%Y-%m-%d")
    out = out.rename(columns={"OI": "Open Interest"})
    for column in ("Open", "High", "Low", "Close"):
        out[column] = out[column].map(_price)
    out["Volume"] = out["Volume"].fillna(0).astype("int64")
    label = display_symbol(symbol)
    venue = "NSE/BSE via Upstox"
    header = (
        f"# Stock data for {label} ({yahoo_symbol(symbol)}) from {start_date} to {end_date}\n"
        f"# Source: {venue}; currency INR; prices are exchange prints\n"
        f"# Total records: {len(out)}\n\n"
    )
    return header + out.to_csv(index=False)


def _bulk_indicator(symbol: str, indicator: str, as_of_date: str) -> dict[str, str]:
    frame = _to_frame(symbol, as_of_date, as_of_date)
    frame = frame[frame["Date"].dt.strftime("%Y-%m-%d") <= as_of_date]
    if len(frame) < 20:
        raise NoMarketDataError(symbol, symbol, "not enough history to compute indicators")
    data = frame.copy()
    stats = wrap(data)
    stats[indicator]  # triggers the column
    stats["Date"] = pd.to_datetime(stats["Date"]).dt.strftime("%Y-%m-%d")
    values: dict[str, str] = {}
    for _, row in stats.iterrows():
        value = row[indicator]
        values[row["Date"]] = "N/A" if pd.isna(value) else f"{float(value):.4f}"
    return values


def get_stock_stats_indicators_window(
    symbol: str,
    indicator: str,
    as_of_date: str,
    look_back_days: int,
) -> str:
    """A single technical indicator over a trailing calendar window."""
    indicator = (indicator or "").strip().lower()
    if indicator in {"close_5_sma", "sma", "sma_5"}:
        indicator = "close_50_sma"
    if indicator not in INDICATOR_DESCRIPTIONS:
        raise ValueError(
            f"Indicator {indicator} is not supported. Choose from: {list(INDICATOR_DESCRIPTIONS)}"
        )
    as_of_dt = datetime.strptime(as_of_date, "%Y-%m-%d")
    before = as_of_dt - relativedelta(days=int(look_back_days or 30))
    values = _bulk_indicator(symbol, indicator, as_of_date)

    rows: list[str] = []
    cursor = as_of_dt
    while cursor >= before:
        key = cursor.strftime("%Y-%m-%d")
        value = values.get(key, "N/A: Not a trading day (weekend or holiday)")
        rows.append(f"{key}: {value}")
        cursor -= relativedelta(days=1)

    return (
        f"## {indicator} values from {before.strftime('%Y-%m-%d')} to {as_of_date} "
        f"(source: Upstox candles, INR):\n\n"
        + "\n".join(rows)
        + "\n\n"
        + INDICATOR_DESCRIPTIONS[indicator]
    )


def build_verified_snapshot(symbol: str, as_of_date: str, look_back_days: int = 30) -> str:
    """Deterministic ground truth for exact numeric claims, from Upstox prints."""
    frame = _to_frame(symbol, as_of_date, as_of_date)
    frame = frame[frame["Date"].dt.strftime("%Y-%m-%d") <= as_of_date].copy()
    if frame.empty:
        raise NoMarketDataError(symbol, symbol, f"no price rows on or before {as_of_date}")

    stats = wrap(frame.copy())
    for name in ("close_10_ema", "close_50_sma", "close_200_sma", "rsi", "macd", "macds", "atr"):
        stats[name]
    latest = frame.iloc[-1]
    latest_date = frame["Date"].iloc[-1].strftime("%Y-%m-%d")
    previous = frame.iloc[-2] if len(frame) > 1 else None
    last_stats = stats.iloc[-1]

    def metric(name: str) -> str:
        value = last_stats.get(name)
        if value is None or pd.isna(value):
            return "N/A"
        return f"{float(value):.2f}"

    lines = [
        f"# Verified market snapshot: {display_symbol(symbol)} ({yahoo_symbol(symbol)})",
        f"- Vendor: Upstox (NSE/BSE, INR); data as of {latest_date} (requested {as_of_date}).",
        "",
        "## Latest candle",
        f"- Date: {latest_date}",
        f"- Open: {_price(latest['Open'])}",
        f"- High: {_price(latest['High'])}",
        f"- Low: {_price(latest['Low'])}",
        f"- Close: {_price(latest['Close'])}",
        f"- Volume: {int(latest.get('Volume') or 0):,}",
        f"- Open Interest: {int(latest.get('OI') or 0):,}",
    ]
    if previous is not None:
        prev_close = float(previous["Close"])
        change = float(latest["Close"]) - prev_close
        pct = (change / prev_close * 100) if prev_close else 0.0
        lines.append(
            f"- Previous close ({previous['Date'].strftime('%Y-%m-%d')}): {_price(prev_close)}"
        )
        lines.append(f"- Change: {change:+.2f} INR ({pct:+.2f}%)")
    lines += [
        "",
        "## Indicator values on the latest candle",
        f"- 10 EMA: {metric('close_10_ema')}",
        f"- 50 SMA: {metric('close_50_sma')}",
        f"- 200 SMA: {metric('close_200_sma')}",
        f"- RSI(14): {metric('rsi')}",
        f"- MACD: {metric('macd')} / signal {metric('macds')}",
        f"- ATR: {metric('atr')}",
        "",
        f"## Recent closes (last {min(int(look_back_days or 30), 30)} rows)",
    ]
    recent = frame.tail(min(int(look_back_days or 30), 30))
    for _, row in recent.iterrows():
        lines.append(f"- {row['Date'].strftime('%Y-%m-%d')}: {_price(row['Close'])}")
    lines += [
        "",
        "Treat this snapshot as the source of truth for exact price, level and indicator claims. "
        "If another tool disagrees, flag the discrepancy instead of reconciling it by invention.",
    ]
    return "\n".join(lines)


def quote(symbol: str) -> dict:
    """One normalized quote, frozen at the last official close when the market is shut."""
    instrument = upstox.master.resolve(symbol)
    if instrument is None:
        # Fall back to the last traded price through a direct key search.
        raise NoMarketDataError(symbol, symbol, "instrument not found")
    payload = upstox.quotes([instrument.instrument_key]).get(instrument.instrument_key)
    if not payload:
        raise NoMarketDataError(symbol, instrument.instrument_key, "empty quote")
    state = session_state()
    last_price = payload.get("last_price")
    # Upstox's ``ohlc.close`` is the latest traded close, not the previous
    # session's close. ``net_change`` is the change against the previous close,
    # so derive it rather than mislabeling today's close as yesterday's.
    net_change = payload.get("net_change")
    if last_price is not None and net_change is not None:
        prev_close = float(last_price) - float(net_change)
    else:
        prev_close = (payload.get("ohlc") or {}).get("close")
    if not state.is_open:
        frozen = True
        last_price = last_price if last_price is not None else prev_close
    else:
        frozen = False
    change = (last_price - prev_close) if last_price is not None and prev_close else None
    pct = (change / prev_close * 100) if change is not None and prev_close else None
    return {
        "symbol": instrument.trading_symbol,
        "name": instrument.name or instrument.short_name,
        "instrument_key": instrument.instrument_key,
        "last_price": last_price,
        "previous_close": prev_close,
        "change": change,
        "change_percent": pct,
        "open": (payload.get("ohlc") or {}).get("open"),
        "high": (payload.get("ohlc") or {}).get("high"),
        "low": (payload.get("ohlc") or {}).get("low"),
        "volume": payload.get("volume"),
        "oi": payload.get("oi"),
        "depth": payload.get("depth"),
        "last_trade_time": payload.get("last_trade_time"),
        "frozen": frozen,
        "session": state.phase,
        "source": "upstox",
    }


def freeze_previous_close(symbol: str) -> float | None:
    """The last official daily close, used by the paper-trading server when shut."""
    try:
        instrument_key = upstox.resolve_instrument_key(symbol)
        payload = upstox.quotes([instrument_key]).get(instrument_key) or {}
        last_price = payload.get("last_price")
        net_change = payload.get("net_change")
        # Same derivation as ``quote``: ``ohlc.close`` is the latest print, not
        # the previous session, so subtracting ``net_change`` is the only way to
        # keep the dashboard's day-change consistent across both paths.
        if last_price is not None and net_change is not None:
            return float(last_price) - float(net_change)
        return (payload.get("ohlc") or {}).get("close") or last_price
    except Exception as exc:
        logger.info("Could not read previous close for %s: %s", symbol, exc)
        return None


def market_snapshot() -> dict:
    """Session metadata plus benchmark quotes, for the dashboard header."""
    state = session_state()
    keys = ["NSE_INDEX|Nifty 50", "NSE_INDEX|Nifty Bank", "BSE_INDEX|SENSEX", "NSE_INDEX|India VIX"]
    quotes = upstox.quotes(keys)
    indices = []
    names = {
        "NSE_INDEX|Nifty 50": "NIFTY 50",
        "NSE_INDEX|Nifty Bank": "BANKNIFTY",
        "BSE_INDEX|SENSEX": "SENSEX",
        "NSE_INDEX|India VIX": "INDIA VIX",
    }
    for key in keys:
        row = quotes.get(key)
        if not row:
            continue
        last = row.get("last_price")
        net_change = row.get("net_change")
        prev = (
            float(last) - float(net_change)
            if last is not None and net_change is not None
            else (row.get("ohlc") or {}).get("close")
        )
        price = last if last is not None else prev
        change = (price - prev) if price is not None and prev else None
        indices.append({
            "key": key,
            "name": names[key],
            "last_price": price,
            "previous_close": prev,
            "change": change,
            "change_percent": (change / prev * 100) if change is not None and prev else None,
        })
    return {
        "session": state.as_dict(),
        "indices": indices,
        "last_close_date": last_completed_session().isoformat(),
        "today": get_current_date(),
    }
