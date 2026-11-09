export interface HomeStock {
  key: string;
  symbol: string;
  name: string;
  segment: string;
  ltp: number;
  change: number;
  change_percent: number;
  open: number;
  high: number;
  low: number;
  previous_close: number;
  volume: number;
}

export interface HomeOption {
  key: string;
  symbol: string;
  underlying: string;
  expiry: string;
  strike: number;
  side: "CE" | "PE";
  ltp: number;
  change: number;
  change_percent: number;
  oi: number;
  oi_change: number;
  volume: number;
  iv: number;
}

export interface ChainSummary {
  key: string;
  symbol: string;
  label: string;
  expiry: string;
  spot: number;
  change_percent: number;
  atm: number;
  atm_iv: number;
  pcr: number;
  max_pain: number;
  support: number;
  resistance: number;
  call_oi: number;
  put_oi: number;
}

export interface LadderRow {
  strike: number;
  call_oi: number;
  put_oi: number;
  call_oi_change: number;
  put_oi_change: number;
  call_ltp: number;
  put_ltp: number;
  call_iv: number;
  put_iv: number;
}

export interface HomeFuture {
  key: string;
  symbol: string;
  underlying: string;
  expiry: number;
  ltp: number;
  change: number;
  change_percent: number;
  oi: number;
  oi_change: number;
  spot: number;
  premium: number;
  lot_size: number;
  segment: string;
}

export interface HomeCommodity {
  key: string;
  symbol: string;
  trading_symbol: string;
  expiry: number;
  lot_size: number;
  ltp: number;
  change: number;
  change_percent: number;
  volume: number;
  oi: number;
}

export interface HomeSection<T> {
  rows: T[];
}

export interface HomeData {
  tab: string;
  generated_at: string;
  indices: Array<{
    key: string;
    symbol: string;
    label: string;
    ltp: number;
    change: number;
    change_percent: number;
    open: number;
    high: number;
    low: number;
    previous_close: number;
  }>;
  breadth: { advancing: number; declining: number; unchanged: number; total: number };
  sections: {
    trendingStocks: {
      chips: Array<{ id: string; label: string; rows: HomeStock[] }>;
      cards: HomeStock[];
    };
    movers: { gainers: HomeStock[]; losers: HomeStock[] };
    mostBought: HomeSection<HomeStock>;
    buzzing: HomeSection<HomeStock>;
    momentum: HomeSection<HomeStock>;
    screeners: {
      tabs: Array<{ id: string; label: string; rows: HomeStock[] }>;
    };
    under500: HomeSection<HomeStock>;
    sectors: { rows: Array<{ key: string; label: string; ltp: number; change: number; change_percent: number }> };
    etfs: { rows: Array<{ key: string; symbol: string; name: string; ltp: number; change_percent: number; volume: number; segment: string }> };
    simpleInvesting: {
      baskets: Array<{ id: string; name: string; note: string; return_1y: number }>;
    };
    advisory: { baskets: Array<{ id: string; name: string; note: string; icon: string }> };
    ipo: {
      rows: Array<{ name: string; symbol: string; segment: string; open: string; close: string; price: string; status: string; subscription: string }>;
    };
    options: {
      summaries: ChainSummary[];
      trending: HomeOption[];
      ladder: LadderRow[];
    };
    futures: {
      rows: HomeFuture[];
      heatmap: HomeFuture[];
      oiScanners: { oi_change: HomeFuture[]; ltp: HomeFuture[]; change: HomeFuture[] };
    };
    commodities: {
      rows: HomeCommodity[];
      movers: HomeCommodity[];
      laggards: HomeCommodity[];
      expiring: HomeCommodity[];
      options: HomeCommodity[];
    };
  };
}
