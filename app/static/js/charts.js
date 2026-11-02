/* Chart.js wrappers, per-advertiser colour registry, heatmaps and PNG download. */
(function (App) {
  const { esc, fmt } = App;
  const PALETTE = (App.skins ? App.skins.palette() : ['#3de0ff', '#8b5cf6', '#ff4fd8', '#22f5a6', '#ffb547', '#4f8bff', '#ff6b6b', '#a3e635', '#f472b6', '#2dd4bf', '#facc15', '#94a3b8']).slice();
  const registry = new Map();
  const charts = new Map();
  const backs = new Map();   // chart id -> () => html shown at the top of the flip-card back (for example negotiation guidance)
  const only = new Set();   // charts whose popup shows only the custom detail, not the raw dataset values
  const details = new Map();   // chart id -> (index, datasetIndex) => html, extra lines in the click popup
  const setDetail = (id, fn) => { if (fn) details.set(id, fn); else details.delete(id); };
  function colorFor(name) {
    if (name === 'Others') return '#7c86b0';
    if (!registry.has(name)) {
      const i = registry.size;
      registry.set(name, i < PALETTE.length ? PALETTE[i] : `hsl(${(i * 137.5) % 360} 62% 52%)`);
    }
    return registry.get(name);
  }
  const register = (names) => names.forEach(colorFor);
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  function defaults() {
    if (!window.Chart) return;
    Chart.defaults.color = css('--muted') || '#646a8a';
    Chart.defaults.borderColor = css('--grid') || 'rgba(100,106,138,.16)';
    Chart.defaults.font.family = css('--font') || 'system-ui';
    Chart.defaults.font.size = 12;
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.boxWidth = 8;
    const tt = Chart.defaults.plugins.tooltip;
    tt.backgroundColor = css('--surface-solid') || '#0d1430'; tt.titleColor = css('--text') || '#e8eeff'; tt.bodyColor = css('--text') || '#e8eeff';
    tt.borderColor = css('--border-strong') || 'rgba(61,224,255,.4)'; tt.borderWidth = 1; tt.padding = 10; tt.cornerRadius = 10; tt.boxPadding = 4;
    tt.titleFont = { family: css('--display') || 'system-ui', weight: '600' };
  }
  function make(id, cfg) {
    const el = document.getElementById(id);
    if (!el || !window.Chart) return null;
    defaults();
    if (charts.has(id)) charts.get(id).destroy();
    cfg.options = cfg.options || {};
    if (cfg.options.plugins && cfg.options.plugins.eventPins) {
      cfg.plugins = (cfg.plugins || []).concat(eventPins);
      const tt = (cfg.options.plugins.tooltip = cfg.options.plugins.tooltip || {}); tt.callbacks = tt.callbacks || {};
      const prev = tt.callbacks.afterBody;
      tt.callbacks.afterBody = function (items) { const base = prev ? prev.call(this, items) || [] : []; const extra = items.length ? pinsAt(this.chart || items[0].chart, items[0].dataIndex) : []; return extra.length ? base.concat(['', ...extra]) : base; };
    }
    if (!cfg.options.onClick && cfg.type !== 'doughnut' && !cfg.noDetail) {
      cfg.options.onClick = (evt, els, chart) => pointDetail(id, chart, evt);
      cfg.options.onHover = (evt, els) => { evt.native.target.style.cursor = els.length ? 'pointer' : 'default'; };
    }
    setDetail(id, cfg.detail); if (cfg.detailOnly) only.add(id); else only.delete(id);
    const ch = new Chart(el, cfg);
    charts.set(id, ch);
    return ch;
  }
  function destroyAll() { charts.forEach((c) => c.destroy()); charts.clear(); }
  /** Chart card. opts.help = [how it predicts, what you get] adds the "?" tooltip; opts.ev adds a Planner's Evidence slot (fill with evidence()). */
  function box(id, title, sub, opts = {}) {
    const help = opts.help ? App.help(opts.help[0], opts.help[1], { left: opts.helpLeft }) : '';
    const body = opts.html != null ? `<div id="${id}">${opts.html}</div>` : `<div class="chart-wrap ${opts.tall ? 'tall' : ''} ${opts.xtall ? 'xtall' : ''}"><canvas id="${id}" role="img" aria-label="${esc(title)}"></canvas></div>`;
    const pill = opts.pill ? `<span class="fc-pill">${esc(opts.pill)}</span>` : '';
    const how = opts.help ? `<p class="fb-how">${esc(opts.help[0])}</p>${opts.help[1] ? `<p class="fb-use"><b>Use it for:</b> ${esc(opts.help[1])}</p>` : ''}` : '';
    const back = `<div class="fb" data-back="${id}" hidden><div class="fb-head"><h3>How these numbers came</h3><button class="btn sm" type="button" data-flip-back>Back to chart</button></div>
      <ol class="fb-flow"><li><b>1</b>Your sheet<small>read in this browser</small></li><li><b>2</b>Compact series<small>one value per period</small></li><li><b>3</b>Forecast engine<small>low, likely, high</small></li><li><b>4</b>This chart<small>${esc(title)}</small></li></ol>
      ${how}<div class="fb-data" data-fbdata="${id}"></div></div>`;
    return `<div class="card flipcard ${opts.glow ? 'glow' : ''} ${opts.pill ? 'fc' : ''}" data-chart="${id}"><div class="ff"><div class="card-head"><div><h3>${pill}${esc(title)} ${help}</h3>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>
      <div class="row">${opts.extra || ''}<button class="btn sm ghost" type="button" data-flip="${id}" title="Flip to see how the numbers were built" aria-label="Flip ${esc(title)} to see how the numbers were built">Flip</button>${opts.html != null ? '' : `<button class="btn sm ghost" type="button" data-png="${id}" aria-label="Download ${esc(title)} as PNG">PNG</button>`}</div></div>
      ${body}${opts.ev ? `<div id="ev-${id}"></div>` : ''}</div>${back}</div>`;
  }
  function evidence(id, items, title, opts) { const el = document.getElementById('ev-' + id); if (el) el.innerHTML = App.evidenceBox(items, title, opts); }
  /** Marks the forecast part of a time chart: a shaded region after options.plugins.nowLine.index with a FORECAST label. */
  const nowLine = { id: 'nowLine',
    beforeDatasetsDraw(chart, a, o) {
      if (!o || o.index == null) return;
      const { ctx, chartArea: ar, scales: { x } } = chart, px = x.getPixelForValue(o.index);
      if (!(px >= ar.left && px <= ar.right)) return;
      ctx.save(); ctx.fillStyle = css('--fc-zone') || 'rgba(139,92,246,.10)'; ctx.fillRect(px, ar.top, ar.right - px, ar.bottom - ar.top);
      ctx.restore();
    },
    afterDatasetsDraw(chart, a, o) {
      if (!o || o.index == null) return;
      const { ctx, chartArea: ar, scales: { x } } = chart, px = x.getPixelForValue(o.index);
      if (!(px >= ar.left && px <= ar.right)) return;
      const col = css('--accent') || '#3de0ff';
      ctx.save(); ctx.strokeStyle = col; ctx.setLineDash([3, 4]); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(px, ar.top); ctx.lineTo(px, ar.bottom); ctx.stroke(); ctx.setLineDash([]);
      if (ar.right - px < 70) { ctx.restore(); return; }       // no room for a tag: the shading and the line already mark the forecast
      const label = ar.right - px < 210 ? 'FORECAST' : (o.label || 'FORECAST: estimated, not recorded'), font = '700 11px ' + (css('--display') || 'sans-serif');
      ctx.font = font; const w = Math.min(ctx.measureText(label).width + 16, ar.right - px - 6);
      ctx.fillStyle = css('--surface-solid') || '#0d1430'; ctx.strokeStyle = col; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(px + 6, ar.top + 6, w, 20, 10) : ctx.rect(px + 6, ar.top + 6, w, 20); ctx.fill(); ctx.stroke();
      ctx.fillStyle = col; ctx.fillText(label, px + 14, ar.top + 20, w - 12); ctx.restore();
    } };
  /** Emoji pins along the bottom of a time chart (Poya, salary window, festivals, major events). options.plugins.eventPins = {on, pins:[{index, emoji, label}]}. */
  const eventPins = { id: 'eventPins',
    afterDatasetsDraw(chart, a, o) {
      if (!o || !o.on || !o.pins || !o.pins.length) return;
      const { ctx, chartArea: ar, scales: { x } } = chart, used = new Map();
      ctx.save(); ctx.font = '14px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      o.pins.forEach((p) => {
        const px = x.getPixelForValue(p.index); if (!(px >= ar.left - 2 && px <= ar.right + 2)) return;
        const k = Math.round(px / 16), n = used.get(k) || 0; used.set(k, n + 1);
        if (n < 3) ctx.fillText(p.emoji, px, ar.bottom - 5 - n * 16);
      });
      ctx.restore();
    } };
  const pinsAt = (chart, i) => { const o = chart.options.plugins && chart.options.plugins.eventPins; return o && o.on && o.pins ? o.pins.filter((p) => p.index === i).map((p) => `${p.emoji} ${p.label}`) : []; };
  /** Tooltip title that says whether the hovered point is actual or forecast. */
  const fcTitle = (firstForecastIndex) => (items) => `${items[0].label}  \u00b7  ${items[0].dataIndex >= firstForecastIndex ? 'FORECAST' : 'actual'}`;
  /* ---------------- click a point: detail popup ---------------- */
  const isFc = (id) => { const c = document.querySelector(`[data-chart="${id}"]`); return !!(c && c.classList.contains('fc')); };
  const vtxt = (v) => (v == null || Number.isNaN(v) ? 'n/a' : typeof v === 'number' ? fmt.num(v, Math.abs(v) < 10 ? 2 : 0) : String(v));
  /** Opens a popup that explains one clicked point. rows = [[label, value]], extra = html. */
  function detail({ title, sub, forecast, rows, extra, table }) {
    const tag = forecast ? '<span class="fc-pill" style="margin:0">Forecast</span>' : '<span class="badge">Recorded</span>';
    const m = App.modal(title, `<div class="dt-top">${tag}${sub ? `<span class="muted small">${esc(sub)}</span>` : ''}</div>
      ${(rows || []).length ? `<div class="dt-kpis">${rows.map((r) => `<div class="dt-k"><span>${esc(r[0])}</span><b>${esc(r[1])}</b></div>`).join('')}</div>` : ''}${extra || ''}${table || ''}
      <div class="muted small" style="margin-top:10px">${forecast ? 'This is an estimate of the future, not recorded data. Flip the chart to see how it was built.' : 'This is recorded data from your sheet.'}</div>`);
    return m;
  }
  function pointDetail(id, chart, evt) {
    const els = chart.getElementsAtEventForMode(evt, chart.config.type === 'line' ? 'index' : 'nearest', { intersect: chart.config.type !== 'line' }, true);
    if (!els.length) return;
    const e0 = els[0], idx = e0.index, d0 = chart.data.datasets[e0.datasetIndex], raw = d0.data[idx];
    const nl = chart.options.plugins && chart.options.plugins.nowLine, forecast = (nl && nl.index != null ? idx > nl.index : false) || (chart.config.type !== 'line' && isFc(id));
    const label = chart.data.labels && chart.data.labels[idx] != null ? chart.data.labels[idx] : (raw && raw.q && raw.q.name) || d0.label || '';
    const rows = [];
    if (only.has(id)) { /* custom detail only */ } else if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.q) {
      const q = raw.q; Object.keys(q).forEach((k) => { if (typeof q[k] !== 'object') rows.push([k.replace(/_/g, ' '), vtxt(q[k])]); });
    } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      Object.keys(raw).forEach((k) => { if (typeof raw[k] !== 'object') rows.push([k === 'x' ? ((chart.options.scales.x.title || {}).text || 'x') : k === 'y' ? ((chart.options.scales.y.title || {}).text || 'y') : k, vtxt(raw[k])]); });
    } else {
      chart.data.datasets.forEach((ds, k) => { const v = Array.isArray(ds.data) ? ds.data[idx] : null; if (v != null && typeof v !== 'object' && !/Predicted/.test(ds.label || '')) rows.push([ds.label || 'Value', vtxt(v)]); });
    }
    const dfn = details.get(id), cfgDetail = dfn && dfn(idx, e0.datasetIndex);
    const lbl = String(label).replace(/\s+\(.*pts\)$/, '');
    detail({ title: lbl || 'Point detail', sub: d0.label && d0.label !== lbl ? d0.label : '', forecast, rows: rows.slice(0, 10), extra: cfgDetail || '',
      table: chart.config.type === 'line' && chart.data.labels ? seriesTable(chart, idx) : '' });
  }
  /** Small table of the points around the clicked one. */
  function seriesTable(chart, idx) {
    const nl = chart.options.plugins && chart.options.plugins.nowLine, from = Math.max(0, idx - 3), to = Math.min(chart.data.labels.length - 1, idx + 3);
    const ds = chart.data.datasets.filter((d) => !/Predicted|High case/.test(d.label || '') && d.data.some((v) => v != null)).slice(0, 5);
    let h = `<table class="dt-table"><thead><tr><th>Period</th><th>Type</th>${ds.map((d) => `<th>${esc(d.label)}</th>`).join('')}</tr></thead><tbody>`;
    for (let i = from; i <= to; i++) h += `<tr class="${i === idx ? 'on' : ''}"><td>${esc(chart.data.labels[i])}</td><td>${nl && nl.index != null && i > nl.index ? '<span class="fc-pill" style="margin:0">Forecast</span>' : 'actual'}</td>${ds.map((d) => `<td>${vtxt(d.data[i])}</td>`).join('')}</tr>`;
    return h + '</tbody></table>';
  }
  /** Chart data as a plain table for the back of a flip card. */
  function backTable(id) {
    const ch = charts.get(id), host = document.querySelector(`[data-fbdata="${id}"]`);
    if (!host) return;
    if (!ch) { const t = document.querySelector(`#${id} table.heat`); host.innerHTML = t ? `<h4>The numbers</h4><div class="heat-wrap">${t.outerHTML}</div>` : '<div class="muted small">No data behind this chart yet.</div>'; return; }
    const nl = ch.options.plugins && ch.options.plugins.nowLine, labels = ch.data.labels || [];
    const ds = ch.data.datasets.filter((d) => Array.isArray(d.data) && d.data.some((v) => v != null));
    if (!labels.length && ds[0] && ds[0].data[0] && typeof ds[0].data[0] === 'object') {
      const rows = ds.flatMap((d) => d.data.map((p) => (p.q ? p.q : p))), keys = Object.keys(rows[0] || {}).filter((k) => typeof rows[0][k] !== 'object');
      host.innerHTML = `<h4>The numbers (${rows.length})</h4><div class="fb-scroll"><table class="dt-table"><thead><tr>${keys.map((k) => `<th>${esc(k.replace(/_/g, ' '))}</th>`).join('')}</tr></thead><tbody>${rows.slice(0, 80).map((r) => `<tr>${keys.map((k) => `<td>${esc(vtxt(r[k]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      return;
    }
    const cols = ds.filter((d) => !/High case|Predicted/.test(d.label || '')).slice(0, 6), start = Math.max(0, labels.length - 60);
    host.innerHTML = `<h4>The numbers</h4><div class="fb-scroll"><table class="dt-table"><thead><tr><th>${nl ? 'Period' : 'Item'}</th>${nl ? '<th>Type</th>' : ''}${cols.map((d) => `<th>${esc(d.label || 'Value')}</th>`).join('')}</tr></thead>
      <tbody>${labels.slice(start).map((l, k) => { const i = start + k; return `<tr><td>${esc(l)}</td>${nl ? `<td>${nl.index != null && i > nl.index ? '<span class="fc-pill" style="margin:0">Forecast</span>' : 'actual'}</td>` : ''}${cols.map((d) => `<td>${vtxt(d.data[i])}</td>`).join('')}</tr>`; }).join('')}</tbody></table></div>
      <button class="btn sm" type="button" data-fbcsv="${id}" style="margin-top:8px">Download these numbers (CSV)</button>`;
  }
  function flipTo(card, back) {
    const id = card.dataset.chart, ff = card.querySelector('.ff'), fb = card.querySelector('.fb');
    if (!fb || card.classList.contains('turning')) return;
    if (back) { card.style.minHeight = card.offsetHeight + 'px'; backTable(id); const fn = backs.get(id), host = card.querySelector('[data-fbdata]'); if (fn && host) host.insertAdjacentHTML('afterbegin', fn()); if (host && App.memory && App.memory.text && /^p[tm]-/.test(id)) host.insertAdjacentHTML('afterbegin', `<p class="fb-mem"><b>Memory:</b> ${esc(App.memory.text)}</p>`); }
    card.classList.add('turning');
    setTimeout(() => {
      ff.hidden = !!back; fb.hidden = !back; card.classList.toggle('is-back', !!back);
      card.classList.remove('turning'); if (!back) { card.style.minHeight = ''; const ch = charts.get(id); if (ch) ch.resize(); }
    }, 230);
  }
  document.addEventListener('click', (e) => {
    const f = e.target.closest('[data-flip]'); if (f) { flipTo(f.closest('.flipcard'), true); return; }
    const fbk = e.target.closest('[data-flip-back]'); if (fbk) { flipTo(fbk.closest('.flipcard'), false); return; }
    const csv = e.target.closest('[data-fbcsv]');
    if (csv) { const t = document.querySelector(`[data-fbdata="${csv.dataset.fbcsv}"] table`); if (t) { const lines = [...t.rows].map((r) => [...r.cells].map((c) => '"' + c.textContent.replace(/"/g, '""') + '"').join(',')); App.download(new Blob([lines.join('\n')], { type: 'text/csv' }), csv.dataset.fbcsv + '_numbers.csv'); } return; }
    const td = e.target.closest('td[data-hv]');
    if (td) heatDetail(td);
  });
  /** Clicking a heatmap cell: where it ranks, plus its row and column averages. */
  function heatDetail(td) {
    const tb = td.closest('table'), r = +td.dataset.r, c = +td.dataset.c, cells = [...tb.querySelectorAll('td[data-hv]')], vals = cells.map((x) => +x.dataset.hv).filter(Number.isFinite);
    const v = +td.dataset.hv, rank = vals.filter((x) => x > v).length + 1, rowv = cells.filter((x) => +x.dataset.r === r).map((x) => +x.dataset.hv).filter(Number.isFinite), colv = cells.filter((x) => +x.dataset.c === c).map((x) => +x.dataset.hv).filter(Number.isFinite);
    const av = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null), card = td.closest('.flipcard');
    const rowName = tb.tBodies[0].rows[r].cells[0].textContent, colName = tb.tHead.rows[0].cells[c + 1].textContent;
    detail({ title: `${rowName} · ${colName}`, forecast: !!(card && card.classList.contains('fc')), sub: 'Heatmap cell',
      rows: [['This cell', td.textContent], ['Rank', `${rank} of ${vals.length}`], [`${rowName} average`, vtxt(av(rowv))], [`${colName} average`, vtxt(av(colv))], ['Best cell', vtxt(Math.max(...vals))], ['Weakest cell', vtxt(Math.min(...vals))]] });
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-png]'); if (!b) return;
    const src = document.getElementById(b.dataset.png); if (!src) return;
    const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
    const x = c.getContext('2d'); x.fillStyle = css('--surface') || '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(src, 0, 0);
    c.toBlob((bl) => App.download(bl, b.dataset.png + '.png'));
  });
  const axisFmt = (f) => ({ ticks: { callback: (v) => f(v) } });
  function bar({ id, labels, datasets, horizontal = false, stacked = false, valueFmt = fmt.compact, legend = datasets.length > 1, onClickLabel }) {
    return make(id, {
      type: 'bar', data: { labels, datasets: datasets.map((d) => ({ borderRadius: 4, maxBarThickness: 38, ...d })) },
      options: { indexAxis: horizontal ? 'y' : 'x', interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: legend, position: 'bottom' },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label ? c.dataset.label + ': ' : ''}${valueFmt(c.parsed[horizontal ? 'x' : 'y'])}` } } },
        scales: { x: { stacked, grid: { display: horizontal }, ...(horizontal ? axisFmt(valueFmt) : {}) }, y: { stacked, beginAtZero: true, grid: { display: !horizontal }, ...(horizontal ? {} : axisFmt(valueFmt)) } } },
    });
  }
  function line({ id, labels, datasets, stacked = false, valueFmt = fmt.compact, legend = true, yMax, yMin }) {
    return make(id, {
      type: 'line', data: { labels, datasets: datasets.map((d) => ({ tension: 0.3, pointRadius: labels.length > 40 ? 0 : 3, borderWidth: 2, ...d })) },
      options: { interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: legend, position: 'bottom' },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.y == null ? 'n/a' : valueFmt(c.parsed.y)}` } } },
        scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 12, autoSkip: true } }, y: { stacked, beginAtZero: yMin == null, max: yMax, min: yMin, ...axisFmt(valueFmt) } } },
    });
  }
  function doughnut({ id, labels, data, colors, valueFmt = fmt.compact }) {
    return make(id, { type: 'doughnut', data: { labels, datasets: [{ data, backgroundColor: colors || labels.map(colorFor), borderColor: css('--surface'), borderWidth: 2 }] },
      options: { cutout: '62%', plugins: { legend: { position: 'right' }, tooltip: { callbacks: { label: (c) => `${c.label}: ${valueFmt(c.parsed)}` } } } } });
  }
  /** Heatmap as an accessible HTML table with a colour scale. */
  function heat(m, { fmt: f = fmt.compact, rowPct = false, caption = '', lowIsGood = false } = {}) {
    if (!m || !m.rows || !m.rows.length) return '<div class="empty">Not enough data for this view.</div>';
    const vals = m.values.map((r, i) => {
      if (!rowPct) return r;
      const t = r.reduce((a, v) => a + (v || 0), 0);
      return r.map((v) => (v == null || !t ? null : (v / t) * 100));
    });
    const flat = vals.flat().filter((v) => v != null && !Number.isNaN(v));
    const lo = Math.min(...flat), hi = Math.max(...flat), span = hi - lo || 1;
    const cell = (v, ri, ci) => {
      if (v == null || Number.isNaN(v)) return '<td class="na">-</td>';
      let a = 0.08 + 0.82 * ((v - lo) / span); if (lowIsGood) a = 0.9 - 0.82 * ((v - lo) / span);
      return `<td data-hv="${v}" data-r="${ri}" data-c="${ci}" tabindex="0" style="cursor:pointer;background:rgba(var(--heat),${a.toFixed(2)});${a > 0.55 ? 'color:#fff;' : ''}">${esc(rowPct ? fmt.pct(v, 0) : f(v))}</td>`;
    };
    return `<div class="heat-wrap"><table class="heat">${caption ? `<caption class="sr-only">${esc(caption)}</caption>` : ''}<thead><tr><th></th>${m.cols.map((c) => `<th scope="col">${esc(fmt.title(c) === c ? c : c)}</th>`).join('')}</tr></thead>
      <tbody>${m.rows.map((r, i) => `<tr><th scope="row">${esc(r)}</th>${vals[i].map((v, j) => cell(v, i, j)).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  /** Compact calendar heat strip (advertiser x date). */
  function calendar(cal) {
    if (!cal || !cal.rows || !cal.rows.length) return '<div class="empty">No data.</div>';
    const mx = Math.max(1, ...cal.values.flat());
    const dates = cal.dates;
    const head = dates.map((d, i) => `<th scope="col" title="${d}" style="font-size:9px;writing-mode:vertical-rl;padding:2px 0">${i % 7 === 0 || dates.length < 20 ? d.slice(5) : ''}</th>`).join('');
    return `<div class="heat-wrap"><table class="heat cal"><thead><tr><th></th>${head}</tr></thead><tbody>${cal.rows.map((r, i) => `<tr><th scope="row"><span class="swatch" style="background:${colorFor(r)}"></span>${esc(r)}</th>${cal.values[i].map((v, j) =>
      `<td title="${esc(r)} ${dates[j]}: ${v} spots" style="background:${v ? `color-mix(in srgb, ${colorFor(r)} ${20 + 80 * v / mx}%, transparent)` : 'var(--surface-2)'}">${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  /* ---------------- time view: range, daily/weekly totals, smoothing, band toggle and an overview strip for any time chart ---------------- */
  const TVS = {};
  const TV_RANGES = { daily: [['3m', '3 months', 91], ['6m', '6 months', 182], ['1y', '1 year', 365], ['all', 'All', Infinity]],
    weekly: [['6m', '6 months', 26], ['1y', '1 year', 52], ['2y', '2 years', 104], ['all', 'All', Infinity]],
    monthly: [['1y', '1 year', 12], ['2y', '2 years', 24], ['3y', '3 years', 36], ['all', 'All', Infinity]] };
  const tvDefault = (gran, n) => (gran === 'daily' ? (n > 120 ? '3m' : 'all') : gran === 'weekly' ? (n > 60 ? '1y' : 'all') : (n > 30 ? '2y' : 'all'));
  const tvState = (id) => TVS[id] || (TVS[id] = { range: null, weekly: false, smooth: true, band: true });
  const wkStart = (iso) => { const d = new Date(String(iso).slice(0, 10) + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
  const tvRolling = (a, k) => a.map((_, i) => { const w = a.slice(Math.max(0, i - k + 1), i + 1).filter((v) => v != null && Number.isFinite(v)); return w.length ? w.reduce((x, y) => x + y, 0) / w.length : null; });
  function tvWeeks(dates, vals, additive) {
    const m = new Map();
    dates.forEach((d, i) => { const k = wkStart(d), v = vals[i]; if (v == null || !Number.isFinite(v)) return; const g = m.get(k) || { s: 0, n: 0 }; g.s += v; g.n++; m.set(k, g); });
    const keys = [...m.keys()].sort();
    return { dates: keys, vals: keys.map((k) => (additive ? m.get(k).s : m.get(k).s / m.get(k).n)), counts: keys.map((k) => m.get(k).n) };
  }
  /**
   * Shapes a time chart for the current view of chart `id`.
   * hd: history dates; lines: arrays of history values (one per line); fd: forecast dates; fcs: [{p10, p50, p90}] per line (p10/p90 optional).
   * Returns sliced history (the visible window), the full history (for the overview), the forecast, and notes for the reader.
   */
  function tvShape(id, gran, hd, lines, fd, fcs, additive) {
    const v = tvState(id), weekly = gran === 'daily' && v.weekly, notes = [];
    let H = hd, L = lines, F = fd, FC = fcs, g = gran;
    if (weekly) {
      const hw = lines.map((a) => tvWeeks(hd, a, additive));
      const fw = fcs.map((f) => {
        const mid = tvWeeks(fd, f.p50, additive), m = new Map();
        if (f.p10 && f.p90) fd.forEach((d, i) => { const k = wkStart(d), q = m.get(k) || { lo: 0, hi: 0 }; q.lo += (f.p50[i] - f.p10[i]) ** 2; q.hi += (f.p90[i] - f.p50[i]) ** 2; m.set(k, q); });
        const lo = f.p10 ? mid.dates.map((k, j) => (additive ? Math.max(0, mid.vals[j] - Math.sqrt(m.get(k).lo)) : mid.vals[j] - Math.sqrt(m.get(k).lo) / mid.counts[j])) : null;
        const hi = f.p90 ? mid.dates.map((k, j) => (additive ? mid.vals[j] + Math.sqrt(m.get(k).hi) : mid.vals[j] + Math.sqrt(m.get(k).hi) / mid.counts[j])) : null;
        return { dates: mid.dates, p50: mid.vals, p10: lo, p90: hi, counts: mid.counts };
      });
      let hD = hw[0].dates.slice(), fD = fw[0].dates.slice();
      if (additive && hD.length && fD.length && hD[hD.length - 1] === fD[0]) {       // the week split between history and forecast is shown once, as forecast
        hw.forEach((h, k) => { const part = h.vals[h.vals.length - 1]; fw[k].p50[0] += part; if (fw[k].p10) fw[k].p10[0] += part; if (fw[k].p90) fw[k].p90[0] += part; });
        fw[0].counts[0] += hw[0].counts[hw[0].counts.length - 1];
        hw.forEach((h) => { h.vals.pop(); }); hw[0].counts.pop(); hD.pop(); notes.push('The first forecast week includes the recorded days of that week.');
      }
      if (additive && hw[0].counts[0] < 7) { hw.forEach((h) => h.vals.shift()); hw[0].counts.shift(); hD.shift(); notes.push('The first, incomplete week of history is left out.'); }
      if (additive && fw[0].counts.length > 1 && fw[0].counts[fw[0].counts.length - 1] < 7) { fw.forEach((f) => { f.p50.pop(); if (f.p10) f.p10.pop(); if (f.p90) f.p90.pop(); }); fD.pop(); notes.push('The last forecast week is incomplete and is left out.'); }
      H = hD; L = hw.map((h) => h.vals); F = fD; FC = fw.map((f) => ({ p10: f.p10, p50: f.p50, p90: f.p90 })); g = 'weekly';
      if (fcs.some((f) => f.p10)) notes.push('Weekly ranges combine the daily ranges as if days vary independently, so they are approximate.');
    }
    const opts = TV_RANGES[g], key = v.range && opts.some((o) => o[0] === v.range) ? v.range : tvDefault(g, H.length);
    const keep = (opts.find((o) => o[0] === key) || opts[opts.length - 1])[2], start = Math.max(0, H.length - keep);
    if (start > 0) notes.unshift(`Showing the last ${H.length - start} of ${H.length} ${g === 'daily' ? 'days' : g === 'weekly' ? 'weeks' : 'months'} and the forecast. Pick a range to see more.`);
    return { gran: g, weekly, key, start, hd: H.slice(start), lines: L.map((a) => a.slice(start)), allHd: H, allLines: L, fd: F, fcs: FC, notes,
      smooth: g === 'daily' && v.smooth && H.length - start > 21, band: v.band };
  }
  /** Puts the controls above the chart and the overview strip below it, and redraws on every change. opts: {smooth, band} say which toggles to offer. */
  function tvMount(id, gran, nHist, opts, render) {
    const card = document.querySelector(`[data-chart="${id}"] .ff`); if (!card) { render(); return; }
    const wrap = card.querySelector('.chart-wrap');
    let host = card.querySelector(`[data-tv="${id}"]`);
    if (!host) {
      wrap.insertAdjacentHTML('beforebegin', `<div class="fc-controls-host" data-tv="${id}"></div>`);
      wrap.insertAdjacentHTML('afterend', `<div class="chart-wrap overview"><canvas id="${id}-ov" aria-hidden="true"></canvas></div><div class="muted small tv-note" id="${id}-note"></div>`);
      host = card.querySelector(`[data-tv="${id}"]`);
    }
    const v = tvState(id);
    const draw = () => {
      const g = gran === 'daily' && v.weekly ? 'weekly' : gran, n = gran === 'daily' && v.weekly ? Math.ceil(nHist / 7) : nHist;
      const cur = v.range && TV_RANGES[g].some((o) => o[0] === v.range) ? v.range : tvDefault(g, n);
      const seg = (name, items, on) => `<div class="seg" data-tvc="${name}">${items.map(([k, l]) => `<button type="button" data-v="${k}" aria-pressed="${k === on}">${l}</button>`).join('')}</div>`;
      const chk = (k, l) => `<label class="row small" style="gap:4px"><input type="checkbox" data-tvl="${k}" ${v[k] ? 'checked' : ''}> ${l}</label>`;
      host.innerHTML = `<div class="fc-controls">${seg('range', TV_RANGES[g].map((o) => [o[0], o[1]]), cur)}${gran === 'daily' ? seg('grain', [['day', 'Daily'], ['week', 'Weekly']], v.weekly ? 'week' : 'day') : ''}
        ${gran === 'daily' && !v.weekly && opts.smooth ? chk('smooth', '7-day average') : ''}${opts.band ? chk('band', 'Range band') : ''}</div>`;
      host.querySelectorAll('[data-tvc="range"] button').forEach((b) => { b.onclick = () => { v.range = b.dataset.v; draw(); }; });
      host.querySelectorAll('[data-tvc="grain"] button').forEach((b) => { b.onclick = () => { v.weekly = b.dataset.v === 'week'; v.range = null; draw(); }; });
      host.querySelectorAll('[data-tvl]').forEach((c) => { c.onchange = () => { v[c.dataset.tvl] = c.checked; draw(); }; });
      const shaped = render();
      if (shaped) { tvOverview(id + '-ov', shaped, opts.additive); const note = document.getElementById(id + '-note'); if (note) note.textContent = shaped.notes.join(' '); }
    };
    draw();
  }
  /** Small strip under a chart: all history (total of the lines when they add up, else the first line) and the forecast, with the visible window highlighted. */
  function tvOverview(id, sh, additive) {
    const el = document.getElementById(id); if (!el) return;
    const n = sh.allHd.length, labels = sh.allHd.concat(sh.fd), col = PALETTE[0];
    const sumAt = (arrs, i) => arrs.reduce((a, x) => a + (Number.isFinite(x[i]) ? x[i] : 0), 0);
    const hist = additive && sh.allLines.length > 1 ? sh.allHd.map((_, i) => sumAt(sh.allLines, i)) : sh.allLines[0];
    const fc = additive && sh.fcs.length > 1 ? sh.fd.map((_, i) => sumAt(sh.fcs.map((f) => f.p50), i)) : sh.fcs[0].p50;
    const win = { id: 'win', beforeDatasetsDraw(chart) { const { ctx, chartArea: ar, scales: { x } } = chart; const x0 = x.getPixelForValue(sh.start), x1 = x.getPixelForValue(n - 1);
      ctx.save(); ctx.fillStyle = (css('--accent') || '#3de0ff') + '22'; ctx.strokeStyle = (css('--accent') || '#3de0ff') + '88'; ctx.fillRect(x0, ar.top, x1 - x0, ar.bottom - ar.top); ctx.strokeRect(x0, ar.top, x1 - x0, ar.bottom - ar.top);
      ctx.fillStyle = css('--fc-zone') || 'rgba(139,92,246,.12)'; ctx.fillRect(x1, ar.top, ar.right - x1, ar.bottom - ar.top); ctx.restore(); } };
    make(id, { type: 'line', noDetail: true, data: { labels, datasets: [
      { data: hist.concat(Array(sh.fd.length).fill(null)), borderColor: css('--muted') || '#888', borderWidth: 1, pointRadius: 0 },
      { data: Array(n - 1).fill(null).concat([hist[n - 1]], fc), borderColor: col, borderWidth: 1.5, borderDash: [4, 3], pointRadius: 0 }] }, plugins: [win],
      options: { animation: false, events: [], plugins: { legend: { display: false }, tooltip: { enabled: false } }, scales: { x: { display: false }, y: { display: false, beginAtZero: !!additive } } } });
  }
  const tvTick = (gran) => (iso) => { const d = new Date(String(iso).slice(0, 10) + 'T00:00:00Z'); if (Number.isNaN(d.getTime())) return iso;
    return gran === 'monthly' ? d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' }) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }); };
  document.addEventListener('themechange', () => { if (App.skins) { PALETTE.splice(0, PALETTE.length, ...App.skins.palette()); registry.clear(); } defaults(); });
  App.charts = { timeView: { shape: tvShape, mount: tvMount, state: tvState, weekOf: wkStart, rolling: tvRolling, tick: tvTick }, setBack: (id, fn) => { if (fn) backs.set(id, fn); else backs.delete(id); }, detailOnly: (id) => only.add(id), setDetail, detail, pointDetail, nowLine, fcTitle, colorFor, register, make, box, evidence, bar, line, doughnut, heat, calendar, destroyAll, css, PALETTE };
})(window.App);
