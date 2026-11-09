"""Indian financial news and sentiment sources.

Replaces the US news stack with the wires Indian desks actually read:

* Economic Times Markets and Stocks
* Moneycontrol latest and market reports
* Mint markets
* CNBC-TV18 markets and business
* Zee Business markets
* Google News India, queried per company and per macro theme

All feeds are RSS/Atom, fetched with a short in-process cache, parsed without a
third-party parser, deduplicated by title, and filtered to the analysis window
so a historical run cannot read tomorrow's headline. A feed that fails is
reported as unavailable, never as "no news".
"""

from __future__ import annotations

import html
import logging
import re
import threading
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from email.utils import parsedate_to_datetime
from urllib.parse import quote_plus

import requests

from tradingagents.dataflows.config import get_config
from tradingagents.dataflows.date_window import coverage_gap, in_window
from tradingagents.dataflows.errors import VendorUnavailableError
from tradingagents.dataflows.vendors.india.instruments import nse_symbol
from tradingagents.dataflows.vendors.india import upstox_client as upstox

logger = logging.getLogger(__name__)

FEEDS = {
    "ET Markets": "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms",
    "ET Stocks": "https://economictimes.indiatimes.com/markets/stocks/rssfeeds/2146842.cms",
    "Moneycontrol": "https://www.moneycontrol.com/rss/latestnews.xml",
    "Moneycontrol Markets": "https://www.moneycontrol.com/rss/marketreports.xml",
    "Mint Markets": "https://www.livemint.com/rss/markets",
    "CNBC-TV18": "https://www.cnbctv18.com/commonfeeds/v1/cne/rss/market.xml",
    "CNBC-TV18 Business": "https://www.cnbctv18.com/commonfeeds/v1/cne/rss/business.xml",
    "Zee Business": "https://www.zeebiz.com/rss/markets.xml",
}

GOOGLE_NEWS = "https://news.google.com/rss/search"

MACRO_QUERIES = [
    "RBI repo rate inflation India",
    "Nifty Sensex market outlook FII DII",
    "India GDP IIP CPI WPI data",
    "rupee dollar crude oil India markets",
    "SEBI IPO policy India stock market",
]

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Accept": "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
}


@dataclass
class Article:
    title: str
    link: str
    source: str
    published: datetime | None
    summary: str = ""

    def as_markdown(self) -> str:
        stamp = self.published.astimezone(UTC).strftime("%Y-%m-%d %H:%M UTC") if self.published else "undated"
        summary = re.sub(r"\s+", " ", self.summary or "").strip()
        if len(summary) > 320:
            summary = summary[:317] + "..."
        line = f"- **{self.title}** -- {self.source}, {stamp}"
        if summary:
            line += f"\n  {summary}"
        if self.link:
            line += f"\n  <{self.link}>"
        return line


_cache: dict[str, tuple[float, str]] = {}
_cache_lock = threading.Lock()
_CACHE_SECONDS = 600


def _fetch(url: str, timeout: float = 15.0) -> str:
    with _cache_lock:
        cached = _cache.get(url)
        if cached and time.time() - cached[0] < _CACHE_SECONDS:
            return cached[1]
    response = requests.get(url, headers=_HEADERS, timeout=timeout)
    response.raise_for_status()
    text = response.text
    with _cache_lock:
        _cache[url] = (time.time(), text)
    return text


def _text(node, *names: str) -> str:
    for name in names:
        found = node.find(name)
        if found is not None and (found.text or "").strip():
            return html.unescape(found.text.strip())
    return ""


def _published(node) -> datetime | None:
    raw = _text(node, "pubDate", "published", "updated", "{http://purl.org/dc/elements/1.1/}date")
    if not raw:
        return None
    try:
        parsed = parsedate_to_datetime(raw)
        return parsed.astimezone(UTC) if parsed.tzinfo else parsed.replace(tzinfo=UTC)
    except (TypeError, ValueError):
        pass
    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d"):
        try:
            parsed = datetime.strptime(raw, fmt)
            return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)
        except ValueError:
            continue
    return None


def parse_feed(xml_text: str, source: str, limit: int = 40) -> list[Article]:
    try:
        root = ET.fromstring(xml_text.encode("utf-8") if isinstance(xml_text, str) else xml_text)
    except ET.ParseError as exc:
        raise VendorUnavailableError(f"{source} returned malformed XML: {exc}") from exc
    items = root.findall(".//item") or root.findall(".//{http://www.w3.org/2005/Atom}entry")
    articles: list[Article] = []
    for item in items[:limit]:
        title = _text(item, "title")
        if not title:
            continue
        link = _text(item, "link")
        if not link:
            link_node = item.find("{http://www.w3.org/2005/Atom}link")
            link = link_node.get("href", "") if link_node is not None else ""
        summary = _text(item, "description", "summary", "content")
        summary = re.sub(r"<[^>]+>", " ", summary)
        articles.append(Article(title, link, source, _published(item), summary))
    return articles


def _dedupe(articles: list[Article]) -> list[Article]:
    seen: set[str] = set()
    out: list[Article] = []
    for article in articles:
        key = re.sub(r"[^a-z0-9 ]", "", article.title.lower())[:90]
        if key in seen:
            continue
        seen.add(key)
        out.append(article)
    return out


def _company_aliases(ticker: str) -> list[str]:
    symbol = nse_symbol(ticker)
    aliases = {symbol, symbol.replace("&", "and")}
    instrument = upstox.master.resolve(ticker)
    if instrument is not None and instrument.name:
        name = instrument.name
        aliases.add(name)
        cleaned = re.sub(
            r"\b(ltd|limited|industries|corporation|corp|company|co|plc|inc)\b\.?",
            "",
            name,
            flags=re.IGNORECASE,
        )
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        if len(cleaned) > 2:
            aliases.add(cleaned)
    return [a for a in aliases if a]


def _matches(article: Article, aliases: list[str]) -> bool:
    haystack = f"{article.title} {article.summary}".lower()
    return any(alias.lower() in haystack for alias in aliases)


def fetch_company_news(ticker: str, limit: int = 20) -> list[Article]:
    """Articles about one company from Google News India plus the ET/MC wires."""
    aliases = _company_aliases(ticker)
    query = quote_plus(f"({' OR '.join(aliases[:3])}) NSE stock")
    url = f"{GOOGLE_NEWS}?q={query}&hl=en-IN&gl=IN&ceid=IN:en"
    articles: list[Article] = []
    errors: list[str] = []
    try:
        articles.extend(parse_feed(_fetch(url), "Google News India"))
    except Exception as exc:
        errors.append(f"Google News: {exc}")
    for name in ("ET Markets", "ET Stocks", "Moneycontrol", "Moneycontrol Markets", "Mint Markets"):
        try:
            feed = parse_feed(_fetch(FEEDS[name]), name)
            articles.extend(a for a in feed if _matches(a, aliases))
        except Exception as exc:
            errors.append(f"{name}: {exc}")
    if not articles and errors:
        raise VendorUnavailableError("; ".join(errors[:3]))
    return _dedupe(articles)[:limit]


def fetch_macro_news(limit: int = 10) -> list[Article]:
    articles: list[Article] = []
    errors: list[str] = []
    for query in MACRO_QUERIES:
        url = f"{GOOGLE_NEWS}?q={quote_plus(query)}&hl=en-IN&gl=IN&ceid=IN:en"
        try:
            articles.extend(parse_feed(_fetch(url), "Google News India"))
        except Exception as exc:
            errors.append(str(exc))
    for name in ("ET Markets", "Moneycontrol", "CNBC-TV18", "Mint Markets", "Zee Business"):
        try:
            articles.extend(parse_feed(_fetch(FEEDS[name]), name))
        except Exception as exc:
            errors.append(f"{name}: {exc}")
    if not articles and errors:
        raise VendorUnavailableError("; ".join(errors[:3]))
    articles.sort(key=lambda a: a.published or datetime.min.replace(tzinfo=UTC), reverse=True)
    return _dedupe(articles)[:limit]


def get_news(ticker: str, start_date: str, end_date: str) -> str:
    """Company news within the analysis window, as prompt-ready markdown."""
    articles = fetch_company_news(ticker, limit=40)
    start = datetime.strptime(start_date, "%Y-%m-%d").replace(tzinfo=UTC)
    end = datetime.strptime(end_date, "%Y-%m-%d").replace(tzinfo=UTC)
    kept = [a for a in articles if in_window(a.published, start, end)]
    gap = (
        coverage_gap([a.published for a in kept], start_date, end_date, "RSS wires", nse_symbol(ticker))
        if not kept
        else None
    )
    header = (
        f"# News for {nse_symbol(ticker)} ({start_date} to {end_date})\n"
        f"Sources: Economic Times Markets, Moneycontrol, Mint, CNBC-TV18, Zee Business, Google News India.\n"
        f"All times UTC. {len(kept)} articles in window.\n"
    )
    if gap:
        header += f"\n{gap}\n"
    body = "\n".join(a.as_markdown() for a in kept) if kept else "_No articles matched the window._"
    return header + "\n" + body


def get_global_news(curr_date: str, look_back_days: int | None = None, limit: int | None = None) -> str:
    """Indian macro and market-wide news for the news analyst."""
    config = get_config()
    days = int(look_back_days or config.get("global_news_lookback_days", 7))
    cap = int(limit or config.get("global_news_article_limit", 10))
    end = datetime.strptime(curr_date, "%Y-%m-%d").replace(tzinfo=UTC)
    start = end - timedelta(days=days)
    articles = fetch_macro_news(limit=max(cap * 4, 30))
    kept = [a for a in articles if in_window(a.published, start, end)][:cap]
    header = (
        f"# Indian market and macro news (last {days} days to {curr_date})\n"
        "Focus: RBI policy and liquidity, inflation and growth prints, FII/DII flows, "
        "index levels, rupee and crude, SEBI and IPO activity.\n"
    )
    body = "\n".join(a.as_markdown() for a in kept) if kept else "_No macro articles in window._"
    return header + "\n" + body


def news_digest(ticker: str, limit: int = 12) -> dict:
    """Latest company headlines for the dashboard's news panel."""
    try:
        articles = fetch_company_news(ticker, limit=limit)
    except VendorUnavailableError:
        articles = []
    return {
        "symbol": nse_symbol(ticker),
        "items": [
            {
                "title": a.title,
                "source": a.source,
                "link": a.link,
                "published": a.published.isoformat() if a.published else None,
                "summary": re.sub(r"\s+", " ", a.summary or "")[:240],
            }
            for a in articles[:limit]
        ],
    }
