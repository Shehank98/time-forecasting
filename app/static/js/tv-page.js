/* TV Programme Analysis workspace. */
(function (App) {
  const { esc, fmt, charts: C, tables: T } = App;
  const kpi = (l, v, s) => `<div class="kpi"><div class="k-lbl">${esc(l)}</div><div class="k-val">${v}</div>${s ? `<div class="k-sub">${s}</div>` : ''}</div>`;
  const relBadge = (v) => `<span class="badge ${{ 'Very reliable': 'good', Reliable: 'good', Variable: 'warn', Volatile: 'bad' }[v] || ''}">${esc(v)}</span>`;
  const progCols = [
    { key: 'program', label: 'Programme' }, { key: 'channel', label: 'Channel', fmt: fmt.title }, { key: 'airings', label: 'Airings', num: true },
    { key: 'avg_tvr', label: 'Avg TVR', num: true, fmt: (v) => fmt.num(v, 2) }, { key: 'max_tvr', label: 'Max TVR', num: true, fmt: (v) => fmt.num(v, 2) },
    { key: 'avg_reach', label: 'Avg reach', num: true, fmt: (v) => fmt.num(v) }, { key: 'total_reach', label: 'Total reach', num: true, fmt: (v) => fmt.num(v) },
    { key: 'avg_reach_pct', label: 'Avg reach %', num: true, fmt: (v) => fmt.num(v, 2) }, { key: 'avg_share', label: 'Avg share %', num: true, fmt: (v) => fmt.num(v, 2) }];

  function overview(p, ctx) {
    const d = ctx.data, k = d.kpis;
    C.register(d.by_channel.map((r) => r.channel));
    p.innerHTML = `<div class="kpis">${kpi('Programmes', fmt.num(k.programmes), fmt.num(k.airings) + ' airings')}${kpi('Channels', fmt.num(k.channels))}${kpi('Average TVR', fmt.num(k.avg_tvr, 2))}
      ${kpi('Total reach', fmt.num(k.total_reach), 'Sum across airings, not unique people')}${kpi('Top programme', esc(k.top_programme.name), `${esc(fmt.title(k.top_programme.channel))}, avg TVR ${fmt.num(k.top_programme.avg_tvr, 2)}`)}
      ${kpi('Top channel', esc(fmt.title(k.top_channel.name)), `Avg TVR ${fmt.num(k.top_channel.avg_tvr, 2)}`)}</div>
      <div class="grid g2" style="margin-top:16px">${C.box('c-top', 'Top programmes by average TVR', '', { tall: true })}${C.box('c-chan', 'Average TVR by channel', '', { tall: true })}</div>
      <div style="margin-top:16px">${C.box('c-daily', 'Daily average TVR', 'All airings in the filtered window', {})}</div>`;
    const top = d.top_programmes.slice(0, 10);
    C.bar({ id: 'c-top', horizontal: true, labels: top.map((r) => `${r.program} (${fmt.title(r.channel)})`), valueFmt: (v) => fmt.num(v, 2), datasets: [{ data: top.map((r) => r.avg_tvr), backgroundColor: top.map((r) => C.colorFor(r.channel)) }] });
    C.bar({ id: 'c-chan', labels: d.by_channel.map((r) => fmt.title(r.channel)), valueFmt: (v) => fmt.num(v, 2), datasets: [{ data: d.by_channel.map((r) => r.avg_tvr), backgroundColor: d.by_channel.map((r) => C.colorFor(r.channel)) }] });
    C.line({ id: 'c-daily', labels: d.daily_tvr.dates, legend: false, valueFmt: (v) => fmt.num(v, 2), datasets: [{ label: 'Avg TVR', data: d.daily_tvr.values, borderColor: C.PALETTE[0], backgroundColor: C.PALETTE[0] + '33', fill: true }] });
  }
  function programmes(p, ctx) {
    p.innerHTML = '<div class="card"><div class="card-head"><div><h3>Top programmes</h3><div class="sub">Ranked by average TVR across airings. Click a header to re-rank by reach or share.</div></div></div><div id="pg"></div></div>';
    T.create(p.querySelector('#pg'), { columns: progCols, rows: ctx.data.top_programmes, csv: 'top_programmes', defaultSort: { key: 'avg_tvr', desc: true } });
  }
  function heatmaps(p, ctx) {
    const d = ctx.data;
    p.innerHTML = `<div class="stack"><div class="card"><h3>Average TVR: channel by category</h3>${C.heat(d.heat_category, { fmt: (v) => fmt.num(v, 2) })}</div>
      <div class="card"><h3>Average TVR: channel by daypart</h3>${C.heat(d.heat_daypart, { fmt: (v) => fmt.num(v, 2) })}</div>
      <div class="card"><h3>Average TVR: channel by day of week</h3>${C.heat(d.heat_day, { fmt: (v) => fmt.num(v, 2) })}</div>
      <div class="card"><h3>Average TVR: time-belt by day of week</h3><div class="sub muted small">The TVR & Audience Forecast tab projects the day and hour pattern forward; the Forecast studio can forecast each time-belt.</div>${C.heat(d.heat_timebelt, { fmt: (v) => fmt.num(v, 2) })}</div></div>`;
  }
  function categories(p, ctx) {
    const d = ctx.data;
    p.innerHTML = `<div class="grid g2">${C.box('c-cat', 'Category performance', 'Average TVR', { tall: true })}${C.box('c-cat-t', 'Category trend', 'Weekly average TVR, top categories', { tall: true })}</div><div class="card" style="margin-top:16px"><div id="cat-t"></div></div>`;
    C.bar({ id: 'c-cat', horizontal: true, labels: d.by_category.slice(0, 12).map((r) => r.category), valueFmt: (v) => fmt.num(v, 2), datasets: [{ data: d.by_category.slice(0, 12).map((r) => r.avg_tvr), backgroundColor: C.PALETTE[0] }] });
    C.line({ id: 'c-cat-t', labels: d.category_trend.weeks, valueFmt: (v) => fmt.num(v, 2), datasets: d.category_trend.series.map((s) => ({ label: s.name, data: s.values, borderColor: C.colorFor('cat:' + s.name), backgroundColor: C.colorFor('cat:' + s.name), spanGaps: true })) });
    T.create(p.querySelector('#cat-t'), { csv: 'categories', defaultSort: { key: 'avg_tvr', desc: true }, rows: d.by_category, columns: [{ key: 'category', label: 'Category' }, { key: 'airings', label: 'Airings', num: true }, { key: 'avg_tvr', label: 'Avg TVR', num: true, fmt: (v) => fmt.num(v, 2) },
      { key: 'total_reach', label: 'Total reach', num: true, fmt: (v) => fmt.num(v) }, { key: 'avg_share', label: 'Avg share %', num: true, fmt: (v) => fmt.num(v, 2) }] });
  }
  function efficiency(p, ctx) {
    p.innerHTML = '<div class="card"><div class="card-head"><div><h3>Efficiency</h3><div class="sub">TVR per minute and reach per minute of airtime, plus average share</div></div></div><div id="ef"></div></div>';
    T.create(p.querySelector('#ef'), { csv: 'efficiency', defaultSort: { key: 'tvr_per_min', desc: true }, rows: ctx.data.efficiency, columns: [
      { key: 'program', label: 'Programme' }, { key: 'channel', label: 'Channel', fmt: fmt.title }, { key: 'airings', label: 'Airings', num: true }, { key: 'avg_duration', label: 'Avg minutes', num: true, fmt: (v) => fmt.num(v, 0) },
      { key: 'avg_tvr', label: 'Avg TVR', num: true, fmt: (v) => fmt.num(v, 2) }, { key: 'tvr_per_min', label: 'TVR per min', num: true, fmt: (v) => fmt.num(v, 3) },
      { key: 'reach_per_min', label: 'Reach per min', num: true, fmt: (v) => fmt.num(v) }, { key: 'avg_share', label: 'Avg share %', num: true, fmt: (v) => fmt.num(v, 2) }] });
  }
  function consistency(p, ctx) {
    const rows = ctx.data.consistency;
    p.innerHTML = `<div class="banner info"><span>Recurring slots are matched by Programme + Channel + Day + Start. A low coefficient of variation (CV = std dev / mean) means the audience is predictable. Slots with a single airing are left out.</span></div>
      <div class="card"><div id="cons"></div></div>`;
    T.create(p.querySelector('#cons'), { csv: 'consistency', defaultSort: { key: 'cv', desc: false }, empty: 'No programme has two or more airings in this window.', rows, columns: [
      { key: 'program', label: 'Programme' }, { key: 'channel', label: 'Channel', fmt: fmt.title }, { key: 'day', label: 'Day' }, { key: 'start', label: 'Start' }, { key: 'airings', label: 'Airings', num: true },
      { key: 'mean_tvr', label: 'Mean TVR', num: true, fmt: (v) => fmt.num(v, 2) }, { key: 'std_tvr', label: 'Std dev', num: true, fmt: (v) => fmt.num(v, 2) }, { key: 'cv', label: 'CV', num: true, fmt: (v) => fmt.num(v, 2) },
      { key: 'min_tvr', label: 'Min', num: true, fmt: (v) => fmt.num(v, 2) }, { key: 'max_tvr', label: 'Max', num: true, fmt: (v) => fmt.num(v, 2) }, { key: 'reliability', label: 'Reliability', html: relBadge }] });
  }
  function opportunity(p, ctx) {
    const o = ctx.data.opportunity;
    p.innerHTML = `<div class="banner info"><span>${esc(o.note)} Score = TVR percentile minus ad load percentile. Higher means strong audience with less ad clutter from monitored advertisers.</span></div><div class="card"><div id="opp"></div></div>`;
    T.create(p.querySelector('#opp'), { csv: 'slot_opportunity', defaultSort: { key: 'score', desc: true }, rows: o.rows, columns: [
      { key: 'channel', label: 'Channel', fmt: fmt.title }, { key: 'day', label: 'Day' }, { key: 'daypart', label: 'Daypart' }, { key: 'avg_tvr', label: 'Avg TVR', num: true, fmt: (v) => fmt.num(v, 2) },
      { key: 'ad_load_per_day', label: 'Ad spots per day', num: true, fmt: (v) => fmt.num(v, 1) }, { key: 'spend_per_day', label: 'Competitor spend per day', num: true, fmt: (v) => fmt.num(v) },
      { key: 'score', label: 'Opportunity score', num: true, fmt: (v) => fmt.num(v, 2) }] });
  }
  const tabs = [
    { id: 'overview', label: 'Overview', render: overview }, { id: 'programmes', label: 'Top programmes', render: programmes }, { id: 'heat', label: 'Heatmaps', render: heatmaps },
    { id: 'categories', label: 'Categories', render: categories }, { id: 'efficiency', label: 'Efficiency', render: efficiency }, { id: 'consistency', label: 'Consistency', render: consistency },
    { id: 'opportunity', label: 'Slot opportunity', render: opportunity, hidden: (ctx) => !(ctx.data && ctx.data.opportunity) },
  ];
  if (App.forecast) tabs.push({ id: 'forecast', label: 'Forecast studio', alwaysRender: true, render: (p, ctx) => App.forecast.tab(p, ctx) });
  if (App.insights) tabs.push({ id: 'ai', label: 'AI insights', alwaysRender: true, render: (p, ctx) => App.insights.tab(p, ctx) });
  tabs.push({ id: 'rows', label: 'Raw rows', alwaysRender: true, render: (p, ctx) => App.rawRows(p, ctx) });
  App.workspace({ kind: 'tv', fileLabel: 'TVR programme file', reportTitle: 'TVR audience prediction', tabs,
    predict: [App.predictTabs.tvr, App.predictTabs.market], defaultTab: 'p-tvr' });
})(window.App);
