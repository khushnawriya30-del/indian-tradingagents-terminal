"""Fundamentals for Indian listings from Screener.in.

Screener publishes NSE/BSE company pages with the ratios Indian investors actually use:
P/E, ROCE, ROE, book value, quarterly results, annual P&L / balance sheet / cash flow
and the promoter / FII / DII shareholding trend. There is no official API, so the page
HTML is parsed, which is fragile by nature: selectors are isolated in this module and a
page that no longer parses raises ``VendorUnavailableError`` (the router then reports
the data as unavailable instead of letting an agent guess figures).

Screener serves present-day numbers only. Past-dated runs are therefore withheld through
the same point-in-time guards the Yahoo vendor uses, so a backtest cannot see the future.

Figures are in INR crore unless a row says otherwise.
"""

from __future__ import annotations

import logging
import re
import time
from typing import Annotated
from urllib.parse import quote

import requests
from bs4 import BeautifulSoup

from tradingagents.dataflows.date_window import (
    withhold_live_profile,
    withhold_undated_statements,
    withhold_undisclosed_trades,
)
from tradingagents.dataflows.errors import NoMarketDataError, VendorUnavailableError
from tradingagents.dataflows.vendors.india.instruments import InstrumentMaster

logger = logging.getLogger(__name__)

BASE = "https://www.screener.in/company/{symbol}/{variant}"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
                  "Chrome/124.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "en-IN,en;q=0.9",
}
PAGE_TTL_SECONDS = 1800
_PAGES: dict[str, tuple[float, BeautifulSoup]] = {}


# ---------------------------------------------------------------------- fetching
def _symbol_for_url(ticker: str) -> str:
    base, _exchange = InstrumentMaster.split_symbol(ticker)
    return quote(base, safe="")


def fetch_page(ticker: str, session: requests.Session | None = None) -> BeautifulSoup:
    """Company page, consolidated view first with a fall back to standalone."""
    symbol = _symbol_for_url(ticker)
    cached = _PAGES.get(symbol)
    if cached and time.time() - cached[0] < PAGE_TTL_SECONDS:
        return cached[1]
    http = session or requests
    for variant in ("consolidated/", ""):
        url = BASE.format(symbol=symbol, variant=variant)
        try:
            resp = http.get(url, headers=HEADERS, timeout=20)
        except requests.RequestException as exc:
            raise VendorUnavailableError(f"Screener.in unreachable: {type(exc).__name__}") from exc
        if resp.status_code == 404:
            continue
        if resp.status_code in (429, 403) or resp.status_code >= 500:
            raise VendorUnavailableError(f"Screener.in returned {resp.status_code}")
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "lxml")
        if soup.select_one("#top-ratios") is None:
            continue
        _PAGES[symbol] = (time.time(), soup)
        return soup
    raise NoMarketDataError(ticker, symbol, "company page not found on Screener.in")


# ----------------------------------------------------------------------- parsing
def parse_number(text: str | None) -> float | None:
    """``'1,23,456.7'`` / ``'12.5 %'`` / ``'-4'`` -> float, else None."""
    if text is None:
        return None
    cleaned = re.sub(r"[^\d.\-]", "", text.replace("−", "-"))
    if cleaned in ("", "-", ".", "-."):
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def top_ratios(soup: BeautifulSoup) -> dict[str, str]:
    out: dict[str, str] = {}
    for li in soup.select("#top-ratios li"):
        name = li.select_one(".name")
        value = li.select_one(".value")
        if name and value:
            out[name.get_text(" ", strip=True)] = re.sub(r"\s+", " ", value.get_text(" ", strip=True))
    return out


def section_table(soup: BeautifulSoup, section_id: str) -> tuple[list[str], dict[str, list[str]]]:
    """``(period headers, {row label: values})`` for a Screener data section."""
    section = soup.select_one(f"#{section_id}")
    table = section.select_one("table.data-table") if section else None
    if table is None:
        return [], {}
    headers = [th.get_text(" ", strip=True) for th in table.select("thead th")][1:]
    rows: dict[str, list[str]] = {}
    for tr in table.select("tbody tr"):
        cells = tr.find_all("td")
        if not cells:
            continue
        label = re.sub(r"\s*[+\-]$", "", cells[0].get_text(" ", strip=True)).strip()
        rows[label] = [c.get_text(" ", strip=True) for c in cells[1:]]
    return headers, rows


def _last(headers: list[str], rows: dict[str, list[str]], label: str) -> tuple[str | None, str | None]:
    values = rows.get(label)
    if not values or not headers:
        return None, None
    return headers[min(len(headers), len(values)) - 1], values[min(len(headers), len(values)) - 1]


def _render_table(title: str, headers: list[str], rows: dict[str, list[str]],
                  labels: list[str] | None = None, periods: int = 6) -> str:
    if not headers or not rows:
        return f"## {title}\n(not available)\n"
    cols = headers[-periods:]
    shown = labels or list(rows)
    lines = [f"## {title}", "| Item | " + " | ".join(cols) + " |", "|---|" + "---|" * len(cols)]
    for label in shown:
        if label not in rows:
            continue
        vals = rows[label][-periods:]
        vals = [""] * (len(cols) - len(vals)) + vals
        lines.append(f"| {label} | " + " | ".join(vals) + " |")
    return "\n".join(lines) + "\n"


def debt_to_equity(soup: BeautifulSoup) -> str | None:
    headers, rows = section_table(soup, "balance-sheet")
    borrowings = parse_number(_last(headers, rows, "Borrowings")[1])
    capital = parse_number(_last(headers, rows, "Equity Capital")[1])
    reserves = parse_number(_last(headers, rows, "Reserves")[1])
    if borrowings is None or capital is None or reserves is None or (capital + reserves) <= 0:
        return None
    return f"{borrowings / (capital + reserves):.2f}x"


def _heading(soup: BeautifulSoup, ticker: str) -> str:
    h1 = soup.select_one("h1")
    return h1.get_text(" ", strip=True) if h1 else ticker


# ------------------------------------------------------------- router entry points
def get_fundamentals(
    ticker: Annotated[str, "ticker symbol, e.g. TCS.NS"],
    as_of_date: Annotated[str, "analysis date in YYYY-MM-DD format"] = None,
):
    """Valuation, returns, margins, leverage, quarterly trend and shareholding."""
    label = ticker.upper()
    withheld = withhold_live_profile(as_of_date, label)
    if withheld:
        return withheld

    soup = fetch_page(ticker)
    ratios = top_ratios(soup)
    if not ratios:
        raise VendorUnavailableError("Screener.in page layout changed: no top ratios found")

    pl_h, pl_rows = section_table(soup, "profit-loss")
    q_h, q_rows = section_table(soup, "quarters")
    sh_h, sh_rows = section_table(soup, "shareholding")

    opm_period, opm = _last(pl_h, pl_rows, "OPM %")
    lines = [f"# Company Fundamentals for {label} (source: Screener.in, INR)", f"Name: {_heading(soup, ticker)}"]
    about = soup.select_one(".company-profile .about p, .about p")
    if about:
        lines.append(f"About: {about.get_text(' ', strip=True)[:400]}")
    lines.append("")
    lines.append("## Key ratios")
    for name, value in ratios.items():
        lines.append(f"{name}: {value}")
    de = debt_to_equity(soup)
    if de:
        lines.append(f"Debt to Equity (latest year, Borrowings / (Equity Capital + Reserves)): {de}")
    if opm:
        lines.append(f"Operating Margin (OPM, {opm_period}): {opm}%")
    lines.append("")
    pros = [li.get_text(" ", strip=True) for li in soup.select(".pros li")][:5]
    cons = [li.get_text(" ", strip=True) for li in soup.select(".cons li")][:5]
    if pros:
        lines.append("## Screener pros\n" + "\n".join(f"- {p}" for p in pros) + "\n")
    if cons:
        lines.append("## Screener cons\n" + "\n".join(f"- {c}" for c in cons) + "\n")
    lines.append(_render_table("Quarterly results (INR Cr)", q_h, q_rows,
                               ["Sales", "Expenses", "Operating Profit", "OPM %", "Net Profit", "EPS in Rs"], 6))
    lines.append(_render_table("Shareholding pattern (%)", sh_h, sh_rows,
                               ["Promoters", "FIIs", "DIIs", "Government", "Public"], 6))
    return "\n".join(lines)


def _statement(ticker: str, freq: str, as_of_date: str | None, title: str, section: str,
               quarterly_section: str | None = None) -> str:
    label = ticker.upper()
    withheld = withhold_undated_statements(as_of_date, label, title)
    if withheld:
        return withheld
    soup = fetch_page(ticker)
    use_quarterly = freq == "quarterly" and quarterly_section is not None
    headers, rows = section_table(soup, quarterly_section if use_quarterly else section)
    if not headers or not rows:
        raise NoMarketDataError(ticker, label, f"{title} table missing on Screener.in")
    note = "" if use_quarterly or freq == "annual" else (
        "Screener publishes this statement annually only; showing annual figures.\n"
    )
    return (f"# {title} for {label} ({'quarterly' if use_quarterly else 'annual'}, INR Cr, "
            f"source: Screener.in)\n{note}\n" + _render_table(title, headers, rows, periods=8))


def get_balance_sheet(
    ticker: Annotated[str, "ticker symbol"],
    freq: Annotated[str, "'annual' or 'quarterly'"] = "quarterly",
    as_of_date: Annotated[str, "current date in YYYY-MM-DD format"] = None,
):
    return _statement(ticker, freq, as_of_date, "Balance Sheet", "balance-sheet")


def get_cashflow(
    ticker: Annotated[str, "ticker symbol"],
    freq: Annotated[str, "'annual' or 'quarterly'"] = "quarterly",
    as_of_date: Annotated[str, "current date in YYYY-MM-DD format"] = None,
):
    return _statement(ticker, freq, as_of_date, "Cash Flow", "cash-flow")


def get_income_statement(
    ticker: Annotated[str, "ticker symbol"],
    freq: Annotated[str, "'annual' or 'quarterly'"] = "quarterly",
    as_of_date: Annotated[str, "current date in YYYY-MM-DD format"] = None,
):
    return _statement(ticker, freq, as_of_date, "Income Statement", "profit-loss", "quarters")


def get_insider_transactions(
    ticker: Annotated[str, "ticker symbol"],
    as_of_date: Annotated[str | None, "analysis date, yyyy-mm-dd"] = None,
):
    """Promoter / FII / DII holding trend.

    Screener does not publish SEBI PIT insider-trade disclosures, so the nearest honest
    signal it has is the shareholding pattern. The header says so, so the agent does not
    read it as individual insider trades.
    """
    label = ticker.upper()
    withheld = withhold_undisclosed_trades(as_of_date, label)
    if withheld:
        return withheld
    soup = fetch_page(ticker)
    headers, rows = section_table(soup, "shareholding")
    if not headers or not rows:
        raise NoMarketDataError(ticker, label, "shareholding table missing on Screener.in")
    return (
        f"# Ownership signals for {label} (source: Screener.in)\n"
        "Note: individual insider (SEBI PIT) trades are not available from this source; this is the "
        "quarterly shareholding pattern. A falling promoter stake or rising FII/DII stake is "
        "a change in ownership, not a named insider trade.\n\n"
        + _render_table("Shareholding pattern (%)", headers, rows,
                        ["Promoters", "FIIs", "DIIs", "Government", "Public"], 8)
    )
