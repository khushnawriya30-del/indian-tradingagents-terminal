/**
 * Liquid NSE universe used for movers, screeners, breadth and the home feed.
 * Symbols resolve against the official Upstox instrument master at request time.
 */

import { NIFTY_500 } from "./nifty500";

export const NIFTY_50 = [
  "ADANIENT", "ADANIPORTS", "APOLLOHOSP", "ASIANPAINT", "AXISBANK",
  "BAJAJ-AUTO", "BAJFINANCE", "BAJAJFINSV", "BEL", "BHARTIARTL",
  "CIPLA", "COALINDIA", "DRREDDY", "EICHERMOT", "ETERNAL",
  "GRASIM", "HCLTECH", "HDFCBANK", "HDFCLIFE", "HEROMOTOCO",
  "HINDALCO", "HINDUNILVR", "ICICIBANK", "INDUSINDBK", "INFY",
  "ITC", "JIOFIN", "JSWSTEEL", "KOTAKBANK", "LT",
  "M&M", "MARUTI", "MAXHEALTH", "NESTLEIND", "NTPC",
  "ONGC", "POWERGRID", "RELIANCE", "SBILIFE", "SBIN",
  "SHRIRAMFIN", "SUNPHARMA", "TATACONSUM", "TATAMOTORS", "TATASTEEL",
  "TCS", "TECHM", "TITAN", "TRENT", "ULTRACEMCO",
];

export const NIFTY_NEXT_50 = [
  "ABB", "ADANIENSOL", "ADANIGREEN", "ADANIPOWER", "AMBUJACEM",
  "BAJAJHLDNG", "BAJAJHFL", "BANKBARODA", "BPCL", "BOSCHLTD",
  "BRITANNIA", "CANBK", "CGPOWER", "CHOLAFIN", "DABUR",
  "DIVISLAB", "DLF", "DMART", "GAIL", "GODREJCP",
  "HAVELLS", "HAL", "ICICIGI", "ICICIPRULI", "INDHOTEL",
  "IOC", "IRFC", "IRCTC", "JINDALSTEL", "LICI",
  "LODHA", "LTIM", "MOTHERSON", "NAUKRI", "PFC",
  "PIDILITIND", "PNB", "RECLTD", "SIEMENS", "SHREECEM",
  "SWIGGY", "TATAPOWER", "TORNTPHARM", "TVSMOTOR", "UNITDSPR",
  "VBL", "VEDL", "ZYDUSLIFE", "INDIGO", "JSWENERGY",
];

export const LIQUID_MIDCAPS = [
  "IDEA", "YESBANK", "IREDA", "SUZLON", "OLAELEC",
  "PAYTM", "POLICYBZR", "NYKAA", "DELHIVERY", "KALYANKJIL",
  "TATATECH", "BSE", "CDSL", "ANGELONE", "MAZDOCK",
  "COCHINSHIP", "RVNL", "IRCON", "NBCC", "HUDCO",
  "BHEL", "SAIL", "NMDC", "NATIONALUM", "HINDCOPPER",
  "JSL", "APLAPOLLO", "DIXON", "POLYCAB", "KEI",
  "CROMPTON", "VOLTAS", "BLUESTARCO", "AMBER", "TIINDIA",
  "CUMMINSIND", "THERMAX", "KAYNES", "SYRMA", "TATACHEM",
  "DEEPAKNTR", "SRF", "PIIND", "UPL", "COROMANDEL",
  "CHAMBLFERT", "GNFC", "RCF", "PNBHOUSING", "CANFINHOME",
  "MUTHOOTFIN", "MANAPPURAM", "IIFL", "ABCAPITAL", "CHOLAHLDNG",
  "FORTIS", "MAXHEALTH", "LUPIN", "AUROPHARMA", "ALKEM",
  "BIOCON", "GLENMARK", "IPCALAB", "LAURUSLABS", "GRANULES",
  "PERSISTENT", "COFORGE", "LTTS", "KPITTECH", "TATAELXSI",
  "MPHASIS", "CYIENT", "ZENSARTECH", "SONACOMS", "EXIDEIND",
  "BHARATFORG", "APOLLOTYRE", "MRF", "BALKRISIND", "ASHOKLEY",
  "ESCORTS", "TVSHLTD", "OBEROIRLTY", "GODREJPROP", "PRESTIGE",
  "PHOENIXLTD", "BRIGADE", "SOBHA", "JUBLFOOD", "DEVYANI",
  "VINATIORGA", "TATACONSUM", "MARICO", "EMAMILTD", "COLPAL",
  "GILLETTE", "PGHH", "HONAUT", "ABBOTINDIA", "PFIZER",
];

export const ETF_SYMBOLS = [
  "NIFTYBEES", "BANKBEES", "GOLDBEES", "SILVERBEES", "JUNIORBEES",
  "ITBEES", "LIQUIDBEES", "MOM100", "MON100", "MAFANG",
  "PSUBNKBEES", "INFRABEES", "CPSEETF", "SETFNIF50", "HDFCNIFTY",
  "ICICINIFTY", "AXISNIFTY", "NIFTYETF", "MIDCAPETF", "NIFTYIETF",
  "BANKNIFTY1", "HDFCBANK", "CHEMICAL", "CONSUMBEES", "AUTOIETF",
];

export const SECTOR_INDICES: Array<{ key: string; label: string }> = [
  { key: "NSE_INDEX|Nifty IT", label: "Nifty IT" },
  { key: "NSE_INDEX|Nifty Bank", label: "Nifty Bank" },
  { key: "NSE_INDEX|Nifty Fin Service", label: "Financial Services" },
  { key: "NSE_INDEX|Nifty Auto", label: "Nifty Auto" },
  { key: "NSE_INDEX|Nifty Pharma", label: "Nifty Pharma" },
  { key: "NSE_INDEX|NIFTY HEALTHCARE", label: "Healthcare" },
  { key: "NSE_INDEX|Nifty FMCG", label: "Nifty FMCG" },
  { key: "NSE_INDEX|Nifty Metal", label: "Nifty Metal" },
  { key: "NSE_INDEX|Nifty Energy", label: "Nifty Energy" },
  { key: "NSE_INDEX|Nifty Realty", label: "Nifty Realty" },
  { key: "NSE_INDEX|Nifty PSU Bank", label: "PSU Bank" },
  { key: "NSE_INDEX|Nifty Pvt Bank", label: "Private Bank" },
  { key: "NSE_INDEX|Nifty Media", label: "Nifty Media" },
  { key: "NSE_INDEX|Nifty Infra", label: "Nifty Infra" },
  { key: "NSE_INDEX|Nifty Consumption", label: "Consumption" },
  { key: "NSE_INDEX|Nifty Chemicals", label: "Chemicals" },
  { key: "NSE_INDEX|Nifty Capital Mkt", label: "Capital Markets" },
  { key: "NSE_INDEX|Nifty Ind Defence", label: "Defence" },
  { key: "NSE_INDEX|Nifty EV", label: "EV & Mobility" },
  { key: "NSE_INDEX|Nifty CPSE", label: "CPSE" },
];

export const INDEX_TICKERS = [
  { key: "NSE_INDEX|Nifty 50", label: "NIFTY 50" },
  { key: "NSE_INDEX|Nifty Bank", label: "BANKNIFTY" },
  { key: "BSE_INDEX|SENSEX", label: "SENSEX" },
  { key: "NSE_INDEX|India VIX", label: "INDIA VIX" },
];

export const OPTION_UNDERLYINGS = [
  { symbol: "NIFTY", label: "NIFTY 50", key: "NSE_INDEX|Nifty 50" },
  { symbol: "BANKNIFTY", label: "BANKNIFTY", key: "NSE_INDEX|Nifty Bank" },
  { symbol: "FINNIFTY", label: "FINNIFTY", key: "NSE_INDEX|Nifty Fin Service" },
  { symbol: "MIDCPNIFTY", label: "MIDCPNIFTY", key: "NSE_INDEX|NIFTY MID SELECT" },
  { symbol: "SENSEX", label: "SENSEX", key: "BSE_INDEX|SENSEX" },
];

export const FUTURE_UNDERLYINGS = [
  "NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX",
  "RELIANCE", "HDFCBANK", "TCS", "INFY", "ICICIBANK",
  "SBIN", "BHARTIARTL", "ITC", "LT", "AXISBANK",
  "KOTAKBANK", "BAJFINANCE", "MARUTI", "TATAMOTORS", "TATASTEEL",
];

export const COMMODITY_SYMBOLS = [
  "GOLD", "SILVER", "CRUDEOIL", "NATURALGAS", "COPPER",
  "ZINC", "ALUMINIUM", "LEAD", "NICKEL", "COTTON",
  "MENTHAOIL", "GOLDM", "SILVERM", "CRUDEOILM", "NATGASMINI",
];

export const UNIVERSE_SYMBOLS = Array.from(new Set([...NIFTY_500, ...LIQUID_MIDCAPS]));

export const INDEX_CONSTITUENT_SYMBOLS = new Set([...NIFTY_500, ...LIQUID_MIDCAPS]);

export { NIFTY_500 };

