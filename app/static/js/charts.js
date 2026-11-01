/* Chart.js wrappers, per-advertiser colour registry, heatmaps and PNG download. */
(function (App) {
  const { esc, fmt } = App;
  const PALETTE = ['#3de0ff', '#8b5cf6', '#ff4fd8', '#22f5a6', '#ffb547', '#4f8bff', '#ff6b6b', '#a3e635', '#f472b6', '#2dd4bf', '#facc15', '#94a3b8'];
  const registry = new Map();
  const charts = new Map();
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
    return `<div class="card ${opts.glow ? 'glow' : ''} ${opts.pill ? 'fc' : ''}"><div class="card-head"><div><h3>${pill}${esc(title)} ${help}</h3>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>
      <div class="row">${opts.extra || ''}${opts.html != null ? '' : `<button class="btn sm ghost" type="button" data-png="${id}" aria-label="Download ${esc(title)} as PNG">PNG</button>`}</div></div>
      ${body}${opts.ev ? `<div id="ev-${id}"></div>` : ''}</div>`;
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
      const label = o.label || 'FORECAST: estimated, not recorded', font = '700 11px ' + (css('--display') || 'sans-serif');
      ctx.font = font; const w = Math.min(ctx.measureText(label).width + 16, ar.right - px - 6);
      ctx.fillStyle = css('--surface-solid') || '#0d1430'; ctx.strokeStyle = col; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(px + 6, ar.top + 6, w, 20, 10) : ctx.rect(px + 6, ar.top + 6, w, 20); ctx.fill(); ctx.stroke();
      ctx.fillStyle = col; ctx.fillText(label, px + 14, ar.top + 20, w - 12); ctx.restore();
    } };
  /** Tooltip title that says whether the hovered point is actual or forecast. */
  const fcTitle = (firstForecastIndex) => (items) => `${items[0].label}  \u00b7  ${items[0].dataIndex >= firstForecastIndex ? 'FORECAST' : 'actual'}`;
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
    const cell = (v) => {
      if (v == null || Number.isNaN(v)) return '<td class="na">-</td>';
      let a = 0.08 + 0.82 * ((v - lo) / span); if (lowIsGood) a = 0.9 - 0.82 * ((v - lo) / span);
      return `<td style="background:rgba(var(--heat),${a.toFixed(2)});${a > 0.55 ? 'color:#fff;' : ''}">${esc(rowPct ? fmt.pct(v, 0) : f(v))}</td>`;
    };
    return `<div class="heat-wrap"><table class="heat">${caption ? `<caption class="sr-only">${esc(caption)}</caption>` : ''}<thead><tr><th></th>${m.cols.map((c) => `<th scope="col">${esc(fmt.title(c) === c ? c : c)}</th>`).join('')}</tr></thead>
      <tbody>${m.rows.map((r, i) => `<tr><th scope="row">${esc(r)}</th>${vals[i].map(cell).join('')}</tr>`).join('')}</tbody></table></div>`;
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
  document.addEventListener('themechange', defaults);
  App.charts = { nowLine, fcTitle, colorFor, register, make, box, evidence, bar, line, doughnut, heat, calendar, destroyAll, css, PALETTE };
})(window.App);
