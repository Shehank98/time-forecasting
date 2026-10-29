/* Chart.js wrappers, per-advertiser colour registry, heatmaps and PNG download. */
(function (App) {
  const { esc, fmt } = App;
  const PALETTE = ['#5b5ce6', '#12a6a0', '#f08a24', '#d6457f', '#3b9ae1', '#8b5cf6', '#c9a30a', '#3ea65a', '#e5484d', '#0b8fb8', '#a16207', '#6b7280'];
  const registry = new Map();
  const charts = new Map();
  function colorFor(name) {
    if (name === 'Others') return '#9aa0b8';
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
  function box(id, title, sub, opts = {}) {
    return `<div class="card"><div class="card-head"><div><h3>${esc(title)}</h3>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>
      <div class="row">${opts.extra || ''}<button class="btn sm ghost" type="button" data-png="${id}" aria-label="Download ${esc(title)} as PNG">PNG</button></div></div>
      <div class="chart-wrap ${opts.tall ? 'tall' : ''}"><canvas id="${id}" role="img" aria-label="${esc(title)}"></canvas></div></div>`;
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
  App.charts = { colorFor, register, make, box, bar, line, doughnut, heat, calendar, destroyAll, css, PALETTE };
})(window.App);
