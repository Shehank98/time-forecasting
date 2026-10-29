/* Client KPI Forecast workspace: any dated client data, cost per result, drivers and seasonality. */
(function (App) {
  const { esc, fmt, charts: C, tables: T } = App;
  const uf = (u) => ({ currency: fmt.lkrc, percent: (v) => fmt.pct(v, 1), rating: (v) => fmt.num(v, 2) }[u] || ((v) => fmt.compact(v)));
  const kpi = (l, v, s) => `<div class="kpi"><div class="k-lbl">${esc(l)}</div><div class="k-val">${v}</div>${s ? `<div class="k-sub">${s}</div>` : ''}</div>`;

  function overview(p, ctx) {
    const d = ctx.data;
    const tr = d.trend;
    p.innerHTML = `<div class="kpis">${d.kpis.map((k) => kpi(k.label, `<span title="${esc(String(k.value))}">${uf(k.unit)(k.value)}</span>`, k.change_pct != null ? fmt.delta(k.change_pct) + ' vs previous period' : (k.agg === 'ratio' ? 'Cost per result' : ''))).join('')}</div>
      <div style="margin-top:16px">${C.box('c-trend', 'Trend', `${fmt.title(tr.granularity)} values`, { tall: true, extra: `<select id="t-metric" aria-label="Metric" style="max-width:220px">${tr.series.map((s, i) => `<option value="${i}">${esc(s.label)}</option>`).join('')}</select>` })}</div>
      ${d.seasonality.day_of_week || d.seasonality.month ? `<div class="grid g2" style="margin-top:16px">
        ${d.seasonality.day_of_week ? C.box('c-dow', 'Day of week pattern', `${esc(d.seasonality_metric)}, index (100 = average day)`, {}) : ''}
        ${d.seasonality.month ? C.box('c-mon', 'Seasonal pattern', `${esc(d.seasonality_metric)}, index (100 = average month)`, {}) : ''}</div>` : ''}`;
    const draw = () => { const s = tr.series[+p.querySelector('#t-metric').value]; C.line({ id: 'c-trend', labels: tr.dates, legend: false, valueFmt: uf(s.unit), datasets: [{ label: s.label, data: s.values, borderColor: C.PALETTE[0], backgroundColor: C.PALETTE[0] + '22', fill: true, spanGaps: true }] }); };
    p.querySelector('#t-metric').onchange = draw; draw();
    if (d.seasonality.day_of_week) { const s = d.seasonality.day_of_week; C.bar({ id: 'c-dow', labels: s.labels, valueFmt: (v) => fmt.num(v, 0), datasets: [{ data: s.index, backgroundColor: s.index.map((v) => (v >= 100 ? C.PALETTE[0] : C.PALETTE[11])) }] }); }
    if (d.seasonality.month) { const s = d.seasonality.month; C.bar({ id: 'c-mon', labels: s.labels, valueFmt: (v) => fmt.num(v, 0), datasets: [{ data: s.index, backgroundColor: s.index.map((v) => (v >= 100 ? C.PALETTE[1] : C.PALETTE[11])) }] }); }
  }
  function segments(p, ctx) {
    const d = ctx.data;
    if (!d.segments.length) { p.innerHTML = App.emptyState('No segments', 'Map a segment column (campaign, channel, product, region) when uploading to compare segments.'); return; }
    const first = d.metrics.find((m) => m.agg === 'sum');
    p.innerHTML = `${first ? C.box('c-seg', `${first.label} by segment`, '', { tall: true }) : ''}<div class="card" style="margin-top:16px"><div id="seg-t"></div></div>`;
    if (first) { const top = d.segments.slice(0, 15); C.bar({ id: 'c-seg', horizontal: true, labels: top.map((r) => r.segment), valueFmt: uf(first.unit), datasets: [{ data: top.map((r) => r[first.key]), backgroundColor: top.map((r) => C.colorFor(r.segment)) }] }); }
    T.create(p.querySelector('#seg-t'), { csv: 'segments', defaultSort: first ? { key: first.key, desc: true } : null, rows: d.segments, columns: [{ key: 'segment', label: 'Segment', html: (v) => `<span class="swatch" style="background:${C.colorFor(v)}"></span>${esc(v)}` }]
      .concat(d.metrics.map((m) => ({ key: m.key, label: m.label, num: true, fmt: uf(m.unit) }))).concat(first ? [{ key: 'share_pct', label: `Share of ${first.label}`, num: true, fmt: (v) => fmt.pct(v) }] : []) });
  }
  function drivers(p, ctx) {
    const d = ctx.data;
    p.innerHTML = `<div class="banner info"><span>How results have moved with spend and other drivers in this client's own history. This is association, not proof of cause. Use Spend scenarios in the Forecast tab to plan budgets.</span></div>
      <div class="card"><div id="drv"></div></div>`;
    T.create(p.querySelector('#drv'), { csv: 'driver_effects', search: false, empty: 'Needs at least one spend-like driver, one result metric and six periods of history.', rows: d.driver_effects, columns: [
      { key: 'driver', label: 'Driver' }, { key: 'kpi', label: 'Result' }, { key: 'kpi_per_unit', label: 'Extra results per unit', num: true, html: (v, r) => `${fmt.num(v, 1)} <span class="muted small">per ${fmt.num(r.per_unit)}</span>` },
      { key: 'correlation', label: 'Correlation', num: true, fmt: (v) => fmt.num(v, 2) }, { key: 'periods', label: 'Periods', num: true }, { key: 'text', label: 'Reading' }] });
  }
  const tabs = [{ id: 'overview', label: 'Overview', render: overview }, { id: 'segments', label: 'Segments', render: segments }, { id: 'drivers', label: 'Drivers', render: drivers },
    { id: 'forecast', label: 'Forecast studio', alwaysRender: true, render: (p, ctx) => App.forecast.tab(p, ctx) },
    { id: 'ai', label: 'AI insights', alwaysRender: true, render: (p, ctx) => App.insights.tab(p, ctx) },
    { id: 'rows', label: 'Raw rows', alwaysRender: true, render: (p, ctx) => App.rawRows(p, ctx) }];
  App.workspace({ kind: 'kpi', fileLabel: 'client data file', tabs });
})(window.App);
