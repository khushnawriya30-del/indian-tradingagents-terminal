"""Indian business news for the news and sentiment analysts.

Publishers covered: Moneycontrol, Economic Times (ET Markets), CNBC-TV18, Zee Business
and Mint, plus Google News India for everything else. They are all reached through
Google News RSS with ``site:`` filters. That is one stable, documented feed shape
(``news.google.com/rss/search``), it honours ``after:`` / ``before:`` operators so a
past-dated run gets news from its own window instead of today's, and it does not
depend on each publisher keeping its own RSS URLs alive.

Headlines carry the publisher name; article text is not fetched.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from time import mktime
from typing import Annotated
from urllib.parse import quote_plus

import feedparser
import requests

from tradingagents.dataflows.config import get_config
from tradingagents.dataflows.date_window import in_window
from tradingagents.dataflows.errors import VendorError, VendorUnavailableError
from tradingagents.dataflows.vendors.india.instruments import InstrumentMaster, get_master

logger = logging.getLogger(__name__)

GOOGLE_NEWS_RSS = "https://news.google.com/rss/search?q={query}&hl=en-IN&gl=IN&ceid=IN:en"
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; TradingAgentsIndia/1.0)"}

PUBLISHER_SITES = (
    "moneycontrol.com",
    "economictimes.indiatimes.com",
    "cnbctv18.com",
    "zeebiz.com",
    "livemint.com",
)

# Macro / market-wide queries for the news analyst (replaces the US-centric defaults).
INDIA_GLOBAL_NEWS_QUERIES = [
    "RBI repo rate monetary policy inflation India",
    "Sensex Nifty FII DII flows Dalal Street",
    "India GDP IIP CPI economic outlook",
    "crude oil rupee dollar India impact",
    "SEBI regulation Union Budget market",
]


def _site_clause() -> str:
    return "(" + " OR ".join(f"site:{s}" for s in PUBLISHER_SITES) + ")"


def _terms(ticker: str) -> str:
    """Search terms for a company: its symbol and, when known, its registered name."""
    base, _ = InstrumentMaster.split_symbol(ticker)
    terms = [f'"{base}"']
    try:
        name = get_master().resolve(ticker).name
    except VendorError:
        name = ""
    except Exception:  # offline master load etc.; the symbol alone still searches
        name = ""
    if name and name.upper() != base:
        terms.append(f'"{name}"')
    return "(" + " OR ".join(terms) + ")"


def _fetch(query: str, session=None) -> list[dict]:
    url = GOOGLE_NEWS_RSS.format(query=quote_plus(query))
    try:
        resp = (session or requests).get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
    except requests.RequestException as exc:
        raise VendorUnavailableError(f"Google News RSS unreachable: {type(exc).__name__}") from exc
    feed = feedparser.parse(resp.content)
    items = []
    for entry in feed.entries:
        published = None
        if getattr(entry, "published_parsed", None):
            published = datetime.fromtimestamp(mktime(entry.published_parsed))
        source = (entry.get("source") or {}).get("title") or ""
        title = entry.get("title", "").strip()
        if source and title.endswith(f" - {source}"):
            title = title[: -len(source) - 3]
        items.append({"title": title, "publisher": source or "Google News", "link": entry.get("link", ""),
                      "pub_date": published})
    return items


def _dedupe(items: list[dict]) -> list[dict]:
    seen: set[str] = set()
    out = []
    for item in items:
        key = item["title"].lower()[:90]
        if key and key not in seen:
            seen.add(key)
            out.append(item)
    return out


def _format(items: list[dict]) -> str:
    out = ""
    for it in items:
        when = f", {it['pub_date']:%Y-%m-%d}" if it["pub_date"] else ""
        out += f"### {it['title']} (source: {it['publisher']}{when})\n"
        if it["link"]:
            out += f"Link: {it['link']}\n"
        out += "\n"
    return out


def _window_query(base: str, start_date: str, end_date: str) -> str:
    # Google's ``before:`` is exclusive; extend by a day so end_date is covered.
    end_next = (datetime.strptime(end_date, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d")
    return f"{base} after:{start_date} before:{end_next}"


def get_news(
    ticker: Annotated[str, "ticker symbol, e.g. RELIANCE.NS"],
    start_date: Annotated[str, "Start date in yyyy-mm-dd format"],
    end_date: Annotated[str, "End date in yyyy-mm-dd format"],
) -> str:
    """Company news from the major Indian business publishers, within the window."""
    start_dt = datetime.strptime(start_date, "%Y-%m-%d")
    end_dt = datetime.strptime(end_date, "%Y-%m-%d")
    limit = get_config().get("news_article_limit", 20)
    terms = _terms(ticker)

    publisher_items = _fetch(_window_query(f"{terms} {_site_clause()}", start_date, end_date))
    general_items = _fetch(_window_query(f"{terms} (stock OR shares OR NSE OR BSE OR results)",
                                         start_date, end_date))
    items = [i for i in _dedupe(publisher_items + general_items)
             if in_window(i["pub_date"], start_dt, end_dt)]
    items.sort(key=lambda i: i["pub_date"] or datetime.min, reverse=True)
    items = items[:limit]
    if not items:
        return f"No news found for {ticker} between {start_date} and {end_date}"
    return (f"## {ticker} News (Indian business press: Moneycontrol, ET Markets, CNBC-TV18, Zee Business, "
            f"Mint, Google News India), from {start_date} to {end_date}:\n\n{_format(items)}")


def get_global_news(
    as_of_date: Annotated[str, "Current date in yyyy-mm-dd format"],
    look_back_days: int | None = None,
    limit: int | None = None,
) -> str:
    """Indian macro and market-wide headlines (RBI, FII/DII flows, inflation, rupee)."""
    config = get_config()
    look_back_days = look_back_days or config.get("global_news_lookback_days", 7)
    limit = limit or config.get("global_news_article_limit", 10)
    end_dt = datetime.strptime(as_of_date, "%Y-%m-%d")
    start_dt = end_dt - timedelta(days=look_back_days)
    start_date = start_dt.strftime("%Y-%m-%d")
    queries = config.get("india_global_news_queries") or INDIA_GLOBAL_NEWS_QUERIES

    collected: list[dict] = []
    failures = 0
    for q in queries:
        try:
            collected += _fetch(_window_query(f"{q} {_site_clause()}", start_date, as_of_date))
        except VendorUnavailableError:
            failures += 1
    if failures == len(queries):
        raise VendorUnavailableError("Google News RSS unreachable for every India macro query")
    items = [i for i in _dedupe(collected) if in_window(i["pub_date"], start_dt, end_dt)]
    items.sort(key=lambda i: i["pub_date"] or datetime.min, reverse=True)
    items = items[:limit]
    if not items:
        return f"No Indian market-wide news found between {start_date} and {as_of_date}"
    return f"## Indian Market & Macro News, from {start_date} to {as_of_date}:\n\n{_format(items)}"
