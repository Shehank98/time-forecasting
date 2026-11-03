/* Programme & Sponsorship Spotlight tab (LMRB): Programme Spotlight hub and the Short-form & Sponsorship matrix. */
(function (App) {
  const { esc, fmt, charts: C, tables: T } = App;
  const KEY = 'spot:lmrb';
  const kpi = (l, v, s) => `<div class="kpi"><div class="k-lbl">${esc(l)}</div><div class="k-val">${v}</div>${s ? `<div class="k-sub">${s}</div>` : ''}</div>`;
  const pct = (v) => (v == null ? 'n/a' : fmt.num(v, v < 10 ? 1 : 0) + '%');
  const dec = (v) => (v == null ? 'n/a' : fmt.num(v, 1));
  const tt = (s) => fmt.title(String(s || ''));
  const ROLE_CLS = { Sponsorship: 'role-title', Frequency: 'role-freq', 'Regular Spot': 'role-reg' };
  const role = (r) => `<span class="badge ${ROLE_CLS[r] || ''}">${esc(r)}</span>`;
  const HB = { good: 'good', fair: 'warn', poor: 'bad' };
  const healthBadge = (h) => `<span class="badge ${HB[h.band]}" title="Clutter ${h.parts.clutter}/40, position ${h.parts.position}/35, price ${h.parts.price}/25">${h.score} · ${esc(h.label)}</span>`;
  const DURS = ['5s', '10s', '15s', '20s', '30s', '30s+'];
  const durBar = (s) => { const t = DURS.reduce((a, k) => a + (s[k] || 0), 0) || 1;
    return `<div class="sf-dur" title="${DURS.filter((k) => s[k]).map((k) => `${k}: ${s[k]}`).join(', ')}">${DURS.map((k, i) => (s[k] ? `<i style="width:${(s[k] / t) * 100}%;background:${C.PALETTE[i]}"></i>` : '')).join('')}</div>
      <div class="sf-dur-l small">${DURS.filter((k) => s[k]).slice(0, 4).map((k) => `${k} ${fmt.num(s[k])}`).join(' · ') || 'no length'}</div>`; };
  const alpha = (c, a) => (/^#[0-9a-f]{6}$/i.test(c) ? c + Math.round(a * 255).toString(16).padStart(2, '0') : /^hsl\(/.test(c) ? c.replace(')', ` / ${a})`) : c);
  const load = () => { try { return App.store.get(KEY, null) || {}; } catch (e) { return {}; } };
  const st = Object.assign({ view: 'programme', program: null, channel: null, brand: '', gran: 'auto', dur: 'all', mchannel: '', tag: '', search: '', sort: 'spend', desc: true, rep: {}, tn: {}, lch: '', ladv: '', show: 'sponsor', fmin: 10, fdur: 10 }, load());
  st.tn = Object.assign({ channel: '', program: '', advertiser: '', mode: 'data', show: 'sponsor' }, st.tn || {});
  st.rep = Object.assign({ rp_channels: [], rp_programs: [], rp_advertisers: [], from: '', to: '' }, st.rep || {});
  const save = () => { try { App.store.set(KEY, st); } catch (e) { /* storage blocked */ } };
  const clutterThr = () => { try { return (App.store.get('neg:lmrb', {}) || {}).clutter_threshold || 35; } catch (e) { return 35; } };

  function tab(p, ctx) {
    p.innerHTML = `<div class="card-head" style="margin-bottom:12px"><div class="seg" id="sp-view"><button type="button" data-v="programme" aria-pressed="${st.view === 'programme'}">Programme Spotlight</button><button type="button" data-v="matrix" aria-pressed="${st.view === 'matrix'}">Short-form &amp; Sponsorship Matrix</button><button type="button" data-v="tenure" aria-pressed="${st.view === 'tenure'}">Sponsorship over time</button><button type="button" data-v="report" aria-pressed="${st.view === 'report'}">PDF report</button></div>
      <div class="muted small">Sponsorship items: -BB, Intro, Extro, Com Break, Next Card (billboards) and LLogo, Tag, Time Check, DJ, -Tr (logo items).</div></div><div id="sp-body"></div>`;
    p.querySelectorAll('#sp-view button').forEach((b) => { b.onclick = () => { st.view = b.dataset.v; save(); p.querySelectorAll('#sp-view button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); show(p, ctx); }; });
    show(p, ctx);
  }
  const show = (p, ctx) => { const b = p.querySelector('#sp-body'); return st.view === 'matrix' ? matrix(b, ctx) : st.view === 'report' ? report(b, ctx) : st.view === 'tenure' ? tenure(b, ctx) : programme(b, ctx); };
  const goView = (p, ctx, v) => { st.view = v; save(); p.querySelectorAll('#sp-view button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.v === v))); show(p, ctx); };


  /* ================= Sponsorship over time: who sponsored which programme, year by year ================= */
  const STATUS_CLS = { all: 'good', started: 'info', stopped: 'warn', some: 'warn', single: 'info', occasional: '', none: '' };
  const statusBadge = (r) => `<span class="badge ${STATUS_CLS[r.status_code] || ''}">${esc(r.status)}</span>`;
  let tnLast = null;

  async function tenure(el, ctx) {
    el.innerHTML = `<div class="card"><div class="card-head"><div><h3>Sponsorship over time</h3><div class="sub">Pick a channel, programme and advertiser to see how long they sponsored it across the whole upload, the ads in every year, and which ads ran. Leave them on All to see every sponsorship.</div></div>
        <button class="btn primary" type="button" id="tn-pdf">Download Sponsorship over Time PDF</button></div>
      <div class="tn-grid"><div class="field"><label for="tn-ch">Channel</label><select id="tn-ch"></select></div>
        <div class="field"><label for="tn-pg">Programme</label><select id="tn-pg"></select></div>
        <div class="field"><label for="tn-adv">Advertiser</label><select id="tn-adv"></select></div>
        <div class="field"><label>Years</label><div class="seg" id="tn-mode"><button type="button" data-m="data" aria-pressed="${st.tn.mode === 'data'}">Data years</button><button type="button" data-m="calendar" aria-pressed="${st.tn.mode === 'calendar'}">Calendar years</button></div></div>
        <div class="field"><label>Show</label><div class="seg" id="tn-show"><button type="button" data-s="sponsor" aria-pressed="${st.tn.show !== 'all'}">Sponsorships</button><button type="button" data-s="all" aria-pressed="${st.tn.show === 'all'}">All advertisers</button></div></div></div>
      <div class="muted small" id="tn-note" style="margin-top:6px"></div></div><div id="tn-out" style="margin-top:16px">${App.skeleton(2)}</div>`;
    const go = () => { save(); run(); };
    const pgVal = () => (st.tn.program ? `${st.tn.channel || ''}\u0001${st.tn.program}` : '');
    el.querySelector('#tn-ch').onchange = (e) => { st.tn.channel = e.target.value; st.tn.program = ''; st.tn.advertiser = ''; go(); };
    el.querySelector('#tn-pg').onchange = (e) => { const [c, pg] = e.target.value.split('\u0001'); st.tn.program = pg || ''; if (c) st.tn.channel = c; st.tn.advertiser = ''; go(); };
    el.querySelector('#tn-adv').onchange = (e) => { st.tn.advertiser = e.target.value; go(); };
    el.querySelectorAll('#tn-mode button').forEach((b) => { b.onclick = () => { st.tn.mode = b.dataset.m; el.querySelectorAll('#tn-mode button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); go(); }; });
    el.querySelectorAll('#tn-show button').forEach((b) => { b.onclick = () => { st.tn.show = b.dataset.s; el.querySelectorAll('#tn-show button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); go(); }; });
    el.querySelector('#tn-pdf').onclick = async () => {
      const b = el.querySelector('#tn-pdf');
      if (!tnLast || tnLast.empty) { App.toast('Nothing to export: no sponsorships match these choices.', 'error'); return; }
      b.disabled = true; const txt = b.textContent; b.textContent = 'Building PDF...';
      try {
        const chips = ((ctx.meta && ctx.meta.chips) || []).map((c) => `${c.label}: ${c.value}`), ds = (ctx.body && ctx.body().dataset) || '';
        const res = await App.api.blob('/api/spotlight/tenure/pdf', { report: tnLast, meta: { dataset: ds, filters: chips } });
        App.download(res.blob, res.name); App.toast('Sponsorship over time report downloaded. A copy is kept under Reports.', 'ok');
      } catch (e) { App.toast('The PDF could not be built: ' + e.message, 'error'); } finally { b.disabled = false; b.textContent = txt; }
    };
    let seq = 0;
    async function run() {
      const my = ++seq, out = el.querySelector('#tn-out'); if (!out) return;
      out.innerHTML = App.skeleton(2);
      let d;
      try { d = await App.data.sponsorshipTenure({ filters: ctx.filters(), options: { channel: st.tn.channel || null, program: st.tn.program || null, advertiser: st.tn.advertiser || null, mode: st.tn.mode, show: st.tn.show } }); } catch (e) { out.innerHTML = App.emptyState('The sponsorship view could not be built', e.message); return; }
      if (my !== seq || !out.isConnected) return;
      tnLast = d;
      const o = d.options, chs = el.querySelector('#tn-ch'), pgs = el.querySelector('#tn-pg'), ads = el.querySelector('#tn-adv');
      // drop choices the narrowed lists no longer contain
      if (st.tn.program && !o.programmes.some((x) => x.program === st.tn.program && (!st.tn.channel || x.channel === st.tn.channel))) st.tn.program = '';
      if (st.tn.advertiser && !o.advertisers.some((x) => x.advertiser === st.tn.advertiser)) st.tn.advertiser = '';
      chs.innerHTML = `<option value="">All channels (${fmt.num(o.channels.length)})</option>${o.channels.map((c) => `<option value="${esc(c)}" ${c === st.tn.channel ? 'selected' : ''}>${esc(tt(c))}</option>`).join('')}`;
      pgs.innerHTML = `<option value="">All programmes</option>${o.programmes.slice(0, 600).map((x) => `<option value="${esc(x.channel)}\u0001${esc(x.program)}" ${x.program === st.tn.program && (!st.tn.channel || x.channel === st.tn.channel) ? 'selected' : ''}>${esc(tt(x.program))}${st.tn.channel ? '' : ' · ' + esc(tt(x.channel))}${x.sponsored ? ' (sponsored)' : ''}</option>`).join('')}`;
      ads.innerHTML = `<option value="">All advertisers</option>${o.advertisers.map((x) => `<option value="${esc(x.advertiser)}" ${x.advertiser === st.tn.advertiser ? 'selected' : ''}>${esc(x.advertiser)}${x.sponsored ? ' (sponsor)' : ''}</option>`).join('')}`;
      el.querySelector('#tn-note').textContent = d.periods.length ? `Uploaded data: ${d.bounds[0]} to ${d.bounds[1]} (${d.data_months} months). ${d.periods.map((p) => `${p.label}: ${p.range}`).join(' · ')}` : '';
      if (d.empty) { out.innerHTML = App.emptyState(st.tn.show === 'all' ? 'No ads for this choice' : 'No sponsorships for this choice', 'Pick another channel, programme or advertiser, or switch Show to All advertisers.'); return; }
      if (d.rows.length === 1) detail(out, d, d.rows[0], pgVal, go); else overview(out, d, go);
    }
    run();
  }

  const sumP = (r, k, i) => (r.periods[i] ? r.periods[i][k] : 0);
  function overview(out, d, go) {
    const t = d.totals, P = d.periods;
    const totYear = P.map((p, i) => d.rows.reduce((s, r) => s + sumP(r, 'total_ads', i), 0));
    out.innerHTML = `<div class="kpis">${kpi('Advertiser and programme pairs', fmt.num(t.rows), `${fmt.num(t.advertisers)} advertisers · ${fmt.num(t.programmes)} programmes`)}${kpi('Sponsored in every year', fmt.num(t.all_years), P.length > 1 ? `all ${P.length} years` : 'data covers 1 year')}
        ${kpi('Sponsorship ads', fmt.num(t.sponsorship_ads))}${kpi('All ads in these programmes', fmt.num(t.total_ads))}</div>
      <div class="card" style="margin-top:16px"><div class="card-head"><div><h3>Who sponsored what, year by year</h3><div class="sub">One row per advertiser and programme. The year columns are the ads they ran in that programme in each year. Click a row to see exactly which ads ran.</div></div></div>
        <div class="tbl-scroll" style="max-height:640px"><table class="tbl ex-tbl tn-tbl"><thead><tr><th>Advertiser</th><th>Channel</th><th>Programme</th><th>Status</th><th>Sponsored</th><th class="num">Months</th>${P.map((p) => `<th class="num" title="${esc(p.range)}">${esc(p.label)} ads</th>`).join('')}<th class="num">Total ads</th><th class="num">Sponsorship ads</th><th class="num">Spend (LKR)</th></tr></thead><tbody>
          ${d.rows.map((r, k) => `<tr class="ex-row ${k % 2 ? 'ex-z' : ''}" tabindex="0" data-i="${k}"><td><b>${esc(r.advertiser)}</b><div class="muted small">${esc((r.products || []).join(', '))}</div></td><td>${esc(tt(r.channel))}</td><td><b>${esc(tt(r.program))}</b></td><td>${statusBadge(r)}</td>
            <td class="small">${esc(r.sponsored_from || 'n/a')}<br>to ${esc(r.sponsored_to || 'n/a')}</td><td class="num">${fmt.num(r.months_span)}</td>${P.map((p, i) => `<td class="num ${r.periods[i] && r.periods[i].consistent ? 'tn-yes' : ''}">${fmt.num(sumP(r, 'total_ads', i))}</td>`).join('')}
            <td class="num"><b>${fmt.num(r.total_ads)}</b></td><td class="num">${fmt.num(r.sponsorship_ads)}</td><td class="num">${fmt.num(r.spend)}</td></tr>`).join('')}</tbody>
          <tfoot><tr class="ex-tot"><td colspan="6">Total${d.n_rows > d.rows.length ? ` (the ${d.rows.length} rows shown)` : ''}</td>${totYear.map((v) => `<td class="num">${fmt.num(v)}</td>`).join('')}<td class="num">${fmt.num(d.rows.reduce((s, r) => s + r.total_ads, 0))}</td><td class="num">${fmt.num(d.rows.reduce((s, r) => s + r.sponsorship_ads, 0))}</td><td class="num">${fmt.num(d.rows.reduce((s, r) => s + r.spend, 0))}</td></tr></tfoot></table></div>
        <div class="muted small" style="margin-top:6px">Green year columns = sponsored that year, meaning sponsorship items on at least half of the programme's airing days. Status: "Sponsored all N years" = sponsored that way in every year the programme aired. "Occasional" = only a few stray sponsorship items.</div></div>`;
    out.querySelector('tbody').onclick = (e) => { const tr = e.target.closest('tr.ex-row'); if (!tr) return; const r = d.rows[+tr.dataset.i];
      st.tn.channel = r.channel; st.tn.program = r.program; st.tn.advertiser = r.advertiser; go(); };
    out.querySelector('tbody').onkeydown = (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr.ex-row')) { e.preventDefault(); e.target.click(); } };
  }

  let tnN = 0;
  function detail(out, d, r, pgVal, go) {
    const P = d.periods, id = 'tn-m' + (++tnN);
    out.innerHTML = `<div class="card tn-hero"><div class="card-head"><div><div class="sp-eyebrow">Sponsorship over time</div><h3>${esc(r.advertiser)} <span class="muted">· ${esc(tt(r.program))} on ${esc(tt(r.channel))}</span></h3>
        <div class="sub">${esc((r.products || []).join(', '))}</div></div><div class="row">${statusBadge(r)}<button class="btn sm ghost" type="button" id="tn-back">Back to all sponsorships</button></div></div>
      <p class="tn-headline">${esc(r.headline)}</p>
      <div class="kpis">${kpi('Sponsored for', `${fmt.num(r.months_span)} month${r.months_span === 1 ? '' : 's'}`, r.sponsored_from ? `${esc(r.sponsored_from)} to ${esc(r.sponsored_to)}` : 'no sponsorship items')}${kpi('Years sponsored', `${fmt.num(r.years_sponsored)} of ${fmt.num(r.years_aired)}`, 'sponsored on half or more of the airing days')}
        ${kpi('Total ads', fmt.num(r.total_ads), `${fmt.num(r.sponsorship_ads)} sponsorship · ${fmt.num(r.other_ads)} other`)}${kpi('Present on', pct(r.presence_pct), `${fmt.num(r.days_sponsored)} of ${fmt.num(r.airing_days)} airing days`)}${kpi('Spend', `<span title="${fmt.lkr(r.spend)}">${fmt.lkrc(r.spend)}</span>`, `${fmt.lkrc(r.sponsorship_spend)} on sponsorship items`)}</div></div>
      <div class="card" style="margin-top:16px"><h3>Year by year</h3><div class="tbl-scroll"><table class="tbl ex-tbl"><thead><tr><th>Year</th><th>Dates</th><th class="num">Programme airing days</th><th class="num">Days sponsored</th><th class="num">Sponsorship ads</th><th class="num">Other ads</th><th class="num">Total ads</th><th class="num">Ads per airing</th><th class="num">Spend (LKR)</th><th>Sponsored?</th></tr></thead><tbody>
        ${r.periods.map((x, k) => `<tr class="${k % 2 ? 'ex-z' : ''}"><td><b>${esc(x.label)}</b></td><td class="small">${esc(x.range)}</td><td class="num">${fmt.num(x.airing_days)}</td><td class="num">${fmt.num(x.days_sponsored)}</td><td class="num"><b>${fmt.num(x.sponsorship_ads)}</b></td><td class="num">${fmt.num(x.other_ads)}</td><td class="num"><b>${fmt.num(x.total_ads)}</b></td><td class="num">${x.ads_per_airing == null ? 'n/a' : fmt.num(x.ads_per_airing, 1)}</td><td class="num">${fmt.num(x.spend)}</td>
          <td>${x.consistent ? '<span class="badge good">Sponsored</span>' : x.sponsored ? '<span class="badge warn">Occasional</span>' : !x.aired ? '<span class="badge">Not on air</span>' : '<span class="badge bad">Not sponsored</span>'}</td></tr>`).join('')}</tbody>
        <tfoot><tr class="ex-tot"><td colspan="2">Whole period</td><td class="num">${fmt.num(r.airing_days)}</td><td class="num">${fmt.num(r.days_sponsored)}</td><td class="num">${fmt.num(r.sponsorship_ads)}</td><td class="num">${fmt.num(r.other_ads)}</td><td class="num">${fmt.num(r.total_ads)}</td><td></td><td class="num">${fmt.num(r.spend)}</td><td></td></tr></tfoot></table></div></div>
      ${r.gaps.length ? `<div class="banner"><span>Sponsorship paused in the middle: ${r.gaps.map((g) => `${esc(g.from)} to ${esc(g.to)} (${g.months} month${g.months === 1 ? '' : 's'})`).join('; ')}.</span></div>` : ''}
      <div style="margin-top:16px">${C.box(id, 'Ads per month', 'Blue = sponsorship ads, grey = other ads. A red dashed line starts each new year. Click a bar.', { tall: true, help: ['Every month from the first to the last month this advertiser ran an ad in the programme. Months with no bars had no ads.', 'See at a glance whether the sponsorship ran without a break across the years.'] })}</div>
      <div class="card" style="margin-top:16px"><h3>What ads ran</h3><div class="sub muted small">Each theme is one ad. Sponsorship items first. The year columns count the times each ad ran.</div><div class="tbl-scroll"><table class="tbl ex-tbl"><thead><tr><th>Ad (theme)</th><th>Type</th>${P.map((p) => `<th class="num">${esc(p.label)} ads</th>`).join('')}<th class="num">Total ads</th><th>First seen</th><th>Last seen</th></tr></thead><tbody>
        ${r.themes.map((t, k) => `<tr class="${k % 2 ? 'ex-z' : ''}"><td><b>${esc(t.theme)}</b></td><td>${t.sponsorship ? `<span class="badge role-title">Sponsorship</span> <span class="muted small">${esc(t.item)}</span>` : '<span class="badge role-reg">Spot</span>'}</td>${t.per_period.map((v) => `<td class="num">${fmt.num(v)}</td>`).join('')}<td class="num"><b>${fmt.num(t.spots)}</b></td><td class="small">${esc(t.first_seen)}</td><td class="small">${esc(t.last_seen)}</td></tr>`).join('')}</tbody>
        <tfoot><tr class="ex-tot"><td colspan="2">Total</td>${P.map((p, i) => `<td class="num">${fmt.num(r.themes.reduce((s, t) => s + (t.per_period[i] || 0), 0))}</td>`).join('')}<td class="num">${fmt.num(r.themes.reduce((s, t) => s + t.spots, 0))}</td><td colspan="2"></td></tr></tfoot></table></div></div>`;
    out.querySelector('#tn-back').onclick = () => { st.tn.advertiser = ''; st.tn.program = ''; go(); };
    const mo = r.months, sp = C.PALETTE[0], other = C.css('--muted') || '#8a93b8', bad = C.css('--bad') || '#ff5d7a';
    const bounds = { id: 'tnYears', afterDatasetsDraw(ch) { const { ctx: c, chartArea: a, scales: { x } } = ch; c.save(); c.strokeStyle = bad; c.setLineDash([5, 4]); c.lineWidth = 1;
      for (let i = 1; i < mo.length; i++) if (mo[i].period !== mo[i - 1].period) { const px = (x.getPixelForValue(i) + x.getPixelForValue(i - 1)) / 2; c.beginPath(); c.moveTo(px, a.top); c.lineTo(px, a.bottom); c.stroke(); }
      c.setLineDash([]); c.fillStyle = bad; c.font = '700 11px sans-serif'; P.forEach((p) => { const ix = mo.map((m, i) => (m.period === p.index ? i : -1)).filter((i) => i >= 0); if (ix.length) c.fillText(p.label, x.getPixelForValue(ix[0]) + 4, a.top + 12); }); c.restore(); } };
    C.make(id, { type: 'bar', plugins: [bounds], detailOnly: true, data: { labels: mo.map((m) => m.label), datasets: [{ label: 'Sponsorship ads', data: mo.map((m) => m.sponsorship_ads), backgroundColor: sp, stack: 's' }, { label: 'Other ads', data: mo.map((m) => m.other_ads), backgroundColor: other + '99', stack: 's' }] },
      options: { interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom' } }, scales: { x: { stacked: true, grid: { display: false }, ticks: { maxTicksLimit: 12, maxRotation: 0 } }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 }, title: { display: true, text: 'Ads' } } } },
      detail: (i) => { const m = mo[i]; return `<div class="dt-kpis"><div class="dt-k"><span>Month</span><b>${esc(m.label)}</b></div><div class="dt-k"><span>Year</span><b>${esc(P[m.period] ? P[m.period].label : '')}</b></div><div class="dt-k"><span>Sponsorship ads</span><b>${fmt.num(m.sponsorship_ads)}</b></div><div class="dt-k"><span>Other ads</span><b>${fmt.num(m.other_ads)}</b></div></div>`; } });
  }

  /* ================= Programme Spotlight ================= */
  /** Programme Spotlight: pick a channel and an advertiser, see every sponsorship and frequency buy, then open any programme. */
  async function programme(el, ctx) {
    el.innerHTML = `<div class="card"><div class="sp-pick2">
        <div class="field"><label for="sp-ch">Channel</label><select id="sp-ch"><option value="">All channels</option></select></div>
        <div class="field"><label for="sp-adv">Advertiser</label><select id="sp-adv"><option value="">All advertisers</option></select></div>
        <div class="field"><label>Show</label><div class="seg" id="sp-show"><button type="button" data-s="sponsor" aria-pressed="${st.show !== 'all'}">Sponsorships &amp; frequency</button><button type="button" data-s="all" aria-pressed="${st.show === 'all'}">All ads</button></div></div>
        <div class="field"><label for="sp-fd">Frequency: daily average at least</label><input id="sp-fd" type="number" min="1" step="1" value="${esc(st.fmin)}"></div>
        <div class="field"><label for="sp-fl">and spot length up to (seconds)</label><input id="sp-fl" type="number" min="1" step="1" value="${esc(st.fdur)}"></div></div>
      <div class="muted small" style="margin-top:6px">Sponsorship = a sponsorship theme (-BB, Intro, Extro, Com Break, Next Card, LLogo, Tag, Time Check, DJ, -Tr). Frequency = the same ad (theme) on one channel, ${esc(st.fdur)} seconds or shorter, ${esc(st.fmin)} or more spots per day on air.</div></div>
      <div id="sp-list" style="margin-top:16px">${App.skeleton(2)}</div>
      <div class="card" id="sp-detail-card" style="margin-top:16px"><div class="card-head"><div><h3>Programme detail</h3><div class="sub">Open a programme from the table, or pick one here.</div></div></div>
        <div class="sp-pick"><div class="field"><label for="sp-prog">Programme</label><select id="sp-prog"></select></div>
          <div class="field"><label for="sp-brand">Brand in focus</label><select id="sp-brand"></select></div>
          <div class="field"><label>Timeline</label><div class="seg" id="sp-gran">${[['auto', 'Auto'], ['day', 'By airing'], ['week', 'Weekly'], ['month', 'Monthly']].map(([v, l]) => `<button type="button" data-g="${v}" aria-pressed="${st.gran === v}">${l}</button>`).join('')}</div></div></div></div>
      <div id="sp-out" style="margin-top:16px"></div>`;
    const again = () => { save(); listRun(el, ctx); };
    el.querySelector('#sp-ch').onchange = (e) => { st.lch = e.target.value; st.ladv = ''; again(); };
    el.querySelector('#sp-adv').onchange = (e) => { st.ladv = e.target.value; again(); };
    el.querySelectorAll('#sp-show button').forEach((b) => { b.onclick = () => { st.show = b.dataset.s; el.querySelectorAll('#sp-show button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); again(); }; });
    el.querySelector('#sp-fd').onchange = (e) => { st.fmin = Math.max(1, +e.target.value || 10); programme(el, ctx); save(); };
    el.querySelector('#sp-fl').onchange = (e) => { st.fdur = Math.max(1, +e.target.value || 10); programme(el, ctx); save(); };
    el.querySelectorAll('#sp-gran button').forEach((b) => { b.onclick = () => { st.gran = b.dataset.g; save(); el.querySelectorAll('#sp-gran button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); runProg(el, ctx); }; });
    el.querySelector('#sp-brand').onchange = (e) => { st.brand = e.target.value; save(); runProg(el, ctx); };
    el.querySelector('#sp-prog').onchange = (e) => { const [c, pg] = e.target.value.split('\u0001'); st.channel = c || null; st.program = pg; st.brand = st.ladv || ''; save(); runProg(el, ctx); };
    listRun(el, ctx);
  }

  const typeBadges = (types) => types.map((x) => `<span class="badge ${x === 'Sponsorship' ? 'role-title' : x === 'Frequency' ? 'role-freq' : 'role-reg'}">${esc(x)}</span>`).join(' ');
  async function listRun(el, ctx) {
    const box = el.querySelector('#sp-list'); if (!box) return;
    box.innerHTML = App.skeleton(2);
    let d;
    try { d = await App.data.sponsorshipList({ filters: ctx.filters(), options: { channel: st.lch || null, advertiser: st.ladv || null, show: st.show || 'sponsor', min_daily: st.fmin, max_dur: st.fdur } }); } catch (e) { box.innerHTML = App.emptyState('The sponsorship list could not be built', e.message); return; }
    if (!box.isConnected) return;
    const chs = el.querySelector('#sp-ch'), ads = el.querySelector('#sp-adv');
    if (st.lch && !d.options.channels.includes(st.lch)) st.lch = '';
    chs.innerHTML = `<option value="">All channels (${fmt.num(d.options.channels.length)})</option>${d.options.channels.map((c) => `<option value="${esc(c)}" ${c === st.lch ? 'selected' : ''}>${esc(tt(c))}</option>`).join('')}`;
    ads.innerHTML = `<option value="">All advertisers (${fmt.num(d.options.advertisers.length)})</option>${d.options.advertisers.map((a) => `<option value="${esc(a)}" ${a === st.ladv ? 'selected' : ''}>${esc(a)}</option>`).join('')}`;
    if (d.empty) { box.innerHTML = App.emptyState('No ads for this channel and advertiser', 'Pick another channel or advertiser, or widen the page filters.'); fillProgPick(el, ctx, []); return; }
    const t = d.totals, who = `${st.ladv || 'All advertisers'} on ${st.lch ? tt(st.lch) : 'all channels'}`;
    box.innerHTML = `<div class="kpis">${kpi('Sponsorship themes', fmt.num(t.sponsorship_themes), `${fmt.num(t.sponsorship_ads)} sponsorship ads`)}${kpi('Programmes with sponsorship', fmt.num(t.programmes))}
        ${kpi('Frequency buys', fmt.num(t.frequency_buys), `${fmt.num(t.frequency_ads)} ads at ${d.rule.max_dur}s or less, ${d.rule.min_daily}+ a day`)}${kpi('Ad count', fmt.num(t.ad_count), `${fmt.lkrc(t.spend)} spend`)}${kpi('Advertisers', fmt.num(t.advertisers), `${fmt.num(t.channels)} channel${t.channels === 1 ? '' : 's'}`)}</div>
      <div class="card" style="margin-top:16px"><div class="card-head"><div><h3>${esc(who)}: ${st.show === 'all' ? 'every ad' : 'sponsorships and frequency buys'}</h3><div class="sub">${d.period[0]} to ${d.period[1]}. One row per advertiser, channel and theme (the same ad). Daily average = ads per day the theme was on air. Click Open to see a programme in detail.</div></div></div>
        <div id="sp-tbl"></div></div>`;
    const rows = d.rows.map((r) => ({ ...r, programmes_text: r.programmes.map((p) => `${tt(p.program)} (${p.spots})`).join('; '), type_text: r.types.join(' + '), open: r.programmes[0] ? r.programmes[0].program : '' }));
    T.create(box.querySelector('#sp-tbl'), { csv: 'sponsorships_' + (st.lch || 'all') + '_' + (st.ladv || 'all').replace(/\W+/g, '_'), pageSize: 25, rows, defaultSort: null, empty: 'No sponsorship or frequency ads here. Switch Show to All ads to see every theme.', columns: [
      { key: 'advertiser', label: 'Advertiser', html: (v, r) => `<span class="swatch" style="background:${C.colorFor(v)}"></span>${esc(v)}<div class="muted small">${esc(r.product)}</div>` },
      { key: 'channel', label: 'Channel', fmt: tt },
      { key: 'theme', label: 'Theme', html: (v, r) => `${esc(v)}<div class="muted small">${esc(r.item)}</div>` },
      { key: 'type_text', label: 'Type', html: (v, r) => typeBadges(r.types) },
      { key: 'programmes_text', label: 'Sponsorship programmes', html: (v, r) => r.programmes.slice(0, 4).map((p) => `<span class="chip">${esc(tt(p.program))} · ${fmt.num(p.spots)}</span>`).join(' ') + (r.programmes.length > 4 ? ` <span class="muted small">+${r.programmes.length - 4} more</span>` : '') },
      { key: 'spots', label: 'Ad count', num: true, fmt: (v) => fmt.num(v) },
      { key: 'days', label: 'Days on air', num: true },
      { key: 'daily_avg', label: 'Daily average', num: true, html: (v, r) => `<b class="${r.frequency ? 'sp-freq' : ''}">${fmt.num(v, v < 10 ? 1 : 0)}</b><div class="muted small">busiest ${fmt.num(r.peak_day)}</div>` },
      { key: 'length', label: 'Length', num: true, fmt: (v) => (v == null ? 'n/a' : fmt.num(v, 0) + 's') },
      { key: 'first_seen', label: 'Ran', html: (v, r) => `<span class="small">${esc(v)}<br>to ${esc(r.last_seen)}</span>` },
      { key: 'open', label: '', html: (v, r) => (v ? `<button type="button" class="btn sm ghost" data-open="${esc(r.channel)}\u0001${esc(v)}\u0001${esc(r.advertiser)}">Open</button>` : '') }] });
    box.querySelector('#sp-tbl').onclick = (e) => { const b = e.target.closest('[data-open]'); if (!b) return; const [c, pg, a] = b.dataset.open.split('\u0001');
      st.channel = c; st.program = pg; st.brand = a; save(); const ps = el.querySelector('#sp-prog'); ps.value = `${c}\u0001${pg}`; runProg(el, ctx); el.querySelector('#sp-detail-card').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    // programme picker for the detail: programmes in this list, sponsorship ones first
    const seen = new Map();
    d.rows.forEach((r) => r.programmes.forEach((p) => { const k = `${r.channel}\u0001${p.program}`; const x = seen.get(k) || { channel: r.channel, program: p.program, spots: 0, sp: 0 }; x.spots += p.spots; if (r.sponsorship) x.sp += p.spots; seen.set(k, x); }));
    fillProgPick(el, ctx, [...seen.values()].sort((a, b) => b.sp - a.sp || b.spots - a.spots));
  }
  function fillProgPick(el, ctx, progs) {
    const ps = el.querySelector('#sp-prog'); if (!ps) return;
    if (!progs.length) { ps.innerHTML = '<option value="">No programmes</option>'; el.querySelector('#sp-out').innerHTML = ''; return; }
    if (!progs.some((x) => x.channel === st.channel && x.program === st.program)) { st.channel = progs[0].channel; st.program = progs[0].program; st.brand = st.ladv || ''; }
    ps.innerHTML = progs.slice(0, 400).map((x) => `<option value="${esc(x.channel)}\u0001${esc(x.program)}" ${x.channel === st.channel && x.program === st.program ? 'selected' : ''}>${esc(tt(x.program))} · ${esc(tt(x.channel))}${x.sp ? ` (${fmt.num(x.sp)} sponsorship ads)` : ''}</option>`).join('');
    save(); runProg(el, ctx);
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
    out._ctx = ctx; drawProg(out, d);
  }

  function drawProg(out, d) {
    const t = d.totals, f = d.focus, prog = tt(d.program), where = d.channel ? tt(d.channel) : d.channels.map(tt).join(', ');
    const pos = f.position, posT = pos.first + pos.early + pos.middle + pos.last;
    out.innerHTML = `<div class="card sp-hero"><div class="card-head"><div><div class="sp-eyebrow">Programme Spotlight</div><h3>${esc(prog)} <span class="muted">· ${esc(where)}</span></h3>
        <div class="sub">${d.period[0]} to ${d.period[1]} · ${fmt.num(t.episodes)} airing days · ${fmt.num(t.brands)} advertisers · ${fmt.num(t.sponsors)} with sponsorship items</div></div>
        <div class="sp-focus">${role(f.role)}<div><b>${esc(f.name)}</b><div class="muted small">${esc((f.products || []).join(', '))}</div></div><button class="btn sm" type="button" id="sp-to-pdf">PDF for this programme</button></div></div>
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
    out.querySelector('#sp-to-pdf').onclick = () => { st.rep = { rp_channels: d.channel ? [d.channel] : d.channels.slice(), rp_programs: [d.program], rp_advertisers: [f.name], from: d.period[0], to: d.period[1] }; const tabEl = out.closest('[id^=panel-]'); goView(tabEl, out._ctx, 'report'); };
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


  /* ================= PDF report: Channel > Programme > Advertiser ================= */
  async function report(el, ctx) {
    el.innerHTML = `<div class="card"><div class="card-head"><div><h3>Programme &amp; Sponsorship PDF</h3><div class="sub">Choose channels, programmes, advertisers and a date range. The PDF lists Channel &rsaquo; Programme &rsaquo; Advertiser with sponsorship and regular spend, spots, position and clutter.</div></div>
        <button class="btn primary" type="button" id="rp-pdf">Download Programme &amp; Sponsorship PDF</button></div>
      <div class="rp-grid"><div data-ms="rp_channels"></div><div data-ms="rp_programs"></div><div data-ms="rp_advertisers"></div>
        <div class="field"><label for="rp-from">From</label><input id="rp-from" type="date" value="${esc(st.rep.from)}"></div>
        <div class="field"><label for="rp-to">To</label><input id="rp-to" type="date" value="${esc(st.rep.to)}"></div></div>
      <div class="row rp-quick" style="margin-top:8px"><span class="muted small">Quick range:</span>${[['30', 'Last 30 days'], ['90', 'Last 3 months'], ['month', 'Last full month'], ['year', 'This year'], ['all', 'All dates']].map(([v, l]) => `<button type="button" class="btn sm ghost" data-q="${v}">${l}</button>`).join('')}
        <span class="muted small" id="rp-bounds"></span><button type="button" class="btn sm ghost" id="rp-reset" style="margin-left:auto">Clear choices</button></div></div>
      <div id="rp-out" style="margin-top:16px">${App.skeleton(2)}</div>`;
    const ctl = el.querySelector('.rp-grid'); ctl._sig = {};
    let bounds = null, last = null, seq = 0;
    const again = App.debounce(() => { save(); refresh(); }, 250);
    const mount = (k, label, list) => {
      const sig = JSON.stringify(list) + '|' + JSON.stringify(st.rep[k]);
      const cur = ctl.querySelector(`[data-ms="${k}"]`); if (ctl._sig[k] === sig || (cur && cur.querySelector('.ms-pop'))) return;
      ctl._sig[k] = sig; const m = App.filters.multi({ key: k, label }, list, st.rep, again); m.dataset.ms = k; cur.replaceWith(m);
    };
    const opts = () => ({ channels: st.rep.rp_channels || [], programs: st.rep.rp_programs || [], advertisers: st.rep.rp_advertisers || [], date_from: st.rep.from || null, date_to: st.rep.to || null, clutter_threshold: clutterThr() });
    async function refresh() {
      const my = ++seq, out = el.querySelector('#rp-out'); if (!out) return;
      let o, r;
      try { o = await App.data.sponsorshipOptions({ filters: ctx.filters(), options: opts() }); } catch (e) { out.innerHTML = App.emptyState('Choices could not be listed', e.message); return; }
      if (my !== seq || !out.isConnected) return;
      bounds = [o.data_from, o.data_to];
      el.querySelector('#rp-from').min = el.querySelector('#rp-to').min = o.data_from || ''; el.querySelector('#rp-from').max = el.querySelector('#rp-to').max = o.data_to || '';
      el.querySelector('#rp-bounds').textContent = o.data_from ? `Data runs ${o.data_from} to ${o.data_to}.` : '';
      // drop picks the narrowed lists no longer contain
      let dropped = false;
      [['rp_channels', o.channels], ['rp_programs', o.programs], ['rp_advertisers', o.advertisers]].forEach(([k, list]) => { const ok = new Set(list), keep = (st.rep[k] || []).filter((x) => ok.has(x)); if (keep.length !== (st.rep[k] || []).length) { dropped = true; st.rep[k] = keep; } });
      mount('rp_channels', 'Channel', o.channels); mount('rp_programs', 'Programme', o.programs.map((x) => x)); mount('rp_advertisers', 'Advertiser', o.advertisers);
      if (dropped) { save(); return refresh(); }
      out.innerHTML = App.skeleton(2);
      try { r = await App.data.sponsorshipReport({ filters: ctx.filters(), options: opts() }); } catch (e) { out.innerHTML = App.emptyState('The report could not be built', e.message); return; }
      if (my !== seq || !out.isConnected) return;
      last = r; preview(out, r);
    }
    el.querySelector('#rp-from').onchange = (e) => { st.rep.from = e.target.value; again(); };
    el.querySelector('#rp-to').onchange = (e) => { st.rep.to = e.target.value; again(); };
    el.querySelector('#rp-reset').onclick = () => { st.rep = { rp_channels: [], rp_programs: [], rp_advertisers: [], from: '', to: '' }; ctl._sig = {}; el.querySelector('#rp-from').value = el.querySelector('#rp-to').value = ''; save(); refresh(); };
    el.querySelectorAll('[data-q]').forEach((b) => { b.onclick = () => {
      if (!bounds || !bounds[1]) return;
      const end = bounds[1], d = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') - n * 864e5).toISOString().slice(0, 10), q = b.dataset.q;
      let from = '', to = '';
      if (q === '30' || q === '90') { from = d(end, +q - 1); to = end; }
      else if (q === 'month') { const e = new Date(Date.parse(end.slice(0, 8) + '01T00:00:00Z') - 864e5); to = e.toISOString().slice(0, 10); from = to.slice(0, 8) + '01'; }
      else if (q === 'year') { from = end.slice(0, 4) + '-01-01'; to = end; }
      st.rep.from = from; st.rep.to = to; el.querySelector('#rp-from').value = from; el.querySelector('#rp-to').value = to; save(); refresh(); }; });
    el.querySelector('#rp-pdf').onclick = async () => {
      const b = el.querySelector('#rp-pdf');
      if (!last || last.empty) { App.toast('Nothing to export: no spots match these choices.', 'error'); return; }
      b.disabled = true; const txt = b.textContent; b.textContent = 'Building PDF...';
      try {
        const chips = ((ctx.meta && ctx.meta.chips) || []).map((c) => `${c.label}: ${c.value}`), ds = (ctx.body && ctx.body().dataset) || '';
        const res = await App.api.blob('/api/spotlight/pdf', { report: last, meta: { dataset: ds, filters: chips } });
        App.download(res.blob, res.name); App.toast('Programme and sponsorship report downloaded. A copy is kept under Reports.', 'ok');
      } catch (e) { App.toast('The PDF could not be built: ' + e.message, 'error'); } finally { b.disabled = false; b.textContent = txt; }
    };
    refresh();
  }

  function preview(out, r) {
    if (r.empty) { out.innerHTML = App.emptyState('No spots match these choices', 'Widen the date range or clear a channel, programme or advertiser.'); return; }
    const t = r.totals, rows = [];
    r.channels.forEach((c) => {
      rows.push(`<tr class="rp-ch"><td colspan="2"><b>${esc(tt(c.channel))}</b></td><td class="num">${fmt.num(c.sponsor_spend)}</td><td></td><td class="num">${fmt.num(c.spend)}</td><td class="num">${fmt.num(c.spots)}</td><td colspan="3"></td></tr>`);
      c.programmes.forEach((p) => {
        rows.push(`<tr class="rp-pg"><td colspan="2"><b>${esc(tt(p.program))}</b> <span class="muted small">${fmt.num(p.airing_days)} airing days${p.sponsors && p.sponsors.length ? ` · sponsors: ${esc(p.sponsors.slice(0, 3).join(', '))}${p.sponsors.length > 3 ? ' and more' : ''}` : ''}${p.peaks.length ? ` · ${p.peaks.length} peak episode${p.peaks.length > 1 ? 's' : ''}` : ''}</span></td>
          <td class="num">${fmt.num(p.selected.sponsor_spend)}</td><td class="num">${fmt.num(p.selected.regular_spend)}</td><td class="num">${fmt.num(p.selected.spend)}</td><td class="num">${fmt.num(p.selected.spots)}</td><td class="num">${pct(p.fib_pct)}</td><td class="num">${dec(p.avg_clutter)}</td><td></td></tr>`);
        p.advertisers.slice(0, 15).forEach((a) => rows.push(`<tr class="rp-ad"><td><span class="swatch" style="background:${C.colorFor(a.advertiser)}"></span>${esc(a.advertiser)}<div class="muted small">${esc((a.products || []).join(', '))}</div></td><td>${role(a.role)}</td>
          <td class="num">${fmt.num(a.sponsor_spend)}${a.sponsor_items ? `<div class="muted small">${fmt.num(a.sponsor_items)} item${a.sponsor_items === 1 ? '' : 's'}</div>` : ''}</td><td class="num">${fmt.num(a.regular_spend)}</td><td class="num">${fmt.num(a.spend)}<div class="muted small">SoV ${pct(a.sov_spend)}</div></td>
          <td class="num">${fmt.num(a.spots)}<div class="muted small">${fmt.num(a.per_day, 1)}/day</div></td><td class="num">${pct(a.fib_pct)}</td><td class="num ${a.avg_clutter > r.clutter_threshold ? 'neg-hot' : ''}">${dec(a.avg_clutter)}</td><td>${healthBadge(a.health)}</td></tr>`));
      });
    });
    out.innerHTML = `<div class="kpis">${kpi('Date range', `<span class="rp-range">${esc(r.range[0])}<br>to ${esc(r.range[1])}</span>`, `Spots found ${r.period[0]} to ${r.period[1]}`)}
        ${kpi('Total spend', `<span title="${fmt.lkr(t.spend)}">${fmt.lkrc(t.spend)}</span>`, `${fmt.num(t.spots)} spots`)}${kpi('Sponsorship investment', fmt.lkrc(t.sponsor_spend), `${fmt.num(t.sponsor_items)} items`)}
        ${kpi('Channels / programmes', `${fmt.num(t.channels)} / ${fmt.num(t.programmes)}`, t.programmes > t.programmes_shown ? `PDF shows the ${t.programmes_shown} biggest` : '')}${kpi('Advertisers', fmt.num(t.advertisers), `${fmt.num(t.sponsorships)} programme sponsorships`)}${kpi('First in break', pct(t.fib_pct), `Avg ads in break ${dec(t.avg_clutter)}`)}</div>
      <div class="card" style="margin-top:16px"><div class="card-head"><div><h3>Preview: Channel &rsaquo; Programme &rsaquo; Advertiser</h3><div class="sub">This is the main table of the PDF. The PDF also has talking points, an advertiser summary, month by month and peak episodes.</div></div></div>
        <div class="tbl-scroll" style="max-height:620px"><table class="tbl rp-tbl"><thead><tr><th>Channel / programme / advertiser</th><th>Role</th><th class="num">Sponsorship LKR</th><th class="num">Regular LKR</th><th class="num">Total LKR</th><th class="num">Spots</th><th class="num">First in break</th><th class="num">Avg ads in break</th><th>Health</th></tr></thead><tbody>${rows.join('')}</tbody></table></div></div>`;
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
        <td>${role(r.role)}${r.sponsor_items ? `<div class="muted small">${fmt.num(r.sponsor_items)} item${r.sponsor_items === 1 ? '' : 's'}</div>` : ''}</td>
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
