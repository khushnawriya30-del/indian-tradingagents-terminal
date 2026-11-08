"""Community / retail sentiment inputs for Indian tickers.

The upstream sentiment analyst reads StockTwits cashtags and US subreddits, neither of
which says anything useful about an NSE stock. For ``.NS`` / ``.BO`` symbols and the
Indian indices this module supplies:

* Indian communities on Reddit: r/IndianStockMarket, r/IndiaInvestments,
  r/DalalStreetTalks, r/StockMarketIndia, searched by the bare NSE symbol
  (``RELIANCE``, not ``RELIANCE.NS``).
* A "Dalal Street chatter" block built from headlines about brokerage calls, targets,
  FII/DII activity and market mood. These are news headlines. They are not forum
  posts, carry no Bullish/Bearish tags, and the block says so, because Moneycontrol's
  forum has no public feed and nothing is scraped from behind a login.
"""

from __future__ import annotations

from datetime import datetime

from tradingagents.dataflows.date_window import in_window
from tradingagents.dataflows.errors import VendorUnavailableError
from tradingagents.dataflows.vendors.india import news as india_news
from tradingagents.dataflows.vendors.india.instruments import INDEX_KEYS, InstrumentMaster

INDIA_SUBREDDITS = ("IndianStockMarket", "IndiaInvestments", "DalalStreetTalks", "StockMarketIndia")

CHATTER_NOTE = (
    "NOTE: StockTwits is not used for Indian listings (its cashtag stream is US-centric). "
    "This block holds Dalal Street headlines on brokerage calls, targets, FII/DII flows and "
    "market mood. They are news headlines, not forum posts: there are no user Bullish/Bearish "
    "tags, so ignore the Bullish/Bearish ratio guidance for this source and weigh it as "
    "institutional / broker framing."
)


def is_indian_ticker(ticker: str) -> bool:
    text = (ticker or "").strip().upper()
    return text.endswith((".NS", ".BO")) or text.replace(" ", "") in INDEX_KEYS


def reddit_query(ticker: str) -> str:
    """The bare symbol Indian communities actually write (``TCS``, not ``TCS.NS``)."""
    base, _ = InstrumentMaster.split_symbol(ticker)
    return base


def fetch_dalal_street_chatter(ticker: str, start_date: str, end_date: str, limit: int = 15) -> str:
    """Prompt-ready block of Dalal Street headlines for ``ticker`` in the window."""
    base = reddit_query(ticker)
    topic = '("brokerage" OR "target price" OR "FII" OR "DII" OR "Dalal Street" OR "buy" OR "sell" OR "outlook")'
    query = india_news._window_query(f'"{base}" {topic}', start_date, end_date)
    try:
        items = india_news._dedupe(india_news._fetch(query))
    except VendorUnavailableError as exc:
        return f"<Dalal Street headlines unavailable: {exc}>"
    start_dt = datetime.strptime(start_date, "%Y-%m-%d")
    end_dt = datetime.strptime(end_date, "%Y-%m-%d")
    items = [i for i in items if in_window(i["pub_date"], start_dt, end_dt)]
    items.sort(key=lambda i: i["pub_date"] or datetime.min, reverse=True)
    items = items[:limit]
    if not items:
        return f"{CHATTER_NOTE}\n\n<no Dalal Street headlines about {base} in {start_date}..{end_date}>"
    return f"{CHATTER_NOTE}\n\n{india_news._format(items)}"
