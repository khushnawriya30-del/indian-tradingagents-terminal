/* Indian TradingAgents Terminal: vanilla JS, no build step.
   Every dynamic string goes through esc() or textContent; agent output is never inserted as HTML. */
(() => {
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nfs = {};
const fmt = d => nfs[d] || (nfs[d] = new Intl.NumberFormat('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }));
const nf2 = fmt(2);
const num = (n, d = 2) => (n == null || Number.isNaN(+n)) ? '—' : fmt(d).format(+n);
const inr = n => (n == null || Number.isNaN(+n)) ? '—' : '₹' + nf2.format(+n);
const cls = n => n > 0 ? 'up' : n < 0 ? 'down' : '';
const sign = n => n > 0 ? '+' : '';
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

const INDEX_STRIP = ['NIFTY', 'BANKNIFTY', 'SENSEX'];

const S = {
  lists: {}, active: null, selected: null, tf: '1D', quotes: {}, portfolio: null, status: null, feed: null,
  indexInsts: [], book: 'positions', view: 'chart', candles: [], stream: null, streamKeys: '',
  ticket: null, job: null, jobTab: 'decision', chain: null, chainTimer: null, dirtyBook: '',
};

/* ---------------------------------------------------------------- helpers */
async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) {
    const d = body && body.detail;
    throw new Error((d && d.message) || (typeof d === 'string' ? d : '') || `Request failed (${res.status})`);
  }
  return body;
}
let toastTimer;
function toast(msg, kind = '') {
  const el = $('#toast');
  el.textContent = msg; el.className = 'toast ' + kind; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 4500);
}
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

/* Small safe markdown: escape first, then a handful of block/inline rules. */
function md(text) {
  const lines = esc(text || '').split('\n');
  let html = '', inList = false;
  for (const raw of lines) {
    let l = raw.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
    const h = /^(#{1,4})\s+(.*)$/.exec(l);
    const li = /^\s*[-*]\s+(.*)$/.exec(l);
    if (li) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${li[1]}</li>`; continue; }
    if (inList) { html += '</ul>'; inList = false; }
    html += h ? `<h4>${h[2]}</h4>` : (l.trim() ? l + '\n' : '\n');
  }
  return html + (inList ? '</ul>' : '');
}

const isOption = i => i && (i.kind === 'CE' || i.kind === 'PE');
const isTradable = i => i && i.kind !== 'INDEX';

/* ------------------------------------------------------------ market status */
function renderStatus() {
  const m = S.status; if (!m) return;
  const pill = $('#market-pill');
  const next = new Date(m.next_open_ist);
  const nextTxt = next.toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
  if (m.is_live) { pill.className = 'pill pill-open'; pill.textContent = '● Market open · closes 15:30 IST'; }
  else if (m.state === 'PRE_OPEN') { pill.className = 'pill pill-pre'; pill.textContent = 'Pre-open · prices frozen at last close'; }
  else { pill.className = 'pill pill-closed'; pill.textContent = `Market closed · ${m.reason}`; }
  pill.title = m.is_live ? '' : `Prices frozen at the ${m.price_date} close. Next open ${nextTxt} IST`;
  if (!m.calendar_covered) showNotice('The built-in NSE holiday list ends with 2026. Add later holidays with NSE_HOLIDAYS_FILE so the terminal knows when the market is shut.');
}
function showNotice(html) {
  const n = $('#notice'); if (!html) { n.hidden = true; return; }
  n.innerHTML = html; n.hidden = false;
}
function renderFeedNotice() {
  const f = S.feed; if (!f) return;
  $('#mock-banner').hidden = f.mode !== 'mock';
  $('#connect-btn').hidden = !(f.oauth_available && f.mode === 'upstox');
  if (!f.tokens_configured) {
    showNotice('Upstox is not configured. Set <code>UPSTOX_ANALYTICS_TOKEN</code> or <code>UPSTOX_ACCESS_TOKEN</code>' +
      (f.oauth_available ? ', or <a href="/api/oauth/login">connect with Upstox</a>.' : '.'));
  } else if (f.last_error) {
    showNotice(`Live feed problem: ${esc(f.last_error)}. Showing the last good prices.` +
      (f.oauth_available ? ' The daily token may have expired: <a href="/api/oauth/login">reconnect Upstox</a>.' : ''));
  } else if (S.status && S.status.calendar_covered) showNotice('');
}

/* --------------------------------------------------------------- watchlist */
const watchKeys = () => (S.lists[S.active] || []).map(i => i.key);

function renderTabs() {
  const box = $('#list-tabs');
  box.innerHTML = Object.keys(S.lists).map(n => `<button class="${n === S.active ? 'active' : ''}" data-list="${esc(n)}">${esc(n)}</button>`).join('');
}
function renderWatch() {
  const items = S.lists[S.active] || [];
  const box = $('#watchlist');
  if (!items.length) { box.innerHTML = '<div class="empty">Search a symbol and press “+ Watch”.</div>'; return; }
  box.innerHTML = items.map(i => `
    <div class="wrow ${S.selected && S.selected.key === i.key ? 'sel' : ''}" role="listitem" data-key="${esc(i.key)}" tabindex="0">
      <div><div class="sym">${esc(i.symbol)}${i.exchange === 'BSE' && i.kind === 'EQ' ? ' <small class="muted">BSE</small>' : ''}</div><div class="nm">${esc(i.name)}</div></div>
      <div><div class="px" data-px="${esc(i.key)}">—</div><div class="ch" data-ch="${esc(i.key)}"></div></div>
      <div class="hov">
        ${isTradable(i) ? `<button class="b" data-act="buy" title="Buy">B</button><button class="s" data-act="sell" title="Sell">S</button>` : ''}
        ${i.kind === 'EQ' || i.kind === 'INDEX' ? `<button class="a" data-act="ai" title="AI analysis">AI</button>` : ''}
        <button class="d" data-act="del" title="Remove" aria-label="Remove ${esc(i.symbol)}">×</button>
      </div>
    </div>`).join('');
  paintWatchPrices();
}
function paintWatchPrices() {
  for (const el of $$('[data-px]')) {
    const q = S.quotes[el.dataset.px]; el.textContent = q ? num(q.ltp) : '—';
  }
  for (const el of $$('[data-ch]')) {
    const q = S.quotes[el.dataset.ch];
    el.textContent = q && q.change != null ? `${sign(q.change)}${num(q.change)} (${sign(q.change_pct)}${num(q.change_pct)}%)` : '';
    el.className = 'ch ' + (q ? cls(q.change) : '');
  }
  $('#index-strip').innerHTML = S.indexInsts.map(i => {
    const q = S.quotes[i.key];
    return `<div class="idx" data-key="${esc(i.key)}"><b>${esc(i.symbol)}</b><span>${q ? num(q.ltp) : '—'}</span>` +
      `<span class="${q ? cls(q.change) : ''}">${q && q.change_pct != null ? sign(q.change_pct) + num(q.change_pct) + '%' : ''}</span></div>`;
  }).join('');
}
async function saveLists() {
  const payload = {};
  for (const [n, items] of Object.entries(S.lists)) payload[n] = items.map(i => i.ticker);
  try { await api('/api/watchlists', { method: 'PUT', body: JSON.stringify({ lists: payload }) }); }
  catch (e) { toast(e.message, 'err'); }
}
function addToWatch(inst) {
  const list = S.lists[S.active];
  if (list.some(i => i.key === inst.key)) { toast(`${inst.symbol} is already in ${S.active}`); return; }
  list.push(inst); renderWatch(); saveLists(); ensureStream(); loadQuotes([inst.key]);
}

/* ------------------------------------------------------------------ search */
const doSearch = debounce(async q => {
  const box = $('#search-results');
  if (!q.trim()) { box.hidden = true; return; }
  try {
    const { results } = await api('/api/search?q=' + encodeURIComponent(q));
    S.found = results;
    box.innerHTML = results.length ? results.map((r, n) => `
      <div class="sr" data-n="${n}"><div><b>${esc(r.symbol)}</b> <small>${esc(r.exchange)} · ${esc(r.kind)}</small><br><small>${esc(r.name)}</small></div>
      <div class="acts"><button data-sact="watch">+ Watch</button>${isTradable(r) ? '<button data-sact="buy">B</button><button data-sact="sell">S</button>' : ''}</div></div>`).join('')
      : '<div class="empty">No match</div>';
    box.hidden = false;
  } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; box.hidden = false; }
}, 180);

/* ------------------------------------------------------------------- quotes */
async function loadQuotes(keys) {
  keys = keys.filter(Boolean); if (!keys.length) return;
  try {
    const r = await api('/api/quotes?keys=' + encodeURIComponent(keys.join(',')));
    Object.assign(S.quotes, r.quotes); S.status = r.market; onQuotes();
  } catch (e) { /* the notice banner already explains feed problems */ }
}
function onQuotes() {
  paintWatchPrices(); renderHead(); renderDepth(); updateLiveCandle(); updateBookInPlace(); updateTicketInfo();
}
function streamKeyList() {
  const set = new Set([...watchKeys(), ...S.indexInsts.map(i => i.key)]);
  if (S.selected) set.add(S.selected.key);
  if (S.portfolio) [...S.portfolio.positions, ...S.portfolio.holdings].forEach(p => set.add(p.key));
  return [...set];
}
function ensureStream() {
  const keys = streamKeyList().join(',');
  if (S.stream && keys === S.streamKeys) return;
  if (S.stream) S.stream.close();
  S.streamKeys = keys;
  const es = new EventSource('/api/stream?keys=' + encodeURIComponent(keys));
  es.addEventListener('quotes', e => { Object.assign(S.quotes, JSON.parse(e.data)); onQuotes(); });
  es.addEventListener('portfolio', e => { S.portfolio = JSON.parse(e.data); renderBook(); renderFundsMini(); });
  es.addEventListener('status', e => { S.status = JSON.parse(e.data); renderStatus(); refreshFeed(); });
  S.stream = es;
}
async function refreshFeed() {
  try { const r = await api('/api/status'); S.feed = r.feed; S.status = r.market; renderFeedNotice(); } catch { /* offline */ }
}

/* ------------------------------------------------------------------- header */
function renderHead() {
  const i = S.selected; if (!i) return;
  const q = S.quotes[i.key];
  $('#inst-symbol').textContent = isOption(i) ? `${i.underlying} ${i.expiry} ${i.strike} ${i.kind}` : i.symbol;
  $('#inst-name').textContent = `${i.name} · ${i.exchange}`;
  $('#inst-ltp').textContent = q ? inr(q.ltp) : '—';
  const ch = $('#inst-change');
  ch.textContent = q && q.change != null ? `${sign(q.change)}${num(q.change)} (${sign(q.change_pct)}${num(q.change_pct)}%)` : '';
  ch.className = 'chg ' + (q ? cls(q.change) : '');
  const fz = $('#inst-frozen');
  if (q && q.frozen) { fz.hidden = false; fz.textContent = `Close of ${q.price_date}`; }
  else if (q && q.stale) { fz.hidden = false; fz.textContent = 'Stale: feed interrupted'; }
  else fz.hidden = true;
  $('#buy-btn').disabled = $('#sell-btn').disabled = !isTradable(i);
  $('#ai-btn').disabled = isOption(i);
  const st = $('#quote-stats');
  const rows = q ? [['Open', num(q.open)], ['High', num(q.high)], ['Low', num(q.low)], ['Prev close', num(q.prev_close)],
    ['Volume', num(q.volume, 0)], ['Avg price', num(q.avg_price)], ['Upper circuit', num(q.upper_circuit)], ['Lower circuit', num(q.lower_circuit)],
    ...(q.oi ? [['Open interest', num(q.oi, 0)]] : [])] : [];
  st.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}
function renderDepth() {
  const q = S.selected && S.quotes[S.selected.key];
  const t = $('#depth-table'), note = $('#depth-note');
  if (!q || (!q.bids?.length && !q.asks?.length)) {
    t.innerHTML = ''; note.textContent = q && q.frozen ? 'No live order book while the market is closed.' : 'No depth available.'; return;
  }
  note.textContent = '';
  const n = Math.max(q.bids.length, q.asks.length);
  let h = '<tr><th>Bid</th><th>Qty</th><th>Ask</th><th>Qty</th></tr>';
  for (let k = 0; k < n; k++) {
    const b = q.bids[k] || {}, a = q.asks[k] || {};
    h += `<tr><td class="bid">${num(b.price)}</td><td>${num(b.qty, 0)}</td><td class="ask">${num(a.price)}</td><td>${num(a.qty, 0)}</td></tr>`;
  }
  t.innerHTML = h;
}
function renderFundsMini() {
  const f = S.portfolio && S.portfolio.funds; if (!f) return;
  $('#funds-mini').innerHTML = `<span>Available <b>${inr(f.available)}</b></span><span>Day P&amp;L <b class="${cls(f.total_pnl)}">${sign(f.total_pnl)}${inr(f.total_pnl)}</b></span>`;
}

/* -------------------------------------------------------------------- chart */
let chart, candleSeries, volSeries;
function chartColors() {
  return { up: cssVar('--up') || '#22c55e', down: cssVar('--down') || '#ef4444', text: cssVar('--muted') || '#8b95a5', grid: cssVar('--line') || '#232a36' };
}
function initChart() {
  const c = chartColors(), el = $('#chart');
  chart = LightweightCharts.createChart(el, {
    layout: { background: { color: 'transparent' }, textColor: c.text, fontFamily: 'inherit' },
    grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
    rightPriceScale: { borderColor: c.grid }, timeScale: { borderColor: c.grid, timeVisible: true, secondsVisible: false },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
  });
  candleSeries = chart.addCandlestickSeries({ upColor: c.up, downColor: c.down, borderUpColor: c.up, borderDownColor: c.down, wickUpColor: c.up, wickDownColor: c.down });
  volSeries = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol' });
  chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
  const fit = () => chart.resize(el.clientWidth, el.clientHeight);
  new ResizeObserver(fit).observe(el); fit();
  chart.subscribeCrosshairMove(p => {
    const d = p.seriesData && p.seriesData.get(candleSeries);
    $('#ohlc').textContent = d ? `O ${num(d.open)}  H ${num(d.high)}  L ${num(d.low)}  C ${num(d.close)}` : '';
  });
}
function applyChartTheme() {
  if (!chart) return; const c = chartColors();
  chart.applyOptions({ layout: { textColor: c.text }, grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } }, rightPriceScale: { borderColor: c.grid }, timeScale: { borderColor: c.grid } });
  candleSeries.applyOptions({ upColor: c.up, downColor: c.down, borderUpColor: c.up, borderDownColor: c.down, wickUpColor: c.up, wickDownColor: c.down });
  if (S.candles.length) setCandles(S.candles);
}
function setCandles(candles) {
  const c = chartColors(); S.candles = candles;
  candleSeries.setData(candles.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
  volSeries.setData(candles.map(k => ({ time: k.time, value: k.volume || 0, color: (k.close >= k.open ? c.up : c.down) + '55' })));
  chart.timeScale().fitContent();
}
async function loadCandles() {
  const i = S.selected; if (!i) return;
  const key = i.key, tf = S.tf;
  try {
    const r = await api(`/api/candles?key=${encodeURIComponent(key)}&tf=${tf}`);
    if (!S.selected || S.selected.key !== key || S.tf !== tf) return;
    setCandles(r.candles);
  } catch (e) { candleSeries.setData([]); volSeries.setData([]); toast(`Chart: ${e.message}`, 'err'); }
}
function updateLiveCandle() {
  const i = S.selected, q = i && S.quotes[i.key];
  if (!q || q.frozen || !S.candles.length || !q.ltp) return;
  const last = { ...S.candles[S.candles.length - 1] };
  last.close = q.ltp; last.high = Math.max(last.high, q.ltp); last.low = Math.min(last.low, q.ltp);
  S.candles[S.candles.length - 1] = last;
  candleSeries.update({ time: last.time, open: last.open, high: last.high, low: last.low, close: last.close });
}
async function selectInstrument(inst, { keepView = false } = {}) {
  S.selected = inst;
  if (!keepView) setView('chart');
  renderWatch(); renderHead(); renderDepth(); ensureStream();
  loadQuotes([inst.key]); loadCandles();
}
function setView(v) {
  S.view = v;
  $$('.main-tabs .tab').forEach(t => t.classList.toggle('active', t.dataset.view === v));
  $('#view-chart').hidden = v !== 'chart'; $('#view-chain').hidden = v !== 'chain';
  clearInterval(S.chainTimer);
  if (v === 'chain') { loadExpiries(); S.chainTimer = setInterval(() => { if (S.status && S.status.is_live) loadChain(true); }, 5000); }
  else if (chart) chart.resize($('#chart').clientWidth, $('#chart').clientHeight);
}

/* ------------------------------------------------------------- option chain */
async function loadExpiries() {
  const under = $('#chain-under').value;
  try {
    const r = await api('/api/expiries?underlying=' + encodeURIComponent(under));
    const sel = $('#chain-expiry');
    sel.innerHTML = r.expiries.map(e => `<option>${esc(e)}</option>`).join('');
    if (!r.expiries.length) { $('#chain-table').innerHTML = ''; $('#chain-note').textContent = 'No listed expiries for this underlying in the instrument file.'; return; }
    loadChain();
  } catch (e) { $('#chain-note').textContent = e.message; }
}
async function loadChain(quiet = false) {
  const under = $('#chain-under').value, expiry = $('#chain-expiry').value; if (!expiry) return;
  try {
    S.chain = await api(`/api/optionchain?underlying=${encodeURIComponent(under)}&expiry=${expiry}`);
    renderChain();
  } catch (e) { if (!quiet) { $('#chain-table').innerHTML = ''; $('#chain-note').textContent = e.message; } }
}
function renderChain() {
  const c = S.chain; if (!c) return;
  const maxOi = Math.max(1, ...c.rows.map(r => Math.max(r.call.oi || 0, r.put.oi || 0)));
  const atmIdx = Math.max(0, c.rows.findIndex(r => r.strike === c.atm));
  const rows = c.rows.slice(Math.max(0, atmIdx - 12), atmIdx + 13);
  const g = (v, d = 2) => v == null ? '—' : num(v, d);
  const cell = (leg, side, row, itm) => {
    const c = itm ? 'itm' : '';
    const bar = `<td class="oi ${side} ${c}"><i style="width:${Math.round((leg.oi || 0) / maxOi * 100)}%"></i><span>${num(leg.oi, 0)}</span></td>`;
    const greeks = ['iv', 'delta', 'gamma', 'theta', 'vega'].map((k, n) => `<td class="${c}">${g(leg[k], k === 'delta' ? 3 : k === 'gamma' ? 4 : 2)}</td>`);
    const ltp = `<td class="ltp-cell ${c}" data-leg="${side}" data-strike="${row.strike}" title="Buy / sell this contract">${g(leg.ltp)}</td>`;
    // Calls read OI -> LTP towards the strike; puts mirror it.
    return side === 'call' ? bar + greeks.join('') + ltp : ltp + greeks.reverse().join('') + bar;
  };
  const head = '<tr><th>OI</th><th>IV</th><th>Δ</th><th>Γ</th><th>Θ</th><th>Vega</th><th>LTP</th><th>Strike</th><th>LTP</th><th>Vega</th><th>Θ</th><th>Γ</th><th>Δ</th><th>IV</th><th>OI</th></tr>';
  const body = rows.map(r => {
    const itmCall = c.spot && r.strike < c.spot, itmPut = c.spot && r.strike > c.spot;
    return `<tr class="${r.strike === c.atm ? 'atm' : ''}">${cell(r.call, 'call', r, itmCall)}<td class="strike">${num(r.strike, 0)}</td>${cell(r.put, 'put', r, itmPut)}</tr>`;
  }).join('');
  $('#chain-table').innerHTML = `<thead>${head}</thead><tbody>${body}</tbody>`;
  $('#chain-summary').innerHTML = `<span>Spot <b>${num(c.spot)}</b></span><span>PCR <b>${c.pcr ?? '—'}</b></span>` +
    `<span>Max call OI <b>${num(c.max_call_oi_strike, 0)}</b></span><span>Max put OI <b>${num(c.max_put_oi_strike, 0)}</b></span><span>Lot <b>${c.lot_size}</b></span>`;
  const model = c.rows.some(r => r.call.greeks_source === 'model' || r.put.greeks_source === 'model');
  $('#chain-note').textContent = (c.market && !c.market.is_live ? 'Market closed: last session’s values. ' : '') +
    (model ? 'Some Greeks are computed from traded prices (Black-Scholes) where the feed omitted them. ' : '') + 'Click an LTP to trade that contract (paper).';
}

/* ------------------------------------------------------------- order ticket */
function productsFor(i) { return isOption(i) || i.kind === 'FUT' ? ['NRML'] : ['MIS', 'CNC']; }
function openTicket(inst, side = 'BUY') {
  if (!isTradable(inst)) { toast('Indices are not tradable; use an index option or future.', 'err'); return; }
  S.ticket = { inst, side };
  $('#t-symbol').textContent = isOption(inst) ? `${inst.underlying} ${inst.strike} ${inst.kind}` : inst.symbol;
  $('#t-sub').textContent = `${inst.exchange}${inst.expiry ? ' · ' + inst.expiry : ''}`;
  $('#t-product').innerHTML = productsFor(inst).map(p => `<option>${p}</option>`).join('');
  $('#t-type').value = 'MARKET';
  const lot = inst.lot_size || 1;
  $('#t-qty').value = lot; $('#t-qty').step = lot; $('#t-qty').min = lot;
  $('#t-lot').textContent = lot > 1 ? `(lot ${lot})` : '';
  $('#t-price').value = ''; $('#t-trig').value = ''; $('#t-error').hidden = true;
  setTicketSide(side); syncTicketFields();
  if (!S.quotes[inst.key]) loadQuotes([inst.key]);
  if (!$('#ticket').open) $('#ticket').showModal();
  updateTicketInfo();
}
function setTicketSide(side) {
  S.ticket.side = side;
  $$('#t-side button').forEach(b => b.classList.toggle('active', b.dataset.v === side));
  const sub = $('#t-submit'); sub.textContent = side === 'BUY' ? 'Buy' : 'Sell';
  sub.className = 'btn wide ' + (side === 'BUY' ? 'buy' : 'sell');
  $('#ticket-head').className = 'ticket-head ' + side.toLowerCase();
}
function syncTicketFields() {
  const t = $('#t-type').value;
  $('#t-price-wrap').style.visibility = (t === 'LIMIT' || t === 'SL') ? 'visible' : 'hidden';
  $('#t-trig-wrap').hidden = !(t === 'SL' || t === 'SL-M');
  updateTicketInfo();
}
function updateTicketInfo() {
  if (!S.ticket || !$('#ticket').open) return;
  const { inst, side } = S.ticket, q = S.quotes[inst.key];
  const qty = +$('#t-qty').value || 0, type = $('#t-type').value, prod = $('#t-product').value;
  const px = (type === 'LIMIT' || type === 'SL') ? (+$('#t-price').value || 0) : (+$('#t-trig').value || (q && q.ltp) || 0);
  const notional = qty * px;
  let margin = prod === 'CNC' ? notional : (inst.kind === 'EQ' ? notional * 0.2 : inst.kind === 'FUT' ? notional * 0.12 : (side === 'BUY' ? notional : notional + qty * (inst.strike || 0) * 0.12));
  if (prod === 'CNC' && side === 'SELL') margin = 0;
  const avail = S.portfolio ? S.portfolio.funds.available : null;
  $('#t-info').innerHTML = `
    <div>LTP <b>${q ? inr(q.ltp) : '—'}${q && q.frozen ? ' (closed)' : ''}</b></div>
    <div>Order value <b>${inr(notional)}</b></div>
    <div>Approx. margin <b>${inr(margin)}</b></div>
    <div>Available <b>${avail == null ? '—' : inr(avail)}</b></div>
    ${S.status && !S.status.is_live ? '<div><span>Market closed</span><b>Order queues as AMO</b></div>' : ''}`;
}
async function submitTicket(e) {
  e.preventDefault(); if (!S.ticket) return;
  const { inst, side } = S.ticket, err = $('#t-error'), btn = $('#t-submit');
  const type = $('#t-type').value;
  const body = { key: inst.key, side, qty: +$('#t-qty').value, order_type: type, product: $('#t-product').value };
  if (type === 'LIMIT' || type === 'SL') body.price = +$('#t-price').value;
  if (type === 'SL' || type === 'SL-M') body.trigger_price = +$('#t-trig').value;
  btn.disabled = true; err.hidden = true;
  try {
    const r = await api('/api/orders', { method: 'POST', body: JSON.stringify(body) });
    S.portfolio = r.portfolio; renderBook(); renderFundsMini(); ensureStream();
    $('#ticket').close();
    const o = r.order;
    toast(`${o.side} ${o.symbol}: ${o.status}${o.status === 'COMPLETE' ? ` @ ${num(o.avg_price)}` : o.message ? ' · ' + o.message : ''}`, 'ok');
  } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  finally { btn.disabled = false; }
}

/* --------------------------------------------------------- positions & book */
function renderBook() {
  const p = S.portfolio; if (!p) return;
  $('#n-pos').textContent = p.positions.filter(x => x.qty).length || '';
  $('#n-hold').textContent = p.holdings.length || '';
  $('#n-ord').textContent = p.orders.filter(o => ['OPEN', 'TRIGGER_PENDING', 'AMO'].includes(o.status)).length || '';
  const sig = S.book + '|' + JSON.stringify([p.positions.map(x => [x.key, x.product, x.qty, x.avg_price, x.realized]),
    p.holdings.map(x => [x.key, x.qty, x.avg_price]), p.orders.map(o => [o.id, o.status, o.filled_qty]), p.trades.length,
    S.book === 'funds' ? p.funds : 0]);
  if (sig === S.dirtyBook) { updateBookInPlace(); return; }
  S.dirtyBook = sig;
  const body = $('#book-body');
  const noData = t => `<div class="empty">${t}</div>`;
  const ltpCell = x => `<td data-f="ltp" data-k="${esc(x.key)}">${num(x.ltp)}</td>`;
  if (S.book === 'positions' || S.book === 'holdings') {
    const rows = (S.book === 'positions' ? p.positions : p.holdings);
    const total = rows.reduce((a, x) => a + (x.pnl || 0), 0);
    if (!rows.length) { body.innerHTML = noData(S.book === 'positions' ? 'No open positions. Place a paper order to get started.' : 'No delivery (CNC) holdings yet.'); return; }
    body.innerHTML = `<div class="sumbar"><span>Total P&amp;L <b data-f="total" class="${cls(total)}">${sign(total)}${inr(total)}</b></span></div>
      <table class="t"><thead><tr><th>Instrument</th><th>Product</th><th>Qty</th><th>Avg</th><th>LTP</th><th>P&amp;L</th><th>%</th><th></th></tr></thead><tbody>` +
      rows.map(x => `<tr data-pk="${esc(x.key)}|${esc(x.product)}"><td><b>${esc(x.symbol)}</b></td><td>${esc(x.product)}</td><td>${num(x.qty, 0)}</td><td>${num(x.avg_price)}</td>${ltpCell(x)}
        <td data-f="pnl" class="${cls(x.pnl)}">${sign(x.pnl)}${num(x.pnl)}</td><td data-f="pct" class="${cls(x.pnl_pct)}">${num(x.pnl_pct)}%</td>
        <td class="act">${x.qty ? `<button data-exit="${esc(x.key)}|${esc(x.product)}">Exit</button>` : ''}</td></tr>`).join('') + '</tbody></table>';
  } else if (S.book === 'orders') {
    body.innerHTML = p.orders.length ? `<table class="t"><thead><tr><th>Time</th><th>Instrument</th><th>Side</th><th>Type</th><th>Qty</th><th>Price</th><th>Avg</th><th>Status</th><th></th></tr></thead><tbody>` +
      p.orders.map(o => `<tr><td>${esc((o.ts || '').slice(11, 19))}</td><td><b>${esc(o.symbol)}</b> <small class="muted">${esc(o.product)}</small></td>
        <td class="${o.side === 'BUY' ? 'up' : 'down'}">${esc(o.side)}</td><td>${esc(o.order_type)}</td><td>${o.filled_qty}/${o.qty}</td>
        <td>${o.price ? num(o.price) : o.trigger_price ? 'trg ' + num(o.trigger_price) : 'MKT'}</td><td>${o.filled_qty ? num(o.avg_price) : '—'}</td>
        <td><span class="badge ${esc(o.status)}" title="${esc(o.message)}">${esc(o.status)}</span></td>
        <td class="act">${['OPEN', 'TRIGGER_PENDING', 'AMO'].includes(o.status) ? `<button data-cancel="${esc(o.id)}">Cancel</button>` : ''}</td></tr>`).join('') + '</tbody></table>' : noData('No orders today.');
  } else if (S.book === 'trades') {
    body.innerHTML = p.trades.length ? `<table class="t"><thead><tr><th>Time</th><th>Instrument</th><th>Side</th><th>Qty</th><th>Price</th><th>Charges</th><th>Realised</th></tr></thead><tbody>` +
      p.trades.map(t => `<tr><td>${esc((t.ts || '').slice(0, 19).replace('T', ' '))}</td><td><b>${esc(t.symbol)}</b> <small class="muted">${esc(t.product)}</small></td>
        <td class="${t.side === 'BUY' ? 'up' : 'down'}">${esc(t.side)}</td><td>${t.qty}</td><td>${num(t.price)}</td><td>${num(t.charges)}</td>
        <td class="${cls(t.realized)}">${t.realized ? sign(t.realized) + num(t.realized) : '—'}</td></tr>`).join('') + '</tbody></table>' : noData('No trades yet.');
  } else {
    const f = p.funds;
    const cell = (k, v, c = '') => `<div><span>${k}</span><b class="${c}">${v}</b></div>`;
    body.innerHTML = `<div class="fundsgrid">${cell('Available margin', inr(f.available))}${cell('Cash balance', inr(f.cash))}${cell('Margin used', inr(f.margin_used))}
      ${cell('Equity (mark-to-market)', inr(f.equity))}${cell('Total P&L', sign(f.total_pnl) + inr(f.total_pnl), cls(f.total_pnl))}${cell('Realised', sign(f.realized) + inr(f.realized), cls(f.realized))}
      ${cell('Unrealised', sign(f.unrealized) + inr(f.unrealized), cls(f.unrealized))}${cell('Charges paid', inr(f.charges_paid))}${cell('Starting balance', inr(f.initial))}</div>
      <div class="fund-actions"><button class="btn small" id="reset-btn">Reset paper account…</button></div>`;
  }
}
function updateBookInPlace() {
  const p = S.portfolio; if (!p || (S.book !== 'positions' && S.book !== 'holdings')) return;
  const rows = S.book === 'positions' ? p.positions : p.holdings; let total = 0;
  for (const x of rows) {
    total += x.pnl || 0;
    const tr = $(`tr[data-pk="${CSS.escape(x.key + '|' + x.product)}"]`); if (!tr) continue;
    $('[data-f=ltp]', tr).textContent = num(x.ltp);
    const pnl = $('[data-f=pnl]', tr); pnl.textContent = sign(x.pnl) + num(x.pnl); pnl.className = cls(x.pnl);
    const pct = $('[data-f=pct]', tr); pct.textContent = num(x.pnl_pct) + '%'; pct.className = cls(x.pnl_pct);
  }
  const t = $('[data-f=total]'); if (t) { t.textContent = sign(total) + inr(total); t.className = cls(total); }
}

/* ---------------------------------------------------------------- AI desk */
async function startAnalysis(inst) {
  if (!inst || isOption(inst)) { toast('AI analysis runs on equities and indices.', 'err'); return; }
  const ticker = inst.kind === 'INDEX' ? inst.symbol : inst.ticker;
  $('#ai-title').textContent = ticker; $('#ai-drawer').hidden = false; $('#ai-download').hidden = true;
  $('#ai-body').innerHTML = '<div class="empty">Starting the 12-agent pipeline…</div>';
  try {
    S.job = await api('/api/analysis', { method: 'POST', body: JSON.stringify({ ticker }) });
    pollAnalysis(S.job.id);
  } catch (e) { $('#ai-body').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
async function pollAnalysis(id) {
  clearTimeout(S.pollT);
  try {
    const job = await api('/api/analysis/' + id);
    if (S.job && S.job.id === id) { S.job = job; renderJob(); }
    if (job.status === 'queued' || job.status === 'running') S.pollT = setTimeout(() => pollAnalysis(id), 2000);
  } catch (e) { $('#ai-body').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
const turns = (arr, who) => arr.length ? arr.map(t => `<div class="turn md">${md(t)}</div>`).join('') : `<div class="muted small">${who} has not spoken yet.</div>`;
function renderJob() {
  const j = S.job; if (!j) return;
  const r = j.result || {};
  const dl = $('#ai-download'); dl.hidden = !j.report_ready; dl.href = `/api/analysis/${j.id}/report.html`; dl.setAttribute('download', '');
  const stages = j.stages.map(s => `<div class="stage ${s.status}"><i></i>${esc(s.label)}</div>`).join('');
  let head = '';
  if (j.status === 'error') head = `<div class="t-error">${esc(j.error)}<br><small>Check that your LLM endpoint is reachable (TRADINGAGENTS_LLM_BACKEND_URL) and the key is set.</small></div>`;
  if (j.status === 'done') head = `<div class="verdict"><span class="rating ${esc(j.rating)}">${esc(j.rating)}</span><span class="muted">Portfolio Manager rating for ${esc(j.ticker)} · analysis date ${esc(j.trade_date)}</span></div>`;
  const tabs = [['decision', 'Decision'], ['analysts', 'Analysts'], ['debate', 'Bull vs Bear'], ['trader', 'Trader'], ['risk', 'Risk']];
  const rep = r.reports || {};
  const sections = {
    decision: `<div class="md">${md(r.decision) || '<span class="muted">Pending…</span>'}</div>`,
    analysts: [['Market', rep.market], ['Sentiment', rep.sentiment], ['News', rep.news], ['Fundamentals', rep.fundamentals]]
      .map(([n, t]) => `<h4>${n} Analyst</h4><div class="md">${md(t) || '<span class="muted">Pending…</span>'}</div>`).join(''),
    debate: `<div class="cols"><div class="col bull"><h4>Bull Researcher</h4>${turns(r.debate?.bull || [], 'Bull')}</div><div class="col bear"><h4>Bear Researcher</h4>${turns(r.debate?.bear || [], 'Bear')}</div></div>
      <h4>Research Manager plan</h4><div class="md">${md(r.debate?.research_plan) || '<span class="muted">Pending…</span>'}</div>`,
    trader: `<div class="md">${md(r.trader_plan) || '<span class="muted">Pending…</span>'}</div>`,
    risk: `<div class="cols"><div class="col"><h4>Aggressive</h4>${turns(r.risk?.aggressive || [], 'Aggressive')}</div><div class="col"><h4>Conservative</h4>${turns(r.risk?.conservative || [], 'Conservative')}</div></div>
      <h4>Neutral</h4>${turns(r.risk?.neutral || [], 'Neutral')}`,
  };
  const scroll = $('#ai-body').scrollTop;
  $('#ai-body').innerHTML = `${head}<div class="stages">${stages}</div>
    <div class="dtabs">${tabs.map(([k, n]) => `<button data-jt="${k}" class="${S.jobTab === k ? 'active' : ''}">${n}</button>`).join('')}</div>${sections[S.jobTab]}`;
  $('#ai-body').scrollTop = scroll;
}

/* ----------------------------------------------------------------- wiring */
function bind() {
  document.addEventListener('click', e => {
    const t = e.target;
    if (!t.closest('.search-wrap')) $('#search-results').hidden = true;

    const tab = t.closest('.main-tabs .tab'); if (tab) return setView(tab.dataset.view);
    const bt = t.closest('[data-book]'); if (bt) {
      S.book = bt.dataset.book; $$('[data-book]').forEach(b => b.classList.toggle('active', b === bt)); S.dirtyBook = ''; renderBook(); return;
    }
    const lt = t.closest('[data-list]'); if (lt) { S.active = lt.dataset.list; renderTabs(); renderWatch(); ensureStream(); loadQuotes(watchKeys()); return; }
    const jt = t.closest('[data-jt]'); if (jt) { S.jobTab = jt.dataset.jt; renderJob(); return; }
    const tf = t.closest('#tf-row [data-tf]'); if (tf) {
      S.tf = tf.dataset.tf; $$('#tf-row [data-tf]').forEach(b => b.classList.toggle('active', b === tf)); loadCandles(); return;
    }
    const ex = t.closest('[data-exit]'); if (ex) { exitPosition(ex.dataset.exit); return; }
    const cn = t.closest('[data-cancel]'); if (cn) { cancelOrder(cn.dataset.cancel); return; }
    if (t.id === 'reset-btn') { resetAccount(); return; }

    const row = t.closest('.wrow');
    if (row) {
      const inst = (S.lists[S.active] || []).find(i => i.key === row.dataset.key); if (!inst) return;
      const act = t.closest('[data-act]') && t.closest('[data-act]').dataset.act;
      if (act === 'buy') openTicket(inst, 'BUY');
      else if (act === 'sell') openTicket(inst, 'SELL');
      else if (act === 'ai') startAnalysis(inst);
      else if (act === 'del') { S.lists[S.active] = S.lists[S.active].filter(i => i.key !== inst.key); renderWatch(); saveLists(); ensureStream(); }
      else selectInstrument(inst);
      return;
    }
    const idx = t.closest('.idx'); if (idx) { const inst = S.indexInsts.find(i => i.key === idx.dataset.key); if (inst) selectInstrument(inst); return; }

    const sr = t.closest('.sr');
    if (sr) {
      const inst = S.found[+sr.dataset.n], act = t.closest('[data-sact]') && t.closest('[data-sact]').dataset.sact;
      if (act === 'watch') addToWatch(inst);
      else if (act === 'buy') openTicket(inst, 'BUY');
      else if (act === 'sell') openTicket(inst, 'SELL');
      else { selectInstrument(inst); $('#search-results').hidden = true; $('#search').value = ''; }
      return;
    }
    const leg = t.closest('[data-leg]');
    if (leg && S.chain) {
      const row2 = S.chain.rows.find(r => r.strike === +leg.dataset.strike), l = row2 && row2[leg.dataset.leg];
      if (!l || !l.key) return;
      const kind = leg.dataset.leg === 'call' ? 'CE' : 'PE';
      openTicket({ key: l.key, symbol: l.symbol || `${S.chain.underlying} ${row2.strike} ${kind}`, name: S.chain.underlying, kind, exchange: 'NSE',
        underlying: S.chain.underlying, expiry: S.chain.expiry, strike: row2.strike, lot_size: l.lot_size || S.chain.lot_size, ticker: l.key }, 'BUY');
      return;
    }
  });

  $('#search').addEventListener('input', e => doSearch(e.target.value));
  $('#search').addEventListener('keydown', e => {
    if (e.key === 'Escape') { $('#search-results').hidden = true; e.target.blur(); }
    if (e.key === 'Enter' && S.found && S.found[0]) { selectInstrument(S.found[0]); $('#search-results').hidden = true; e.target.value = ''; }
  });
  $('#buy-btn').onclick = () => S.selected && openTicket(S.selected, 'BUY');
  $('#sell-btn').onclick = () => S.selected && openTicket(S.selected, 'SELL');
  $('#ai-btn').onclick = () => S.selected && startAnalysis(S.selected);
  $('#ai-close').onclick = () => { $('#ai-drawer').hidden = true; clearTimeout(S.pollT); };
  $('#t-close').onclick = () => $('#ticket').close();
  $('#t-side').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { setTicketSide(b.dataset.v); updateTicketInfo(); } });
  ['t-type', 't-product', 't-qty', 't-price', 't-trig'].forEach(id => $('#' + id).addEventListener('input', () => id === 't-type' ? syncTicketFields() : updateTicketInfo()));
  $('#ticket-form').addEventListener('submit', submitTicket);
  $('#chain-under').onchange = loadExpiries; $('#chain-expiry').onchange = () => loadChain();
  $('#connect-btn').onclick = () => { location.href = '/api/oauth/login'; };
  $('#theme-btn').onclick = () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    const next = cur === 'light' ? 'dark' : 'light'; document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch { /* private mode */ }
    applyChartTheme();
  };
  document.addEventListener('keydown', e => {
    if (e.target.matches('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey || $('#ticket').open) return;
    if (e.key === 'b' && S.selected) { e.preventDefault(); openTicket(S.selected, 'BUY'); }
    if (e.key === 's' && S.selected) { e.preventDefault(); openTicket(S.selected, 'SELL'); }
    if (e.key === '/') { e.preventDefault(); $('#search').focus(); }
  });
}

async function exitPosition(pk) {
  const [key, product] = pk.split('|');
  const p = S.portfolio && [...S.portfolio.positions, ...S.portfolio.holdings].find(x => x.key === key && x.product === product);
  if (!p || !p.qty) return;
  try {
    const r = await api('/api/orders', { method: 'POST', body: JSON.stringify({ key, side: p.qty > 0 ? 'SELL' : 'BUY', qty: Math.abs(p.qty), order_type: 'MARKET', product }) });
    S.portfolio = r.portfolio; renderBook(); renderFundsMini(); toast(`Exit ${p.symbol}: ${r.order.status}`, 'ok');
  } catch (e) { toast(e.message, 'err'); }
}
async function cancelOrder(id) {
  try { const r = await api('/api/orders/' + id, { method: 'DELETE' }); S.portfolio = r.portfolio; renderBook(); renderFundsMini(); toast('Order cancelled'); }
  catch (e) { toast(e.message, 'err'); }
}
async function resetAccount() {
  const v = prompt('Reset the paper account and clear all orders, positions and trades.\nStarting balance (₹):', S.portfolio ? S.portfolio.funds.initial : 1000000);
  if (v == null) return; const amount = +String(v).replace(/,/g, '');
  if (!(amount > 0)) { toast('Enter a positive amount', 'err'); return; }
  try { S.portfolio = await api('/api/account/reset', { method: 'POST', body: JSON.stringify({ initial_balance: amount }) }); S.dirtyBook = ''; renderBook(); renderFundsMini(); toast('Paper account reset', 'ok'); }
  catch (e) { toast(e.message, 'err'); }
}

/* -------------------------------------------------------------------- init */
async function init() {
  try { const t = localStorage.getItem('theme'); if (t) document.documentElement.dataset.theme = t; } catch { /* ignore */ }
  bind(); initChart();
  await refreshFeed(); renderStatus();
  try {
    const [wl, ...idx] = await Promise.all([api('/api/watchlists'), ...INDEX_STRIP.map(q => api('/api/instrument?ticker=' + q).catch(() => null))]);
    S.lists = wl.lists; S.active = Object.keys(S.lists)[0]; S.indexInsts = idx.filter(Boolean);
  } catch (e) {
    showNotice(`Could not load the instrument list: ${esc(e.message)}`); S.lists = { 'Watchlist 1': [] }; S.active = 'Watchlist 1';
  }
  renderTabs(); renderWatch();
  S.portfolio = await api('/api/portfolio').catch(() => null); renderBook(); renderFundsMini();
  const first = (S.lists[S.active] || [])[0] || S.indexInsts[0];
  await loadQuotes([...watchKeys(), ...S.indexInsts.map(i => i.key)]);
  if (first && !S.selected) selectInstrument(first); else ensureStream();   // a click made while loading wins
  setInterval(refreshFeed, 15000);
}
init();
})();
