"""Indian-market vendor layer: calendar, instruments, Upstox, Screener, news, routing.

Everything runs against fixtures: no test touches the network or a real token.
"""

from __future__ import annotations

from datetime import date, datetime

import pandas as pd
import pytest
import requests

from tradingagents.dataflows.errors import (
    NoMarketDataError,
    VendorNotConfiguredError,
    VendorUnavailableError,
)
from tradingagents.dataflows.vendors.india import (
    news as india_news,
    nse_calendar as cal,
    screener,
    social,
    upstox,
)
from tradingagents.dataflows.vendors.india.instruments import InstrumentMaster, set_master

IST = cal.IST


def at(y, m, d, hh=0, mm=0):
    return datetime(y, m, d, hh, mm, tzinfo=IST)


# ------------------------------------------------------------------- calendar
class TestCalendar:
    def test_regular_session_is_live(self):
        s = cal.market_status(at(2026, 11, 9, 10, 0))  # Monday
        assert (s.state, s.is_live, s.price_date) == ("OPEN", True, date(2026, 11, 9))

    def test_open_and_close_boundaries(self):
        assert cal.market_status(at(2026, 11, 9, 9, 15)).state == "OPEN"
        assert cal.market_status(at(2026, 11, 9, 15, 29)).state == "OPEN"
        assert cal.market_status(at(2026, 11, 9, 15, 30)).state == "CLOSED"

    def test_before_open_freezes_at_previous_close(self):
        s = cal.market_status(at(2026, 11, 9, 8, 0))
        assert not s.is_live and s.price_date == date(2026, 11, 6)  # Friday

    def test_pre_open_is_not_live(self):
        s = cal.market_status(at(2026, 11, 9, 9, 5))
        assert s.state == "PRE_OPEN" and not s.is_live and s.price_date == date(2026, 11, 6)

    def test_after_close_price_date_is_today(self):
        s = cal.market_status(at(2026, 11, 9, 16, 0))
        assert not s.is_live and s.price_date == date(2026, 11, 9)

    def test_weekend_freezes_at_friday_close(self):
        for day in (7, 8):  # Sat, Sun
            s = cal.market_status(at(2026, 11, day, 11, 0))
            assert not s.is_live and s.price_date == date(2026, 11, 6) and s.reason == "Weekend"

    def test_holiday_freezes_at_previous_session(self):
        s = cal.market_status(at(2026, 11, 10, 11, 0))  # Diwali Balipratipada, Tuesday
        assert not s.is_live and "Diwali" in s.reason and s.price_date == date(2026, 11, 9)

    def test_next_open_skips_holiday(self):
        assert cal.next_open(at(2026, 11, 9, 16, 0)) == at(2026, 11, 11, 9, 15)

    def test_trading_day_helpers(self):
        assert cal.is_trading_day("2026-11-09") and not cal.is_trading_day("2026-11-10")
        assert cal.previous_trading_day("2026-11-11") == date(2026, 11, 9)
        assert cal.on_or_before_trading_day("2026-11-08") == date(2026, 11, 6)

    def test_muhurat_timing_is_never_assumed(self, monkeypatch):
        monkeypatch.delenv("NSE_SPECIAL_SESSIONS", raising=False)
        s = cal.market_status(at(2026, 11, 8, 18, 30))
        assert s.state == "CLOSED" and not s.is_live

    def test_special_session_from_env(self, monkeypatch):
        monkeypatch.setenv("NSE_SPECIAL_SESSIONS", "2026-11-08=18:15-19:15")
        assert cal.market_status(at(2026, 11, 8, 18, 30)).state == "SPECIAL"
        assert cal.market_status(at(2026, 11, 8, 19, 30)).state == "CLOSED"

    def test_holiday_file_overlay(self, monkeypatch, tmp_path):
        f = tmp_path / "h.json"
        f.write_text('{"2027-01-26": "Republic Day"}')
        monkeypatch.setenv("NSE_HOLIDAYS_FILE", str(f))
        assert not cal.is_trading_day("2027-01-26")

    def test_coverage_flag(self):
        assert cal.market_status(at(2026, 11, 9, 10)).calendar_covered
        assert not cal.market_status(at(2028, 3, 1, 10)).calendar_covered


# ---------------------------------------------------------------- instruments
ROWS = [
    {"instrument_key": "NSE_EQ|INE002A01018", "trading_symbol": "RELIANCE", "name": "RELIANCE INDUSTRIES LTD",
     "exchange": "NSE", "segment": "NSE_EQ", "instrument_type": "EQ", "isin": "INE002A01018", "lot_size": 1},
    {"instrument_key": "BSE_EQ|INE002A01018", "trading_symbol": "RELIANCE", "name": "RELIANCE INDUSTRIES LTD",
     "exchange": "BSE", "segment": "BSE_EQ", "instrument_type": "EQ", "isin": "INE002A01018"},
    {"instrument_key": "NSE_EQ|INE101A01026", "trading_symbol": "M&M", "name": "MAHINDRA & MAHINDRA LTD",
     "exchange": "NSE", "segment": "NSE_EQ", "instrument_type": "EQ"},
    {"instrument_key": "NSE_EQ|INE467B01029", "trading_symbol": "TCS", "name": "TATA CONSULTANCY SERV LT",
     "exchange": "NSE", "segment": "NSE_EQ", "instrument_type": "EQ"},
    {"instrument_key": "BSE_EQ|INE000X01011", "trading_symbol": "BSEONLY", "name": "BSE ONLY CO",
     "exchange": "BSE", "segment": "BSE_EQ", "instrument_type": "EQ"},
    {"instrument_key": "NSE_FO|50001", "trading_symbol": "NIFTY 24000 CE", "name": "NIFTY", "exchange": "NSE",
     "segment": "NSE_FO", "instrument_type": "CE", "underlying_symbol": "NIFTY", "strike_price": 24000,
     "expiry": 4102444800000, "lot_size": 75},
]


@pytest.fixture
def master():
    m = InstrumentMaster(rows=ROWS)
    set_master(m)
    yield m
    set_master(None)


class TestInstruments:
    def test_suffix_selects_exchange_and_is_preserved(self, master):
        assert master.resolve("RELIANCE.NS").key == "NSE_EQ|INE002A01018"
        assert master.resolve("RELIANCE.BO").key == "BSE_EQ|INE002A01018"
        assert master.resolve("RELIANCE.NS").yahoo_style == "RELIANCE.NS"
        assert master.resolve("RELIANCE.BO").yahoo_style == "RELIANCE.BO"

    def test_bare_symbol_means_nse_with_bse_fallback(self, master):
        assert master.resolve("tcs").key == "NSE_EQ|INE467B01029"
        assert master.resolve("BSEONLY").key == "BSE_EQ|INE000X01011"

    def test_symbols_with_punctuation(self, master):
        assert master.resolve("M&M.NS").key == "NSE_EQ|INE101A01026"

    def test_index_aliases(self, master):
        assert master.resolve("NIFTY").key == "NSE_INDEX|Nifty 50"
        assert master.resolve("^NSEI").key == "NSE_INDEX|Nifty 50"
        assert master.resolve("BANKNIFTY").key == "NSE_INDEX|Nifty Bank"
        assert master.resolve("SENSEX").key == "BSE_INDEX|SENSEX"

    def test_unknown_symbol_is_no_data(self, master):
        with pytest.raises(NoMarketDataError):
            master.resolve("NOSUCHCO.NS")

    def test_search_ranks_exact_then_prefix(self, master):
        assert master.search("TCS")[0].symbol == "TCS"
        assert {i.symbol for i in master.search("REL")} >= {"RELIANCE"}
        assert any(i.kind == "INDEX" for i in master.search("nifty"))

    def test_derivative_helpers(self, master):
        assert master.expiries("NIFTY") == ["2100-01-01"]
        assert master.lot_size("NIFTY") == 75
        assert master.contract("NIFTY", "2100-01-01", 24000, "CE").key == "NSE_FO|50001"


# --------------------------------------------------------------------- Upstox
def candle_payload(days=80, start="2026-06-01"):
    """Newest-first, IST-stamped daily candles like Upstox returns them."""
    idx = pd.bdate_range(start, periods=days)
    rows = []
    for i, d in enumerate(idx):
        c = 1000 + i * 2 + (i % 5)
        rows.append([f"{d:%Y-%m-%d}T00:00:00+05:30", c - 3, c + 5, c - 6, c, 100000 + i, 0])
    return {"status": "success", "data": {"candles": rows[::-1]}}


class FakeResponse:
    def __init__(self, status=200, payload=None, text=""):
        self.status_code, self._payload, self.text = status, payload, text

    def json(self):
        if self._payload is None:
            raise ValueError("no json")
        return self._payload


class FakeSession:
    def __init__(self, responses):
        self.responses, self.calls = list(responses), []

    def get(self, url, params=None, headers=None, timeout=None):
        self.calls.append((url, params, headers))
        r = self.responses.pop(0)
        if isinstance(r, Exception):
            raise r
        return r


class TestUpstoxParsers:
    def test_candles_sorted_ascending_and_ist_wallclock(self):
        f = upstox.candles_to_frame(candle_payload(5))
        assert f["time"].is_monotonic_increasing
        assert f["time"].iloc[0] == pd.Timestamp("2026-06-01 00:00:00")
        assert list(f.columns) == ["time", "open", "high", "low", "close", "volume", "oi"]

    def test_empty_candles(self):
        assert upstox.candles_to_frame({"data": {"candles": []}}).empty

    def test_quote_previous_close_from_net_change(self):
        q = upstox.parse_quote({
            "instrument_token": "NSE_EQ|INE002A01018", "symbol": "RELIANCE", "last_price": 1250.5,
            "net_change": 10.5, "ohlc": {"open": 1240, "high": 1255, "low": 1238, "close": 1250.5},
            "volume": 5000, "depth": {"buy": [{"price": 1250, "quantity": 10, "orders": 2}], "sell": []},
        })
        assert q["key"] == "NSE_EQ|INE002A01018" and q["prev_close"] == 1240.0
        assert q["change_pct"] == pytest.approx(0.85, abs=0.01)
        assert q["bids"][0]["price"] == 1250.0

    def test_option_chain_parse_and_sort(self):
        rows = [
            {"strike_price": 24100, "underlying_spot_price": 24050, "pcr": 1.1, "expiry": "2026-11-12",
             "call_options": {"instrument_key": "NSE_FO|1", "market_data": {"ltp": 80, "oi": 1000},
                              "option_greeks": {"delta": 0.45, "gamma": 0.001, "theta": -9, "vega": 12, "iv": 14}},
             "put_options": {"instrument_key": "NSE_FO|2", "market_data": {"ltp": 120, "oi": 2000},
                             "option_greeks": {"delta": -0.55}}},
            {"strike_price": 24000, "call_options": {}, "put_options": {}},
        ]
        chain = upstox.parse_option_chain(rows)
        assert [r["strike"] for r in chain] == [24000, 24100]
        assert chain[1]["call"]["delta"] == 0.45 and chain[1]["put"]["oi"] == 2000


class TestUpstoxClient:
    def test_no_token_is_not_configured(self, monkeypatch):
        for name in upstox.TOKEN_ENV_ORDER:
            monkeypatch.delenv(name, raising=False)
        with pytest.raises(VendorNotConfiguredError):
            upstox.UpstoxClient(FakeSession([]))._get("/x")

    def test_falls_back_to_second_token_after_401(self, monkeypatch):
        monkeypatch.setenv("UPSTOX_ANALYTICS_TOKEN", "AAA")
        monkeypatch.setenv("UPSTOX_ACCESS_TOKEN", "BBB")
        session = FakeSession([FakeResponse(401), FakeResponse(200, {"status": "success", "data": {}})])
        upstox.UpstoxClient(session)._get("/x")
        assert [c[2]["Authorization"] for c in session.calls] == ["Bearer AAA", "Bearer BBB"]

    def test_all_tokens_rejected_is_not_configured_and_hides_tokens(self, monkeypatch):
        monkeypatch.setenv("UPSTOX_ANALYTICS_TOKEN", "SECRET-ONE")
        monkeypatch.delenv("UPSTOX_ACCESS_TOKEN", raising=False)
        with pytest.raises(VendorNotConfiguredError) as err:
            upstox.UpstoxClient(FakeSession([FakeResponse(401)]))._get("/x")
        assert "SECRET-ONE" not in str(err.value)

    def test_rate_limit_and_network_errors_are_unavailable(self, monkeypatch):
        monkeypatch.setenv("UPSTOX_ANALYTICS_TOKEN", "AAA")
        monkeypatch.delenv("UPSTOX_ACCESS_TOKEN", raising=False)
        with pytest.raises(VendorUnavailableError):
            upstox.UpstoxClient(FakeSession([FakeResponse(429)]))._get("/x")
        with pytest.raises(VendorUnavailableError):
            upstox.UpstoxClient(FakeSession([requests.ConnectionError("down")]))._get("/x")

    def test_client_error_is_no_data(self, monkeypatch):
        monkeypatch.setenv("UPSTOX_ANALYTICS_TOKEN", "AAA")
        monkeypatch.delenv("UPSTOX_ACCESS_TOKEN", raising=False)
        bad = FakeResponse(400, {"errors": [{"message": "Invalid Instrument key"}]})
        with pytest.raises(NoMarketDataError):
            upstox.UpstoxClient(FakeSession([bad]))._get("/x")

    def test_instrument_key_is_url_encoded_in_path(self, monkeypatch):
        monkeypatch.setenv("UPSTOX_ANALYTICS_TOKEN", "AAA")
        monkeypatch.delenv("UPSTOX_ACCESS_TOKEN", raising=False)
        session = FakeSession([FakeResponse(200, candle_payload(3))])
        upstox.UpstoxClient(session).historical_candles("NSE_EQ|INE002A01018", "days", 1, "2026-06-01", "2026-06-10")
        assert "NSE_EQ%7CINE002A01018/days/1/2026-06-10/2026-06-01" in session.calls[0][0]


class StubClient:
    def __init__(self, payload):
        self.payload, self.calls = payload, 0

    def historical_candles(self, *a, **k):
        self.calls += 1
        return upstox.candles_to_frame(self.payload)


@pytest.fixture
def stub_upstox(master, monkeypatch):
    upstox.clear_cache()
    client = StubClient(candle_payload(80))
    upstox.set_client(client)
    # Pin "now" to a closed Saturday so the last bar is a settled session.
    monkeypatch.setattr(cal, "now_ist", lambda: at(2026, 9, 26, 12, 0))
    yield client
    upstox.set_client(None)
    upstox.clear_cache()


class TestUpstoxVendor:
    def test_stock_data_csv_and_header(self, stub_upstox):
        out = upstox.get_stock_data("RELIANCE.NS", "2026-08-01", "2026-09-18")
        assert out.startswith("# Stock data for RELIANCE.NS (NSE_EQ|INE002A01018)")
        assert "Date,Open,High,Low,Close,Volume" in out
        assert "2026-08-03" in out and "2026-07-31" not in out

    def test_no_lookahead_past_end_date(self, stub_upstox):
        out = upstox.get_stock_data("RELIANCE.NS", "2026-08-01", "2026-08-14")
        assert "2026-08-14" in out and "2026-08-17" not in out

    def test_unknown_symbol_is_no_data(self, stub_upstox):
        with pytest.raises(NoMarketDataError):
            upstox.get_stock_data("NOSUCHCO.NS", "2026-08-01", "2026-08-14")

    def test_partial_todays_bar_dropped_while_live(self, master, monkeypatch):
        upstox.clear_cache()
        payload = candle_payload(5, start="2026-11-03")  # Nov 3..7
        upstox.set_client(StubClient(payload))
        monkeypatch.setattr(cal, "now_ist", lambda: at(2026, 11, 6, 11, 0))  # Friday, live
        monkeypatch.setattr(upstox.nse_calendar, "now_ist", lambda: at(2026, 11, 6, 11, 0))
        try:
            data = upstox.load_ohlcv("RELIANCE.NS", "2026-11-06")
            assert data["Date"].max() == pd.Timestamp("2026-11-05")
        finally:
            upstox.set_client(None)
            upstox.clear_cache()

    def test_settled_bar_kept_after_close(self, master, monkeypatch):
        upstox.clear_cache()
        upstox.set_client(StubClient(candle_payload(5, start="2026-11-03")))
        monkeypatch.setattr(upstox.nse_calendar, "now_ist", lambda: at(2026, 11, 6, 16, 0))
        try:
            data = upstox.load_ohlcv("RELIANCE.NS", "2026-11-06")
            assert data["Date"].max() == pd.Timestamp("2026-11-06")
        finally:
            upstox.set_client(None)
            upstox.clear_cache()

    def test_indicators_reuse_stockstats_pipeline(self, stub_upstox):
        out = upstox.get_indicators("RELIANCE.NS", "rsi", "2026-09-18", 10)
        assert out.startswith("## rsi values from 2026-09-08 to 2026-09-18")
        assert "2026-09-18:" in out and "N/A: Not a trading day" in out  # weekend rows

    def test_unsupported_indicator_raises_like_yahoo(self, stub_upstox):
        # The get_indicators tool catches ValueError and relays the message to the agent.
        with pytest.raises(ValueError, match="not supported"):
            upstox.get_indicators("RELIANCE.NS", "bogus", "2026-09-18", 5)


# ------------------------------------------------------------------- Screener
SCREENER_HTML = """
<html><body>
<h1>Reliance Industries Ltd</h1>
<div class="company-profile"><div class="about"><p>Conglomerate in energy and retail.</p></div></div>
<ul id="top-ratios">
  <li><span class="name">Market Cap</span><span class="value">₹ <span class="number">17,00,000</span> Cr.</span></li>
  <li><span class="name">Stock P/E</span><span class="value"><span class="number">24.5</span></span></li>
  <li><span class="name">ROCE</span><span class="value"><span class="number">9.8</span> %</span></li>
  <li><span class="name">ROE</span><span class="value"><span class="number">8.9</span> %</span></li>
</ul>
<div class="pros"><ul><li>Healthy dividend payout</li></ul></div>
<div class="cons"><ul><li>Low ROE vs peers</li></ul></div>
<section id="quarters"><table class="data-table"><thead><tr><th></th><th>Mar 2026</th><th>Jun 2026</th></tr></thead>
<tbody><tr><td>Sales +</td><td>2,40,000</td><td>2,50,000</td></tr>
<tr><td>OPM %</td><td>17%</td><td>18%</td></tr>
<tr><td>Net Profit +</td><td>18,000</td><td>19,000</td></tr></tbody></table></section>
<section id="profit-loss"><table class="data-table"><thead><tr><th></th><th>Mar 2025</th><th>Mar 2026</th></tr></thead>
<tbody><tr><td>Sales +</td><td>9,00,000</td><td>9,80,000</td></tr><tr><td>OPM %</td><td>16%</td><td>17%</td></tr></tbody></table></section>
<section id="balance-sheet"><table class="data-table"><thead><tr><th></th><th>Mar 2025</th><th>Mar 2026</th></tr></thead>
<tbody><tr><td>Equity Capital</td><td>6,766</td><td>6,766</td></tr><tr><td>Reserves</td><td>7,00,000</td><td>7,93,234</td></tr>
<tr><td>Borrowings +</td><td>3,00,000</td><td>4,00,000</td></tr></tbody></table></section>
<section id="cash-flow"><table class="data-table"><thead><tr><th></th><th>Mar 2026</th></tr></thead>
<tbody><tr><td>Cash from Operating Activity +</td><td>1,50,000</td></tr></tbody></table></section>
<section id="shareholding"><table class="data-table"><thead><tr><th></th><th>Mar 2026</th><th>Jun 2026</th></tr></thead>
<tbody><tr><td>Promoters +</td><td>50.3%</td><td>50.1%</td></tr><tr><td>FIIs +</td><td>19.5%</td><td>19.9%</td></tr>
<tr><td>DIIs +</td><td>16.1%</td><td>16.0%</td></tr><tr><td>Public +</td><td>14.1%</td><td>14.0%</td></tr></tbody></table></section>
</body></html>
"""


@pytest.fixture
def screener_page(monkeypatch):
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(SCREENER_HTML, "lxml")
    monkeypatch.setattr(screener, "fetch_page", lambda ticker, session=None: soup)
    return soup


class TestScreener:
    def test_parse_number_indian_grouping(self):
        assert screener.parse_number("1,23,456.7") == 123456.7
        assert screener.parse_number("12.5 %") == 12.5
        assert screener.parse_number("−4") == -4
        assert screener.parse_number("") is None and screener.parse_number(None) is None

    def test_fundamentals_carry_the_indian_ratios(self, screener_page):
        out = screener.get_fundamentals("RELIANCE.NS", None)
        for needle in ("Stock P/E: 24.5", "ROCE: 9.8 %", "ROE: 8.9 %", "Operating Margin (OPM, Mar 2026): 17%",
                       "FIIs", "DIIs", "Promoters", "Quarterly results", "Healthy dividend payout"):
            assert needle in out, needle

    def test_debt_to_equity_from_balance_sheet(self, screener_page):
        assert screener.debt_to_equity(screener_page) == "0.50x"  # 4,00,000 / (6,766 + 7,93,234)

    def test_statements(self, screener_page):
        assert "Equity Capital" in screener.get_balance_sheet("RELIANCE.NS", "annual", None)
        assert "Cash from Operating" in screener.get_cashflow("RELIANCE.NS", "annual", None)
        quarterly = screener.get_income_statement("RELIANCE.NS", "quarterly", None)
        assert "Jun 2026" in quarterly and "quarterly" in quarterly
        assert "annually only" in screener.get_balance_sheet("RELIANCE.NS", "quarterly", None)

    def test_insider_tool_is_honest_about_what_it_serves(self, screener_page):
        out = screener.get_insider_transactions("RELIANCE.NS", None)
        assert "not available from this source" in out and "Promoters" in out

    def test_past_dated_runs_are_withheld(self, screener_page):
        assert "withheld" in screener.get_fundamentals("RELIANCE.NS", "2020-01-01").lower()
        assert "withheld" in screener.get_balance_sheet("RELIANCE.NS", "annual", "2020-01-01").lower()
        assert "withheld" in screener.get_insider_transactions("RELIANCE.NS", "2020-01-01").lower()

    def test_layout_change_is_unavailable_not_garbage(self, monkeypatch):
        from bs4 import BeautifulSoup

        soup = BeautifulSoup("<html><ul id='top-ratios'></ul></html>", "lxml")
        monkeypatch.setattr(screener, "fetch_page", lambda t, session=None: soup)
        with pytest.raises(VendorUnavailableError):
            screener.get_fundamentals("RELIANCE.NS", None)

    def test_fetch_page_maps_http_failures(self, monkeypatch):
        class S:
            def __init__(self, code):
                self.code = code

            def get(self, *a, **k):
                return FakeResponse(self.code, text="")

        screener._PAGES.clear()
        with pytest.raises(NoMarketDataError):
            screener.fetch_page("NOSUCH.NS", session=S(404))
        with pytest.raises(VendorUnavailableError):
            screener.fetch_page("RELIANCE.NS", session=S(429))


# ------------------------------------------------------------------------ news
class TestNews:
    def items(self):
        return [
            {"title": "Reliance Q2 profit beats estimates", "publisher": "Moneycontrol", "link": "u1",
             "pub_date": datetime(2026, 11, 5, 9, 0)},
            {"title": "Reliance Q2 profit beats estimates", "publisher": "Mint", "link": "u2",
             "pub_date": datetime(2026, 11, 5, 9, 5)},   # duplicate headline
            {"title": "Old headline", "publisher": "ET Markets", "link": "u3", "pub_date": datetime(2026, 9, 1)},
        ]

    def test_window_filter_dedupe_and_query_shape(self, master, monkeypatch):
        queries = []

        def fake_fetch(q, session=None):
            queries.append(q)
            return self.items()

        monkeypatch.setattr(india_news, "_fetch", fake_fetch)
        out = india_news.get_news("RELIANCE.NS", "2026-11-01", "2026-11-08")
        assert out.count("Reliance Q2 profit beats estimates") == 1
        assert "Old headline" not in out and "Moneycontrol" in out
        assert any("site:moneycontrol.com" in q and "site:economictimes.indiatimes.com" in q for q in queries)
        assert all("after:2026-11-01" in q and "before:2026-11-09" in q for q in queries)
        assert '"RELIANCE"' in queries[0] and "RELIANCE INDUSTRIES LTD" in queries[0]

    def test_empty_window_is_stated(self, master, monkeypatch):
        monkeypatch.setattr(india_news, "_fetch", lambda q, session=None: [])
        assert "No news found" in india_news.get_news("TCS.NS", "2026-11-01", "2026-11-08")

    def test_feed_outage_is_vendor_unavailable(self, master, monkeypatch):
        def boom(q, session=None):
            raise VendorUnavailableError("down")

        monkeypatch.setattr(india_news, "_fetch", boom)
        with pytest.raises(VendorUnavailableError):
            india_news.get_news("TCS.NS", "2026-11-01", "2026-11-08")
        with pytest.raises(VendorUnavailableError):
            india_news.get_global_news("2026-11-08", 7, 10)

    def test_global_news_uses_indian_macro_queries(self, monkeypatch):
        seen = []
        monkeypatch.setattr(india_news, "_fetch", lambda q, session=None: seen.append(q) or [])
        india_news.get_global_news("2026-11-08", 7, 10)
        assert any("RBI" in q for q in seen) and any("FII" in q for q in seen)
        assert not any("Federal Reserve" in q for q in seen)

    def test_rss_parsing_strips_publisher_suffix(self, monkeypatch):
        rss = b"""<?xml version="1.0"?><rss version="2.0"><channel>
        <item><title>Nifty ends higher - Moneycontrol</title><link>http://x/1</link>
        <pubDate>Thu, 05 Nov 2026 09:00:00 GMT</pubDate><source url="http://mc">Moneycontrol</source></item>
        </channel></rss>"""

        class R:
            content = rss

            def raise_for_status(self):
                pass

        class S:
            def get(self, *a, **k):
                return R()

        items = india_news._fetch("q", session=S())
        assert items[0]["title"] == "Nifty ends higher" and items[0]["publisher"] == "Moneycontrol"


class TestSocial:
    def test_indian_ticker_detection(self):
        assert social.is_indian_ticker("RELIANCE.NS") and social.is_indian_ticker("tcs.bo")
        assert social.is_indian_ticker("NIFTY") and social.is_indian_ticker("BANKNIFTY")
        assert not social.is_indian_ticker("AAPL") and not social.is_indian_ticker("NSEI")

    def test_reddit_query_is_bare_symbol(self):
        assert social.reddit_query("RELIANCE.NS") == "RELIANCE"

    def test_chatter_block_is_labelled_not_stocktwits(self, monkeypatch):
        monkeypatch.setattr(india_news, "_fetch", lambda q, session=None: [
            {"title": "Brokerages raise Reliance target", "publisher": "ET Markets", "link": "u",
             "pub_date": datetime(2026, 11, 5)}])
        out = social.fetch_dalal_street_chatter("RELIANCE.NS", "2026-11-01", "2026-11-08")
        assert "StockTwits is not used" in out and "Brokerages raise Reliance target" in out

    def test_chatter_outage_degrades_to_placeholder(self, monkeypatch):
        def boom(q, session=None):
            raise VendorUnavailableError("down")

        monkeypatch.setattr(india_news, "_fetch", boom)
        assert social.fetch_dalal_street_chatter("TCS.NS", "2026-11-01", "2026-11-08").startswith("<Dalal")


# --------------------------------------------------------------- config/routing
class TestRouting:
    def test_india_profile_selects_indian_vendors(self):
        from tradingagents.default_config import india_config

        cfg = india_config()
        assert cfg["market"] == "IN" and cfg["benchmark_ticker"] == "^NSEI"
        vendors = cfg["data_vendors"]
        assert vendors["core_stock_apis"] == "upstox" and vendors["technical_indicators"] == "upstox"
        assert vendors["fundamental_data"] == "screener" and vendors["news_data"] == "india_news"

    def test_us_default_is_unchanged(self):
        from tradingagents.default_config import build_default_config

        cfg = build_default_config()
        assert cfg["market"] == "US" and cfg["data_vendors"]["core_stock_apis"] == "yfinance"

    def test_market_env_switch(self, monkeypatch):
        from tradingagents.default_config import build_default_config

        monkeypatch.setenv("TRADINGAGENTS_MARKET", "IN")
        assert build_default_config()["data_vendors"]["core_stock_apis"] == "upstox"

    def test_router_dispatches_to_india_vendors(self, monkeypatch):
        from tradingagents.dataflows import router
        from tradingagents.dataflows.config import run_config
        from tradingagents.default_config import india_config

        monkeypatch.setitem(router.VENDOR_METHODS["get_stock_data"], "upstox", lambda *a: "UPSTOX " + a[0])
        monkeypatch.setitem(router.VENDOR_METHODS["get_news"], "india_news", lambda *a: "INDIA-NEWS " + a[0])
        monkeypatch.setitem(router.VENDOR_METHODS["get_fundamentals"], "screener", lambda *a: "SCREENER " + a[0])
        with run_config(india_config()):
            assert router.route_to_vendor("get_stock_data", "TCS.NS", "2026-01-01", "2026-01-31") == "UPSTOX TCS.NS"
            assert router.route_to_vendor("get_news", "TCS.NS", "a", "b") == "INDIA-NEWS TCS.NS"
            assert router.route_to_vendor("get_fundamentals", "TCS.NS", None) == "SCREENER TCS.NS"

    def test_router_reports_vendor_outage_without_fabrication(self, monkeypatch):
        from tradingagents.dataflows import router
        from tradingagents.dataflows.config import run_config
        from tradingagents.default_config import india_config

        def down(*a):
            raise VendorUnavailableError("429")

        monkeypatch.setitem(router.VENDOR_METHODS["get_stock_data"], "upstox", down)
        with run_config(india_config()):
            out = router.route_to_vendor("get_stock_data", "TCS.NS", "2026-01-01", "2026-01-31")
        assert out.startswith("DATA_UNAVAILABLE")

    def test_suffix_survives_symbol_normalisation(self):
        from tradingagents.dataflows.symbols import normalize_symbol

        assert normalize_symbol("reliance.ns") == "RELIANCE.NS"
        assert normalize_symbol("TCS.BO") == "TCS.BO"
