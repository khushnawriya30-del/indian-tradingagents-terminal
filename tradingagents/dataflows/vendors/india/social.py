"""Indian retail sentiment: Dalal Street communities, cashtags and headlines.

The US sentiment stack reads r/wallstreetbets and StockTwits. Indian retail
concentrates in a smaller set of forums, so the sources are re-pointed while the
analytical rules stay identical:

* Reddit: r/IndianStreetBets, r/DalalStreetTalks, r/IndiaInvestments
* StockTwits: ``$RELIANCE`` and ``$RELIANCE.NS`` cashtags still carry Indian names
* News headlines: the Indian wires (see ``news.py``)

Fetchers degrade to an explicit ``<unavailable>`` marker; a throttled feed is
never reported as silence.
"""

from __future__ import annotations

import logging

from tradingagents.dataflows.date_window import coverage_gap
from tradingagents.dataflows.vendors.india.instruments import nse_symbol
from tradingagents.dataflows.vendors.india.news import fetch_company_news
from tradingagents.dataflows.vendors.reddit import fetch_reddit_posts
from tradingagents.dataflows.vendors.stocktwits import fetch_stocktwits_messages

logger = logging.getLogger(__name__)

INDIAN_SUBREDDITS = (
    "IndianStreetBets",
    "DalalStreetTalks",
    "IndiaInvestments",
    "IndianStockMarket",
)


def fetch_sentiment_bundle(ticker: str, start_date: str, end_date: str, screen=None) -> dict:
    """All three sentiment sources for one Indian ticker, ready for the prompt."""
    symbol = nse_symbol(ticker)

    reddit_block = fetch_reddit_posts(
        symbol,
        INDIAN_SUBREDDITS,
        start_date=start_date,
        end_date=end_date,
        screen=screen,
    )
    stocktwits_block = fetch_stocktwits_messages(
        symbol,
        limit=30,
        start_date=start_date,
        end_date=end_date,
        screen=screen,
    )
    try:
        articles = fetch_company_news(ticker, limit=20)
    except Exception as exc:
        logger.info("Indian headline block unavailable for %s: %s", symbol, exc)
        articles = []
    headline_lines = [
        f"- {article.title} ({article.source})" for article in articles
    ]
    news_block = "\n".join(headline_lines) if headline_lines else "<unavailable: Indian wires returned no headlines>"
    gap = coverage_gap(
        [a.published for a in articles], start_date, end_date, "Indian wires", symbol
    )
    if gap:
        news_block = f"{gap}\n{news_block}"

    return {
        "ticker": symbol,
        "subreddits": INDIAN_SUBREDDITS,
        "news_block": news_block,
        "stocktwits_block": stocktwits_block,
        "reddit_block": reddit_block,
    }
