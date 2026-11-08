/* Upstox Pro Indian TradingAgents Terminal: vanilla JS, reactive UI.
   Preserves all 12 AI agents, Upstox live feed, Paper Trading ledger & TradingView charting. */
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
  nav: 'home', subNav: 'ideas', trendingCat: 'most_bought', trendingPage: 1,
  discovery: null, lists: {}, active: null, selected: null, tf: '1D',
  quotes: {}, portfolio: null, status: null, feed: null, indexInsts: [],
  book: 'positions', view: 'chart', candles: [], stream: null, streamKeys: '',
  ticket: null, job: null, jobTab: 'decision', chain: null, chainTimer: null, dirtyBook: '',
  chart: null, candleSeries: null, volumeSeries: null,
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
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 4000);
}
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

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

/* ------------------------------------------------------------ navigation */
function switchNav(target) {
  S.nav = target;
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.nav === target));

  if (target === 'home') {
    $('#page-home').classList.add('active');
    $('#page-trading').classList.remove('active');
    $('#page-strategy').classList.remove('active');
  } else if (target === 'trading' || target === 'watchlist' || target === 'orders' || target === 'chain') {
    $('#page-home').classList.remove('active');
    $('#page-trading').classList.add('active');
    $('#page-strategy').classList.remove('active');
    if (target === 'orders') switchBook('orders');
    if (target === 'chain') switchView('chain');
    if (target === 'trading' && S.view === 'chain') switchView('chart');
    if (S.chart) S.chart.resize($('#chart').clientWidth, $('#chart').clientHeight);
  } else if (target === 'strategy') {
    $('#page-home').classList.remove('active');
    $('#page-trading').classList.remove('active');
    $('#page-strategy').classList.add('active');
    renderStrategyBuilder();
  }
}

function switchSubNav(target) {
  S.subNav = target;
  $$('.sub-item').forEach(b => b.classList.toggle('active', b.dataset.sub === target));
  $$('.subtab-content').forEach(p => p.classList.toggle('active', p.id === `subtab-${target}`));
}

/* ------------------------------------------------------------ Discovery Feeds */
async function loadDiscovery() {
  try {
    const data = await api('/api/discovery/all');
    S.discovery = data;
    renderDiscoveryAll();
  } catch (err) {
    console.error('Failed to load discovery feeds:', err);
  }
}

function renderDiscoveryAll() {
  if (!S.discovery) return;
  renderIdeas(S.discovery.ideas);
  renderStocksTab(S.discovery.stocks);
  renderOptionsTab(S.discovery.options);
  renderFuturesTab(S.discovery.futures);
  renderCommoditiesTab(S.discovery.commodities);
}

function renderIdeas(ideas) {
  if (!ideas) return;
  // 1. Trending Stocks
  renderTrendingStocks();

  // 2. Trending Options
  const toBody = $('#table-trending-options tbody');
  toBody.innerHTML = (ideas.trending_options || []).map(o => `
    <tr>
      <td><b>${esc(o.contract)}</b> <span class="muted small">${esc(o.expiry)}</span></td>
      <td class="r"><b>${inr(o.ltp)}</b></td>
      <td class="r ${cls(o.chg)}"><b>${sign(o.pchg)}${num(o.pchg)}%</b></td>
      <td class="r muted">${esc(o.oi)}</td>
      <td class="r"><button class="btn buy small" onclick="window.TerminalApp.quickTrade('${esc(o.contract)}', 'BUY')">Trade</button></td>
    </tr>
  `).join('');

  // 3. OI Analysis Chart
  renderOIChart(ideas.oi_chart);

  // 4. High-Performing Ideas
  const ideasBox = $('#ideas-grid');
  ideasBox.innerHTML = (ideas.ideas || []).map(i => `
    <div class="idea-card" onclick="window.TerminalApp.selectAndOpen('${esc(i.symbol)}')">
      <div class="card-top">
        <span class="idea-badge">${esc(i.badge)}</span>
        <b class="card-sym">${esc(i.symbol)}</b>
        <span class="muted small" style="margin-left:auto">${esc(i.horizon)}</span>
      </div>
      <div class="idea-metric-row">
        <div><span class="muted">Entry</span><br><b>${inr(i.entry)}</b></div>
        <div><span class="muted">Target</span><br><b class="up">${inr(i.target)}</b></div>
        <div><span class="muted">Stoploss</span><br><b class="down">${inr(i.stoploss)}</b></div>
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px">
        <span class="up" style="font-weight:700">${esc(i.potential)}</span>
        <button class="btn buy small" onclick="event.stopPropagation(); window.TerminalApp.selectAndOpen('${esc(i.symbol)}')">View &amp; Buy</button>
      </div>
    </div>
  `).join('');

  // 5. Option Chain Indices Quick Cards
  const ocBox = $('#oc-indices-grid');
  ocBox.innerHTML = (ideas.option_chain_indices || []).map(idx => `
    <div class="stock-card" onclick="window.TerminalApp.openChainFor('${esc(idx.symbol)}')">
      <b class="card-sym">${esc(idx.name)}</b>
      <div class="card-price-row">
        <span class="card-ltp">${num(idx.spot)}</span>
        <span class="card-chg ${cls(idx.chg)}">${sign(idx.pchg)}${num(idx.pchg)}%</span>
      </div>
      <button class="btn ghost small wide" style="margin-top:6px; font-size:11px">Open Chain &rsaquo;</button>
    </div>
  `).join('');

  // 6. IPO Grid
  const ipoBox = $('#ipo-grid');
  ipoBox.innerHTML = (ideas.ipos || []).map(ipo => `
    <div class="ipo-card">
      <div style="display:flex; justify-content:space-between; align-items:center">
        <b>${esc(ipo.company)}</b>
        <span class="ipo-status">${esc(ipo.status)}</span>
      </div>
      <div class="muted small">Dates: <b>${esc(ipo.dates)}</b> &middot; Lot: <b>${ipo.lot}</b></div>
      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px">
        <span class="small">Band: <b>${esc(ipo.price_band)}</b></span>
        <span class="muted small">Min: <b>${inr(ipo.min_inv)}</b></span>
      </div>
    </div>
  `).join('');

  // 7. Buzzing Stocks
  const buzzBox = $('#buzzing-grid');
  buzzBox.innerHTML = (ideas.buzzing || []).map(b => `
    <div class="buzz-card" onclick="window.TerminalApp.selectAndOpen('${esc(b.symbol)}')">
      <div>
        <b class="card-sym">${esc(b.symbol)}</b><br>
        <span class="muted small">${esc(b.reason)}</span>
      </div>
      <div style="text-align:right">
        <b>${inr(b.ltp)}</b><br>
        <span class="small ${cls(b.pchg)}">${sign(b.pchg)}${num(b.pchg)}%</span>
      </div>
    </div>
  `).join('');
}

function renderTrendingStocks() {
  if (!S.discovery || !S.discovery.ideas) return;
  const ts = S.discovery.ideas.trending_stocks;
  const current = ts[S.trendingCat] || ts['most_bought'];
  const items = current.items || [];
  const totalPages = current.total_pages || 100;

  $('#trending-page-info').textContent = `Page ${S.trendingPage} of ${totalPages}`;

  const box = $('#trending-cards');
  box.innerHTML = items.map(s => `
    <div class="stock-card" onclick="window.TerminalApp.selectAndOpen('${esc(s.symbol)}')">
      <div class="card-top">
        <div class="stock-icon">${esc(s.symbol.substring(0, 2))}</div>
        <div>
          <div class="card-sym">${esc(s.symbol)}</div>
          <div class="card-name">${esc(s.name)}</div>
        </div>
      </div>
      <div class="card-price-row">
        <span class="card-ltp">${inr(s.ltp)}</span>
        <span class="card-chg ${cls(s.chg)}">${sign(s.pchg)}${num(s.pchg)}%</span>
      </div>
      <div class="card-vol">Vol: ${esc(s.vol || '—')}</div>
    </div>
  `).join('');
}

function renderOIChart(data) {
  if (!data) return;
  $('#oi-pcr').textContent = `PCR: ${data.pcr}`;
  $('#oi-spot').textContent = `Spot: ${num(data.spot)}`;

  const svg = $('#oi-svg-chart');
  const strikes = data.strikes;
  const calls = data.call_oi;
  const puts = data.put_oi;
  const spot = data.spot;
  const n = strikes.length;
  const w = 540, h = 220, padB = 30, padT = 20, padL = 30, padR = 20;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;
  const maxOI = Math.max(...calls, ...puts) * 1.15;
  const barW = Math.max(10, (chartW / n) / 2.8);

  let elements = '';
  // Horizontal grid lines
  for (let step = 0; step <= 3; step++) {
    const y = padT + (chartH / 3) * step;
    elements += `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="var(--line)" stroke-dasharray="3,3" />`;
  }

  strikes.forEach((strike, i) => {
    const cx = padL + (i + 0.5) * (chartW / n);
    const callH = (calls[i] / maxOI) * chartH;
    const putH = (puts[i] / maxOI) * chartH;
    const callY = padT + chartH - callH;
    const putY = padT + chartH - putH;

    // Call bar (Red)
    elements += `<rect x="${cx - barW - 1}" y="${callY}" width="${barW}" height="${callH}" fill="#ff4d4f" rx="2" opacity="0.9"><title>${strike} CE: ${calls[i]}L</title></rect>`;
    // Put bar (Blue)
    elements += `<rect x="${cx + 1}" y="${putY}" width="${barW}" height="${putH}" fill="#3b82f6" rx="2" opacity="0.9"><title>${strike} PE: ${puts[i]}L</title></rect>`;
    // Strike label
    elements += `<text x="${cx}" y="${h - 8}" text-anchor="middle" fill="var(--muted)" font-size="10.5" font-weight="600">${strike}</text>`;
  });

  // ATM Spot marker
  const spotX = padL + ((spot - strikes[0]) / (strikes[n - 1] - strikes[0])) * chartW;
  if (spotX >= padL && spotX <= w - padR) {
    elements += `<line x1="${spotX}" y1="${padT}" x2="${spotX}" y2="${padT + chartH}" stroke="#f59e0b" stroke-width="2" stroke-dasharray="4,4" />`;
    elements += `<text x="${spotX}" y="${padT - 4}" text-anchor="middle" fill="#f59e0b" font-size="10" font-weight="700">ATM</text>`;
  }

  svg.innerHTML = elements;
}

function renderStocksTab(stocks) {
  if (!stocks) return;
  // Sector Heatmap
  const heatBox = $('#sector-heatmap');
  heatBox.innerHTML = (stocks.sectors || []).map(sec => {
    const c = sec.pchg >= 1.5 ? 'up-strong' : sec.pchg > 0 ? 'up-mod' : sec.pchg <= -1.0 ? 'down-strong' : 'down-mod';
    return `
      <div class="heat-tile ${c}">
        <div style="font-size:15px; font-weight:800">${esc(sec.name)}</div>
        <div style="font-size:18px; font-weight:800">${sign(sec.pchg)}${num(sec.pchg)}%</div>
        <div class="small" style="opacity:0.85; margin-top:auto">Leaders: ${esc(sec.lead)}</div>
      </div>
    `;
  }).join('');

  // Volume Shockers
  const vsBody = $('#table-volume-shockers tbody');
  vsBody.innerHTML = (stocks.volume_shockers || []).map(v => `
    <tr>
      <td><b>${esc(v.symbol)}</b> <span class="muted small">${esc(v.name)}</span></td>
      <td class="r"><span class="badge-tag">${esc(v.vol_ratio)}</span></td>
      <td class="r"><b>${inr(v.ltp)}</b></td>
      <td class="r ${cls(v.pchg)}"><b>${sign(v.pchg)}${num(v.pchg)}%</b></td>
      <td class="r"><button class="btn buy small" onclick="window.TerminalApp.selectAndOpen('${esc(v.symbol)}')">Trade</button></td>
    </tr>
  `).join('');

  // 52W Highs
  const hiBody = $('#table-52w-high tbody');
  hiBody.innerHTML = (stocks.high_52w || []).map(h => `
    <tr>
      <td><b>${esc(h.symbol)}</b> <span class="muted small">${esc(h.name)}</span></td>
      <td class="r">${inr(h.high_52w)}</td>
      <td class="r"><b>${inr(h.ltp)}</b></td>
      <td class="r up"><b>+${num(h.pchg)}%</b></td>
      <td class="r"><button class="btn buy small" onclick="window.TerminalApp.selectAndOpen('${esc(h.symbol)}')">Trade</button></td>
    </tr>
  `).join('');
}

function renderOptionsTab(options) {
  if (!options) return;
  const callsBody = $('#table-active-calls tbody');
  callsBody.innerHTML = (options.active_calls || []).map(c => `
    <tr>
      <td><b>${esc(c.contract)}</b></td>
      <td class="r"><b>${inr(c.ltp)}</b></td>
      <td class="r up"><b>+${num(c.pchg)}%</b></td>
      <td class="r muted">${esc(c.oi)}</td>
      <td class="r muted">${c.iv}%</td>
      <td class="r"><button class="btn buy small" onclick="window.TerminalApp.quickTrade('${esc(c.contract)}', 'BUY')">Buy</button></td>
    </tr>
  `).join('');

  const putsBody = $('#table-active-puts tbody');
  putsBody.innerHTML = (options.active_puts || []).map(p => `
    <tr>
      <td><b>${esc(p.contract)}</b></td>
      <td class="r"><b>${inr(p.ltp)}</b></td>
      <td class="r down"><b>${num(p.pchg)}%</b></td>
      <td class="r muted">${esc(p.oi)}</td>
      <td class="r muted">${p.iv}%</td>
      <td class="r"><button class="btn sell small" onclick="window.TerminalApp.quickTrade('${esc(p.contract)}', 'BUY')">Buy</button></td>
    </tr>
  `).join('');
}

function renderFuturesTab(futures) {
  if (!futures) return;
  const fill = (id, rows) => {
    $(id).innerHTML = (rows || []).map(r => `
      <tr>
        <td><b>${esc(r.symbol)}</b></td>
        <td class="r"><b>${inr(r.ltp)}</b></td>
        <td class="r ${cls(r.pchg)}"><b>${sign(r.pchg)}${num(r.pchg)}%</b></td>
        <td class="r ${cls(r.oi_chg)}"><b>${sign(r.oi_chg)}${num(r.oi_chg)}%</b></td>
        <td class="r"><button class="btn buy small" onclick="window.TerminalApp.selectAndOpen('${esc(r.symbol.split('-')[0])}')">Trade</button></td>
      </tr>
    `).join('');
  };
  fill('#table-long-buildup tbody', futures.long_buildup);
  fill('#table-short-buildup tbody', futures.short_buildup);
  fill('#table-short-covering tbody', futures.short_covering);
  fill('#table-long-unwinding tbody', futures.long_unwinding);
}

function renderCommoditiesTab(commodities) {
  if (!commodities) return;
  const tbody = $('#table-commodities tbody');
  tbody.innerHTML = (commodities.commodities || []).map(c => `
    <tr>
      <td><b>${esc(c.symbol)}</b></td>
      <td class="muted small">${esc(c.expiry)}</td>
      <td class="muted small">${c.lot} (${esc(c.unit)})</td>
      <td class="r"><b>${inr(c.ltp)}</b></td>
      <td class="r ${cls(c.chg)}"><b>${sign(c.pchg)}${num(c.pchg)}%</b></td>
      <td class="r muted">${esc(c.vol)}</td>
      <td class="r"><button class="btn buy small" onclick="window.TerminalApp.selectAndOpen('${esc(c.symbol)}')">Trade</button></td>
    </tr>
  `).join('');
}

function renderStrategyBuilder() {
  const legs = [
    { type: 'CE', strike: 25000, side: 'BUY', price: 168.45, qty: 75 },
    { type: 'CE', strike: 25200, side: 'SELL', price: 78.20, qty: 75 },
  ];
  const list = $('#strat-legs-list');
  list.innerHTML = legs.map((leg, i) => `
    <div class="leg-row">
      <span class="badge-tag ${leg.side === 'BUY' ? 'up' : 'down'}">${leg.side}</span>
      <b>NIFTY ${leg.strike} ${leg.type}</b>
      <span class="muted small">LTP: ${inr(leg.price)}</span>
      <span class="muted small">Qty: ${leg.qty}</span>
    </div>
  `).join('');

  // Draw Strategy Payoff curve
  const svg = $('#payoff-svg');
  const w = 600, h = 240, pad = 30;
  const midY = h / 2;
  const pts = [
    [pad, midY + 45],
    [pad + 180, midY + 45],
    [pad + 360, midY - 65],
    [w - pad, midY - 65]
  ];
  let d = `M ${pts[0][0]} ${pts[0][1]} L ${pts[1][0]} ${pts[1][1]} L ${pts[2][0]} ${pts[2][1]} L ${pts[3][0]} ${pts[3][1]}`;
  svg.innerHTML = `
    <line x1="${pad}" y1="${midY}" x2="${w - pad}" y2="${midY}" stroke="var(--line)" stroke-width="2" />
    <text x="${pad}" y="${midY - 8}" fill="var(--muted)" font-size="11">Zero P&amp;L</text>
    <path d="${d}" fill="none" stroke="var(--brand)" stroke-width="3" />
    <circle cx="${pad + 240}" cy="${midY}" r="4" fill="#f59e0b" />
    <text x="${pad + 240}" y="${midY + 18}" text-anchor="middle" fill="#f59e0b" font-size="11" font-weight="700">Breakeven: 25,042</text>
  `;
}

/* ------------------------------------------------------------ Market Status */
function renderStatus() {
  const m = S.status; if (!m) return;
  const pill = $('#market-pill');
  const next = new Date(m.next_open_ist);
  const nextTxt = next.toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
  if (m.is_live) { pill.className = 'pill pill-open'; pill.textContent = '● Market open · closes 15:30 IST'; }
  else if (m.state === 'PRE_OPEN') { pill.className = 'pill pill-pre'; pill.textContent = 'Pre-open · frozen at close'; }
  else { pill.className = 'pill pill-closed'; pill.textContent = `Market closed · ${m.reason}`; }
  pill.title = m.is_live ? '' : `Prices frozen at the ${m.price_date} close. Next open ${nextTxt} IST`;
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
    showNotice(`Live feed problem: ${esc(f.last_error)}. Showing the last good prices.`);
  } else {
    showNotice('');
  }
}

/* ------------------------------------------------------------ Watchlist */
const watchKeys = () => (S.lists[S.active] || []).map(i => i.key);

function renderTabs() {
  const box = $('#list-tabs');
  box.innerHTML = Object.keys(S.lists).map(n => `<button class="${n === S.active ? 'active' : ''}" data-list="${esc(n)}">${esc(n)}</button>`).join('');
}

function renderWatch() {
  const items = S.lists[S.active] || [];
  const box = $('#watchlist');
  if (!items.length) { box.innerHTML = '<div class="empty">Watchlist is empty. Search above to add instruments.</div>'; return; }
  box.innerHTML = items.map(inst => {
    const q = S.quotes[inst.key] || {};
    const ltp = q.ltp, chg = q.change, pchg = q.pchange;
    const isSel = S.selected && S.selected.key === inst.key;
    return `
      <div class="wrow ${isSel ? 'sel' : ''}" data-key="${esc(inst.key)}">
        <div>
          <div class="sym">${esc(inst.symbol)}</div>
          <div class="nm">${esc(inst.name)}</div>
        </div>
        <div>
          <div class="px">${inr(ltp)}</div>
          <div class="ch ${cls(chg)}">${sign(chg)}${num(chg)} (${sign(pchg)}${num(pchg)}%)</div>
        </div>
        <div class="hov">
          ${isTradable(inst) ? `
            <button class="b" data-act="buy" title="Buy">B</button>
            <button class="s" data-act="sell" title="Sell">S</button>
          ` : ''}
          <button class="a" data-act="ai" title="AI Analysis">AI</button>
          <button class="d" data-act="del" title="Remove">&times;</button>
        </div>
      </div>
    `;
  }).join('');
}

function renderIndexStrip() {
  const box = $('#index-strip');
  box.innerHTML = S.indexInsts.map(inst => {
    const q = S.quotes[inst.key] || {};
    return `
      <div class="idx" data-key="${esc(inst.key)}">
        <b>${esc(inst.symbol)}</b>
        <span>${num(q.ltp)}</span>
        <span class="${cls(q.change)} small">${sign(q.change)}${num(q.pchange)}%</span>
      </div>
    `;
  }).join('');
}

/* ------------------------------------------------------------ Selected Instrument */
async function selectInstrument(instOrKey) {
  let inst = typeof instOrKey === 'string' ? null : instOrKey;
  if (!inst) {
    try { inst = await api(`/api/instrument?ticker=${encodeURIComponent(instOrKey)}`); }
    catch { inst = Object.values(S.lists).flat().find(i => i.key === instOrKey) || S.indexInsts.find(i => i.key === instOrKey); }
  }
  if (!inst) return;
  S.selected = inst;
  renderWatch();
  renderSelectedHead();
  if (S.view === 'chart') loadCandles(inst.key, S.tf);
  else if (S.view === 'chain') loadChain(inst.underlying || inst.symbol);
}

function renderSelectedHead() {
  const i = S.selected; if (!i) return;
  $('#inst-symbol').textContent = i.symbol;
  $('#inst-name').textContent = i.name + (i.segment ? ` · ${i.segment}` : '');
  const q = S.quotes[i.key] || {};
  $('#inst-ltp').textContent = inr(q.ltp);
  const chgEl = $('#inst-change');
  chgEl.className = 'chg ' + cls(q.change);
  chgEl.textContent = (q.change != null) ? `${sign(q.change)}${num(q.change)} (${sign(q.pchange)}${num(q.pchange)}%)` : '';
  const fr = $('#inst-frozen');
  if (q.frozen) { fr.hidden = false; fr.textContent = `Close of ${q.frozen_date || ''}`; }
  else fr.hidden = true;
  $('#buy-btn').hidden = !isTradable(i);
  $('#sell-btn').hidden = !isTradable(i);
  renderDepth(q);
}

function renderDepth(q = {}) {
  const dt = $('#depth-table');
  const bids = q.depth_bids || [];
  const asks = q.depth_asks || [];
  if (!bids.length && !asks.length) {
    dt.innerHTML = '';
    $('#depth-note').textContent = S.status && S.status.is_live ? 'No market depth for this instrument.' : 'Market closed: live order book offline.';
  } else {
    $('#depth-note').textContent = '';
    let rows = '<tr><th>Bid Qty</th><th>Bid</th><th>Ask</th><th>Ask Qty</th></tr>';
    for (let r = 0; r < 5; r++) {
      const b = bids[r] || {}, a = asks[r] || {};
      rows += `<tr>
        <td class="bid">${b.quantity ? num(b.quantity, 0) : '—'}</td>
        <td class="bid"><b>${b.price ? num(b.price) : '—'}</b></td>
        <td class="ask"><b>${a.price ? num(a.price) : '—'}</b></td>
        <td class="ask">${a.quantity ? num(a.quantity, 0) : '—'}</td>
      </tr>`;
    }
    dt.innerHTML = rows;
  }
  const dl = $('#quote-stats');
  dl.innerHTML = `
    <dt>Open</dt><dd>${num(q.open)}</dd>
    <dt>High</dt><dd>${num(q.high)}</dd>
    <dt>Low</dt><dd>${num(q.low)}</dd>
    <dt>Prev close</dt><dd>${num(q.close)}</dd>
    <dt>Volume</dt><dd>${q.volume ? num(q.volume, 0) : '—'}</dd>
  `;
}

/* ------------------------------------------------------------ Chart */
function initChart() {
  const el = $('#chart');
  if (!window.LightweightCharts) return;
  const isDark = document.documentElement.dataset.theme !== 'light';
  S.chart = LightweightCharts.createChart(el, {
    layout: {
      background: { color: 'transparent' },
      textColor: isDark ? '#8b95a5' : '#667085',
      fontFamily: cssVar('--mono') || 'monospace',
    },
    grid: { vertLines: { color: isDark ? '#1a202c' : '#eaecf0' }, horzLines: { color: isDark ? '#1a202c' : '#eaecf0' } },
    rightPriceScale: { borderColor: isDark ? '#242a3a' : '#dfe3ea' },
    timeScale: { borderColor: isDark ? '#242a3a' : '#dfe3ea', timeVisible: true, secondsVisible: false },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
  });
  S.candleSeries = S.chart.addCandlestickSeries({
    upColor: '#00b875', downColor: '#ff4d4f',
    borderUpColor: '#00b875', borderDownColor: '#ff4d4f',
    wickUpColor: '#00b875', wickDownColor: '#ff4d4f',
  });
  S.volumeSeries = S.chart.addHistogramSeries({
    color: '#3b82f644', priceFormat: { type: 'volume' },
    priceScaleId: '', scaleMargins: { top: 0.8, bottom: 0 },
  });
  new ResizeObserver(() => { S.chart && S.chart.resize(el.clientWidth, el.clientHeight); }).observe(el);
}

async function loadCandles(key, tf) {
  try {
    const data = await api(`/api/candles?key=${encodeURIComponent(key)}&tf=${tf}`);
    S.candles = data.candles || [];
    if (S.candleSeries) {
      S.candleSeries.setData(S.candles.map(c => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })));
      S.volumeSeries.setData(S.candles.map(c => ({ time: c.time, value: c.volume, color: c.close >= c.open ? '#00b87544' : '#ff4d4f44' })));
      S.chart.timeScale().fitContent();
    }
  } catch (err) {
    console.error('Candle load failed:', err);
  }
}

/* ------------------------------------------------------------ Option Chain */
async function loadChain(underlying) {
  try {
    const exData = await api(`/api/expiries?underlying=${encodeURIComponent(underlying)}`);
    const expiries = exData.expiries || [];
    const expSelect = $('#chain-expiry');
    expSelect.innerHTML = expiries.map(e => `<option value="${e}">${e}</option>`).join('');
    if (expiries.length) loadChainTable(underlying, expiries[0]);
  } catch (err) {
    console.error('Failed to load expiries:', err);
  }
}

async function loadChainTable(underlying, expiry) {
  try {
    const data = await api(`/api/optionchain?underlying=${encodeURIComponent(underlying)}&expiry=${expiry}`);
    S.chain = data;
    renderChainTable(data);
  } catch (err) {
    console.error('Failed to load option chain:', err);
  }
}

function renderChainTable(chain) {
  const table = $('#chain-table');
  const rows = chain.strikes || [];
  let html = `
    <thead>
      <tr>
        <th colspan="5">CALLS</th>
        <th class="str">STRIKE</th>
        <th colspan="5">PUTS</th>
      </tr>
      <tr>
        <th>OI</th><th>IV</th><th>Delta</th><th>LTP</th><th>Trade</th>
        <th class="str">Strike</th>
        <th>Trade</th><th>LTP</th><th>Delta</th><th>IV</th><th>OI</th>
      </tr>
    </thead>
    <tbody>
  `;
  rows.forEach(r => {
    const ce = r.ce || {}, pe = r.pe || {};
    html += `
      <tr class="${r.is_atm ? 'atm' : ''}">
        <td>${ce.oi ? num(ce.oi, 0) : '—'}</td>
        <td>${ce.iv ? num(ce.iv, 1) : '—'}</td>
        <td>${ce.delta ? num(ce.delta, 2) : '—'}</td>
        <td><b>${ce.ltp ? num(ce.ltp) : '—'}</b></td>
        <td class="trade" onclick="window.TerminalApp.quickTrade('${esc(ce.trading_symbol)}', 'BUY')"><span class="badge-tag up">B</span></td>
        <td class="str"><b>${r.strike}</b></td>
        <td class="trade" onclick="window.TerminalApp.quickTrade('${esc(pe.trading_symbol)}', 'BUY')"><span class="badge-tag down">B</span></td>
        <td><b>${pe.ltp ? num(pe.ltp) : '—'}</b></td>
        <td>${pe.delta ? num(pe.delta, 2) : '—'}</td>
        <td>${pe.iv ? num(pe.iv, 1) : '—'}</td>
        <td>${pe.oi ? num(pe.oi, 0) : '—'}</td>
      </tr>
    `;
  });
  html += '</tbody>';
  table.innerHTML = html;
}

/* ------------------------------------------------------------ Orders & Portfolio */
function switchBook(tab) {
  S.book = tab;
  $$('.book .tab').forEach(b => b.classList.toggle('active', b.dataset.book === tab));
  renderBook();
}

function switchView(view) {
  S.view = view;
  $$('.main-tabs .tab').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $('#view-chart').hidden = view !== 'chart';
  $('#view-chain').hidden = view !== 'chain';
  if (view === 'chart' && S.selected) loadCandles(S.selected.key, S.tf);
  if (view === 'chain') loadChain($('#chain-under').value);
}

function renderBook() {
  const p = S.portfolio; if (!p) return;
  $('#n-pos').textContent = p.positions && p.positions.length ? `(${p.positions.length})` : '';
  $('#n-ord').textContent = p.orders && p.orders.length ? `(${p.orders.length})` : '';
  $('#funds-mini').innerHTML = `<span>Available:</span> <b>${inr(p.funds ? p.funds.available_margin : 1000000)}</b>`;

  const body = $('#book-body');
  if (S.book === 'positions') {
    const list = p.positions || [];
    if (!list.length) { body.innerHTML = '<div class="empty">No open positions. Place a paper trade to start.</div>'; return; }
    body.innerHTML = `
      <table class="upstox-table">
        <thead><tr><th>Instrument</th><th>Product</th><th class="r">Qty</th><th class="r">Avg Price</th><th class="r">LTP</th><th class="r">P&amp;L</th></tr></thead>
        <tbody>
          ${list.map(pos => `
            <tr>
              <td><b>${esc(pos.symbol)}</b></td>
              <td>${esc(pos.product)}</td>
              <td class="r ${cls(pos.qty)}"><b>${pos.qty}</b></td>
              <td class="r">${num(pos.avg_price)}</td>
              <td class="r">${num(pos.ltp)}</td>
              <td class="r ${cls(pos.pnl)}"><b>${inr(pos.pnl)}</b></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } else if (S.book === 'orders') {
    const list = p.orders || [];
    if (!list.length) { body.innerHTML = '<div class="empty">No recent orders placed today.</div>'; return; }
    body.innerHTML = `
      <table class="upstox-table">
        <thead><tr><th>Time</th><th>Instrument</th><th>Side</th><th>Type</th><th class="r">Qty</th><th class="r">Price</th><th>Status</th></tr></thead>
        <tbody>
          ${list.map(ord => `
            <tr>
              <td class="muted small">${esc(ord.time || '—')}</td>
              <td><b>${esc(ord.symbol)}</b></td>
              <td><span class="badge-tag ${ord.side === 'BUY' ? 'up' : 'down'}">${esc(ord.side)}</span></td>
              <td>${esc(ord.order_type)}</td>
              <td class="r">${ord.qty}</td>
              <td class="r">${ord.price ? num(ord.price) : 'MKT'}</td>
              <td><span class="badge-tag">${esc(ord.status)}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } else if (S.book === 'funds') {
    const f = p.funds || {};
    body.innerHTML = `
      <div style="padding:16px; display:grid; grid-template-columns:repeat(3, 1fr); gap:14px">
        <div class="sec-card"><span class="muted small">Available Margin</span><h3>${inr(f.available_margin || 1000000)}</h3></div>
        <div class="sec-card"><span class="muted small">Used Margin</span><h3>${inr(f.used_margin || 0)}</h3></div>
        <div class="sec-card"><span class="muted small">Realised P&amp;L</span><h3 class="${cls(f.realised_pnl)}">${inr(f.realised_pnl || 0)}</h3></div>
      </div>
    `;
  } else {
    body.innerHTML = '<div class="empty">No data available for this section.</div>';
  }
}

/* ------------------------------------------------------------ Ticket Dialog */
function openTicket(sym, side = 'BUY') {
  const dlg = $('#ticket');
  $('#t-symbol').textContent = sym;
  $('#t-sub').textContent = 'Paper Trading Order';
  $('#t-side button[data-v="BUY"]').classList.toggle('active', side === 'BUY');
  $('#t-side button[data-v="SELL"]').classList.toggle('active', side === 'SELL');
  const subBtn = $('#t-submit');
  subBtn.className = `btn ${side.toLowerCase()} wide`;
  subBtn.textContent = side;
  dlg.showModal();
}

/* ------------------------------------------------------------ AI Desk Drawer */
async function startAiAnalysis(sym) {
  const drawer = $('#ai-drawer');
  drawer.hidden = false;
  $('#ai-title').textContent = `Analyzing ${sym} with 12 AI Agents...`;
  const body = $('#ai-body');
  body.innerHTML = `
    <div class="ai-card">
      <h4>TradingAgents Pipeline Status</h4>
      <div class="pipe-step done"><span class="dot"></span> Market Analyst (Technical Indicators &amp; Momentum)</div>
      <div class="pipe-step done"><span class="dot"></span> Sentiment Analyst (Social sentiment &amp; News sentiment)</div>
      <div class="pipe-step done"><span class="dot"></span> Fundamentals Analyst (Screener.in P/E, ROCE &amp; Debt)</div>
      <div class="pipe-step running"><span class="dot"></span> Bull vs Bear Researcher Debate (Multi-turn argumentation)</div>
      <div class="pipe-step pending"><span class="dot"></span> Risk Management Evaluation (Conservative, Neutral, Aggressive)</div>
      <div class="pipe-step pending"><span class="dot"></span> Trader Final Synthesis &amp; Trade Signal</div>
    </div>
  `;
  try {
    const job = await api('/api/analysis', { method: 'POST', body: JSON.stringify({ ticker: sym }) });
    pollAi(job.job_id);
  } catch (err) {
    console.error('AI start failed:', err);
  }
}

async function pollAi(id) {
  try {
    const job = await api(`/api/analysis/${id}`);
    if (job.status === 'DONE') {
      $('#ai-title').textContent = `Analysis for ${job.ticker} Complete`;
      $('#ai-download').hidden = false;
      $('#ai-download').href = `/api/analysis/${id}/report.html`;
      $('#ai-body').innerHTML = `
        <div class="ai-card">
          <h3 class="up" style="margin:0 0 6px">DECISION: ${esc(job.signal || 'HOLD')}</h3>
          <div class="muted small">${esc(job.trade_date)} &middot; Confidence: 85%</div>
        </div>
        <div class="ai-card">
          <h4>Executive Rationale</h4>
          <p>${md(job.rationale || 'Consensus recommendation formed across fundamental, technical and risk teams.')}</p>
        </div>
      `;
    } else {
      setTimeout(() => pollAi(id), 2500);
    }
  } catch (err) {
    console.error('AI poll failed:', err);
  }
}

/* ------------------------------------------------------------ Live SSE Feed */
function connectStream() {
  const es = new EventSource('/api/stream');
  es.addEventListener('quotes', e => {
    try {
      const qs = JSON.parse(e.data);
      Object.assign(S.quotes, qs);
      renderWatch();
      renderIndexStrip();
      if (S.selected && qs[S.selected.key]) renderSelectedHead();
    } catch {}
  });
  es.addEventListener('portfolio', e => {
    try {
      S.portfolio = JSON.parse(e.data);
      renderBook();
    } catch {}
  });
  es.addEventListener('status', e => {
    try {
      S.status = JSON.parse(e.data);
      renderStatus();
    } catch {}
  });
}

/* ------------------------------------------------------------ App Expose & Events */
window.TerminalApp = {
  selectAndOpen: async sym => {
    switchNav('trading');
    await selectInstrument(sym);
  },
  openChainFor: sym => {
    switchNav('trading');
    switchView('chain');
    $('#chain-under').value = sym;
    loadChain(sym);
  },
  quickTrade: (sym, side) => {
    openTicket(sym, side);
  },
};

/* DOM Event Bindings */
window.addEventListener('DOMContentLoaded', async () => {
  // Navigation Tabs
  $$('.nav-item').forEach(btn => btn.addEventListener('click', () => switchNav(btn.dataset.nav)));
  $$('.sub-item').forEach(btn => btn.addEventListener('click', () => switchSubNav(btn.dataset.sub)));

  // Trending Filter Pills
  $$('#trending-pills .pill-btn').forEach(btn => btn.addEventListener('click', () => {
    $$('#trending-pills .pill-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    S.trendingCat = btn.dataset.cat;
    S.trendingPage = 1;
    renderTrendingStocks();
  }));

  // Pagination buttons
  $('#pg-prev').addEventListener('click', () => { if (S.trendingPage > 1) { S.trendingPage--; renderTrendingStocks(); } });
  $('#pg-next').addEventListener('click', () => { S.trendingPage++; renderTrendingStocks(); });
  $$('.page-btns .pg-btn[data-page]').forEach(b => b.addEventListener('click', () => {
    $$('.page-btns .pg-btn').forEach(p => p.classList.remove('active'));
    b.classList.add('active');
    S.trendingPage = +b.dataset.page;
    renderTrendingStocks();
  }));

  // Quick Action Pills
  $$('.quick-pills-row .action-pill').forEach(pill => pill.addEventListener('click', () => {
    const act = pill.dataset.action;
    if (act === 'chain') { switchNav('trading'); switchView('chain'); }
    else if (act === 'strategy') { switchNav('strategy'); }
    else if (act === 'commodities') { switchSubNav('commodities'); }
    else if (act === 'ipo') { $('#ipo-grid').scrollIntoView({ behavior: 'smooth' }); }
    else if (act === 'oi') { $('#oi-chart-container').scrollIntoView({ behavior: 'smooth' }); }
  }));

  // Timeframe selector
  $$('#tf-row button').forEach(b => b.addEventListener('click', () => {
    $$('#tf-row button').forEach(btn => btn.classList.remove('active'));
    b.classList.add('active');
    S.tf = b.dataset.tf;
    if (S.selected) loadCandles(S.selected.key, S.tf);
  }));

  // Center tabs
  $$('.main-tabs .tab').forEach(b => b.addEventListener('click', () => switchView(b.dataset.view)));
  // Book tabs
  $$('.book .tab').forEach(b => b.addEventListener('click', () => switchBook(b.dataset.book)));

  // Buy/Sell buttons
  $('#buy-btn').addEventListener('click', () => S.selected && openTicket(S.selected.symbol, 'BUY'));
  $('#sell-btn').addEventListener('click', () => S.selected && openTicket(S.selected.symbol, 'SELL'));
  $('#ai-btn').addEventListener('click', () => S.selected && startAiAnalysis(S.selected.symbol));

  // Drawer Close
  $('#ai-close').addEventListener('click', () => { $('#ai-drawer').hidden = true; });
  $('#t-close').addEventListener('click', () => { $('#ticket').close(); });

  // Ticket Form Submit
  $('#ticket-form').addEventListener('submit', async e => {
    e.preventDefault();
    const sym = $('#t-symbol').textContent;
    const side = $('#t-side button.active').dataset.v;
    const qty = +$('#t-qty').value;
    const type = $('#t-type').value;
    const prod = $('#t-product').value || 'MIS';
    try {
      await api('/api/order', {
        method: 'POST',
        body: JSON.stringify({ key: S.selected ? S.selected.key : `NSE_EQ|${sym}`, side, qty, order_type: type, product: prod })
      });
      $('#ticket').close();
      toast(`${side} order for ${qty} ${sym} placed!`, 'up');
    } catch (err) {
      $('#t-error').textContent = err.message;
      $('#t-error').hidden = false;
    }
  });

  // Theme button
  $('#theme-btn').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme;
    document.documentElement.dataset.theme = cur === 'light' ? 'dark' : 'light';
  });

  // Watchlist click delegate
  $('#watchlist').addEventListener('click', e => {
    const row = e.target.closest('.wrow'); if (!row) return;
    const act = e.target.dataset.act;
    const key = row.dataset.key;
    if (act === 'buy') openTicket(row.querySelector('.sym').textContent, 'BUY');
    else if (act === 'sell') openTicket(row.querySelector('.sym').textContent, 'SELL');
    else if (act === 'ai') startAiAnalysis(row.querySelector('.sym').textContent);
    else selectInstrument(key);
  });

  // Global search
  const doSearch = debounce(async q => {
    const box = $('#global-search-results');
    if (!q || q.length < 2) { box.hidden = true; return; }
    try {
      const res = await api(`/api/search?q=${encodeURIComponent(q)}&limit=8`);
      const items = res.results || [];
      if (!items.length) { box.hidden = true; return; }
      box.innerHTML = items.map(i => `
        <div class="sr" data-key="${esc(i.key)}">
          <div><b>${esc(i.symbol)}</b> <small>${esc(i.name)}</small></div>
          <button class="btn buy small" onclick="window.TerminalApp.selectAndOpen('${esc(i.symbol)}')">Open</button>
        </div>
      `).join('');
      box.hidden = false;
    } catch {}
  }, 200);

  $('#global-search').addEventListener('input', e => doSearch(e.target.value.trim()));
  document.addEventListener('click', e => { if (!e.target.closest('.search-top-wrap')) $('#global-search-results').hidden = true; });

  // Init Status & Feeds
  try {
    const st = await api('/api/status');
    S.status = st.market; S.feed = st.feed;
    renderStatus();
    renderFeedNotice();
  } catch {}

  // Init Index Strip
  try {
    const idxRes = await Promise.all(INDEX_STRIP.map(sym => api(`/api/instrument?ticker=${sym}`)));
    S.indexInsts = idxRes;
    renderIndexStrip();
  } catch {}

  // Init Watchlist
  S.lists['Watchlist 1'] = S.indexInsts.concat([
    { key: 'NSE_EQ|INE002A01018', symbol: 'RELIANCE', name: 'RELIANCE INDUSTRIES LTD', kind: 'EQ' },
    { key: 'NSE_EQ|INE467B01029', symbol: 'TCS', name: 'TATA CONSULTANCY SERV LT', kind: 'EQ' },
    { key: 'NSE_EQ|INE040A01034', symbol: 'HDFCBANK', name: 'HDFC BANK LTD', kind: 'EQ' },
    { key: 'NSE_EQ|INE009A01021', symbol: 'INFY', name: 'INFOSYS LTD', kind: 'EQ' },
    { key: 'NSE_EQ|INE090A01021', symbol: 'ICICIBANK', name: 'ICICI BANK LTD.', kind: 'EQ' },
    { key: 'NSE_EQ|INE062A01020', symbol: 'SBIN', name: 'STATE BANK OF INDIA', kind: 'EQ' },
    { key: 'NSE_EQ|INE154A01025', symbol: 'ITC', name: 'ITC LTD', kind: 'EQ' },
  ]);
  S.active = 'Watchlist 1';
  renderTabs();
  renderWatch();

  initChart();
  await loadDiscovery();
  connectStream();

  // Select initial stock
  selectInstrument('RELIANCE');
});

})();
