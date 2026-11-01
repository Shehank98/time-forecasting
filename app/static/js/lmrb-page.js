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
  const SPONSOR_TH = ['-bb', 'com break', 'dj', '-extro', '-intro', '-llogo', 'next card', 'tag', 'time check', '-tr'];
  const isSponsorTheme = (t) => { const x = String(t || '').trim().toLowerCase(); return !!x && SPONSOR_TH.some((k) => x === k || (k[0] === '-' && x.endsWith(k))); };
  function creatives(p, ctx) {
    const all = ctx.data.creatives.map((r) => ({ ...r, kind: isSponsorTheme(r.theme) ? 'Sponsorship' : 'Commercial' }));
    const counts = {}; all.forEach((r) => { counts[r.status] = (counts[r.status] || 0) + 1; });
    const opts = ['ALL', 'NEW', 'RETURNING', 'PAUSED', 'DROPPED', 'ACTIVE'].filter((s) => s === 'ALL' || counts[s]);
    const stCol = { NEW: C.css('--good') || '#22f5a6', RETURNING: C.PALETTE[1], PAUSED: C.css('--warn') || '#ffb547', DROPPED: C.css('--bad') || '#ff5d7a', ACTIVE: C.PALETTE[0] };
    const rows = () => (cstat === 'ALL' ? all : all.filter((r) => r.status === cstat));
    p.innerHTML = `<div class="kpis">${kpi('New this period', counts.NEW || 0, 'First seen in the latest window')}${kpi('Returning', counts.RETURNING || 0, 'Back after a break')}${kpi('Dropped', counts.DROPPED || 0, 'Ran before, not now')}${kpi('Creatives tracked', all.length, `${all.filter((r) => r.kind === 'Sponsorship').length} are sponsorship items`)}</div>
      <div class="card-head" style="margin-top:16px"><div class="seg" id="cs-seg">${opts.map((s) => `<button type="button" data-s="${s}" aria-pressed="${s === cstat}">${s === 'ALL' ? 'All' : fmt.title(s)} (${s === 'ALL' ? all.length : counts[s]})</button>`).join('')}</div></div>
      <div class="grid g2">${C.box('cr-adv', 'Who is refreshing creative?', 'Creatives per advertiser by status. Click a bar.', { tall: true, help: ['Every creative is an Advt_Theme. Its status compares the latest window with the one before.', 'Advertisers with many NEW creatives are pushing fresh work. Many DROPPED means they are cutting.'] })}
        ${C.box('cr-top', 'Biggest creatives by spend', 'Colour shows status. Click a bar for its story.', { tall: true, help: ['Spend is summed over every spot of that creative in the current filters.', 'The ads carrying the most weight in the market.'] })}</div>
      <div style="margin-top:16px">${C.box('cr-life', 'How long each creative has run', 'Each bar runs from first seen to last seen. Click a bar.', { tall: true, help: ['First and last date each creative aired in the data.', 'Spot wear-out: long runs may be tired, short bursts are tactical.'] })}</div>
      <div class="card" style="margin-top:16px"><details><summary style="cursor:pointer"><b>All creatives (table)</b></summary><div id="cr-table" style="margin-top:10px"></div></details></div>`;
    const draw = () => {
      const r = rows();
      const advs = [...new Set(r.map((x) => x.advertiser))].map((a) => ({ a, n: r.filter((x) => x.advertiser === a).length })).sort((x, y) => y.n - x.n).slice(0, 10);
      const sts = ['NEW', 'RETURNING', 'ACTIVE', 'PAUSED', 'DROPPED'].filter((st) => r.some((x) => x.status === st));
      C.bar({ id: 'cr-adv', horizontal: true, stacked: true, valueFmt: (v) => fmt.num(v, 0), labels: advs.map((x) => x.a), datasets: sts.map((st) => ({ label: fmt.title(st), data: advs.map((x) => r.filter((q) => q.advertiser === x.a && q.status === st).length), backgroundColor: stCol[st] })) });
      const top = r.slice().sort((x, y) => y.spend - x.spend).slice(0, 12), nm = (x) => `${x.theme}  (${x.advertiser})`;
      const cr = C.bar({ id: 'cr-top', horizontal: true, valueFmt: fmt.compact, labels: top.map((x) => (nm(x).length > 38 ? nm(x).slice(0, 37) + '…' : nm(x))), datasets: [{ label: 'Spend', data: top.map((x) => x.spend), backgroundColor: top.map((x) => stCol[x.status] || C.PALETTE[0]) }] });
      C.setDetail('cr-top', (i) => creativeDetail(top[i])); C.detailOnly('cr-top'); C.setDetail('cr-adv', null);
      const life = r.filter((x) => x.first_seen && x.last_seen).sort((x, y) => y.spend - x.spend).slice(0, 12), day = (d) => Date.parse(d) / 86400000, d0 = Math.min(...life.map((x) => day(x.first_seen)));
      if (life.length) { const lc = C.make('cr-life', { type: 'bar', data: { labels: life.map((x) => (nm(x).length > 38 ? nm(x).slice(0, 37) + '…' : nm(x))), datasets: [{ label: 'Run', data: life.map((x) => [day(x.first_seen) - d0, day(x.last_seen) - d0 + 1]), backgroundColor: life.map((x) => (stCol[x.status] || C.PALETTE[0]) + 'cc'), borderRadius: 4, barThickness: 14 }] },
        detailOnly: true, detail: (i) => creativeDetail(life[i]), options: { indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${life[c.dataIndex].first_seen} to ${life[c.dataIndex].last_seen} (${c.raw[1] - c.raw[0]} days)` } } },
          scales: { x: { ticks: { callback: (v) => new Date((v + d0) * 86400000).toISOString().slice(0, 10) }, title: { display: true, text: 'Date' } }, y: { grid: { display: false } } } } }); void lc; }
      return r;
    };
    const creativeDetail = (x) => `<div class="dt-kpis"><div class="dt-k"><span>Status</span><b>${esc(fmt.title(x.status))}</b></div><div class="dt-k"><span>Type</span><b>${x.kind}</b></div><div class="dt-k"><span>Spend</span><b>${fmt.num(x.spend)}</b></div><div class="dt-k"><span>Spots</span><b>${fmt.num(x.spots)}</b></div><div class="dt-k"><span>First seen</span><b>${esc(x.first_seen)}</b></div><div class="dt-k"><span>Last seen</span><b>${esc(x.last_seen)}</b></div></div><div class="small muted">${esc(x.advertiser)} / ${esc(x.product)} / ${esc(x.theme)}<br>Channels: ${(x.channels || []).map(fmt.title).join(', ')}</div>`;
    const t = T.create(p.querySelector('#cr-table'), { csv: 'creatives', defaultSort: { key: 'spend', desc: true }, rows: rows(), columns: [
      { key: 'status', label: 'Status', html: statusBadge }, { key: 'kind', label: 'Type' }, { key: 'advertiser', label: 'Advertiser', html: (v) => swatch(v) + esc(v) }, { key: 'product', label: 'Product' }, { key: 'theme', label: 'Creative (Advt_Theme)' },
      { key: 'first_seen', label: 'First seen' }, { key: 'last_seen', label: 'Last seen' }, { key: 'spots', label: 'Spots', num: true }, { key: 'spend', label: 'Spend', num: true, fmt: (v) => fmt.num(v) },
      { key: 'channels', label: 'Channels', fmt: (v) => (v || []).map(fmt.title).join(', ') }] });
    draw();
    p.querySelectorAll('#cs-seg button').forEach((b) => { b.onclick = () => { cstat = b.dataset.s; p.querySelectorAll('#cs-seg button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); t.refresh(draw()); }; });
  }

  /* ---------------- Pricing ---------------- */
  let ptype = 'commercial';
  function pricing(p, ctx) {
    const pr = ctx.data.pricing, sp = pr.split, cm = sp.commercial, so = sp.sponsorship, hasSp = so.spots > 0;
    if (!hasSp) ptype = 'commercial';
    const cur = () => (ptype === 'sponsorship' ? pr.sponsorship : pr);
    const ratio = cm.cps && so.cps ? so.cps / cm.cps * 100 : null;
    p.innerHTML = `<div class="kpis">${kpi('Commercial spend', fmt.compact(cm.spend), `${fmt.num(cm.share_pct || 0, 0)}% of spend, ${fmt.num(cm.spots)} spots`)}${kpi('Sponsorship spend', hasSp ? fmt.compact(so.spend) : 'none', hasSp ? `${fmt.num(so.share_pct || 0, 0)}% of spend, ${fmt.num(so.spots)} items` : 'No Tag, Time Check, -BB or DJ items')}
      ${kpi('Commercial price per second', cm.cps ? 'LKR ' + fmt.num(cm.cps, 0) : 'n/a', 'Average paid')}${kpi('Sponsorship price per second', so.cps ? 'LKR ' + fmt.num(so.cps, 0) : 'n/a', ratio != null ? `${fmt.num(ratio, 0)}% of the commercial price` : '')}</div>
      <div class="card-head" style="margin-top:16px"><div class="seg" id="pr-seg"><button type="button" data-t="commercial" aria-pressed="${ptype === 'commercial'}">Commercials</button>${hasSp ? `<button type="button" data-t="sponsorship" aria-pressed="${ptype === 'sponsorship'}">Sponsorship</button>` : ''}</div>
        <div class="muted small">Discounts are measured against the median price of the same type on the same channel and daypart.</div></div>
      <div class="grid g2">${C.box('pr-split', 'Spend split: commercials vs sponsorship', 'Per advertiser. Click a bar.', { tall: true, help: ['Each spot is a sponsorship item if its theme is -BB, Com Break, DJ, -Extro, -Intro, -LLogo, Next Card, Tag, Time Check or -Tr. Everything else is a commercial.', 'How much of each advertiser\'s money buys sponsorship rather than spots.'] })}
        ${C.box('pr-disc', 'Who got a discount?', 'Below zero = paid more than the market median. Click a bar.', { tall: true, help: ['For each advertiser: money paid compared with what the same seconds would cost at the median price of that channel and daypart, for the selected type only.', 'Shows which advertiser negotiated the best rates. Sponsorship and commercials are never mixed.'] })}</div>
      <div style="margin-top:16px"><div class="card flipcard" data-chart="pr-heat"><div class="ff"><div class="card-head"><h3>Median price per second by channel and daypart (LKR)</h3><div class="row"><button class="btn sm ghost" type="button" data-flip="pr-heat">Flip</button></div></div><div id="pr-heat"></div></div>
        <div class="fb" data-back="pr-heat" hidden><div class="fb-head"><h3>How these numbers came</h3><button class="btn sm" type="button" data-flip-back>Back to chart</button></div><p class="fb-how">Price per second is cost divided by spot seconds. Each cell is the median of every spot of this type on that channel and daypart. Click a cell to see how it ranks.</p><div class="fb-data" data-fbdata="pr-heat"></div></div></div></div>
      <div class="card" style="margin-top:16px"><details><summary style="cursor:pointer"><b>Deals, outliers and every cell (tables)</b></summary>
        <div class="grid g2" style="margin-top:12px"><div><h3>Possible discount deals</h3><div id="pr-flags"></div></div><div><h3>Price outlier spots</h3><div class="sub muted small">Outside 1.5 x IQR of their channel and daypart</div><div id="pr-out"></div></div></div>
        <h3 style="margin-top:16px">Price by advertiser, channel and daypart</h3><div id="pr-cells"></div></details></div>`;
    const draw = () => {
      const d = cur(), good = C.css('--good') || '#22f5a6', bad = C.css('--bad') || '#ff5d7a';
      const sr = sp.by_advertiser.slice(0, 12);
      const sc = C.bar({ id: 'pr-split', horizontal: true, stacked: true, valueFmt: fmt.compact, labels: sr.map((r) => r.advertiser), datasets: [{ label: 'Commercial', data: sr.map((r) => r.commercial_spend), backgroundColor: C.PALETTE[0] }, { label: 'Sponsorship', data: sr.map((r) => r.sponsorship_spend), backgroundColor: C.PALETTE[2] }] });
      if (sc) { C.detailOnly('pr-split'); } if (sc) C.setDetail('pr-split', (i) => { const r = sr[i]; return `<div class="dt-kpis"><div class="dt-k"><span>Commercial spend</span><b>${fmt.num(r.commercial_spend)}</b></div><div class="dt-k"><span>Sponsorship spend</span><b>${fmt.num(r.sponsorship_spend)}</b></div><div class="dt-k"><span>Sponsorship share</span><b>${r.sponsorship_pct == null ? 'n/a' : fmt.num(r.sponsorship_pct, 0) + '%'}</b></div><div class="dt-k"><span>Commercial spots</span><b>${fmt.num(r.commercial_spots)}</b></div><div class="dt-k"><span>Sponsorship items</span><b>${fmt.num(r.sponsorship_spots)}</b></div></div>`; });
      const by = new Map(); d.cells.forEach((c) => { const g = by.get(c.advertiser) || { advertiser: c.advertiser, paid: 0, expect: 0, spots: 0, cells: [] }; g.paid += c.spend; g.expect += c.median_cps * c.seconds; g.spots += c.spots; g.cells.push(c); by.set(c.advertiser, g); });
      const dr = [...by.values()].filter((g) => g.expect > 0 && g.spots >= 3).map((g) => ({ ...g, disc: (1 - g.paid / g.expect) * 100 })).sort((x, y) => y.disc - x.disc).slice(0, 14);
      if (dr.length) { const dc = C.bar({ id: 'pr-disc', horizontal: true, valueFmt: (v) => fmt.num(v, Math.abs(v) < 10 ? 1 : 0) + '%', legend: false, labels: dr.map((g) => g.advertiser), datasets: [{ label: 'Discount vs median', data: dr.map((g) => g.disc), backgroundColor: dr.map((g) => (g.disc >= 0 ? good : bad)) }] });
        if (dc) C.detailOnly('pr-disc'); if (dc) C.setDetail('pr-disc', (i) => { const g = dr[i]; const top = g.cells.slice().sort((a, b) => b.spend - a.spend).slice(0, 6); return `<div class="dt-kpis"><div class="dt-k"><span>${g.disc >= 0 ? 'Discount' : 'Premium paid'}</span><b>${fmt.num(Math.abs(g.disc), 1)}%</b></div><div class="dt-k"><span>Paid</span><b>${fmt.num(g.paid)}</b></div><div class="dt-k"><span>Would cost at median</span><b>${fmt.num(g.expect)}</b></div><div class="dt-k"><span>Spots</span><b>${fmt.num(g.spots)}</b></div></div>
          <table class="dt-table"><thead><tr><th>Channel</th><th>Daypart</th><th>Spots</th><th>Price index</th></tr></thead><tbody>${top.map((c) => `<tr><td>${esc(fmt.title(c.channel))}</td><td>${esc(c.daypart)}</td><td>${c.spots}</td><td>${fmt.num(c.index_vs_median * 100, 0)}%</td></tr>`).join('')}</tbody></table>`; }); }
      else { const el = document.getElementById('pr-disc'); if (el) el.parentElement.innerHTML = App.emptyState('No discount view yet', 'Needs advertisers with 3 or more spots of this type.'); }
      p.querySelector('#pr-heat').innerHTML = C.heat(d.heatmap, { fmt: (v) => fmt.num(v) });
    };
    const tables = () => {
      const d = cur();
      T.create(p.querySelector('#pr-flags'), { csv: 'discount_flags_' + ptype, pageSize: 8, empty: 'No advertiser is paying notably below the median.', rows: d.discount_flags, columns: [
        { key: 'advertiser', label: 'Advertiser', html: (v) => swatch(v) + esc(v) }, { key: 'channel', label: 'Channel', fmt: fmt.title }, { key: 'daypart', label: 'Daypart' }, { key: 'spots', label: 'Spots', num: true },
        { key: 'cps', label: 'Price/sec', num: true, fmt: (v) => fmt.num(v) }, { key: 'index_vs_median', label: 'Index vs median', num: true, fmt: (v) => fmt.num(v * 100) + '%' }] });
      T.create(p.querySelector('#pr-out'), { csv: 'price_outliers_' + ptype, pageSize: 8, empty: 'No price outliers found (needs 8+ spots per channel and daypart).', rows: d.outliers, columns: [
        { key: 'date', label: 'Date' }, { key: 'advertiser', label: 'Advertiser' }, { key: 'channel', label: 'Channel', fmt: fmt.title }, { key: 'daypart', label: 'Daypart' },
        { key: 'cps', label: 'Price/sec', num: true, fmt: (v) => fmt.num(v) }, { key: 'median_cps', label: 'Median', num: true, fmt: (v) => fmt.num(v) }] });
      T.create(p.querySelector('#pr-cells'), { csv: 'pricing_cells_' + ptype, defaultSort: { key: 'spend', desc: true }, rows: d.cells, columns: [
        { key: 'advertiser', label: 'Advertiser', html: (v) => swatch(v) + esc(v) }, { key: 'channel', label: 'Channel', fmt: fmt.title }, { key: 'daypart', label: 'Daypart' }, { key: 'spots', label: 'Spots', num: true },
        { key: 'spend', label: 'Spend', num: true, fmt: (v) => fmt.num(v) }, { key: 'cps', label: 'Price/sec', num: true, fmt: (v) => fmt.num(v) }, { key: 'median_cps', label: 'Median', num: true, fmt: (v) => fmt.num(v) },
        { key: 'index_vs_median', label: 'Index', num: true, fmt: (v) => fmt.num(v * 100) + '%' }, { key: 'flag', label: 'Flag', html: (v) => (v ? `<span class="badge ${v.startsWith('Below') ? 'good' : 'warn'}">${esc(v)}</span>` : '') }] });
    };
    draw(); tables();
    p.querySelectorAll('#pr-seg button').forEach((b) => { b.onclick = () => { ptype = b.dataset.t; p.querySelectorAll('#pr-seg button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); draw(); tables(); }; });
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
      try { const r = await App.data.head2head({ filters: ctx.filters(), options: { ...ctx.options(), a: h2h.a, b: h2h.b } }); drawHead(out, r); } catch (e) { out.innerHTML = App.emptyState('Could not compare', e.message); }
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
  App.workspace({ kind: 'lmrb', fileLabel: 'LMRB ad monitoring file', reportTitle: 'Market prediction', perspective: true, tabs,
    predict: [App.predictTabs.market], defaultTab: 'p-market' });
})(window.App);
