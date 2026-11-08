"""Paper trading engine for NSE/BSE equities, indices-linked F&O and ETFs.

A virtual INR wallet, an order book and a ledger. Prices always come from real quotes
handed in by the caller; the engine never generates a price. When the exchange is shut
orders are accepted as after-market orders (``AMO``) and executed on the first live tick
after the open, exactly like a broker queue.

Order types: MARKET, LIMIT, SL (stop-limit), SL-M (stop-market).
Products:    CNC (delivery, cash only), MIS (intraday, leveraged, squared off at 15:20 IST),
             NRML (carry-forward F&O).

Fills walk the order book. A market buy consumes ask levels best-first and a market
sell consumes bids, so size moves the price. With no depth available (or when the book
is exhausted) the remainder fills at the last price plus an adverse slippage of
``slippage_bps`` per level, never at a better price than the book offered.

Margin and charges are simulation approximations, not a broker's SPAN/contract note:
rates live in ``CHARGES`` and ``MARGIN`` so they can be tuned.
"""

from __future__ import annotations

import json
import os
import threading
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path

from tradingagents.dataflows.vendors.india import nse_calendar

ORDER_TYPES = ("MARKET", "LIMIT", "SL", "SL-M")
PRODUCTS = ("CNC", "MIS", "NRML")
SIDES = ("BUY", "SELL")

DEFAULT_BALANCE = 1_000_000.0           # Rs 10,00,000
SQUARE_OFF_TIME = (15, 20)               # MIS positions are closed from 15:20 IST

# Fraction of notional blocked as margin. Approximations, tune to taste.
MARGIN = {
    "MIS_EQ": 0.20,        # 5x intraday leverage on equities
    "FUT": 0.12,
    "OPT_SELL_OF_STRIKE": 0.12,   # short options: 12% of strike value plus premium
}

# Statutory/broker charges, approximate retail-broker schedule (see module docstring).
CHARGES = {
    "brokerage_cap": 20.0, "brokerage_pct": 0.0003,
    "stt": {  # (buy_rate, sell_rate) on turnover
        ("EQ", "CNC"): (0.001, 0.001), ("EQ", "MIS"): (0.0, 0.00025),
        ("FUT", "NRML"): (0.0, 0.0005), ("OPT", "NRML"): (0.0, 0.001),
    },
    "txn": {"EQ": 0.0000297, "FUT": 0.0000173, "OPT": 0.0003503},
    "stamp_buy": {("EQ", "CNC"): 0.00015, ("EQ", "MIS"): 0.00003, "FUT": 0.00002, "OPT": 0.00003},
    "sebi": 10 / 1e7,
    "gst": 0.18,
}


class OrderRejected(ValueError):
    """The order failed validation or margin; the message is shown to the user."""


def _segment(kind: str) -> str:
    return "OPT" if kind in ("CE", "PE") else "FUT" if kind == "FUT" else "EQ"


def _round_tick(price: float, tick: float) -> float:
    if not tick:
        return round(price, 2)
    return round(round(price / tick) * tick, 2)


def charges_for(kind: str, product: str, side: str, qty: int, price: float) -> dict:
    """Itemised approximate charges for one executed fill."""
    seg = _segment(kind)
    turnover = qty * price
    if product == "CNC":
        brokerage = 0.0
    elif seg == "OPT":
        brokerage = CHARGES["brokerage_cap"]
    else:
        brokerage = min(CHARGES["brokerage_cap"], turnover * CHARGES["brokerage_pct"])
    stt_rates = CHARGES["stt"].get((seg, product)) or CHARGES["stt"].get((seg, "NRML")) or (0.0, 0.0)
    stt = turnover * (stt_rates[0] if side == "BUY" else stt_rates[1])
    txn = turnover * CHARGES["txn"][seg]
    sebi = turnover * CHARGES["sebi"]
    gst = CHARGES["gst"] * (brokerage + txn + sebi)
    stamp = 0.0
    if side == "BUY":
        rate = CHARGES["stamp_buy"].get((seg, product), CHARGES["stamp_buy"].get(seg, 0.0))
        stamp = turnover * rate
    parts = {"brokerage": brokerage, "stt": stt, "exchange": txn, "sebi": sebi, "gst": gst, "stamp": stamp}
    parts = {k: round(v, 2) for k, v in parts.items()}
    parts["total"] = round(sum(parts.values()), 2)
    return parts


@dataclass
class Fill:
    ts: str
    qty: int
    price: float
    charges: float


@dataclass
class Order:
    id: str
    ts: str
    key: str
    symbol: str
    name: str
    kind: str                    # EQ | CE | PE | FUT
    exchange: str
    side: str
    qty: int
    order_type: str
    product: str
    price: float | None = None           # limit price
    trigger_price: float | None = None   # for SL / SL-M
    lot_size: int = 1
    tick_size: float = 0.05
    status: str = "OPEN"          # OPEN | TRIGGER_PENDING | AMO | COMPLETE | CANCELLED | REJECTED
    filled_qty: int = 0
    avg_price: float = 0.0
    message: str = ""
    triggered: bool = False
    blocked_margin: float = 0.0
    fills: list[Fill] = field(default_factory=list)

    @property
    def pending_qty(self) -> int:
        return self.qty - self.filled_qty

    @property
    def active(self) -> bool:
        return self.status in ("OPEN", "TRIGGER_PENDING", "AMO")


@dataclass
class Position:
    key: str
    symbol: str
    name: str
    kind: str
    exchange: str
    product: str
    lot_size: int = 1
    qty: int = 0                 # signed: >0 long, <0 short
    avg_price: float = 0.0
    realized: float = 0.0        # booked P&L on this line, net of nothing (charges kept in ledger)
    opened: str = ""


class PaperAccount:
    """Thread-safe virtual account persisted to a JSON file."""

    def __init__(self, path: str | os.PathLike | None = None, initial_balance: float | None = None,
                 slippage_bps: float = 2.0):
        self._lock = threading.RLock()
        self.path = Path(path) if path else None
        self.initial_balance = float(initial_balance or os.environ.get("PAPER_INITIAL_BALANCE") or DEFAULT_BALANCE)
        self.slippage_bps = slippage_bps
        self.cash = self.initial_balance
        self.charges_paid = 0.0
        self.orders: dict[str, Order] = {}
        self.positions: dict[tuple[str, str], Position] = {}
        self.trades: list[dict] = []
        self._now: datetime | None = None    # clock of the latest session status handed in
        self._load()

    def _stamp(self) -> str:
        """Timestamp from the session clock the caller supplied (wall clock when none yet)."""
        return (self._now or nse_calendar.now_ist()).isoformat(timespec="seconds")

    # ------------------------------------------------------------- persistence
    def _load(self) -> None:
        if not self.path or not self.path.exists():
            return
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return
        self.initial_balance = raw.get("initial_balance", self.initial_balance)
        self.cash = raw.get("cash", self.cash)
        self.charges_paid = raw.get("charges_paid", 0.0)
        self.trades = raw.get("trades", [])
        for o in raw.get("orders", []):
            fills = [Fill(**f) for f in o.pop("fills", [])]
            self.orders[o["id"]] = Order(**o, fills=fills)
        for p in raw.get("positions", []):
            pos = Position(**p)
            self.positions[(pos.key, pos.product)] = pos

    def _save(self) -> None:
        if not self.path:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        data = {
            "initial_balance": self.initial_balance, "cash": self.cash, "charges_paid": self.charges_paid,
            "orders": [asdict(o) for o in self.orders.values()],
            "positions": [asdict(p) for p in self.positions.values()],
            "trades": self.trades[-2000:],
        }
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data), encoding="utf-8")
        os.replace(tmp, self.path)

    def reset(self, initial_balance: float | None = None) -> None:
        with self._lock:
            if initial_balance is not None:
                if initial_balance <= 0:
                    raise OrderRejected("Initial balance must be positive")
                self.initial_balance = float(initial_balance)
            self.cash = self.initial_balance
            self.charges_paid = 0.0
            self.orders.clear()
            self.positions.clear()
            self.trades.clear()
            self._save()

    # ------------------------------------------------------------------ margin
    def _margin_for(self, kind: str, product: str, side: str, qty: int, price: float,
                    strike: float = 0.0) -> float:
        notional = qty * price
        if product == "CNC":
            return notional if side == "BUY" else 0.0
        if kind == "EQ":
            return notional * MARGIN["MIS_EQ"]
        if kind == "FUT":
            return notional * MARGIN["FUT"]
        if side == "BUY":
            return notional
        return notional + qty * strike * MARGIN["OPT_SELL_OF_STRIKE"]

    def margin_used(self, marks: dict[str, float]) -> float:
        """Margin blocked by open MIS/NRML positions plus pending orders' reservations."""
        with self._lock:
            used = 0.0
            for pos in self.positions.values():
                if pos.product == "CNC" or pos.qty == 0:
                    continue
                mark = marks.get(pos.key, pos.avg_price)
                strike = _strike_of(pos)
                used += self._margin_for(pos.kind, pos.product, "BUY" if pos.qty > 0 else "SELL",
                                         abs(pos.qty), mark if pos.qty > 0 else pos.avg_price, strike)
            used += sum(o.blocked_margin for o in self.orders.values() if o.active)
            return used

    def available_margin(self, marks: dict[str, float]) -> float:
        return self.cash - self.margin_used(marks)

    # ---------------------------------------------------------------- placing
    def place_order(self, spec: dict, quote: dict | None, status: nse_calendar.MarketStatus,
                    marks: dict[str, float] | None = None) -> Order:
        """Validate and accept an order; fills immediately when it can."""
        with self._lock:
            self._now = status.now
            order = self._build(spec, quote)
            marks = marks or {}
            ref = self._reference_price(order, quote)
            if ref is None:
                raise OrderRejected("No price available for this instrument yet; cannot size margin")

            if order.kind == "INDEX":
                raise OrderRejected("Indices are not tradable; trade an index future/option or an ETF")
            self._validate(order)

            need = self._incremental_margin(order, ref)
            if need > self.available_margin(marks) + 1e-9:
                raise OrderRejected(
                    f"Insufficient funds: need Rs {need:,.2f}, available Rs {self.available_margin(marks):,.2f}"
                )
            order.blocked_margin = round(need, 2)
            self.orders[order.id] = order

            if not status.is_live:
                order.status = "AMO"
                order.message = f"After-market order; executes after {status.next_open:%a %d %b %H:%M} IST"
                self._save()
                return order

            order.status = "TRIGGER_PENDING" if order.order_type in ("SL", "SL-M") else "OPEN"
            if order.status == "OPEN" or self._trigger_hit(order, quote):
                self._process(order, quote, status)
            self._save()
            return order

    def _build(self, spec: dict, quote: dict | None) -> Order:
        try:
            side = str(spec["side"]).upper()
            order_type = str(spec.get("order_type", "MARKET")).upper()
            product = str(spec.get("product", "MIS")).upper()
            qty = int(spec["qty"])
        except (KeyError, TypeError, ValueError) as exc:
            raise OrderRejected(f"Malformed order: {exc}") from exc
        if side not in SIDES:
            raise OrderRejected("side must be BUY or SELL")
        if order_type not in ORDER_TYPES:
            raise OrderRejected(f"order_type must be one of {ORDER_TYPES}")
        if product not in PRODUCTS:
            raise OrderRejected(f"product must be one of {PRODUCTS}")
        if qty <= 0:
            raise OrderRejected("Quantity must be positive")
        price = _opt_float(spec.get("price"))
        trigger = _opt_float(spec.get("trigger_price"))
        return Order(
            id=uuid.uuid4().hex[:12], ts=self._stamp(),
            key=spec["key"], symbol=spec.get("symbol", ""), name=spec.get("name", ""),
            kind=spec.get("kind", "EQ"), exchange=spec.get("exchange", "NSE"),
            side=side, qty=qty, order_type=order_type, product=product, price=price, trigger_price=trigger,
            lot_size=int(spec.get("lot_size") or 1), tick_size=float(spec.get("tick_size") or 0.05),
        )

    def _validate(self, o: Order) -> None:
        if o.kind in ("CE", "PE", "FUT") and o.product != "NRML":
            if o.product == "CNC":
                raise OrderRejected("Derivatives cannot be bought with CNC; use NRML")
        if o.kind == "EQ" and o.product == "NRML":
            raise OrderRejected("Equities trade as CNC or MIS")
        if o.lot_size > 1 and o.qty % o.lot_size:
            raise OrderRejected(f"Quantity must be a multiple of the lot size ({o.lot_size})")
        if o.order_type in ("LIMIT", "SL") and not o.price:
            raise OrderRejected(f"{o.order_type} orders need a price")
        if o.order_type in ("SL", "SL-M") and not o.trigger_price:
            raise OrderRejected(f"{o.order_type} orders need a trigger price")
        for label, value in (("price", o.price), ("trigger price", o.trigger_price)):
            if value is not None and value <= 0:
                raise OrderRejected(f"{label} must be positive")
        if o.order_type == "SL" and o.price and o.trigger_price:
            # Stop-limit sanity: a buy limit must be at/above its trigger, a sell at/below.
            if o.side == "BUY" and o.price < o.trigger_price or o.side == "SELL" and o.price > o.trigger_price:
                raise OrderRejected("For SL orders the limit price must be beyond the trigger "
                                    "(BUY: price >= trigger, SELL: price <= trigger)")
        # CNC sells need holdings.
        if o.product == "CNC" and o.side == "SELL":
            held = self.positions.get((o.key, "CNC"))
            pending_sells = sum(x.pending_qty for x in self.orders.values()
                                if x.active and x.key == o.key and x.product == "CNC" and x.side == "SELL")
            if not held or held.qty - pending_sells < o.qty:
                have = (held.qty if held else 0) - pending_sells
                raise OrderRejected(f"Cannot sell {o.qty}: only {max(have, 0)} held in delivery (CNC). "
                                    "Use MIS to short intraday")

    def _reference_price(self, o: Order, quote: dict | None) -> float | None:
        if o.price and o.order_type in ("LIMIT", "SL"):
            return o.price
        if o.trigger_price and o.order_type == "SL-M":
            return o.trigger_price
        if quote and quote.get("ltp"):
            return float(quote["ltp"])
        return None

    def _incremental_margin(self, o: Order, ref: float) -> float:
        """Margin for the part of this order that opens new exposure (netting excluded)."""
        pos = self.positions.get((o.key, o.product))
        signed = o.qty if o.side == "BUY" else -o.qty
        existing = pos.qty if pos else 0
        if o.product == "CNC":
            return ref * o.qty if o.side == "BUY" else 0.0
        opening = o.qty
        if existing and (existing > 0) != (signed > 0):
            opening = max(0, o.qty - abs(existing))
        strike = _strike_from_symbol(o.symbol, o.kind)
        return self._margin_for(o.kind, o.product, o.side, opening, ref, strike)

    # -------------------------------------------------------------- execution
    @staticmethod
    def _trigger_hit(o: Order, quote: dict | None) -> bool:
        if not quote or not quote.get("ltp") or not o.trigger_price:
            return False
        ltp = float(quote["ltp"])
        return ltp >= o.trigger_price if o.side == "BUY" else ltp <= o.trigger_price

    def _consume(self, o: Order, quote: dict, limit: float | None) -> list[tuple[int, float]]:
        """(qty, price) slices available now for ``o`` against the book, honouring ``limit``."""
        want = o.pending_qty
        slices: list[tuple[int, float]] = []
        book = quote.get("asks") if o.side == "BUY" else quote.get("bids")
        for level in book or []:
            price, avail = level.get("price"), int(level.get("qty") or 0)
            if not price or avail <= 0:
                continue
            if limit is not None and (price > limit if o.side == "BUY" else price < limit):
                break
            take = min(want, avail)
            slices.append((take, float(price)))
            want -= take
            if not want:
                return slices
        ltp = quote.get("ltp")
        if want and ltp:
            adverse = 1 + (self.slippage_bps / 1e4) * (1 if o.side == "BUY" else -1) * (1 + len(slices))
            price = float(ltp) * adverse if not slices else slices[-1][1] * adverse
            price = _round_tick(price, o.tick_size)
            if limit is None or (price <= limit if o.side == "BUY" else price >= limit):
                slices.append((want, price))
        return slices

    def _process(self, o: Order, quote: dict | None, status: nse_calendar.MarketStatus) -> None:
        if not quote or not o.active or not status.is_live:
            return
        if o.order_type in ("SL", "SL-M") and not o.triggered:
            if not self._trigger_hit(o, quote):
                return
            o.triggered = True
            o.status = "OPEN"
            o.message = f"Triggered at {quote['ltp']}"
        limit = o.price if o.order_type in ("LIMIT", "SL") else None
        for qty, price in self._consume(o, quote, limit):
            self._fill(o, qty, _round_tick(price, o.tick_size))
        if o.pending_qty == 0:
            o.status = "COMPLETE"
            o.blocked_margin = 0.0

    def _fill(self, o: Order, qty: int, price: float) -> None:
        fee = charges_for(o.kind, o.product, o.side, qty, price)["total"]
        o.fills.append(Fill(self._stamp(), qty, price, fee))
        total_value = o.avg_price * o.filled_qty + price * qty
        o.filled_qty += qty
        o.avg_price = round(total_value / o.filled_qty, 4)
        if o.blocked_margin and o.qty:
            o.blocked_margin = round(o.blocked_margin * (o.pending_qty / o.qty), 2)

        key = (o.key, o.product)
        pos = self.positions.get(key) or Position(
            key=o.key, symbol=o.symbol, name=o.name, kind=o.kind, exchange=o.exchange, product=o.product,
            lot_size=o.lot_size, opened=self._stamp(),
        )
        signed = qty if o.side == "BUY" else -qty
        realized = 0.0
        if pos.qty == 0 or (pos.qty > 0) == (signed > 0):
            total = abs(pos.qty) * pos.avg_price + qty * price
            pos.qty += signed
            pos.avg_price = round(total / abs(pos.qty), 4)
        else:
            closing = min(qty, abs(pos.qty))
            realized = (price - pos.avg_price) * closing * (1 if pos.qty > 0 else -1)
            pos.realized = round(pos.realized + realized, 2)
            remaining = qty - closing
            pos.qty += signed
            if pos.qty == 0:
                pos.avg_price = 0.0
            elif remaining:  # flipped through zero: the new side opens at this fill price
                pos.avg_price = price
        self.positions[key] = pos

        # Cash ledger: CNC settles in cash at once; leveraged products settle P&L.
        # Delivery and option premium move cash both ways, so round trips net out by
        # themselves. Equity MIS and futures settle only their realised P&L.
        turnover = qty * price
        if o.product == "CNC" or o.kind in ("CE", "PE"):
            self.cash += -turnover if o.side == "BUY" else turnover
        else:
            self.cash += realized
        self.cash -= fee
        self.charges_paid += fee
        self.trades.append({
            "ts": o.fills[-1].ts, "order_id": o.id, "key": o.key, "symbol": o.symbol, "side": o.side,
            "qty": qty, "price": price, "product": o.product, "charges": fee, "realized": round(realized, 2),
        })

    # ------------------------------------------------------------- market feed
    def on_quotes(self, quotes: dict[str, dict], status: nse_calendar.MarketStatus) -> list[Order]:
        """Offer fresh quotes to pending orders; return orders that changed."""
        changed: list[Order] = []
        with self._lock:
            self._now = status.now
            if status.is_live:
                for o in list(self.orders.values()):
                    if not o.active:
                        continue
                    quote = quotes.get(o.key)
                    if not quote:
                        continue
                    before = (o.status, o.filled_qty)
                    if o.status == "AMO":
                        o.status = "TRIGGER_PENDING" if o.order_type in ("SL", "SL-M") else "OPEN"
                        o.message = "Released at market open"
                    self._process(o, quote, status)
                    if (o.status, o.filled_qty) != before:
                        changed.append(o)
                changed += self._square_off_mis(quotes, status)
            if changed:
                self._save()
        return changed

    def _square_off_mis(self, quotes: dict[str, dict], status: nse_calendar.MarketStatus) -> list[Order]:
        now = status.now
        due = (now.hour, now.minute) >= SQUARE_OFF_TIME
        today = now.date().isoformat()
        out = []
        for pos in list(self.positions.values()):
            if pos.product != "MIS" or pos.qty == 0 or pos.key not in quotes:
                continue
            if not due and pos.opened[:10] >= today:   # intraday positions run until 15:20
                continue
            for o in self.orders.values():  # cancel resting MIS orders on this instrument
                if o.active and o.key == pos.key and o.product == "MIS":
                    o.status, o.message = "CANCELLED", "Cancelled at intraday square-off"
                    o.blocked_margin = 0.0
            order = Order(
                id=uuid.uuid4().hex[:12], ts=now.isoformat(timespec="seconds"), key=pos.key, symbol=pos.symbol,
                name=pos.name, kind=pos.kind, exchange=pos.exchange, side="SELL" if pos.qty > 0 else "BUY",
                qty=abs(pos.qty), order_type="MARKET", product="MIS", lot_size=pos.lot_size,
                status="OPEN", message="Auto square-off (MIS)",
            )
            self.orders[order.id] = order
            self._process(order, quotes[pos.key], status)
            out.append(order)
        return out

    def cancel(self, order_id: str) -> Order:
        with self._lock:
            order = self.orders.get(order_id)
            if not order:
                raise OrderRejected("Unknown order")
            if not order.active:
                raise OrderRejected(f"Order is already {order.status}")
            order.status = "CANCELLED"
            order.blocked_margin = 0.0
            self._save()
            return order

    # --------------------------------------------------------------- reporting
    def snapshot(self, quotes: dict[str, dict]) -> dict:
        """Everything the UI needs: funds, positions, holdings, orders, trades, P&L."""
        with self._lock:
            marks = {k: q["ltp"] for k, q in quotes.items() if q and q.get("ltp")}
            positions, holdings = [], []
            unrealized = realized = 0.0
            invested = current = 0.0
            for pos in self.positions.values():
                mark = marks.get(pos.key)
                if pos.qty == 0 and not pos.realized:
                    continue
                row = {
                    "key": pos.key, "symbol": pos.symbol, "name": pos.name, "kind": pos.kind,
                    "product": pos.product, "qty": pos.qty, "avg_price": pos.avg_price,
                    "ltp": mark, "lot_size": pos.lot_size, "realized": pos.realized,
                    "unrealized": round((mark - pos.avg_price) * pos.qty, 2) if mark and pos.qty else 0.0,
                }
                row["pnl"] = round(row["realized"] + row["unrealized"], 2)
                row["pnl_pct"] = (round(row["unrealized"] / (pos.avg_price * abs(pos.qty)) * 100, 2)
                                  if pos.qty and pos.avg_price else 0.0)
                unrealized += row["unrealized"]
                realized += pos.realized
                if pos.product == "CNC":
                    if pos.qty:
                        holdings.append(row)
                        invested += pos.avg_price * pos.qty
                        current += (mark or pos.avg_price) * pos.qty
                else:
                    positions.append(row)
            used = self.margin_used(marks)
            equity = self.cash + sum(
                (marks.get(p.key, p.avg_price)) * p.qty for p in self.positions.values() if p.product == "CNC"
            ) + sum(
                (marks.get(p.key, p.avg_price) - p.avg_price) * p.qty
                for p in self.positions.values() if p.product != "CNC" and p.kind not in ("CE", "PE")
            ) + sum(
                marks.get(p.key, p.avg_price) * p.qty
                for p in self.positions.values() if p.kind in ("CE", "PE") and p.product != "CNC"
            )
            return {
                "funds": {
                    "initial": round(self.initial_balance, 2), "cash": round(self.cash, 2),
                    "margin_used": round(used, 2), "available": round(self.cash - used, 2),
                    "equity": round(equity, 2), "charges_paid": round(self.charges_paid, 2),
                    "realized": round(realized, 2), "unrealized": round(unrealized, 2),
                    "total_pnl": round(equity - self.initial_balance, 2),
                    "holdings_invested": round(invested, 2), "holdings_value": round(current, 2),
                },
                "positions": positions, "holdings": holdings,
                "orders": [self._order_dict(o) for o in sorted(self.orders.values(), key=lambda x: x.ts, reverse=True)],
                "trades": list(reversed(self.trades[-200:])),
            }

    @staticmethod
    def _order_dict(o: Order) -> dict:
        d = asdict(o)
        d["pending_qty"] = o.pending_qty
        return d

    def open_keys(self) -> set[str]:
        """Instruments the quote feed must keep warm for pending orders and positions."""
        with self._lock:
            keys = {o.key for o in self.orders.values() if o.active}
            keys |= {p.key for p in self.positions.values() if p.qty}
            return keys


def _opt_float(value) -> float | None:
    if value in (None, "", 0, "0"):
        return None
    try:
        return float(value)
    except (TypeError, ValueError) as exc:
        raise OrderRejected(f"Invalid number: {value!r}") from exc


def _strike_from_symbol(symbol: str, kind: str) -> float:
    """Strike from an option trading symbol like ``NIFTY 24000 CE`` (0 when not an option)."""
    if kind not in ("CE", "PE"):
        return 0.0
    for token in symbol.replace("-", " ").split():
        try:
            value = float(token)
            if value > 0:
                return value
        except ValueError:
            continue
    return 0.0


def _strike_of(pos: Position) -> float:
    return _strike_from_symbol(pos.symbol, pos.kind)
