"""Indian fundamentals: Screener.in primary, Yahoo statements as fallback.

Screener gives what Indian analysts actually read -- ROCE/ROE, book value,
quarterly results, balance sheet, cash flow and the FII/DII shareholding trend
-- in one page. The parser below is deliberately structural (ids, table rows,
``data-date-key`` headers) rather than positional, so a cosmetic change to the
page does not silently mislabel a number.

Every table is filtered to columns published on or before the analysis date, so
a historical run never reads a quarter that had not been reported yet. When
Screener blocks or changes shape, the Yahoo statement vendors take over through
the router, and if both fail the call raises ``VendorUnavailableError`` rather
than returning invented numbers.
"""

from __future__ import annotations

import json
import logging
import re
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

import requests
from bs4 import BeautifulSoup

from tradingagents.dataflows.config import get_config
from tradingagents.dataflows.errors import (
    NoMarketDataError,
    VendorUnavailableError,
)
from tradingagents.dataflows.vendors.india.instruments import nse_symbol, quote_links

logger = logging.getLogger(__name__)

_SCREENER = "https://www.screener.in"
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Accept-Language": "en-IN,en;q=0.9",
}
_CACHE_TTL = timedelta(hours=6)

_SECTION_TITLES = {
    "quarters": "Quarterly Results",
    "profit-loss": "Profit & Loss (annual)",
    "balance-sheet": "Balance Sheet (annual)",
    "cash-flow": "Cash Flow (annual)",
    "ratios": "Financial Ratios (annual)",
    "shareholding": "Shareholding Pattern",
}


def _cache_dir() -> Path:
    base = Path(get_config().get("data_cache_dir") or Path.home() / ".tradingagents" / "cache")
    path = base / "screener"
    path.mkdir(parents=True, exist_ok=True)
    return path


@dataclass
class ScreenerPage:
    symbol: str
    name: str
    url: str
    html: str
    fetched_at: datetime
    stale: bool = False


def _search_company(symbol: str) -> tuple[str, str]:
    """Screener's best match as (path, name). Raises when the search fails."""
    response = requests.get(
        f"{_SCREENER}/api/company/search/",
        params={"q": nse_symbol(symbol)},
        headers=_HEADERS,
        timeout=20,
    )
    if response.status_code == 429:
        raise VendorUnavailableError("Screener search rate-limited")
    response.raise_for_status()
    rows = response.json()
    if not rows:
        raise NoMarketDataError(symbol, nse_symbol(symbol), "Screener search returned no company")
    ticker = nse_symbol(symbol)
    # Prefer the row whose URL carries the exact ticker; fall back to the first.
    chosen = next(
        (row for row in rows if f"/company/{ticker}/" in str(row.get("url", "")).upper()),
        rows[0],
    )
    return str(chosen.get("url") or ""), str(chosen.get("name") or ticker)


def load_screener_page(symbol: str, max_age: timedelta = _CACHE_TTL) -> ScreenerPage:
    """Fetch (and cache) a Screener company page, tolerating a stale cache on failure."""
    ticker = nse_symbol(symbol)
    cache = _cache_dir() / f"{re.sub(r'[^A-Z0-9_-]', '_', ticker)}.json"
    if cache.exists():
        try:
            payload = json.loads(cache.read_text(encoding="utf-8"))
            fetched = datetime.fromisoformat(payload["fetched_at"])
            if datetime.now() - fetched < max_age:
                return ScreenerPage(ticker, payload["name"], payload["url"], payload["html"], fetched)
        except (OSError, ValueError, KeyError):
            pass

    try:
        path, name = _search_company(symbol)
        if not path:
            raise NoMarketDataError(symbol, ticker, "Screener returned no company URL")
        url = f"{_SCREENER}{path}"
        response = requests.get(url, headers=_HEADERS, timeout=30)
        if response.status_code == 429:
            raise VendorUnavailableError("Screener page rate-limited")
        response.raise_for_status()
        page = ScreenerPage(ticker, name, url, response.text, datetime.now())
        cache.write_text(
            json.dumps(
                {
                    "symbol": ticker,
                    "name": name,
                    "url": url,
                    "html": response.text,
                    "fetched_at": page.fetched_at.isoformat(),
                }
            ),
            encoding="utf-8",
        )
        return page
    except Exception as exc:
        if cache.exists():
            try:
                payload = json.loads(cache.read_text(encoding="utf-8"))
                logger.warning("Screener unavailable for %s (%s); serving cached page", ticker, exc)
                return ScreenerPage(
                    ticker,
                    payload.get("name", ticker),
                    payload.get("url", ""),
                    payload["html"],
                    datetime.fromisoformat(payload["fetched_at"]),
                    stale=True,
                )
            except (OSError, ValueError, KeyError):
                pass
        if isinstance(exc, (NoMarketDataError, VendorUnavailableError)):
            raise
        raise VendorUnavailableError(f"Screener unavailable for {ticker}: {exc}") from exc


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def _top_ratios(soup: BeautifulSoup) -> dict[str, str]:
    ratios: dict[str, str] = {}
    for item in soup.select("#top-ratios li"):
        name = item.select_one(".name")
        value = item.select_one(".value")
        if name and value:
            ratios[_clean(name.get_text(" "))] = _clean(value.get_text(" "))
    return ratios


def _parse_table(table) -> tuple[list[str], list[tuple[str, list[str]]]]:
    """A Screener table as (column labels, [(row label, values)])."""
    if table is None:
        return [], []
    headers: list[str] = []
    head_row = table.select_one("thead tr")
    if head_row:
        for cell in head_row.select("th"):
            label = _clean(cell.get_text(" "))
            key = cell.get("data-date-key") or label
            headers.append(f"{label}|{key}" if cell.get("data-date-key") else label)
    rows: list[tuple[str, list[str]]] = []
    for tr in table.select("tbody tr"):
        cells = tr.select("td, th")
        if not cells:
            continue
        label = _clean(cells[0].get_text(" "))
        label = re.sub(r"\s*\+\s*$", "", label)
        values = [_clean(cell.get_text(" ")) for cell in cells[1:]]
        rows.append((label, values))
    return headers, rows


def _header_label(header: str) -> str:
    return header.split("|", 1)[0]


def _header_date(header: str) -> str | None:
    if "|" in header:
        key = header.split("|", 1)[1]
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", key):
            return key
    return None


def _filter_columns(headers: list[str], rows: list[tuple[str, list[str]]], as_of: str | None):
    """Keep columns published by ``as_of``; undated columns (TTM) only for live runs."""
    if not as_of:
        return headers, rows
    today = datetime.now().strftime("%Y-%m-%d")
    keep: list[int] = []
    for index, header in enumerate(headers):
        header_date = _header_date(header)
        if header_date:
            if header_date <= as_of:
                keep.append(index)
        elif header.strip().lower() in {"ttm", ""} and as_of >= today:
            # TTM has no publication date; it is only safe for a live run.
            keep.append(index)
    if not keep:
        keep = list(range(min(4, len(headers))))
    filtered_headers = [headers[i] for i in keep]
    filtered_rows = [(label, [values[i] if i < len(values) else "" for i in keep]) for label, values in rows]
    return filtered_headers, filtered_rows


def _markdown_table(headers: list[str], rows: list[tuple[str, list[str]]], max_columns: int = 8) -> str:
    if not headers or not rows:
        return "_No table available._"
    headers = headers[-max_columns:]
    rows = [(label, values[-max_columns:]) for label, values in rows]
    lines = ["| Item | " + " | ".join(_header_label(h) or "TTM" for h in headers) + " |"]
    lines.append("|---|" + "---|" * len(headers))
    for label, values in rows:
        padded = values + [""] * (len(headers) - len(values))
        lines.append(f"| {label} | " + " | ".join(padded) + " |")
    return "\n".join(lines)


def _section(soup: BeautifulSoup, section_id: str):
    section = soup.select_one(f"section#{section_id}")
    return section.select_one("table") if section else None


def _profile(soup: BeautifulSoup) -> str:
    block = soup.select_one(".company-profile")
    if not block:
        return ""
    text = _clean(block.get_text(" "))
    text = re.sub(r"^About\s+", "", text)
    return text[:1800]


def _shareholding_summary(soup: BeautifulSoup, as_of: str | None) -> str:
    headers, rows = _parse_table(_section(soup, "shareholding"))
    if not rows:
        return "_Shareholding pattern unavailable._"
    headers, rows = _filter_columns(headers, rows, as_of)
    lines = []
    for label, values in rows:
        if not values:
            continue
        latest = values[-1] if values else ""
        previous = values[-2] if len(values) > 1 else ""
        lines.append(f"- {label}: {latest}" + (f" (previous quarter {previous})" if previous else ""))
    return "\n".join(lines)


def _insider_summary(soup: BeautifulSoup, as_of: str | None) -> str:
    """Promoter and institutional holding movement, the Indian insider signal."""
    headers, rows = _parse_table(_section(soup, "shareholding"))
    if not rows:
        return "Promoter / institutional shareholding data unavailable from Screener."
    headers, rows = _filter_columns(headers, rows, as_of)
    labels = {label.lower(): (label, values) for label, values in rows}
    out = [
        "# Promoter and institutional holding changes (Screener shareholding pattern)",
        "",
        "Indian disclosure equivalent of insider activity: promoter and large-institution",
        "stake changes are reported every quarter. A falling promoter stake or rising",
        "pledge is a governance signal; sustained FII buying is a flow signal.",
        "",
    ]
    for key in ("promoters", "fiis", "diis"):
        if key not in labels:
            continue
        label, values = labels[key]
        if not values:
            continue
        latest = values[-1]
        oldest = values[0]
        delta = "n/a"
        try:
            delta = f"{float(latest.rstrip('%')) - float(oldest.rstrip('%')):+.2f} pp"
        except ValueError:
            pass
        out.append(f"- {label}: latest {latest}; change over window {delta} (window start {oldest})")
    out.append("")
    out.append(_markdown_table(headers, [labels[k] for k in ("promoters", "fiis", "diis") if k in labels], 6))
    return "\n".join(out)


def get_fundamentals(ticker: str, curr_date: str | None = None) -> str:
    """Comprehensive Indian fundamental report for a company."""
    page = load_screener_page(ticker)
    soup = BeautifulSoup(page.html, "html.parser")
    ratios = _top_ratios(soup)
    links = quote_links(ticker)
    profile = _profile(soup)

    ratio_lines = "\n".join(f"- **{name}**: {value}" for name, value in ratios.items())
    quarters_headers, quarters_rows = _filter_columns(
        *_parse_table(_section(soup, "quarters")), curr_date
    )
    annual_headers, annual_rows = _filter_columns(
        *_parse_table(_section(soup, "profit-loss")), curr_date
    )
    balance_headers, balance_rows = _filter_columns(
        *_parse_table(_section(soup, "balance-sheet")), curr_date
    )
    cash_headers, cash_rows = _filter_columns(
        *_parse_table(_section(soup, "cash-flow")), curr_date
    )
    ratio_headers, ratio_rows = _filter_columns(
        *_parse_table(_section(soup, "ratios")), curr_date
    )

    source_note = (
        f"Screener.in ({page.url})"
        + (" -- served from cache because the live page was unreachable" if page.stale else "")
    )
    lines = [
        f"# Fundamental analysis: {page.name} ({nse_symbol(ticker)})",
        f"- As of: {curr_date or datetime.now().strftime('%Y-%m-%d')} (tables filtered to reports published by this date)",
        f"- Source: {source_note}",
        f"- Currency: INR (Indian GAAP / Ind AS, consolidated unless only standalone is published)",
        f"- Cross-checks: {links['nse']} | {links['moneycontrol']}",
        "",
        "## Company profile",
        profile or "_Profile not published on the Screener page._",
        "",
        "## Key ratios (Screener top ratios)",
        ratio_lines or "_No ratios parsed._",
        "",
        "## Quarterly results (INR crore)",
        _markdown_table(quarters_headers, quarters_rows),
        "",
        "## Profit & loss, annual (INR crore)",
        _markdown_table(annual_headers, annual_rows),
        "",
        "## Balance sheet, annual (INR crore)",
        _markdown_table(balance_headers, balance_rows),
        "",
        "## Cash flow, annual (INR crore)",
        _markdown_table(cash_headers, cash_rows),
        "",
        "## Financial ratios, annual",
        _markdown_table(ratio_headers, ratio_rows),
        "",
        "## Shareholding pattern and FII / DII flows",
        _shareholding_summary(soup, curr_date),
        "",
        "## How to read this (Indian market hooks)",
        "- ROCE above ~15% with stable margins is the quality screen Indian institutions apply; "
        "ROE is flattered by leverage, so read it with debt-to-equity from the balance sheet.",
        "- FII and DII columns are the flow signal: sustained FII selling with DII absorption caps "
        "drawdowns, while both selling together usually precedes index-level weakness.",
        "- Promoter stake changes and pledging are governance signals specific to Indian equities.",
        "- Quarterly sales/PAT growth should be compared YoY, not QoQ, because Indian demand is seasonal.",
        "",
        "All figures are vendor-reported. Do not estimate a missing number; report it as unavailable.",
    ]
    return "\n".join(lines)


def _statement(ticker: str, section: str, title: str, curr_date: str | None) -> str:
    page = load_screener_page(ticker)
    soup = BeautifulSoup(page.html, "html.parser")
    headers, rows = _filter_columns(*_parse_table(_section(soup, section)), curr_date)
    if not rows:
        raise NoMarketDataError(ticker, nse_symbol(ticker), f"Screener has no {section} table")
    return "\n".join(
        [
            f"# {title}: {page.name} ({nse_symbol(ticker)})",
            f"- Source: Screener.in ({page.url}); INR crore unless stated.",
            f"- As of: {curr_date or 'latest published'}",
            "",
            _markdown_table(headers, rows, max_columns=10),
            "",
            "Report only the rows present above; do not interpolate missing quarters.",
        ]
    )


def get_balance_sheet(ticker: str, freq: str = "quarterly", curr_date: str | None = None) -> str:
    section = "balance-sheet"
    return _statement(ticker, section, f"Balance sheet ({freq})", curr_date)


def get_cashflow(ticker: str, freq: str = "quarterly", curr_date: str | None = None) -> str:
    return _statement(ticker, "cash-flow", f"Cash flow ({freq})", curr_date)


def get_income_statement(ticker: str, freq: str = "quarterly", curr_date: str | None = None) -> str:
    section = "quarters" if str(freq).lower().startswith("q") else "profit-loss"
    return _statement(ticker, section, f"Income statement ({freq})", curr_date)


def get_insider_transactions(ticker: str, curr_date: str | None = None) -> str:
    page = load_screener_page(ticker)
    soup = BeautifulSoup(page.html, "html.parser")
    return _insider_summary(soup, curr_date)
