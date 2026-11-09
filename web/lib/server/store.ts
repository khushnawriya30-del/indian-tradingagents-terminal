import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./env";
import type {
  EnrichedPosition,
  Order,
  OrderRequest,
  PortfolioFunds,
  PortfolioSnapshot,
  Product,
  Quote,
  SessionState,
  Side,
  Trade,
  WatchlistItem,
} from "../types";
import { computeCharges, round2 } from "../charges";
import { resolveInstrument } from "./instruments";

interface RawPosition {
  instrument_key: string;
  symbol: string;
  quantity: number;
  average_price: number;
  product: Product;
}

export interface PaperState {
  cash: number;
  blocked: number;
  starting_balance: number;
  realized_pnl: number;
  positions: Record<string, RawPosition>;
  orders: Order[];
  trades: Trade[];
  watchlist: string[];
}

const DEFAULT_WATCHLIST = [
  "NSE_INDEX|Nifty 50",
  "NSE_INDEX|Nifty Bank",
  "BSE_INDEX|SENSEX",
  "NSE_INDEX|India VIX",
  "NSE_EQ|INE002A01018", // RELIANCE
  "NSE_EQ|INE040A01034", // HDFCBANK
  "NSE_EQ|INE467B01029", // TCS
  "NSE_EQ|INE009A01021", // INFY
  "NSE_EQ|INE062A01020", // SBIN
  "NSE_EQ|INE155A01022", // TATAMOTORS
  "NSE_EQ|INE397D01024", // BHARTIARTL
  "NSE_EQ|INE018A01030", // LT
];

function stateFile(): string {
  return path.join(dataDir(), "paper_state.json");
}

let memoryState: PaperState | null = null;

export async function ensureState(): Promise<PaperState> {
  if (memoryState) return memoryState;
  const file = stateFile();
  if (fs.existsSync(file)) {
    try {
      memoryState = JSON.parse(fs.readFileSync(file, "utf8"));
      return memoryState!;
    } catch {
      // corrupt file, reinitialize
    }
  }

  memoryState = {
    cash: 1000000,
    blocked: 0,
    starting_balance: 1000000,
    realized_pnl: 0,
    positions: {},
    orders: [],
    trades: [],
    watchlist: [...DEFAULT_WATCHLIST],
  };
  saveState(memoryState);
  return memoryState;
}

function saveState(st: PaperState) {
  try {
    fs.writeFileSync(stateFile(), JSON.stringify(st, null, 2), "utf8");
  } catch {
    // ignore
  }
}

export async function mutateState(
  fn: (current: PaperState) => Promise<PaperState> | PaperState
): Promise<PaperState> {
  const current = await ensureState();
  const next = await fn(current);
  memoryState = next;
  saveState(next);
  return next;
}

export function instrumentKeysForState(state: PaperState): string[] {
  const keys = new Set<string>(state.watchlist);
  for (const pos of Object.values(state.positions)) {
    if (pos.quantity !== 0) keys.add(pos.instrument_key);
  }
  for (const ord of state.orders) {
    if (ord.status === "OPEN" || ord.status === "PENDING") {
      keys.add(ord.instrument_key);
    }
  }
  return Array.from(keys);
}

export async function watchlistLabels(keys: string[]): Promise<WatchlistItem[]> {
  return Promise.all(
    keys.map(async (k) => {
      const ins = await resolveInstrument(k).catch(() => null);
      const sym = ins?.trading_symbol || k.split("|")[1] || k;
      const seg = ins?.segment || (k.startsWith("NSE_INDEX") ? "NSE_INDEX" : k.startsWith("BSE_INDEX") ? "BSE_INDEX" : "NSE_EQ");
      return {
        instrument_key: k,
        symbol: sym,
        display: sym,
        name: ins?.name || sym,
        segment: seg,
        exchange: k.startsWith("BSE") ? "BSE" : "NSE",
      };
    })
  );
}

export async function addWatchlist(key: string): Promise<string[]> {
  await mutateState((st) => {
    if (!st.watchlist.includes(key)) {
      st.watchlist.unshift(key);
    }
    return st;
  });
  return memoryState!.watchlist;
}

export async function removeWatchlist(key: string): Promise<string[]> {
  await mutateState((st) => {
    st.watchlist = st.watchlist.filter((k) => k !== key);
    return st;
  });
  return memoryState!.watchlist;
}

export async function placeOrder(
  req: OrderRequest,
  quotes: Record<string, Quote>,
  session: SessionState
): Promise<{ ok: boolean; order?: Order; error?: string }> {
  const q = quotes[req.instrument_key];
  const price = q?.last_price || req.limit_price || 0;
  if (!price || price <= 0) {
    return { ok: false, error: "No price available for instrument" };
  }

  const charges = computeCharges(req.side, req.product, price, req.quantity);
  const notional = price * req.quantity;
  const marginRequired =
    req.product === "CNC"
      ? req.side === "BUY" ? notional + charges.total : charges.total
      : notional / 5 + charges.total;

  const current = await ensureState();
  if (marginRequired > current.cash) {
    return { ok: false, error: "Insufficient available cash" };
  }

  const id = `ORD_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const ins = await resolveInstrument(req.instrument_key);
  const sym = ins?.trading_symbol || req.instrument_key.split("|")[1] || req.instrument_key;

  const order: Order = {
    ...req,
    id,
    symbol: sym,
    status: req.order_type === "MARKET" && session.is_open ? "COMPLETE" : "OPEN",
    average_price: req.order_type === "MARKET" && session.is_open ? price : undefined,
    status_message:
      req.order_type === "MARKET" && session.is_open
        ? "Filled immediately"
        : session.is_open
          ? "Queued"
          : "Queued — fills at next market open",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  await mutateState((st) => {
    st.orders.unshift(order);
    if (order.status === "COMPLETE") {
      executeFill(st, order, price, charges.total);
    } else {
      order.blocked_amount = marginRequired;
      st.cash -= marginRequired;
      st.blocked += marginRequired;
    }
    return st;
  });

  return { ok: true, order };
}

function executeFill(st: PaperState, order: Order, fillPrice: number, charges: number) {
  const notional = fillPrice * order.quantity;
  const isBuy = order.side === "BUY";
  const posKey = `${order.instrument_key}:${order.product}`;
  const existing = st.positions[posKey] || {
    instrument_key: order.instrument_key,
    symbol: order.symbol,
    quantity: 0,
    average_price: 0,
    product: order.product,
  };

  if (isBuy) {
    const totalQty = existing.quantity + order.quantity;
    const totalCost = existing.quantity * existing.average_price + notional;
    existing.quantity = totalQty;
    existing.average_price = totalQty > 0 ? round2(totalCost / totalQty) : 0;
    st.cash -= (notional + charges);
  } else {
    // SELL
    const realized = (fillPrice - existing.average_price) * Math.min(existing.quantity, order.quantity);
    st.realized_pnl += realized;
    existing.quantity -= order.quantity;
    st.cash += (notional - charges);
  }

  if (existing.quantity === 0) {
    delete st.positions[posKey];
  } else {
    st.positions[posKey] = existing;
  }

  st.trades.unshift({
    id: `TRD_${Date.now()}`,
    order_id: order.id,
    instrument_key: order.instrument_key,
    symbol: order.symbol,
    side: order.side,
    quantity: order.quantity,
    price: fillPrice,
    charges: { total: charges },
    product: order.product,
    executed_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    realized_pnl: !isBuy ? (fillPrice - existing.average_price) * order.quantity : 0,
  });
}

export async function cancelOrder(id: string): Promise<Order | null> {
  let target: Order | null = null;
  await mutateState((st) => {
    const ord = st.orders.find((o) => o.id === id);
    if (ord && (ord.status === "OPEN" || ord.status === "PENDING")) {
      ord.status = "CANCELLED";
      ord.status_message = "Cancelled by user";
      ord.updated_at = new Date().toISOString();
      if (ord.blocked_amount) {
        st.cash += ord.blocked_amount;
        st.blocked = Math.max(0, st.blocked - ord.blocked_amount);
        ord.blocked_amount = 0;
      }
      target = ord;
    }
    return st;
  });
  return target;
}

export async function processOrders(
  state: PaperState,
  quotes: Record<string, Quote>,
  session: SessionState
): Promise<void> {
  for (const ord of state.orders) {
    if (ord.status !== "OPEN" && ord.status !== "PENDING") continue;
    const q = quotes[ord.instrument_key];
    if (!q || !q.last_price) continue;
    const ltp = q.last_price;

    let fill = false;
    if (ord.order_type === "MARKET") {
      // Market orders queued while the exchange was closed fill on the next open.
      fill = session.is_open;
    } else if (ord.order_type === "LIMIT") {
      if (ord.side === "BUY" && ord.limit_price && ltp <= ord.limit_price) fill = true;
      if (ord.side === "SELL" && ord.limit_price && ltp >= ord.limit_price) fill = true;
    } else if (ord.order_type === "SL-M" || ord.order_type === "SL") {
      if (ord.side === "BUY" && ord.trigger_price && ltp >= ord.trigger_price) fill = true;
      if (ord.side === "SELL" && ord.trigger_price && ltp <= ord.trigger_price) fill = true;
    } else if (session.is_open) {
      fill = true;
    }

    if (fill) {
      ord.status = "COMPLETE";
      ord.average_price = ltp;
      ord.status_message = "Filled on trigger/limit";
      ord.updated_at = new Date().toISOString();
      if (ord.blocked_amount) {
        state.cash += ord.blocked_amount;
        state.blocked = Math.max(0, state.blocked - ord.blocked_amount);
        ord.blocked_amount = 0;
      }
      const charges = computeCharges(ord.side, ord.product, ltp, ord.quantity);
      executeFill(state, ord, ltp, charges.total);
    }
  }
}

export function buildPortfolio(
  state: PaperState,
  quotes: Record<string, Quote>,
  session: SessionState
): PortfolioSnapshot {
  let holdingsValue = 0;
  let positionsValue = 0;
  let unrealizedPnl = 0;
  let dayPnl = 0;

  const positions: EnrichedPosition[] = [];
  const holdings: EnrichedPosition[] = [];

  for (const p of Object.values(state.positions)) {
    const q = quotes[p.instrument_key];
    const ltp = q?.last_price || p.average_price;
    const cp = q?.previous_close || p.average_price;
    const value = round2(ltp * p.quantity);
    const pnl = round2((ltp - p.average_price) * p.quantity);
    const cost = p.average_price * p.quantity;
    const pnlPct = cost > 0 ? round2((pnl / cost) * 100) : 0;
    const dayChgPct = q?.change_percent || 0;

    unrealizedPnl += pnl;
    dayPnl += round2((ltp - cp) * p.quantity);

    const enriched: EnrichedPosition = {
      instrument_key: p.instrument_key,
      symbol: p.symbol,
      name: p.symbol,
      quantity: p.quantity,
      average_price: p.average_price,
      last_price: ltp,
      day_change_percent: dayChgPct,
      value,
      pnl,
      pnl_percent: pnlPct,
      product: p.product,
      side: p.quantity >= 0 ? "LONG" : "SHORT",
      margin_blocked: p.product === "MIS" ? round2(value / 5) : 0,
    };

    if (p.product === "CNC") {
      holdingsValue += value;
      holdings.push(enriched);
    } else {
      positionsValue += value;
      positions.push(enriched);
    }
  }

  const totalValue = round2(state.cash + state.blocked + holdingsValue + positionsValue);
  const totalPnl = round2(totalValue - state.starting_balance);
  const totalPnlPct = state.starting_balance > 0 ? round2((totalPnl / state.starting_balance) * 100) : 0;

  const funds: PortfolioFunds = {
    starting_balance: state.starting_balance,
    available: round2(state.cash),
    margin_blocked: round2(state.blocked),
    total_value: totalValue,
    total_pnl: totalPnl,
    total_pnl_percent: totalPnlPct,
    day_pnl: round2(dayPnl),
    unrealized_pnl: round2(unrealizedPnl),
    realized_pnl: round2(state.realized_pnl),
    holdings_value: round2(holdingsValue),
  };

  return {
    funds,
    positions,
    holdings,
    orders: state.orders,
    trades: state.trades,
  };
}
