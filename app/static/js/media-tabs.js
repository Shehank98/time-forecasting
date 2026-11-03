/* TV, radio and press together: "Spend by year (Com and VAL)" and "Press & contracts" tabs (LMRB workspace). */
(function (App) {
  const { esc, fmt, charts: C } = App;
  const kpi = (l, v, s) => `<div class="kpi"><div class="k-lbl">${esc(l)}</div><div class="k-val">${v}</div>${s ? `<div class="k-sub">${s}</div>` : ''}</div>`;
  const pct = (v) => (v == null ? 'n/a' : fmt.num(v, v < 10 ? 1 : 0) + '%');
  const n0 = (v) => (v ? fmt.num(v) : '-');
  const tt = (s) => fmt.title(String(s || ''));
  const dshort = (iso) => { if (!iso) return 'n/a'; const d = new Date(String(iso).slice(0, 10) + 'T00:00:00Z'); return Number.isNaN(d.getTime()) ? 'n/a' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); };
  const load = (k, dflt) => { try { return Object.assign({}, dflt, App.store.get(k, null) || {}); } catch (e) { return { ...dflt }; } };
  const save = (k, v) => { try { App.store.set(k, v); } catch (e) { /* storage blocked */ } };
  const ORDER = ['TV', 'Radio', 'Press'];
  const MEDIUM_NOTE = 'Medium comes from the channel name: "TV - ..." is TV, "Radio - ..." is radio, a name with neither prefix is counted as press. The press sheet is press.';

  function loadXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise((ok, no) => { const s = document.createElement('script'); s.src = '/js/vendor/xlsx.full.min.js'; s.onload = () => ok(window.XLSX); s.onerror = () => no(new Error('The Excel library could not load.')); document.head.appendChild(s); });
  }

  /* ======================================================================================= Spend by year */
  const sy = load('media:spend', { years_sel: null, adv: [] });
  let syLast = null;

  function spendTab(p, ctx) {
    p.innerHTML = `<div class="card"><div class="card-head"><div><h3>Spend by year: Commercial only and VAL</h3><div class="sub">One block per year: channels down the side, months across, spend in LKR. TV, radio and press together. Commercial only and VAL (value addition = sponsorship items) are shown apart, then added together.</div></div>
        <button class="btn primary" type="button" id="sy-xlsx">Download Excel (one sheet per year)</button></div>
      <div class="sy-bar"><div data-ms="sy_adv"></div><div class="field"><label>Year</label><div class="seg" id="sy-years"></div></div></div>
      <div class="muted small" style="margin-top:6px">${esc(MEDIUM_NOTE)} This page does not use the filters at the top: pick advertisers here.</div><div id="sy-warn"></div></div><div id="sy-out" style="margin-top:16px">${App.skeleton(3)}</div>`;
    let seq = 0, adList = null;
    const again = App.debounce(() => { save('media:spend', sy); run(); }, 250);
    async function run() {
      const my = ++seq, out = p.querySelector('#sy-out'); if (!out) return;
      out.innerHTML = App.skeleton(3);
      let d;
      try {
        if (!adList) adList = (await App.data.mediaOptions({})).advertisers;
        d = await App.data.mediaSpend({ options: { advertisers: sy.adv } });
      } catch (e) { out.innerHTML = App.emptyState('The spend sheets could not be built', e.message); return; }
      if (my !== seq || !out.isConnected) return;
      syLast = d;
      const slot = p.querySelector('[data-ms="sy_adv"]'); if (slot && !slot.dataset.built) { const m = App.filters.multi({ key: 'adv', label: 'Advertiser (leave on All for everything)' }, adList, sy, again); m.dataset.ms = 'sy_adv'; m.dataset.built = '1'; slot.replaceWith(m); }
      const warn = [];
      if (d.no_medium) warn.push('This LMRB sheet was loaded before TV and radio were split. Upload it again to separate TV from radio; for now every channel is shown as TV.');
      if (d.unprefixed.length) warn.push(`${d.unprefixed.length} channel${d.unprefixed.length === 1 ? ' has' : 's have'} no "TV - " or "Radio - " prefix and ${d.unprefixed.length === 1 ? 'is' : 'are'} counted as press: ${d.unprefixed.slice(0, 8).map((x) => esc(x.name)).join(', ')}${d.unprefixed.length > 8 ? ' and more' : ''}. If any of these are TV or radio, add the prefix in the sheet.`);
      if (!d.has_press) warn.push('No press sheet is loaded, so press shows only channels named as press in the LMRB sheet. Upload the press sheet in Data sources above to add newspapers and magazines.');
      p.querySelector('#sy-warn').innerHTML = warn.map((w) => `<div class="banner"><span>${w}</span></div>`).join('');
      if (d.empty) { out.innerHTML = App.emptyState('No spend for this choice', 'Pick other advertisers, or clear the advertiser list.'); p.querySelector('#sy-years').innerHTML = ''; return; }
      const years = d.years.map((y) => y.year);
      if (!years.includes(sy.year)) sy.year = years[years.length - 1];
      const seg = p.querySelector('#sy-years');
      seg.innerHTML = years.map((y) => `<button type="button" data-y="${y}" aria-pressed="${y === sy.year}">${y}</button>`).join('');
      seg.querySelectorAll('button').forEach((b) => { b.onclick = () => { sy.year = +b.dataset.y; save('media:spend', sy); seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); draw(out, d); }; });
      draw(out, d);
    }
    p.querySelector('#sy-xlsx').onclick = () => exportSpend(syLast);
    const onData = () => { if (p.isConnected) run(); }; document.addEventListener('datachange', onData);
    run();
  }

  function blockHtml(title, sub, b, months, id) {
    if (!b.rows.length) return `<div class="card sy-card"><h3>${esc(title)}</h3><div class="sub">${esc(sub)}</div><div class="muted" style="padding:10px 2px">No spend in this block this year.</div></div>`;
    const head = `<tr><th>Medium</th><th>Channel</th>${months.map((m) => `<th class="num">${m}</th>`).join('')}<th class="num">Total</th></tr>`;
    let k = 0;
    const body = ORDER.map((m) => {
      const rows = b.rows.filter((r) => r.medium === m); if (!rows.length) return '';
      const med = b.media.find((x) => x.medium === m);
      return rows.map((r) => `<tr class="${k++ % 2 ? 'ex-z' : ''}"><td class="muted">${esc(m)}</td><td><b>${esc(tt(r.name))}</b></td>${r.months.map((v) => `<td class="num">${n0(v)}</td>`).join('')}<td class="num"><b>${fmt.num(r.total)}</b></td></tr>`).join('')
        + `<tr class="sy-sub"><td colspan="2">${esc(m)} total</td>${med.months.map((v) => `<td class="num">${n0(v)}</td>`).join('')}<td class="num">${fmt.num(med.total)}</td></tr>`;
    }).join('');
    return `<div class="card sy-card"><div class="card-head"><div><h3>${esc(title)}</h3><div class="sub">${esc(sub)}</div></div></div><div class="tbl-scroll sy-scroll"><table class="tbl ex-tbl sy-tbl" id="${id}"><thead>${head}</thead><tbody>${body}</tbody>
      <tfoot><tr class="ex-tot"><td colspan="2">All channels</td>${b.grand.months.map((v) => `<td class="num">${n0(v)}</td>`).join('')}<td class="num">${fmt.num(b.grand.total)}</td></tr></tfoot></table></div></div>`;
  }
  function draw(out, d) {
    const y = d.years.find((x) => x.year === sy.year) || d.years[d.years.length - 1];
    const c = y.commercial, v = y.value_add, t = y.total, med = (b, m) => b.media.find((x) => x.medium === m);
    out.innerHTML = `<div class="kpis">${kpi(`Total spend ${y.year}`, `<span title="${fmt.lkr(t.grand.total)}">${fmt.lkrc(t.grand.total)}</span>`, `Commercial ${pct(t.grand.total ? (c.grand.total / t.grand.total) * 100 : null)} · VAL ${pct(t.grand.total ? (v.grand.total / t.grand.total) * 100 : null)}`)}
        ${kpi('Commercial only', fmt.lkrc(c.grand.total), `${fmt.num(c.rows.length)} channels`)}${kpi('VAL (value addition)', fmt.lkrc(v.grand.total), `${fmt.num(v.rows.length)} channels`)}
        ${ORDER.map((m) => kpi(m, fmt.lkrc(med(t, m).total), `Com ${fmt.lkrc(med(c, m).total)} · VAL ${fmt.lkrc(med(v, m).total)}`)).join('')}</div>
      <div style="margin-top:16px">${blockHtml(`Commercial only spend ${y.year} (LKR)`, 'Ordinary paid spots and press ads. Channels grouped as TV, then radio, then press, biggest first.', c, d.months, 'sy-com')}</div>
      <div style="margin-top:16px">${blockHtml(`VAL (value addition) spend ${y.year} (LKR)`, `Sponsorship items counted: ${d.items_counted.join(', ') || 'none'}. Press is all commercial.`, v, d.months, 'sy-val')}</div>
      <div style="margin-top:16px">${blockHtml(`Total spend ${y.year} (LKR): commercial only plus VAL`, 'The two blocks added together.', t, d.months, 'sy-tot')}</div>`;
  }

  /** One sheet per year (Commercial only, VAL, Total blocks), plus a Summary sheet. */
  async function exportSpend(d) {
    if (!d || d.empty) { App.toast('Nothing to export: no spend for this choice.', 'error'); return; }
    try {
      const X = await loadXlsx(), wb = X.utils.book_new(), M = d.months;
      const fmtCells = (ws, r0, r1, c0, c1) => { for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { const a = ws[X.utils.encode_cell({ r, c })]; if (a && a.t === 'n') a.z = '#,##0'; } };
      const sum = [['Spend by year, all channels (LKR)'], ['Advertisers', d.advertisers.length ? d.advertisers.join(', ') : 'All'], ['Sponsorship items counted as VAL', d.items_counted.join(', ') || 'none'], [],
        ['Year', 'Medium', 'Commercial only', 'VAL (value addition)', 'Total']];
      d.years.forEach((y) => ORDER.forEach((m) => { const c = y.commercial.media.find((x) => x.medium === m).total, v = y.value_add.media.find((x) => x.medium === m).total; if (c || v) sum.push([y.year, m, Math.round(c), Math.round(v), Math.round(c + v)]); }));
      d.years.forEach((y) => sum.push([y.year, 'All media', Math.round(y.commercial.grand.total), Math.round(y.value_add.grand.total), Math.round(y.total.grand.total)]));
      const ws0 = X.utils.aoa_to_sheet(sum); ws0['!cols'] = [{ wch: 8 }, { wch: 14 }, { wch: 18 }, { wch: 20 }, { wch: 16 }]; fmtCells(ws0, 5, sum.length, 2, 4); X.utils.book_append_sheet(wb, ws0, 'Summary');
      d.years.forEach((y) => {
        const aoa = [[`Spend ${y.year}: TV, radio and press (LKR)`], [`Advertisers: ${d.advertisers.length ? d.advertisers.join(', ') : 'All'}`], []];
        const marks = [];
        [['Commercial only spend', y.commercial], ['VAL (value addition) spend', y.value_add], ['Total spend (commercial only + VAL)', y.total]].forEach(([title, b]) => {
          aoa.push([title]); marks.push(aoa.length - 1); aoa.push(['Medium', 'Channel', ...M, 'Total']);
          ORDER.forEach((m) => { const rows = b.rows.filter((r) => r.medium === m); if (!rows.length) return;
            rows.forEach((r) => aoa.push([m, tt(r.name), ...r.months.map(Math.round), Math.round(r.total)]));
            const md = b.media.find((x) => x.medium === m); aoa.push([`${m} total`, '', ...md.months.map(Math.round), Math.round(md.total)]); });
          aoa.push(['All channels', '', ...b.grand.months.map(Math.round), Math.round(b.grand.total)]); aoa.push([]);
        });
        const ws = X.utils.aoa_to_sheet(aoa); ws['!cols'] = [{ wch: 14 }, { wch: 26 }, ...M.map(() => ({ wch: 12 })), { wch: 15 }]; fmtCells(ws, 3, aoa.length, 2, 14);
        X.utils.book_append_sheet(wb, ws, String(y.year));
      });
      const buf = X.write(wb, { bookType: 'xlsx', type: 'array' });
      App.download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `spend_by_year_${d.years[0].year}_${d.years[d.years.length - 1].year}.xlsx`);
    } catch (e) { App.toast('Excel export failed: ' + e.message, 'error'); }
  }

  /* ======================================================================================= Press and contracts */
  const pr = load('media:press', { adv: [], pub: [], from: '', to: '', min: 4 });
  let prLast = null;

  function pressTab(p, ctx) {
    p.innerHTML = `<div class="card"><div class="card-head"><div><h3>Press &amp; contracts</h3><div class="sub">Newspapers and magazines from the press sheet. A contract is the same advertiser and product in the same paper at the same size, on the same weekday, again and again.</div></div>
        <button class="btn primary" type="button" id="pr-pdf">Download Press &amp; Contracts PDF</button></div>
      <div class="pr-bar"><div data-ms="pr_adv"></div><div data-ms="pr_pub"></div><div class="field"><label for="pr-from">From</label><input id="pr-from" type="date" value="${esc(pr.from)}"></div><div class="field"><label for="pr-to">To</label><input id="pr-to" type="date" value="${esc(pr.to)}"></div>
        <div class="field"><label for="pr-min">Contract = at least</label><select id="pr-min">${[3, 4, 6, 8, 12].map((n) => `<option value="${n}" ${n === +pr.min ? 'selected' : ''}>${n} insertions</option>`).join('')}</select></div></div></div>
      <div id="pr-out" style="margin-top:16px">${App.skeleton(3)}</div>`;
    let seq = 0, built = false;
    const again = App.debounce(() => { save('media:press', pr); run(); }, 250);
    const opts = () => ({ advertisers: pr.adv, publications: pr.pub, date_from: pr.from || null, date_to: pr.to || null, min_times: +pr.min || 4 });
    async function run() {
      const my = ++seq, out = p.querySelector('#pr-out'); if (!out) return;
      out.innerHTML = App.skeleton(3);
      let s, c;
      try { [s, c] = await Promise.all([App.data.pressSummary({ options: opts() }), App.data.pressContracts({ options: opts() })]); } catch (e) { out.innerHTML = App.emptyState('The press view could not be built', e.message); return; }
      if (my !== seq || !out.isConnected) return;
      prLast = { summary: s, contracts: c };
      const o = (s.options && s.options.advertiser) ? s.options : c.options || {};
      if (!built && o.advertiser) {
        built = true;
        const a = App.filters.multi({ key: 'adv', label: 'Advertiser' }, o.advertiser, pr, again), b = App.filters.multi({ key: 'pub', label: 'Publication' }, o.publication, pr, again);
        a.dataset.ms = 'pr_adv'; b.dataset.ms = 'pr_pub'; p.querySelector('[data-ms="pr_adv"]').replaceWith(a); p.querySelector('[data-ms="pr_pub"]').replaceWith(b);
        ['#pr-from', '#pr-to'].forEach((q) => { const i = p.querySelector(q); i.min = o.date_min || ''; i.max = o.date_max || ''; });
      }
      if (s.empty) { out.innerHTML = App.emptyState('No press ads for this choice', 'Widen the dates or clear an advertiser or publication.'); return; }
      drawPress(out, s, c);
    }
    p.querySelector('#pr-from').onchange = (e) => { pr.from = e.target.value; again(); };
    p.querySelector('#pr-to').onchange = (e) => { pr.to = e.target.value; again(); };
    p.querySelector('#pr-min').onchange = (e) => { pr.min = +e.target.value; again(); };
    p.querySelector('#pr-pdf').onclick = () => pressPdf(p, ctx);
    const onData = () => { if (p.isConnected) run(); }; document.addEventListener('datachange', onData);
    run();
  }

  const sizeText = (c) => `${fmt.num(c.cm, c.cm % 1 ? 1 : 0)} cm x ${fmt.num(c.col, c.col % 1 ? 1 : 0)} col`;
  function drawPress(out, s, c) {
    const t = s.totals, ct = c.totals;
    out.innerHTML = `<div class="kpis">${kpi('Press spend', `<span title="${fmt.lkr(t.spend)}">${fmt.lkrc(t.spend)}</span>`, `${s.period[0]} to ${s.period[1]}`)}${kpi('Insertions', fmt.num(t.insertions), `${fmt.num(t.publications)} publications · ${fmt.num(t.advertisers)} advertisers`)}
        ${kpi('Space bought', `${fmt.num(t.area)} <small>col-cm</small>`, t.rate ? `LKR ${fmt.num(t.rate)} per col-cm` : '')}${kpi('Contracts', fmt.num(ct.contracts), `${fmt.num(ct.active)} still active`)}
        ${kpi('Spend on contracts', fmt.lkrc(ct.contract_spend), `${pct(ct.contract_share_pct)} of press spend · ${fmt.num(ct.insertions)} insertions`)}${kpi('Ad hoc ads', fmt.lkrc(ct.adhoc_spend), `${fmt.num(ct.adhoc_insertions)} insertions outside a contract`)}</div>
      <div class="card" style="margin-top:16px"><div class="card-head"><div><h3>Contracts</h3><div class="sub">${esc(c.rule)} A weekly contract may miss one week and still count. Click a row to see every date.</div></div></div>
        ${c.contracts.length ? `<div class="tbl-scroll" style="max-height:620px"><table class="tbl ex-tbl" id="pr-ct"><thead><tr><th>Advertiser</th><th>Product</th><th>Publication</th><th>Size</th><th>Runs on</th><th class="num">Times</th><th>First</th><th>Last</th><th class="num">Missed</th><th class="num">Avg cost</th><th class="num">Total cost</th><th>Status</th></tr></thead><tbody>
          ${c.contracts.map((x, i) => `<tr class="ex-row ${i % 2 ? 'ex-z' : ''}" tabindex="0" data-i="${i}"><td><b>${esc(x.advertiser)}</b></td><td>${esc(x.product)}</td><td>${esc(tt(x.publication))}<div class="muted small">${esc(x.periodicity)} · ${esc(x.language)}</div></td><td>${esc(sizeText(x))}<div class="muted small">${fmt.num(x.area)} col-cm</div></td><td><b>${esc(x.weekday)}</b></td>
            <td class="num"><b>${fmt.num(x.times)}</b>${x.insertions !== x.times ? `<div class="muted small">${fmt.num(x.insertions)} ads</div>` : ''}</td><td class="small">${esc(dshort(x.first))}</td><td class="small">${esc(dshort(x.last))}</td><td class="num">${fmt.num(x.missed)}</td><td class="num">${fmt.num(x.avg_cost)}${x.steady_rate ? '<div class="muted small">same rate</div>' : ''}</td><td class="num"><b>${fmt.num(x.total_cost)}</b></td>
            <td><span class="badge ${x.status === 'Active' ? 'good' : ''}">${esc(x.status)}</span></td></tr>`).join('')}</tbody>
          <tfoot><tr class="ex-tot"><td colspan="5">Total (${fmt.num(c.contracts.length)} contracts)</td><td class="num">${fmt.num(c.contracts.reduce((a, x) => a + x.times, 0))}</td><td colspan="3"></td><td class="num"></td><td class="num">${fmt.num(c.contracts.reduce((a, x) => a + x.total_cost, 0))}</td><td></td></tr></tfoot></table></div>`
          : App.emptyState('No contracts found', `Nothing in this selection repeats ${c.min_times} or more times at the same size on the same weekday. Try a lower number of insertions.`)}</div>
      <div class="grid g2" style="margin-top:16px"><div class="card"><h3>Spend by publication</h3>${rankTable(s.publications, 'Publication')}</div><div class="card"><h3>Spend by advertiser</h3>${rankTable(s.advertisers, 'Advertiser')}</div></div>
      <div style="margin-top:16px">${C.box('pr-month', 'Press spend by month', 'Total press spend in each month. Click a bar.', { tall: true })}</div>`;
    const tb = out.querySelector('#pr-ct tbody');
    if (tb) {
      const toggle = (tr) => {
        const nx = tr.nextElementSibling; if (nx && nx.classList.contains('ex-exp')) { nx.remove(); return; }
        const x = c.contracts[+tr.dataset.i], ex = document.createElement('tr'); ex.className = 'ex-exp';
        ex.innerHTML = `<td colspan="12"><div class="ex-dh">${esc(x.advertiser)} · ${esc(x.product)} · ${esc(tt(x.publication))} · ${esc(sizeText(x))} · ${esc(x.weekday)}</div><div class="pr-dates">${x.dates.map((d) => `<span class="chip">${esc(dshort(d.date))} · ${fmt.num(d.cost)}</span>`).join(' ')}${x.insertions > x.dates.length ? ` <span class="muted small">+${x.insertions - x.dates.length} more</span>` : ''}</div></td>`;
        tr.after(ex);
      };
      tb.onclick = (e) => { const tr = e.target.closest('tr.ex-row'); if (tr) toggle(tr); };
      tb.onkeydown = (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr.ex-row')) { e.preventDefault(); toggle(e.target); } };
    }
    const mo = s.months;
    C.bar({ id: 'pr-month', labels: mo.map((m) => m.month), valueFmt: fmt.compact, legend: false, datasets: [{ label: 'Press spend', data: mo.map((m) => m.spend), backgroundColor: C.PALETTE[0] }] });
  }
  function rankTable(rows, label) {
    return `<div class="tbl-scroll" style="max-height:360px"><table class="tbl ex-tbl"><thead><tr><th>${esc(label)}</th><th class="num">Insertions</th><th class="num">Col-cm</th><th class="num">Spend (LKR)</th><th class="num">Share</th></tr></thead><tbody>
      ${rows.slice(0, 20).map((r, i) => `<tr class="${i % 2 ? 'ex-z' : ''}"><td>${esc(tt(r.name))}</td><td class="num">${fmt.num(r.insertions)}</td><td class="num">${fmt.num(r.area)}</td><td class="num">${fmt.num(r.spend)}</td><td class="num">${pct(r.share_pct)}</td></tr>`).join('')}</tbody>
      <tfoot><tr class="ex-tot"><td>Total</td><td class="num">${fmt.num(rows.reduce((a, r) => a + r.insertions, 0))}</td><td class="num">${fmt.num(rows.reduce((a, r) => a + r.area, 0))}</td><td class="num">${fmt.num(rows.reduce((a, r) => a + r.spend, 0))}</td><td></td></tr></tfoot></table></div>`;
  }

  async function pressPdf(p, ctx) {
    const b = p.querySelector('#pr-pdf');
    if (!prLast || prLast.summary.empty) { App.toast('Nothing to export: no press ads for this choice.', 'error'); return; }
    b.disabled = true; const txt = b.textContent; b.textContent = 'Building PDF...';
    try {
      const ds = (ctx.dataset && ctx.dataset()) || '';
      const res = await App.api.blob('/api/press/pdf', { summary: prLast.summary, contracts: prLast.contracts, meta: { dataset: ds, advertisers: pr.adv, publications: pr.pub, date_from: pr.from, date_to: pr.to } });
      App.download(res.blob, res.name); App.toast('Press and contracts report downloaded. A copy is kept under Reports.', 'ok');
    } catch (e) { App.toast('The PDF could not be built: ' + e.message, 'error'); } finally { b.disabled = false; b.textContent = txt; }
  }

  App.mediaTabs = { spendTab, pressTab };
})(window.App);
