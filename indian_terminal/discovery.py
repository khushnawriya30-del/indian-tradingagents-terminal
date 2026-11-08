"""Upstox Pro Discovery Data Provider.

Supplies market discovery feeds matching the Upstox Pro Home experience:
- Ideas (Trending Stocks, Trending Options, OI Analysis, Quick Actions, High-Performing Ideas,
         Option Chain Indices, Trending Commodities, Trending Futures, IPOs, Buzzing Stocks, Momentum Gainers)
- Stocks (Sector Heatmap, Top Gainers/Losers, Volume Shockers, 52W High/Low Breakouts)
- Options (Active Calls/Puts, PCR, Max Pain, Option Chain quick access)
- Futures (Buildup classifications: Long Buildup, Short Buildup, Short Covering, Long Unwinding, Heatmap)
- Commodities (MCX Live Quotes: Gold, Silver, Crude Oil, Natural Gas, Zinc, Copper)
"""

from __future__ import annotations

import math
import random
import time
from typing import Any


def get_discovery_all(master=None, quotes_snap=None) -> dict[str, Any]:
    return {
        "ideas": get_ideas_feed(),
        "stocks": get_stocks_feed(),
        "options": get_options_feed(),
        "futures": get_futures_feed(),
        "commodities": get_commodities_feed(),
    }


def get_ideas_feed() -> dict[str, Any]:
    # 1. Trending Stocks with Pagination data (110, 122, 34, 141 pages)
    most_bought = [
        {"symbol": "GOLDBEES", "name": "NIPPON INDIA ETF GOLD BEES", "ltp": 68.45, "chg": 0.35, "pchg": 0.51, "vol": "1.2Cr", "icon": "gold"},
        {"symbol": "COALINDIA", "name": "COAL INDIA LTD.", "ltp": 448.20, "chg": 8.60, "pchg": 1.96, "vol": "85.4L", "icon": "coal"},
        {"symbol": "TATASTEEL", "name": "TATA STEEL LIMITED", "ltp": 149.30, "chg": -1.25, "pchg": -0.83, "vol": "2.4Cr", "icon": "tata"},
        {"symbol": "JIOFIN", "name": "JIO FINANCIAL SERVICES LTD", "ltp": 318.50, "chg": 4.10, "pchg": 1.30, "vol": "1.8Cr", "icon": "jio"},
        {"symbol": "SUZLON", "name": "SUZLON ENERGY LIMITED", "ltp": 62.40, "chg": 1.85, "pchg": 3.05, "vol": "4.5Cr", "icon": "suzlon"},
        {"symbol": "ZOMATO", "name": "ZOMATO LIMITED", "ltp": 258.90, "chg": 5.40, "pchg": 2.13, "vol": "3.1Cr", "icon": "zomato"},
    ]
    top_gainers = [
        {"symbol": "DIXON", "name": "DIXON TECHNOLOGIES LTD", "ltp": 14850.00, "chg": 845.20, "pchg": 6.03, "vol": "12.4L"},
        {"symbol": "PERSISTENT", "name": "PERSISTENT SYSTEMS LTD", "ltp": 5740.00, "chg": 280.50, "pchg": 5.14, "vol": "8.9L"},
        {"symbol": "FEDERALBNK", "name": "FEDERAL BANK LTD", "ltp": 204.60, "chg": 8.75, "pchg": 4.47, "vol": "1.5Cr"},
        {"symbol": "TRENT", "name": "TRENT LIMITED", "ltp": 6850.00, "chg": 265.00, "pchg": 4.02, "vol": "14.2L"},
        {"symbol": "BEL", "name": "BHARAT ELECTRONICS LTD", "ltp": 298.40, "chg": 11.20, "pchg": 3.90, "vol": "2.1Cr"},
        {"symbol": "HINDALCO", "name": "HINDALCO INDUSTRIES LTD", "ltp": 680.50, "chg": 24.30, "pchg": 3.70, "vol": "98.5L"},
    ]
    top_losers = [
        {"symbol": "INDUSINDBK", "name": "INDUSIND BANK LTD", "ltp": 1045.00, "chg": -48.50, "pchg": -4.44, "vol": "42.1L"},
        {"symbol": "CIPLA", "name": "CIPLA LIMITED", "ltp": 1490.00, "chg": -52.00, "pchg": -3.37, "vol": "18.3L"},
        {"symbol": "NESTLEIND", "name": "NESTLE INDIA LIMITED", "ltp": 2240.00, "chg": -64.20, "pchg": -2.79, "vol": "6.8L"},
        {"symbol": "TITAN", "name": "TITAN COMPANY LIMITED", "ltp": 3210.00, "chg": -75.00, "pchg": -2.28, "vol": "15.4L"},
        {"symbol": "MARUTI", "name": "MARUTI SUZUKI INDIA LTD", "ltp": 11250.00, "chg": -240.00, "pchg": -2.09, "vol": "5.2L"},
        {"symbol": "BAJFINANCE", "name": "BAJAJ FINANCE LIMITED", "ltp": 6780.00, "chg": -125.00, "pchg": -1.81, "vol": "11.1L"},
    ]
    trading_under_500 = [
        {"symbol": "TATASTEEL", "name": "TATA STEEL LIMITED", "ltp": 149.30, "chg": -1.25, "pchg": -0.83, "vol": "2.4Cr"},
        {"symbol": "COALINDIA", "name": "COAL INDIA LTD.", "ltp": 448.20, "chg": 8.60, "pchg": 1.96, "vol": "85.4L"},
        {"symbol": "IDFCFIRSTB", "name": "IDFC FIRST BANK LTD", "ltp": 67.80, "chg": 1.15, "pchg": 1.73, "vol": "2.8Cr"},
        {"symbol": "PFC", "name": "POWER FINANCE CORP LTD", "ltp": 465.00, "chg": 9.40, "pchg": 2.06, "vol": "76.2L"},
        {"symbol": "RECLTD", "name": "REC LIMITED", "ltp": 492.50, "chg": 11.20, "pchg": 2.33, "vol": "82.5L"},
        {"symbol": "IOC", "name": "INDIAN OIL CORP LTD", "ltp": 138.40, "chg": 2.10, "pchg": 1.54, "vol": "1.1Cr"},
    ]

    # 2. Trending Options
    trending_options = [
        {"contract": "NIFTY 25000 CE", "expiry": "14 Nov 2026", "ltp": 168.45, "chg": 32.50, "pchg": 23.90, "oi": "78.4L", "vol": "3.2Cr"},
        {"contract": "NIFTY 24900 PE", "expiry": "14 Nov 2026", "ltp": 112.10, "chg": -28.40, "pchg": -20.21, "oi": "65.2L", "vol": "2.8Cr"},
        {"contract": "BANKNIFTY 51500 CE", "expiry": "13 Nov 2026", "ltp": 345.00, "chg": 48.00, "pchg": 16.16, "oi": "42.1L", "vol": "1.6Cr"},
        {"contract": "BANKNIFTY 51000 PE", "expiry": "13 Nov 2026", "ltp": 215.50, "chg": -62.00, "pchg": -22.34, "oi": "38.9L", "vol": "1.9Cr"},
        {"contract": "RELIANCE 1440 CE", "expiry": "28 Nov 2026", "ltp": 28.50, "chg": 4.20, "pchg": 17.28, "oi": "18.2L", "vol": "54.0L"},
    ]

    # 3. OI Analysis Chart Data (NIFTY 50 around Spot 25,000)
    strikes = [24600, 24700, 24800, 24900, 25000, 25100, 25200, 25300, 25400]
    call_oi = [15.2, 28.4, 45.1, 72.8, 125.4, 98.6, 84.2, 62.1, 41.5]
    put_oi = [82.4, 95.1, 110.2, 138.5, 98.2, 54.1, 32.8, 18.4, 9.6]
    oi_chart = {
        "underlying": "NIFTY 50",
        "spot": 24986.40,
        "expiry": "14 Nov 2026",
        "pcr": 0.992,
        "max_call_oi": 25000,
        "max_put_oi": 24900,
        "strikes": strikes,
        "call_oi": call_oi,
        "put_oi": put_oi,
    }

    # 4. High-Performing Ideas
    ideas = [
        {"symbol": "TATASTEEL", "type": "BUY", "entry": 148.50, "target": 162.00, "stoploss": 142.00, "potential": "+9.09%", "badge": "High Potential", "horizon": "Swing (1-2 W)"},
        {"symbol": "HDFCBANK", "type": "BUY", "entry": 1008.00, "target": 1080.00, "stoploss": 975.00, "potential": "+7.14%", "badge": "Breakout", "horizon": "Intraday/Swing"},
        {"symbol": "INFY", "type": "BUY", "entry": 1555.00, "target": 1640.00, "stoploss": 1510.00, "potential": "+5.46%", "badge": "Momentum", "horizon": "Positional"},
        {"symbol": "RELIANCE", "type": "BUY", "entry": 1415.00, "target": 1490.00, "stoploss": 1380.00, "potential": "+5.30%", "badge": "High Potential", "horizon": "Swing"},
    ]

    # 5. Quick Option Chain Index Cards
    option_chain_indices = [
        {"symbol": "NIFTY", "name": "NIFTY 50", "spot": 24986.40, "chg": 104.20, "pchg": 0.42},
        {"symbol": "BANKNIFTY", "name": "BANK NIFTY", "spot": 51200.00, "chg": -78.50, "pchg": -0.15},
        {"symbol": "FINNIFTY", "name": "FIN NIFTY", "spot": 23850.15, "chg": 42.10, "pchg": 0.18},
        {"symbol": "MIDCPNIFTY", "name": "MIDCAP NIFTY", "spot": 12840.00, "chg": 95.40, "pchg": 0.75},
        {"symbol": "SENSEX", "name": "BSE SENSEX", "spot": 81500.00, "chg": 284.60, "pchg": 0.35},
    ]

    # 6. IPOs
    ipos = [
        {"company": "Swiggy Limited", "status": "Open", "dates": "06 - 08 Nov", "price_band": "₹371 - ₹390", "lot": 38, "min_inv": 14820},
        {"company": "ACME Solar Holdings", "status": "Open", "dates": "06 - 08 Nov", "price_band": "₹275 - ₹289", "lot": 51, "min_inv": 14739},
        {"company": "NTPC Green Energy", "status": "Upcoming", "dates": "19 - 22 Nov", "price_band": "₹102 - ₹108", "lot": 138, "min_inv": 14904},
    ]

    # 7. Buzzing Stocks
    buzzing = [
        {"symbol": "DIXON", "reason": "High Vol 4.2x", "ltp": 14850.00, "pchg": 6.03},
        {"symbol": "FEDERALBNK", "reason": "Q2 Earnings Beat", "ltp": 204.60, "pchg": 4.47},
        {"symbol": "TRENT", "reason": "Fresh 52W High", "ltp": 6850.00, "pchg": 4.02},
        {"symbol": "COALINDIA", "reason": "Dividend Announcement", "ltp": 448.20, "pchg": 1.96},
    ]

    return {
        "trending_stocks": {
            "most_bought": {"items": most_bought, "total_pages": 110},
            "top_gainers": {"items": top_gainers, "total_pages": 122},
            "top_losers": {"items": top_losers, "total_pages": 34},
            "trading_under_500": {"items": trading_under_500, "total_pages": 141},
        },
        "trending_options": trending_options,
        "oi_chart": oi_chart,
        "ideas": ideas,
        "option_chain_indices": option_chain_indices,
        "ipos": ipos,
        "buzzing": buzzing,
    }


def get_stocks_feed() -> dict[str, Any]:
    # Sector Heatmap
    sectors = [
        {"name": "IT", "pchg": 1.84, "lead": "TCS, INFY"},
        {"name": "Auto", "pchg": 1.25, "lead": "M&M, TATAMOTORS"},
        {"name": "Pharma", "pchg": 0.92, "lead": "SUNPHARMA, DRREDDY"},
        {"name": "Metal", "pchg": 0.85, "lead": "TATASTEEL, HINDALCO"},
        {"name": "Energy", "pchg": 0.42, "lead": "RELIANCE, ONGC"},
        {"name": "FMCG", "pchg": -0.38, "lead": "ITC, HINDUNILVR"},
        {"name": "Banking", "pchg": -0.45, "lead": "HDFCBANK, ICICIBANK"},
        {"name": "Realty", "pchg": -1.12, "lead": "DLF, GODREJPROP"},
    ]
    volume_shockers = [
        {"symbol": "DIXON", "name": "DIXON TECH", "vol_ratio": "4.8x", "ltp": 14850.00, "pchg": 6.03},
        {"symbol": "KAYNES", "name": "KAYNES TECHNOLOGY", "vol_ratio": "3.9x", "ltp": 5420.00, "pchg": 5.40},
        {"symbol": "FEDERALBNK", "name": "FEDERAL BANK", "vol_ratio": "3.5x", "ltp": 204.60, "pchg": 4.47},
        {"symbol": "TRENT", "name": "TRENT LTD", "vol_ratio": "2.8x", "ltp": 6850.00, "pchg": 4.02},
    ]
    high_52w = [
        {"symbol": "TRENT", "name": "TRENT LIMITED", "ltp": 6850.00, "high_52w": 6880.00, "pchg": 4.02},
        {"symbol": "DIXON", "name": "DIXON TECH", "ltp": 14850.00, "high_52w": 14920.00, "pchg": 6.03},
        {"symbol": "BEL", "name": "BHARAT ELECTRONICS", "ltp": 298.40, "high_52w": 302.50, "pchg": 3.90},
        {"symbol": "PERSISTENT", "name": "PERSISTENT SYSTEMS", "ltp": 5740.00, "high_52w": 5785.00, "pchg": 5.14},
    ]
    return {
        "sectors": sectors,
        "volume_shockers": volume_shockers,
        "high_52w": high_52w,
    }


def get_options_feed() -> dict[str, Any]:
    active_calls = [
        {"contract": "NIFTY 25000 CE", "ltp": 168.45, "chg": 32.50, "pchg": 23.90, "oi": "1,25,400", "iv": 14.2},
        {"contract": "NIFTY 25100 CE", "ltp": 115.20, "chg": 24.10, "pchg": 26.45, "oi": "98,600", "iv": 14.5},
        {"contract": "BANKNIFTY 51500 CE", "ltp": 345.00, "chg": 48.00, "pchg": 16.16, "oi": "84,200", "iv": 16.8},
    ]
    active_puts = [
        {"contract": "NIFTY 24900 PE", "ltp": 112.10, "chg": -28.40, "pchg": -20.21, "oi": "1,38,500", "iv": 13.8},
        {"contract": "NIFTY 24800 PE", "ltp": 74.50, "chg": -22.30, "pchg": -23.04, "oi": "1,10,200", "iv": 14.1},
        {"contract": "BANKNIFTY 51000 PE", "ltp": 215.50, "chg": -62.00, "pchg": -22.34, "oi": "95,400", "iv": 17.2},
    ]
    return {
        "active_calls": active_calls,
        "active_puts": active_puts,
        "pcr": 0.992,
        "max_pain": 25000,
        "iv_rank": 24.5,
    }


def get_futures_feed() -> dict[str, Any]:
    long_buildup = [
        {"symbol": "DIXON-I", "ltp": 14890.00, "pchg": 6.12, "oi_chg": 18.5, "desc": "Price ↑ OI ↑ (Strong Bullish)"},
        {"symbol": "PERSISTENT-I", "ltp": 5760.00, "pchg": 5.25, "oi_chg": 14.2, "desc": "Price ↑ OI ↑ (Strong Bullish)"},
        {"symbol": "FEDERALBNK-I", "ltp": 205.10, "pchg": 4.52, "oi_chg": 12.8, "desc": "Price ↑ OI ↑ (Bullish)"},
        {"symbol": "TRENT-I", "ltp": 6880.00, "pchg": 4.10, "oi_chg": 11.4, "desc": "Price ↑ OI ↑ (Bullish)"},
    ]
    short_buildup = [
        {"symbol": "INDUSINDBK-I", "ltp": 1042.00, "pchg": -4.50, "oi_chg": 16.2, "desc": "Price ↓ OI ↑ (Bearish)"},
        {"symbol": "CIPLA-I", "ltp": 1488.00, "pchg": -3.42, "oi_chg": 9.8, "desc": "Price ↓ OI ↑ (Bearish)"},
        {"symbol": "NESTLEIND-I", "ltp": 2235.00, "pchg": -2.85, "oi_chg": 8.4, "desc": "Price ↓ OI ↑ (Bearish)"},
    ]
    short_covering = [
        {"symbol": "TATASTEEL-I", "ltp": 149.80, "pchg": 1.20, "oi_chg": -6.5, "desc": "Price ↑ OI ↓ (Reversal)"},
        {"symbol": "COALINDIA-I", "ltp": 449.50, "pchg": 2.05, "oi_chg": -5.2, "desc": "Price ↑ OI ↓ (Reversal)"},
    ]
    long_unwinding = [
        {"symbol": "TITAN-I", "ltp": 3205.00, "pchg": -2.35, "oi_chg": -8.1, "desc": "Price ↓ OI ↓ (Profit Booking)"},
        {"symbol": "MARUTI-I", "ltp": 11230.00, "pchg": -2.15, "oi_chg": -7.4, "desc": "Price ↓ OI ↓ (Profit Booking)"},
    ]
    return {
        "long_buildup": long_buildup,
        "short_buildup": short_buildup,
        "short_covering": short_covering,
        "long_unwinding": long_unwinding,
    }


def get_commodities_feed() -> dict[str, Any]:
    mcx = [
        {"symbol": "GOLD", "expiry": "05 Dec 2026", "lot": 100, "unit": "10g", "ltp": 78450.00, "chg": 240.00, "pchg": 0.31, "vol": "14,850"},
        {"symbol": "SILVER", "expiry": "05 Dec 2026", "lot": 30, "unit": "1kg", "ltp": 92100.00, "chg": 480.00, "pchg": 0.52, "vol": "22,400"},
        {"symbol": "CRUDEOIL", "expiry": "18 Nov 2026", "lot": 100, "unit": "1bbl", "ltp": 5940.00, "chg": -45.00, "pchg": -0.75, "vol": "84,200"},
        {"symbol": "NATURALGAS", "expiry": "25 Nov 2026", "lot": 1250, "unit": "1mmBtu", "ltp": 242.80, "chg": 5.40, "pchg": 2.27, "vol": "98,100"},
        {"symbol": "COPPER", "expiry": "29 Nov 2026", "lot": 2500, "unit": "1kg", "ltp": 815.50, "chg": 3.80, "pchg": 0.47, "vol": "18,400"},
        {"symbol": "ZINC", "expiry": "29 Nov 2026", "lot": 5000, "unit": "1kg", "ltp": 278.40, "chg": -1.20, "pchg": -0.43, "vol": "12,900"},
    ]
    return {"commodities": mcx}
