/* LMRB Ad Monitoring workspace: competitor analysis tabs. */
(function (App) {
  const { esc, fmt, charts: C, tables: T } = App;
  const kpi = (l, v, s) => `<div class="kpi"><div class="k-lbl">${esc(l)}</div><div class="k-val">${v}</div>${s ? `<div class="k-sub">${s}</div>` : ''}</div>`;
  const swatch = (n) => `<span class="swatch" style="background:${C.colorFor(n)}"></span>`;
  const statusBadge = (s) => `<span class="badge ${{ NEW: 'good', DROPPED: 'bad', PAUSED: 'warn', RETURNING: 'info' }[s] || ''}">${esc(s)}</span>`;
  const patternBadge = (p) => `<span class="badge ${{ 'Always-on': 'good', Pulsing: 'warn', 'One-off': 'bad' }[p] || 'info'}">${esc(p)}</span>`;
  const sevBadge = (s) => `<span class="badge ${{ high: 'bad', medium: 'warn', low: 'info' }[s]}">${esc(s)}</span>`;

  function rankedCols(label, advertiser) {
    return [
      { key: 'rank', label: '#', num: true }, { key: 'name', label, html: (v) => (advertiser ? swatch(v) : '') + esc(v) },
      { key: 'spend', label: 'Spend (LKR)', num: true, fmt: (v) => fmt.num(v) }, { key: 'share_pct', label: 'Share', num: true, fmt: (v) => fmt.pct(v) },
      { key: 'spots', label: 'Spots', num: true, fmt: (v) => fmt.num(v) }, { key: 'spot_share_pct', label: 'Spot share', num: true, fmt: (v) => fmt.pct(v) },
      { key: 'change_pct', label: 'Change vs previous', num: true, html: (v) => fmt.delta(v) },
    ];
  }
  const cmpNote = (d) => {
    const c = d.comparison; if (!c || !c.prev) return 'No earlier data to compare with, so changes show n/a.';
    return `Change compares ${c.cur[0]} to ${c.cur[1]} with ${c.prev[0]} to ${c.prev[1]}.`;
  };
  const scopeNote = (d, ctx) => {
    if (!d.my_brand) return `<div class="banner info"><span>Showing all ${d.scope.length} advertisers in the filtered data. Pick "My brand" above to focus on a competitor set and unlock share of voice.</span></div>`;
    return `<div class="banner info"><span>Competitor set: ${d.scope.length} advertisers (${esc(d.scope.slice(0, 6).join(', '))}${d.scope.length > 6 ? ', ...' : ''}). ${esc(cmpNote(d))}</span></div>`;
  };

  /* ---------------- Overview ---------------- */
  function overview(p, ctx) {
    const d = ctx.data, k = d.kpis;
    C.register(d.all_advertiser_order);
    const sovS = k.sov_spend_pct == null ? 'Pick a brand' : fmt.pct(k.sov_spend_pct);
    p.innerHTML = `${scopeNote(d, ctx)}
      <div class="kpis">
        ${kpi('Total spend', `<span title="${fmt.lkr(k.total_spend)}">${fmt.lkrc(k.total_spend)}</span>`, k.spend_change_pct != null ? fmt.delta(k.spend_change_pct) + ' vs previous' : '')}
        ${kpi('Spots', fmt.num(k.spots), k.spots_change_pct != null ? fmt.delta(k.spots_change_pct) + ' vs previous' : '')}
        ${kpi('Avg cost per spot', fmt.lkr(k.avg_cost_per_spot))}${kpi('Avg cost per second', fmt.lkr(k.avg_cost_per_second))}
        ${kpi('Active creatives', fmt.num(k.active_creatives))}${kpi('Active channels', fmt.num(k.active_channels))}
        ${kpi('Share of voice (spend)', sovS, k.my_rank ? `Rank ${k.my_rank} of ${k.active_advertisers}` : '')}${kpi('Share of voice (spots)', k.sov_spots_pct == null ? 'Pick a brand' : fmt.pct(k.sov_spots_pct))}
      </div>
      <div class="grid g-wide" style="margin-top:16px">
        ${C.box('c-sov', 'Share of voice over time', 'Weekly, by advertiser', { extra: '<div class="seg" id="sov-seg"><button type="button" data-m="share" aria-pressed="true">Share %</button><button type="button" data-m="spend" aria-pressed="false">Spend</button><button type="button" data-m="spots" aria-pressed="false">Spots</button></div>', tall: true })}
        ${C.box('c-adv', 'Spend by advertiser', 'Filtered window', { tall: true })}
      </div>
      <div class="card" style="margin-top:16px"><div class="card-head"><div><h3>Latest competitor movements</h3><div class="sub">Full list in the Alerts tab</div></div></div><div id="ov-alerts" class="stack"></div></div>`;
    let mode = 'share';
    const drawSov = () => {
      const s = d.sov_weekly, totals = s.weeks.map((_, i) => s.advertisers.reduce((a, x) => a + (x[mode === 'spots' ? 'spots' : 'spend'][i] || 0), 0));
      C.line({ id: 'c-sov', labels: s.weeks, stacked: true, yMax: mode === 'share' ? 100 : undefined, valueFmt: mode === 'share' ? (v) => fmt.pct(v, 0) : fmt.compact,
        datasets: s.advertisers.map((a) => ({ label: a.name, borderColor: C.colorFor(a.name), backgroundColor: C.colorFor(a.name) + 'cc', fill: true, pointRadius: 0,
          data: a[mode === 'spots' ? 'spots' : 'spend'].map((v, i) => (mode === 'share' ? (totals[i] ? (v / totals[i]) * 100 : 0) : v)) })) });
    };
    drawSov();
    p.querySelectorAll('#sov-seg button').forEach((b) => { b.onclick = () => { mode = b.dataset.m; p.querySelectorAll('#sov-seg button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); drawSov(); }; });
    const top = d.by_advertiser.slice(0, 12);
    C.bar({ id: 'c-adv', horizontal: true, labels: top.map((r) => r.name), valueFmt: fmt.compact, datasets: [{ data: top.map((r) => r.spend), backgroundColor: top.map((r) => C.colorFor(r.name)) }] });
    p.querySelector('#ov-alerts').innerHTML = d.alerts.items.slice(0, 5).map(alertHtml).join('') || '<div class="muted">No movement alerts for the latest week.</div>';
  }
  const alertHtml = (a) => `<div class="alert ${a.severity}"><div>${sevBadge(a.severity)}</div><div><div>${a.is_mine ? '<span class="badge good">Your brand</span> ' : ''}${esc(a.text)}</div>
    <details class="evidence"><summary>Evidence</summary><ul>${Object.entries(a.evidence).map(([k, v]) => `<li>${esc(k.replace(/_/g, ' '))}: ${esc(typeof v === 'number' ? fmt.num(v, Math.abs(v) < 100 && v % 1 ? 1 : 0) : v)}</li>`).join('')}</ul></details></div></div>`;

  /* ---------------- Spend breakdowns ---------------- */
  const DIMS = [['by_advertiser', 'Advertiser'], ['by_product', 'Product'], ['by_channel', 'Channel'], ['by_daypart', 'Daypart'], ['by_language', 'Language'], ['by_product_group', 'Product group']];
  let dim = 'by_advertiser';
  function spend(p, ctx) {
    const d = ctx.data;
    p.innerHTML = `<div class="card-head"><div class="seg" id="dim-seg">${DIMS.map(([k, l]) => `<button type="button" data-k="${k}" aria-pressed="${k === dim}">${l}</button>`).join('')}</div><span class="muted small">${esc(cmpNote(d))}</span></div>
      <div class="grid g2">${C.box('c-dim', 'Spend ranking', 'LKR', { tall: true })}<div class="card"><div class="card-head"><h3>Share of spend</h3></div><div class="chart-wrap tall"><canvas id="c-dim2"></canvas></div></div></div>
      <div class="card" style="margin-top:16px" id="dim-table"></div>`;
    const draw = () => {
      const rows = d[dim], label = DIMS.find((x) => x[0] === dim)[1], isAdv = dim === 'by_advertiser';
      const top = rows.slice(0, 15);
      C.bar({ id: 'c-dim', horizontal: true, labels: top.map((r) => r.name), valueFmt: fmt.compact, datasets: [{ label: 'Spend', data: top.map((r) => r.spend), backgroundColor: top.map((r) => (isAdv ? C.colorFor(r.name) : C.PALETTE[0])) }] });
      const t8 = rows.slice(0, 8), rest = rows.slice(8).reduce((a, r) => a + r.spend, 0);
      C.doughnut({ id: 'c-dim2', labels: t8.map((r) => r.name).concat(rest ? ['Others'] : []), data: t8.map((r) => r.spend).concat(rest ? [rest] : []), colors: t8.map((r, i) => (isAdv ? C.colorFor(r.name) : C.PALETTE[i % 12])).concat(rest ? ['#9aa0b8'] : []) });
      T.create(p.querySelector('#dim-table'), { columns: rankedCols(label, isAdv), rows, csv: 'spend_by_' + dim.slice(3), defaultSort: { key: 'spend', desc: true } });
    };
    draw();
    p.querySelectorAll('#dim-seg button').forEach((b) => { b.onclick = () => { dim = b.dataset.k; p.querySelectorAll('#dim-seg button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); draw(); }; });
  }

  /* ---------------- Mix heatmaps ---------------- */
  let mixPct = true;
  function mix(p, ctx) {
    const d = ctx.data;
    p.innerHTML = `<div class="card-head"><div class="seg" id="mix-seg"><button type="button" data-p="1" aria-pressed="${mixPct}">% of advertiser spend</button><button type="button" data-p="0" aria-pressed="${!mixPct}">Spend (LKR)</button></div></div>
      <div class="stack"><div class="card"><h3>Advertiser by channel</h3><div id="h-ch"></div></div><div class="card"><h3>Advertiser by daypart</h3><div id="h-dp"></div></div>
      <div class="card"><h3>Advertiser by programme (top programmes in scope)</h3><div id="h-pg"></div></div></div>`;
    const draw = () => { p.querySelector('#h-ch').innerHTML = C.heat(d.mix_channel, { rowPct: mixPct, caption: 'Advertiser by channel' }); p.querySelector('#h-dp').innerHTML = C.heat(d.mix_daypart, { rowPct: mixPct, caption: 'Advertiser by daypart' }); p.querySelector('#h-pg').innerHTML = C.heat(d.mix_program, { rowPct: mixPct, caption: 'Advertiser by programme' }); };
    draw();
    p.querySelectorAll('#mix-seg button').forEach((b) => { b.onclick = () => { mixPct = b.dataset.p === '1'; p.querySelectorAll('#mix-seg button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); draw(); }; });
  }

  /* ---------------- Flighting ---------------- */
  function flighting(p, ctx) {
    const f = ctx.data.flighting;
    p.innerHTML = `<div class="card"><div class="card-head"><div><h3>Daily spot calendar</h3><div class="sub">Spots per day for the top advertisers. Darker means more spots.</div></div></div>${C.calendar(f.calendar)}</div>
      <div class="card" style="margin-top:16px"><div class="card-head"><div><h3>Flighting patterns</h3><div class="sub">Always-on, pulsing, gaps and burst windows (days with spend above the advertiser's average plus one standard deviation)</div></div></div><div id="fl-table"></div></div>`;
    T.create(p.querySelector('#fl-table'), { csv: 'flighting', defaultSort: { key: 'spend', desc: true }, rows: f.advertisers.map((a) => ({ ...a, bursts_txt: a.bursts.map((b) => `${b.start} to ${b.end}`).join('; '), gaps_txt: a.gaps.map((g) => `${g.start} (${g.days}d)`).join('; ') })), columns: [
      { key: 'advertiser', label: 'Advertiser', html: (v) => swatch(v) + esc(v) }, { key: 'pattern', label: 'Pattern', html: patternBadge },
      { key: 'first_date', label: 'Flight start' }, { key: 'last_date', label: 'Flight end' },
      { key: 'active_days', label: 'Active days', num: true }, { key: 'active_ratio', label: 'Coverage', num: true, fmt: (v) => fmt.pct(v * 100, 0) },
      { key: 'longest_gap_days', label: 'Longest gap (days)', num: true }, { key: 'burst_count', label: 'Bursts', num: true },
      { key: 'bursts_txt', label: 'Burst windows' }, { key: 'gaps_txt', label: 'Gaps (2+ days)' },
      { key: 'spend', label: 'Spend', num: true, fmt: (v) => fmt.num(v) }, { key: 'spots', label: 'Spots', num: true }] });
  }

  /* ---------------- Creatives ---------------- */
  let cstat = 'ALL';
  function creatives(p, ctx) {
    const rows = ctx.data.creatives; const counts = {}; rows.forEach((r) => { counts[r.status] = (counts[r.status] || 0) + 1; });
    const opts = ['ALL', 'NEW', 'DROPPED', 'RETURNING', 'PAUSED', 'ACTIVE'].filter((s) => s === 'ALL' || counts[s]);
    p.innerHTML = `<div class="banner info"><span>${esc(cmpNote(ctx.data))} NEW means first seen in the latest window. DROPPED means it ran in the previous window but not the latest.</span></div>
      <div class="card"><div class="card-head"><div class="seg" id="cs-seg">${opts.map((s) => `<button type="button" data-s="${s}" aria-pressed="${s === cstat}">${s === 'ALL' ? 'All' : fmt.title(s)} ${s === 'ALL' ? `(${rows.length})` : `(${counts[s]})`}</button>`).join('')}</div></div><div id="cr-table"></div></div>`;
    const t = T.create(p.querySelector('#cr-table'), { csv: 'creatives', defaultSort: { key: 'spend', desc: true }, rows: cstat === 'ALL' ? rows : rows.filter((r) => r.status === cstat), columns: [
      { key: 'status', label: 'Status', html: statusBadge }, { key: 'advertiser', label: 'Advertiser', html: (v) => swatch(v) + esc(v) }, { key: 'product', label: 'Product' }, { key: 'theme', label: 'Creative (Advt_Theme)' },
      { key: 'first_seen', label: 'First seen' }, { key: 'last_seen', label: 'Last seen' }, { key: 'spots', label: 'Spots', num: true }, { key: 'spend', label: 'Spend', num: true, fmt: (v) => fmt.num(v) },
      { key: 'channels', label: 'Channels', fmt: (v) => (v || []).map(fmt.title).join(', ') }] });
    p.querySelectorAll('#cs-seg button').forEach((b) => { b.onclick = () => { cstat = b.dataset.s; p.querySelectorAll('#cs-seg button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); t.refresh(cstat === 'ALL' ? rows : rows.filter((r) => r.status === cstat)); }; });
  }

  /* ---------------- Pricing ---------------- */
  function pricing(p, ctx) {
    const pr = ctx.data.pricing;
    p.innerHTML = `<div class="banner info"><span>Cost per second (CPS) is cost divided by spot seconds. Each advertiser cell is compared with the median CPS of every spot on that channel and daypart. Below 80% of median with 3+ spots is flagged as a possible discount deal.</span></div>
      <div class="card"><h3>Median cost per second by channel and daypart (LKR)</h3><div id="pr-heat">${C.heat(pr.heatmap, { fmt: (v) => fmt.num(v) })}</div></div>
      <div class="grid g2" style="margin-top:16px"><div class="card"><h3>Possible discount deals</h3><div id="pr-flags"></div></div><div class="card"><h3>Price outlier spots</h3><div class="sub muted small">Outside 1.5 x IQR of their channel and daypart</div><div id="pr-out"></div></div></div>
      <div class="card" style="margin-top:16px"><h3>Cost per second by advertiser, channel and daypart</h3><div id="pr-cells"></div></div>`;
    const cell = (c) => c;
    T.create(p.querySelector('#pr-flags'), { csv: 'discount_flags', pageSize: 8, empty: 'No advertiser is paying notably below the median.', rows: pr.discount_flags, columns: [
      { key: 'advertiser', label: 'Advertiser', html: (v) => swatch(v) + esc(v) }, { key: 'channel', label: 'Channel', fmt: fmt.title }, { key: 'daypart', label: 'Daypart' }, { key: 'spots', label: 'Spots', num: true },
      { key: 'cps', label: 'CPS', num: true, fmt: (v) => fmt.num(v) }, { key: 'index_vs_median', label: 'Index vs median', num: true, fmt: (v) => fmt.num(v * 100) + '%' }] });
    T.create(p.querySelector('#pr-out'), { csv: 'price_outliers', pageSize: 8, empty: 'No price outliers found (needs 8+ spots per channel and daypart).', rows: pr.outliers, columns: [
      { key: 'date', label: 'Date' }, { key: 'advertiser', label: 'Advertiser' }, { key: 'channel', label: 'Channel', fmt: fmt.title }, { key: 'daypart', label: 'Daypart' },
      { key: 'cps', label: 'CPS', num: true, fmt: (v) => fmt.num(v) }, { key: 'median_cps', label: 'Median', num: true, fmt: (v) => fmt.num(v) }] });
    T.create(p.querySelector('#pr-cells'), { csv: 'pricing_cells', defaultSort: { key: 'spend', desc: true }, rows: pr.cells.map(cell), columns: [
      { key: 'advertiser', label: 'Advertiser', html: (v) => swatch(v) + esc(v) }, { key: 'channel', label: 'Channel', fmt: fmt.title }, { key: 'daypart', label: 'Daypart' }, { key: 'spots', label: 'Spots', num: true },
      { key: 'spend', label: 'Spend', num: true, fmt: (v) => fmt.num(v) }, { key: 'cps', label: 'CPS', num: true, fmt: (v) => fmt.num(v) }, { key: 'median_cps', label: 'Median CPS', num: true, fmt: (v) => fmt.num(v) },
      { key: 'index_vs_median', label: 'Index', num: true, fmt: (v) => fmt.num(v * 100) + '%' }, { key: 'flag', label: 'Flag', html: (v) => (v ? `<span class="badge ${v.startsWith('Below') ? 'good' : 'warn'}">${esc(v)}</span>` : '') }] });
  }

  /* ---------------- Position ---------------- */
  function position(p, ctx) {
    const rows = ctx.data.position;
    p.innerHTML = `<div class="grid g2">${C.box('c-pos', 'First and last in break rate', 'Percent of each advertiser\'s spots', { tall: true })}${C.box('c-pos2', 'Share of all first-in-break placements', 'Which advertiser owns the premium slot', { tall: true })}</div>
      <div class="card" style="margin-top:16px" id="pos-table"></div>`;
    if (!rows.length) { p.innerHTML = App.emptyState('No break position data', 'PosinBrk and AdsinBrk columns are needed.'); return; }
    const top = rows.slice(0, 12);
    C.bar({ id: 'c-pos', labels: top.map((r) => r.advertiser), valueFmt: (v) => fmt.pct(v, 0), datasets: [{ label: 'First in break', data: top.map((r) => r.first_rate_pct), backgroundColor: C.PALETTE[0] }, { label: 'Last in break', data: top.map((r) => r.last_rate_pct), backgroundColor: C.PALETTE[2] }] });
    C.bar({ id: 'c-pos2', horizontal: true, labels: top.map((r) => r.advertiser), valueFmt: (v) => fmt.pct(v, 0), datasets: [{ label: 'Share of first', data: top.map((r) => r.share_of_first_pct || 0), backgroundColor: top.map((r) => C.colorFor(r.advertiser)) }] });
    T.create(p.querySelector('#pos-table'), { csv: 'position_strategy', defaultSort: { key: 'spend', desc: true }, rows, columns: [
      { key: 'advertiser', label: 'Advertiser', html: (v) => swatch(v) + esc(v) }, { key: 'spots', label: 'Spots', num: true }, { key: 'first_n', label: 'First', num: true }, { key: 'last_n', label: 'Last', num: true },
      { key: 'first_rate_pct', label: 'First rate', num: true, fmt: (v) => fmt.pct(v) }, { key: 'last_rate_pct', label: 'Last rate', num: true, fmt: (v) => fmt.pct(v) },
      { key: 'share_of_first_pct', label: 'Share of all firsts', num: true, fmt: (v) => fmt.pct(v) }, { key: 'share_of_last_pct', label: 'Share of all lasts', num: true, fmt: (v) => fmt.pct(v) }] });
  }

  /* ---------------- Alerts ---------------- */
  function alerts(p, ctx) {
    const a = ctx.data.alerts;
    p.innerHTML = `${(a.notes || []).map((n) => `<div class="banner"><span>${esc(n)}</span></div>`).join('')}
      <div class="muted small" style="margin-bottom:10px">${a.window ? `Latest 7 days ${a.window.cur[0]} to ${a.window.cur[1]} compared with ${a.window.prev[0]} to ${a.window.prev[1]}.` : ''}</div>
      <div class="stack">${a.items.map(alertHtml).join('') || App.emptyState('No competitor movement detected', 'Rules need at least a week of history and a 30% change.')}</div>`;
  }

  /* ---------------- Head to head ---------------- */
  let h2h = { a: '', b: '' };
  async function head(p, ctx) {
    const adv = ctx.data.advertiser_order; if (adv.length < 2) { p.innerHTML = App.emptyState('Need two advertisers', 'Widen the filters to include at least two.'); return; }
    if (!adv.includes(h2h.a)) h2h.a = ctx.data.my_brand && adv.includes(ctx.data.my_brand) ? ctx.data.my_brand : adv[0];
    if (!adv.includes(h2h.b) || h2h.b === h2h.a) h2h.b = adv.find((x) => x !== h2h.a);
    p.innerHTML = `<div class="card"><div class="grid g2"><div class="field"><label for="h-a">Advertiser A</label><select id="h-a">${adv.map((x) => `<option ${x === h2h.a ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></div>
      <div class="field"><label for="h-b">Advertiser B</label><select id="h-b">${adv.map((x) => `<option ${x === h2h.b ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></div></div></div><div id="h-out" style="margin-top:16px"></div>`;
    const run = async () => {
      h2h.a = p.querySelector('#h-a').value; h2h.b = p.querySelector('#h-b').value; const out = p.querySelector('#h-out');
      if (h2h.a === h2h.b) { out.innerHTML = App.emptyState('Pick two different advertisers'); return; }
      out.innerHTML = App.skeleton(2);
      try { const r = await App.api.post('/api/lmrb/head2head', { filters: ctx.filters(), options: { a: h2h.a, b: h2h.b } }); drawHead(out, r); } catch (e) { out.innerHTML = App.emptyState('Could not compare', e.message); }
    };
    p.querySelector('#h-a').onchange = run; p.querySelector('#h-b').onchange = run; run();
  }
  function drawHead(out, r) {
    const A = r.sides[r.a], B = r.sides[r.b];
    if (A.empty || B.empty) { out.innerHTML = App.emptyState('One advertiser has no spots in this window'); return; }
    const rows = [['Total spend', (s) => fmt.lkr(s.kpis.total_spend)], ['Spots', (s) => fmt.num(s.kpis.spots)], ['Avg cost per spot', (s) => fmt.lkr(s.kpis.avg_cost_per_spot)], ['Avg cost per second', (s) => fmt.lkr(s.kpis.avg_cost_per_second)],
      ['Active creatives', (s) => s.kpis.active_creatives], ['Active channels', (s) => s.kpis.active_channels], ['Prime share of spend', (s) => fmt.pct(s.prime_spend_pct, 0)],
      ['First-in-break rate', (s) => fmt.pct(s.position && s.position.first_rate_pct)], ['Last-in-break rate', (s) => fmt.pct(s.position && s.position.last_rate_pct)],
      ['Flighting pattern', (s) => patternBadge(s.flighting.pattern)], ['Flight window', (s) => `${s.flighting.first_date} to ${s.flighting.last_date}`], ['Bursts', (s) => s.flighting.burst_count], ['Longest gap (days)', (s) => s.flighting.longest_gap_days]];
    out.innerHTML = `${r.highlights.length ? `<div class="banner info"><span>${r.highlights.map(esc).join(' ')}</span></div>` : ''}
      <div class="card"><table class="tbl"><thead><tr><th>Metric</th><th>${swatch(r.a)}${esc(r.a)}</th><th>${swatch(r.b)}${esc(r.b)}</th></tr></thead><tbody>${rows.map(([l, f]) => `<tr><td>${l}</td><td>${f(A)}</td><td>${f(B)}</td></tr>`).join('')}</tbody></table></div>
      <div class="grid g2" style="margin-top:16px">${C.box('hh-week', 'Weekly spend', '', {})}${C.box('hh-ch', 'Spend by channel', '', {})}${C.box('hh-dp', 'Spend by daypart', '', {})}${C.box('hh-lg', 'Spend by language', '', {})}</div>`;
    const colors = [C.colorFor(r.a), C.colorFor(r.b)];
    const union = (k) => [...new Set([...A[k].map((x) => x.name), ...B[k].map((x) => x.name)])];
    const val = (s, k, n) => (s[k].find((x) => x.name === n) || {}).spend || 0;
    C.line({ id: 'hh-week', labels: A.weeks.length >= B.weeks.length ? A.weeks : B.weeks, datasets: [A, B].map((s, i) => ({ label: [r.a, r.b][i], data: s.weekly.spend, borderColor: colors[i], backgroundColor: colors[i] })) });
    [['hh-ch', 'by_channel'], ['hh-dp', 'by_daypart'], ['hh-lg', 'by_language']].forEach(([id, k]) => { const labs = union(k); C.bar({ id, labels: labs.map(fmt.title), datasets: [A, B].map((s, i) => ({ label: [r.a, r.b][i], data: labs.map((n) => val(s, k, n)), backgroundColor: colors[i] })) }); });
  }

  /* ---------------- GRPs and CPRP ---------------- */
  function grps(p, ctx) {
    const g = ctx.data.grp, st = ctx.meta.grp_stats || {};
    const k = (l, v, s) => `<div class="kpi"><div class="k-lbl">${esc(l)}</div><div class="k-val">${v}</div>${s ? `<div class="k-sub">${s}</div>` : ''}</div>`;
    p.innerHTML = `<div class="banner info"><span>${esc(g.note)} Audience: <b>${esc(st.data_set || 'n/a')}</b>. ${fmt.num(g.matched_spots)} of ${fmt.num(g.spots)} spots in this view matched a rated programme (${fmt.pct(g.match_rate_pct, 0)}). Spots outside the TVR file's dates or channels are not counted.</span></div>
      <div class="kpis">${k('GRPs delivered', fmt.num(g.total_grps, 1))}${k('Average CPRP', fmt.lkr(g.cprp), 'Cost per rating point')}${k('Client share of GRPs', g.my_grp_share_pct == null ? 'Pick a brand' : fmt.pct(g.my_grp_share_pct))}${k('Client CPRP', g.my_cprp == null ? 'n/a' : fmt.lkr(g.my_cprp))}</div>
      <div class="grid g2" style="margin-top:16px">${C.box('c-grp', 'GRPs by advertiser', 'Share of GRPs is share of voice measured in audience', { tall: true })}${C.box('c-cprp', 'CPRP by advertiser', 'Lower is more efficient', { tall: true })}</div>
      <div style="margin-top:16px">${C.box('c-grpw', 'Weekly GRPs', 'Top advertisers', {})}</div>
      <div class="card" style="margin-top:16px"><h3>CPRP by channel and daypart (LKR)</h3>${C.heat(g.cprp_heatmap, { fmt: (v) => fmt.num(v), lowIsGood: true })}</div>
      <div class="grid g2" style="margin-top:16px"><div class="card"><h3>By channel</h3><div id="grp-ch"></div></div><div class="card"><h3>By daypart</h3><div id="grp-dp"></div></div></div>
      <div class="card" style="margin-top:16px"><h3>Programmes delivering the most GRPs</h3><div id="grp-pg"></div></div>`;
    const top = g.by_advertiser.slice(0, 12);
    C.bar({ id: 'c-grp', horizontal: true, labels: top.map((r) => r.name), valueFmt: (v) => fmt.num(v, 1), datasets: [{ data: top.map((r) => r.grps), backgroundColor: top.map((r) => C.colorFor(r.name)) }] });
    C.bar({ id: 'c-cprp', horizontal: true, labels: top.map((r) => r.name), valueFmt: fmt.compact, datasets: [{ data: top.map((r) => r.cprp), backgroundColor: top.map((r) => C.colorFor(r.name)) }] });
    C.line({ id: 'c-grpw', labels: g.weekly.weeks, valueFmt: (v) => fmt.num(v, 1), datasets: g.weekly.advertisers.map((a) => ({ label: a.name, data: a.grps, borderColor: C.colorFor(a.name), backgroundColor: C.colorFor(a.name) })) });
    const cols = (label) => [{ key: 'name', label }, { key: 'grps', label: 'GRPs', num: true, fmt: (v) => fmt.num(v, 1) }, { key: 'grp_share_pct', label: 'GRP share', num: true, fmt: (v) => fmt.pct(v) },
      { key: 'spots', label: 'Spots', num: true }, { key: 'avg_spot_rating', label: 'Avg spot rating', num: true, fmt: (v) => fmt.num(v, 2) }, { key: 'cost', label: 'Cost', num: true, fmt: (v) => fmt.num(v) }, { key: 'cprp', label: 'CPRP', num: true, fmt: (v) => fmt.num(v) }];
    T.create(p.querySelector('#grp-ch'), { csv: 'grp_by_channel', search: false, pageSize: 8, rows: g.by_channel, columns: cols('Channel') });
    T.create(p.querySelector('#grp-dp'), { csv: 'grp_by_daypart', search: false, pageSize: 8, rows: g.by_daypart, columns: cols('Daypart') });
    T.create(p.querySelector('#grp-pg'), { csv: 'grp_by_programme', rows: g.by_program, columns: cols('Channel / programme') });
  }

  const tabs = [
    { id: 'overview', label: 'Overview', render: overview }, { id: 'spend', label: 'Spend breakdown', render: spend }, { id: 'mix', label: 'Channel and programme mix', render: mix },
    { id: 'flighting', label: 'Flighting', render: flighting }, { id: 'creatives', label: 'Creatives', render: creatives }, { id: 'pricing', label: 'Pricing', render: pricing },
    { id: 'position', label: 'Position strategy', render: position }, { id: 'grp', label: 'GRPs and CPRP', render: grps, hidden: (ctx) => !(ctx.data && ctx.data.grp) }, { id: 'alerts', label: 'Alerts', render: alerts }, { id: 'h2h', label: 'Head to head', render: head },
  ];
  if (App.forecast) tabs.push({ id: 'forecast', label: 'Forecast studio', alwaysRender: true, render: (p, ctx) => App.forecast.tab(p, ctx) });
  if (App.insights) tabs.push({ id: 'ai', label: 'AI insights', alwaysRender: true, render: (p, ctx) => App.insights.tab(p, ctx) });
  tabs.push({ id: 'rows', label: 'Raw rows', alwaysRender: true, render: (p, ctx) => App.rawRows(p, ctx) });
  App.workspace({ kind: 'lmrb', fileLabel: 'LMRB ad monitoring file', perspective: true, tabs });
})(window.App);
