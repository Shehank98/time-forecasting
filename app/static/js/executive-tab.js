/* Executive Negotiation Summary tab (LMRB): table-first summary for agency heads and brand managers,
 * with click-to-expand drill-downs (commercial, ratings and volume, sponsorship) and a PDF export. */
(function (App) {
  const { esc, fmt, charts: C } = App;
  const KEY = 'exec:lmrb';
  const tt = (s) => fmt.title(String(s || ''));
  const pct = (v) => (v == null ? 'n/a' : fmt.num(v, v < 10 ? 1 : 0) + '%');
  const dec = (v) => (v == null ? 'n/a' : fmt.num(v, 1));
  const kpi = (l, v, s) => `<div class="kpi"><div class="k-lbl">${esc(l)}</div><div class="k-val">${v}</div>${s ? `<div class="k-sub">${s}</div>` : ''}</div>`;
  const load = () => { try { return App.store.get(KEY, null) || {}; } catch (e) { return {}; } };
  const st = Object.assign({ ex_advertisers: [], ex_channels: [], from: '', to: '' }, load());
  const save = () => { try { App.store.set(KEY, st); } catch (e) { /* storage blocked */ } };
  const freqRule = () => { try { const s = App.store.get('spot:lmrb', {}) || {}; return { min_daily: s.fmin || 10, max_dur: s.fdur || 10 }; } catch (e) { return { min_daily: 10, max_dur: 10 }; } };
  let last = null;

  const opts = (ctx, extra) => ({ ...(ctx.options ? ctx.options() : {}), advertisers: st.ex_advertisers || [], channels: st.ex_channels || [], date_from: st.from || null, date_to: st.to || null, ...freqRule(), ...(extra || {}) });

  function tab(p, ctx) {
    p.innerHTML = `<div class="card"><div class="card-head"><div><h3>Executive Negotiation Summary</h3><div class="sub">Overall campaign, channel by channel, and programmes and sponsorship. Click any channel or programme row for the full breakdown.</div></div>
        <div class="row" style="gap:8px"><button class="btn" type="button" id="ex-items">Sponsorship items</button><button class="btn primary" type="button" id="ex-pdf">Export Executive Summary PDF</button></div></div>
      <div class="rp-grid"><div data-ms="ex_advertisers"></div><div data-ms="ex_channels"></div>
        <div class="field"><label for="ex-from">From</label><input id="ex-from" type="date" value="${esc(st.from)}"></div>
        <div class="field"><label for="ex-to">To</label><input id="ex-to" type="date" value="${esc(st.to)}"></div><div></div></div>
      <div class="row rp-quick" style="margin-top:8px"><span class="muted small">Quick range:</span>${[['30', 'Last 30 days'], ['90', 'Last 3 months'], ['month', 'Last full month'], ['year', 'This year'], ['all', 'All dates']].map(([v, l]) => `<button type="button" class="btn sm ghost" data-q="${v}">${l}</button>`).join('')}
        <span class="muted small" id="ex-bounds"></span></div></div>
      <div id="ex-out" style="margin-top:16px">${App.skeleton(3)}</div>`;
    const ctl = p.querySelector('.rp-grid'); ctl._sig = {};
    let bounds = null, seq = 0;
    const again = App.debounce(() => { save(); run(); }, 250);
    const mount = (k, label, list) => {
      const sig = JSON.stringify(list) + '|' + JSON.stringify(st[k]);
      const cur = ctl.querySelector(`[data-ms="${k}"]`); if (!cur || ctl._sig[k] === sig || cur.querySelector('.ms-pop')) return;
      ctl._sig[k] = sig; const m = App.filters.multi({ key: k, label }, list, st, again); m.dataset.ms = k; cur.replaceWith(m);
    };
    async function run() {
      const my = ++seq, out = p.querySelector('#ex-out'); if (!out) return;
      out.innerHTML = App.skeleton(3);
      let d;
      try { d = await App.data.executiveSummary({ filters: ctx.filters(), options: opts(ctx) }); } catch (e) { out.innerHTML = App.emptyState('The summary could not be built', e.message); return; }
      if (my !== seq || !out.isConnected) return;
      bounds = d.bounds;
      ['#ex-from', '#ex-to'].forEach((s) => { const i = p.querySelector(s); i.min = bounds[0] || ''; i.max = bounds[1] || ''; });
      p.querySelector('#ex-bounds').textContent = bounds[0] ? `Data runs ${bounds[0]} to ${bounds[1]}.` : '';
      let dropped = false;
      [['ex_channels', d.options.channels], ['ex_advertisers', d.options.advertisers]].forEach(([k, list]) => { const ok = new Set(list), keep = (st[k] || []).filter((x) => ok.has(x)); if (keep.length !== (st[k] || []).length) { dropped = true; st[k] = keep; } });
      mount('ex_advertisers', 'Advertiser / brand', d.options.advertisers); mount('ex_channels', 'Channel', d.options.channels);
      if (dropped) { save(); return run(); }
      last = d;
      if (d.empty) { out.innerHTML = App.emptyState('No spots match this selection', 'Widen the dates or clear an advertiser or channel.'); return; }
      draw(out, d, ctx);
    }
    p.querySelector('#ex-from').onchange = (e) => { st.from = e.target.value; again(); };
    p.querySelector('#ex-to').onchange = (e) => { st.to = e.target.value; again(); };
    p.querySelectorAll('[data-q]').forEach((b) => { b.onclick = () => {
      if (!bounds || !bounds[1]) return;
      const end = bounds[1], back = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') - n * 864e5).toISOString().slice(0, 10), q = b.dataset.q;
      let from = '', to = '';
      if (q === '30' || q === '90') { from = back(end, +q - 1); to = end; } else if (q === 'month') { to = new Date(Date.parse(end.slice(0, 8) + '01T00:00:00Z') - 864e5).toISOString().slice(0, 10); from = to.slice(0, 8) + '01'; } else if (q === 'year') { from = end.slice(0, 4) + '-01-01'; to = end; }
      st.from = from; st.to = to; p.querySelector('#ex-from').value = from; p.querySelector('#ex-to').value = to; save(); run(); }; });
    p.querySelector('#ex-pdf').onclick = () => pdf(p, ctx);
    p.querySelector('#ex-items').onclick = () => App.sponsorItemsPanel.open();
    document.addEventListener('datachange', (e) => { if (e.detail && e.detail.sponsorship && p.isConnected) run(); });
    run();
  }

  /* ---------------- summary tables ---------------- */
  const splitTable = (title, rows, label) => `<div class="ex-mini"><h4>${esc(title)}</h4><table class="tbl"><thead><tr><th>${esc(label)}</th><th class="num">Spots</th><th class="num">Spend (LKR)</th><th class="num">Share</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${fmt.num(r.spots)}</td><td class="num">${fmt.num(r.spend)}</td><td class="num"><div class="ex-bar"><i style="width:${Math.min(100, r.spend_share || 0)}%"></i></div>${pct(r.spend_share)}</td></tr>`).join('')}</tbody></table></div>`;

  const clsBadge = (t) => `<span class="badge ${t === 'High-Frequency Reminders' ? 'role-freq' : t === 'Exclusive Sponsorship / Value-Add' ? 'role-title' : t === 'Sponsorship / Value-Add' ? 'role-co' : 'role-reg'}">${esc(t)}</span>`;
  const ads = (n) => `${fmt.num(n)} ad${n === 1 ? '' : 's'}`;
  const sumBy = (rows, k) => rows.reduce((s, r) => s + (r[k] || 0), 0);

  function draw(out, d, ctx) {
    const o = d.overall, rt = o.ratings, L = d.labels;
    const chCols = [['rank', '#'], ['channel', 'Channel'], ['commercial_spend', 'Commercial spend', 1], ['value_add_spend', 'Value-add / sponsorship', 1], ['spend', 'Total monitored', 1], ['commercial_spots', 'Commercial spots', 1], ['value_add_items', 'Sponsorship items', 1], ['spots', 'Total spots', 1], ['sow_pct', 'Share of wallet', 1]].concat(d.has_ratings ? [['grps', 'GRPs', 1]] : []);
    const chTot = { commercial_spend: sumBy(d.channels, 'commercial_spend'), value_add_spend: sumBy(d.channels, 'value_add_spend'), spend: sumBy(d.channels, 'spend'), commercial_spots: sumBy(d.channels, 'commercial_spots'), value_add_items: sumBy(d.channels, 'value_add_items'), spots: sumBy(d.channels, 'spots'), grps: d.channels.reduce((s, c) => s + ((c.ratings && c.ratings.grps) || 0), 0) };
    const shown = d.programmes;
    const pgTot = { value_add_items: sumBy(shown, 'value_add_items'), commercial_spots: sumBy(shown, 'commercial_spots'), spots: sumBy(shown, 'spots'), frequency_spots: sumBy(shown, 'frequency_spots') };
    out.innerHTML = `<div class="card ex-sec"><div class="ex-h"><span class="ex-n">1</span><div><h3>Overall campaign summary</h3><div class="sub">${esc(d.range[0])} to ${esc(d.range[1])}${d.selection.advertisers.length ? ` · ${esc(d.selection.advertisers.slice(0, 4).join(', '))}${d.selection.advertisers.length > 4 ? ' and more' : ''}` : ' · all advertisers'}${d.selection.channels.length ? ` · ${esc(d.selection.channels.map(tt).join(', '))}` : ''}</div></div></div>
        <div class="kpis">${kpi('Active brands', fmt.num(o.brands), `${fmt.num(o.products)} products`)}${kpi('Total monitored spend', `<span title="${fmt.lkr(o.spend)}">${fmt.lkrc(o.spend)}</span>`, `${fmt.num(o.spots)} spots on ${fmt.num(o.channels)} channels`)}
          ${kpi('Commercial only', fmt.lkrc(o.commercial_spend), `${pct(o.commercial_share)} · ${fmt.num(o.commercial_spots)} spots`)}${kpi('Value addition / sponsorship', fmt.lkrc(o.value_add_spend), `${pct(o.value_add_share)} · ${fmt.num(o.value_add_items)} items`)}
          ${kpi('Exclusive sponsorships', fmt.num(o.exclusive_ads), `${fmt.num(o.exclusive_spots)} spots · ${fmt.lkrc(o.exclusive_spend)}`)}${kpi('High-frequency reminders', fmt.num(o.frequency_ads), `${fmt.num(o.frequency_spots)} spots`)}
          ${rt ? kpi('GRPs delivered', fmt.num(rt.grps, 1), `CPRP ${rt.cprp ? fmt.lkr(rt.cprp) : 'n/a'} · ${pct(rt.rated_pct)} of spots rated`) : ''}</div>
        <div class="ex-minis">${splitTable('Duration split', d.durations, 'Length')}${splitTable('Language split', d.languages, 'Language')}${splitTable('Medium split', d.media, 'Medium')}${splitTable('Top brands', d.brands.slice(0, 8), 'Advertiser')}</div>
        <div class="muted small" style="margin-top:6px">Commercial = regular and special spots. Value addition = sponsorship items. Medium is worked out from the channel name (FM or Radio = Radio, otherwise TV).${d.has_ratings ? '' : ' Load the TVR sheet to add GRPs and ratings.'}</div></div>
      <div class="card ex-sec" style="margin-top:16px"><div class="ex-h"><span class="ex-n">2</span><div><h3>TV channel-wise breakdown</h3><div class="sub">Ranked by total monitored spend, highest first. Share of wallet = the channel's share of all monitored spend in this selection. Click a row for details.</div></div></div>
        <div class="tbl-scroll"><table class="tbl ex-tbl" id="ex-ch"><thead><tr>${chCols.map(([, l, n]) => `<th class="${n ? 'num' : ''}">${l}</th>`).join('')}</tr></thead><tbody>
          ${d.channels.map((c, k) => `<tr class="ex-row ${k % 2 ? 'ex-z' : ''}" tabindex="0" data-i="${k}" aria-expanded="false"><td>${c.rank}</td><td><b>${esc(tt(c.channel))}</b> <span class="muted small">${esc(c.medium)}</span></td><td class="num">${fmt.num(c.commercial_spend)}</td><td class="num">${fmt.num(c.value_add_spend)}</td>
            <td class="num"><b>${fmt.num(c.spend)}</b></td><td class="num">${fmt.num(c.commercial_spots)}</td><td class="num">${fmt.num(c.value_add_items)}</td><td class="num">${fmt.num(c.spots)}</td><td class="num"><div class="ex-bar"><i style="width:${Math.min(100, c.sow_pct || 0)}%"></i></div>${pct(c.sow_pct)}</td>${d.has_ratings ? `<td class="num">${c.ratings ? fmt.num(c.ratings.grps, 1) : 'n/a'}</td>` : ''}</tr>`).join('')}</tbody>
          <tfoot><tr class="ex-tot"><td></td><td>Total</td><td class="num">${fmt.num(chTot.commercial_spend)}</td><td class="num">${fmt.num(chTot.value_add_spend)}</td><td class="num">${fmt.num(chTot.spend)}</td><td class="num">${fmt.num(chTot.commercial_spots)}</td><td class="num">${fmt.num(chTot.value_add_items)}</td><td class="num">${fmt.num(chTot.spots)}</td><td class="num">100%</td>${d.has_ratings ? `<td class="num">${fmt.num(chTot.grps, 1)}</td>` : ''}</tr></tfoot></table></div></div>
      <div class="card ex-sec" style="margin-top:16px"><div class="ex-h"><span class="ex-n">3</span><div><h3>Programmes &amp; sponsorship intelligence</h3><div class="sub">${fmt.num(d.n_programmes)} programmes, ${fmt.num(d.sponsored_programmes)} with sponsorship. Programmes with an exclusive sponsorship come first. Click a row to see the high-frequency spots and the logo, intro and outro sponsorships behind it.</div></div></div>
        <div class="ex-rules small"><span>${clsBadge(L.exclusive)} a sponsorship item (logo, intro, outro, billboard, tag, time check) on at least ${d.rule.consistent_share}% of the programme's airing days (and ${d.rule.consistent_days}+ days).</span>
          <span>${clsBadge(L.frequency)} the same ad averaged more than ${d.rule.min_daily} spots a day in the programme, or ${d.rule.max_dur}s or shorter at ${d.rule.min_daily}+ a day.</span></div>
        <div class="tbl-scroll" style="max-height:640px"><table class="tbl ex-tbl" id="ex-pg"><thead><tr><th>Channel</th><th>Programme</th><th>Classification</th><th>Sponsors (spots)</th><th class="num">Sponsorship items</th><th class="num">High-frequency spots</th><th class="num">Commercial spots</th><th class="num">Total spots</th><th class="num">Airing days</th><th class="num">Spots per airing</th></tr></thead><tbody>
          ${shown.map((r, k) => `<tr class="ex-row ${k % 2 ? 'ex-z' : ''}" tabindex="0" data-i="${k}" aria-expanded="false"><td>${esc(tt(r.channel))}</td><td><b>${esc(tt(r.program))}</b></td>
            <td>${r.exclusive_ads ? clsBadge(L.exclusive) : r.sponsored ? clsBadge(L.sponsorship) : ''} ${r.frequency_ads ? clsBadge(L.frequency) : ''}${!r.sponsored && !r.frequency_ads ? '<span class="badge role-reg">Spots only</span>' : ''}</td>
            <td class="small">${r.sponsors.slice(0, 3).map((x) => `${esc(x.advertiser)} (${fmt.num(x.items)})`).join(', ')}${r.sponsors.length > 3 ? ` +${r.sponsors.length - 3} more` : ''}</td><td class="num">${fmt.num(r.value_add_items)}</td><td class="num">${r.frequency_spots ? `<b class="sp-freq">${fmt.num(r.frequency_spots)}</b>` : '0'}</td><td class="num">${fmt.num(r.commercial_spots)}</td><td class="num"><b>${fmt.num(r.spots)}</b></td>
            <td class="num">${fmt.num(r.airing_days)}</td><td class="num">${fmt.num(r.spots_per_airing, 1)}</td></tr>`).join('')}</tbody>
          <tfoot><tr class="ex-tot"><td colspan="4">Total${d.n_programmes > shown.length ? ` (the ${shown.length} programmes shown)` : ''}</td><td class="num">${fmt.num(pgTot.value_add_items)}</td><td class="num">${fmt.num(pgTot.frequency_spots)}</td><td class="num">${fmt.num(pgTot.commercial_spots)}</td><td class="num">${fmt.num(pgTot.spots)}</td><td></td><td></td></tr></tfoot></table></div>
        ${d.n_programmes > d.programmes.length ? `<div class="muted small" style="margin-top:6px">Showing ${d.programmes.length} of ${d.n_programmes} programmes. Narrow by channel or advertiser for the rest.</div>` : ''}</div>`;
    wire(out.querySelector('#ex-ch'), (k) => ({ channel: d.channels[k].channel }), ctx, chCols.length);
    wire(out.querySelector('#ex-pg'), (k) => ({ channel: d.programmes[k].channel, program: d.programmes[k].program }), ctx, 10);
  }

  function wire(tbl, keyOf, ctx, span) {
    const tb = tbl.querySelector('tbody');
    const toggle = (tr) => {
      const nx = tr.nextElementSibling;
      if (nx && nx.classList.contains('ex-exp')) { nx.remove(); tr.setAttribute('aria-expanded', 'false'); return; }
      tr.setAttribute('aria-expanded', 'true');
      const ex = document.createElement('tr'); ex.className = 'ex-exp'; ex.innerHTML = `<td colspan="${span}"><div class="ex-detail">${App.skeleton(1)}</div></td>`; tr.after(ex);
      const key = keyOf(+tr.dataset.i);
      App.data.executiveDetail({ filters: ctx.filters(), options: opts(ctx, key) }).then((x) => { ex.querySelector('.ex-detail').innerHTML = x.empty ? App.emptyState('No spots here') : detailHtml(x, key); })
        .catch((e) => { ex.querySelector('.ex-detail').innerHTML = App.emptyState('Could not open this row', e.message); });
    };
    tb.onclick = (e) => { const tr = e.target.closest('tr.ex-row'); if (tr) toggle(tr); };
    tb.onkeydown = (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr.ex-row')) { e.preventDefault(); toggle(e.target); } };
  }

  /* ---------------- drill-down ---------------- */
  const DURS = ['5s', '10s', '15s', '20s', '30s', '30s+'];
  const durText = (sp) => DURS.filter((k) => sp[k]).map((k) => `${k} ${fmt.num(sp[k])}`).join(', ') || 'n/a';
  const placeText = (p) => `${fmt.num(p.first)} first · ${fmt.num(p.middle)} middle · ${fmt.num(p.last)} last`;
  function detailHtml(x, key) {
    const c = x.commercial, v = x.volume, s = x.sponsorship, k = x.classification, rt = v.ratings;
    const kv = (rows) => `<div class="dt-kpis">${rows.map(([l, val]) => `<div class="dt-k"><span>${esc(l)}</span><b>${val}</b></div>`).join('')}</div>`;
    const mini = (head, rows) => (rows.length ? `<table class="tbl ex-dt"><thead><tr>${head.map((h, i) => `<th class="${i ? 'num' : ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((v2, i) => `<td class="${i ? 'num' : ''}">${v2}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '<div class="muted small">None.</div>');
    const where = key.program ? `${tt(key.program)} on ${tt(key.channel)}` : tt(key.channel);
    const cls = x.classified;
    return `<div class="ex-dh">${esc(where)} · ${esc(v.first_seen)} to ${esc(v.last_seen)}</div>
      <div class="ex-cls"><h4>High-frequency spots vs logo, intro and outro sponsorships</h4>
        <div class="ex-cls-sum"><span>${clsBadge('Exclusive Sponsorship / Value-Add')} <b>${ads(k.exclusive_ads)}</b> · ${fmt.num(k.exclusive_spots)} spots</span><span>${clsBadge('Sponsorship / Value-Add')} <b>${ads(k.sponsorship_ads)}</b> · ${fmt.num(k.sponsorship_spots)} spots</span><span>${clsBadge('High-Frequency Reminders')} <b>${ads(k.frequency_ads)}</b> · ${fmt.num(k.frequency_spots)} spots</span></div>
        ${cls.length ? `<div class="tbl-scroll" style="max-height:360px"><table class="tbl ex-dt"><thead><tr><th>Classification</th><th>Advertiser · theme</th><th class="num">Spots</th><th class="num">Days present</th><th class="num">Daily avg</th><th>Durations</th><th>Placements in break</th><th class="num">Spend</th></tr></thead><tbody>
          ${cls.map((r, i) => `<tr class="${i % 2 ? 'ex-z' : ''}"><td>${r.types.map(clsBadge).join(' ')}</td><td>${esc(r.advertiser)}<div class="muted small">${esc(r.theme)} · ${esc(r.item)}${key.program ? '' : ` · ${esc(tt(r.program))}`}</div></td><td class="num"><b>${fmt.num(r.spots)}</b></td>
            <td class="num">${fmt.num(r.days)} of ${fmt.num(r.airings)}<div class="muted small">${pct(r.presence_pct)}</div></td><td class="num ${r.frequency ? 'sp-freq' : ''}"><b>${dec(r.daily_avg)}</b></td><td class="small">${esc(durText(r.dur_split))}</td><td class="small">${esc(placeText(r.placement))}</td><td class="num">${fmt.num(r.spend)}</td></tr>`).join('')}</tbody></table></div>`
        : '<div class="muted small">No sponsorship items or high-frequency ads here.</div>'}</div>
      <div class="ex-dgrid">
      <div class="ex-dcard"><h4>Commercial details</h4>${kv([['Commercial spots', fmt.num(c.spots)], ['Commercial spend', fmt.num(c.spend)], ['Special placements', fmt.num(c.special_spots)]])}
        <div class="sf-d-h" style="margin-top:8px">Duration split</div>${mini(['Length', 'Spots', 'Spend', 'Share'], c.by_duration.map((r) => [esc(r.name), fmt.num(r.spots), fmt.num(r.spend), pct(r.spot_share)]))}
        <div class="sf-d-h" style="margin-top:8px">By daypart</div>${mini(['Daypart', 'Spots', 'Spend'], c.by_daypart.slice(0, 6).map((r) => [esc(r.name), fmt.num(r.spots), fmt.num(r.spend)]))}</div>
      <div class="ex-dcard"><h4>Ratings &amp; volume</h4>${kv([['GRPs', rt ? fmt.num(rt.grps, 1) : 'Load TVR sheet'], ['Avg spot rating', rt && rt.avg_spot_rating != null ? fmt.num(rt.avg_spot_rating, 2) : 'n/a'], ['CPRP', rt && rt.cprp ? fmt.num(rt.cprp) : 'n/a'], ['Spots rated', rt ? pct(rt.rated_pct) : 'n/a'],
        ['Total spots', fmt.num(v.spots)], ['Active days', fmt.num(v.active_days)], ['Spots per day', dec(v.spots_per_day)], ['Busiest day', v.peak_day ? `${v.peak_day.date} (${v.peak_day.spots})` : 'n/a'],
        ['Avg ads in break', dec(v.avg_clutter)], ['First in break', pct(v.fib_pct)], ['First or last', pct(v.bumper_pct)], ['Avg length', v.avg_dur ? fmt.num(v.avg_dur, 0) + 's' : 'n/a']])}</div>
      <div class="ex-dcard"><h4>Sponsorship details</h4>${kv([['Sponsorship items', fmt.num(s.items)], ['Billboards, intro, outro', fmt.num(s.billboards)], ['Logos and tags', fmt.num(s.logos)], ['Sponsorship spend', fmt.num(s.spend)]])}
        <div class="sf-d-h" style="margin-top:8px">Top commercial advertisers</div>${mini(['Advertiser', 'Spots', 'Spend'], c.by_advertiser.slice(0, 6).map((r) => [esc(r.name), fmt.num(r.spots), fmt.num(r.spend)]))}</div></div>`;
  }

  async function pdf(p, ctx) {
    const b = p.querySelector('#ex-pdf');
    if (!last || last.empty) { App.toast('Nothing to export: no spots match this selection.', 'error'); return; }
    b.disabled = true; const txt = b.textContent; b.textContent = 'Building PDF...';
    try {
      const full = await App.data.executiveSummary({ filters: ctx.filters(), options: opts(ctx, { details: true, max_detail_channels: 10, max_detail_programmes: 12 }) });
      const chips = ((ctx.meta && ctx.meta.chips) || []).map((c) => `${c.label}: ${c.value}`), ds = (ctx.body && ctx.body().dataset) || '';
      const res = await App.api.blob('/api/executive/pdf', { summary: full, meta: { dataset: ds, filters: chips } });
      App.download(res.blob, res.name); App.toast('Executive summary downloaded. A copy is kept under Reports.', 'ok');
    } catch (e) { App.toast('The PDF could not be built: ' + e.message, 'error'); } finally { b.disabled = false; b.textContent = txt; }
  }

  App.executive = { tab };
})(window.App);
