"""Paper trading engine: fills, margin, order types, P&L and persistence."""

from __future__ import annotations

from datetime import datetime

import pytest

from indian_terminal import paper
from indian_terminal.paper import OrderRejected, PaperAccount
from tradingagents.dataflows.vendors.india import nse_calendar as cal

IST = cal.IST
LIVE = cal.market_status(datetime(2026, 11, 9, 10, 0, tzinfo=IST))          # Monday, open
CLOSED = cal.market_status(datetime(2026, 11, 8, 12, 0, tzinfo=IST))        # Sunday
LATE = cal.market_status(datetime(2026, 11, 9, 15, 25, tzinfo=IST))         # past 15:20 square-off

KEY = "NSE_EQ|INE002A01018"
OPT = "NSE_FO|70021"


def quote(ltp, bids=None, asks=None):
    return {"key": KEY, "ltp": ltp, "bids": bids if bids is not None else [], "asks": asks if asks is not None else []}


def book(ltp, tick=0.05, qty=100, levels=3):
    bids = [{"price": round(ltp - tick * (i + 1), 2), "qty": qty, "orders": 1} for i in range(levels)]
    asks = [{"price": round(ltp + tick * (i + 1), 2), "qty": qty, "orders": 1} for i in range(levels)]
    return quote(ltp, bids, asks)


def spec(**kw):
    base = dict(key=KEY, symbol="RELIANCE", name="Reliance", kind="EQ", exchange="NSE", side="BUY", qty=10,
                order_type="MARKET", product="MIS", lot_size=1, tick_size=0.05)
    base.update(kw)
    return base


def opt_spec(**kw):
    return spec(key=OPT, symbol="NIFTY 25500 CE", kind="CE", product="NRML", lot_size=75, qty=75, **kw)


@pytest.fixture
def acct():
    return PaperAccount(initial_balance=1_000_000)


# ------------------------------------------------------------------ charges
class TestCharges:
    def test_delivery_has_no_brokerage_but_stt_both_sides(self):
        buy = paper.charges_for("EQ", "CNC", "BUY", 100, 1000.0)
        sell = paper.charges_for("EQ", "CNC", "SELL", 100, 1000.0)
        assert buy["brokerage"] == 0 and buy["stt"] == pytest.approx(100.0) and sell["stt"] == pytest.approx(100.0)
        assert buy["stamp"] > 0 and sell["stamp"] == 0

    def test_intraday_brokerage_is_capped(self):
        small = paper.charges_for("EQ", "MIS", "BUY", 10, 100.0)
        big = paper.charges_for("EQ", "MIS", "BUY", 10_000, 1000.0)
        assert small["brokerage"] == pytest.approx(0.3) and big["brokerage"] == 20.0

    def test_totals_add_up(self):
        c = paper.charges_for("CE", "NRML", "SELL", 75, 150.0)
        assert c["total"] == pytest.approx(round(sum(v for k, v in c.items() if k != "total"), 2), abs=0.02)


# ---------------------------------------------------------------- order fills
class TestFills:
    def test_market_buy_fills_at_best_ask_and_creates_position(self, acct):
        o = acct.place_order(spec(), book(1000), LIVE)
        assert o.status == "COMPLETE" and o.filled_qty == 10 and o.avg_price == pytest.approx(1000.05)
        pos = acct.positions[(KEY, "MIS")]
        assert pos.qty == 10 and pos.avg_price == pytest.approx(1000.05)

    def test_market_order_walks_the_book(self, acct):
        o = acct.place_order(spec(qty=250), book(1000, qty=100), LIVE)
        # 100 @1000.05, 100 @1000.10, 50 @1000.15
        assert o.avg_price == pytest.approx((100 * 1000.05 + 100 * 1000.10 + 50 * 1000.15) / 250, abs=1e-3)
        assert len(o.fills) == 3

    def test_exhausted_book_slips_adversely_beyond_last_level(self, acct):
        o = acct.place_order(spec(qty=400), book(1000, qty=100, levels=2), LIVE)
        assert o.status == "COMPLETE" and o.fills[-1].price > 1000.10

    def test_no_depth_means_adverse_slippage_never_improvement(self, acct):
        buy = acct.place_order(spec(), quote(1000.0), LIVE)
        assert buy.avg_price > 1000.0
        sell = acct.place_order(spec(side="SELL"), quote(1000.0), LIVE)
        assert sell.avg_price < 1000.0

    def test_sell_walks_bids_downwards(self, acct):
        acct.place_order(spec(qty=150), book(1000, qty=200), LIVE)
        o = acct.place_order(spec(side="SELL", qty=150), book(1000, qty=100), LIVE)
        assert o.fills[0].price == 999.95 and o.fills[1].price == 999.90

    def test_prices_snap_to_tick(self, acct):
        o = acct.place_order(spec(), quote(1000.0), LIVE)
        assert round(o.avg_price / 0.05) * 0.05 == pytest.approx(o.avg_price, abs=1e-6)


# --------------------------------------------------------------- order types
class TestOrderTypes:
    def test_limit_buy_below_market_rests_then_fills_when_ask_reaches_it(self, acct):
        o = acct.place_order(spec(order_type="LIMIT", price=995.0), book(1000), LIVE)
        assert o.status == "OPEN" and o.filled_qty == 0
        acct.on_quotes({KEY: book(996)}, LIVE)
        assert o.status == "OPEN"                      # best ask 996.05 is still above the limit
        acct.on_quotes({KEY: book(994)}, LIVE)
        assert o.status == "COMPLETE" and o.avg_price <= 995.0

    def test_marketable_limit_partially_fills_only_within_limit(self, acct):
        q = book(1000, qty=100)                         # asks 1000.05 / .10 / .15, 100 each
        o = acct.place_order(spec(order_type="LIMIT", price=1000.10, qty=250), q, LIVE)
        assert o.filled_qty == 200 and o.status == "OPEN" and o.pending_qty == 50
        assert max(f.price for f in o.fills) <= 1000.10

    def test_limit_sell_waits_for_bid(self, acct):
        acct.place_order(spec(qty=10), book(1000), LIVE)
        o = acct.place_order(spec(side="SELL", order_type="LIMIT", price=1010.0), book(1000), LIVE)
        assert o.status == "OPEN"
        acct.on_quotes({KEY: book(1012)}, LIVE)
        assert o.status == "COMPLETE" and o.avg_price >= 1010.0

    def test_sl_m_sell_triggers_only_on_fall_through(self, acct):
        acct.place_order(spec(qty=10), book(1000), LIVE)
        o = acct.place_order(spec(side="SELL", order_type="SL-M", trigger_price=990.0), book(1000), LIVE)
        assert o.status == "TRIGGER_PENDING"
        acct.on_quotes({KEY: book(995)}, LIVE)
        assert o.status == "TRIGGER_PENDING"
        acct.on_quotes({KEY: book(989)}, LIVE)
        assert o.status == "COMPLETE" and o.triggered and acct.positions[(KEY, "MIS")].qty == 0

    def test_sl_limit_triggers_then_rests_if_price_gapped_past_limit(self, acct):
        acct.place_order(spec(qty=10), book(1000), LIVE)
        o = acct.place_order(spec(side="SELL", order_type="SL", trigger_price=990.0, price=989.0), book(1000), LIVE)
        acct.on_quotes({KEY: book(980)}, LIVE)         # gaps through the limit: bids ~979.9 < 989
        assert o.triggered and o.status == "OPEN" and o.filled_qty == 0

    def test_sl_buy_triggers_on_rise(self, acct):
        o = acct.place_order(spec(order_type="SL-M", trigger_price=1010.0), book(1000), LIVE)
        acct.on_quotes({KEY: book(1011)}, LIVE)
        assert o.status == "COMPLETE"

    def test_cancel_releases_reserved_funds(self, acct):
        o = acct.place_order(spec(order_type="LIMIT", price=900.0, product="CNC", qty=100), book(1000), LIVE)
        assert acct.available_margin({}) == pytest.approx(1_000_000 - 90_000)
        acct.cancel(o.id)
        assert o.status == "CANCELLED" and acct.available_margin({}) == pytest.approx(1_000_000)
        with pytest.raises(OrderRejected):
            acct.cancel(o.id)


# ---------------------------------------------------------------- validation
class TestValidation:
    @pytest.mark.parametrize("kw,msg", [
        (dict(qty=0), "Quantity"), (dict(side="HOLD"), "side"), (dict(order_type="IOC"), "order_type"),
        (dict(product="XYZ"), "product"), (dict(order_type="LIMIT"), "need a price"),
        (dict(order_type="SL-M"), "trigger"), (dict(order_type="LIMIT", price=-5), "positive"),
        (dict(order_type="SL", price=990, trigger_price=1000, side="BUY"), "beyond the trigger"),
        (dict(product="NRML"), "CNC or MIS"),
    ])
    def test_rejections(self, acct, kw, msg):
        with pytest.raises(OrderRejected, match=msg):
            acct.place_order(spec(**kw), book(1000), LIVE)

    def test_insufficient_funds(self):
        small = PaperAccount(initial_balance=5_000)
        with pytest.raises(OrderRejected, match="Insufficient funds"):
            small.place_order(spec(product="CNC", qty=10), book(1000), LIVE)
        assert not small.orders or all(o.status != "COMPLETE" for o in small.orders.values())

    def test_mis_leverage_allows_5x(self):
        small = PaperAccount(initial_balance=10_000)
        small.place_order(spec(product="MIS", qty=50), book(1000), LIVE)          # 50k notional, 10k margin
        with pytest.raises(OrderRejected, match="Insufficient funds"):
            small.place_order(spec(product="MIS", qty=1), book(1000), LIVE)

    def test_cnc_sell_needs_holdings(self, acct):
        with pytest.raises(OrderRejected, match="only 0 held"):
            acct.place_order(spec(side="SELL", product="CNC"), book(1000), LIVE)
        acct.place_order(spec(product="CNC", qty=10), book(1000), LIVE)
        with pytest.raises(OrderRejected, match="only 10 held"):
            acct.place_order(spec(side="SELL", product="CNC", qty=11), book(1000), LIVE)
        assert acct.place_order(spec(side="SELL", product="CNC", qty=10), book(1000), LIVE).status == "COMPLETE"

    def test_pending_cnc_sells_count_against_holdings(self, acct):
        acct.place_order(spec(product="CNC", qty=10), book(1000), LIVE)
        acct.place_order(spec(side="SELL", product="CNC", qty=8, order_type="LIMIT", price=1100), book(1000), LIVE)
        with pytest.raises(OrderRejected, match="only 2 held"):
            acct.place_order(spec(side="SELL", product="CNC", qty=5), book(1000), LIVE)

    def test_no_price_no_order(self, acct):
        with pytest.raises(OrderRejected, match="No price"):
            acct.place_order(spec(), None, LIVE)

    def test_indices_are_not_tradable(self, acct):
        with pytest.raises(OrderRejected, match="Indices"):
            acct.place_order(spec(kind="INDEX"), book(25000), LIVE)

    def test_derivative_lot_size_enforced(self, acct):
        with pytest.raises(OrderRejected, match="lot size"):
            acct.place_order(opt_spec(side="BUY") | {"qty": 80}, book(150), LIVE)


# ------------------------------------------------------------------ P&L ledger
class TestLedger:
    def test_intraday_round_trip_pnl_and_cash(self, acct):
        acct.place_order(spec(qty=100), quote(1000.0), LIVE)
        acct.place_order(spec(side="SELL", qty=100), quote(1010.0), LIVE)
        buy_px, sell_px = acct.trades[0]["price"], acct.trades[1]["price"]
        gross = (sell_px - buy_px) * 100
        assert acct.positions[(KEY, "MIS")].qty == 0
        assert acct.cash == pytest.approx(1_000_000 + gross - acct.charges_paid, abs=0.01)
        snap = acct.snapshot({KEY: quote(1010.0)})
        assert snap["funds"]["total_pnl"] == pytest.approx(gross - acct.charges_paid, abs=0.01)
        assert snap["funds"]["margin_used"] == 0

    def test_short_then_cover(self, acct):
        acct.place_order(spec(side="SELL", qty=50), quote(1000.0), LIVE)
        assert acct.positions[(KEY, "MIS")].qty == -50
        acct.place_order(spec(side="BUY", qty=50), quote(990.0), LIVE)
        sell_px, buy_px = acct.trades[0]["price"], acct.trades[1]["price"]
        assert acct.positions[(KEY, "MIS")].realized == pytest.approx((sell_px - buy_px) * 50, abs=0.01)

    def test_flip_through_zero_reprices_remainder(self, acct):
        acct.place_order(spec(qty=10), quote(1000.0), LIVE)
        acct.place_order(spec(side="SELL", qty=25), quote(1020.0), LIVE)
        pos = acct.positions[(KEY, "MIS")]
        assert pos.qty == -15 and pos.avg_price == pytest.approx(acct.trades[1]["price"])

    def test_averaging_up(self, acct):
        acct.place_order(spec(qty=10), quote(1000.0), LIVE)
        acct.place_order(spec(qty=10), quote(1100.0), LIVE)
        pos = acct.positions[(KEY, "MIS")]
        expected = (acct.trades[0]["price"] + acct.trades[1]["price"]) / 2
        assert pos.qty == 20 and pos.avg_price == pytest.approx(expected, abs=0.01)

    def test_delivery_buy_moves_cash_and_creates_holding(self, acct):
        acct.place_order(spec(product="CNC", qty=10), quote(1000.0), LIVE)
        snap = acct.snapshot({KEY: quote(1000.0)})
        assert snap["holdings"][0]["qty"] == 10 and snap["positions"] == []
        assert snap["funds"]["cash"] < 1_000_000 - 10_000 + 1
        assert snap["funds"]["equity"] == pytest.approx(1_000_000 - acct.charges_paid - 10 * (acct.trades[0]["price"] - 1000.0), abs=0.05)

    def test_option_round_trip_has_no_double_counting(self, acct):
        acct.place_order(opt_spec(side="BUY"), book(150, qty=300), LIVE)
        acct.place_order(opt_spec(side="SELL"), book(170, qty=300), LIVE)
        buy_px, sell_px = acct.trades[0]["price"], acct.trades[1]["price"]
        expected = (sell_px - buy_px) * 75
        assert acct.cash == pytest.approx(1_000_000 + expected - acct.charges_paid, abs=0.01)

    def test_option_long_equity_marks_premium(self, acct):
        acct.place_order(opt_spec(side="BUY"), book(150, qty=300), LIVE)
        fill = acct.trades[0]["price"]
        snap = acct.snapshot({OPT: {"ltp": 160.0}})
        assert snap["funds"]["equity"] == pytest.approx(1_000_000 - acct.charges_paid + (160.0 - fill) * 75, abs=0.05)

    def test_snapshot_marks_unrealised(self, acct):
        acct.place_order(spec(qty=10), quote(1000.0), LIVE)
        row = acct.snapshot({KEY: quote(1050.0)})["positions"][0]
        assert row["unrealized"] == pytest.approx((1050 - row["avg_price"]) * 10, abs=0.01) and row["pnl_pct"] > 0


# ------------------------------------------------------- market closed / AMO
class TestSessions:
    def test_closed_market_queues_amo_and_reserves_margin(self, acct):
        o = acct.place_order(spec(product="CNC", qty=10), quote(1000.0), CLOSED)
        assert o.status == "AMO" and o.filled_qty == 0 and "09 Nov" in o.message
        assert acct.available_margin({}) == pytest.approx(1_000_000 - 10_000)
        assert not acct.positions

    def test_amo_executes_on_first_live_tick_not_before(self, acct):
        o = acct.place_order(spec(product="CNC", qty=10), quote(1000.0), CLOSED)
        acct.on_quotes({KEY: book(1000)}, CLOSED)
        assert o.status == "AMO"
        acct.on_quotes({KEY: book(1003)}, LIVE)
        assert o.status == "COMPLETE" and o.avg_price == pytest.approx(1003.05)

    def test_amo_can_be_cancelled(self, acct):
        o = acct.place_order(spec(product="CNC", qty=10), quote(1000.0), CLOSED)
        acct.cancel(o.id)
        assert acct.available_margin({}) == pytest.approx(1_000_000)

    def test_mis_auto_square_off_after_1520(self, acct):
        acct.place_order(spec(qty=10), book(1000), LIVE)
        acct.on_quotes({KEY: book(1000)}, LIVE)
        assert acct.positions[(KEY, "MIS")].qty == 10                  # still open at 10:00
        changed = acct.on_quotes({KEY: book(1002)}, LATE)
        assert acct.positions[(KEY, "MIS")].qty == 0 and any(o.message == "Auto square-off (MIS)" for o in changed)

    def test_square_off_leaves_delivery_alone(self, acct):
        acct.place_order(spec(product="CNC", qty=10), book(1000), LIVE)
        acct.on_quotes({KEY: book(1000)}, LATE)
        assert acct.positions[(KEY, "CNC")].qty == 10

    def test_stale_mis_from_an_earlier_day_is_closed_on_next_live_tick(self, acct):
        acct.place_order(spec(qty=10), book(1000), LIVE)
        acct.positions[(KEY, "MIS")].opened = "2026-11-06T10:00:00+05:30"
        acct.on_quotes({KEY: book(1000)}, LIVE)
        assert acct.positions[(KEY, "MIS")].qty == 0


# ----------------------------------------------------------------- persistence
class TestPersistence:
    def test_state_roundtrips_through_json(self, tmp_path):
        path = tmp_path / "state.json"
        a = PaperAccount(path=path, initial_balance=500_000)
        a.place_order(spec(product="CNC", qty=10), book(1000), LIVE)
        a.place_order(spec(order_type="LIMIT", price=900, product="CNC", qty=5), book(1000), LIVE)
        b = PaperAccount(path=path)
        assert b.cash == a.cash and b.initial_balance == 500_000
        assert {o.id: (o.status, o.filled_qty) for o in b.orders.values()} == {o.id: (o.status, o.filled_qty) for o in a.orders.values()}
        assert b.positions[(KEY, "CNC")].qty == 10 and len(b.trades) == 1
        assert b.orders[next(iter(b.orders))].fills

    def test_corrupt_state_file_starts_clean(self, tmp_path):
        path = tmp_path / "state.json"
        path.write_text("{not json")
        assert PaperAccount(path=path, initial_balance=100_000).cash == 100_000

    def test_reset(self, acct):
        acct.place_order(spec(), book(1000), LIVE)
        acct.reset(250_000)
        assert acct.cash == 250_000 and not acct.orders and not acct.positions and not acct.trades
        with pytest.raises(OrderRejected):
            acct.reset(-1)
