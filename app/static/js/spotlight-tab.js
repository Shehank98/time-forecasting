/* Programme & Sponsorship Spotlight tab (LMRB): Programme Spotlight hub and the Short-form & Sponsorship matrix. */
(function (App) {
  const { esc, fmt, charts: C, tables: T } = App;
  const KEY = 'spot:lmrb';
  const kpi = (l, v, s) => `<div class="kpi"><div class="k-lbl">${esc(l)}</div><div class="k-val">${v}</div>${s ? `<div class="k-sub">${s}</div>` : ''}</div>`;
  const pct = (v) => (v == null ? 'n/a' : fmt.num(v, v < 10 ? 1 : 0) + '%');
  const dec = (v) => (v == null ? 'n/a' : fmt.num(v, 1));
  const tt = (s) => fmt.title(String(s || ''));
  const ROLE_CLS = { 'Title Sponsor': 'role-title', 'Co-Sponsor': 'role-co', 'Logo Placement': 'role-logo', 'Regular Spot': 'role-reg' };
  const role = (r) => `<span class="badge ${ROLE_CLS[r] || ''}">${esc(r)}</span>`;
  const HB = { good: 'good', fair: 'warn', poor: 'bad' };
  const healthBadge = (h) => `<span class="badge ${HB[h.band]}" title="Clutter ${h.parts.clutter}/40, position ${h.parts.position}/35, price ${h.parts.price}/25">${h.score} · ${esc(h.label)}</span>`;
  const DURS = ['5s', '10s', '15s', '20s', '30s', '30s+'];
  const durBar = (s) => { const t = DURS.reduce((a, k) => a + (s[k] || 0), 0) || 1;
    return `<div class="sf-dur" title="${DURS.filter((k) => s[k]).map((k) => `${k}: ${s[k]}`).join(', ')}">${DURS.map((k, i) => (s[k] ? `<i style="width:${(s[k] / t) * 100}%;background:${C.PALETTE[i]}"></i>` : '')).join('')}</div>
      <div class="sf-dur-l small">${DURS.filter((k) => s[k]).slice(0, 4).map((k) => `${k} ${fmt.num(s[k])}`).join(' · ') || 'no length'}</div>`; };
  const alpha = (c, a) => (/^#[0-9a-f]{6}$/i.test(c) ? c + Math.round(a * 255).toString(16).padStart(2, '0') : /^hsl\(/.test(c) ? c.replace(')', ` / ${a})`) : c);
  const load = () => { try { return App.store.get(KEY, null) || {}; } catch (e) { return {}; } };
  const st = Object.assign({ view: 'programme', program: null, channel: null, brand: '', gran: 'auto', dur: 'all', mchannel: '', tag: '', search: '', sort: 'spend', desc: true }, load());
  const save = () => { try { App.store.set(KEY, st); } catch (e) { /* storage blocked */ } };
  const clutterThr = () => { try { return (App.store.get('neg:lmrb', {}) || {}).clutter_threshold || 35; } catch (e) { return 35; } };

  function tab(p, ctx) {
    p.innerHTML = `<div class="card-head" style="margin-bottom:12px"><div class="seg" id="sp-view"><button type="button" data-v="programme" aria-pressed="${st.view === 'programme'}">Programme Spotlight</button><button type="button" data-v="matrix" aria-pressed="${st.view === 'matrix'}">Short-form &amp; Sponsorship Matrix</button></div>
      <div class="muted small">Sponsorship items: -BB, Intro, Extro, Com Break, Next Card (billboards) and LLogo, Tag, Time Check, DJ, -Tr (logo items).</div></div><div id="sp-body"></div>`;
    p.querySelectorAll('#sp-view button').forEach((b) => { b.onclick = () => { st.view = b.dataset.v; save(); p.querySelectorAll('#sp-view button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); show(p, ctx); }; });
    show(p, ctx);
  }
  const show = (p, ctx) => (st.view === 'matrix' ? matrix(p.querySelector('#sp-body'), ctx) : programme(p.querySelector('#sp-body'), ctx));

  /* ================= Programme Spotlight ================= */
  async function programme(el, ctx) {
    el.innerHTML = App.skeleton(3);
    let ix;
    try { ix = await App.data.spotlightIndex({ filters: ctx.filters() }); } catch (e) { el.innerHTML = App.emptyState('Programmes could not be listed', e.message); return; }
    if (!el.isConnected) return;
    if (!ix.programmes.length) { el.innerHTML = App.emptyState('No programmes in this selection', 'Widen the page filters.'); return; }
    const label = (pg, ch) => `${tt(pg)} · ${ch ? tt(ch) : 'All channels'}`;
    const opts = new Map();
    ix.programmes.forEach((x) => opts.set(label(x.program, x.channel), { program: x.program, channel: x.channel, spend: x.spend, sp: x.sponsor_spend }));
    ix.names.forEach((x) => opts.set(label(x.program, null), { program: x.program, channel: null, spend: x.spend, sp: x.sponsor_spend }));
    if (!st.program || ![...opts.values()].some((o) => o.program === st.program && (o.channel || null) === (st.channel || null))) {
      const best = ix.programmes.slice().sort((a, b) => b.sponsor_spend - a.sponsor_spend || b.spend - a.spend)[0];
      st.program = best.program; st.channel = best.channel; st.brand = '';
    }
    el.innerHTML = `<div class="card"><div class="sp-pick">
        <div class="field"><label for="sp-prog">Programme (type to search, ${fmt.num(ix.total)} on air)</label><input id="sp-prog" type="search" list="sp-prog-list" autocomplete="off" value="${esc(label(st.program, st.channel))}">
          <datalist id="sp-prog-list">${[...opts.keys()].map((k) => `<option value="${esc(k)}"></option>`).join('')}</datalist></div>
        <div class="field"><label for="sp-brand">Brand in focus</label><select id="sp-brand"></select></div>
        <div class="field"><label>Timeline</label><div class="seg" id="sp-gran">${[['auto', 'Auto'], ['day', 'By airing'], ['week', 'Weekly'], ['month', 'Monthly']].map(([v, l]) => `<button type="button" data-g="${v}" aria-pressed="${st.gran === v}">${l}</button>`).join('')}</div></div></div>
        <div class="muted small" style="margin-top:6px">Top sponsored: ${ix.programmes.filter((x) => x.sponsor_spend > 0).sort((a, b) => b.sponsor_spend - a.sponsor_spend).slice(0, 5).map((x) => `<button type="button" class="linkish" data-pick="${esc(label(x.program, x.channel))}">${esc(label(x.program, x.channel))}</button>`).join(', ') || 'no sponsorship items in this selection'}</div></div>
      <div id="sp-out" style="margin-top:16px"></div>`;
    const inp = el.querySelector('#sp-prog');
    const pick = (v) => { const o = opts.get(v); if (!o) return; st.program = o.program; st.channel = o.channel; st.brand = ''; save(); runProg(el, ctx); };
    inp.onchange = () => pick(inp.value);
    inp.onfocus = () => inp.select();
    el.querySelectorAll('[data-pick]').forEach((b) => { b.onclick = () => { inp.value = b.dataset.pick; pick(b.dataset.pick); }; });
    el.querySelectorAll('#sp-gran button').forEach((b) => { b.onclick = () => { st.gran = b.dataset.g; save(); el.querySelectorAll('#sp-gran button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); runProg(el, ctx); }; });
    el.querySelector('#sp-brand').onchange = (e) => { st.brand = e.target.value; save(); runProg(el, ctx); };
    runProg(el, ctx);
  }

  async function runProg(el, ctx) {
    const out = el.querySelector('#sp-out'); if (!out) return;
    out.innerHTML = App.skeleton(3);
    const my = (ctx.persp && ctx.persp().my_brand) || '';
    let d;
    try { d = await App.data.programmeSpotlight({ filters: ctx.filters(), options: { program: st.program, channel: st.channel, brand: st.brand || my || null, gran: st.gran, clutter_threshold: clutterThr() } }); } catch (e) { out.innerHTML = App.emptyState('The spotlight could not be built', e.message); return; }
    if (!out.isConnected) return;
    if (d.empty) { out.innerHTML = App.emptyState('No spots for this programme', 'Pick another programme or widen the filters.'); return; }
    const sel = el.querySelector('#sp-brand');
    sel.innerHTML = d.brands.map((b) => `<option value="${esc(b.name)}" ${b.name === d.focus.name ? 'selected' : ''}>${esc(b.name)} (${esc(b.role)})</option>`).join('');
    drawProg(out, d);
  }

  function drawProg(out, d) {
    const t = d.totals, f = d.focus, prog = tt(d.program), where = d.channel ? tt(d.channel) : d.channels.map(tt).join(', ');
    const pos = f.position, posT = pos.first + pos.early + pos.middle + pos.last;
    out.innerHTML = `<div class="card sp-hero"><div class="card-head"><div><div class="sp-eyebrow">Programme Spotlight</div><h3>${esc(prog)} <span class="muted">· ${esc(where)}</span></h3>
        <div class="sub">${d.period[0]} to ${d.period[1]} · ${fmt.num(t.episodes)} airing days · ${fmt.num(t.brands)} advertisers · ${fmt.num(t.sponsors)} with sponsorship items</div></div>
        <div class="sp-focus">${role(f.role)}<div><b>${esc(f.name)}</b><div class="muted small">${esc((f.products || []).join(', '))}</div></div></div></div>
      <div class="kpis">
        ${kpi('Total sponsored investment', `<span title="${fmt.lkr(t.sponsor_spend)}">${fmt.lkrc(t.sponsor_spend)}</span>`, `${fmt.num(t.sponsor_items)} sponsorship items, all brands`)}
        ${kpi('Total spot count', fmt.num(t.spots), `${fmt.lkrc(t.spend)} total spend in this block`)}
        ${kpi(`${f.name} share of voice`, pct(f.sov_spend), `${pct(f.sov_spots)} of spots in this programme`)}
        ${kpi(`${f.name} investment`, `<span title="${fmt.lkr(f.spend)}">${fmt.lkrc(f.spend)}</span>`, `${fmt.num(f.spots)} spots, ${fmt.num(f.sponsor_items)} sponsorship items`)}
        ${kpi('First in break', pct(f.fib_pct), `First or last: ${pct(f.bumper_pct)}`)}
        ${kpi('Avg break clutter', dec(f.avg_clutter), `Programme average ${dec(t.avg_clutter)}`)}
      </div></div>
      <div class="card" style="margin-top:16px"><div class="card-head"><div><h3>Sponsorship Impact Brief</h3><div class="sub">Talking points for the buyer, worked out from the numbers on this page.</div></div><button class="btn sm ghost" type="button" id="sp-copy">Copy</button></div>
        <ul class="sp-brief">${d.brief.map((x) => `<li class="k-${x.kind}">${esc(x.text)}</li>`).join('')}</ul></div>
      <div class="grid g2" style="margin-top:16px">
        ${C.box('sp-split', 'Sponsorship vs regular spend', 'Per advertiser inside this programme. Click a bar.', { tall: true, help: ['Sponsorship = billboard and logo items. Special placement = a 60 second or longer spot at 3x or more the programme\'s median spot cost. Regular = every other spot.', 'See who owns the programme through sponsorship and who simply buys spots in it.'] })}
        ${C.box('sp-tl', 'Ad count by episode', `${d.timeline.gran === 'day' ? 'One bar per airing day' : d.timeline.gran === 'week' ? 'Weekly' : 'Monthly'}. Red bars are peak episodes.`, { tall: true, help: ['Bars count spots by all advertisers in the programme, with the focus brand on top. The line is the average ads per break. A peak is 1.5x the usual spots per airing (and at least 3 more).', 'Spot the finales, eviction nights and special episodes where ad density jumps, and book them early.'] })}</div>
      <div class="grid g2" style="margin-top:16px">
        <div class="card"><h3>Where ${esc(f.name)}'s spots sat in the break</h3><div class="sub muted small">${fmt.num(posT)} spots with break position data</div>
          <div class="sp-pos">${[['First in break', pos.first, 'good'], ['2nd or 3rd', pos.early, 'info'], ['Middle', pos.middle, 'bad'], ['Last in break', pos.last, 'warn']].map(([l, v, c]) => `<div class="sp-pos-r"><span>${l}</span><div class="sp-pos-b"><i class="${c}" style="width:${posT ? (v / posT) * 100 : 0}%"></i></div><b>${posT ? fmt.num((v / posT) * 100, 0) : 0}%</b><span class="muted small">${fmt.num(v)}</span></div>`).join('')}</div></div>
        <div class="card"><h3>${esc(f.name)} by ${d.timeline.gran === 'month' ? 'month' : d.timeline.gran === 'week' ? 'week' : 'airing day'}</h3><div id="sp-per"></div></div></div>
      <div class="card" style="margin-top:16px"><h3>Everyone in this programme</h3><div id="sp-brands"></div></div>`;
    out.querySelector('#sp-copy').onclick = () => { const txt = d.brief.map((x) => '- ' + x.text).join('\n'); (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => App.toast('Brief copied.', 'ok')).catch(() => App.toast('Copy is blocked in this browser.', 'error')); };
    // split chart
    const top = d.brands.slice().sort((a, b) => b.spend - a.spend).slice(0, 10);
    const sc = C.bar({ id: 'sp-split', horizontal: true, stacked: true, valueFmt: fmt.compact, labels: top.map((b) => b.name), datasets: [
      { label: 'Sponsorship', data: top.map((b) => b.sponsor_spend), backgroundColor: C.PALETTE[2] }, { label: 'Special placement', data: top.map((b) => b.special_spend), backgroundColor: C.PALETTE[3] },
      { label: 'Regular spots', data: top.map((b) => b.regular_spend), backgroundColor: C.PALETTE[0] }] });
    if (sc) { C.detailOnly('sp-split'); C.setDetail('sp-split', (i) => { const b = top[i]; return `<div class="dt-kpis"><div class="dt-k"><span>Role</span><b>${esc(b.role)}</b></div><div class="dt-k"><span>Sponsorship</span><b>${fmt.num(b.sponsor_spend)} (${b.sponsor_items} items)</b></div><div class="dt-k"><span>Special placements</span><b>${fmt.num(b.special_spend)} (${b.special_spots})</b></div><div class="dt-k"><span>Regular spots</span><b>${fmt.num(b.regular_spend)} (${b.regular_spots})</b></div><div class="dt-k"><span>Share of voice</span><b>${pct(b.sov_spend)}</b></div><div class="dt-k"><span>First in break</span><b>${pct(b.fib_pct)}</b></div></div>`; }); }
    // timeline
    const tl = d.timeline, peaks = new Set(tl.peaks), bad = C.css('--bad') || '#ff5d7a', base = C.css('--muted') || '#7c86b0';
    const fc = C.colorFor(f.name);
    C.make('sp-tl', { type: 'bar', detailOnly: true,
      data: { labels: tl.labels, datasets: [
        { label: f.name, data: tl.focus_spots, backgroundColor: fc, stack: 's', order: 2 },
        { label: 'Other advertisers', data: tl.spots.map((v, j) => v - tl.focus_spots[j]), backgroundColor: tl.labels.map((x, j) => (peaks.has(j) ? bad : alpha(base, 0.45))), stack: 's', order: 2 },
        { type: 'line', label: 'Avg ads per break', data: tl.avg_clutter, yAxisID: 'y2', borderColor: alpha(C.css('--accent') || '#3de0ff', 0.75), borderWidth: 1.5, backgroundColor: 'transparent', pointRadius: tl.labels.length > 60 ? 0 : 2, tension: 0.2, order: 1 }] },
      options: { interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { afterBody: (it) => { const j = it[0].dataIndex; return [`Airing days: ${tl.airings[j]}`, `Spots per airing: ${fmt.num(tl.spots_per_airing[j], 1)}`].concat(peaks.has(j) ? ['PEAK EPISODE'] : []); } } } },
        scales: { x: { stacked: true, ticks: { maxTicksLimit: 10, maxRotation: 0 } }, y: { stacked: true, beginAtZero: true, title: { display: true, text: 'Spots' } }, y2: { position: 'right', beginAtZero: true, grid: { display: false }, title: { display: true, text: 'Ads per break' } } } },
      detail: (j) => `<div class="dt-kpis"><div class="dt-k"><span>All spots</span><b>${fmt.num(tl.spots[j])}</b></div><div class="dt-k"><span>${esc(f.name)}</span><b>${fmt.num(tl.focus_spots[j])} (${fmt.num(tl.focus_sponsor[j])} sponsorship)</b></div><div class="dt-k"><span>Spots per airing</span><b>${fmt.num(tl.spots_per_airing[j], 1)}</b></div><div class="dt-k"><span>Usual per airing</span><b>${fmt.num(tl.median_per_airing, 1)}</b></div><div class="dt-k"><span>Avg ads per break</span><b>${dec(tl.avg_clutter[j])}</b></div></div>${peaks.has(j) ? '<p class="small"><b>Peak episode.</b> Ad density is well above the usual level: likely a finale, eviction night or special.</p>' : ''}` });
    T.create(out.querySelector('#sp-per'), { csv: 'programme_focus_periods', search: false, pageSize: 8, rows: f.periods, columns: [
      { key: 'period', label: 'Period' }, { key: 'spots', label: 'Spots', num: true }, { key: 'sponsor_items', label: 'Sponsorship items', num: true }, { key: 'spend', label: 'Spend', num: true, fmt: (v) => fmt.num(v) },
      { key: 'fib_pct', label: 'First in break', num: true, fmt: pct }, { key: 'avg_clutter', label: 'Avg ads in break', num: true, fmt: dec }] });
    T.create(out.querySelector('#sp-brands'), { csv: 'programme_advertisers', pageSize: 10, rows: d.brands, columns: [
      { key: 'name', label: 'Advertiser' }, { key: 'role', label: 'Role', html: role }, { key: 'spend', label: 'Spend', num: true, fmt: (v) => fmt.num(v) },
      { key: 'sponsor_spend', label: 'Sponsorship spend', num: true, fmt: (v) => fmt.num(v) }, { key: 'sponsor_items', label: 'Items', num: true }, { key: 'regular_spots', label: 'Regular spots', num: true },
      { key: 'sov_spend', label: 'SoV (spend)', num: true, fmt: pct }, { key: 'fib_pct', label: 'First in break', num: true, fmt: pct }, { key: 'avg_clutter', label: 'Avg ads in break', num: true, fmt: dec }] });
  }

  /* ================= Short-form & Sponsorship matrix ================= */
  const COLS = [['program', 'Channel & programme'], ['advertiser', 'Advertiser / brand'], ['role', 'Sponsorship type'], ['short_pct', 'Duration split'], ['per_day', 'Frequency'],
    ['avg_clutter', 'Avg clutter'], ['fib_pct', 'Position strategy'], ['health', 'Negotiation health'], ['spend', 'Spend (LKR)']];
  let mres = null;

  async function matrix(el, ctx) {
    el.innerHTML = `<div class="card"><div class="sf-bar">
        <div class="field"><label>Spot length</label><div class="seg" id="sf-dur">${[['all', 'All'], ['5', '5s'], ['10', '10s'], ['le10', '10s and under'], ['15', '15s'], ['30', '30s'], ['30p', '30s+']].map(([v, l]) => `<button type="button" data-d="${v}" aria-pressed="${st.dur === v}">${l}</button>`).join('')}</div></div>
        <div class="field"><label for="sf-ch">Channel</label><select id="sf-ch"><option value="">All channels</option></select></div>
        <div class="field"><label for="sf-tag">Sponsorship tag</label><select id="sf-tag"><option value="">All types</option></select></div>
        <div class="field"><label for="sf-q">Search</label><input id="sf-q" type="search" placeholder="Programme, brand or product" value="${esc(st.search)}"></div>
        <div class="row sf-exp"><button class="btn sm" type="button" id="sf-csv">Export CSV</button><button class="btn sm" type="button" id="sf-xlsx">Export Excel</button></div></div></div>
      <div id="sf-out" style="margin-top:16px">${App.skeleton(3)}</div>`;
    el.querySelectorAll('#sf-dur button').forEach((b) => { b.onclick = () => { st.dur = b.dataset.d; save(); el.querySelectorAll('#sf-dur button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); runMatrix(el, ctx); }; });
    el.querySelector('#sf-ch').onchange = (e) => { st.mchannel = e.target.value; save(); runMatrix(el, ctx); };
    el.querySelector('#sf-tag').onchange = (e) => { st.tag = e.target.value; save(); runMatrix(el, ctx); };
    el.querySelector('#sf-q').oninput = App.debounce((e) => { st.search = e.target.value; save(); runMatrix(el, ctx); }, 300);
    el.querySelector('#sf-csv').onclick = () => exportRows('csv');
    el.querySelector('#sf-xlsx').onclick = () => exportRows('xlsx');
    runMatrix(el, ctx);
  }

  async function runMatrix(el, ctx) {
    const out = el.querySelector('#sf-out'); if (!out) return;
    let d;
    try { d = await App.data.shortFormMatrix({ filters: ctx.filters(), options: { dur: st.dur, channel: st.mchannel || null, tag: st.tag || null, search: st.search, clutter_threshold: clutterThr(), limit: 2000 } }); } catch (e) { out.innerHTML = App.emptyState('The matrix could not be built', e.message); return; }
    if (!out.isConnected) return;
    mres = d;
    const ch = el.querySelector('#sf-ch'); if (ch.options.length <= 1) ch.innerHTML = `<option value="">All channels</option>${d.channels.map((c) => `<option value="${esc(c)}">${esc(tt(c))}</option>`).join('')}`; ch.value = st.mchannel || '';
    el.querySelector('#sf-tag').innerHTML = `<option value="">All types</option>${Object.entries(d.roles).map(([r, n]) => `<option value="${esc(r)}" ${r === st.tag ? 'selected' : ''}>${esc(r)} (${fmt.num(n)})</option>`).join('')}`;
    const t = d.totals;
    out.innerHTML = `<div class="kpis">${kpi('Programme x brand pairs', fmt.num(t.pairs), d.n_rows > d.rows.length ? `Top ${fmt.num(d.rows.length)} by spend shown` : '')}${kpi('Spots', fmt.num(t.spots), `${fmt.lkrc(t.spend)} spend`)}
        ${kpi('Short-form share', pct(t.short_pct), '5s and 10s spots')}${kpi('Sponsorship items', fmt.num(t.sponsor_items))}
        ${kpi('Negotiation health', `<span class="badge good">${fmt.num(t.health.good)}</span> <span class="badge warn">${fmt.num(t.health.fair)}</span> <span class="badge bad">${fmt.num(t.health.poor)}</span>`, 'High value · Fair · High clutter')}</div>
      <div class="card" style="margin-top:16px"><div class="card-head"><div><h3>Short-form &amp; Sponsorship Spotlight ${App.help('Each row is one brand in one programme. Sponsorship type comes from all spot lengths; the other numbers use only the spot lengths you picked. Negotiation health (0 to 100) = low clutter (40 points, full marks at 5 ads per break, none at the clutter threshold ' + d.clutter_threshold + ') + first or last in break (35 points, full marks at 50%) + price per second against the programme\'s going rate (25 points, full marks at half the rate, none at 1.5x).', 'Click a row for daily spots and cost efficiency. Export the table for a pitch deck.')}</h3>
        <div class="sub">Click a column to sort, click a row to open it.</div></div></div>
        <div class="tbl-scroll sf-scroll"><table class="tbl sf-tbl"><thead><tr>${COLS.map(([k, l]) => `<th data-k="${k}" ${['per_day', 'avg_clutter', 'fib_pct', 'health', 'spend', 'short_pct'].includes(k) ? 'class="num"' : ''} aria-sort="${st.sort === k ? (st.desc ? 'descending' : 'ascending') : 'none'}" style="cursor:pointer">${l}</th>`).join('')}</tr></thead><tbody></tbody></table></div>
        <div class="row" style="margin-top:8px"><span class="muted small" id="sf-count"></span><button class="btn sm ghost" type="button" id="sf-more">Show 50 more</button></div></div>`;
    let shown = 50;
    const tb = out.querySelector('tbody');
    const sorted = () => { const k = st.sort, v = (r) => (k === 'health' ? r.health.score : k === 'program' ? `${r.channel} ${r.program}` : r[k]);
      return d.rows.slice().sort((a, b) => { const x = v(a), y = v(b); if (x == null) return 1; if (y == null) return -1; const c = typeof x === 'string' ? x.localeCompare(y) : x - y; return st.desc ? -c : c; }); };
    const paint = () => {
      const rows = sorted();
      tb.innerHTML = rows.slice(0, shown).map((r, i) => `<tr class="sf-row" data-i="${d.rows.indexOf(r)}" tabindex="0" aria-expanded="false">
        <td><b>${esc(tt(r.channel))}</b><div class="small">${esc(tt(r.program))}</div></td>
        <td><span class="swatch" style="background:${C.colorFor(r.advertiser)}"></span>${esc(r.advertiser)}<div class="muted small">${esc(r.product || '')}</div></td>
        <td>${role(r.role)}${r.sponsor_items ? `<div class="muted small">${fmt.num(r.sponsor_items)} items</div>` : ''}</td>
        <td class="sf-durc">${durBar(r.dur_split)}</td>
        <td class="num"><b>${fmt.num(r.per_day, r.per_day < 10 ? 1 : 0)}</b>/day<div class="muted small">${fmt.num(r.per_month, 0)}/month · ${fmt.num(r.spots)} spots</div></td>
        <td class="num ${r.avg_clutter > d.clutter_threshold ? 'neg-hot' : ''}">${dec(r.avg_clutter)}</td>
        <td class="num">${pct(r.fib_pct)} first<div class="muted small">${pct(r.bumper_pct)} first or last</div></td>
        <td class="num">${healthBadge(r.health)}</td><td class="num">${fmt.num(r.spend)}</td></tr>`).join('') || `<tr><td colspan="${COLS.length}">${App.emptyState('No rows', 'Change the spot length, channel, tag or search.')}</td></tr>`;
      out.querySelector('#sf-count').textContent = `Showing ${fmt.num(Math.min(shown, rows.length))} of ${fmt.num(rows.length)} rows`;
      out.querySelector('#sf-more').hidden = shown >= rows.length;
    };
    out.querySelectorAll('th[data-k]').forEach((th) => { th.onclick = () => { if (st.sort === th.dataset.k) st.desc = !st.desc; else { st.sort = th.dataset.k; st.desc = !['program', 'advertiser', 'role'].includes(th.dataset.k); } save();
      out.querySelectorAll('th[data-k]').forEach((x) => x.setAttribute('aria-sort', x === th ? (st.desc ? 'descending' : 'ascending') : 'none')); paint(); }; });
    out.querySelector('#sf-more').onclick = () => { shown += 50; paint(); };
    const toggle = (tr) => {
      const nx = tr.nextElementSibling;
      if (nx && nx.classList.contains('sf-exp-row')) { nx.remove(); tr.setAttribute('aria-expanded', 'false'); return; }
      tr.setAttribute('aria-expanded', 'true');
      const r = d.rows[+tr.dataset.i], ex = document.createElement('tr'); ex.className = 'sf-exp-row';
      ex.innerHTML = `<td colspan="${COLS.length}"><div class="sf-detail">${App.skeleton(1)}</div></td>`; tr.after(ex);
      App.data.shortFormRow({ filters: ctx.filters(), options: { channel: r.channel, program: r.program, advertiser: r.advertiser, dur: st.dur } })
        .then((x) => rowDetail(ex.querySelector('.sf-detail'), r, x)).catch((e) => { ex.querySelector('.sf-detail').innerHTML = App.emptyState('Could not open this row', e.message); });
    };
    tb.onclick = (e) => { const tr = e.target.closest('tr.sf-row'); if (tr) toggle(tr); };
    tb.onkeydown = (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr.sf-row')) { e.preventDefault(); toggle(e.target); } };
    paint();
  }

  let rowN = 0;
  function rowDetail(el, r, x) {
    if (x.empty) { el.innerHTML = App.emptyState('No spots for this row'); return; }
    const id = 'sf-day-' + (++rowN), ix = x.price_index;
    el.innerHTML = `<div class="sf-d-grid"><div><div class="sf-d-h">Daily spots in ${esc(tt(r.program))} (${fmt.num(x.programme.airings)} airing days)</div><div class="chart-wrap" style="height:170px"><canvas id="${id}" aria-label="Daily spots"></canvas></div></div>
      <div><div class="sf-d-h">Cost efficiency</div><div class="dt-kpis">
        <div class="dt-k"><span>Spend</span><b>${fmt.num(x.spend)}</b></div><div class="dt-k"><span>Cost per spot</span><b>${fmt.num(x.cost_per_spot)}</b></div>
        <div class="dt-k"><span>Price per second (spots)</span><b>${x.commercial_cps ? fmt.num(x.commercial_cps) : 'n/a'}</b></div><div class="dt-k"><span>Programme rate per second</span><b>${x.programme.cps ? fmt.num(x.programme.cps) : 'n/a'}</b></div>
        <div class="dt-k"><span>Price vs programme</span><b class="${ix != null && ix > 1.1 ? 'neg-hot' : ''}">${ix == null ? 'n/a' : fmt.num(ix * 100, 0) + '%'}</b></div><div class="dt-k"><span>Share of programme spots</span><b>${pct(x.spots / x.programme.spots * 100)}</b></div>
        <div class="dt-k"><span>Health parts</span><b>${r.health.parts.clutter}/40 · ${r.health.parts.position}/35 · ${r.health.parts.price}/25</b></div><div class="dt-k"><span>Avg length</span><b>${x.avg_dur ? fmt.num(x.avg_dur, 0) + 's' : 'n/a'}</b></div></div>
        <div class="sf-d-h" style="margin-top:10px">Themes</div><div class="small">${x.themes.map((t) => `<span class="chip">${esc(t.theme)} · ${esc(t.type)} · ${fmt.num(t.spots)}</span>`).join(' ')}</div></div></div>`;
    const days = x.daily;
    C.make(id, { type: 'bar', noDetail: true, data: { labels: days.map((v) => v.date), datasets: [
      { label: 'Sponsorship items', data: days.map((v) => v.sponsor), backgroundColor: C.PALETTE[2], stack: 's' },
      { label: 'Spots', data: days.map((v) => v.spots - v.sponsor), backgroundColor: C.colorFor(r.advertiser), stack: 's' }] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { afterBody: (it) => [`All brands: ${days[it[0].dataIndex].programme_spots} spots`, `Spend: ${fmt.num(days[it[0].dataIndex].spend)}`] } } },
        scales: { x: { stacked: true, ticks: { maxTicksLimit: 8 } }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } } } });
  }

  const exportCols = [['Channel', (r) => tt(r.channel)], ['Programme', (r) => tt(r.program)], ['Advertiser', (r) => r.advertiser], ['Brand / product', (r) => r.product || ''],
    ['Sponsorship type', (r) => r.role], ['Sponsorship items', (r) => r.sponsor_items], ...DURS.map((k) => [`${k} spots`, (r) => r.dur_split[k] || 0]), ['Spots', (r) => r.spots],
    ['Spots per day', (r) => +(r.per_day || 0).toFixed(2)], ['Spots per month', (r) => +(r.per_month || 0).toFixed(1)], ['Active days', (r) => r.active_days],
    ['Avg ads in break', (r) => (r.avg_clutter == null ? '' : +r.avg_clutter.toFixed(2))], ['First in break %', (r) => (r.fib_pct == null ? '' : +r.fib_pct.toFixed(1))],
    ['First or last %', (r) => (r.bumper_pct == null ? '' : +r.bumper_pct.toFixed(1))], ['Health score', (r) => r.health.score], ['Health', (r) => r.health.label],
    ['Spend LKR', (r) => Math.round(r.spend)], ['Price per second', (r) => (r.commercial_cps == null ? '' : Math.round(r.commercial_cps))], ['First seen', (r) => r.first_seen], ['Last seen', (r) => r.last_seen]];
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise((ok, no) => { const s = document.createElement('script'); s.src = '/js/vendor/xlsx.full.min.js'; s.onload = () => ok(window.XLSX); s.onerror = () => no(new Error('The Excel library could not load.')); document.head.appendChild(s); });
  }
  async function exportRows(kind) {
    if (!mres || !mres.rows.length) { App.toast('Nothing to export.', 'error'); return; }
    const head = exportCols.map((c) => c[0]), body = mres.rows.map((r) => exportCols.map((c) => c[1](r)));
    const name = `short_form_sponsorship_${st.dur}_${new Date().toISOString().slice(0, 10)}`;
    if (kind === 'csv') {
      const q = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      App.download(new Blob(['﻿' + [head, ...body].map((r) => r.map(q).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }), name + '.csv'); return;
    }
    try {
      const X = await loadXlsx(), ws = X.utils.aoa_to_sheet([head, ...body]), wb = X.utils.book_new();
      ws['!cols'] = head.map((h, i) => ({ wch: Math.min(40, Math.max(h.length, ...body.slice(0, 200).map((r) => String(r[i]).length)) + 2) }));
      ws['!autofilter'] = { ref: X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: body.length, c: head.length - 1 } }) };
      X.utils.book_append_sheet(wb, ws, 'Spotlight');
      const f = mres.filters, info = [['Short-form & Sponsorship Spotlight'], ['Spot length', f.dur], ['Channel', f.channel || 'All'], ['Sponsorship tag', f.tag || 'All'], ['Search', f.search || ''], ['Rows', body.length], ['Clutter threshold', mres.clutter_threshold],
        ['Health score', 'Low clutter 40 + first or last in break 35 + price vs programme rate 25']];
      X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(info), 'About');
      const buf = X.write(wb, { bookType: 'xlsx', type: 'array' });
      App.download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name + '.xlsx');
    } catch (e) { App.toast('Excel export failed: ' + e.message, 'error'); }
  }

  App.spotlight = { tab };
})(window.App);
