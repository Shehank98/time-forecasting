/* Forecast studio: Forecast engine forecasts, driver scenarios (ROI planning) and pacing, with save-to-client. */
(function (App) {
  const { esc, fmt, charts: C, tables: T, $, $$ } = App;
  const relCls = { High: 'good', Medium: 'warn', Low: 'bad' };
  App.lastForecast = App.lastForecast || {}; App.lastScenarios = App.lastScenarios || {}; App.lastPacing = App.lastPacing || {};
  const unitFmt = (u) => ({ currency: (v) => fmt.lkrc(v), percent: (v) => fmt.pct(v, 1), rating: (v) => fmt.num(v, 2) }[u] || fmt.compact);
  const ENT_LABEL = { advertiser: 'Advertiser', product_group: 'Product group', channel: 'Channel', daypart: 'Daypart', timebelt: 'Time-belt', program: 'Recurring programme', category: 'Category', segment: 'Segment', total: 'Total' };
  const mode = (k) => App.store.get('fc-mode:' + k, 'forecast');

  function banner(model) {
    const el = document.getElementById('forecast-banner'); if (!el) return;
    el.innerHTML = model && model.backend === 'fallback'
      ? `<div class="banner bad" role="alert"><span><b>Fallback model in use.</b> The main forecast model could not be loaded. Forecasts use seasonal naive plus exponential smoothing. Treat them with extra care.</span></div>` : '';
  }
  async function saveToClient(ctx, ftype, params, result) {
    const title = window.prompt('Name this saved ' + ftype + ' (for example "Q4 leads forecast, base case"):', '');
    if (title === null) return;
    try { await App.api.post('/api/saved-forecasts', { title: title || ftype, ftype, request: { kind: ctx.kind, dataset: ctx.dataset(), filters: ctx.filters(), options: ctx.options(), params }, result }); App.toast('Saved to the client. Find it under Client overview.', 'ok'); }
    catch (e) { App.toast(e.message, 'error'); }
  }

  /* ================================================================ forecast view */
  const cpPlugin = { id: 'cp', afterDatasetsDraw(chart, a, opts) {
    if (!opts || !opts.lines) return;
    const { ctx, chartArea: ar, scales: { x } } = chart; ctx.save(); ctx.setLineDash([4, 4]); ctx.strokeStyle = C.css('--bad') || '#d6364f'; ctx.lineWidth = 1;
    opts.lines.forEach((l) => { const px = x.getPixelForValue(l.index); if (px >= ar.left && px <= ar.right) { ctx.beginPath(); ctx.moveTo(px, ar.top); ctx.lineTo(px, ar.bottom); ctx.stroke(); } }); ctx.restore(); } };

  /* Chart view state, kept while the page is open. Big histories open on a recent window so the forecast stays readable. */
  const VIEW = { range: null, weekly: false, smooth: true, band: true, backtest: true, alerts: true };
  const RANGES = { daily: [['3m', '3 months', 91], ['6m', '6 months', 182], ['1y', '1 year', 365], ['all', 'All', Infinity]],
    weekly: [['6m', '6 months', 26], ['1y', '1 year', 52], ['2y', '2 years', 104], ['all', 'All', Infinity]],
    monthly: [['1y', '1 year', 12], ['2y', '2 years', 24], ['3y', '3 years', 36], ['all', 'All', Infinity]] };
  const defaultRange = (gran, n) => (gran === 'daily' ? (n > 120 ? '3m' : 'all') : gran === 'weekly' ? (n > 60 ? '1y' : 'all') : (n > 30 ? '2y' : 'all'));
  const weekStart = (iso) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
  /** Sums (or averages) daily points into Monday-start weeks. */
  function toWeeks(dates, vals, additive) {
    const m = new Map();
    dates.forEach((d, i) => { const k = weekStart(d), v = vals[i]; if (v == null || !Number.isFinite(v)) return; const g = m.get(k) || { s: 0, n: 0 }; g.s += v; g.n++; m.set(k, g); });
    const keys = [...m.keys()].sort();
    return { dates: keys, vals: keys.map((k) => (additive ? m.get(k).s : m.get(k).s / m.get(k).n)), counts: keys.map((k) => m.get(k).n) };
  }
  const rolling = (a, k) => a.map((_, i) => { const w = a.slice(Math.max(0, i - k + 1), i + 1).filter((v) => v != null && Number.isFinite(v)); return w.length ? w.reduce((x, y) => x + y, 0) / w.length : null; });
  const tickFmt = (gran) => (iso) => { const d = new Date(String(iso).slice(0, 10) + 'T00:00:00Z'); if (Number.isNaN(d.getTime())) return iso;
    return gran === 'monthly' ? d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' }) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }); };

  /** The series as drawn: optional weekly totals for daily data, then the history window. */
  function shape(r) {
    const add = !!(r.outlook && r.outlook.additive), daily = r.granularity === 'daily', weekly = daily && VIEW.weekly;
    let hd = r.history.dates, hv = r.history.values, fd = r.forecast.dates, f10 = r.forecast.p10, f50 = r.forecast.p50, f90 = r.forecast.p90, gran = r.granularity, partialNote = '';
    if (weekly) {
      const h = toWeeks(hd, hv, add), f = toWeeks(fd, f50, add);
      // forecast range of a week: days are combined as if they vary independently, which is far closer than adding up daily low and high cases
      const m = new Map(); fd.forEach((d, i) => { const k = weekStart(d), g = m.get(k) || { lo: 0, hi: 0 }; g.lo += (f50[i] - f10[i]) ** 2; g.hi += (f90[i] - f50[i]) ** 2; m.set(k, g); });
      let lo = f.dates.map((k, j) => (add ? Math.max(0, f.vals[j] - Math.sqrt(m.get(k).lo)) : f.vals[j] - Math.sqrt(m.get(k).lo) / f.counts[j]));
      let hi = f.dates.map((k, j) => (add ? f.vals[j] + Math.sqrt(m.get(k).hi) : f.vals[j] + Math.sqrt(m.get(k).hi) / f.counts[j]));
      const notes = [];
      if (add) {
        // a week split between history and forecast is shown once, as the forecast week including its recorded days
        if (h.dates.length && f.dates.length && h.dates[h.dates.length - 1] === f.dates[0]) {
          const part = h.vals[h.vals.length - 1]; f.vals[0] += part; lo[0] += part; hi[0] += part; f.counts[0] += h.counts[h.counts.length - 1];
          h.dates.pop(); h.vals.pop(); h.counts.pop(); notes.push('The first forecast week includes the recorded days of that week.');
        }
        if (h.counts.length && h.counts[0] < 7) { h.dates.shift(); h.vals.shift(); h.counts.shift(); notes.push('The first, incomplete week of history is left out.'); }
        if (f.counts.length > 1 && f.counts[f.counts.length - 1] < 7) { f.dates.pop(); f.vals.pop(); f.counts.pop(); lo.pop(); hi.pop(); notes.push('The last forecast week is incomplete and is left out.'); }
      }
      partialNote = notes.join(' ');
      hd = h.dates; hv = h.vals; fd = f.dates; f50 = f.vals; f10 = lo; f90 = hi; gran = 'weekly';
    }
    const opts = RANGES[gran], key = VIEW.range && opts.some((o) => o[0] === VIEW.range) ? VIEW.range : defaultRange(gran, hd.length);
    const keep = (opts.find((o) => o[0] === key) || opts[opts.length - 1])[2], start = Math.max(0, hd.length - keep);
    return { gran, weekly, add, key, start, hd: hd.slice(start), hv: hv.slice(start), allHd: hd, allHv: hv, fd, f10, f50, f90, partialNote };
  }

  const alphaC = (c, a) => (/^#[0-9a-f]{6}$/i.test(c) ? c + Math.round(a * 255).toString(16).padStart(2, '0') : /^hsl\(/.test(c) ? c.replace(')', ` / ${a})`) : c);
  /** HTML legend under the chart: plain words and clear swatches instead of the default circles. */
  function legendHtml(items) {
    return `<div class="fc-legend">${items.map((x) => `<span class="fc-lg"><i class="fc-sw ${x.kind}" style="--sw:${x.color}"></i>${esc(x.label)}</span>`).join('')}</div>`;
  }
  /**
   * Main chart. Daily view: each day is a soft bar (grey recorded, blue forecast) with a bold trend line (7-day average)
   * that runs solid through history and dashed through the forecast, so both halves read the same way.
   * Weekly or monthly: solid actual line with points, dashed forecast line with points.
   * The likely range (low to high case) is drawn only over the forecast.
   */
  function drawChart(id, r) {
    const v = shape(r), nh = v.hd.length, nf = v.fd.length, labels = v.hd.concat(v.fd);
    const col = C.PALETTE[0], txt = C.css('--text') || '#222', mut = C.css('--muted') || '#8a93b8', vf = unitFmt(r.unit), daily = v.gran === 'daily';
    const trend = daily && VIEW.smooth && nh > 14;
    const nulls = (n) => Array(n).fill(null);
    const ds = [], legend = [];
    // likely range: smoothed for daily trend view so it reads as a band, not a jagged blob
    if (VIEW.band) {
      const all10 = v.hv.concat(v.f10), all90 = v.hv.concat(v.f90);
      const lo = trend ? rolling(all10, 7).slice(nh) : v.f10, hi = trend ? rolling(all90, 7).slice(nh) : v.f90;
      const join = trend ? rolling(v.hv, 7)[nh - 1] : v.hv[nh - 1];
      ds.push({ type: 'line', label: 'High case', data: nulls(nh - 1).concat([join], hi), borderColor: 'transparent', backgroundColor: alphaC(col, 0.16), fill: '+1', pointRadius: 0, tension: 0.3, order: 6 });
      ds.push({ type: 'line', label: 'Low case', data: nulls(nh - 1).concat([join], lo), borderColor: alphaC(col, 0.35), borderWidth: 0, backgroundColor: alphaC(col, 0.16), fill: false, pointRadius: 0, tension: 0.3, order: 6 });
      legend.push({ kind: 'band', color: alphaC(col, 0.3), label: `Likely range (low to high case)${trend ? ', 7-day average' : ''}` });
    }
    if (trend) {
      ds.push({ type: 'bar', label: 'Actual (each day)', data: v.hv.concat(nulls(nf)), backgroundColor: alphaC(mut, 0.35), borderWidth: 0, barPercentage: 1, categoryPercentage: 0.9, order: 5 });
      ds.push({ type: 'bar', label: 'Forecast (each day)', data: nulls(nh).concat(v.f50), backgroundColor: alphaC(col, 0.35), borderWidth: 0, barPercentage: 1, categoryPercentage: 0.9, order: 5 });
      const tr = rolling(v.hv.concat(v.f50), 7);
      ds.push({ type: 'line', label: 'Actual trend (7-day average)', data: tr.slice(0, nh).concat(nulls(nf)), borderColor: txt, borderWidth: 3, pointRadius: 0, tension: 0.35, order: 1 });
      ds.push({ type: 'line', label: 'Forecast trend (7-day average)', data: nulls(nh - 1).concat(tr.slice(nh - 1)), borderColor: col, borderWidth: 3, borderDash: [7, 5], pointRadius: 0, tension: 0.35, order: 1 });
      legend.unshift({ kind: 'bar', color: alphaC(mut, 0.6), label: 'Actual, each day' }, { kind: 'line', color: txt, label: 'Actual trend (7-day average)' },
        { kind: 'bar', color: alphaC(col, 0.6), label: 'Forecast, each day' }, { kind: 'dash', color: col, label: 'Forecast trend (7-day average)' });
    } else {
      const pts = nh + nf > 90 ? 0 : 3;
      ds.push({ type: 'line', label: v.weekly ? 'Actual (weekly total)' : 'Actual', data: v.hv.concat(nulls(nf)), borderColor: txt, backgroundColor: txt, borderWidth: 2.5, pointRadius: pts, tension: 0.2, order: 1 });
      ds.push({ type: 'line', label: 'Most likely forecast', data: nulls(nh - 1).concat([v.hv[nh - 1]], v.f50), borderColor: col, backgroundColor: col, borderWidth: 2.5, borderDash: [7, 5], pointRadius: pts, tension: 0.2, order: 1 });
      legend.unshift({ kind: 'line', color: txt, label: v.weekly ? 'Actual (weekly total)' : 'Actual' }, { kind: 'dash', color: col, label: 'Most likely forecast' });
    }
    if (VIEW.alerts && !v.weekly) {
      const marks = nulls(labels.length);
      r.anomalies.forEach((a) => { const i = labels.indexOf(a.date); if (i >= 0) marks[i] = a.value; });
      (r.band_breaches || []).forEach((b) => { const i = labels.indexOf(b.date); if (i >= 0) marks[i] = b.actual; });
      if (marks.some((x) => x != null)) { ds.push({ type: 'line', label: 'Alert', data: marks, showLine: false, pointStyle: 'triangle', pointRadius: 7, borderColor: C.css('--bad') || 'red', backgroundColor: C.css('--bad') || 'red', order: 0 });
        legend.push({ kind: 'tri', color: C.css('--bad') || 'red', label: 'Alert (unusual day)' }); }
    }
    const hide = ['Low case', 'High case'], tf = tickFmt(v.gran);
    C.make(id, { type: 'bar', data: { labels, datasets: ds }, plugins: [cpPlugin, C.nowLine],
      options: { interaction: { mode: 'index', intersect: false }, animation: labels.length > 400 ? false : undefined,
        plugins: { legend: { display: false }, nowLine: { index: nh - 1 },
          cp: { lines: r.change_points.map((c) => ({ index: labels.indexOf(v.weekly ? weekStart(c.date) : c.date) })).filter((l) => l.index >= 0) },
          tooltip: { filter: (i) => !hide.includes(i.dataset.label) && i.parsed.y != null, callbacks: { title: (it) => `${tf(it[0].label)}${v.weekly ? ' (week)' : ''}  ·  ${it[0].dataIndex >= nh ? 'FORECAST' : 'actual'}`,
            label: (c) => `${c.dataset.label}: ${vf(c.parsed.y)}`, afterBody: (it) => { const k = it[0].dataIndex - nh; return k >= 0 && k < nf ? [`Likely range: ${vf(v.f10[k])} to ${vf(v.f90[k])}`] : []; } } } },
        scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8, autoSkip: true, maxRotation: 0, callback(val) { return tf(this.getLabelForValue(val)); } } },
          y: { beginAtZero: v.add, grace: '5%', ticks: { maxTicksLimit: 6, callback: (x) => vf(x) } } } } });
    const lg = document.getElementById(id + '-legend'); if (lg) lg.innerHTML = legendHtml(legend);
    drawOverview(id + '-ov', r, v);
    drawBacktest(id + '-bt', r);
    const note = document.getElementById(id + '-note');
    if (note) note.textContent = [v.start > 0 ? `Showing the last ${nh} of ${v.allHd.length} ${v.weekly ? 'weeks' : r.granularity === 'daily' ? 'days' : r.granularity === 'weekly' ? 'weeks' : 'months'} and the forecast. Pick a range to see more.` : '', v.weekly ? 'Weekly ranges combine the daily ranges as if days vary independently, so they are approximate.' : '', v.partialNote].filter(Boolean).join(' ');
  }

  /**
   * Backtest check, in its own panel: for the last N periods the engine was asked to forecast without seeing them.
   * Bars = what really happened, orange line = what the engine predicted, shaded = its range. Tooltip shows the miss.
   */
  function drawBacktest(id, r) {
    const box = document.getElementById(id + '-box'); if (!box) return;
    const bt = r.backtest;
    if (!VIEW.backtest || !bt || !bt.dates || !bt.dates.length) { box.hidden = true; return; }
    box.hidden = false;
    const vf = unitFmt(r.unit), tf = tickFmt(r.granularity), warn = C.css('--warn') || '#ffb547', mut = C.css('--muted') || '#8a93b8';
    const act = bt.actual || bt.dates.map((d) => { const i = r.history.dates.indexOf(d); return i >= 0 ? r.history.values[i] : null; });
    const miss = bt.dates.map((d, k) => (act[k] != null && bt.pred[k] != null ? bt.pred[k] - act[k] : null));
    const totA = act.reduce((s, x) => s + (x || 0), 0), totP = bt.pred.reduce((s, x) => s + (x || 0), 0);
    const inBand = bt.p10 ? bt.dates.filter((d, k) => act[k] != null && act[k] >= bt.p10[k] && act[k] <= bt.p90[k]).length : null;
    const head = box.querySelector('.fc-bt-head');
    if (head) head.innerHTML = `<b>Backtest check</b>: the engine forecast the last ${bt.dates.length} ${r.granularity === 'daily' ? 'days' : r.granularity === 'weekly' ? 'weeks' : 'months'} without seeing them.
      <span class="fc-bt-kpis"><span>Accuracy <b>${bt.accuracy == null ? 'n/a' : fmt.num(bt.accuracy, 0) + '%'}</b></span><span>Total predicted <b>${vf(totP)}</b> vs actual <b>${vf(totA)}</b> (${totA ? (totP >= totA ? '+' : '') + fmt.num((totP / totA - 1) * 100, 0) + '%' : 'n/a'})</span>${inBand != null ? `<span>Inside the likely range <b>${inBand} of ${bt.dates.length}</b></span>` : ''}</span>`;
    const ds = [];
    if (bt.p10 && bt.p90) {
      ds.push({ type: 'line', label: 'High case', data: bt.p90, borderColor: 'transparent', backgroundColor: alphaC(warn, 0.15), fill: '+1', pointRadius: 0, order: 5 });
      ds.push({ type: 'line', label: 'Low case', data: bt.p10, borderColor: 'transparent', backgroundColor: alphaC(warn, 0.15), fill: false, pointRadius: 0, order: 5 });
    }
    ds.push({ type: 'bar', label: 'What really happened', data: act, backgroundColor: alphaC(mut, 0.55), borderWidth: 0, barPercentage: 0.8, order: 3 });
    ds.push({ type: 'line', label: 'What the engine predicted', data: bt.pred, borderColor: warn, backgroundColor: warn, borderWidth: 2.5, pointRadius: bt.dates.length > 40 ? 0 : 3.5, tension: 0.2, order: 1 });
    const hide = ['Low case', 'High case'];
    C.make(id, { type: 'bar', data: { labels: bt.dates, datasets: ds },
      options: { interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: false },
        tooltip: { filter: (i) => !hide.includes(i.dataset.label) && i.parsed.y != null, callbacks: { title: (it) => `${tf(it[0].label)}  ·  backtest`, label: (c) => `${c.dataset.label}: ${vf(c.parsed.y)}`,
          afterBody: (it) => { const k = it[0].dataIndex, m = miss[k]; return m == null ? [] : [`Miss: ${m >= 0 ? '+' : ''}${vf(m)}${act[k] ? ` (${m >= 0 ? '+' : ''}${fmt.num(m / act[k] * 100, 0)}%)` : ''}`]; } } } },
        scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 10, maxRotation: 0, callback(val) { return tf(this.getLabelForValue(val)); } } }, y: { beginAtZero: true, ticks: { maxTicksLimit: 5, callback: (x) => vf(x) } } } },
      detail: (k) => `<div class="dt-kpis"><div class="dt-k"><span>Actual</span><b>${vf(act[k])}</b></div><div class="dt-k"><span>Predicted</span><b>${vf(bt.pred[k])}</b></div><div class="dt-k"><span>Miss</span><b>${miss[k] == null ? 'n/a' : vf(miss[k])}</b></div>${bt.p10 ? `<div class="dt-k"><span>Likely range</span><b>${vf(bt.p10[k])} to ${vf(bt.p90[k])}</b></div>` : ''}</div>` });
    const lg = box.querySelector('.fc-legend-host');
    if (lg) lg.innerHTML = legendHtml([{ kind: 'bar', color: alphaC(mut, 0.8), label: 'What really happened' }, { kind: 'line', color: warn, label: 'What the engine predicted' }].concat(bt.p10 ? [{ kind: 'band', color: alphaC(warn, 0.3), label: 'Its likely range' }] : []));
  }
  /** Small full-history strip under the chart, with the window that is shown above highlighted. */
  function drawOverview(id, r, v) {
    const el = document.getElementById(id); if (!el) return;
    const labels = v.allHd.concat(v.fd), col = C.PALETTE[0], n = v.allHd.length;
    const win = { id: 'win', beforeDatasetsDraw(chart) { const { ctx, chartArea: ar, scales: { x } } = chart; const x0 = x.getPixelForValue(v.start), x1 = x.getPixelForValue(n - 1);
      ctx.save(); ctx.fillStyle = (C.css('--accent') || '#3de0ff') + '22'; ctx.strokeStyle = (C.css('--accent') || '#3de0ff') + '88'; ctx.fillRect(x0, ar.top, x1 - x0, ar.bottom - ar.top); ctx.strokeRect(x0, ar.top, x1 - x0, ar.bottom - ar.top);
      ctx.fillStyle = C.css('--fc-zone') || 'rgba(139,92,246,.12)'; ctx.fillRect(x1, ar.top, ar.right - x1, ar.bottom - ar.top); ctx.restore(); } };
    C.make(id, { type: 'line', noDetail: true, data: { labels, datasets: [
      { data: v.allHv.concat(Array(v.fd.length).fill(null)), borderColor: C.css('--muted') || '#888', borderWidth: 1, pointRadius: 0 },
      { data: Array(n - 1).fill(null).concat([v.allHv[n - 1]], v.f50), borderColor: col, borderWidth: 1.5, borderDash: [4, 3], pointRadius: 0 }] }, plugins: [win],
      options: { animation: false, events: [], plugins: { legend: { display: false }, tooltip: { enabled: false } }, scales: { x: { display: false }, y: { display: false, beginAtZero: v.add } } } });
  }
  /** Range, daily/weekly, smoothing and layer controls above the chart. */
  function chartControls(r) {
    const daily = r.granularity === 'daily', gran = daily && VIEW.weekly ? 'weekly' : r.granularity, n = daily && VIEW.weekly ? Math.ceil(r.history.dates.length / 7) : r.history.dates.length;
    const cur = VIEW.range && RANGES[gran].some((o) => o[0] === VIEW.range) ? VIEW.range : defaultRange(gran, n);
    const seg = (name, items, on) => `<div class="seg" data-ctl="${name}">${items.map(([k, l]) => `<button type="button" data-v="${k}" aria-pressed="${k === on}">${l}</button>`).join('')}</div>`;
    const chk = (k, l, on, dis) => `<label class="row small" style="gap:4px"><input type="checkbox" data-layer="${k}" ${on ? 'checked' : ''} ${dis ? 'disabled' : ''}> ${l}</label>`;
    return `<div class="fc-controls">${seg('range', RANGES[gran].map((o) => [o[0], o[1]]), cur)}
      ${daily ? seg('grain', [['day', 'Daily'], ['week', 'Weekly totals']], VIEW.weekly ? 'week' : 'day') : ''}
      ${daily && !VIEW.weekly ? chk('smooth', '7-day average', VIEW.smooth) : ''}${chk('band', 'Range band', VIEW.band)}${chk('backtest', 'Backtest check', VIEW.backtest, !r.backtest)}${chk('alerts', 'Alerts', VIEW.alerts, VIEW.weekly)}</div>`;
  }
  function wireChart(box, r) {
    const host = box.querySelector('[data-chart="c-fc"] .ff'); if (!host) return;
    let ctl = host.querySelector('.fc-controls-host');
    if (!ctl) { const wrap = host.querySelector('.chart-wrap'); wrap.insertAdjacentHTML('beforebegin', '<div class="fc-controls-host"></div>'); wrap.insertAdjacentHTML('afterend', '<div id="c-fc-legend"></div><div class="chart-wrap overview"><canvas id="c-fc-ov" aria-hidden="true"></canvas></div><div class="muted small" id="c-fc-note" style="margin-top:4px"></div><div class="fc-bt" id="c-fc-bt-box" hidden><div class="fc-bt-head small"></div><div class="chart-wrap fc-bt-wrap"><canvas id="c-fc-bt" aria-label="Backtest check"></canvas></div><div class="fc-legend-host"></div></div>'); ctl = host.querySelector('.fc-controls-host'); }
    const redraw = () => { ctl.innerHTML = chartControls(r); bind(); drawChart('c-fc', r); };
    const bind = () => {
      ctl.querySelectorAll('[data-ctl="range"] button').forEach((b) => { b.onclick = () => { VIEW.range = b.dataset.v; redraw(); }; });
      ctl.querySelectorAll('[data-ctl="grain"] button').forEach((b) => { b.onclick = () => { VIEW.weekly = b.dataset.v === 'week'; VIEW.range = null; redraw(); }; });
      ctl.querySelectorAll('[data-layer]').forEach((c) => { c.onchange = () => { VIEW[c.dataset.layer] = c.checked; redraw(); }; });
    };
    redraw();
  }

  function entityView(box, res, r) {
    const rel = r.reliability, o = r.outlook, vf = unitFmt(r.unit), add = o.additive;
    const m = r.backtest ? r.backtest.model : null, b = r.backtest ? r.backtest.baseline : null;
    const blk = o.block === 'month' ? 'month' : 'week';
    box.innerHTML = `
      <div class="row" style="margin-bottom:12px"><h3>${esc(r.entity)}: ${esc(r.metric_label)}</h3><span class="badge ${relCls[rel.level]}" title="${esc(rel.reasons.join(' '))}">Forecast reliability: ${rel.level}</span>
        <span class="badge info">${r.n_points} ${r.granularity} points</span><span class="badge ${res.backend === 'timesfm' ? 'good' : 'warn'}">${res.backend === 'timesfm' ? 'Forecast engine' : 'Fallback model'}</span></div>
      <ul class="muted small" style="margin:0 0 12px;padding-left:18px">${rel.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}${r.warnings.map((x) => `<li><b>Warning:</b> ${esc(x)}</li>`).join('')}</ul>
      ${C.box('c-fc', 'Actuals and forecast', 'Grey = recorded, blue = forecast. The bold line is the trend; it turns dashed where the forecast starts. The backtest check below shows how close the engine got on recent days it did not see.', { tall: true, pill: 'Actual + forecast' })}
      <div class="grid g2" style="margin-top:16px">
        <div class="card"><h3>Outlook</h3><div class="stack" style="gap:8px;margin-top:10px">
          <div>Trend: <span class="badge ${o.trend === 'rising' ? 'good' : o.trend === 'falling' ? 'bad' : 'info'}">${esc(o.trend)}</span> ${o.trend_change_pct != null ? fmt.delta(o.trend_change_pct) + ' vs recent' : ''}</div>
          ${add ? `<div>Expected next ${o.n_weeks} ${blk}${o.n_weeks === 1 ? '' : 's'}: <b>${vf(o.expected_next_4w)}</b> <span class="muted small">(indicative range ${vf(o.expected_next_4w_p10)} to ${vf(o.expected_next_4w_p90)})</span></div>
          <div>Active ${blk}s: <b>${o.active_weeks}</b> of ${o.n_weeks}, quiet: <b>${o.inactive_weeks}</b></div>
          <div>Burst ${blk}s: ${o.burst_windows.length ? o.burst_windows.map((w) => `<span class="badge warn">${esc(w)}</span>`).join(' ') : '<span class="muted">none expected</span>'}</div>` : `<div>Average next ${o.n_weeks} ${blk}s: <b>${vf(o.avg_next_4w)}</b></div>`}
          ${o.n_weeks < (blk === 'month' ? 3 : 4) ? '<div class="muted small">The horizon is short, so the outlook covers fewer periods.</div>' : ''}</div></div>
        <div class="card"><h3>Demand peaks and launch timing</h3><div class="small" style="margin-top:10px">${r.peaks.peaks.length ? r.peaks.peaks.map((p) => `<div style="margin-bottom:6px">Peak around <b>${esc(p.date)}</b>: ${vf(p.expected)} ${p.vs_history_pct != null ? `(${fmt.delta(p.vs_history_pct)} vs the historical average)` : ''}. Be live by <b>${esc(p.launch_by)}</b>.</div>`).join('')
          : '<div class="muted">No clear peak above normal in this horizon.</div>'}
          ${r.peaks.season_peak ? `<div class="muted" style="margin-top:6px">Seasonal high month in history: ${new Date(2000, r.peaks.season_peak.month - 1, 1).toLocaleString('en', { month: 'long' })} (index ${fmt.num(r.peaks.season_peak.index_vs_avg)}).</div>` : ''}</div></div>
        <div class="card"><h3>Backtest (last ${r.backtest ? r.backtest.holdout : 0} points)</h3>${m ? `<table class="tbl" style="margin-top:8px"><thead><tr><th>Metric</th><th class="num">Forecast</th><th class="num">${esc(b.name)}</th></tr></thead><tbody>
          <tr><td>Accuracy ${r.backtest.accuracy_basis ? `(100 − ${esc(r.backtest.accuracy_basis)})` : ''}</td><td class="num"><b>${r.backtest.accuracy == null ? 'n/a' : fmt.num(r.backtest.accuracy, 0) + '%'}</b></td><td class="num muted">${r.backtest.accuracy_basis === 'WAPE' ? 'near-zero days, so sMAPE is not used' : ''}</td></tr>
          <tr><td>sMAPE</td><td class="num">${m.smape == null ? 'n/a' : fmt.num(m.smape, 1) + '%'}</td><td class="num">${b.smape == null ? 'n/a' : fmt.num(b.smape, 1) + '%'}</td></tr>
          <tr><td>WAPE</td><td class="num">${m.wape == null ? 'n/a' : fmt.num(m.wape, 1) + '%'}</td><td class="num muted">total error / total actual</td></tr>
          <tr><td>MAE</td><td class="num">${fmt.compact(m.mae)}</td><td class="num">${fmt.compact(b.mae)}</td></tr>
          <tr><td>MASE</td><td class="num">${m.mase == null ? 'n/a' : fmt.num(m.mase, 2)}</td><td class="num">${b.mase == null ? 'n/a' : fmt.num(b.mase, 2)}</td></tr>
          <tr><td>Inside low case to high case</td><td class="num">${m.coverage == null ? 'n/a' : fmt.num(m.coverage, 0) + '%'}</td><td class="num muted">target about 80%</td></tr></tbody></table>
          <div class="muted small" style="margin-top:6px">${m.mae <= b.mae ? 'The forecast beat the baseline on MAE.' : 'The baseline was at least as accurate on MAE.'} MASE below 1 means better than repeating last week's pattern. sMAPE reads about 200% on a zero day, so judge zero-heavy series by WAPE and MASE.${r.backtest.engine ? `<br>Method chosen by this check: <b>${esc(r.backtest.engine.label)}</b>.` : ''}</div>` : '<div class="muted" style="margin-top:8px">History is too short for a backtest.</div>'}</div>
        <div class="card"><h3>Monitoring alerts</h3><div class="small" style="margin-top:8px">${(r.band_breaches || []).length ? r.band_breaches.map((x) => `<div style="margin-bottom:4px"><span class="badge ${x.severity === 'high' ? 'bad' : 'warn'}">${x.direction}</span> ${esc(x.text)} (actual ${vf(x.actual)}, expected ${vf(x.p10)} to ${vf(x.p90)})</div>`).join('')
          : '<div class="muted">Recent actuals stayed inside the expected band.</div>'}
          ${r.change_points.length ? r.change_points.map((c) => `<div>Level shift on <b>${esc(c.date)}</b>: ${vf(c.before)} to ${vf(c.after)} ${c.change_pct != null ? fmt.delta(c.change_pct) : ''}</div>`).join('') : ''}
          ${r.anomalies.length ? `<div style="margin-top:6px">${r.anomalies.length} unusual point${r.anomalies.length === 1 ? '' : 's'} in history: ${r.anomalies.slice(0, 4).map((a) => `${esc(a.date)} (${a.direction})`).join(', ')}${r.anomalies.length > 4 ? ', ...' : ''}</div>` : ''}</div></div></div>
      <div class="card" style="margin-top:16px"><h3>Forecast values</h3><div id="fc-table"></div></div>`;
    wireChart(box, r);
    T.create(box.querySelector('#fc-table'), { csv: 'forecast_' + r.entity.replace(/\W+/g, '_'), pageSize: 14, defaultSort: { key: 'date', desc: false },
      rows: r.forecast.dates.map((d, i) => ({ date: d, p10: r.forecast.p10[i], p50: r.forecast.p50[i], p90: r.forecast.p90[i] })),
      columns: [{ key: 'date', label: r.granularity === 'daily' ? 'Date' : r.granularity === 'weekly' ? 'Week starting' : 'Month' }, { key: 'p10', label: 'Low case', num: true, fmt: (v) => fmt.num(v, 2) }, { key: 'p50', label: 'Most likely', num: true, fmt: (v) => fmt.num(v, 2) }, { key: 'p90', label: 'High case', num: true, fmt: (v) => fmt.num(v, 2) }] });
  }

  function forecastResults(root, res, ctx, params, savedNote) {
    banner(res.model);
    const rs = res.results, et = res.params.entity_type;
    const rising = rs.filter((r) => r.outlook.trend === 'rising').sort((a, b) => b.outlook.trend_change_pct - a.outlook.trend_change_pct);
    const falling = rs.filter((r) => r.outlook.trend === 'falling').sort((a, b) => a.outlook.trend_change_pct - b.outlook.trend_change_pct);
    const nm = { timebelt: 'time-belts', channel: 'channels', category: 'categories', daypart: 'dayparts', advertiser: 'competitors', segment: 'segments', product_group: 'product groups', program: 'programmes' }[et] || 'entities';
    const li = (r) => `<li><b>${esc(r.entity)}</b> ${fmt.delta(r.outlook.trend_change_pct)} <span class="badge ${relCls[r.reliability.level]}">${r.reliability.level}</span></li>`;
    const breaches = rs.reduce((a, r) => a + (r.band_breaches || []).length, 0);
    root.innerHTML = `${savedNote ? `<div class="banner info"><span>${esc(savedNote)}</span></div>` : ''}${(res.notes || []).map((n) => `<div class="banner info"><span>${esc(n)}</span></div>`).join('')}
      ${res.covariate_note ? `<div class="banner info"><span>${esc(res.covariate_note)}</span></div>` : ''}
      ${res.covariates_used && res.covariates_used.length ? `<div class="banner info"><span>Calendar covariates used: ${esc(res.covariates_used.join(', '))}.</span></div>` : ''}
      ${rs.length > 1 ? `<div class="grid g2" style="margin-bottom:16px"><div class="card"><h3>Emerging ${nm}</h3><ul class="small" style="margin:8px 0 0;padding-left:18px">${rising.slice(0, 6).map(li).join('') || '<li class="muted">None rising more than 10%.</li>'}</ul></div>
        <div class="card"><h3>Declining ${nm}</h3><ul class="small" style="margin:8px 0 0;padding-left:18px">${falling.slice(0, 6).map(li).join('') || '<li class="muted">None falling more than 10%.</li>'}</ul></div></div>` : ''}
      <div class="card" style="margin-bottom:16px"><div class="card-head"><div><h3>Outlook summary</h3><div class="sub">${rs.length} ${nm} forecast in one batched call${breaches ? `, ${breaches} monitoring alert${breaches === 1 ? '' : 's'}` : ''}${res.cached ? ', served from cache' : ''}.</div></div>
        <div class="row"><button class="btn sm" id="fc-save" type="button">Save to client</button></div></div><div id="fc-sum"></div></div>
      <div class="row" style="margin-bottom:12px"><label class="lbl" for="fc-ent">Entity</label><select id="fc-ent" style="max-width:340px">${rs.map((r, i) => `<option value="${i}">${esc(r.entity)} (${r.reliability.level})</option>`).join('')}</select></div><div id="fc-detail"></div>`;
    const addv = rs[0].outlook.additive, vf = unitFmt(rs[0].unit);
    T.create(root.querySelector('#fc-sum'), { csv: 'forecast_outlook', search: rs.length > 10, pageSize: 12, defaultSort: { key: 'chg', desc: true },
      rows: rs.map((r) => ({ entity: r.entity, rel: r.reliability.level, trend: r.outlook.trend, chg: r.outlook.trend_change_pct, exp: addv ? r.outlook.expected_next_4w : r.outlook.avg_next_4w,
        act: addv ? `${r.outlook.active_weeks} active / ${r.outlook.inactive_weeks} quiet` : '', peak: r.peaks.peaks.length ? r.peaks.peaks[0].date : '', alerts: (r.band_breaches || []).length })),
      columns: [{ key: 'entity', label: ENT_LABEL[et] || 'Entity', html: (v) => `<span class="swatch" style="background:${C.colorFor(v)}"></span>${esc(v)}` }, { key: 'rel', label: 'Reliability', html: (v) => `<span class="badge ${relCls[v]}">${v}</span>` },
        { key: 'trend', label: 'Trend', fmt: fmt.title }, { key: 'chg', label: 'Change vs recent', num: true, html: (v) => fmt.delta(v) }, { key: 'exp', label: addv ? 'Expected next 4 weeks' : 'Average next 4 weeks', num: true, fmt: (v) => vf(v) },
        { key: 'act', label: 'Activity' }, { key: 'peak', label: 'Next peak' }, { key: 'alerts', label: 'Alerts', num: true }] });
    const sel = root.querySelector('#fc-ent'); const show = () => entityView(root.querySelector('#fc-detail'), res, rs[+sel.value]); sel.onchange = show; show();
    root.querySelector('#fc-save').onclick = () => saveToClient(ctx, 'forecast', params, res);
  }

  /* ================================================================ scenarios view */
  function scenarioResults(root, res, ctx, params) {
    const s = res.scenarios, vfD = fmt.lkrc, vfK = (v) => fmt.num(v, 0), ratioLabel = params.ratio_label || 'Cost per result';
    const base = s.find((x) => x.scenario === 'Current pace');
    const hist = res.historical_ratio;
    let rec = null;
    if (base) {
      const ok = s.filter((x) => x.driver_total > base.driver_total && x.marginal_ratio != null && hist != null && x.marginal_ratio <= hist * 1.5);
      rec = ok.length ? ok.sort((a, b) => b.driver_total - a.driver_total)[0] : null;
    }
    root.innerHTML = `${res.warnings.map((w) => `<div class="banner"><span>${esc(w)}</span></div>`).join('')}
      <div class="banner info"><span>${res.method === 'timesfm_xreg' ? 'Forecast engine with the driver as a covariate (XReg).' : 'Linear driver model with seasonal smoothing (calendar and driver covariates were not available).'}
        ${res.driver_effect ? ` In history, each extra unit of the driver went with ${fmt.num(res.driver_effect.slope, 4)} more results (fit R2 ${fmt.num(res.driver_effect.r2, 2)}).` : ''}
        ${hist != null ? ` Historical ${esc(ratioLabel)}: <b>${fmt.lkr(hist)}</b>.` : ''}</span></div>
      ${rec ? `<div class="banner" style="background:var(--good-soft);border-color:var(--good)"><span><b>Suggested plan: ${esc(rec.scenario)}.</b> Expected ${vfK(rec.kpi_p50)} results for ${vfD(rec.driver_total)}, with each extra result costing about ${fmt.lkr(rec.marginal_ratio)} (within 1.5x the historical average).</span></div>` : ''}
      <div class="card"><div class="card-head"><div><h3>Scenario comparison</h3><div class="sub">Next ${res.params.horizon_points} ${esc(res.params.granularity)} periods. Ranges are low case to high case.</div></div><button class="btn sm" id="sc-save" type="button">Save to client</button></div><div id="sc-table"></div></div>
      <div class="grid g2" style="margin-top:16px">${C.box('c-sc', 'Expected results by scenario', 'All values are forecasts. Bars: most likely. Whiskers in the tooltip: low case to high case.', { pill: 'Forecast' })}${C.box('c-sc2', 'Results over the horizon', 'Most likely forecast per period', { pill: 'Forecast' })}</div>`;
    T.create(root.querySelector('#sc-table'), { csv: 'scenarios', search: false, rows: s.map((x) => ({ ...x })), columns: [
      { key: 'scenario', label: 'Scenario' }, { key: 'driver_total', label: 'Planned ' + (params.driver_label || 'driver'), num: true, fmt: vfD },
      { key: 'kpi_p50', label: 'Expected results (most likely)', num: true, fmt: vfK }, { key: 'kpi_p10', label: 'Low case', num: true, fmt: vfK }, { key: 'kpi_p90', label: 'High case', num: true, fmt: vfK },
      { key: 'ratio_p50', label: ratioLabel + ' (most likely)', num: true, fmt: (v) => fmt.lkr(v) }, { key: 'ratio_best', label: 'Best case', num: true, fmt: (v) => fmt.lkr(v) }, { key: 'ratio_worst', label: 'Worst case', num: true, fmt: (v) => fmt.lkr(v) },
      { key: 'incremental_kpi', label: 'Extra results vs current', num: true, fmt: (v) => (v == null ? '' : fmt.num(v, 0)) }, { key: 'marginal_ratio', label: 'Cost per extra result', num: true, fmt: (v) => (v == null ? '' : fmt.lkr(v)) }] });
    C.bar({ id: 'c-sc', labels: s.map((x) => x.scenario), valueFmt: vfK, datasets: [{ label: 'Expected results', data: s.map((x) => x.kpi_p50), backgroundColor: s.map((x, i) => C.PALETTE[i % 12]) }] });
    C.line({ id: 'c-sc2', labels: s[0].series.dates, valueFmt: vfK, datasets: s.map((x, i) => ({ label: x.scenario, data: x.series.p50, borderColor: C.PALETTE[i % 12], backgroundColor: C.PALETTE[i % 12] })) });
    const bc = Chart.getChart('c-sc'); if (bc) { bc.options.plugins.tooltip.callbacks.afterLabel = (c) => `Range ${vfK(s[c.dataIndex].kpi_p10)} to ${vfK(s[c.dataIndex].kpi_p90)}`; bc.update(); }
    root.querySelector('#sc-save').onclick = () => saveToClient(ctx, 'scenarios', params, res);
  }

  /* ================================================================ pacing view */
  function pacingResults(root, res, ctx, params) {
    const vf = unitFmt(params.unit || 'number');
    const cls = { 'On track': 'good', 'Under pacing': 'bad', 'Over pacing': 'warn' }[res.status];
    root.innerHTML = `<div class="kpis">
        <div class="kpi fc"><span class="fc-pill tile">Forecast</span><div class="k-lbl">Status</div><div class="k-val"><span class="badge ${cls}" style="font-size:15px">${esc(res.status)}</span></div><div class="k-sub">${res.target_reached_in_band ? 'Target is inside the low case to high case range' : 'Target is outside the likely range'}</div></div>
        <div class="kpi"><div class="k-lbl">Actual to date</div><div class="k-val">${vf(res.actual_to_date)}</div><div class="k-sub">${fmt.pct(res.pct_of_target, 0)} of target, ${fmt.pct(res.time_elapsed_pct, 0)} of time gone</div></div>
        <div class="kpi fc"><span class="fc-pill tile">Forecast</span><div class="k-lbl">Projected end total (most likely)</div><div class="k-val">${vf(res.projected_p50)}</div><div class="k-sub">Range ${vf(res.projected_p10)} to ${vf(res.projected_p90)}</div></div>
        <div class="kpi fc"><span class="fc-pill tile">Forecast</span><div class="k-lbl">Versus target</div><div class="k-val">${fmt.delta(res.projected_vs_target_pct)}</div><div class="k-sub">Target ${vf(res.target)}</div></div>
        <div class="kpi"><div class="k-lbl">Needed per day</div><div class="k-val">${res.required_per_day == null ? 'n/a' : res.required_per_day <= 0 ? 'Target reached' : vf(res.required_per_day)}</div><div class="k-sub">Recent run rate ${vf(res.recent_run_rate)} per day, ${res.remaining_days} days left</div></div></div>
      ${res.notes.map((n) => `<div class="banner info" style="margin-top:12px"><span>${esc(n)}</span></div>`).join('')}
      <div style="margin-top:16px">${C.box('c-pace', `Cumulative ${esc(res.metric_label)} against target`, `${esc(res.entity)}, flight ${esc(res.start)} to ${esc(res.end)}. Band: low case to high case projection.`, { tall: true, pill: 'Actual + forecast', extra: '<button class="btn sm" id="pc-save" type="button">Save to client</button>' })}</div>`;
    const labels = res.cumulative.dates.concat(res.projection.dates), n = res.cumulative.dates.length;
    const pad = (a) => Array(n - 1).fill(null).concat([res.cumulative.values[n - 1]], a);
    C.line({ id: 'c-pace', labels, valueFmt: vf, datasets: [
      { label: 'High case', data: pad(res.projection.p90), borderColor: 'transparent', backgroundColor: C.PALETTE[0] + '30', fill: '+1', pointRadius: 0 },
      { label: 'Low case', data: pad(res.projection.p10), borderColor: 'transparent', fill: false, pointRadius: 0 },
      { label: 'Most likely projection', data: pad(res.projection.p50), borderColor: C.PALETTE[0], borderDash: [6, 4], pointRadius: 0 },
      { label: 'Actual to date', data: res.cumulative.values.concat(Array(res.projection.dates.length).fill(null)), borderColor: C.css('--text'), pointRadius: 0 },
      { label: 'Target', data: labels.map(() => res.target), borderColor: C.css('--bad'), borderDash: [3, 3], pointRadius: 0 }] });
    const ch = Chart.getChart('c-pace'); if (ch) { ch.options.plugins.legend.labels.filter = (i) => !['Low case', 'High case'].includes(i.text); ch.options.plugins.nowLine = { index: n - 1 }; ch.config.plugins = [C.nowLine]; ch.update(); }
    root.querySelector('#pc-save').onclick = () => saveToClient(ctx, 'pacing', params, res);
  }

  /* ================================================================ tab */
  async function tab(p, ctx) {
    const kind = ctx.kind, fk = ctx.fkey(), s0 = App.store.get('fc:' + fk, {});
    const info = await Promise.all([App.data.entities(ctx.body()), App.api.get('/api/forecast/limits'), App.api.get('/api/model-status')])
      .then(([e, lim, model]) => ({ catalog: e.catalog, date_max: e.date_max, default_granularity: e.default_granularity, min_points: lim.min_points, model }))
      .catch((e) => { p.innerHTML = App.emptyState('Forecasting is not available', e.message); return null; });
    if (!info) return;
    banner(info.model);
    const cat = info.catalog, metrics = cat.metrics, units = cat.units, ents = cat.entities;
    const kpiMeta = ctx.state.meta || {};
    const drivers = kind === 'kpi' ? (kpiMeta.metrics || []).filter((m) => m.agg === 'sum' && (m.role === 'driver' || m.unit === 'currency')).map((m) => m.key) : (metrics.grp ? ['spend'] : []);
    const targets = kind === 'kpi' ? (kpiMeta.metrics || []).filter((m) => m.agg === 'sum' && m.role !== 'driver' && m.unit !== 'currency').map((m) => m.key) : (metrics.grp ? ['grp', 'spots'] : []);
    const additive = Object.keys(metrics).filter((k) => kind === 'kpi' ? (kpiMeta.metrics || []).some((m) => m.key === k && m.agg === 'sum') : ['spend', 'spots', 'grp'].includes(k));
    const modes = [['forecast', 'Forecast']].concat(drivers.length && targets.length ? [['scenarios', 'Spend scenarios']] : []).concat(kind !== 'tv' && additive.length ? [['pacing', 'Pacing']] : []);
    let cur = modes.find((m) => m[0] === mode(fk)) ? mode(fk) : 'forecast';
    const defGran = info.default_granularity || s0.granularity || 'weekly';
    const opt = (o, sel) => Object.entries(o).map(([k, l]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(l)}</option>`).join('');
    const entOpts = (sel, list) => (list || ents).map((e) => `<option value="${e}" ${e === sel ? 'selected' : ''}>${esc(ENT_LABEL[e] || e)}</option>`).join('');
    const horizons = { daily: [7, 14, 28, 56, 91], weekly: [28, 56, 91, 182], monthly: [91, 182, 365] };
    p.innerHTML = `<div class="card"><div class="card-head"><div><h3>Forecast studio</h3><div class="sub">The Media Radar forecast engine. Series are built in this browser from the filtered data; only those series are sent. ${kind === 'lmrb' ? 'Competitor set applies.' : ''}</div></div>
        <div class="seg" id="fm-seg">${modes.map(([k, l]) => `<button type="button" data-m="${k}" aria-pressed="${k === cur}">${l}</button>`).join('')}</div></div>
      <div id="fm-form"></div>
      <div id="f-prog" hidden style="margin-top:12px"><div class="progress"><i></i></div><div class="muted small" id="f-msg" style="margin-top:6px"></div></div></div>
      <div id="f-out" style="margin-top:16px"></div>`;
    const form = $('#fm-form', p), out = $('#f-out', p), prog = $('#f-prog', p), msg = $('#f-msg', p);

    const series = (extra) => App.data.series(ctx.body(extra));
    const onJob = (p2, m) => App.loader.progress(p2 ? Math.max(0.05, p2) : null, m || '');
    const run = async (btn, starter, onDone) => {
      btn.disabled = true; App.loader.show('Running forecast', 'Building series in this browser'); App.loader.progress(null); out.innerHTML = '';
      try {
        const res = await starter();
        if (!res.ok) { out.innerHTML = App.emptyState('Nothing to forecast', res.message); return; }
        onDone(res); App.shell.refreshModel();
      } catch (e) { out.innerHTML = App.emptyState('Forecast failed', e.message); App.toast(e.message, 'error', 8000); }
      finally { btn.disabled = false; App.loader.hide(250); }
    };

    async function entityPicker(box, et, metric, multi, sel) {
      box.innerHTML = '';
      if (et === 'total') { box.innerHTML = '<label>Entities</label><div class="muted small" style="padding:8px 0">Whole filtered data</div>'; return { get: () => [] }; }
      const r = await App.data.entities(ctx.body({ entity_type: et, metric })).catch(() => ({ entities: [] }));
      const names = r.entities.map((e) => e.name);
      if (multi) {
        const st = { entities: [] };
        const w = App.filters.multi({ key: 'entities', label: `${ENT_LABEL[et] || 'Entities'} (blank = top ${et === 'timebelt' ? 24 : 8})` }, names, st, () => {});
        box.appendChild(w); return { get: () => st.entities };
      }
      box.innerHTML = `<label for="pk-ent">${esc(ENT_LABEL[et] || 'Entity')}</label><select id="pk-ent">${names.map((n) => `<option ${n === sel ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>`;
      return { get: () => [box.querySelector('select').value] };
    }

    function forecastForm() {
      const st = { metric: metrics[s0.metric] ? s0.metric : Object.keys(metrics)[0], et: ents.includes(s0.entity_type) ? s0.entity_type : (kind === 'tv' ? 'timebelt' : ents[0]), gran: s0.granularity || defGran };
      form.innerHTML = `<div class="filter-grid">
        <div class="field"><label for="f-metric">Target metric</label><select id="f-metric">${opt(metrics, st.metric)}</select></div>
        <div class="field"><label for="f-ent">Forecast by</label><select id="f-ent">${entOpts(st.et)}</select></div>
        <div class="field" id="f-pick"></div>
        <div class="field"><label for="f-gran">Granularity</label><select id="f-gran">${['daily', 'weekly', 'monthly'].map((g) => `<option ${g === st.gran ? 'selected' : ''} value="${g}">${fmt.title(g)}</option>`).join('')}</select></div>
        <div class="field"><label for="f-hor">Horizon</label><select id="f-hor"></select></div>
        <div class="field"><label for="f-hist">History window</label><select id="f-hist">${[[0, 'All history'], [90, 'Last 90 days'], [180, 'Last 180 days'], [365, 'Last year'], [730, 'Last 2 years']].map(([v, l]) => `<option value="${v}" ${v === +(s0.history_days || 0) ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="field"><label for="f-hold">Monitoring window</label><select id="f-hold">${[[0, 'Auto'], [3, 'Last 3 periods'], [7, 'Last 7 periods'], [14, 'Last 14 periods']].map(([v, l]) => `<option value="${v}" ${v === +(s0.holdout || 0) ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="field"><label>Covariates</label><label class="row small"><input type="checkbox" id="f-cov" ${s0.covariates !== false ? 'checked' : ''}> Weekday and Sri Lankan event calendar</label></div></div>
        <div class="row" style="margin-top:14px"><button class="btn primary" id="f-run" type="button">Run forecast</button><span class="muted small">Minimum history: ${info.min_points.daily} daily, ${info.min_points.weekly} weekly or ${info.min_points.monthly} monthly points. Thinner series still run and are marked Low.</span></div>`;
      const hor = () => { const g = $('#f-gran', form).value; const want = +(s0.horizon_days || 28); $('#f-hor', form).innerHTML = horizons[g].map((h) => `<option value="${h}" ${h === want ? 'selected' : ''}>${h} days${h >= 91 ? ` (${Math.round(h / 30.4)} months)` : ''}</option>`).join(''); };
      hor(); $('#f-gran', form).onchange = hor;
      let picker;
      const repick = async () => { picker = await entityPicker($('#f-pick', form), $('#f-ent', form).value, $('#f-metric', form).value, true); };
      $('#f-ent', form).onchange = repick; repick();
      $('#f-run', form).onclick = (e) => {
        const et = $('#f-ent', form).value;
        const params = { metric: $('#f-metric', form).value, entity_type: et, granularity: $('#f-gran', form).value, horizon_days: +$('#f-hor', form).value, history_days: +$('#f-hist', form).value || null,
          holdout: +$('#f-hold', form).value || null, covariates: $('#f-cov', form).checked, entities: picker ? picker.get() : [], max_entities: et === 'timebelt' ? 24 : 8 };
        App.store.set('fc:' + fk, { ...params, entities: undefined });
        run(e.currentTarget, async () => {
          const s = await series({ entity_type: et, metric: params.metric, granularity: params.granularity, entities: params.entities, history_days: params.history_days, max_entities: params.max_entities });
          console.groupCollapsed(`[forecast] studio run ${new Date().toLocaleTimeString()}`);
          console.info('[forecast] studio: params', params, 'built', s.series.length, 'series', s.notes);
          if (!s.series.length) { console.warn('[forecast] no series could be built:', s.notes); console.groupEnd(); return { ok: false, message: s.notes[0] || 'No series could be built.' }; }
          App.loader.progress(null, `Forecasting ${s.series.length} series`);
          const t0 = performance.now();
          const res = await App.runJob('/api/forecast/run', { kind, series: s.series, params: { ...params, granularity: s.granularity } }, onJob);
          console.info(`[forecast] studio: server answered in ${((performance.now() - t0) / 1000).toFixed(1)}s ok=${res.ok}`);
          if (res.ok && App.traceForecast) App.traceForecast(res, res.results); else if (!res.ok) console.warn('[forecast] the server could not run the forecast:', res.message, res.notes);
          console.groupEnd();
          if (res.ok) res.notes = s.notes.concat(res.notes || []);
          return res;
        }, (res) => { App.lastForecast[fk] = { params, result: res }; forecastResults(out, res, ctx, params); });
      };
      if (App.lastForecast[fk]) forecastResults(out, App.lastForecast[fk].result, ctx, App.lastForecast[fk].params);
    }

    function scenarioForm() {
      const ss = App.store.get('sc:' + fk, {});
      const tOpts = Object.fromEntries(targets.map((k) => [k, metrics[k]])), dOpts = Object.fromEntries(drivers.map((k) => [k, metrics[k]]));
      const ratios = (kpiMeta.ratios || []);
      const scEnts = kind === 'lmrb' ? ['advertiser', 'total'] : ents;
      form.innerHTML = `<p class="muted small" style="margin-top:0">What happens to results if the client spends more or less? The forecast engine forecasts the result with the planned spend as a covariate, then derives the cost per result.</p>
        <div class="filter-grid">
        <div class="field"><label for="s-target">Result to forecast</label><select id="s-target">${opt(tOpts, ss.target)}</select></div>
        <div class="field"><label for="s-driver">Driver (planned)</label><select id="s-driver">${opt(dOpts, ss.driver)}</select></div>
        <div class="field"><label for="s-et">For</label><select id="s-et">${entOpts(ss.entity_type || scEnts[0], scEnts)}</select></div>
        <div class="field" id="s-pick"></div>
        <div class="field"><label for="s-gran">Granularity</label><select id="s-gran">${['daily', 'weekly', 'monthly'].map((g) => `<option ${g === (ss.granularity || defGran) ? 'selected' : ''} value="${g}">${fmt.title(g)}</option>`).join('')}</select></div>
        <div class="field"><label for="s-hor">Planning horizon</label><select id="s-hor">${[28, 56, 91, 182].map((h) => `<option value="${h}" ${h === +(ss.horizon_days || 28) ? 'selected' : ''}>${h} days</option>`).join('')}</select></div>
        <div class="field"><label for="s-mult">Spend changes (%)</label><input type="text" id="s-mult" value="${esc(ss.mult || '-20, 0, 20, 50')}" placeholder="-20, 0, 20, 50"></div>
        <div class="field"><label for="s-bud">Or fixed budgets for the horizon (LKR)</label><input type="text" id="s-bud" value="${esc(ss.bud || '')}" placeholder="5000000, 7500000"></div></div>
        <div class="row" style="margin-top:14px"><button class="btn primary" id="s-run" type="button">Run scenarios</button></div>`;
      let picker;
      const repick = async () => { const et = $('#s-et', form).value; picker = await entityPicker($('#s-pick', form), et, $('#s-driver', form).value, false, ss.entity); };
      $('#s-et', form).onchange = repick; repick();
      $('#s-run', form).onclick = (e) => {
        const nums = (v) => v.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean).map(Number).filter((x) => !Number.isNaN(x));
        const target = $('#s-target', form).value, driver = $('#s-driver', form).value, et = $('#s-et', form).value;
        const ratio = ratios.find((r) => r.num === driver && r.den === target);
        const params = { target, driver, entity_type: et, entity: et === 'total' ? null : (picker ? picker.get()[0] : null), granularity: $('#s-gran', form).value, horizon_days: +$('#s-hor', form).value,
          multipliers: nums($('#s-mult', form).value).map((x) => 1 + x / 100), budgets: nums($('#s-bud', form).value), driver_label: metrics[driver],
          ratio_label: ratio ? ratio.label : (target === 'grp' ? 'CPRP' : `Cost per ${metrics[target]}`), ratio_scale: ratio ? ratio.scale : 1 };
        if (!params.multipliers.length && !params.budgets.length) { App.toast('Enter at least one spend change or budget.', 'error'); return; }
        App.store.set('sc:' + fk, { ...params, mult: $('#s-mult', form).value, bud: $('#s-bud', form).value });
        run(e.currentTarget, async () => {
          const one = { entity_type: et, entities: params.entity ? [params.entity] : null, granularity: params.granularity, max_entities: 1 };
          const [t, d] = await Promise.all([series({ ...one, metric: target }), series({ ...one, metric: driver })]);
          if (!t.series.length || !d.series.length) return { ok: false, message: (t.notes.concat(d.notes))[0] || 'Target or driver series could not be built.' };
          return App.runJob('/api/scenarios/run', { kind, target: t.series[0], driver: d.series[0], params: { ...params, granularity: t.granularity } }, onJob);
        }, (res) => { App.lastScenarios[fk] = { params, result: res }; scenarioResults(out, res, ctx, params); });
      };
      if (App.lastScenarios[fk]) scenarioResults(out, App.lastScenarios[fk].result, ctx, App.lastScenarios[fk].params);
    }

    function pacingForm() {
      const ps = App.store.get('pc:' + fk, {});
      const aOpts = Object.fromEntries(additive.map((k) => [k, metrics[k]]));
      const today = info.date_max || new Date().toISOString().slice(0, 10);
      const d0 = ps.start || today.slice(0, 8) + '01';
      const end = ps.end || new Date(new Date(today).getFullYear(), new Date(today).getMonth() + 1, 0).toISOString().slice(0, 10);
      const pEnts = kind === 'lmrb' ? ['advertiser', 'total'] : ents;
      form.innerHTML = `<p class="muted small" style="margin-top:0">Will the flight hit its target? Actual to date plus the forecast for the remaining days, with a low case to high case range.</p>
        <div class="filter-grid">
        <div class="field"><label for="p-metric">Metric</label><select id="p-metric">${opt(aOpts, ps.metric)}</select></div>
        <div class="field"><label for="p-et">For</label><select id="p-et">${entOpts(ps.entity_type || pEnts[0], pEnts)}</select></div>
        <div class="field" id="p-pick"></div>
        <div class="field"><label for="p-start">Flight start</label><input type="date" id="p-start" value="${esc(d0)}"></div>
        <div class="field"><label for="p-end">Flight end</label><input type="date" id="p-end" value="${esc(end)}"></div>
        <div class="field"><label for="p-target">Target for the flight</label><input type="number" id="p-target" min="0" step="any" value="${esc(ps.target || '')}" placeholder="Budget, leads or GRPs"></div>
        <div class="field"><label for="p-tol">Tolerance (%)</label><input type="number" id="p-tol" min="0" max="50" value="${esc(ps.tolerance_pct || 5)}"></div></div>
        <div class="row" style="margin-top:14px"><button class="btn primary" id="p-run" type="button">Check pacing</button></div>`;
      let picker;
      const repick = async () => { picker = await entityPicker($('#p-pick', form), $('#p-et', form).value, $('#p-metric', form).value, false, ps.entity); };
      $('#p-et', form).onchange = repick; repick();
      $('#p-run', form).onclick = async (e) => {
        const et = $('#p-et', form).value, metric = $('#p-metric', form).value;
        const params = { metric, entity_type: et, entity: et === 'total' ? null : (picker ? picker.get()[0] : null), start: $('#p-start', form).value, end: $('#p-end', form).value,
          target: +$('#p-target', form).value, tolerance_pct: +$('#p-tol', form).value || 5, unit: units[metric] };
        if (!params.target) { App.toast('Enter the target for the flight.', 'error'); return; }
        App.store.set('pc:' + fk, params);
        const btn = e.currentTarget; btn.disabled = true; out.innerHTML = ''; App.loader.show('Checking pacing', 'Projecting the rest of the flight');
        try {
          const s = await series({ entity_type: et, metric, granularity: 'daily', entities: params.entity ? [params.entity] : null, max_entities: 1 });
          const res = s.series.length ? await App.api.post('/api/pacing/run', { kind, series: s.series[0], params }) : { ok: false, message: s.notes[0] || 'No data for pacing.' };
          if (!res.ok) { out.innerHTML = App.emptyState('Pacing could not be checked', res.message); } else { App.lastPacing[fk] = { params, result: res }; pacingResults(out, res, ctx, params); } }
        catch (err) { out.innerHTML = App.emptyState('Pacing failed', err.message); }
        btn.disabled = false; App.loader.hide(250);
      };
      if (App.lastPacing[fk]) pacingResults(out, App.lastPacing[fk].result, ctx, App.lastPacing[fk].params);
    }

    const draw = () => { out.innerHTML = ''; ({ forecast: forecastForm, scenarios: scenarioForm, pacing: pacingForm })[cur](); };
    $$('#fm-seg button', p).forEach((b) => { b.onclick = () => { cur = b.dataset.m; App.store.set('fc-mode:' + fk, cur); $$('#fm-seg button', p).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); draw(); }; });
    draw();

    // open a saved forecast from the client overview (?saved=ID)
    const sid = new URLSearchParams(location.search).get('saved');
    if (sid && !p.dataset.savedShown) {
      p.dataset.savedShown = '1';
      try {
        const f = await App.api.get('/api/saved-forecasts/' + sid);
        const prm = f.request.params || {};
        const note = `Saved ${f.ftype} "${f.title}" from ${String(f.created_at).slice(0, 16).replace('T', ' ')}. It shows the data as it was then.`;
        if (f.ftype === 'forecast') { App.lastForecast[fk] = { params: prm, result: f.result }; forecastResults(out, f.result, ctx, prm, note); }
        else if (f.ftype === 'scenarios') { App.lastScenarios[fk] = { params: prm, result: f.result }; scenarioResults(out, f.result, ctx, prm); out.insertAdjacentHTML('afterbegin', `<div class="banner info"><span>${esc(note)}</span></div>`); }
        else { App.lastPacing[fk] = { params: prm, result: f.result }; pacingResults(out, f.result, ctx, prm); out.insertAdjacentHTML('afterbegin', `<div class="banner info"><span>${esc(note)}</span></div>`); }
      } catch (e) { App.toast('Could not open the saved forecast: ' + e.message, 'error'); }
    }
  }
  App.forecast = { tab };
})(window.App);
