/* Prediction tabs: TVR & Audience Forecast and Market & Competitor Forecast.
 * The worker builds compact series from the sheets stored in this browser; The forecast engine forecasts them 60 days ahead
 * in one batch on the server; the horizon control only slices the outlook, so changing it is instant.
 */
(function (App) {
  const { esc, fmt, charts: C, $ } = App;
  const MR = window.MR;
  const HMAX = 60;
  const cache = new Map();
  App.predictEvidence = App.predictEvidence || {};
  const finite = (v) => v != null && Number.isFinite(v);
  const avg = (a) => { const v = (a || []).filter(finite); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null; };
  const total = (a) => (a || []).filter(finite).reduce((x, y) => x + y, 0);
  const pct = (a, b) => (finite(a) && finite(b) && b !== 0 ? ((a - b) / Math.abs(b)) * 100 : null);
  const f2 = (v) => fmt.num(v, 2), f1 = (v) => fmt.num(v, 1);
  const signed = (v, d = 0) => (v == null ? 'n/a' : `${v > 0 ? '+' : ''}${Number(v).toFixed(d)}%`);
  const short = (s, n = 34) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));
  const relCls = { High: 'good', Medium: 'warn', Low: 'bad' };
  let HIST = 56;   // history points drawn before the forecast (days or months)
  /** Month-view wording: swaps the day-based phrases used in titles, help and evidence. */
  const W = (M) => (t) => (M && typeof t === 'string' ? t.replace(/([Ll])ast 4 weeks/g, '$1ast 3 months').replace(/7-day average/g, '3-month average').replace(/\(per day\)/g, '(per month)').replace(/spots a day in/g, 'spots a month in')
    .replace(/9 in 10 days/g, '9 in 10 months').replace(/forecast day for/g, 'forecast month for').replace(/each forecast day/g, 'each forecast month').replace(/daily/gi, (m) => (m[0] === 'D' ? 'Monthly' : 'monthly')).replace(/weekly/g, 'monthly') : t);
  /** Notes about how much history a monthly forecast has. */
  function monthNote(pc) {
    const m = pc.months_of_history || 0;
    if (m < 12) return `<div class="banner bad"><span><b>Only about ${m} month${m === 1 ? '' : 's'} of history.</b> Monthly forecasts need at least 12 months (24 or more is best) to learn seasonality, so treat these numbers as rough. Append older periods to the sheet, or use the Days view.</span></div>`;
    if (m < 24) return `<div class="banner"><span>About ${m} months of history. Monthly forecasts work, but with 24 months or more the seasonal pattern is much more reliable.</span></div>`;
    return '';
  }

  /* ---------------- shared runner ---------------- */
  /* ---- Sri Lanka calendar: major events (per client, saved on this computer) and chart pins ---- */
  let MAJOR = [], PINLIST = [], PINS_ON = true;
  const evKey = () => 'mr:major-events:' + App.clientId();
  const readEvents = () => { try { const v = JSON.parse(localStorage.getItem(evKey()) || '[]'); return Array.isArray(v) ? v.filter((e) => e && e.start) : []; } catch (e) { return []; } };
  const writeEvents = (v) => { try { localStorage.setItem(evKey(), JSON.stringify(v)); } catch (e) { /* storage blocked */ } };
  async function loadPins(dates, forecastDates) {
    try {
      const start = dates[0], end = forecastDates[forecastDates.length - 1];
      const r = await App.api.post('/api/calendar/pins', { start, end, major_events: MAJOR });
      PINLIST = r.pins || [];
    } catch (e) { PINLIST = []; }
  }
  /** Pins that fall on the given chart labels (days, weeks or month starts). */
  function eventOpt(labels) {
    const L = labels.map((l) => String(l).slice(0, 10)), n = L.length, out = [];
    if (n < 2) return { on: PINS_ON, pins: [] };
    const step = (Date.parse(L[1]) - Date.parse(L[0])) / 86400000;
    for (const p of PINLIST) {
      const t = Date.parse(p.date); if (t < Date.parse(L[0]) || t >= Date.parse(L[n - 1]) + step * 86400000) continue;
      let i = n - 1; while (i > 0 && Date.parse(L[i]) > t) i--;
      out.push({ index: i, emoji: p.emoji, label: p.label });
    }
    return { on: PINS_ON, pins: out };
  }
  function eventsEditor(onSave) {
    const rows = readEvents();
    const m = App.modal('Major events', `<p class="small muted">Flag cricket tournaments, elections or special broadcasts. The forecast engine learns from past events and expects the same lift or dip in future ones. Events are saved on this computer for this client.</p>
      <div id="me-rows" class="stack"></div><div class="row" style="margin-top:12px"><button class="btn sm" type="button" id="me-add">Add event</button><button class="btn primary" type="button" id="me-save">Save and refresh</button></div>`);
    const draw = () => { m.querySelector('#me-rows').innerHTML = rows.map((e, i) => `<div class="row" data-i="${i}"><input class="me-name" placeholder="Event name" value="${esc(e.name || '')}" style="min-width:200px"><input class="me-a" type="date" value="${esc(e.start || '')}"><span class="muted small">to</span><input class="me-b" type="date" value="${esc(e.end || e.start || '')}"><button class="btn sm ghost me-x" type="button">Remove</button></div>`).join('') || '<div class="muted small">No events yet.</div>';
      m.querySelectorAll('.me-x').forEach((b) => { b.onclick = () => { rows.splice(+b.closest('[data-i]').dataset.i, 1); draw(); }; }); };
    const sync = () => m.querySelectorAll('[data-i]').forEach((r) => { const e = rows[+r.dataset.i]; e.name = r.querySelector('.me-name').value; e.start = r.querySelector('.me-a').value; e.end = r.querySelector('.me-b').value || e.start; });
    m.querySelector('#me-add').onclick = () => { sync(); rows.push({ name: '', start: '', end: '' }); draw(); };
    m.querySelector('#me-save').onclick = () => { sync(); writeEvents(rows.filter((e) => e.start && e.end >= e.start)); m.querySelectorAll('[data-x]').forEach((x) => x.click()); onSave(); };
    draw();
  }
  async function forecastBatch(kind, items, gran, onProgress) {
    if (!items.length) return null;
    return App.runJob('/api/forecast/run', { kind, series: items, params: { granularity: gran, horizon_days: gran === 'weekly' ? HMAX + 6 : gran === 'monthly' ? 360 : HMAX, covariates: true, entity_type: 'prediction', metric: 'prediction',
      holdout: gran === 'monthly' ? 3 : gran === 'weekly' ? 4 : 30, major_events: MAJOR } }, onProgress);
  }
  async function getPrediction(key, build, kind, onProgress) {
    if (cache.has(key)) return cache.get(key);
    const p = (async () => {
      onProgress(0.02, 'Building series from the data in this browser');
      const payload = await build();
      const n = payload.daily.length + payload.weekly.length;
      if (!n) return { payload, results: [], res: null };
      onProgress(0.08, `Analysing ${n} series`);
      const [d, w] = await Promise.all([forecastBatch(kind, payload.daily, payload.gran || 'daily', (p2, m) => onProgress(0.08 + 0.9 * p2, m)), forecastBatch(kind, payload.weekly, 'weekly', () => {})]);
      for (const r of [d, w]) if (r && !r.ok) throw new Error(r.message || 'The forecast could not run.');
      const results = [].concat(d ? d.results : [], w ? w.results : []);
      App.shell.refreshModel();
      return { payload, results, res: d || w };
    })();
    cache.set(key, p);
    p.catch(() => cache.delete(key));
    if (cache.size > 12) cache.delete(cache.keys().next().value);
    return p;
  }
  /** Rows {name, now, next, chg} for a group of share series (values are percentages). */
  function shareRows(results, H, NOW, sorter = 'next') {
    return results.map((r) => ({ name: r.entity, now: MR.recentMean(r, NOW), next: avg(slice(r, H).p50) })).filter((x) => finite(x.next) && finite(x.now))
      .map((x) => ({ ...x, chg: x.next - x.now })).sort((a, b) => b[sorter] - a[sorter]);
  }
  /** Horizontal grouped bars: share now (grey) vs forecast (colour). The change in points is written in each label, so no hover is needed. */
  function shareBars(id, rows, { nowLabel, nextLabel, color = C.PALETTE[0], title = (n) => n, max = 10 } = {}) {
    const r = rows.slice(0, max);
    return C.make(id, { type: 'bar', data: { labels: r.map((x) => `${short(title(x.name), 30)}  (${x.chg >= 0 ? '+' : ''}${x.chg.toFixed(1)} pts)`), datasets: [
      { label: nowLabel, data: r.map((x) => x.now), backgroundColor: 'rgba(142,154,200,.45)', borderRadius: 4, barThickness: 11 },
      { label: nextLabel, data: r.map((x) => x.next), backgroundColor: r.map((x) => (x.chg >= 0 ? (C.css('--good') || '#22f5a6') + 'cc' : (C.css('--bad') || '#ff5d7a') + 'cc')), borderRadius: 4, barThickness: 11 }] },
      options: { indexAxis: 'y', plugins: { legend: { position: 'bottom', labels: { generateLabels: () => [
          { text: nowLabel, fontColor: C.css('--text'), fillStyle: 'rgba(142,154,200,.6)', strokeStyle: 'transparent', lineWidth: 0 }, { text: nextLabel + ' (green = gaining, red = losing)', fontColor: C.css('--text'), fillStyle: (C.css('--good') || '#22f5a6'), strokeStyle: 'transparent', lineWidth: 0 }] } },
          tooltip: { callbacks: { title: (it) => title(r[it[0].dataIndex].name), label: (c) => `${c.dataset.label}: ${fmt.num(c.parsed.x, 1)}%` } } },
        scales: { x: { beginAtZero: true, ticks: { callback: (v) => v + '%' } }, y: { grid: { display: false }, ticks: { font: { size: 11 } } } } } });
  }
  /** Trailing moving average, used only to draw very noisy daily lines; all numbers in text use the raw values. */
  const smooth = (a, k) => a.map((_, i) => { const w = a.slice(Math.max(0, i - k + 1), i + 1).filter(finite); return w.length ? w.reduce((x, y) => x + y, 0) / w.length : null; });

  /** One-line legend; the long explanation is folded away. */
  const forecastKey = (M) => `<div class="fc-key" role="note"><div class="fc-key-row"><span class="fc-pill">Forecast</span><span><i class="k-actual"></i><b>Actual</b></span><span><i class="k-fc"></i><b>Forecast</b>, most likely</span><span><i class="k-band"></i><b>Range</b>, low to high</span><span><i class="k-zone"></i>Shaded = has not happened yet</span>
    <button class="btn sm ghost" type="button" data-intro style="margin-left:auto">Watch the intro</button></div>
    <details class="fc-more"><summary>What do low, likely and high mean?</summary><div class="fc-key-row"><span><b>Most likely</b>: the best single guess</span><span><b>Low case</b>: a safe floor, hit about 9 times in 10. Use it for guarantees</span><span><b>High case</b>: the upside, not exceeded about 9 times in 10</span></div>
    <div class="fc-key-note">Every number marked FORECAST is an estimate of the next ${M ? 'months' : 'days'} based on your own history. It can be wrong.</div></details></div>`;

  /* ---------------- sub-views (one question per view) ---------------- */
  const SV = { tvr: 'playbook', market: 'war' };
  const svNav = (kind, items) => `<div class="sv-nav" role="tablist" aria-label="Choose a view">${items.map(([id, label, q]) => `<button type="button" class="sv-btn" role="tab" data-svb="${id}" aria-pressed="${SV[kind] === id}"><b>${esc(label)}</b><small>${esc(q)}</small></button>`).join('')}</div>`;
  const svHide = (kind, id) => (SV[kind] === id ? '' : ' hidden');
  function wireSv(p, kind) {
    p.querySelectorAll('[data-svb]').forEach((b) => { b.onclick = () => {
      SV[kind] = b.dataset.svb;
      p.querySelectorAll('[data-svb]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      p.querySelectorAll('section.sv').forEach((sec) => { sec.hidden = sec.dataset.sv !== SV[kind]; });
      p.querySelectorAll(`section.sv[data-sv="${SV[kind]}"] canvas`).forEach((c) => { const ch = window.Chart && Chart.getChart(c); if (ch) ch.resize(); });
    }; });
  }
  /** Shortlist cards: [{title, sub, rows:[{label, value, tone, detail}], todo}]. Each row opens a detail popup. */
  function shortlist(el, cards) {
    if (!el) return;
    const reg = [];
    el.innerHTML = cards.map((c) => `<div class="card sl-card fc"><span class="fc-pill tile">Forecast</span><h3>${esc(c.title)}</h3>${c.sub ? `<div class="sub muted small">${esc(c.sub)}</div>` : ''}
      <div class="sl-rows">${c.rows.length ? c.rows.map((r) => { reg.push(r.detail); return `<button type="button" class="sl-row" data-sl="${reg.length - 1}"><span class="sl-l">${esc(r.label)}</span><span class="sl-v ${r.tone || ''}">${esc(r.value)}</span></button>`; }).join('') : `<div class="muted small">${esc(c.empty || 'Not enough data yet.')}</div>`}</div>
      ${c.todo ? `<div class="sl-todo"><b>Do this</b> ${esc(c.todo)}</div>` : ''}</div>`).join('');
    el.querySelectorAll('[data-sl]').forEach((b) => { b.onclick = () => { const d = reg[+b.dataset.sl]; if (d) C.detail({ forecast: true, ...d }); }; });
  }

  /** Centre-of-screen loader; returns the progress callback. Call App.loader.hide() when done. */
  function scanning(p, title) {
    p.innerHTML = '';
    App.loader.show(title, 'Preparing');
    App.loader.progress(0.03);
    return (p2, m) => App.loader.progress(Math.max(0.03, p2), m);
  }
  const group = (results, g) => results.filter((r) => r.group === g);
  const one = (results, g) => group(results, g)[0] || null;
  const slice = (r, H) => MR.sliceForecast(r, H);
  const unitFmt = (u) => ({ currency: fmt.lkrc, percent: (v) => fmt.pct(v, 1), rating: f2 }[u] || fmt.compact);
  function needData(p, sheet) {
    p.innerHTML = App.emptyState(`Load the ${sheet} to unlock this prediction`, 'Use the data sources panel above. Files are read once and stay in this browser.');
  }
  /* ---- Trust meter: accuracy on days the engine had not seen (100 minus sMAPE) ---- */
  const trustOf = (r) => { const b = r && r.backtest; return b && b.model && b.model.smape != null ? Math.max(0, Math.min(100, 100 - b.model.smape)) : null; };
  const trustLvl = (t) => (t == null ? ['n/a', 'warn'] : t >= 90 ? ['High', 'good'] : t >= 75 ? ['Medium', 'warn'] : ['Low', 'bad']);
  const trustTip = (r) => { const b = r && r.backtest; return b ? `Tested on the last ${b.holdout} ${r.granularity === 'monthly' ? 'months' : r.granularity === 'weekly' ? 'weeks' : 'days'} of recorded data that the engine had not seen. Accuracy = 100 minus the average percentage error (sMAPE).` : 'Not enough history for an accuracy test.'; };
  function trustBadge(results) {
    const ts = results.map(trustOf).filter(finite); if (!ts.length) return '<span class="badge warn" title="Not enough history for an accuracy test.">Trust: not tested</span>';
    const t = ts.reduce((a, b) => a + b, 0) / ts.length, [lvl, cls] = trustLvl(t), r0 = results.find((x) => trustOf(x) != null);
    return `<span class="badge ${cls}" title="${esc(trustTip(r0))}">Trust ${t.toFixed(0)}% (${lvl})</span>`;
  }
  /* ---- Quantile risk: Volatility Index = (high case - low case) / most likely ---- */
  const volIdx = (lo, mid, hi) => (finite(lo) && finite(hi) && finite(mid) && mid > 0 ? (hi - lo) / mid : null);
  const volLvl = (v) => (v == null ? ['n/a', ''] : v < 0.25 ? ['Stable', 'good'] : v < 0.5 ? ['Moderate', 'warn'] : ['Volatile', 'bad']);
  const guidance = (v) => (v == null ? 'Not enough history.' : v < 0.25 ? 'Guarantee at the floor and price at expected.' : v < 0.5 ? 'Guarantee only the floor; ask for make-goods above it.' : 'No guarantee. Buy at a discount or only as part of a package.');
  /** Table for the back of a flip card: floor (P10), expected (P50), ceiling (P90), volatility index and what to do about it. */
  function volTable(rows, label, vf) {
    const body = rows.filter((x) => x.vi != null).sort((a, b) => b.vi - a.vi).map((x) => { const [lv, cl] = volLvl(x.vi); return `<tr><td>${esc(x.name)}</td><td>${vf(x.lo)}</td><td>${vf(x.mid)}</td><td>${vf(x.hi)}</td><td><span class="badge ${cl}">${x.vi.toFixed(2)} ${lv}</span></td><td>${esc(guidance(x.vi))}</td></tr>`; }).join('');
    return `<h4>Negotiation guide</h4><p class="fb-how">Volatility Index = (high case − low case) ÷ most likely. Low case is the guaranteed floor (P10), most likely is the expected level (P50), high case is the upside ceiling (P90).</p>
      <div class="fb-scroll" style="margin-bottom:12px"><table class="dt-table"><thead><tr><th>${esc(label)}</th><th>Floor P10</th><th>Expected P50</th><th>Ceiling P90</th><th>Volatility</th><th>What to do</th></tr></thead><tbody>${body || '<tr><td colspan="6">Not enough history.</td></tr>'}</tbody></table></div>`;
  }
  const calendarTools = () => `<label class="row small" title="Show Poya days, salary windows and festivals on the charts"><input type="checkbox" data-pins ${PINS_ON ? 'checked' : ''}> Event pins</label><button class="btn sm" type="button" data-events>Major events${MAJOR.length ? ` (${MAJOR.length})` : ''}</button>`;
  function headCard(title, sub, r, extra = '') {
    const rel = r && r.reliability;
    return `<div class="card glow" style="margin-bottom:16px"><div class="card-head" style="margin:0"><div><div class="eyebrow"><span class="fc-pill">Forecast</span> Estimates of what is likely, not recorded data</div><h2 style="margin-top:4px">${esc(title)}</h2><div class="sub">${esc(sub)}</div></div>
      <div class="row">${extra}${calendarTools()}${r ? trustBadge([r]) : ''}${rel ? `<span class="badge ${relCls[rel.level]}" title="${esc(rel.reasons.join(' '))}">Reliability: ${rel.level}</span>` : ''}<button class="btn sm" type="button" data-rerun>Re-run</button></div></div></div>`;
  }
  const kpiTile = (label, value, sub, help, cls = '') => `<div class="kpi fc ${cls}"><span class="fc-pill tile">Forecast</span><div class="k-lbl">${esc(label)} ${help || ''}</div><div class="k-val">${value}</div>${sub ? `<div class="k-sub">${sub}</div>` : ''}</div>`;

  /* ---------------- chart plugins ---------------- */
  const nowLine = C.nowLine;
  const zonePlugin = { id: 'zone', beforeDatasetsDraw(chart, a, o) {
    if (!o || o.x == null || o.y == null) return;
    const { ctx, chartArea: ar, scales: { x, y } } = chart;
    const x0 = Math.max(ar.left, x.getPixelForValue(o.x)), y0 = Math.min(ar.bottom, y.getPixelForValue(o.y));
    ctx.save(); ctx.fillStyle = 'rgba(34,245,166,.09)'; ctx.strokeStyle = 'rgba(34,245,166,.55)'; ctx.setLineDash([5, 4]);
    ctx.fillRect(x0, y0, ar.right - x0, ar.bottom - y0); ctx.strokeRect(x0, y0, ar.right - x0, ar.bottom - y0);
    ctx.setLineDash([]); ctx.fillStyle = C.css('--good') || '#22f5a6'; ctx.font = '700 11px ' + (C.css('--display') || 'sans-serif'); ctx.fillText('OPTIMAL BUYING ZONE', x0 + 8, ar.bottom - 10); ctx.restore(); } };

  /** History (solid) + forecast most likely (dashed) + low case-high case ribbon. */
  function fan(id, r, H, { color = C.PALETTE[0], histDays = HIST, vf = f2, afterBody, lowLabel = 'Low case' } = {}) {
    const f = slice(r, H), hd = r.history.dates.slice(-histDays), hv = r.history.values.slice(-histDays), nh = hd.length;
    const labels = hd.concat(f.dates), pad = (a) => Array(nh - 1).fill(null).concat([hv[nh - 1]], a);
    const bt = r.backtest, hold = bt ? Math.min(bt.holdout, nh) : 0;
    const back = bt ? Array(nh - hold).fill(null).concat(bt.pred.slice(-hold), Array(f.dates.length).fill(null)) : null;
    const ch = C.make(id, { type: 'line', data: { labels, datasets: [
      { label: 'High case', data: pad(f.p90), borderColor: 'transparent', backgroundColor: color + '2e', fill: '+1', pointRadius: 0 },
      { label: lowLabel, data: pad(f.p10), borderColor: color + '88', borderWidth: 1, borderDash: [2, 3], fill: false, pointRadius: 0 },
      { label: 'Most likely forecast', data: pad(f.p50), borderColor: color, borderDash: [7, 5], borderWidth: 2.5, pointRadius: 0, tension: 0.3 },
      { label: 'Actual', data: hv.concat(Array(f.dates.length).fill(null)), borderColor: C.css('--text') || '#e8eeff', borderWidth: 2, pointRadius: 0, tension: 0.25 }]
      .concat(back ? [{ label: 'Backtest: what the engine would have said', data: back, borderColor: C.css('--warn') || '#ffb547', borderDash: [3, 3], borderWidth: 2, pointRadius: 3, pointBackgroundColor: C.css('--warn') || '#ffb547', tension: 0.2, hidden: true }] : []) },
      options: { interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom', labels: { filter: (i) => i.text !== 'High case' } }, nowLine: { index: nh - 1 }, eventPins: eventOpt(labels),
        tooltip: { callbacks: { title: C.fcTitle(nh), label: (c) => (c.parsed.y == null ? null : `${c.dataset.label}: ${vf(c.parsed.y)}`), afterBody: afterBody ? (items) => afterBody(items[0].dataIndex - nh) : undefined } } },
        scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } }, y: { beginAtZero: false, ticks: { callback: (v) => vf(v) } } } },
      plugins: [nowLine] });
    return { ch, f, nh };
  }


  /* ---------------- New Programme Estimator ---------------- */
  function wireColdStart(p, filters, pc) {
    const host = $('#np-card', p); if (!host) return;
    const chs = pc.channels || [], cats = pc.categories || [], DAYN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    host.innerHTML = `<div class="card-head"><div><h3><span class="fc-pill">Estimate</span> New Programme Estimator</h3><div class="sub">For a show with no history. The first 4 weeks are estimated from the slot, the lead-in, how loyal rival audiences are and how earlier launches of the same category grew.</div></div></div>
      <div class="np-form"><label class="field"><span class="small muted">Target channel</span><select id="np-ch">${chs.map((c) => `<option value="${esc(c)}">${esc(fmt.title(c))}</option>`).join('')}</select></label>
        <div class="field"><span class="small muted">Day(s)</span><div class="np-days">${DAYN.map((d, i) => `<label><input type="checkbox" class="np-day" value="${i}" checked> ${d}</label>`).join('')}</div></div>
        <label class="field"><span class="small muted">Start</span><input type="time" id="np-st" value="20:30"></label><label class="field"><span class="small muted">End</span><input type="time" id="np-en" value="21:00"></label>
        <label class="field"><span class="small muted">Category</span><select id="np-cat">${cats.map((c) => `<option>${esc(c)}</option>`).join('')}</select></label>
        <button class="btn primary" type="button" id="np-go">Estimate launch</button></div><div id="np-out" style="margin-top:16px"></div>`;
    $('#np-go', host).onclick = async () => {
      const out = $('#np-out', host), req = { channel: $('#np-ch', host).value, days: [...host.querySelectorAll('.np-day:checked')].map((x) => +x.value), start: $('#np-st', host).value, end: $('#np-en', host).value, category: $('#np-cat', host).value };
      if (!req.days.length) { out.innerHTML = App.emptyState('Pick at least one day', ''); return; }
      out.innerHTML = App.skeleton(1);
      let r; try { r = await App.data.coldStart({ filters, request: req }); } catch (e) { out.innerHTML = App.emptyState('The estimate could not run', e.message); return; }
      if (!r.ok) { out.innerHTML = App.emptyState('No estimate yet', r.message); return; }
      renderCold(out, r);
    };
  }
  function renderCold(out, r) {
    const v = r.verdict, b = r.baseline, wkTxt = ['Week 1', 'Week 2', 'Week 3', 'Week 4'], pc1 = (x) => (x == null ? 'n/a' : (x * 100).toFixed(0) + '%');
    const loser = v.biggest_loser;
    const ev = [`Expected launch TVR is ${f2(v.p50)}, with a safe floor of ${f2(v.p10)} and an upside of ${f2(v.p90)} (average of the first 4 weeks).`,
      r.strongest_rival ? `${fmt.title(r.strongest_rival.channel)} has the most loyal audience in this slot (loyalty ${pc1(r.strongest_rival.loyalty)}), so the upside is capped at x${r.cap_factor.toFixed(2)} of the expected level.` : null,
      loser ? `${fmt.title(loser)} has the most audience to lose here (about ${f2(v.loser_share)} TVR points can be won from it).` : 'No rival slot shows an audience that is easy to win.',
      { rec: true, text: `Sell sponsorship on the floor of ${f2(v.p10)}. Re-price after week 2 if the show beats ${f2(r.weeks[1].p50)}.` }, ...r.notes];
    out.innerHTML = `<div class="kpis">${kpiTile('Expected launch TVR (P50)', f2(v.p50), `Upside ${f2(v.p90)} (P90)`, App.help('The median level over the first 4 weeks, from the slot baseline, lead-in and the category launch curve.', 'What to plan on.'))}
      ${kpiTile('Safe guaranteed floor (P10)', f2(v.p10), 'Use this for sponsorship price negotiation', App.help('A low case for the first 4 weeks: about 9 launches in 10 should do at least this.', 'A number you can guarantee a sponsor.'))}
      ${kpiTile('Audience most likely to be won from', loser ? esc(fmt.title(loser)) : 'none', loser ? `About ${f2(v.loser_share)} TVR points` : 'Rivals are loyal here', App.help('Rival channels with low stickiness, short viewing time or a falling trend in this slot have audience that can be won.', 'Where your promotion should be aimed.'))}</div>
      <div style="margin-top:16px">${C.box('pt-cold', 'Launch trajectory: first 4 weeks', 'Floor, expected and ceiling for each week of the launch.', { pill: 'Estimate', ev: true, help: ['Week by week: the slot baseline times the category launch curve, plus audience that is easy to win from rivals, with a range set by how steady the slot has been and how uncertain launches are. The ceiling is capped by the strongest rival\'s loyalty.', 'A launch plan and a sponsorship floor for a show with no history.'] })}</div>
      <div class="grid g3 np-signals" style="margin-top:16px">
        <div class="card"><h3>1. Slot and lead-in</h3><div class="small">Slot TVR (last 8 weeks): <b>${b.slot_tvr != null ? f2(b.slot_tvr) : 'none'}</b> (${b.slot_airings} airings)<br>Lead-in: <b>${esc(b.lead_in || 'none found')}</b>${b.lead_in_tvr != null ? ` at ${f2(b.lead_in_tvr)}` : ''}<br>Hand-over: the next show keeps <b>${pc1(b.retention)}</b> of it<br>Baseline used: <b>${f2(b.estimate)}</b><div class="muted">Based on ${esc(b.basis)}.</div></div></div>
        <div class="card"><h3>2. Rival loyalty in this slot</h3><div class="fb-scroll"><table class="dt-table"><thead><tr><th>Channel</th><th>TVR</th><th>TVR per reach</th><th>Stays tuned</th><th>Loyalty</th><th></th></tr></thead><tbody>${r.rivals.map((x) => `<tr><td>${esc(fmt.title(x.channel))}</td><td>${f2(x.tvr)}</td><td>${x.stickiness != null ? f2(x.stickiness) : 'n/a'}</td><td>${pc1(x.retention)}</td><td>${pc1(x.loyalty)}</td><td>${x.zapping ? '<span class="badge bad">Zapping</span>' : '<span class="badge good">Loyal</span>'}</td></tr>`).join('') || '<tr><td colspan="6">No rival airs in this slot.</td></tr>'}</tbody></table></div></div>
        <div class="card"><h3>3. Category launch curve</h3><div class="small">${r.curve.weeks.map((x, k) => `${wkTxt[k]}: <b>${(x * 100).toFixed(0)}%</b>`).join('<br>')}<div class="muted" style="margin-top:6px">From ${r.curve.launches} earlier launch${r.curve.launches === 1 ? '' : 'es'}: ${esc(r.curve.basis)}${r.curve.titles.length ? ` (${esc(r.curve.titles.slice(0, 3).join(', '))})` : ''}.</div></div></div></div>`;
    out.querySelectorAll('.kpi .fc-pill').forEach((t) => { t.textContent = 'Estimate'; });
    const labels = wkTxt;
    C.make('pt-cold', { type: 'line', data: { labels, datasets: [
      { label: 'Ceiling (high case)', data: r.weeks.map((w) => w.p90), borderColor: 'transparent', backgroundColor: C.PALETTE[0] + '2e', fill: '+1', pointRadius: 0 },
      { label: 'Safe floor (low case)', data: r.weeks.map((w) => w.p10), borderColor: C.PALETTE[0] + '99', borderDash: [3, 3], pointRadius: 4, fill: false },
      { label: 'Expected (most likely)', data: r.weeks.map((w) => w.p50), borderColor: C.PALETTE[0], borderWidth: 3, pointRadius: 5, tension: 0.25 }] },
      options: { interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom', labels: { filter: (i) => i.text !== 'Ceiling (high case)' } }, tooltip: { callbacks: { title: (it) => `${it[0].label}  ·  ESTIMATE`, label: (c) => `${c.dataset.label}: ${f2(c.parsed.y)}` } } }, scales: { y: { beginAtZero: true, title: { display: true, text: 'TVR' } }, x: { grid: { display: false } } } } });
    C.setBack('pt-cold', () => `<h4>Weekly numbers</h4><table class="dt-table"><thead><tr><th>Week</th><th>Floor P10</th><th>Expected P50</th><th>Ceiling P90</th><th>Launch curve</th></tr></thead><tbody>${r.weeks.map((w) => `<tr><td>${w.week}</td><td>${f2(w.p10)}</td><td>${f2(w.p50)}</td><td>${f2(w.p90)}</td><td>${(w.curve * 100).toFixed(0)}%</td></tr>`).join('')}</tbody></table>
      <p class="fb-how">Baseline ${f2(b.estimate)} (${esc(b.basis)}) × launch curve, plus up to ${f2(r.uplift)} TVR points won from rivals with weak loyalty. Ceiling capped at x${r.cap_factor.toFixed(2)} by the strongest rival's loyalty. This is an estimate from patterns in your sheet, not a forecast from this programme's own history.</p>`);
    C.evidence('pt-cold', ev, 'Estimate');
  }

  /* ================================================================ TVR & Audience */
  async function tvrTab(p, ctx) {
    if (!ctx.has('tv')) return needData(p, 'TVR sheet');
    const filters = ctx.filtersFor('tv');
    const M = ctx.mode() === 'monthly', NM = ctx.months(), H = M ? NM * 30 : ctx.horizon();
    MAJOR = readEvents();
    const key = 'tv|' + (M ? 'm' : 'd') + '|' + ctx.status.tv.sig + '|' + JSON.stringify(filters) + '|' + JSON.stringify(MAJOR);
    const prog = cache.has(key) ? null : scanning(p, 'Forecasting audience behaviour');
    let pr;
    try { pr = await getPrediction(key, () => App.data.predictTvr({ filters, mode: M ? 'monthly' : 'daily' }), 'tv', prog || (() => {})); }
    catch (e) { p.innerHTML = App.emptyState('The TVR prediction could not run', e.message) + '<div style="text-align:center"><button class="btn" data-rerun>Try again</button></div>'; wireRerun(p, key, () => tvrTab(p, ctx)); return; }
    finally { if (prog) App.loader.hide(250); }
    if (!p.isConnected) return;
    const R = pr.results, pc = pr.payload.ctx;
    const w = W(M), SPAN = M ? `${NM} month${NM === 1 ? '' : 's'}` : `${H} days`, NOW = M ? 3 : 28, NP = M ? NM : H, NB = M ? 6 : 28, BACK = M ? 24 : 28;
    const pname = (n) => String(n).split(' | ').slice(0, 3).join(', ');
    HIST = M ? 24 : 56;
    const evid = (id, items) => C.evidence(id, (items || []).map((x) => (typeof x === 'string' ? w(x) : x && x.text ? { ...x, text: w(x.text) } : x)), "Planner's Evidence (forecast)", { note: 'These figures are forecasts: estimates of what is likely, not recorded data.' });
    const tot = one(R, 'tvr_total');
    if (!tot) { p.innerHTML = App.emptyState('Not enough TVR history to forecast', (pr.payload.notes || [])[0] || 'Widen the filters.'); return; }
    const reach = one(R, 'reach_total'), cats = group(R, 'cat_share'), hours = group(R, 'hour_share'), chans = group(R, 'channel_tvr'), progs = group(R, 'program_tvr');
    const fT = slice(tot, H), recentT = MR.recentMean(tot, NOW);
    await loadPins(tot.history.dates.slice(-HIST), fT.dates);
    const pTVR = avg(fT.p50), gTVR = avg(fT.p10), upTVR = avg(fT.p90);
    const catRows = cats.map((r) => { const f = slice(r, H); return { name: r.entity, now: MR.recentMean(r, NOW), next: avg(f.p50) }; }).map((x) => ({ ...x, shift: finite(x.next) && finite(x.now) ? x.next - x.now : null }));
    const growing = catRows.filter((x) => finite(x.shift)).sort((a, b) => b.shift - a.shift);
    const spotsPerDay = Math.max(1, +App.store.get('spots-per-day', 5));
    const fR = reach ? slice(reach, H) : null;
    p.innerHTML = w(`${headCard('TVR & Audience Forecast', `Next ${SPAN} from ${pc.date_max}, ${fmt.num(pc.rows)} airings in scope. History ${tot.n_points} ${M ? 'months' : 'days'}.`, tot,
        `<label class="row small" title="Used for the guaranteed GRP tooltip">Spots per day <input type="number" min="1" max="200" value="${spotsPerDay}" id="spd" style="width:72px"></label>`)}
      ${forecastKey(M)}${M ? monthNote(pc) : ''}${(pr.payload.notes || []).filter((n) => !/interpolation/.test(n)).map((n) => `<div class="banner info"><span>${esc(n)}</span></div>`).join('')}
      <div class="kpis">
        ${kpiTile('Projected average TVR', f2(pTVR), `${signed(pct(pTVR, recentT), 1)} vs last 4 weeks (${f2(recentT)})`, App.help('Mean of the daily most likely forecast of the average programme TVR over the horizon.', 'The audience level to plan on for an average airing.'))}
        ${kpiTile('Guaranteed minimum TVR (low case)', f2(gTVR), `9 in 10 days should land above this. Upside high case ${f2(upTVR)}`, App.help('Mean of the daily low case estimate: the forecast engine expects actuals to fall below it only about 10% of the time.', 'A safe number for audience guarantees and GRP commitments.'))}
        ${kpiTile('Projected reach %', fR ? fmt.pct(avg(fR.p50), 1) : 'n/a', fR ? `Range ${fmt.pct(avg(fR.p10), 1)} to ${fmt.pct(avg(fR.p90), 1)}` : 'Reach % is not in the sheet', App.help('Mean of the daily most likely forecast of average Reach % per airing.', 'How much of the audience an average airing is expected to touch.'))}
        ${kpiTile('Top growing category', growing[0] ? esc(growing[0].name) : 'n/a', growing[0] ? `${growing[0].shift >= 0 ? '+' : ''}${f1(growing[0].shift)} pts of TVR share` : '', App.help('Each category\'s share of total TVR is forecast; the one gaining the most share points versus the last 4 weeks is shown.', 'Where audience attention is moving, for content and programme selection.'))}
      </div>
      <div class="pb-head"><h2>Planner's Action Playbook</h2><span class="muted small">From the TVR sheet alone. No other file needed.</span></div>
      <div class="sl-grid" id="pb-tvr"></div>
      ${svNav('tvr', [['playbook', 'Playbook details', 'Which slots do I act on?'], ['plan', 'Next month plan', 'What do I buy?'], ['channels', 'Channel share', 'Who will win audience?'], ['programmes', 'Programmes', 'Which shows will deliver?'], ['when', 'When and who', 'Which hours and genres?']])}
      <section class="sv" data-sv="playbook"${svHide('tvr', 'playbook')}>
        <div class="grid g2">
          ${C.box('pt-sticky', 'Loyal audience or zapping?', 'Each dot is a programme slot. Right and high is a big, loyal audience. Right and low is reach that zaps away.', { tall: true, ev: true,
            help: ['Forecast TVR and forecast Reach % are compared for every programme slot. TVR per point of reach shows how much of the audience that tuned in stayed to watch. Average viewing time is added when the sheet has it.', 'Buy loyal slots for message delivery. Be careful with high-reach, low-TVR slots: people sample them and leave.'] })}
          ${C.box('pt-decay', 'Slots losing audience', 'Change in expected TVR against the last 4 weeks. Red means a drop of more than 15%.', { tall: true, ev: true,
            help: ['Each programme slot is forecast. The next 14 days and the next 30 days are compared with its average of the last 4 weeks. Slots with a drop above 15%, or a very wide low-to-high range, are flagged.', 'Move spots out of fading or unpredictable slots before you commit money.'] })}
        </div>
        <div style="margin-top:16px">${C.box('pt-sweet', 'Sweet-spot hours', 'Off-peak and shoulder hours forecast to hold above-average audience share.', { tall: true, ev: true,
          help: ['Every start hour is forecast. Peak hours are the busiest quarter of hours by audience. Off-peak hours that still hold above-average forecast share, and are not falling, are the sweet spots.', 'Hours where advertiser demand is lower than prime time but the audience is still there.'] })}</div>
      </section>
      <section class="sv" data-sv="plan"${svHide('tvr', 'plan')}>
        <div class="sl-grid" id="sl-tvr"></div>
        <div style="margin-top:16px">${C.box('pt-fan', 'Total audience: history and forecast', 'Solid is actual. Dashed is the forecast. Click any point for the numbers.', { xtall: true, ev: true,
          help: ['The forecast engine reads up to 1,024 days of the daily average TVR and outputs estimates for each future day, adjusted for weekday and Sri Lankan holiday and Poya day effects. Low case and high case bound the range it expects 8 days in 10.', 'A defensible audience plan: most likely for the expected delivery, low case for guarantees.'] })}</div>
      </section>
      <section class="sv" data-sv="channels"${svHide('tvr', 'channels')}>
        ${C.box('pt-chtraj', 'Channel share path', 'Each line is a channel\'s share of all TVR. Dashed is the forecast.', { xtall: true, ev: true,
          help: ['Each channel\'s share of total TVR is forecast month by month (or day by day) and drawn after the recorded history.', 'See who is rising and who is fading before rate cards change.'] })}
        <div class="grid g2" style="margin-top:16px">
          ${C.box('pt-chshare', 'Share now vs next', 'Grey is now. Colour is the forecast.', { tall: true, ev: true,
            help: ['Bars compare the forecast share with the recent share; the change in share points is written beside each channel.', 'Which stations are winning or losing audience share.'] })}
          ${C.box('pt-chdp', 'Best channel and daypart', `Average TVR each channel delivers in each daypart`, { html: '', ev: true,
            help: ['Each channel and daypart pair is forecast separately and averaged over the horizon. Brighter cells mean higher expected ratings.', 'Where to buy: the strongest channel and daypart combinations.'] })}
        </div>
      </section>
      <section class="sv" data-sv="programmes"${svHide('tvr', 'programmes')}>
        ${C.box('pt-prog', 'Programme league: expected TVR', 'Bar start is the low case, the colour change is the most likely value, the end is the high case.', { xtall: true, ev: true,
          help: ['Each recurring programme slot (same programme, channel, weekday and start) is forecast. The bar runs from the low case to the high case and the colour changes at the most likely value.', 'Pick programmes that deliver the most audience with a tight range.'] })}
        <div style="margin-top:16px">${C.box('pt-risk', 'Safe or risky?', 'Right and low is the safest bet.', { ev: true,
          help: ['X is the expected TVR, Y is the Volatility Index: (high case - low case) divided by most likely. Low and to the right is a safe bet.', 'Separate dependable programmes for guarantees from volatile ones to buy only at a discount. Flip the card for a negotiation guide.'] })}</div>
        <div class="card" style="margin-top:16px" id="np-card"></div>
      </section>
      <section class="sv" data-sv="when"${svHide('tvr', 'when')}>
        <div class="grid g2">
          ${C.box('pt-heat', M ? 'Best hour by month' : 'Best hour by weekday', `Forecast ${pc.heat_metric === 'share' ? 'TVR share %' : 'average TVR'}`, { html: '', ev: true,
            help: [M ? 'One series per start hour is forecast month by month.' : 'One series per start hour is forecast; each forecast day is placed in its weekday column and averaged.', 'The strongest hour and day combinations to book, and weak belts to avoid.'] })}
          ${C.box('pt-cat', 'Genres gaining or losing audience', 'Grey is now. Colour is the forecast.', { tall: true, ev: true,
            help: ['Each category\'s share of total TVR is forecast separately. Bars compare the forecast share with the recent share.', 'Which genres are gaining or losing audience, to steer programme and sponsorship choices.'] })}
        </div>
        ${fR ? `<div style="margin-top:16px">${C.box('pt-reach', 'Reach outlook', 'Average Reach % per airing', { ev: true, help: ['The same forecast applied to the daily average Reach %.', 'Expected breadth of audience per airing, useful for reach-led campaigns.'] })}</div>` : ''}
      </section>`);
    wireRerun(p, key, () => tvrTab(p, ctx));
    wireCalendar(p, () => tvrTab(p, ctx));
    wireSv(p, 'tvr');
    wireColdStart(p, filters, pc);
    p.querySelectorAll('[data-open-sv]').forEach((b) => { b.onclick = () => { const t = p.querySelector(`[data-svb="${b.dataset.openSv}"]`); if (t) t.click(); }; });
    markForecast(p, { R, H, M });
    p.querySelectorAll('[data-intro]').forEach((b) => { b.onclick = () => App.loadIntro().then(() => App.intro.open(true)); });
    const spd = $('#spd', p); spd.onchange = () => { App.store.set('spots-per-day', Math.max(1, +spd.value || 1)); tvrTab(p, ctx); };
    const ev = {};

    // 1. fan chart with guaranteed GRP tooltip
    fan('pt-fan', tot, H, { lowLabel: 'Low case (safe floor)', afterBody: (k) => {
      if (k < 0 || k >= fT.dates.length) return [];
      const g = fT.p10[k] * spotsPerDay, e = fT.p50[k] * spotsPerDay, risk = fT.p50[k] > 0 ? ((fT.p50[k] - fT.p10[k]) / fT.p50[k]) * 100 : 0;
      return ['', `Guaranteed GRPs (${spotsPerDay} spots, low case): ${f1(g)}`, `Expected GRPs (most likely): ${f1(e)}`, `Shortfall risk if sold on most likely: up to ${risk.toFixed(0)}%`];
    } });
    const riskPct = pTVR > 0 ? ((pTVR - gTVR) / pTVR) * 100 : null;
    ev.fan = [
      `Average TVR is expected at ${f2(pTVR)} over the next ${SPAN} (low-case floor ${f2(gTVR)}, high-case upside ${f2(upTVR)}), ${signed(pct(pTVR, recentT), 1)} versus the last 4 weeks.`,
      `For ${spotsPerDay} spots a day that is about ${f1(gTVR * spotsPerDay)} guaranteed GRPs a day (low case) and ${f1(pTVR * spotsPerDay)} expected (most likely).`,
      tot.reliability ? `Forecast reliability is ${tot.reliability.level}${tot.backtest && tot.backtest.model.smape != null ? `; in the last ${tot.backtest.holdout} ${M ? 'months' : 'days'} the model was off by ${f1(tot.backtest.model.smape)}% on average` : ''}.` : null,
      { rec: true, text: riskPct != null && riskPct > 30 ? `The range is wide (up to ${riskPct.toFixed(0)}% below most likely on weak days). Sell audience guarantees on the low case value, or spread spots across more programmes.` : `The range is tight. Guarantees can be set close to most likely with a small buffer (about ${(riskPct || 0).toFixed(0)}%).` },
    ];
    (tot.peaks && tot.peaks.peaks || []).slice(0, 2).forEach((pk) => { if (pk.date <= fT.dates[fT.dates.length - 1]) ev.fan.push({ rec: true, text: `Audience peak expected around ${pk.date}; have spots live by ${pk.launch_by}.` }); });
    evid('pt-fan', ev.fan);

    // 2. heatmap day x hour
    const hm = M ? MR.monthHourMatrix(hours, NM) : MR.dowHourMatrix(hours, H);
    const isShare = pc.heat_metric === 'share';
    $('#pt-heat').innerHTML = hm.cols.length ? C.heat(hm, { fmt: isShare ? (v) => fmt.num(v, 1) : f2, caption: M ? 'Forecast by month and hour' : 'Forecast by weekday and hour' }) : App.emptyState('No start times in the sheet', 'The Start column is needed for this view.');
    const cells = []; hm.values.forEach((row, i) => row.forEach((v, j) => { if (finite(v)) cells.push({ d: hm.rows[i], h: hm.cols[j], v }); }));
    cells.sort((a, b) => b.v - a.v);
    const hl = (c) => `${c.d} ${c.h}`;   // weekday or month, plus hour
    ev.heat = cells.length ? [
      `Strongest forecast slots: ${cells.slice(0, 3).map((c) => `${hl(c)} (${isShare ? fmt.num(c.v, 1) + '%' : f2(c.v)})`).join(', ')}.`,
      `Weakest: ${cells.slice(-3).reverse().map((c) => `${hl(c)} (${isShare ? fmt.num(c.v, 1) + '%' : f2(c.v)})`).join(', ')}.`,
      { rec: true, text: `Prioritise ${cells.slice(0, 2).map(hl).join(' and ')} for reach-critical spots; buy the weakest belts only for frequency at low cost.` },
      !M && H < 7 ? 'The horizon is under a week, so some weekdays are empty. Pick 7 days or more to fill the grid.' : null,
    ] : [];
    evid('pt-heat', ev.heat);

    // 3. category audience share (bars)
    {
      const rows = shareRows(cats, H, NOW);
      if (rows.length) {
        shareBars('pt-cat', rows, { nowLabel: w('Last 4 weeks'), nextLabel: `Next ${SPAN}` });
        const up = rows.slice().sort((a, b) => b.chg - a.chg), dn = up.slice().reverse();
        ev.cat = [
          up[0] && up[0].chg > 0 ? `${up[0].name} gains the most: ${fmt.num(up[0].now, 1)}% to ${fmt.num(up[0].next, 1)}% of all TVR (${signed(up[0].chg, 1).replace('%', '')} pts).` : 'No category gains share.',
          dn[0] && dn[0].chg < 0 ? `${dn[0].name} loses the most: ${fmt.num(dn[0].now, 1)}% to ${fmt.num(dn[0].next, 1)}% (${signed(dn[0].chg, 1).replace('%', '')} pts).` : null,
          { rec: true, text: up[0] && up[0].chg > 0.3 ? `Lean into ${up[0].name} programmes for the next ${SPAN}; review spend in ${dn[0] && dn[0].chg < 0 ? dn[0].name : 'declining genres'}.` : 'Genre shares are stable; keep the current genre mix.' },
        ];
      } else ev.cat = ['Not enough category history to forecast shares.'];
      evid('pt-cat', ev.cat);
    }

    // 5. programme risk map: Volatility Index
    const pts = progs.map((r) => { const f = slice(r, H); const m = avg(f.p50), lo = avg(f.p10), hi = avg(f.p90); return { name: r.entity, x: m, y: volIdx(lo, m, hi), lo, hi }; }).filter((q) => finite(q.x) && finite(q.y));
    if (pts.length) {
      const mx = MR.pmedian(pts.map((q) => q.x)), my = MR.pmedian(pts.map((q) => q.y));
      C.make('pt-risk', { type: 'scatter', data: { datasets: [{ label: 'Programme slots', data: pts.map((q) => ({ x: q.x, y: q.y, q: { programme: pname(q.name), 'expected TVR': q.x, 'floor (low case)': q.lo, 'ceiling (high case)': q.hi, 'volatility index': q.y, advice: guidance(q.y) } })), pointRadius: 7, pointHoverRadius: 10,
        backgroundColor: pts.map((q) => (q.x >= mx && q.y <= my ? (C.css('--good') || '#22f5a6') : q.y > my * 1.3 ? (C.css('--bad') || '#ff5d7a') : C.PALETTE[1])) }] },
        options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => { const q = pts[c.dataIndex]; return [short(pname(q.name), 60), `Expected TVR ${f2(q.x)}, volatility index ${q.y.toFixed(2)}`, guidance(q.y)]; } } } },
          scales: { x: { title: { display: true, text: 'Expected TVR (most likely)' } }, y: { title: { display: true, text: 'Volatility Index = (high − low) ÷ most likely' }, ticks: { callback: (v) => v.toFixed(2) } } } } });
      const safe = pts.filter((q) => q.x >= mx && q.y <= my).sort((a, b) => b.x - a.x), risky = pts.filter((q) => q.y > my * 1.3).sort((a, b) => b.y - a.y);
      const nm = (q) => pname(q.name);
      ev.risk = [
        safe.length ? `Safe bets (high TVR, low volatility): ${safe.slice(0, 3).map((q) => `${nm(q)} (index ${q.y.toFixed(2)})`).join('; ')}.` : 'No slot is both above median TVR and below median volatility.',
        risky.length ? `Volatile: ${risky.slice(0, 2).map((q) => `${nm(q)} (index ${q.y.toFixed(2)})`).join('; ')}.` : null,
        { rec: true, text: safe.length ? `Anchor guarantees on ${nm(safe[0])}, sold at its floor of ${f2(safe[0].lo)}. Buy volatile slots only with make-goods or at a discount.` : 'Keep guarantees conservative across all slots.' },
      ];
      C.setBack('pt-risk', () => volTable(pts.map((q) => ({ name: pname(q.name), lo: q.lo, mid: q.x, hi: q.hi, vi: q.y })), 'Programme slot', f2));
    } else ev.risk = [M ? 'Not enough recurring programme history (a slot needs several months of airings).' : 'Not enough recurring programme history (a slot needs several weeks of airings).'];
    evid('pt-risk', ev.risk);

    // 5b. channel audience share + channel x daypart heatmap
    {
      C.setBack('pt-chshare', () => volTable(group(R, 'channel_tvr').map((r) => { const f = slice(r, H), m = avg(f.p50), lo = avg(f.p10), hi = avg(f.p90); return { name: fmt.title(r.entity), lo, mid: m, hi, vi: volIdx(lo, m, hi) }; }), 'Channel', f2));
      const rows = shareRows(group(R, 'channel_share'), H, NOW);
      if (rows.length) {
        shareBars('pt-chshare', rows, { nowLabel: w('Last 4 weeks'), nextLabel: `Next ${SPAN}`, title: fmt.title });
        const up = rows.slice().sort((a, b) => b.chg - a.chg), dn = up.slice().reverse(), lead = rows[0];
        ev.chshare = [
          `${fmt.title(lead.name)} is expected to hold the biggest audience share: ${fmt.num(lead.next, 1)}% of all TVR (now ${fmt.num(lead.now, 1)}%).`,
          up[0] && up[0].chg > 0.2 ? `Gaining share: ${up.filter((x) => x.chg > 0.2).slice(0, 3).map((x) => `${fmt.title(x.name)} (${signed(x.chg, 1).replace('%', '')} pts)`).join(', ')}.` : 'No channel is gaining share by more than 0.2 points.',
          dn[0] && dn[0].chg < -0.2 ? `Losing share: ${dn.filter((x) => x.chg < -0.2).slice(0, 3).map((x) => `${fmt.title(x.name)} (${signed(x.chg, 1).replace('%', '')} pts)`).join(', ')}.` : null,
          { rec: true, text: up[0] && up[0].chg > 0.2 ? `Negotiate volume on ${fmt.title(up[0].name)} now, before its rate card reflects the extra audience. Ask for make-goods on ${dn[0] && dn[0].chg < -0.2 ? fmt.title(dn[0].name) : 'weaker channels'}.` : 'Channel shares are steady; keep channel weights as they are.' },
        ];
      } else ev.chshare = ['Not enough channel history to forecast shares.'];
      evid('pt-chshare', ev.chshare);

      const cd = group(R, 'chan_daypart').map((r) => { const [ch, dp] = r.entity.split(' | '); return { ch, dp, v: avg(slice(r, H).p50), now: MR.recentMean(r, NOW) }; }).filter((x) => finite(x.v));
      if (cd.length) {
        const chs = [...new Set(cd.map((x) => x.ch))], order = MR.daypartOrder ? MR.daypartOrder() : [], dps = [...new Set(cd.map((x) => x.dp))].sort((a, b) => order.indexOf(a) - order.indexOf(b));
        const mat = { rows: chs.map(fmt.title), cols: dps, values: chs.map((c) => dps.map((d) => { const x = cd.find((q) => q.ch === c && q.dp === d); return x ? x.v : null; })) };
        $('#pt-chdp').innerHTML = C.heat(mat, { fmt: f2, caption: 'Forecast TVR by channel and daypart' });
        const sorted = cd.slice().sort((a, b) => b.v - a.v), rising = cd.filter((x) => finite(x.now) && x.now > 0).map((x) => ({ ...x, chg: pct(x.v, x.now) })).filter((x) => finite(x.chg)).sort((a, b) => b.chg - a.chg);
        ev.chdp = [
          `Strongest: ${sorted.slice(0, 3).map((x) => `${fmt.title(x.ch)} ${x.dp} (${f2(x.v)})`).join(', ')}.`,
          `Weakest: ${sorted.slice(-2).reverse().map((x) => `${fmt.title(x.ch)} ${x.dp} (${f2(x.v)})`).join(', ')}.`,
          rising[0] && rising[0].chg > 3 ? `Fastest rising: ${fmt.title(rising[0].ch)} ${rising[0].dp} (${signed(rising[0].chg, 0)} vs the last 4 weeks).` : null,
          { rec: true, text: `Book ${fmt.title(sorted[0].ch)} ${sorted[0].dp} for reach-critical spots; use ${fmt.title(sorted[sorted.length - 1].ch)} ${sorted[sorted.length - 1].dp} only for cheap frequency.` },
        ];
      } else { $('#pt-chdp').innerHTML = App.emptyState('Not enough start times', 'Channel and Start columns are needed for this view.'); ev.chdp = []; }
      evid('pt-chdp', ev.chdp);
    }

    // 6. reach
    if (fR) {
      fan('pt-reach', reach, H, { color: C.PALETTE[1], vf: (v) => fmt.pct(v, 2) });
      ev.reach = [`Average reach per airing is expected at ${fmt.pct(avg(fR.p50), 1)} (low case ${fmt.pct(avg(fR.p10), 1)}), ${signed(pct(avg(fR.p50), MR.recentMean(reach, NOW)), 1)} versus the last 4 weeks.`];
      evid('pt-reach', ev.reach);
    }

    // 5c. programme league (new) and channel share path (new), then the shortlist
    const progRows = progs.map((r) => { const f = slice(r, H); return { r, name: r.entity, nm: pname(r.entity), lo: avg(f.p10), mid: avg(f.p50), hi: avg(f.p90), now: MR.recentMean(r, NOW) }; })
      .filter((x) => finite(x.mid) && finite(x.lo) && finite(x.hi)).sort((a, b) => b.mid - a.mid).slice(0, 12);
    if (progRows.length) {
      const med = MR.pmedian(progRows.map((x) => (x.hi - x.lo) / (x.mid || 1)));
      C.make('pt-prog', { type: 'bar', data: { labels: progRows.map((x) => `${short(x.nm, 34)}  (${f2(x.mid)})`), datasets: [
        { label: 'Low case', data: progRows.map((x) => x.lo), backgroundColor: 'transparent', borderWidth: 0, stack: 's' },
        { label: 'Low to most likely', data: progRows.map((x) => x.mid - x.lo), backgroundColor: C.PALETTE[0] + 'cc', borderRadius: 0, stack: 's', barThickness: 14 },
        { label: 'Most likely to high', data: progRows.map((x) => x.hi - x.mid), backgroundColor: C.PALETTE[0] + '55', borderRadius: 0, stack: 's', barThickness: 14 }] },
        detailOnly: true, detail: (i) => { const x = progRows[i], bt = x.r.backtest; return `<div class="dt-kpis"><div class="dt-k"><span>Now (recent)</span><b>${f2(x.now)}</b></div><div class="dt-k"><span>Low case</span><b>${f2(x.lo)}</b></div><div class="dt-k"><span>Most likely</span><b>${f2(x.mid)}</b></div><div class="dt-k"><span>High case</span><b>${f2(x.hi)}</b></div><div class="dt-k"><span>Change vs now</span><b>${signed(pct(x.mid, x.now), 0)}</b></div><div class="dt-k"><span>Volatility index</span><b>${(volIdx(x.lo, x.mid, x.hi) ?? 0).toFixed(2)} ${volLvl(volIdx(x.lo, x.mid, x.hi))[0]}</b></div><div class="dt-k"><span>Reliability</span><b>${x.r.reliability ? x.r.reliability.level : 'n/a'}</b></div></div><div class="small muted">${esc(x.name)}${bt && bt.model && bt.model.smape != null ? ` In the last ${bt.holdout} periods the forecast was off by ${f1(bt.model.smape)}% on average.` : ''}</div>`; },
        options: { indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { filter: (i) => i.datasetIndex > 0, callbacks: { title: (it) => progRows[it[0].dataIndex].name, label: (c) => { const x = progRows[c.dataIndex]; return c.datasetIndex === 1 ? `Low case ${f2(x.lo)}, most likely ${f2(x.mid)}` : `High case ${f2(x.hi)}`; } } } },
          scales: { x: { stacked: true, beginAtZero: false, title: { display: true, text: 'Expected TVR' } }, y: { stacked: true, grid: { display: false }, ticks: { font: { size: 11 } } } } } });
      C.setBack('pt-prog', () => volTable(progRows.map((x) => ({ name: x.nm, lo: x.lo, mid: x.mid, hi: x.hi, vi: volIdx(x.lo, x.mid, x.hi) })), 'Programme slot', f2));
      const best = progRows[0], tight = progRows.filter((x) => (x.hi - x.lo) / (x.mid || 1) <= med).sort((a, b) => b.mid - a.mid)[0], rise = progRows.map((x) => ({ ...x, chg: pct(x.mid, x.now) })).filter((x) => finite(x.chg)).sort((a, b) => b.chg - a.chg)[0];
      ev.prog = [`${best.nm} is expected to deliver the most audience: TVR ${f2(best.mid)} (range ${f2(best.lo)} to ${f2(best.hi)}).`,
        rise && rise.chg > 3 ? `Rising fastest: ${rise.nm} (${signed(rise.chg, 0)} vs now).` : null,
        { rec: true, text: tight ? `Anchor guarantees on ${tight.nm}: high audience with a tight range.` : `Lead with ${best.nm}.` }];
    } else ev.prog = ['Not enough recurring programme history.'];
    evid('pt-prog', ev.prog);

    const chRes = group(R, 'channel_share'), chRows = shareRows(chRes, H, NOW);
    if (chRes.length) {
      const top = chRows.slice(0, 5).map((x) => chRes.find((r) => r.entity === x.name)).filter(Boolean), r0 = top[0], fd = slice(r0, H).dates, hd = r0.history.dates.slice(-HIST), nh = hd.length, labels = hd.concat(fd), ds = [];
      top.forEach((r) => { const col = C.colorFor(r.entity), f = slice(r, H), hv = r.history.values.slice(-HIST);
        ds.push({ label: fmt.title(r.entity), data: hv.concat(Array(fd.length).fill(null)), borderColor: col, backgroundColor: col, borderWidth: 2, pointRadius: 0, tension: 0.25 });
        ds.push({ label: fmt.title(r.entity) + ' (forecast)', data: Array(nh - 1).fill(null).concat([hv[nh - 1]], f.p50), borderColor: col, borderDash: [6, 5], borderWidth: 2, pointRadius: 0, tension: 0.3 }); });
      C.make('pt-chtraj', { type: 'line', data: { labels, datasets: ds }, plugins: [nowLine], options: { interaction: { mode: 'index', intersect: false }, plugins: { nowLine: { index: nh - 1 }, eventPins: eventOpt(labels), legend: { position: 'bottom', labels: { filter: (i) => !/\(forecast\)$/.test(i.text) } },
        tooltip: { filter: (i) => i.parsed.y != null && !(i.dataIndex === nh - 1 && /\(forecast\)$/.test(i.dataset.label)), callbacks: { title: C.fcTitle(nh), label: (c) => `${c.dataset.label}: ${fmt.num(c.parsed.y, 1)}%` } } },
        scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } }, y: { ticks: { callback: (v) => v + '%' }, title: { display: true, text: 'Share of all TVR' } } } } });
      const up = chRows.slice().sort((a, b) => b.chg - a.chg), dn = up.slice().reverse();
      ev.chtraj = [`${fmt.title(chRows[0].name)} stays on top with ${fmt.num(chRows[0].next, 1)}% of all TVR.`, up[0].chg > 0.2 ? `${fmt.title(up[0].name)} gains the most (${signed(up[0].chg, 1).replace('%', '')} pts).` : null, dn[0].chg < -0.2 ? `${fmt.title(dn[0].name)} loses the most (${signed(dn[0].chg, 1).replace('%', '')} pts).` : null,
        { rec: true, text: up[0].chg > 0.2 ? `Buy volume on ${fmt.title(up[0].name)} early; ask ${fmt.title(dn[0].name)} for make-goods.` : 'Channel shares are steady. Keep your channel weights.' }];
    } else ev.chtraj = ['Not enough channel history to forecast shares.'];
    evid('pt-chtraj', ev.chtraj);

    const dRow = (o) => ({ forecast: true, ...o });
    shortlist($('#sl-tvr', p), [
      { title: 'Channels to hold', sub: `Share of all TVR, next ${SPAN}`, rows: chRows.slice(0, 4).map((x) => ({ label: fmt.title(x.name), value: `${fmt.num(x.next, 1)}%  ${x.chg >= 0 ? '+' : ''}${x.chg.toFixed(1)}`, tone: x.chg > 0.2 ? 'up' : x.chg < -0.2 ? 'down' : '',
          detail: dRow({ title: fmt.title(x.name), sub: 'Channel share of all TVR', rows: [['Now', fmt.num(x.now, 1) + '%'], ['Forecast', fmt.num(x.next, 1) + '%'], ['Change', (x.chg >= 0 ? '+' : '') + x.chg.toFixed(1) + ' pts']] }) })),
        todo: chRows.length && chRows[0].chg > 0.2 ? `Lock volume on ${fmt.title(chRows[0].name)} now.` : 'Keep your channel weights.' },
      { title: 'Programmes to buy', sub: `Highest expected TVR, next ${SPAN}`, rows: progRows.slice(0, 5).map((x) => ({ label: short(x.nm, 30), value: f2(x.mid),
          detail: dRow({ title: x.nm, sub: 'Programme slot', rows: [['Low case', f2(x.lo)], ['Most likely', f2(x.mid)], ['High case', f2(x.hi)], ['Now', f2(x.now)], ['Change vs now', signed(pct(x.mid, x.now), 0)]], extra: `<div class="small muted">${esc(x.name)}</div>` }) })),
        todo: progRows[0] ? `Lead with ${short(progRows[0].nm, 34)}.` : '' },
      { title: 'Audience is moving to', sub: `Genres and hours, next ${SPAN}`, rows: growing.slice(0, 3).map((x) => ({ label: x.name, value: `${x.shift >= 0 ? '+' : ''}${f1(x.shift)} pts`, tone: x.shift > 0 ? 'up' : 'down',
          detail: dRow({ title: x.name, sub: 'Genre share of all TVR', rows: [['Now', fmt.num(x.now, 1) + '%'], ['Forecast', fmt.num(x.next, 1) + '%'], ['Change', (x.shift >= 0 ? '+' : '') + f1(x.shift) + ' pts']] }) })).concat(cells.slice(0, 2).map((c) => ({ label: `Peak ${hl(c)}`, value: isShare ? fmt.num(c.v, 1) + '%' : f2(c.v),
          detail: dRow({ title: hl(c), sub: 'Strongest forecast slot', rows: [['Forecast', isShare ? fmt.num(c.v, 1) + '%' : f2(c.v)]] }) }))),
        todo: growing[0] && growing[0].shift > 0.3 ? `Lean into ${growing[0].name} programmes.` : 'Genre mix is steady.' }]);

    // 9. Planner's Action Playbook (TVR sheet only)
    {
      const PN = M ? 3 : 4, nearH = M ? 30 : 14, farH = M ? Math.max(H, 30) : 30;
      const reachBy = new Map(group(R, 'program_reach').map((r) => [r.entity, r])), timeBy = new Map(group(R, 'program_avgtime').map((r) => [r.entity, r]));
      const stats = progs.map((r) => {
        const f = slice(r, H), rr = reachBy.get(r.entity), tr = timeBy.get(r.entity), rec = MR.recentMean(r, PN);
        const tvrF = avg(f.p50), reachF = rr ? avg(slice(rr, H).p50) : null, atF = tr ? avg(slice(tr, H).p50) : null;
        return { r, name: r.entity, nm: pname(r.entity), tvrF, reachF, atF, ratio: finite(reachF) && reachF > 0 ? tvrF / reachF : null, rec,
          dNear: pct(avg(slice(r, nearH).p50), rec), dFar: pct(avg(slice(r, farH).p50), rec), width: tvrF > 0 ? (avg(f.p90) - avg(f.p10)) / tvrF * 100 : null };
      }).filter((x) => finite(x.tvrF));
      const qt = (a, q) => { const v = a.filter(finite).sort((x, y) => x - y); return v.length ? v[Math.min(v.length - 1, Math.floor(q * v.length))] : null; };
      // 1. loyal vs zapping
      const withR = stats.filter((x) => finite(x.ratio)), hiR = qt(withR.map((x) => x.ratio), 0.6), loR = qt(withR.map((x) => x.ratio), 0.4), medReach = qt(withR.map((x) => x.reachF), 0.5);
      withR.forEach((x) => { x.cls = x.ratio >= hiR ? 'Loyal audience' : (x.reachF >= medReach && x.ratio <= loR ? 'High zapping risk' : 'In between'); });
      if (withR.length >= 3) {
        const colr = { 'Loyal audience': C.css('--good') || '#22f5a6', 'High zapping risk': C.css('--bad') || '#ff5d7a', 'In between': C.PALETTE[1] };
        C.make('pt-sticky', { type: 'scatter', data: { datasets: Object.keys(colr).map((k) => ({ label: k, pointRadius: 7, pointHoverRadius: 10, backgroundColor: colr[k] + 'cc', borderColor: colr[k],
          data: withR.filter((x) => x.cls === k).map((x) => ({ x: x.reachF, y: x.tvrF, q: { programme: x.nm, class: x.cls, 'forecast TVR': x.tvrF, 'forecast reach %': x.reachF, 'TVR per reach point': x.ratio, 'avg time viewed': x.atF } })) })) },
          detailOnly: false, options: { plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c) => { const q = c.raw.q; return [short(q.programme, 60), `${q.class}: TVR ${f2(q['forecast TVR'])}, reach ${f2(q['forecast reach %'])}%`]; } } } },
            scales: { x: { title: { display: true, text: 'Forecast reach % (how many tuned in)' } }, y: { title: { display: true, text: 'Forecast TVR (how many watched)' } } } } });
        const loyal = withR.filter((x) => x.cls === 'Loyal audience').sort((a, b) => b.tvrF - a.tvrF), zap = withR.filter((x) => x.cls === 'High zapping risk').sort((a, b) => b.reachF - a.reachF);
        ev.sticky = [loyal.length ? `Loyal audience: ${loyal.slice(0, 3).map((x) => `${x.nm} (TVR ${f2(x.tvrF)} on ${f1(x.reachF)}% reach)`).join('; ')}.` : 'No slot stands out as especially loyal.',
          zap.length ? `Zapping risk: ${zap.slice(0, 3).map((x) => `${x.nm} (reach ${f1(x.reachF)}%, TVR only ${f2(x.tvrF)})`).join('; ')}.` : null,
          { rec: true, text: loyal.length ? `Put message-heavy and guaranteed spots in ${loyal[0].nm}.${zap.length ? ` Use ${zap[0].nm} only for cheap reach.` : ''}` : 'Spread spots; no clear loyal slot.' }];
      } else { const el = document.getElementById('pt-sticky'); if (el) el.closest('.chart-wrap').innerHTML = App.emptyState('Reach % is needed', 'The sheet needs the Reach % column and several recurring programmes.'); ev.sticky = []; }
      evid('pt-sticky', ev.sticky);
      // 2. slot decay and volatility
      const wideCut = Math.max(50, (qt(stats.map((x) => x.width), 0.5) || 0) * 1.5);
      stats.forEach((x) => { x.decline = (finite(x.dNear) && x.dNear <= -15) || (finite(x.dFar) && x.dFar <= -15); x.wide = finite(x.width) && x.width >= wideCut; });
      const dRows = stats.filter((x) => finite(x.dNear) || finite(x.dFar)).sort((a, b) => Math.min(a.dNear ?? 0, a.dFar ?? 0) - Math.min(b.dNear ?? 0, b.dFar ?? 0)).slice(0, 12);
      if (dRows.length) {
        const bad = C.css('--bad') || '#ff5d7a', ok = 'rgba(142,154,200,.55)', lbl = (x) => `${short(x.nm, 30)}${x.decline ? '  DECLINE' : ''}${x.wide ? '  VOLATILE' : ''}`;
        C.make('pt-decay', { type: 'bar', data: { labels: dRows.map(lbl), datasets: [
          { label: M ? 'First forecast month' : 'Next 14 days', data: dRows.map((x) => x.dNear), backgroundColor: dRows.map((x) => (finite(x.dNear) && x.dNear <= -15 ? bad + 'cc' : ok)), borderRadius: 4, barThickness: 9 },
          { label: M ? 'Whole horizon' : 'Next 30 days', data: dRows.map((x) => x.dFar), backgroundColor: dRows.map((x) => (finite(x.dFar) && x.dFar <= -15 ? bad : C.PALETTE[0] + '99')), borderRadius: 4, barThickness: 9 }] },
          detailOnly: true, detail: (i) => { const x = dRows[i]; return `<div class="dt-kpis"><div class="dt-k"><span>Last 4 weeks</span><b>${f2(x.rec)}</b></div><div class="dt-k"><span>Next ${M ? 'month' : '14 days'}</span><b>${signed(x.dNear, 0)}</b></div><div class="dt-k"><span>${M ? 'Whole horizon' : 'Next 30 days'}</span><b>${signed(x.dFar, 0)}</b></div><div class="dt-k"><span>Range width</span><b>${finite(x.width) ? x.width.toFixed(0) + '%' : 'n/a'}</b></div><div class="dt-k"><span>Verdict</span><b>${x.decline ? 'Shift out' : x.wide ? 'Unpredictable' : 'Hold'}</b></div></div><div class="small muted">${esc(x.name)}</div>`; },
          options: { indexAxis: 'y', plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { title: (it) => dRows[it[0].dataIndex].name, label: (c) => `${c.dataset.label}: ${signed(c.parsed.x, 0)}` } } },
            scales: { x: { ticks: { callback: (v) => v + '%' }, title: { display: true, text: 'Change in expected TVR vs the last 4 weeks' } }, y: { grid: { display: false }, ticks: { font: { size: 10 } } } } } });
      } else { const el = document.getElementById('pt-decay'); if (el) el.closest('.chart-wrap').innerHTML = App.emptyState('Not enough recurring programmes', 'A slot needs several weeks of airings.'); }
      const out = stats.filter((x) => x.decline).sort((a, b) => Math.min(a.dNear ?? 0, a.dFar ?? 0) - Math.min(b.dNear ?? 0, b.dFar ?? 0)), wide = stats.filter((x) => x.wide && !x.decline).sort((a, b) => b.width - a.width);
      ev.decay = [out.length ? `Structural decline (more than 15% below the last 4 weeks): ${out.slice(0, 3).map((x) => `${x.nm} (${signed(Math.min(x.dNear ?? 0, x.dFar ?? 0), 0)})`).join('; ')}.` : 'No slot is forecast to fall more than 15%.',
        wide.length ? `Very uncertain range: ${wide.slice(0, 2).map((x) => `${x.nm} (range ${x.width.toFixed(0)}% wide)`).join('; ')}.` : null,
        { rec: true, text: out.length ? `Shift spots out of ${out.slice(0, 2).map((x) => x.nm).join(' and ')} and into a loyal slot.` : (wide.length ? `Buy ${wide[0].nm} only with make-goods.` : 'Keep the current slot mix.') }];
      evid('pt-decay', ev.decay);
      // 3. daypart sweet spots
      const hr = group(R, 'hour_share').filter((r) => /^\d\d:00$/.test(r.entity)).map((r) => ({ h: r.entity, now: MR.recentMean(r, NOW), next: avg(slice(r, H).p50), level: (pc.hour_level || {})[r.entity] })).filter((x) => finite(x.next)).sort((a, b) => (a.h < b.h ? -1 : 1));
      if (hr.length >= 6) {
        const lv = hr.map((x) => x.level).filter(finite), peakCut = qt(lv, 0.75), meanNext = avg(hr.map((x) => x.next)), unit = pc.heat_metric === 'share' ? '% share' : ' TVR';
        hr.forEach((x) => { x.peak = finite(x.level) && x.level >= peakCut; x.sweet = !x.peak && x.next >= meanNext && (!finite(x.now) || x.next >= x.now * 0.98); });
        const good = C.css('--good') || '#22f5a6';
        C.make('pt-sweet', { type: 'bar', data: { labels: hr.map((x) => x.h), datasets: [{ label: 'Forecast ' + (pc.heat_metric === 'share' ? 'TVR share %' : 'TVR'), data: hr.map((x) => x.next), backgroundColor: hr.map((x) => (x.sweet ? good + 'dd' : x.peak ? 'rgba(142,154,200,.4)' : C.PALETTE[0] + '77')), borderRadius: 4 },
          { type: 'line', label: 'Average of all hours', data: hr.map(() => meanNext), borderColor: C.css('--warn') || '#ffb547', borderDash: [5, 4], pointRadius: 0, borderWidth: 2 }] },
          detailOnly: true, detail: (i) => { const x = hr[i]; return `<div class="dt-kpis"><div class="dt-k"><span>Forecast</span><b>${f2(x.next)}${unit}</b></div><div class="dt-k"><span>Recent</span><b>${f2(x.now)}${unit}</b></div><div class="dt-k"><span>Type</span><b>${x.sweet ? 'Sweet spot' : x.peak ? 'Peak hour' : 'Regular'}</b></div></div><div class="small muted">Peak hours are the busiest quarter of hours by audience. Off-peak hours are usually cheaper to buy.</div>`; },
          options: { plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${f2(c.parsed.y)}` } } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, title: { display: true, text: pc.heat_metric === 'share' ? 'Forecast TVR share %' : 'Forecast TVR' } } } } });
        const sw = hr.filter((x) => x.sweet).sort((a, b) => b.next - a.next);
        ev.sweet = [sw.length ? `Sweet-spot hours (off-peak, above-average, not falling): ${sw.slice(0, 4).map((x) => `${x.h} (${f2(x.next)}${unit})`).join(', ')}.` : 'No off-peak hour beats the all-hours average.',
          { rec: true, text: sw.length ? `Add frequency in ${sw.slice(0, 2).map((x) => x.h).join(' and ')} instead of paying peak rates.` : 'Stay in the strongest hours; the shoulders are weak.' }];
        stats.sweet = sw;
      } else { const el = document.getElementById('pt-sweet'); if (el) el.closest('.chart-wrap').innerHTML = App.emptyState('Start times are needed', 'The Start column is needed to forecast hours.'); ev.sweet = []; stats.sweet = []; }
      evid('pt-sweet', ev.sweet);
      const loyalL = withR.filter((x) => x.cls === 'Loyal audience').sort((a, b) => b.tvrF - a.tvrF), zapL = withR.filter((x) => x.cls === 'High zapping risk').sort((a, b) => b.reachF - a.reachF);
      const dt = (x, extra) => ({ title: x.nm, sub: 'Programme slot', rows: [['Forecast TVR', f2(x.tvrF)], ['Forecast reach %', finite(x.reachF) ? f2(x.reachF) : 'n/a'], ['TVR per reach point', finite(x.ratio) ? f2(x.ratio) : 'n/a'], ['Change vs last 4 weeks', signed(x.dNear ?? x.dFar, 0)]].concat(extra || []), extra: `<div class="small muted">${esc(x.name)}</div>` });
      shortlist($('#pb-tvr', p), [
        { title: 'Loyal audience', sub: 'High TVR for the reach they get', rows: loyalL.slice(0, 3).map((x) => ({ label: short(x.nm, 30), value: f2(x.tvrF), tone: 'up', detail: dt(x) })).concat(zapL.slice(0, 1).map((x) => ({ label: `Zaps: ${short(x.nm, 24)}`, value: `${f1(x.reachF)}% reach`, tone: 'down', detail: dt(x) }))), todo: loyalL[0] ? `Put your key message in ${short(loyalL[0].nm, 34)}.` : 'Needs Reach % in the sheet.' },
        { title: 'Shift spots out of', sub: 'Falling or unpredictable slots', rows: out.slice(0, 3).map((x) => ({ label: short(x.nm, 30), value: signed(Math.min(x.dNear ?? 0, x.dFar ?? 0), 0), tone: 'down', detail: dt(x) })).concat(wide.slice(0, 2).map((x) => ({ label: short(x.nm, 28), value: `±${(x.width / 2).toFixed(0)}% range`, detail: dt(x) }))), empty: 'No slot is forecast to fall by more than 15% or to be very unpredictable.', todo: out.length ? 'Move this weight to a loyal slot.' : 'No slot needs to be dropped.' },
        { title: 'Sweet-spot hours', sub: 'Off-peak with strong audience', rows: (stats.sweet || []).slice(0, 4).map((x) => ({ label: `${x.h}`, value: `${f2(x.next)}${pc.heat_metric === 'share' ? '%' : ''}`, tone: 'up', detail: { title: `${x.h} sweet spot`, sub: 'Off-peak hour', rows: [['Forecast', f2(x.next)], ['Recent', f2(x.now)]] } })), empty: 'No off-peak hour holds an above-average share right now.', todo: (stats.sweet || []).length ? `Buy frequency at ${(stats.sweet)[0].h} before prime.` : 'No off-peak hour qualifies.' }]);
      $('#pb-tvr', p).insertAdjacentHTML('beforeend', '');
    }
    App.predictEvidence.tv = { title: 'TVR & Audience Forecast', horizon: H, span: SPAN, lines: flatten(ev).map(w),
      kpis: [['Projected average TVR', f2(pTVR)], ['Guaranteed minimum TVR (low case)', f2(gTVR)], ['Projected reach %', fR ? fmt.pct(avg(fR.p50), 1) : 'n/a'], ['Top growing category', growing[0] ? growing[0].name : 'n/a']],
      result: subset(pr.res, R, ['tvr_total', 'channel_tvr', 'reach_total']) };
  }

  /* ================================================================ Market & Competitor */
  async function marketTab(p, ctx) {
    if (!ctx.has('lmrb')) return needData(p, 'LMRB sheet');
    const filters = ctx.filtersFor('lmrb'), persp = ctx.persp(), M = ctx.mode() === 'monthly', NM = ctx.months(), H = M ? NM * 30 : ctx.horizon();
    const pg = App.store.get('mk-group:' + App.clientId(), '');
    const opts = { product_group: pg || null, my_brand: persp.my_brand || null, tv_data_set: persp.tv_data_set || null, mode: M ? 'monthly' : 'daily' };
    MAJOR = readEvents();
    const key = 'lm|' + JSON.stringify(MAJOR) + ctx.status.lmrb.sig + '|' + (ctx.status.tv ? ctx.status.tv.sig : '') + '|' + JSON.stringify(filters) + JSON.stringify(opts);
    const prog = cache.has(key) ? null : scanning(p, 'Forecasting competitor moves');
    let pr;
    try { pr = await getPrediction(key, () => App.data.predictMarket({ filters, options: opts }), 'lmrb', prog || (() => {})); }
    catch (e) { p.innerHTML = App.emptyState('The market prediction could not run', e.message) + '<div style="text-align:center"><button class="btn" data-rerun>Try again</button></div>'; wireRerun(p, key, () => marketTab(p, ctx)); return; }
    finally { if (prog) App.loader.hide(250); }
    if (!p.isConnected) return;
    const R = pr.results, pc = pr.payload.ctx;
    const w = W(M), SPAN = M ? `${NM} month${NM === 1 ? '' : 's'}` : `${H} days`, NOW = M ? 3 : 28, NP = M ? NM : H, NB = M ? 6 : 28, BACK = M ? 24 : 28;
    HIST = M ? 24 : 56;
    const evid = (id, items) => C.evidence(id, (items || []).map((x) => (typeof x === 'string' ? w(x) : x && x.text ? { ...x, text: w(x.text) } : x)), "Planner's Evidence (forecast)", { note: 'These figures are forecasts: estimates of what is likely, not recorded data.' });
    if (!R.length) { p.innerHTML = App.emptyState('Not enough LMRB history to forecast', (pr.payload.notes || [])[0] || 'Widen the filters.'); return; }
    { const s0 = one(R, 'spots_total') || R[0]; await loadPins(s0.history.dates.slice(-HIST), slice(s0, H).dates); }
    const comp = group(R, 'comp_spend'), sov = group(R, 'sov'), spots = one(R, 'spots_total'), dps = group(R, 'daypart_spend'), cps = one(R, 'cps_total');
    const clut = group(R, 'clutter'), pos = group(R, 'posinbrk'), rate = group(R, 'slot_rating'), costs = group(R, 'slot_cost');
    const my = pc.my_brand;
    C.register(comp.map((r) => r.entity));
    // competitor spend totals and bursts
    const compRows = comp.map((r) => { const f = slice(r, H); const prev = r.history.values.slice(-NP); return { r, name: r.entity, next: total(f.p50), lo: total(f.p10), hi: total(f.p90), prev: total(prev), bursts: MR.bursts(r.history.values.slice(-NB), f.p50, M ? { win: 3 } : undefined) }; });
    const rivals = compRows.filter((x) => x.name !== my);
    const rivalNext = total(rivals.map((x) => x.next)), rivalPrev = total(rivals.map((x) => x.prev));
    const fS = spots ? slice(spots, H) : null;
    const clutRows = clut.map((r) => { const f = slice(r, H), ps = pos.find((q) => q.entity === r.entity); return { name: r.entity, next: avg(f.p50), hist: MR.recentMean(r, NOW), pos: ps ? avg(slice(ps, H).p50) : pc.pos_recent[r.entity] }; })
      .map((x) => ({ ...x, rising: finite(x.next) && finite(x.hist) && x.next > x.hist * 1.1 })).filter((x) => finite(x.next));
    const worst = clutRows.slice().sort((a, b) => b.next - a.next)[0];
    const bubble = rate.map((r) => { const c = costs.find((q) => q.entity === r.entity); if (!c) return null; return { name: r.entity, channel: r.entity.split(' / ')[0], x: avg(slice(r, H).p50), y: avg(slice(c, H).p50), clutter: pc.slot_clutter[r.entity], spots: pc.slot_spots[r.entity] }; }).filter((q) => q && finite(q.x) && finite(q.y));
    const zone = bubble.length ? MR.buyingZone(bubble) : null;
    const bd = pc.bridge, bridgeBanner = pc.has_grp && bd
      ? `<div class="banner info"><span><b>Ratings bridge:</b> spots are matched to TVR by 30-minute timeband on shared TV channels, never by programme name. ${fmt.num(bd.rated_pct, 0)}% of spots have a rating (${fmt.num(bd.rated_exact)} on the exact day, ${fmt.num(bd.rated_profile)} from the usual weekday pattern). The other ${fmt.num(bd.not_rated_pct, 0)}% are <span class="badge warn">TVR N/A</span> (radio, press, unmonitored TV or no matching timeband) and are left out of the slot charts, never guessed.</span></div>`
      : `<div class="banner info"><span><span class="badge warn">TVR N/A</span> No TVR sheet loaded, so rating-based charts are hidden. Everything else on this card works from the LMRB sheet alone. Add the TVR sheet to rate TV slots.</span></div>`;
    const groupSel = `<label class="row small">Product group <select id="mk-group" style="max-width:220px">${pc.product_groups.map((g) => `<option ${g === pc.product_group ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select></label>
      <label class="row small">Focus brand <select id="mk-brand" style="max-width:220px"><option value="">None</option>${pc.advertisers.map((a) => `<option ${a === persp.my_brand ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></label>`;
    p.innerHTML = w(`${headCard('Market & Competitor Forecast', `${pc.product_group}: next ${SPAN} from ${pc.date_max}, ${fmt.num(pc.group_rows)} spots in the group.`, spots, groupSel)}
      ${forecastKey(M)}${M ? monthNote(pc) : ''}${(pr.payload.notes || []).filter((n) => !/interpolation/.test(n)).map((n) => `<div class="banner info"><span>${esc(n)}</span></div>`).join('')}
      <div class="kpis">
        ${kpiTile('Predicted competitor spend', fmt.lkrc(rivalNext), `${signed(pct(rivalNext, rivalPrev), 0)} vs the previous ${SPAN}. Range ${fmt.lkrc(total(rivals.map((x) => x.lo)))} to ${fmt.lkrc(total(rivals.map((x) => x.hi)))}`, App.help('Sum of the daily most likely spend forecasts for the top competitors in the product group (your brand excluded).', 'How much pressure to expect from rivals, for budget defence.'))}
        ${kpiTile('Predicted spot volume', fS ? fmt.num(total(fS.p50)) : 'n/a', fS ? `About ${fmt.num(avg(fS.p50), 0)} spots a day in ${esc(pc.product_group)}` : '', App.help('Most likely forecast of daily spot counts for the whole product group, summed over the horizon.', 'Category clutter in the period: more spots means each one works harder to stand out.'))}
        ${kpiTile('High-clutter alert', worst ? `${fmt.num(worst.next, 1)} ads/break` : 'n/a', worst ? `${esc(short(worst.name, 40))}${worst.rising ? ' (rising)' : ''}` : 'AdsinBrk not available', App.help('Average AdsinBrk is forecast for the programmes this group buys; the highest expected break length is flagged.', 'Breaks to avoid, or to buy only in first position.'), worst && worst.rising ? 'alert-kpi' : '')}
        ${kpiTile('Best estimated CPRP slot', zone && zone.best ? fmt.lkrc(zone.best.cprp) : 'n/a', zone && zone.best ? esc(short(zone.best.name, 42)) : 'Load the TVR sheet to rate slots', App.help('Cost per rating point = forecast average spot cost divided by forecast spot rating (matched programme TVR), for the most-used slots.', 'The cheapest rating points to buy next, inside the optimal buying zone where possible.'))}
      </div>
      <div class="pb-head"><h2>Competitor War-Room and Next-Move Playbook</h2><span class="muted small">From the LMRB sheet alone, every medium. The TVR sheet is optional.</span></div>
      <div class="sl-grid four" id="pb-mk"></div>
      ${svNav('market', [['war', 'War-room details', 'What will rivals do next?'], ['plan', 'Next month plan', 'What will rivals do?'], ['comp', 'Competitors', 'Who gains share?'], ['price', 'Price and discounts', 'Sponsorship vs commercial'], ['slots', 'Slots and clutter', 'Where to buy?']])}
      <section class="sv" data-sv="war"${svHide('market', 'war')}>
        ${C.box('pm-focus', 'Where rivals outspend your focus brand', 'Forecast spend of your focus brand against the biggest rival, by channel, daypart or language.', { tall: true, ev: true,
          extra: '<div class="seg" id="pmf-seg"><button type="button" data-d="channel" aria-pressed="true">Channel</button><button type="button" data-d="daypart" aria-pressed="false">Daypart</button><button type="button" data-d="lang" aria-pressed="false">Language</button></div>',
          help: ['Spend is forecast for each of the top advertisers on each channel, daypart and language. For every one, your focus brand is compared with the biggest rival there.', 'Shows where you are being out-shouted, and where you already lead.'] })}
        <div class="grid g2" style="margin-top:16px">
          ${C.box('pm-radar', 'Burst radar: who launches next?', 'Chance that each rival starts a spend burst in the coming period, from what they did in earlier years.', { tall: true, ev: true,
            help: ['Weekly spend is scanned over all the years in the sheet. A burst is a week above 1.5 times the previous 8 weeks. For the coming window we count how many past years had a burst start in the same calendar window (plus or minus 10 days).', 'An early warning built on repeating habits. It needs about 2 years of history, and 3 or more is better.'] })}
          ${C.box('pm-fatigue', 'Creative fatigue and refresh predictor', 'Age of each rival\'s main theme against how long their themes usually run.', { tall: true, ev: true,
            help: ['Every Advt_Theme is tracked from its first to last spot. Finished themes give each advertiser a typical lifespan. The current main theme is flagged as ageing, wearing out (fewer spots, or shorter 10s reminders replacing 30s launch spots) or due for refresh.', 'Predicts when a rival is likely to change creative or leave the campaign.'] })}
        </div>
        <div class="grid g2" style="margin-top:16px">
          ${C.box('pm-clut2', 'Where ads get buried: ads per break', 'Forecast ads per break by channel and daypart. Darker means more crowded.', { html: '', ev: true,
            help: ['AdsinBrk is averaged per channel and daypart and forecast.', 'Crowded belts hide your ad. Clear belts let it stand out.'] })}
          ${C.box('pm-first2', 'First-in-break chance', 'Forecast share of spots in position 1 or 2 by channel and daypart. Darker means more premium.', { html: '', ev: true,
            help: ['PosinBrk 1 or 2 is counted as a premium position and its share of spots is forecast.', 'Where premium positions are easy to get, and where they are scarce.'] })}
        </div>
      </section>
      <section class="sv" data-sv="plan"${svHide('market', 'plan')}>
        <div class="sl-grid" id="sl-mk"></div>
        <div style="margin-top:16px">${C.box('pm-spend', 'Competitor spend and next move', 'Solid is actual. Dashed is the forecast. Triangles are predicted bursts. Click a point for the numbers.', { xtall: true, ev: true,
          help: ['Each advertiser\'s spend is forecast with the forecast engine. A forecast period more than 25% above that advertiser\'s trailing average is flagged as a Predicted Competitor Campaign Burst.', 'Early warning of rival launches, so you can defend share of voice or book inventory before prices rise.'] })}</div>
      </section>
      <section class="sv" data-sv="comp"${svHide('market', 'comp')}>
        <div class="grid g2">
          ${C.box('pm-sov', 'Share of voice: now vs next', `Share of ${pc.product_group} spend`, { tall: true, ev: true,
            help: ['Each advertiser\'s share of group spend is forecast. Bars compare the forecast share with the recent share.', 'Whether your share of voice is about to be squeezed, and by whom.'] })}
          ${pc.has_grp ? C.box('pm-sog', 'Share of audience: now vs next', 'Share of rating points delivered', { tall: true, ev: true,
            help: ['Each spot is matched to the programme airing at that time and given its rating. Each advertiser\'s share of all rating points is forecast.', 'A truer share of voice than spend: who is actually reaching viewers.'] }) : C.box('pm-chmix', 'Channel mix: now vs next', `Share of ${pc.product_group} spend by channel`, { tall: true, ev: true,
            help: ['Each channel\'s share of the group\'s spend is forecast.', 'Which channels competitors are moving money to.'] })}
        </div>
        <div class="grid g2" style="margin-top:16px">
          ${pc.has_grp ? C.box('pm-chmix', 'Channel mix: now vs next', `Share of ${pc.product_group} spend by channel`, { tall: true, ev: true,
            help: ['Each channel\'s share of the group\'s spend is forecast.', 'Which channels competitors are moving money to, so you can claim inventory early.'] }) : ''}
          ${C.box('pm-advch', 'Who spends where', `Forecast spend per advertiser and channel`, { html: '', ev: true,
            help: ['Each advertiser and channel pair is forecast separately and summed over the horizon. Brighter cells mean more money.', 'Who plans to dominate which channel, and the white space where nobody is spending.'] })}
        </div>
      </section>
      <section class="sv" data-sv="price"${svHide('market', 'price')}>
        ${group(R, 'type_spend').length ? `<div class="grid g2">
          ${C.box('pm-split', 'Sponsorship vs commercial: spend', 'Average spend per period, now vs next. Sponsorship = Tag, Time Check, -BB, DJ and similar items.', { tall: true, ev: true,
            help: ['Spots are split by theme: sponsorship items (-BB, Com Break, DJ, -Extro, -Intro, -LLogo, Next Card, Tag, Time Check, -Tr) versus real commercials. Each type is forecast on its own.', 'Shows how much of the money is sponsorship and whether it is growing.'] })}
          ${C.box('pm-typecps', 'Sponsorship vs commercial: price per second', 'Average price paid per second, now vs next', { tall: true, ev: true,
            help: ['Spend divided by seconds is forecast separately for each type.', 'Compare the discount you get on each type. Sponsorship should be priced differently from spots.'] })}
        </div>` : `<div class="banner info"><span>No sponsorship items found in this product group (themes like -BB, Tag, Time Check, DJ). The split appears when there are at least 20.</span></div>`}
        <div class="grid g2" style="margin-top:16px">
          ${cps ? C.box('pm-cps', 'Cost per second outlook', 'Average cost per second: actual and forecast', { ev: true,
            help: ['Total spend divided by total seconds, forecast as a fan with low case to high case.', 'Whether media costs are drifting up, to time bookings and negotiate rates.'] }) : ''}
          ${pc.has_grp ? C.box('pm-cprp', 'Cost per rating point outlook', 'Average cost to buy one rating point', { ev: true,
            help: ['Spend divided by rating points delivered is forecast as a fan.', 'Whether audience is getting more or less expensive.'] }) : ''}
        </div>
      </section>
      <section class="sv" data-sv="slots"${svHide('market', 'slots')}>
        ${bridgeBanner}
        <div class="grid g2">
          ${C.box('pm-bubble', 'Best slots to buy', 'Cheap and high rating is best. Bigger bubble = more clutter.', { tall: true, ev: true,
            help: ['For the most-used programme slots, the matched TVR and the average spot cost are each forecast. The shaded quadrant is the Optimal Buying Zone.', 'The shortlist for your next buy.'] })}
          ${C.box('pm-clutter', 'Break clutter and position', 'Bars: ads per break (red = rising). Line: position in break.', { tall: true, ev: true,
            help: ['AdsinBrk and PosinBrk are averaged per programme and forecast. Clutter is rising when the forecast is at least 10% above the recent level.', 'Where your spot will be buried in long breaks.'] })}
        </div>
        <div style="margin-top:16px">${C.box('pm-dp', 'Where the money moves in the day', 'Average spend per period by daypart: now vs next', { tall: true, ev: true,
          help: ['Group spend per daypart is forecast and compared with the recent level.', 'Where competitor money is moving, to find quieter, cheaper dayparts.'] })}</div>
      </section>`);
    wireRerun(p, key, () => marketTab(p, ctx));
    wireCalendar(p, () => marketTab(p, ctx));
    wireSv(p, 'market');
    markForecast(p, { R, H, M });
    p.querySelectorAll('[data-intro]').forEach((b) => { b.onclick = () => App.loadIntro().then(() => App.intro.open(true)); });
    $('#mk-group', p).onchange = (e) => { App.store.set('mk-group:' + App.clientId(), e.target.value); marketTab(p, ctx); };
    $('#mk-brand', p).onchange = (e) => { ctx.setPersp({ my_brand: e.target.value }); marketTab(p, ctx); };
    const ev = {};

    // 1. competitor spend multi-line with bursts
    if (comp.length) {
      const back = M ? 24 : 42, hd = comp[0].history.dates.slice(-back), fd = slice(comp[0], H).dates, labels = hd.concat(fd), nh = hd.length;
      const ds = [];
      compRows.forEach((x) => {
        const col = C.colorFor(x.name), f = slice(x.r, H), hv0 = x.r.history.values.slice(-back);
        const all = M ? hv0.concat(f.p50) : smooth(hv0.concat(f.p50), 7), hv = all.slice(0, nh), fS = all.slice(nh); x.fs = fS;
        ds.push({ label: x.name, data: hv.concat(Array(fd.length).fill(null)), borderColor: col, backgroundColor: col, borderWidth: x.name === my ? 3 : 2, pointRadius: 0, tension: 0.25 });
        ds.push({ label: x.name + ' (forecast)', data: Array(nh - 1).fill(null).concat([hv[nh - 1]], fS), borderColor: col, borderDash: [6, 5], borderWidth: 2, pointRadius: 0, tension: 0.3 });
      });
      const bursts = []; compRows.forEach((x) => x.bursts.forEach((b) => bursts.push({ ...b, name: x.name, date: slice(x.r, H).dates[b.index] })));
      const marks = labels.map(() => null), info = {};
      bursts.forEach((b) => { const i = nh + b.index; const sv = ((compRows.find((q) => q.name === b.name) || {}).fs || [])[b.index]; const yv = finite(sv) ? sv : b.value; if (marks[i] == null || yv > marks[i]) { marks[i] = yv; info[i] = b; } });
      if (bursts.length) ds.push({ label: 'Predicted Competitor Campaign Burst', data: marks, showLine: false, pointStyle: 'triangle', pointRadius: 9, pointHoverRadius: 11, borderColor: C.css('--warn') || '#ffb547', backgroundColor: C.css('--warn') || '#ffb547' });
      C.make('pm-spend', { type: 'line', data: { labels, datasets: ds }, plugins: [nowLine],
        options: { interaction: { mode: 'index', intersect: false }, plugins: { nowLine: { index: nh - 1 }, eventPins: eventOpt(labels), legend: { position: 'bottom', labels: { filter: (i) => !/\(forecast\)$/.test(i.text) } },
          tooltip: { filter: (i) => i.parsed.y != null && !(i.dataIndex === nh - 1 && /\(forecast\)$/.test(i.dataset.label)), callbacks: { title: C.fcTitle(nh), label: (c) => (c.dataset.label.startsWith('Predicted') ? `Burst: ${info[c.dataIndex].name} ${signed(info[c.dataIndex].lift_pct, 0)} vs 7-day average` : `${c.dataset.label}: ${fmt.lkrc(c.parsed.y)}`) } } },
          scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } }, y: { beginAtZero: true, ticks: { callback: (v) => fmt.compact(v) } } } } });
      const top = rivals.slice().sort((a, b) => b.next - a.next)[0];
      const riser = rivals.map((x) => ({ ...x, chg: pct(x.next, x.prev) })).filter((x) => finite(x.chg)).sort((a, b) => b.chg - a.chg)[0];
      const firstBurst = bursts.sort((a, b) => a.index - b.index)[0];
      ev.spend = [
        top ? `${top.name} is expected to spend the most: ${fmt.lkrc(top.next)} in the next ${SPAN}.` : null,
        riser && riser.chg > 10 ? `${riser.name} is accelerating: ${signed(riser.chg, 0)} versus the previous ${SPAN}.` : 'No competitor is accelerating by more than 10%.',
        bursts.length ? `Predicted Competitor Campaign Bursts: ${bursts.slice(0, 4).map((b) => `${b.name} on ${b.date} (${signed(b.lift_pct, 0)})`).join('; ')}.` : 'No campaign bursts are predicted in this horizon.',
        my ? (() => { const m = compRows.find((x) => x.name === my); return m ? `${my} is forecast at ${fmt.lkrc(m.next)} (${signed(pct(m.next, m.prev), 0)} vs previous ${SPAN}).` : null; })() : null,
        { rec: true, text: firstBurst ? `Lock inventory and lift weight in the days before ${firstBurst.date} to defend share against ${firstBurst.name}.` : (riser && riser.chg > 10 ? `Watch ${riser.name}: plan a response flight if the trend continues.` : 'Competitive pressure is steady; keep the current flighting.') },
      ];
    } else ev.spend = ['No competitor spend history in this product group.'];
    evid('pm-spend', ev.spend);

    // 2. clutter combo
    if (clutRows.length) {
      const rows = clutRows.slice().sort((a, b) => b.next - a.next);
      C.make('pm-clutter', { data: { labels: rows.map((x) => `${short(x.name, 24)} (${fmt.num(x.next, 1)})`), datasets: [
        { type: 'bar', label: 'Forecast ads in break', data: rows.map((x) => x.next), backgroundColor: rows.map((x) => (x.rising ? (C.css('--bad') || '#ff5d7a') + 'cc' : C.PALETTE[0] + 'aa')), borderRadius: 5, maxBarThickness: 26, yAxisID: 'y' },
        { type: 'bar', label: w('Last 4 weeks'), data: rows.map((x) => x.hist), backgroundColor: 'rgba(142,154,200,.28)', borderRadius: 5, maxBarThickness: 26, yAxisID: 'y' },
        { type: 'line', label: 'Average position in break', data: rows.map((x) => x.pos), borderColor: C.PALETTE[2], backgroundColor: C.PALETTE[2], pointRadius: 4, tension: 0.3, yAxisID: 'y2' }] },
        options: { interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { title: (it) => rows[it[0].dataIndex].name, label: (c) => `${c.dataset.label}: ${fmt.num(c.parsed.y, 1)}` } } },
          scales: { x: { grid: { display: false }, ticks: { maxRotation: 50, minRotation: 30, font: { size: 10 } } }, y: { beginAtZero: true, title: { display: true, text: 'Ads per break' } }, y2: { position: 'right', beginAtZero: true, grid: { display: false }, title: { display: true, text: 'Position' } } } } });
      const rising = rows.filter((x) => x.rising);
      ev.clutter = [
        `Most cluttered: ${rows.slice(0, 2).map((x) => `${x.name} (${fmt.num(x.next, 1)} ads per break)`).join('; ')}.`,
        rising.length ? `Clutter rising in ${rising.slice(0, 3).map((x) => `${x.name} (${fmt.num(x.hist, 1)} to ${fmt.num(x.next, 1)})`).join('; ')}.` : 'No programme shows rising clutter.',
        { rec: true, text: rising.length ? `In ${rising.slice(0, 2).map((x) => x.name).join(' and ')}, buy PosinBrk 1 to 2 (first in break) or move weight to less cluttered programmes.` : `Clutter is stable. Request PosinBrk 1 to 2 in ${rows[0].name}, the longest breaks.` },
      ];
    } else ev.clutter = ['AdsinBrk is not available in this sheet.'];
    evid('pm-clutter', ev.clutter);

    // 3. CPRP bubble
    if (zone && zone.points.length) {
      const chans = [...new Set(zone.points.map((q) => q.channel))];
      const cl = zone.points.map((q) => q.clutter).filter(finite), cmin = Math.min(...cl, 0), cmax = Math.max(...cl, 1);
      const rad = (v) => (finite(v) ? 6 + 16 * ((v - cmin) / (cmax - cmin || 1)) : 8);
      C.make('pm-bubble', { type: 'bubble', data: { datasets: chans.map((ch) => ({ label: fmt.title(ch), data: zone.points.filter((q) => q.channel === ch).map((q) => ({ x: q.x, y: q.y, r: rad(q.clutter), q })),
        backgroundColor: C.PALETTE[chans.indexOf(ch) % C.PALETTE.length] + '99', borderColor: C.PALETTE[chans.indexOf(ch) % C.PALETTE.length], borderWidth: 1.5 })) }, plugins: [zonePlugin],
        options: { plugins: { zone: { x: zone.x_median, y: zone.y_median }, legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c) => { const q = c.raw.q; return [short(q.name, 60), `Rating ${f2(q.x)}, cost ${fmt.lkrc(q.y)} per spot`, `CPRP ${fmt.lkrc(q.cprp)}, clutter ${finite(q.clutter) ? fmt.num(q.clutter, 1) : 'n/a'} ads/break${q.optimal ? ', optimal zone' : ''}`]; } } } },
          scales: { x: { title: { display: true, text: 'Forecast spot rating (TVR)' } }, y: { title: { display: true, text: 'Forecast cost per spot (LKR)' }, ticks: { callback: (v) => fmt.compact(v) } } } } });
      const opt = zone.points.filter((q) => q.optimal && q.cprp != null).sort((a, b) => a.cprp - b.cprp);
      const dear = zone.points.filter((q) => q.cprp != null).sort((a, b) => b.cprp - a.cprp)[0];
      ev.bubble = [
        opt.length ? `In the Optimal Buying Zone: ${opt.slice(0, 3).map((q) => `${q.name} (CPRP ${fmt.lkrc(q.cprp)})`).join('; ')}.` : 'No slot is both above-median rating and below-median cost right now.',
        dear ? `Most expensive rating points: ${dear.name} (CPRP ${fmt.lkrc(dear.cprp)}).` : null,
        { rec: true, text: zone.best ? `Shift weight toward ${zone.best.name}: about ${fmt.lkrc(zone.best.cprp)} per rating point${finite(zone.best.clutter) && zone.best.clutter > 6 ? ', but ask for first position because breaks are long' : ''}.` : 'Load more TVR history to rate slots.' },
      ];
    } else { const bw = document.getElementById('pm-bubble'); if (bw) bw.closest('.chart-wrap').innerHTML = App.emptyState('TVR N/A', pc.has_grp ? 'Too few rated TV slots to compare.' : 'Load the TVR sheet to rate TV slots. Radio, press and unmonitored channels never get a rating.'); }
    if (!(zone && zone.points.length)) ev.bubble = [pc.has_grp ? 'Too few matched slots to compare.' : 'Load the TVR sheet as well: spot ratings come from matching each spot to the programme airing at that time.'];
    evid('pm-bubble', ev.bubble);

    // 4. share of voice (bars)
    {
      const rows = shareRows(sov, H, NOW);
      if (rows.length) {
        shareBars('pm-sov', rows, { nowLabel: w('Last 4 weeks'), nextLabel: `Next ${SPAN}` });
        const me = rows.find((x) => x.name === my), lead = rows[0], up = rows.slice().sort((a, b) => b.chg - a.chg)[0];
        ev.sov = [
          `${lead.name} is expected to lead with ${fmt.num(lead.next, 1)}% share of voice.`,
          up.chg > 0.5 ? `${up.name} gains the most (${signed(up.chg, 1).replace('%', '')} pts to ${fmt.num(up.next, 1)}%).` : null,
          me ? `${my}: ${fmt.num(me.now, 1)}% now, ${fmt.num(me.next, 1)}% forecast.` : 'Pick your brand above to track your own share of voice.',
          { rec: true, text: me && me.chg < -1 ? `Your share is set to slip by ${fmt.num(-me.chg, 1)} points; add weight or concentrate it in fewer periods to hold presence.` : 'Share of voice is holding; maintain the plan.' },
        ];
      } else ev.sov = ['No share of voice history.'];
      evid('pm-sov', ev.sov);
    }

    // 5. daypart spend shift
    if (dps.length) {
      const rows = dps.map((r) => ({ name: r.entity, now: MR.recentMean(r, NOW), next: avg(slice(r, H).p50) })).filter((x) => finite(x.now) || finite(x.next));
      const order = MR.daypartOrder ? MR.daypartOrder() : [];
      rows.sort((a, b) => (order.indexOf(a.name) - order.indexOf(b.name)));
      C.make('pm-dp', { type: 'bar', data: { labels: rows.map((x) => x.name), datasets: [
        { label: w('Last 4 weeks (per day)'), data: rows.map((x) => x.now), backgroundColor: 'rgba(142,154,200,.45)', borderRadius: 5, maxBarThickness: 30 },
        { label: w(`Next ${SPAN} (per day)`), data: rows.map((x) => x.next), backgroundColor: C.PALETTE[1] + 'cc', borderRadius: 5, maxBarThickness: 30 }] },
        options: { plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt.lkrc(c.parsed.y)}` } } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { callback: (v) => fmt.compact(v) } } } } });
      const ch = rows.map((x) => ({ ...x, chg: pct(x.next, x.now) })).filter((x) => finite(x.chg)).sort((a, b) => b.chg - a.chg);
      ev.dp = [
        ch[0] && ch[0].chg > 5 ? `Competitor money is moving into ${ch[0].name} (${signed(ch[0].chg, 0)}).` : 'No daypart gains more than 5%.',
        ch.length && ch[ch.length - 1].chg < -5 ? `${ch[ch.length - 1].name} is cooling (${signed(ch[ch.length - 1].chg, 0)}).` : null,
        { rec: true, text: ch.length && ch[ch.length - 1].chg < -5 ? `Look for value in ${ch[ch.length - 1].name}, where competition is easing.`
          : ch[0] && ch[0].chg > 5 ? `Expect more clutter and firmer rates in ${ch[0].name}; book it early or test adjacent dayparts.` : 'Daypart mix is stable.' },
      ];
    } else ev.dp = ['No daypart history.'];
    evid('pm-dp', ev.dp);

    // 5b. channel mix, competitor x channel, audience share, CPRP outlook
    {
      const rows = shareRows(group(R, 'chan_mix'), H, NOW);
      if (rows.length) {
        shareBars('pm-chmix', rows, { nowLabel: w('Last 4 weeks'), nextLabel: `Next ${SPAN}`, title: fmt.title });
        const up = rows.slice().sort((a, b) => b.chg - a.chg), dn = up.slice().reverse();
        ev.chmix = [
          `Most competitor money will go to ${fmt.title(rows[0].name)}: ${fmt.num(rows[0].next, 1)}% of ${pc.product_group} spend.`,
          up[0].chg > 0.5 ? `Channel gaining spend share: ${up.filter((x) => x.chg > 0.5).slice(0, 3).map((x) => `${fmt.title(x.name)} (${signed(x.chg, 1).replace('%', '')} pts)`).join(', ')}.` : 'No channel gains more than half a point of spend share.',
          dn[0].chg < -0.5 ? `Channel losing spend share: ${dn.filter((x) => x.chg < -0.5).slice(0, 3).map((x) => `${fmt.title(x.name)} (${signed(x.chg, 1).replace('%', '')} pts)`).join(', ')}.` : null,
          { rec: true, text: dn[0].chg < -0.5 ? `${fmt.title(dn[0].name)} is getting less crowded; ask for better rates or premium positions there.` : 'Channel mix is stable; no urgent move needed.' },
        ];
      } else ev.chmix = ['No channel history for this product group.'];
      evid('pm-chmix', ev.chmix);

      const ac = group(R, 'adv_channel').map((r) => { const [a, c] = r.entity.split(' | '); return { a, c, v: total(slice(r, H).p50) }; });
      if (ac.length) {
        const ads = [...new Set(ac.map((x) => x.a))], chs = [...new Set(ac.map((x) => x.c))];
        const mat = { rows: ads, cols: chs.map(fmt.title), values: ads.map((a) => chs.map((c) => { const x = ac.find((q) => q.a === a && q.c === c); return x ? x.v : null; })) };
        $('#pm-advch').innerHTML = C.heat(mat, { fmt: fmt.compact, caption: 'Forecast spend by advertiser and channel' });
        const best = ac.slice().sort((x, y) => y.v - x.v)[0], mine = my ? ac.filter((x) => x.a === my) : [];
        const colTot = chs.map((c) => ({ c, v: ac.filter((x) => x.c === c).reduce((s2, x) => s2 + x.v, 0) })).sort((x, y) => x.v - y.v);
        ev.advch = [
          `Biggest planned commitment: ${best.a} on ${fmt.title(best.c)} (${fmt.lkrc(best.v)}).`,
          mine.length ? `${my} is forecast to put most on ${fmt.title(mine.sort((x, y) => y.v - x.v)[0].c)} (${fmt.lkrc(mine[0].v)}).` : 'Pick your brand above to see where you stand against each rival.',
          { rec: true, text: `${fmt.title(colTot[0].c)} has the least competitor money planned (${fmt.lkrc(colTot[0].v)} across the top advertisers): the best place to stand out, if its audience fits.` },
        ];
      } else { $('#pm-advch').innerHTML = App.emptyState('Not enough channel history', 'This view needs advertisers with spots on several channels.'); ev.advch = []; }
      evid('pm-advch', ev.advch);

      const sg = group(R, 'sog'), srows = shareRows(sg, H, NOW);
      if (pc.has_grp && srows.length && $('#pm-sog')) {
        shareBars('pm-sog', srows, { nowLabel: w('Last 4 weeks'), nextLabel: `Next ${SPAN}` });
        const me2 = srows.find((x) => x.name === my);
        ev.sog = [
          `${srows[0].name} is expected to deliver the biggest audience share: ${fmt.num(srows[0].next, 1)}% of rating points.`,
          me2 ? `${my}: ${fmt.num(me2.now, 1)}% of rating points now, ${fmt.num(me2.next, 1)}% forecast.` : 'Pick your brand above to track your own share of audience.',
          { rec: true, text: me2 && me2.chg < -1 ? `Your audience share is set to fall ${fmt.num(-me2.chg, 1)} points. Buy higher-rated slots, not just more spots.` : 'Audience share is holding up.' },
        ];
        evid('pm-sog', ev.sog);
      }
      const cp = one(R, 'cprp_total');
      if (pc.has_grp && cp && $('#pm-cprp')) {
        const f = slice(cp, H);
        fan('pm-cprp', cp, H, { color: C.PALETTE[2], vf: (v) => 'LKR ' + fmt.num(v, 0) });
        const chg = pct(avg(f.p50), MR.recentMean(cp, NOW));
        ev.cprp = [`Cost per rating point is expected at LKR ${fmt.num(avg(f.p50), 0)} (${signed(chg, 1)} vs the last 4 weeks; range LKR ${fmt.num(avg(f.p10), 0)} to ${fmt.num(avg(f.p90), 0)}).`,
          { rec: true, text: chg != null && chg > 5 ? 'Audience is getting more expensive: book early and lock rates.' : chg != null && chg < -5 ? 'Rating points are getting cheaper: delay buying where you can, and push for lower rates.' : 'Rating-point cost is stable.' }];
        evid('pm-cprp', ev.cprp);
      }
    }

    // 6. cost inflation
    if (cps) {
      const f = slice(cps, H);
      fan('pm-cps', cps, H, { color: C.PALETTE[4], vf: (v) => 'LKR ' + fmt.num(v, 0) });
      const chg = pct(avg(f.p50), MR.recentMean(cps, NOW));
      ev.cps = [`Average cost per second is expected at LKR ${fmt.num(avg(f.p50), 0)} (${signed(chg, 1)} vs the last 4 weeks).`,
        { rec: true, text: chg != null && chg > 5 ? 'Costs are drifting up: confirm bookings early and lock rates for the flight.' : 'No cost inflation expected; there is room to negotiate.' }];
      evid('pm-cps', ev.cps);
    }

    // 7. sponsorship vs commercial (new)
    {
      const ts = group(R, 'type_spend'), tc = group(R, 'type_cps');
      const typeBars = (id, res, vf, nowSuffix) => {
        const rows = res.map((r) => ({ name: r.entity, now: MR.recentMean(r, NOW), next: avg(slice(r, H).p50) })).filter((x) => finite(x.now) || finite(x.next)).sort((a, b) => (a.name < b.name ? -1 : 1));
        C.make(id, { type: 'bar', data: { labels: rows.map((x) => `${x.name}  (${signed(pct(x.next, x.now), 0)})`), datasets: [
          { label: w('Last 4 weeks' + nowSuffix), data: rows.map((x) => x.now), backgroundColor: 'rgba(142,154,200,.45)', borderRadius: 5, maxBarThickness: 40 },
          { label: w(`Next ${SPAN}` + nowSuffix), data: rows.map((x) => x.next), backgroundColor: [C.PALETTE[0] + 'cc', C.PALETTE[2] + 'cc'], borderRadius: 5, maxBarThickness: 40 }] },
          options: { plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${vf(c.parsed.y)}` } } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { callback: (v) => fmt.compact(v) } } } } });
        return rows;
      };
      if (ts.length && $('#pm-split')) {
        const rows = typeBars('pm-split', ts, fmt.lkrc, ' (per day)'), sp = rows.find((x) => x.name === 'Sponsorship'), cm = rows.find((x) => x.name === 'Commercial');
        const shNow = sp && cm ? sp.now / (sp.now + cm.now) * 100 : null, shNext = sp && cm ? sp.next / (sp.next + cm.next) * 100 : null;
        ev.split = [sp && cm ? `Sponsorship is ${fmt.num(shNow, 0)}% of spend now and is forecast at ${fmt.num(shNext, 0)}%.` : null,
          { rec: true, text: sp && cm && shNext > shNow + 2 ? 'Sponsorship is growing: review the rate you pay for it separately from spot rates.' : 'Negotiate sponsorship and commercial rates separately; they behave differently.' }];
        evid('pm-split', ev.split);
      }
      if (tc.length && $('#pm-typecps')) {
        const rows = typeBars('pm-typecps', tc, (v) => 'LKR ' + fmt.num(v, 0), ' (LKR per second)'), sp = rows.find((x) => x.name === 'Sponsorship'), cm = rows.find((x) => x.name === 'Commercial');
        ev.typecps = [sp && cm && cm.next > 0 ? `Sponsorship is expected at ${fmt.num(sp.next / cm.next * 100, 0)}% of the commercial price per second (LKR ${fmt.num(sp.next, 0)} vs LKR ${fmt.num(cm.next, 0)}).` : null,
          { rec: true, text: 'Quote any discount against the matching type: sponsorship against sponsorship, commercials against commercials.' }];
        evid('pm-typecps', ev.typecps);
      }
    }
    // 8. next month shortlist (new)
    {
      const burstList = []; compRows.forEach((x) => x.bursts.forEach((b) => burstList.push({ ...b, name: x.name, date: slice(x.r, H).dates[b.index] })));
      burstList.sort((a, b) => (a.date < b.date ? -1 : 1));
      const optimal = zone ? zone.points.filter((q) => q.optimal && q.cprp != null).sort((a, b) => a.cprp - b.cprp) : [];
      const chm = shareRows(group(R, 'chan_mix'), H, NOW);
      const quiet = chm.slice().sort((a, b) => a.chg - b.chg)[0];
      shortlist($('#sl-mk', p), [
        { title: 'Rivals to watch', sub: `Expected spend, next ${SPAN}`, rows: rivals.slice().sort((a, b) => b.next - a.next).slice(0, 4).map((x) => ({ label: short(x.name, 26), value: `${fmt.lkrc(x.next)}  ${signed(pct(x.next, x.prev), 0)}`, tone: pct(x.next, x.prev) > 10 ? 'down' : '',
            detail: { title: x.name, sub: 'Competitor spend', rows: [['Previous', fmt.lkrc(x.prev)], ['Forecast', fmt.lkrc(x.next)], ['Low case', fmt.lkrc(x.lo)], ['High case', fmt.lkrc(x.hi)], ['Change', signed(pct(x.next, x.prev), 0)]] } })),
          todo: rivals.length ? 'Defend share against the biggest riser.' : '' },
        { title: 'Bursts to prepare for', sub: 'Predicted campaign pushes', rows: burstList.slice(0, 4).map((b) => ({ label: `${short(b.name, 22)}`, value: `${String(b.date).slice(0, 10)}  ${signed(b.lift_pct, 0)}`, tone: 'down',
            detail: { title: `${b.name} burst`, sub: 'Predicted competitor campaign burst', rows: [['Date', String(b.date)], ['Lift vs average', signed(b.lift_pct, 0)]] } })),
          todo: burstList[0] ? `Lock inventory before ${String(burstList[0].date).slice(0, 10)}.` : 'No bursts predicted. Keep your flighting.' },
        { title: 'Best value to buy', sub: 'Cheapest rating points', rows: optimal.slice(0, 3).map((q) => ({ label: short(q.name, 28), value: fmt.lkrc(q.cprp),
            detail: { title: q.name, sub: 'Optimal buying zone slot', rows: [['Rating', f2(q.x)], ['Cost per spot', fmt.lkrc(q.y)], ['Cost per rating point', fmt.lkrc(q.cprp)], ['Ads per break', finite(q.clutter) ? fmt.num(q.clutter, 1) : 'n/a']] } }))
          .concat(quiet ? [{ label: `Quietest: ${fmt.title(quiet.name)}`, value: `${quiet.chg >= 0 ? '+' : ''}${quiet.chg.toFixed(1)} pts`, detail: { title: fmt.title(quiet.name), sub: 'Channel share of competitor spend', rows: [['Now', fmt.num(quiet.now, 1) + '%'], ['Forecast', fmt.num(quiet.next, 1) + '%']] } }] : []),
          todo: zone && zone.best ? `Shift weight to ${short(zone.best.name, 30)}.` : 'Load the TVR sheet to rate slots.' }]);
    }

    // 9. Competitor War-Room (LMRB sheet only)
    const warFocus = {};
    {
      const dayNum = (iso) => MR.dayFromIso(iso), hiDay = dayNum(pc.date_max), loDay = dayNum(pc.date_min), yrs = pc.history_years || 0;
      // 1. focus brand vs rivals
      const grpOf = { channel: 'adv_channel', daypart: 'adv_daypart', lang: 'adv_lang' }, dimName = { channel: 'channel', daypart: 'daypart', lang: 'language' };
      const gapRows = (dim) => {
        const vals = new Map();
        group(R, grpOf[dim]).forEach((r) => { const [a, v] = r.entity.split(' | '); const m = vals.get(v) || new Map(); m.set(a, total(slice(r, H).p50)); vals.set(v, m); });
        return [...vals.entries()].map(([v, m]) => { const me = m.get(my) || 0; const riv = [...m.entries()].filter((e) => e[0] !== my).sort((a, b) => b[1] - a[1]); const top = riv[0] || ['none', 0];
          return { value: v, focus: me, rival: top[1], rivalName: top[0], ratio: me > 0 ? top[1] / me : null, all: [...m.entries()].sort((a, b) => b[1] - a[1]) }; })
          .filter((x) => x.focus > 0 || x.rival > 0).sort((a, b) => (b.rival - b.focus) - (a.rival - a.focus));
      };
      Object.keys(grpOf).forEach((d) => { warFocus[d] = my ? gapRows(d) : []; });
      let curDim = 'channel';
      const drawFocus = () => {
        const rows = warFocus[curDim].slice(0, 8), el = document.getElementById('pm-focus'); if (!el) return;
        if (!rows.length) { if (window.Chart && Chart.getChart(el)) Chart.getChart(el).destroy(); el.style.display = 'none'; let n = el.parentElement.querySelector('.empty-note'); if (!n) { el.parentElement.insertAdjacentHTML('beforeend', `<div class="empty-note">${App.emptyState(my ? 'No data for this view' : 'Pick a Focus brand', my ? 'This product group has no spend here.' : 'Choose your brand in the Focus brand box above to see where rivals outspend you.')}</div>`); } return; }
        el.style.display = ''; const n = el.parentElement.querySelector('.empty-note'); if (n) n.remove();
        const lbl = (x) => { const nm = curDim === 'channel' ? fmt.title(x.value) : x.value; return `${short(nm, 22)}  ${x.ratio == null ? '(rival only)' : x.ratio >= 1.1 ? `(${short(x.rivalName, 14)} x${x.ratio.toFixed(1)})` : '(you lead)'}`; };
        C.make('pm-focus', { type: 'bar', data: { labels: rows.map(lbl), datasets: [{ label: my, data: rows.map((x) => x.focus), backgroundColor: C.PALETTE[0] + 'dd', borderRadius: 4, barThickness: 12 }, { label: 'Biggest rival', data: rows.map((x) => x.rival), backgroundColor: rows.map((x) => (x.rival > x.focus * 1.1 ? (C.css('--bad') || '#ff5d7a') + 'cc' : 'rgba(142,154,200,.5)')), borderRadius: 4, barThickness: 12 }] },
          detailOnly: true, detail: (i) => { const x = rows[i]; return `<div class="dt-kpis"><div class="dt-k"><span>${esc(my)}</span><b>${fmt.lkrc(x.focus)}</b></div><div class="dt-k"><span>Biggest rival</span><b>${esc(x.rivalName)}</b></div><div class="dt-k"><span>Rival spend</span><b>${fmt.lkrc(x.rival)}</b></div><div class="dt-k"><span>Rival vs you</span><b>${x.ratio == null ? 'n/a' : 'x' + x.ratio.toFixed(1)}</b></div></div><table class="dt-table"><thead><tr><th>Advertiser</th><th>Forecast spend</th></tr></thead><tbody>${x.all.map((e) => `<tr class="${e[0] === my ? 'on' : ''}"><td>${esc(e[0])}</td><td>${fmt.lkrc(e[1])}</td></tr>`).join('')}</tbody></table>`; },
          options: { indexAxis: 'y', plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { title: (it) => `${rows[it[0].dataIndex].value}`, label: (c) => `${c.dataset.label}: ${fmt.lkrc(c.parsed.x)}` } } }, scales: { x: { beginAtZero: true, ticks: { callback: (v) => fmt.compact(v) } }, y: { grid: { display: false }, ticks: { font: { size: 11 } } } } } });
      };
      drawFocus();
      p.querySelectorAll('#pmf-seg button').forEach((b) => { b.onclick = () => { curDim = b.dataset.d; p.querySelectorAll('#pmf-seg button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); drawFocus(); }; });
      const lead = (d) => warFocus[d].filter((x) => x.ratio != null && x.ratio >= 1.5).slice(0, 2);
      ev.focus = my ? [['channel', 'channel'], ['daypart', 'daypart'], ['lang', 'language']].map(([d, nme]) => { const l = lead(d); return l.length ? `By ${nme}: ${l.map((x) => `${x.rivalName} outspends ${my} x${x.ratio.toFixed(1)} on ${d === 'channel' ? fmt.title(x.value) : x.value}`).join('; ')}.` : null; }).filter(Boolean) : ['Pick a Focus brand to compare against rivals.'];
      const worst = warFocus.channel[0];
      if (my) ev.focus.push({ rec: true, text: worst && worst.ratio >= 1.5 ? `Add weight on ${fmt.title(worst.value)}, where ${worst.rivalName} is x${worst.ratio.toFixed(1)} your forecast spend, or avoid a head-on fight and win a different belt.` : 'No rival is far ahead of you anywhere. Hold your plan.' });
      evid('pm-focus', ev.focus);
      // 2. seasonal burst radar
      const fcBursts = new Map(); compRows.forEach((x) => { const b = x.bursts.map((q) => slice(x.r, H).dates[q.index]).filter(Boolean); if (b.length) fcBursts.set(x.name, b[0]); });
      const radar = Object.entries(pc.radar || {}).filter(([a]) => a !== my).map(([a, eps]) => ({ a, eps, ...MR.radarProb(eps, loDay, hiDay, H, 10) })).filter((x) => x.prob != null).sort((x, y) => y.prob - x.prob || (y.typical_lift || 0) - (x.typical_lift || 0)).slice(0, 8);
      const el = document.getElementById('pm-radar');
      if (el && radar.length) {
        const bad = C.css('--bad') || '#ff5d7a';
        C.make('pm-radar', { type: 'bar', data: { labels: radar.map((x) => `${short(x.a, 24)}  (${x.hits} of ${x.covered} years)`), datasets: [{ label: 'Chance of a spend burst', data: radar.map((x) => x.prob * 100), backgroundColor: radar.map((x) => (x.prob >= 0.67 ? bad + 'cc' : x.prob >= 0.34 ? (C.css('--warn') || '#ffb547') + 'cc' : 'rgba(142,154,200,.5)')), borderRadius: 4, barThickness: 14 }] },
          detailOnly: true, detail: (i) => { const x = radar[i]; return `<div class="dt-kpis"><div class="dt-k"><span>Chance</span><b>${(x.prob * 100).toFixed(0)}%</b></div><div class="dt-k"><span>Years with a burst</span><b>${x.hits} of ${x.covered}</b></div><div class="dt-k"><span>Typical lift</span><b>x${f1(x.typical_lift)}</b></div><div class="dt-k"><span>Forecast shows a burst</span><b>${fcBursts.get(x.a) ? String(fcBursts.get(x.a)).slice(0, 10) : 'no'}</b></div></div><div class="small">Past bursts in this window: ${x.dates.length ? esc(x.dates.join(', ')) : 'none'}.</div><div class="small muted" style="margin-top:6px">Chance = past years with a burst in the same calendar window divided by past years that fully cover it.</div>`; },
          options: { indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${c.parsed.x.toFixed(0)}% chance` } } }, scales: { x: { min: 0, max: 100, ticks: { callback: (v) => v + '%' } }, y: { grid: { display: false } } } } });
      } else if (el) el.closest('.chart-wrap').innerHTML = App.emptyState(yrs < 3 ? 'Needs about 3 years of history' : 'No repeating burst pattern', yrs < 3 ? `This sheet covers ${yrs.toFixed(1)} years. The radar compares the coming window with the same dates in at least two earlier years, so add older LMRB data (3 to 5 years is best).` : 'No rival repeats a burst in this calendar window.');
      const yTxt = `${Math.round(yrs)}-year`;
      ev.radar = radar.length ? radar.slice(0, 3).map((x) => `Based on ${yTxt} historical patterns, ${x.a} has a ${(x.prob * 100).toFixed(0)}% probability of launching a spend burst in the next ${M ? NM + ' month' + (NM === 1 ? '' : 's') : H + ' days'} (${x.hits} of ${x.covered} past years).${fcBursts.get(x.a) ? ` The forecast also shows a burst around ${String(fcBursts.get(x.a)).slice(0, 10)}.` : ''}`) : [];
      if (radar.length) ev.radar.push({ rec: true, text: radar[0].prob >= 0.5 ? `Book inventory before ${radar[0].a} moves, and plan a response flight.` : 'No rival is likely to burst in this window. Keep your flighting.' });
      evid('pm-radar', ev.radar);
      // 3. creative fatigue
      const life = (pc.lifecycle || []).slice(0, 8), fl = document.getElementById('pm-fatigue');
      if (fl && life.length) {
        const scol = { 'Refresh due': C.css('--bad') || '#ff5d7a', 'Wearing out': C.css('--warn') || '#ffb547', Ageing: C.PALETTE[4], Fresh: C.css('--good') || '#22f5a6' };
        C.make('pm-fatigue', { type: 'bar', data: { labels: life.map((x) => `${short(x.advertiser, 18)}: ${short(x.theme, 20)}  [${x.status}]`), datasets: [{ label: 'Current theme age (days)', data: life.map((x) => x.age_days), backgroundColor: life.map((x) => scol[x.status] + 'cc'), borderRadius: 4, barThickness: 11 }, { label: 'Typical theme lifespan (days)', data: life.map((x) => x.typical_days), backgroundColor: 'rgba(142,154,200,.4)', borderRadius: 4, barThickness: 11 }] },
          detailOnly: true, detail: (i) => { const x = life[i]; return `<div class="dt-kpis"><div class="dt-k"><span>Status</span><b>${x.status}</b></div><div class="dt-k"><span>Theme age</span><b>${x.age_days} days</b></div><div class="dt-k"><span>Typical lifespan</span><b>${x.typical_days ? Math.round(x.typical_days) + ' days' : 'unknown'}</b></div><div class="dt-k"><span>Expected refresh</span><b>${x.due_date || 'unknown'}</b></div><div class="dt-k"><span>Spot rate vs its peak</span><b>${x.wear_pct.toFixed(0)}%</b></div><div class="dt-k"><span>Spot length, early to late</span><b>${f1(x.dur_early)}s to ${f1(x.dur_late)}s</b></div></div><div class="small muted">${esc(x.advertiser)} / ${esc(x.theme)}. Based on ${x.finished_themes} finished theme${x.finished_themes === 1 ? '' : 's'} for this advertiser, first seen ${esc(x.first)}.${x.shorter_spots ? ' Spots have shrunk to reminders.' : ''}</div>`; },
          options: { indexAxis: 'y', plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { title: (it) => `${life[it[0].dataIndex].advertiser}: ${life[it[0].dataIndex].theme}`, label: (c) => `${c.dataset.label}: ${c.parsed.x == null ? 'unknown' : Math.round(c.parsed.x)}` } } }, scales: { x: { beginAtZero: true, title: { display: true, text: 'Days' } }, y: { grid: { display: false }, ticks: { font: { size: 10 } } } } } });
      } else if (fl) fl.closest('.chart-wrap').innerHTML = App.emptyState('No current themes found', 'Needs Advt_Theme and dates in the sheet.');
      const due = life.filter((x) => x.status === 'Refresh due'), wear = life.filter((x) => x.status === 'Wearing out');
      ev.fatigue = life.length ? [due.length ? `Due for a refresh: ${due.slice(0, 3).map((x) => `${x.advertiser} (${x.theme}, running ${x.age_days} days${x.due_date ? `, expected change around ${x.due_date}` : ''})`).join('; ')}.` : 'No rival theme is past its usual lifespan.',
        wear.length ? `Wearing out: ${wear.slice(0, 3).map((x) => `${x.advertiser} (${x.shorter_spots ? `spots shrank from ${f1(x.dur_early)}s to ${f1(x.dur_late)}s` : `${x.wear_pct.toFixed(0)}% of peak airings`})`).join('; ')}.` : null,
        { rec: true, text: due.length ? `Expect new work from ${due[0].advertiser}. Prepare a counter-message, or exploit the gap if they go quiet.` : 'No refresh is imminent. A fresh creative of your own will stand out.' }] : [];
      evid('pm-fatigue', ev.fatigue);
      // 4. clutter and first-in-break per channel x daypart
      const cdMat = (g, f) => { const rs = group(R, g).map((r) => { const [c, d] = r.entity.split(' | '); return { c, d, v: avg(slice(r, H).p50) }; }).filter((x) => finite(x.v)); if (!rs.length) return null;
        const chs = [...new Set(rs.map((x) => x.c))], order = MR.daypartOrder ? MR.daypartOrder() : [], dps = [...new Set(rs.map((x) => x.d))].sort((a, b) => order.indexOf(a) - order.indexOf(b));
        return { rs, mat: { rows: chs.map(fmt.title), cols: dps, values: chs.map((c) => dps.map((d) => { const x = rs.find((q) => q.c === c && q.d === d); return x ? x.v : null; })) } }; };
      const cl = cdMat('clutter_cd'), f2m = cdMat('first2_cd');
      $('#pm-clut2').innerHTML = cl ? C.heat(cl.mat, { fmt: (v) => fmt.num(v, 1), caption: 'Forecast ads per break' }) : App.emptyState('AdsinBrk is not in the sheet', 'Break length is needed.');
      $('#pm-first2').innerHTML = f2m ? C.heat(f2m.mat, { fmt: (v) => fmt.num(v, 0) + '%', caption: 'Forecast share of spots in position 1 or 2' }) : App.emptyState('PosinBrk is not in the sheet', 'Position in break is needed.');
      const buried = cl ? cl.rs.slice().sort((a, b) => b.v - a.v) : [], prem = f2m ? f2m.rs.slice().sort((a, b) => b.v - a.v) : [];
      ev.clut2 = cl ? [`Most crowded: ${buried.slice(0, 3).map((x) => `${fmt.title(x.c)} ${x.d} (${f1(x.v)} ads per break)`).join(', ')}.`, `Clearest: ${buried.slice(-2).reverse().map((x) => `${fmt.title(x.c)} ${x.d} (${f1(x.v)})`).join(', ')}.`, { rec: true, text: `Avoid ${fmt.title(buried[0].c)} ${buried[0].d} unless you can buy first in break.` }] : [];
      ev.first2 = f2m ? [`Premium positions are easiest in ${prem.slice(0, 3).map((x) => `${fmt.title(x.c)} ${x.d} (${f1(x.v)}% of spots)`).join(', ')}.`, `Scarcest: ${prem.slice(-2).reverse().map((x) => `${fmt.title(x.c)} ${x.d} (${f1(x.v)}%)`).join(', ')}.`, { rec: true, text: `Ask for position 1 or 2 in ${fmt.title(prem[prem.length - 1].c)} ${prem[prem.length - 1].d}, where it is rare, or buy elsewhere.` }] : [];
      evid('pm-clut2', ev.clut2); evid('pm-first2', ev.first2);
      // headline strip
      const rk = (d) => warFocus[d].filter((x) => x.ratio != null && x.ratio > 1.1).slice(0, 3);
      shortlist($('#pb-mk', p), [
        { title: 'Rivals outspending you', sub: my ? `${my}, forecast spend` : 'Pick a Focus brand', rows: my ? rk('channel').map((x) => ({ label: fmt.title(x.value), value: `${short(x.rivalName, 12)} x${x.ratio.toFixed(1)}`, tone: 'down', detail: { title: fmt.title(x.value), sub: 'Channel', rows: [[my, fmt.lkrc(x.focus)], [x.rivalName, fmt.lkrc(x.rival)]] } })).concat(rk('lang').slice(0, 1).map((x) => ({ label: x.value, value: `${short(x.rivalName, 12)} x${x.ratio.toFixed(1)}`, tone: 'down', detail: { title: x.value, sub: 'Language', rows: [[my, fmt.lkrc(x.focus)], [x.rivalName, fmt.lkrc(x.rival)]] } }))) : [], todo: my ? (worst && worst.ratio >= 1.5 ? `Defend ${fmt.title(worst.value)} first.` : 'No big gaps.') : 'Choose the Focus brand above.' },
        { title: 'Burst radar', sub: `Next ${SPAN}`, rows: radar.slice(0, 3).map((x) => ({ label: short(x.a, 22), value: `${(x.prob * 100).toFixed(0)}%`, tone: x.prob >= 0.67 ? 'down' : '', detail: { title: x.a, sub: 'Chance of a burst', rows: [['Chance', (x.prob * 100).toFixed(0) + '%'], ['Past years', `${x.hits} of ${x.covered}`], ['Typical lift', 'x' + f1(x.typical_lift)]] } })), todo: radar.length ? (radar[0].prob >= 0.5 ? `Lock inventory before ${short(radar[0].a, 20)} moves.` : 'No likely burst.') : (yrs < 3 ? 'Needs about 3 years of history.' : 'No repeating pattern.') },
        { title: 'Creative refresh', sub: 'Rival themes ageing out', rows: life.filter((x) => x.status !== 'Fresh').slice(0, 3).map((x) => ({ label: short(x.advertiser, 20), value: x.status, tone: x.status === 'Refresh due' ? 'down' : '', detail: { title: `${x.advertiser}: ${x.theme}`, sub: x.status, rows: [['Age', x.age_days + ' days'], ['Expected refresh', x.due_date || 'unknown'], ['Spot rate vs peak', x.wear_pct.toFixed(0) + '%']] } })), todo: due.length ? `${short(due[0].advertiser, 20)} is due to change creative.` : 'No rival refresh is imminent.' },
        { title: 'Where you get buried', sub: 'Ads per break, forecast', rows: buried.slice(0, 3).map((x) => ({ label: `${fmt.title(x.c)} ${x.d}`, value: `${f1(x.v)} ads`, tone: 'down', detail: { title: `${fmt.title(x.c)} ${x.d}`, sub: 'Crowded belt', rows: [['Ads per break', f1(x.v)], ['Premium position share', (() => { const q = (f2m ? f2m.rs : []).find((z) => z.c === x.c && z.d === x.d); return q ? f1(q.v) + '%' : 'n/a'; })()]] } })), todo: buried[0] ? `Buy first in break on ${fmt.title(buried[0].c)} ${buried[0].d}.` : 'Break length not in sheet.' }]);
      $('#pb-mk', p).classList.add('four');
    }
    App.predictEvidence.lmrb = { title: 'Market & Competitor Forecast', horizon: H, product_group: pc.product_group, lines: flatten(ev),
      kpis: [['Predicted competitor spend', fmt.lkrc(rivalNext)], ['Predicted spot volume', fS ? fmt.num(total(fS.p50)) : 'n/a'], ['High-clutter alert', worst ? `${worst.name}: ${fmt.num(worst.next, 1)} ads/break` : 'n/a'], ['Best estimated CPRP slot', zone && zone.best ? `${zone.best.name}: ${fmt.lkrc(zone.best.cprp)}` : 'n/a']],
      result: subset(pr.res, R, ['comp_spend', 'spots_total']) };
  }

  /* ---------------- utils ---------------- */
  function flatten(ev) { return Object.values(ev).flat().filter(Boolean).map((x) => (typeof x === 'string' ? x : (x.rec ? 'Recommendation: ' : '') + x.text)); }
  function subset(res, results, groups) {
    if (!res) return null;
    const rs = results.filter((r) => groups.includes(r.group)).slice(0, 12);
    return rs.length ? { ...res, results: rs } : null;
  }
  /** Which forecast groups stand behind each chart. */
  const NUMS = { 'pt-sticky': ['program_tvr', 'program_reach'], 'pt-decay': ['program_tvr'], 'pt-sweet': ['hour_share'], 'pm-focus': ['adv_channel', 'adv_daypart', 'adv_lang'], 'pm-clut2': ['clutter_cd'], 'pm-first2': ['first2_cd'], 'pt-fan': ['tvr_total'], 'pt-reach': ['reach_total'], 'pt-chshare': ['channel_share'], 'pt-chdp': ['chan_daypart'], 'pt-cat': ['cat_share'], 'pt-heat': ['hour_share'], 'pt-risk': ['program_tvr'], 'pt-prog': ['program_tvr'], 'pt-chtraj': ['channel_share'],
    'pm-spend': ['comp_spend'], 'pm-sov': ['sov'], 'pm-dp': ['daypart_spend'], 'pm-cps': ['cps_total'], 'pm-chmix': ['chan_mix'], 'pm-advch': ['adv_channel'], 'pm-sog': ['sog'], 'pm-cprp': ['cprp_total'],
    'pm-clutter': ['clutter', 'posinbrk'], 'pm-split': ['type_spend'], 'pm-typecps': ['type_cps'], 'pm-bubble': ['slot_rating', 'slot_cost'] };
  const valFmt = (u) => ({ currency: (v) => fmt.num(v, 0), percent: (v) => fmt.num(v, 2), rating: (v) => fmt.num(v, 3) }[u] || ((v) => fmt.num(v, 2)));
  /** Modal with the exact numbers behind a chart: actual history, forecast low case/most likely/high case, and how well the model did on recent periods. */
  function numbersModal(title, results, H, M) {
    if (!results.length) { App.toast('No numbers for this chart yet.', 'info'); return; }
    const pick = results.length > 1 ? `<div class="field" style="max-width:420px;margin-bottom:12px"><label for="nm-sel">Series</label><select id="nm-sel">${results.map((r, i) => `<option value="${i}">${esc(r.entity)}</option>`).join('')}</select></div>` : '';
    const m = App.modal(`Numbers behind: ${title}`, `<div class="banner info"><span>Rows marked <b>FORECAST</b> have not happened yet. They are estimates: most likely is the most likely value, low case a low case and high case a high case. Rows marked actual are recorded data.</span></div>${pick}<div id="nm-acc"></div><div id="nm-tbl"></div>`);
    const draw = (i) => {
      const r = results[i], f = slice(r, H), vf = valFmt(r.unit), keep = M ? 24 : 30;
      const bt0 = r.backtest, btm = new Map(bt0 ? bt0.dates.map((d, k) => [d, bt0.pred[k]]) : []);
      const hist = r.history.dates.slice(-keep).map((d, k) => { const j = r.history.dates.length - Math.min(keep, r.history.dates.length) + k; return { period: d, kind: 'actual', p10: null, p50: r.history.values[j], p90: null, back: btm.has(d) ? btm.get(d) : null }; });
      const fc = f.dates.map((d, k) => ({ period: d, kind: 'FORECAST', p10: f.p10[k], p50: f.p50[k], p90: f.p90[k], back: null }));
      const bt = r.backtest, rel = r.reliability;
      const t = trustOf(r), [lvl, tcls] = trustLvl(t);
      $('#nm-acc', m).innerHTML = `<div class="card" style="margin-bottom:12px"><h3>How much can I trust this? ${t == null ? '<span class="badge warn">Not tested</span>' : `<span class="badge ${tcls}" style="font-size:15px">Trust ${t.toFixed(0)}% (${lvl})</span>`}</h3><div class="small" style="margin-top:8px">
        Reliability: <span class="badge ${relCls[rel.level]}">${rel.level}</span> ${esc(rel.reasons.join(' '))}
        ${bt && bt.model ? `<div style="margin-top:6px">Accuracy check: the engine was tested on the last ${bt.holdout} ${r.granularity === 'monthly' ? 'months' : r.granularity === 'weekly' ? 'weeks' : 'days'} of recorded data, which it had not seen. It was off by <b>${bt.model.smape == null ? 'n/a' : fmt.num(bt.model.smape, 1) + '%'}</b> on average (a simple repeat-last-pattern guess was off by ${bt.baseline.smape == null ? 'n/a' : fmt.num(bt.baseline.smape, 1) + '%'}), and ${bt.model.coverage == null ? 'n/a' : fmt.num(bt.model.coverage, 0) + '%'} of actual values fell inside the low case to high case range (about 80% is ideal).</div>` : '<div style="margin-top:6px">There is not enough history for an accuracy test on this series.</div>'}</div></div>`;
      const box = $('#nm-tbl', m);
      App.tables.create(box, { csv: 'numbers_' + title.replace(/\W+/g, '_').toLowerCase() + '_' + r.entity.replace(/\W+/g, '_').toLowerCase(), search: false, pageSize: 40, defaultSort: { key: 'period', desc: false },
        rows: hist.concat(fc), columns: [{ key: 'period', label: r.granularity === 'monthly' ? 'Month' : r.granularity === 'weekly' ? 'Week starting' : 'Date' },
          { key: 'kind', label: 'Type', html: (v) => (v === 'FORECAST' ? '<span class="fc-pill" style="margin:0">Forecast</span>' : '<span class="badge">actual</span>') },
          { key: 'p10', label: 'Low case', num: true, fmt: (v) => (v == null ? '' : vf(v)) }, { key: 'p50', label: 'Value / Most likely', num: true, fmt: (v) => (v == null ? '' : vf(v)) }, { key: 'p90', label: 'High case', num: true, fmt: (v) => (v == null ? '' : vf(v)) }, { key: 'back', label: 'Backtest guess', num: true, fmt: (v) => (v == null ? '' : vf(v)) }] });
    };
    const sel = $('#nm-sel', m); if (sel) sel.onchange = () => draw(+sel.value);
    draw(0);
  }
  /** Puts a FORECAST pill and a Numbers button on every chart card; charts that also show history say so. */
  const OVERLAY = ['pt-fan', 'pt-reach', 'pm-cps', 'pm-cprp'];
  const HISTORY = { 'pm-radar': 'Pattern from history', 'pm-fatigue': 'Estimate from history' };
  const MIXED = ['pt-fan', 'pt-reach', 'pt-chtraj', 'pm-spend', 'pm-cps', 'pm-cprp'];
  function markForecast(p, nums) {
    p.querySelectorAll('.card').forEach((c) => {
      const h = c.querySelector('.card-head h3'); if (!h || h.querySelector('.fc-pill')) return;
      const id = (c.querySelector('canvas, [id^="pt-"], [id^="pm-"]') || {}).id || '';
      h.insertAdjacentHTML('afterbegin', `<span class="fc-pill">${HISTORY[id] || (MIXED.includes(id) ? 'Actual + forecast' : 'Forecast')}</span>`);
      c.classList.add('fc');
      if (nums && NUMS[id]) {
        const row = c.querySelector('.card-head .row');
        const mine = nums.R.filter((r) => NUMS[id].includes(r.group));
        if (row && mine.some((r) => r.backtest)) row.insertAdjacentHTML('afterbegin', trustBadge(mine));
        if (row && OVERLAY.includes(id) && mine[0] && mine[0].backtest) { row.insertAdjacentHTML('afterbegin', '<button class="btn sm ghost" type="button" data-bt title="Show what the engine would have forecast for the last recorded days, before it saw them">Backtest</button>');
          row.querySelector('[data-bt]').onclick = (e) => { const ch = window.Chart && Chart.getChart(id); if (!ch) return; const k = ch.data.datasets.findIndex((d) => /^Backtest/.test(d.label)); if (k < 0) return; const on = !ch.isDatasetVisible(k); ch.setDatasetVisibility(k, on); ch.update(); e.currentTarget.setAttribute('aria-pressed', String(on)); e.currentTarget.classList.toggle('primary', on); }; }
        if (row) { row.insertAdjacentHTML('afterbegin', '<button class="btn sm" type="button" data-nums>Numbers</button>');
          row.querySelector('[data-nums]').onclick = () => numbersModal(h.textContent.replace(/Actual \+ forecast|Forecast|\?/g, '').trim(), nums.R.filter((r) => NUMS[id].includes(r.group)), nums.H, nums.M); }
      }
    });
  }
  function wireCalendar(p, again) {
    p.querySelectorAll('[data-pins]').forEach((b) => { b.onchange = () => {
      PINS_ON = b.checked;
      p.querySelectorAll('canvas').forEach((c) => { const ch = window.Chart && Chart.getChart(c); const o = ch && ch.options.plugins && ch.options.plugins.eventPins; if (o) { o.on = PINS_ON; ch.update('none'); } });
    }; });
    p.querySelectorAll('[data-events]').forEach((b) => { b.onclick = () => eventsEditor(again); });
  }
  function wireRerun(p, key, again) {
    p.querySelectorAll('[data-rerun]').forEach((b) => { b.onclick = () => { cache.delete(key); again(); }; });
  }
  const fail = (p) => (e) => { console.error(e); p.innerHTML = App.emptyState('This prediction could not be drawn', e.message); };
  document.addEventListener('datachange', () => cache.clear());

  App.predictTabs = {
    tvr: { id: 'p-tvr', label: 'TVR & Audience Forecast', predict: true, render: (p, ctx) => tvrTab(p, ctx) },
    market: { id: 'p-market', label: 'Market & Competitor Forecast', predict: true, render: (p, ctx) => marketTab(p, ctx) },
  };
})(window.App);
