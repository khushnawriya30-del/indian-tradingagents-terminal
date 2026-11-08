# Indian TradingAgents Terminal

TradingAgents adapted to NSE/BSE/NFO, with a paper-trading web terminal on top. The 12-agent graph (analysts, bull/bear debate, research manager, trader, risk analysts, portfolio manager), its prompts and risk logic are unchanged; only the data layer and the front end are new.

## Run

```bash
pip install -e ".[dev]"
cp .env.india.example .env        # fill in keys; .env is git-ignored
python -m indian_terminal         # http://127.0.0.1:3000
```

`TERMINAL_MOCK=1 python -m indian_terminal` runs offline with fictional, non-moving prices and a permanent "MOCK DATA" banner (UI work only).

## What changed

| Area | Where |
|---|---|
| Market profile (`TRADINGAGENTS_MARKET=IN`) | `tradingagents/default_config.py` (`INDIA_PROFILE`, `india_config()`) |
| Upstox prices, indicators, quotes, option chain | `tradingagents/dataflows/vendors/india/upstox.py` |
| Symbol resolution (`RELIANCE.NS` / `.BO`, indices) | `.../india/instruments.py` |
| Fundamentals (Screener.in) | `.../india/screener.py` |
| News and community sentiment | `.../india/news.py`, `.../india/social.py` |
| Sessions and holidays (IST) | `.../india/nse_calendar.py` |
| Terminal backend and UI | `indian_terminal/` |

Indicators reuse the upstream stockstats pipeline through an optional `loader` argument, so Yahoo remains the default for non-Indian use.

## Behaviour to know

- **Closed market.** Weekends, NSE holidays and hours outside 09:15-15:30 IST freeze quotes at the last settled daily close; nothing is simulated. Orders placed while closed queue as AMO and run on the first live tick.
- **Holiday list.** Built in for 2026 only. Extend with `NSE_HOLIDAYS_FILE`; special sessions (muhurat) need their NSE-announced times in `NSE_SPECIAL_SESSIONS`.
- **Live feed.** Quotes are polled from Upstox REST every second while the market is open. The Upstox WebSocket (protobuf) feed is not implemented.
- **Tokens.** `UPSTOX_ANALYTICS_TOKEN` is tried first, then `UPSTOX_ACCESS_TOKEN` (expires daily). "Connect Upstox" refreshes the daily token through OAuth using your redirect URI.
- **Sources.** Moneycontrol, ET Markets, CNBC-TV18, Zee Business and Mint are read through Google News RSS site filters; Moneycontrol forum posts are not available, so "Dalal Street chatter" is headlines, not forum text. Screener.in is parsed from HTML and may break if its layout changes. SEBI insider trades are not available; the tool serves the shareholding pattern and says so.
- **Paper engine.** Margin (MIS 20%, futures 12%, short options 12% of strike plus premium) and charges are approximations, not SPAN or a contract note. Tune `MARGIN` / `CHARGES` in `indian_terminal/paper.py`.
- **Security.** The server binds to localhost and has no login; do not expose it. Secrets live only in `.env` (git-ignored).

Not an investment tool: output is AI-generated research for paper trading.
