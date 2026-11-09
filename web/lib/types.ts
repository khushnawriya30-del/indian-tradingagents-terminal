export type SessionPhase = "open" | "pre_open" | "closed" | "weekend" | "holiday";

export interface SessionState {
  phase: SessionPhase;
  is_open: boolean;
  seconds_to_open: number;
  next_open_ist: string;
  last_close_date: string;
  session_date: string;
  message?: string;
}

export type Side = "BUY" | "SELL";
export type Product = "CNC" | "MIS";
export type OrderType = "MARKET" | "LIMIT" | "SL" | "SL-M";
export type OrderStatus = "OPEN" | "PENDING" | "COMPLETE" | "CANCELLED" | "REJECTED";

export interface OrderRequest {
  instrument_key: string;
  side: Side;
  quantity: number;
  order_type: OrderType;
  product: Product;
  limit_price?: number | null;
  trigger_price?: number | null;
}

export interface Order extends OrderRequest {
  id: string;
  symbol: string;
  status: OrderStatus;
  average_price?: number;
  status_message?: string;
  /** Margin parked while the order waits for a fill; released on fill or cancel. */
  blocked_amount?: number;
  created_at: string;
  updated_at: string;
}

export interface Trade {
  id: string;
  order_id: string;
  instrument_key: string;
  symbol: string;
  side: Side;
  quantity: number;
  price: number;
  charges: { total: number };
  product: Product;
  executed_at: string;
  created_at: string;
  realized_pnl?: number;
}

export interface Quote {
  key: string;
  instrument_key: string;
  symbol: string;
  name?: string;
  segment?: string;
  frozen?: boolean;
  last_price: number;
  change: number;
  change_percent: number;
  open: number;
  high: number;
  low: number;
  previous_close: number;
  volume: number;
  average_price?: number;
  oi?: number;
  bid?: number;
  ask?: number;
  depth?: {
    buy: any[];
    sell: any[];
    bid?: any[];
    ask?: any[];
  };
  ts?: number;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface WatchlistItem {
  instrument_key: string;
  symbol: string;
  display: string;
  name: string;
  segment: string;
  exchange: string;
}

export interface InstrumentHit {
  instrument_key: string;
  trading_symbol: string;
  symbol: string;
  display: string;
  name: string;
  segment: string;
  exchange: string;
  is_index?: boolean;
}

export interface OptionLeg {
  instrument_key: string;
  ltp: number;
  change: number;
  oi: number;
  prev_oi: number;
  volume: number;
  iv: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  pop: number;
  bid: number;
  ask: number;
}

export interface ChainRow {
  strike: number;
  strike_price?: number;
  call: OptionLeg;
  put: OptionLeg;
}

export interface ChainTotals {
  call_oi: number;
  put_oi: number;
  pcr: number;
  call_volume: number;
  put_volume: number;
  max_pain: number | null;
}

export interface ChainPayload {
  underlying: string;
  underlying_key?: string;
  expiry: string;
  expiries: string[];
  lot_size?: number;
  spot: number;
  spot_price?: number;
  previous_close?: number | null;
  rows: ChainRow[];
  totals: ChainTotals;
  session?: SessionState;
  source?: string;
}

export interface EnrichedPosition {
  instrument_key: string;
  symbol: string;
  name?: string;
  quantity: number;
  average_price: number;
  last_price: number;
  day_change_percent: number;
  value: number;
  pnl: number;
  pnl_percent: number;
  product: Product;
  side: "LONG" | "SHORT" | Side;
  margin_blocked?: number;
}

export interface PortfolioFunds {
  starting_balance: number;
  available: number;
  margin_blocked: number;
  total_value: number;
  total_pnl: number;
  total_pnl_percent: number;
  day_pnl: number;
  unrealized_pnl: number;
  realized_pnl: number;
  holdings_value: number;
}

export interface PortfolioSnapshot {
  funds: PortfolioFunds;
  positions: EnrichedPosition[];
  holdings: EnrichedPosition[];
  orders: Order[];
  trades: Trade[];
  session?: SessionState;
}

export type AuditLinks = Record<string, string>;
