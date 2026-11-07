/* Client Pitch Evaluator page (TV only): four inputs, filters, and eight tabs. All numbers come from MR.pitchBuild in the data worker. */
(function (App) {
  const { esc, fmt, $, $$ } = App;
  const C = () => App.charts;
  const n0 = (v) => (v == null || !Number.isFinite(v) ? 'n/a' : fmt.num(v));
  const n1 = (v) => (v == null || !Number.isFinite(v) ? 'n/a' : fmt.num(v, 1));
  const n2 = (v) => (v == null || !Number.isFinite(v) ? 'n/a' : fmt.num(v, 2));
  const pc = (v) => (v == null || !Number.isFinite(v) ? 'n/a' : fmt.num(v, 1) + '%');
  const xr = (v) => (v == null || !Number.isFinite(v) ? 'n/a' : fmt.num(v, 2) + 'x');
  const tt = (s) => fmt.title(String(s || ''));
  const GLOSS = {
    TVR: ['TV rating: the % of the target audience watching an average minute of the programme.', 'Higher TVR means more people see your spot.'],
    GRP: ['Gross rating points: TVR added up over every spot you buy (TVR x spots).', 'The size of the campaign in audience terms.'],
    NGRP: ['GRPs after turning every spot into a 30 second equivalent (a 15 sec spot counts as half).', 'Compares buys that use different spot lengths fairly.'],
    CPRP: ['Cost per rating point: what one rating point costs. Here it is the cost of a 30 second spot divided by the programme TVR.', 'Lower is better. It is the fairest way to compare programmes and channels.'],
    ROI: ['Value of the spots at rate card prices divided by what was actually spent.', 'Above 1x means the buy was worth more than it cost at card prices.'],
    PT: ['Prime time: programmes that start inside the prime window (set in Settings, default 19:00 to 22:30).', 'Prime time has the biggest audience and the highest rates.'],
    '30s': ['Every spot turned into a 30 second equivalent: spots x duration / 30.', 'Lets 10, 15 and 30 second spots be added up and priced on one scale.'],
  };
  const tip = (k) => (GLOSS[k] ? App.help(GLOSS[k][0], GLOSS[k][1], { howLabel: 'What it is' }) : '');
  const kpi = (l, v, s, g) => `<div class="kpi"><div class="k-lbl">${esc(l)} ${g ? tip(g) : ''}</div><div class="k-val">${v}</div>${s ? `<div class="k-sub">${s}</div>` : ''}</div>`;
  const KEY = () => 'pitch:' + App.clientId();
  const DEF = () => ({ month: null, channels: [], daypart: 'all', tab: 'overview', settings: { pt_start: '19:00', pt_end: '22:30', min_tvr: 1, max_spots: 2, budget_basis: 'com', objective: 'grp', use_card_nego: true, match_min: 45, current_basis: 'actual' },
    rates: { programmes: {}, channels: {} }, nego: { default: { mode: 'none', value: 0 }, channels: {}, programmes: {} }, mappings: {}, excluded: [], rates_file: '', only_buy: true, only_missing: false, match_filter: 'review', evals: { current: {}, plan: {} }, scenarios: [], advertiser: undefined, ours: {}, build_kind: 'current', learned: {}, deals: {} });
  let st = DEF(), D = null, root = null, status = null, seq = 0, tabTables = {}, RC = { entries: [], channels: [] };
  const load = () => { try { const v = App.store.get(KEY(), null); st = { ...DEF(), ...(v || {}), settings: { ...DEF().settings, ...((v || {}).settings || {}) } }; } catch (e) { st = DEF(); } };
  const save = () => { try { App.store.set(KEY(), st); } catch (e) { /* storage blocked */ } };
  const sec = (hm) => { const [h, m] = String(hm).split(':').map(Number); return (h || 0) * 3600 + (m || 0) * 60; };
  const opts = () => ({ advertiser: st.advertiser || '', month: st.month, channels: st.channels, daypart: st.daypart, pt_start: sec(st.settings.pt_start), pt_end: sec(st.settings.pt_end), min_tvr: +st.settings.min_tvr, max_spots: +st.settings.max_spots,
    budget_basis: st.settings.budget_basis, objective: st.settings.objective, ratecard: RC.entries, use_card_nego: st.settings.use_card_nego !== false, match_min: +st.settings.match_min || 45, learned: st.learned, deals: st.deals, plan_deals: st.ours, current_basis: st.settings.current_basis, mappings: st.mappings, rates: st.rates, nego: st.nego, excluded: st.excluded });
  const loadXlsx = () => (window.XLSX ? Promise.resolve(window.XLSX) : new Promise((ok, no) => { const s = document.createElement('script'); s.src = '/js/vendor/xlsx.full.min.js'; s.onload = () => ok(window.XLSX); s.onerror = () => no(new Error('The Excel library could not load.')); document.head.appendChild(s); }));
  const SHEET = { lmrb: 'LMRB sheet', tv: 'TVR sheet' };
  const IC = {
    overview: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', basket: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/>', invest: '<circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5c0-1 1-1.5 2.5-1.5s2.5.6 2.5 1.7-1 1.5-2.5 1.8-2.5.7-2.5 1.8 1 1.7 2.5 1.7 2.5-.5 2.5-1.5"/>',
    daypart: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>', plan: '<path d="M3 17l6-6 4 4 8-9"/><path d="M15 6h6v6"/>', build: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>',
    compare: '<path d="M7 4v16M17 4v16"/><path d="M3 9h8M13 15h8"/>', export: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 20h16"/>', matches: '<path d="M8 6h11M8 12h11M8 18h11"/><path d="M3.5 6l1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2"/>',
    rates: '<path d="M20 12l-8 8-9-9V4h7z"/><circle cx="8" cy="8" r="1.4"/>',
  };
  const GROUPS = [
    ['The current buy', 'What the prospect\'s agency bought, what it was worth and what it really cost.', [['overview', 'Spend overview', 'Monthly spend by channel, the sponsorship split and how each channel moved.'], ['basket', 'Current basket', 'Every programme bought: spots, rate, TVR, GRPs and cost per rating point. The worst are shaded.'],
      ['invest', 'Investment and discount', 'Their spend estimated at rate card, the real investment you know, and the discount that follows, with the evidence.'], ['daypart', 'Daypart view', 'Prime and non prime time: TVR, rate and cost per rating point for every channel.']]],
    ['Our plan', 'Same money, our rates.', [['plan', 'Our recommended basket', 'The programmes to buy for each channel budget, best value first. Switch any programme off and see the totals change.'], ['build', 'Build evaluation', 'Make your own evaluation in the agency format, or let the optimiser fill it for the best ROI.'],
      ['compare', 'Comparison', 'The pitch slide: current agency against our plan, in one line and one table.']]],
    ['Set up and share', 'Check the matches, set the rates, download the files.', [['matches', 'Review matches', 'Which TVR programme each LMRB programme is. Approve the right ones, correct the rest.'], ['rates', 'Rates and negotiation', 'Rate card, typed rates and the discount or special rate we negotiate.'], ['export', 'Export', 'Evaluation sheets with formulas, PDF and Word summaries, all tables.']]],
  ];
  const TABS = GROUPS.flatMap((g) => g[2].map((x) => [x[0], x[1]]));
  const TAB_INFO = Object.fromEntries(GROUPS.flatMap((g) => g[2].map((x) => [x[0], { label: x[1], text: x[2] }])));

  /* ================================================================ shell */
  function shell() {
    const card = ([k, l, d]) => `<button class="tab scard" type="button" id="tab-${k}" data-t="${k}" aria-haspopup="dialog" aria-controls="pt-sheet"><span class="sc-ic"><svg viewBox="0 0 24 24" aria-hidden="true">${IC[k]}</svg></span><span class="sc-t">${esc(l)}</span>
      <span class="sc-d">${esc(d)}</span><span class="sc-stat" data-stat="${k}">&nbsp;</span><span class="sc-go" aria-hidden="true">Open &rarr;</span></button>`;
    root.innerHTML = `<div class="card" id="pt-src"></div>
      <div class="card" id="pt-filters" style="margin-top:16px"></div>
      <div id="pt-warn" style="margin-top:12px"></div>
      <div id="pt-ready" style="margin-top:12px"></div>
      <div id="pt-tabs">${GROUPS.map(([t, sub, list]) => `<div class="sec-title">${esc(t)} <span class="muted small" style="font-weight:400;text-transform:none;letter-spacing:0">${esc(sub)}</span></div><div class="section-cards ${list.length === 4 ? '' : 'wide'}">${list.map(card).join('')}</div>`).join('')}</div>
      <div class="sheet-back" id="pt-sheet" role="dialog" aria-modal="true" aria-labelledby="pt-sheet-title" hidden><div class="sheet pt-sheet">
        <div class="sheet-bar"><div class="grow"><h2 id="pt-sheet-title"></h2><div class="muted small" id="pt-sheet-ctx"></div></div><div class="row"><label class="small muted" for="pt-sheet-sel">Go to</label><select id="pt-sheet-sel" aria-label="Go to another section">${TABS.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select><button class="btn sm primary" id="pt-sheet-close" type="button">Close</button></div></div>
        <div class="sheet-body"><div id="pt-out"></div></div></div></div>`;
    $$('#pt-tabs .scard').forEach((b) => { b.onclick = () => openSheet(b.dataset.t); });
    $('#pt-sheet-close').onclick = closeSheet;
    $('#pt-sheet-sel').onchange = (e) => openSheet(e.target.value);
    $('#pt-sheet').addEventListener('mousedown', (e) => { if (e.target.id === 'pt-sheet') closeSheet(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheetOpen() && !document.querySelector('.modal-back') && !document.querySelector('.ms-pop') && !document.querySelector('#pt-ch-sheet')) closeSheet(); });
  }
  const sheetOpen = () => { const el = $('#pt-sheet'); return !!el && !el.hidden; };
  function openSheet(id) {
    if (!TAB_INFO[id]) return;
    st.tab = id; save(); const el = $('#pt-sheet'); el.hidden = false; document.body.classList.add('sheet-open');
    $('#pt-sheet-title').textContent = TAB_INFO[id].label; $('#pt-sheet-sel').value = id; $$('#pt-tabs .scard').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.t === id)));
    const body = $('.sheet-body', el); if (body) body.scrollTop = 0;
    paintContext(); render(); $('#pt-sheet-close').focus();
  }
  function closeSheet() {
    const cs = $('#pt-ch-sheet'); if (cs) cs.remove(); const el = $('#pt-sheet'); if (!el || el.hidden) return; el.hidden = true; document.body.classList.remove('sheet-open'); if (App.charts && App.charts.destroyAll) App.charts.destroyAll();
    const b = $('#tab-' + st.tab); if (b) b.focus();
  }
  /** What the window is showing: the month, channels and daypart chosen on the page. */
  function paintContext() {
    const el = $('#pt-sheet-ctx'); if (!el) return; const ch = st.channels && st.channels.length ? st.channels.map(tt).join(', ') : 'all channels';
    el.textContent = `Month ${D ? (D.month === 'all' ? 'all months' : D.month) : 'n/a'}  ·  ${ch}  ·  ${{ all: 'prime and non prime', PT: 'prime time only', NPT: 'non prime only' }[st.daypart] || 'prime and non prime'}  ·  change these on the page behind`;
  }
  /** "Ready to pitch": one chip per thing that must be right, each opens the section where it is fixed. */
  function paintReady() {
    const el = $('#pt-ready'); if (!el) return; if (!status || !status.lmrb || !status.tv || !D || D.empty) { el.innerHTML = ''; return; }
    const sl = D.slots || [], todo = sl.filter((x) => !x.approved && !x.ignored).length, deals = Object.keys(st.deals || {}).length, cur = D.current, nb = (k) => Object.values(st.evals[k] || {}).filter((x) => x.rows && x.rows.length).length;
    const dates = [...new Set(RC.entries.map((e) => e.effective_from).filter(Boolean))];
    const oldest = dates.length ? dates.slice().sort()[0] : null, ageDays = oldest ? Math.floor((Date.now() - Date.parse(oldest)) / 86400000) : null;
    const steps = [
      [!!st.advertiser, 'Advertiser', st.advertiser || 'pick the advertiser to pitch for', 'filters', 'Pick the advertiser in the filters'],
      [todo === 0, 'Matches', todo === 0 ? `all ${sl.length} checked` : `${todo} of ${sl.length} to check`, 'matches', `Check the ${todo} programme matches`],
      [RC.entries.length > 0 && !(ageDays > 180), 'Rate card', !RC.entries.length ? 'not imported' : `dated ${oldest}${ageDays > 180 ? ` (${Math.round(ageDays / 30)} months old)` : ''}`, 'rates', RC.entries.length ? 'The rate card is more than 6 months old: import a newer one' : 'Import the agency rate card'],
      [cur.rated_pct >= 95, 'Rates cover', cur.rated_pct == null ? 'n/a' : `${n1(cur.rated_pct)}% of the spend`, 'rates', 'Add rates for the programmes without one'],
      [deals > 0, 'Investment or discount', deals ? `${deals} channel${deals === 1 ? '' : 's'}` : 'none entered', 'invest', 'Enter an investment or a discount for the channels'],
      [nb('current') > 0, 'Current estimate', nb('current') ? `${nb('current')} channel${nb('current') === 1 ? '' : 's'} built` : 'not built', 'build', 'Build the current agency estimate'],
      [nb('plan') > 0, 'Our plan', nb('plan') ? `${nb('plan')} channel${nb('plan') === 1 ? '' : 's'} built` : 'suggested only', 'plan', 'Build our plan channel by channel'],
    ], next = steps.findIndex((x) => !x[0]);
    el.innerHTML = `<div class="pt-ready" role="list" aria-label="Steps to a pitch">${steps.map(([ok, l, v, t], i) => `<button type="button" class="rd ${ok ? 'ok' : 'warn'} ${i === next ? 'next' : ''}" role="listitem" data-go="${t}"><span class="rd-i" aria-hidden="true">${ok ? '&#10003;' : i + 1}</span><span class="rd-l">${esc(l)}</span><span class="rd-v">${esc(v)}</span></button>`).join('')}</div>
      <div class="small" style="margin-top:8px">${next < 0 ? '<b>Ready to pitch.</b> Compare, then download the evaluations from Export.' : `<b>Next step:</b> ${esc(steps[next][4])}.`}</div>`;
    $$('#pt-ready .rd', el).forEach((b) => { b.onclick = () => { if (b.dataset.go === 'filters') { const a2 = $('#pf-a'); if (a2) a2.focus(); } else openSheet(b.dataset.go); }; });
  }
  /** The headline number on every card. */
  function paintCards() {
    const put = (k, v) => { const el = $(`[data-stat="${k}"]`); if (el) el.innerHTML = v || '&nbsp;'; };
    if (!D || D.empty) { Object.keys(TAB_INFO).forEach((k) => put(k, k === 'export' || k === 'rates' || k === 'matches' ? '' : '<span class="muted">Needs both sheets</span>')); put('rates', `<b>${fmt.num(RC.entries.length)}</b> rate card rows`); return; }
    const cur = D.current, ov = D.overview, need = (D.slots || []).filter((x) => !x.approved && !x.ignored).length, ev = D.evidence || [], ent = ev.filter((e) => e.deal);
    const tot = ov.rows.reduce((a, r) => a + r.months.reduce((s2, x) => s2 + x.com + x.va, 0), 0), g = D.comparison && D.comparison.grp_gain_pct;
    put('overview', `<b>${fmt.lkrc(tot)}</b> over ${ov.months.length} month${ov.months.length === 1 ? '' : 's'}`);
    put('basket', `<b>${fmt.num(cur.spots)}</b> spots · ROI <b>${xr(cur.com_roi)}</b>`);
    put('invest', ent.length ? `Real discount <b>${pc(ent.reduce((a, e) => a + (e.implied_discount_pct || 0), 0) / ent.length)}</b>` : `Rack estimate <b>${fmt.lkrc(ev.reduce((a, e) => a + e.rack_value, 0))}</b>`);
    put('daypart', `Prime time <b>${pc(cur.pt_spend_share)}</b> of spend`);
    put('plan', `<b>${fmt.num((D.plan.rows || []).length)}</b> programmes · ${fmt.lkrc(D.plan.totals.spend)}`);
    const nb = (k) => Object.values(st.evals[k] || {}).filter((x) => x.rows && x.rows.length).length;
    put('build', nb('current') + nb('plan') ? `<b>${nb('current')}</b> current · <b>${nb('plan')}</b> plan channels built` : 'Two evaluations per channel');
    put('compare', g == null ? 'Add rates to compare' : `<b>${g > 0 ? '+' : ''}${n1(g)}%</b> GRPs`);
    put('matches', need ? `<b>${need}</b> of ${(D.slots || []).length} to check` : `All ${(D.slots || []).length} approved`);
    put('rates', `<b>${fmt.num(RC.entries.length)}</b> rate card rows · <b>${fmt.num(Object.keys(st.rates.programmes).length)}</b> typed`);
    put('export', 'Excel · PDF · Word');
  }

  /* ================================================================ sources */
  function sources() {
    const slot = (k) => {
      const s = status && status[k];
      return `<div class="up-slot ${s ? 'loaded' : ''}" data-kind="${k}" tabindex="0" role="button" aria-label="${SHEET[k]}"><div class="up-t">${SHEET[k]}</div>
        <div class="up-meta">${s ? `${fmt.num(s.rows)} rows, ${esc(s.date_min)} to ${esc(s.date_max)}<br><span class="muted small">${esc((s.files || []).slice(-2).join(', '))}</span>` : k === 'lmrb' ? 'The client\'s current buying record: programme, spots, duration, cost, month' : 'Programme TVR by channel and time slot'}</div>
        <div class="row" style="gap:6px;margin-top:8px"><button class="btn sm" type="button" data-pick="replace">${s ? 'Replace' : 'Choose file'}</button>${s ? '<button class="btn sm" type="button" data-pick="append">Add a month</button><button class="btn sm ghost danger" type="button" data-rm>Remove</button>' : ''}</div>
        <input type="file" accept=".csv,.xlsx,.xls,.txt" hidden><div class="progress" hidden><div></div></div><div class="up-msg small" hidden></div></div>`;
    };
    const nProg = Object.keys(st.rates.programmes).length, nChan = Object.keys(st.rates.channels).length;
    $('#pt-src').innerHTML = `<div class="card-head"><div><h3>Data sources</h3><div class="sub">Each file is kept in this browser for this client, so it is still here next time. Upload several months to compare them; the latest month is shown first. TV only.</div></div>
        <button class="btn" type="button" id="pt-sample">Load sample data</button></div>
      <div class="uploads four">${slot('lmrb')}${slot('tv')}
        <div class="up-slot ${RC.entries.length ? 'loaded' : ''}" data-kind="rc"><div class="up-t">Rate card (agency database)</div><div class="up-meta">${RC.entries.length ? `${fmt.num(RC.entries.length)} programme rates, ${RC.channels.length} channels<br><span class="muted small">${esc(RC.channels.map((c) => `${tt(c.channel)} ${c.effective_from}`).join(' · '))}</span>` : 'No rate card in the database yet. An admin can import the agency rate card workbook.'}</div>
          <div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap">${isAdmin() ? '<button class="btn sm primary" type="button" id="pt-rcimp">Import rate card sheet</button>' : ''}<button class="btn sm" type="button" id="pt-rcver">Channels and versions</button></div></div>
        <div class="up-slot ${nProg + nChan ? 'loaded' : ''}" data-kind="manual"><div class="up-t">Manual rate input</div><div class="up-meta">Type a 30 sec rate where the rate card has none: for one programme, or one prime / non prime rate for a whole channel. A typed rate beats the rate card.<br><span class="muted small">${fmt.num(nProg)} programme rates, ${fmt.num(nChan)} channel rates saved${st.rates_file ? ' (file: ' + esc(st.rates_file) + ')' : ''}</span></div>
          <div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap"><button class="btn sm primary" type="button" id="pt-addrate">Add a rate</button><button class="btn sm" type="button" id="pt-paste">Paste from Excel</button><button class="btn sm" type="button" id="pt-ratefile">Rates file</button><button class="btn sm" type="button" id="pt-tpl">Template</button></div><input type="file" accept=".csv,.xlsx,.xls" hidden id="pt-ratein"></div></div>`;
    $$('#pt-src .up-slot[data-kind=lmrb], #pt-src .up-slot[data-kind=tv]').forEach((el) => {
      const k = el.dataset.kind, inp = $('input[type=file]', el); let mode = 'replace';
      $$('[data-pick]', el).forEach((b) => { b.onclick = (e) => { e.stopPropagation(); mode = b.dataset.pick; inp.click(); }; });
      const rm = $('[data-rm]', el); if (rm) rm.onclick = async (e) => { e.stopPropagation(); if (!confirm(`Remove the stored ${SHEET[k]}?`)) return; await App.data.remove(k); await refreshStatus(); run(); };
      el.onclick = (e) => { if (!e.target.closest('button') && !status[k]) { mode = 'replace'; inp.click(); } };
      inp.onchange = () => { if (inp.files[0]) upload(k, inp.files[0], mode, el); inp.value = ''; };
      ['dragenter', 'dragover'].forEach((ev) => el.addEventListener(ev, (e) => { e.preventDefault(); el.classList.add('over'); })); ['dragleave', 'drop'].forEach((ev) => el.addEventListener(ev, (e) => { e.preventDefault(); el.classList.remove('over'); }));
      el.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) upload(k, f, status[k] && confirm('Add this to the stored file? Cancel replaces it.') ? 'append' : 'replace', el); });
    });
    $('#pt-ratefile').onclick = () => $('#pt-ratein').click();
    $('#pt-ratein').onchange = (e) => { if (e.target.files[0]) importRates(e.target.files[0]); e.target.value = ''; };
    $('#pt-tpl').onclick = () => App.download(new Blob(['﻿Channel,Programme,Rate,Seconds\nDERANA,HUSMAK LAGIN,1092000,30\nHIRU,HIRU MORNING,40000,10\n'], { type: 'text/csv' }), 'rates_template.csv');
    $('#pt-addrate').onclick = addRateDialog; $('#pt-paste').onclick = pasteDialog; $('#pt-sample').onclick = loadSample;
    $('#pt-rcver').onclick = versionsDialog; if ($('#pt-rcimp')) $('#pt-rcimp').onclick = importRateCardDialog;
  }
  const isAdmin = () => !!(App.shell.me && App.shell.me.user && App.shell.me.user.is_admin);
  async function refreshRC() { try { RC = await App.api.get('/api/ratecards/current'); } catch (e) { RC = { entries: [], channels: [] }; } }
  function importRateCardDialog() {
    const m = App.modal('Import the agency rate card', `<p class="small muted">Choose the rate card workbook (.xlsx): one tab per channel with Programme, Day/s, Start, End and Rack Rate 30 Sec (a 10 sec rate is multiplied by 3). In the Negosiated Rate column a formula such as rack x 27% is saved as a discount rate (73% off); a typed number is saved as a special rate for that programme. Tabs with a date in their title ("Effective: 2026.08.07") keep it; a new date adds a version, the same date replaces it.</p>
      <div class="grid g2"><div class="field"><label for="rc-eff">Effective date for tabs that do not give one</label><input id="rc-eff" type="date" value="${new Date().toISOString().slice(0, 10)}"></div><div class="field"><label for="rc-file">Workbook</label><input id="rc-file" type="file" accept=".xlsx"></div></div><div id="rc-out" style="margin-top:10px"></div>`);
    $('#rc-file', m).onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return; const out = $('#rc-out', m); out.innerHTML = App.skeleton(1);
      try {
        const r = await fetch(`/api/ratecards/import?filename=${encodeURIComponent(f.name)}&effective=${encodeURIComponent($('#rc-eff', m).value || '')}`, { method: 'POST', body: await f.arrayBuffer(), headers: { 'X-Requested-With': 'fetch', 'Content-Type': 'application/octet-stream' } });
        const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : 'The import failed.');
        out.innerHTML = `<div class="banner good"><span>${fmt.num(j.rows)} programme rates imported.</span></div><div class="tbl-scroll"><table class="tbl"><thead><tr><th>Channel</th><th>Effective</th><th class="num">Programmes</th><th class="num">Discount rates</th><th class="num">Special rates</th></tr></thead><tbody>${j.imported.map((d) => `<tr><td>${esc(tt(d.channel))}</td><td>${esc(d.effective_from)}${d.dated ? '' : ' <span class="muted small">(no date in the sheet)</span>'}</td><td class="num">${d.rows}</td><td class="num">${d.discount_rows}</td><td class="num">${d.special_rows}</td></tr>`).join('')}</tbody></table></div>${j.warnings.map((w) => `<div class="banner"><span>${esc(w)}</span></div>`).join('')}`;
        await refreshRC(); sources(); run();
      } catch (err) { out.innerHTML = `<div class="banner bad"><span>${esc(err.message)}</span></div>`; }
    };
  }
  async function versionsDialog() {
    let sm; try { sm = await App.api.get('/api/ratecards/summary'); } catch (e) { App.toast(e.message, 'error'); return; }
    const m = App.modal('Rate card: channels and versions', sm.channels.length ? `<p class="small muted">The newest version of each channel is used. Rates for the programmes are matched to the TVR programmes by channel, day and start time, then by name.</p><div class="tbl-scroll"><table class="tbl"><thead><tr><th>Channel</th><th>Effective</th><th class="num">Programmes</th><th class="num">Discount</th><th class="num">Special</th><th>File</th>${isAdmin() ? '<th></th>' : ''}</tr></thead><tbody>${sm.channels.flatMap((c) => c.versions.map((v, i) => `<tr><td>${i ? '' : '<b>' + esc(tt(c.channel)) + '</b>'}</td><td>${esc(v.effective_from)}${i ? '' : ' <span class="badge good">in use</span>'}</td><td class="num">${v.rows}</td><td class="num">${v.discount_rows}</td><td class="num">${v.special_rows}</td><td class="small">${esc(v.source || '')}</td>${isAdmin() ? `<td><button class="btn sm ghost danger" type="button" data-ch="${esc(c.channel)}" data-ef="${esc(v.effective_from)}">Delete</button></td>` : ''}</tr>`)).join('')}</tbody></table></div>` : '<p>No rate card has been imported yet.</p>');
    m.onclick = async (e) => { const b = e.target.closest('[data-ch]'); if (!b || !confirm(`Delete the ${b.dataset.ch} rate card of ${b.dataset.ef}?`)) return; try { await App.api.del(`/api/ratecards?channel=${encodeURIComponent(b.dataset.ch)}&effective_from=${encodeURIComponent(b.dataset.ef)}`); m.close(); await refreshRC(); sources(); run(); } catch (err) { App.toast(err.message, 'error'); } };
  }
  async function refreshStatus() { status = await App.data.status(); sources(); }
  async function upload(k, file, mode, el, colmap) {
    if (!/\.(xlsx|xls|csv|txt)$/i.test(file.name)) { App.toast('Please choose a .csv, .xlsx or .xls file.', 'error'); return; }
    const prog = $('.progress', el), msg = $('.up-msg', el); prog.hidden = false; msg.hidden = false; prog.firstElementChild.style.width = '0'; msg.textContent = `Reading ${file.name}`;
    try {
      const res = await App.data.upload(k, file, mode, (p, m) => { prog.firstElementChild.style.width = Math.round(p * 100) + '%'; if (m) msg.textContent = m; }, colmap);
      const r = res.report; App.toast(r.appended ? `${SHEET[k]}: ${fmt.num(r.rows_added)} new rows added.` : `${SHEET[k]} loaded: ${fmt.num(r.rows_kept)} rows, ${r.date_min} to ${r.date_max}.`, 'ok');
      if (res.warning) App.toast(res.warning, 'error', 12000);
      st.month = null; save(); await refreshStatus(); run();
    } catch (e) {
      prog.hidden = true; msg.hidden = true;
      if (/Missing required columns|header row/i.test(e.message)) remapDialog(k, file, mode, el, e.message); else App.toast(e.message, 'error', 12000);
    }
  }
  /** The automatic column match failed: let the user say which column is which. */
  async function remapDialog(k, file, mode, el, why) {
    let pk; try { pk = await App.data.peekHeaders(k, file); } catch (e) { App.toast(e.message, 'error'); return; }
    const need = k === 'lmrb' ? ['advertiser', 'channel', 'program', 'cost'] : ['channel', 'date', 'program', 'tvr'];
    const fields = pk.fields.filter((f) => f.required || need.includes(f.key) || ['date', 'dd', 'mn', 'yr', 'dur', 'prog_time', 'advt_time', 'start', 'end', 'theme'].includes(f.key));
    const opt = (sel) => `<option value="">(not in the file)</option>${pk.headers.map((h) => `<option ${h === sel ? 'selected' : ''}>${esc(h)}</option>`).join('')}`;
    const m = App.modal(`Match the columns in ${file.name}`, `<div class="banner"><span>${esc(why)} Tell me which column holds each item. Items marked * are needed.</span></div>
      <div class="grid g2">${fields.map((f) => `<div class="field"><label>${esc(f.key.replace(/_/g, ' '))}${f.required ? ' *' : ''}</label><select data-f="${f.key}">${opt(pk.guess[f.key])}</select></div>`).join('')}</div>
      <div class="muted small" style="margin-top:8px">First rows: ${pk.sample.map((r) => esc(r.slice(0, 8).join(' | '))).join('<br>')}</div><div class="row" style="margin-top:12px"><button class="btn primary" type="button" id="rm-go">Use these columns</button></div>`);
    $('#rm-go', m).onclick = () => { const map = {}; $$('[data-f]', m).forEach((s) => { if (s.value) map[s.dataset.f] = s.value; }); m.close(); upload(k, file, mode, el, map); };
  }
  async function loadSample() {
    try {
      const get = async (n) => new File([await (await fetch('/sample/' + n)).blob()], n, { type: 'text/csv' });
      await App.data.upload('lmrb', await get('pitch_lmrb.csv'), 'replace', () => {}); await App.data.upload('tv', await get('pitch_tvr.csv'), 'replace', () => {});
      st.month = null; st.mappings = {}; st.excluded = [];
      st.rates.channels = { DERANA: { pt: { rate: 900000, secs: 30 }, npt: { rate: 250000, secs: 30 } }, SIRASA: { pt: { rate: 500000, secs: 30 }, npt: { rate: 150000, secs: 30 } }, HIRU: { pt: { rate: 380000, secs: 30 }, npt: { rate: 120000, secs: 30 } } };
      st.nego.default = { mode: 'discount', value: 45 }; save(); await refreshStatus(); await run();
      const rf = new File([await (await fetch('/sample/pitch_rates.csv')).blob()], 'pitch_rates.csv'); await importRates(rf);
      App.toast('Sample data loaded: a made-up prospect with two months of TV buying, TVR for three channels, channel rates and a 45% discount.', 'ok', 9000);
    } catch (e) { App.toast('Could not load the sample: ' + e.message, 'error'); }
  }

  /* ================================================================ rates in */
  function programmeKeys(ch) { return ((D && D.catalogue && D.catalogue[ch]) || []).map((x) => ({ prog: x.key.split('|')[1], key: x.key })); }
  /** Match a typed channel + programme to a TVR programme: exact name first, then similar names. */
  function matchProg(chRaw, progRaw) {
    const ch = window.MR.normaliseChannel(String(chRaw))[0], name = window.MR.normaliseProgram(String(progRaw)), list = programmeKeys(ch);
    if (!list.length) return { ch, prog: null };
    let best = null, bs = 0; for (const x of list) { const s = x.prog === name ? 1 : window.MR.pitchSim(name, x.prog); if (s > bs) { bs = s; best = x.prog; } }
    return { ch, prog: bs >= 0.8 ? best : null };
  }
  function applyRateRows(rows) {
    let ok = 0; const bad = [];
    for (const r of rows) {
      const rate = parseFloat(String(r.rate).replace(/,/g, '')), secs = parseFloat(String(r.secs || 30).replace(/,/g, '')) || 30;
      if (!(rate > 0) || !r.channel || !r.programme) { bad.push(`${r.channel || '?'} / ${r.programme || '?'}: no rate`); continue; }
      const m = matchProg(r.channel, r.programme);
      if (!m.prog) { bad.push(`${r.channel} / ${r.programme}: no such programme in the TVR sheet`); continue; }
      st.rates.programmes[`${m.ch}|${m.prog}`] = { rate, secs }; ok++;
    }
    save(); return { ok, bad };
  }
  async function importRates(file) {
    try {
      const X = await loadXlsx(), wb = X.read(await file.arrayBuffer(), { type: 'array' }), aoa = X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
      const hi = aoa.findIndex((r) => r.some((v) => /^rate/i.test(String(v)))); if (hi < 0) throw new Error('No "Rate" column found. Use the columns Channel, Programme, Rate, Seconds.');
      const h = aoa[hi].map((v) => String(v).trim().toLowerCase()), ix = (re) => h.findIndex((v) => re.test(v));
      const ic = ix(/channel/), ip = ix(/programme|program/), ir = ix(/^rate/), is = ix(/^sec|^dur/);
      if (ic < 0 || ip < 0) throw new Error('Columns Channel and Programme are needed.');
      const rows = aoa.slice(hi + 1).filter((r) => r[ip]).map((r) => ({ channel: r[ic], programme: r[ip], rate: r[ir], secs: is >= 0 ? r[is] : 30 }));
      const { ok, bad } = applyRateRows(rows); st.rates_file = file.name; save(); sources(); await run();
      App.toast(`${fmt.num(ok)} rates loaded from ${file.name}.${bad.length ? ' ' + bad.length + ' rows skipped.' : ''}`, bad.length ? 'error' : 'ok', 9000);
      if (bad.length) App.modal('Rows that were not used', `<ul class="small">${bad.slice(0, 80).map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`);
    } catch (e) { App.toast(e.message, 'error', 9000); }
  }
  function pasteDialog() {
    const m = App.modal('Paste rates from Excel', `<p class="small muted">Copy four columns from Excel: Channel, Programme, Rate, Seconds (Seconds is optional, default 30). A 10 second rate is converted to a 30 second rate.</p><textarea id="pp-t" rows="10" spellcheck="false" placeholder="DERANA&#9;HUSMAK LAGIN&#9;1092000&#9;30"></textarea><div class="row" style="margin-top:10px"><button class="btn primary" id="pp-go" type="button">Add these rates</button></div>`);
    $('#pp-go', m).onclick = async () => { const rows = $('#pp-t', m).value.split(/\r?\n/).filter(Boolean).map((l) => { const c = l.split(/\t|,(?=\s*\d)/); return { channel: (c[0] || '').trim(), programme: (c[1] || '').trim(), rate: c[2], secs: c[3] }; }); const { ok, bad } = applyRateRows(rows); m.close(); sources(); await run(); App.toast(`${ok} rates added.${bad.length ? ' Skipped: ' + bad.slice(0, 3).join('; ') : ''}`, bad.length ? 'error' : 'ok', 9000); };
  }
  function addRateDialog() {
    const chs = (D && D.tvr_channels) || [];
    if (!chs.length) { App.toast('Upload the TVR sheet first, so rates can be linked to its programmes.', 'error'); return; }
    const m = App.modal('Add a 30 second rate', `<div class="grid g2"><div class="field"><label>Channel</label><select id="ar-ch">${chs.map((c) => `<option>${esc(c)}</option>`).join('')}</select></div>
      <div class="field"><label>For</label><select id="ar-for"><option value="prog">One programme</option><option value="pt">All prime time programmes of the channel</option><option value="npt">All non prime time programmes of the channel</option></select></div>
      <div class="field" id="ar-pf"><label>Programme</label><input id="ar-pr" list="ar-dl" placeholder="Start typing a TVR programme name"><datalist id="ar-dl"></datalist></div>
      <div class="field"><label>Rate (LKR)</label><input id="ar-rate" type="number" min="0" step="any"></div><div class="field"><label>Rate is for how many seconds</label><select id="ar-sec">${[10, 15, 20, 30, 45, 60].map((s) => `<option ${s === 30 ? 'selected' : ''}>${s}</option>`).join('')}</select></div></div>
      <p class="small muted">A rate for a different length is converted to 30 seconds (a 10 sec rate x 3). A programme rate beats a channel rate.</p><div class="row" style="margin-top:10px"><button class="btn primary" id="ar-go" type="button">Save rate</button></div>`);
    const fillDl = () => { $('#ar-dl', m).innerHTML = programmeKeys($('#ar-ch', m).value).map((x) => `<option value="${esc(x.prog)}">`).join(''); };
    $('#ar-ch', m).onchange = fillDl; fillDl(); $('#ar-for', m).onchange = (e) => { $('#ar-pf', m).hidden = e.target.value !== 'prog'; };
    $('#ar-go', m).onclick = async () => {
      const ch = $('#ar-ch', m).value, rate = parseFloat($('#ar-rate', m).value), secs = +$('#ar-sec', m).value, kind = $('#ar-for', m).value;
      if (!(rate > 0)) { App.toast('Type a rate above zero.', 'error'); return; }
      if (kind === 'prog') { const r = applyRateRows([{ channel: ch, programme: $('#ar-pr', m).value, rate, secs }]); if (!r.ok) { App.toast(r.bad[0] || 'Programme not found in the TVR sheet.', 'error'); return; } }
      else { st.rates.channels[ch] = { ...(st.rates.channels[ch] || {}), [kind]: { rate, secs } }; save(); }
      m.close(); sources(); await run(); App.toast('Rate saved.', 'ok');
    };
  }

  /* ================================================================ filters */
  function filters() {
    const chs = (D && D.tvr_channels) || [], months = (D && D.months) || [], cur = D ? D.month : null, advs = (D && D.advertisers) || [];
    $('#pt-filters').innerHTML = `<div class="pt-bar"><div class="field"><label for="pf-a">Advertiser</label><select id="pf-a" style="max-width:240px"><option value="">All advertisers</option>${advs.map((a) => `<option value="${esc(a.name)}" ${a.name === st.advertiser ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div><div class="field"><label for="pf-m">Month</label><select id="pf-m"><option value="all" ${cur === 'all' ? 'selected' : ''}>All months</option>${months.slice().reverse().map((m) => `<option ${m === cur ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
      <div data-ms="pch"></div><div class="field"><label>Prime / non prime ${tip('PT')}</label><div class="seg" id="pf-dp">${[['all', 'All'], ['PT', 'Prime'], ['NPT', 'Non prime']].map(([k, l]) => `<button type="button" data-k="${k}" aria-pressed="${st.daypart === k}">${l}</button>`).join('')}</div></div>
      <div class="field"><label>&nbsp;</label><button class="btn" type="button" id="pf-set">Settings</button></div></div>
      <div class="muted small" style="margin-top:6px">Client: <b>${esc(((App.shell.client() || {}).name) || 'none selected')}</b>. Change the client in the left menu: each client keeps its own files, rates and match fixes. Pick the <b>advertiser</b> to focus on: the current buy, the budgets and both evaluations are built from that advertiser's LMRB rows only. Only channels in the TVR sheet are evaluated.</div>`;
    const again = App.debounce(() => { save(); run(); }, 250);
    const m = App.filters.multi({ key: 'channels', label: 'Channel' }, chs, st, again); m.dataset.ms = 'pch'; $('[data-ms="pch"]').replaceWith(m);
    $('#pf-a').onchange = (e) => { st.advertiser = e.target.value; st.evals = { current: {}, plan: {} }; save(); run(); };
    $('#pf-m').onchange = (e) => { st.month = e.target.value; save(); run(); };
    $$('#pf-dp button').forEach((b) => { b.onclick = () => { st.daypart = b.dataset.k; save(); run(); }; });
    $('#pf-set').onclick = settingsDialog;
  }
  function settingsDialog() {
    const s = st.settings;
    const m = App.modal('Settings', `<div class="grid g2"><div class="field"><label>Prime time starts ${tip('PT')}</label><input id="se-p0" type="time" value="${esc(s.pt_start)}"></div><div class="field"><label>Prime time ends</label><input id="se-p1" type="time" value="${esc(s.pt_end)}"></div>
      <div class="field"><label>Minimum TVR for our plan</label><input id="se-tvr" type="number" min="0" step="0.1" value="${esc(s.min_tvr)}"></div><div class="field"><label>Most spots per episode in our plan</label><input id="se-ms" type="number" min="1" step="1" value="${esc(s.max_spots)}"></div>
      <div class="field"><label class="row" style="gap:6px"><input type="checkbox" id="se-cn" ${s.use_card_nego !== false ? 'checked' : ''}> Use the negotiated rates stored in the rate card</label><div class="small muted">A programme or channel rule you set yourself always wins. Without it, the rate card's discount or special rate is used, then the default rule.</div></div>
      <div class="field"><label for="se-mm">Lowest match score accepted automatically: <b id="se-mmv">${esc(s.match_min || 45)}</b>%</label><input id="se-mm" type="range" min="20" max="90" step="5" value="${esc(s.match_min || 45)}"><div class="small muted">Lower = more aggressive: weaker matches are accepted (and marked Low to check). Every row still lists its best suggestions.</div></div>
      <div class="field"><label>Our plan is compared with</label><select id="se-b"><option value="com" ${s.budget_basis === 'com' ? 'selected' : ''}>Programme basket only (commercial spots)</option><option value="all" ${s.budget_basis === 'all' ? 'selected' : ''}>All exposure (commercial + sponsorship items)</option><option value="deal" ${s.budget_basis === 'deal' ? 'selected' : ''}>The investment I entered x its commercial share (Investment and discount tab)</option></select></div>
      <div class="field"><label>The current buy is costed at</label><select id="se-cb"><option value="lmrb" ${s.current_basis !== 'actual' ? 'selected' : ''}>The cost in the LMRB sheet</option><option value="actual" ${s.current_basis === 'actual' ? 'selected' : ''}>The actual investment I entered (spread by rate card value)</option></select></div></div>
      <p class="small muted">Budget per channel = what the current agency spent on that channel (same basis as the choice above). Tax (VAT, SSCL) is not included anywhere.</p><div class="row" style="margin-top:10px"><button class="btn primary" id="se-go" type="button">Save</button></div>`);
    $('#se-mm', m).oninput = (e) => { $('#se-mmv', m).textContent = e.target.value; };
    $('#se-go', m).onclick = () => { Object.assign(st.settings, { pt_start: $('#se-p0', m).value || '19:00', pt_end: $('#se-p1', m).value || '22:30', min_tvr: +$('#se-tvr', m).value || 0, max_spots: Math.max(1, +$('#se-ms', m).value || 1), budget_basis: $('#se-b', m).value, use_card_nego: $('#se-cn', m).checked, match_min: +$('#se-mm', m).value || 45, current_basis: $('#se-cb', m).value }); save(); m.close(); run(); };
  }

  /* ================================================================ run */
  async function run() {
    const my = ++seq, out = $('#pt-out');
    if (!status || !status.lmrb || !status.tv) { D = null; filters(); $('#pt-warn').innerHTML = `<div class="banner info"><span>Upload the client's LMRB sheet and the TVR sheet above to start, or press <b>Load sample data</b> to see how it works.</span></div>`; paintCards(); if (sheetOpen()) out.innerHTML = App.emptyState('Nothing to evaluate yet', 'Both sheets are needed: LMRB for what was bought, TVR for the audience each programme delivered.'); return; }
    if (sheetOpen()) out.innerHTML = App.skeleton(3);
    let d; try { d = await App.data.pitchBuild({ options: opts() }); } catch (e) { out.innerHTML = App.emptyState('The evaluation could not be built', e.message); return; }
    if (my !== seq) return;
    D = d; guardEvals();
    if (st.advertiser === undefined) { const cn = String(((App.shell.client() || {}).name) || '').toLowerCase(), hit = (cn && (d.advertisers || []).find((a) => a.name.toLowerCase().includes(cn) || cn.includes(a.name.toLowerCase()))) || ((d.advertisers || []).length === 1 ? d.advertisers[0] : null); st.advertiser = hit ? hit.name : ''; save(); if (hit) { run(); return; } }
    if (!st.month || st.month === 'null') st.month = d.month; filters(); warnings(); render();
  }
  const hash = (str) => { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return String(h); };
  /** A built current estimate was made from the LMRB rows of one advertiser, month, daypart, channel set and set of matches: when one of those changes it is rebuilt, not left stale. */
  function guardEvals() {
    const sig = [st.advertiser || '', D.month, st.daypart, (st.channels || []).join(','), hash(JSON.stringify([st.mappings, st.learned, st.excluded]))].join('|'), cur = st.evals.current || {};
    if (st.evals_sig && st.evals_sig !== sig && Object.keys(cur).length) { st.evals.current = {}; App.toast('The current agency estimate was cleared because the advertiser, month, filters or matches changed. Build it again.', 'info', 8000); }
    st.evals_sig = sig; save();
  }
  function warnings() {
    const w = D.warnings, b = [];
    if (!RC.entries.length) b.push('No agency rate card is in the database yet. An admin can import the rate card workbook in Data sources; until then rates come from what you type.');
    if (w.no_medium) b.push('This LMRB sheet was loaded before TV and radio were separated, so radio rows may be counted. Upload it again for a clean TV-only view.');
    if (w.unmatched_programmes) b.push(`${w.unmatched_programmes} LMRB programme${w.unmatched_programmes === 1 ? '' : 's'} (LKR ${fmt.num(w.unmatched_spend)}) could not be matched to a TVR programme and ${w.unmatched_programmes === 1 ? 'is' : 'are'} left out of the TVR numbers. Fix them in <b>Review matches</b>.`);
    if (w.missing_rate_programmes) b.push(`${w.missing_rate_programmes} programme${w.missing_rate_programmes === 1 ? '' : 's'} you bought (LKR ${fmt.num(w.missing_rate_spend)}) have no rate card rate, so ROI leaves them out. Add rates in <b>Rates and negotiation</b>.`);
    const au = D.audit || {};
    if (au.no_duration_rows) b.push(`${fmt.num(au.no_duration_rows)} LMRB row${au.no_duration_rows === 1 ? ' has' : 's have'} no duration. They are counted as 30 seconds.`);
    if (au.zero_cost_rows) b.push(`${fmt.num(au.zero_cost_rows)} LMRB row${au.zero_cost_rows === 1 ? ' has' : 's have'} a cost of zero (free or bonus spots). They count as spots and GRPs but add no cost.`);
    if (au.negative_cost_rows) b.push(`${fmt.num(au.negative_cost_rows)} LMRB row${au.negative_cost_rows === 1 ? ' has' : 's have'} a negative cost (credits). They reduce the cost of their programme.`);
    if (w.zero_tvr_rows) b.push(`${fmt.num(w.zero_tvr_rows)} TVR row${w.zero_tvr_rows === 1 ? ' has' : 's have'} a TVR of zero. They count as zero in the average TVR.`);
    if (w.skipped_channels.length) b.push(`Channels not in the TVR sheet, skipped: ${w.skipped_channels.slice(0, 6).map((c) => `${esc(tt(c.channel))} (LKR ${fmt.num(c.spend)})`).join(', ')}.`);
    if (D.comparison.current.left_out && D.comparison.current.left_out.length) b.push(`No plan can be built yet for ${D.comparison.current.left_out.map((c) => esc(tt(c))).join(', ')}: add a rate for at least one of their programmes. The comparison covers the other channels only.`);
    $('#pt-warn').innerHTML = b.length ? `<details class="pt-checks"><summary>Data checks (${b.length})</summary>${b.map((x) => `<div class="banner"><span>${x}</span></div>`).join('')}</details>` : '';
  }
  function render() {
    const out = $('#pt-out'); paintCards(); paintReady(); if (!out || !sheetOpen()) return; tabTables = {}; paintContext();
    if (!D) { out.innerHTML = App.emptyState('Upload the LMRB and TVR sheets first', 'This section needs both: the LMRB sheet for what was bought, the TVR sheet for the audience each programme delivered.'); return; }
    if (D.empty) { out.innerHTML = App.emptyState('No TV spots for this choice', 'Pick another month or clear the channel and prime / non prime filters.'); return; }
    ({ overview, basket, invest, daypart, plan, build, compare, export: exportTab, matches, rates })[st.tab](out);
  }
  const table = (id, el, cfg) => { const d = document.createElement('div'); d.id = id; el.appendChild(d); tabTables[id] = App.tables.create(d, { pageSize: 25, ...cfg }); return tabTables[id]; };
  const card = (title, sub, inner, extra = '') => `<div class="card" style="margin-bottom:16px"><div class="card-head"><div><h3>${title}</h3>${sub ? `<div class="sub">${sub}</div>` : ''}</div>${extra}</div>${inner}</div>`;

  /* ---------------------------------------------------------------- 1 overview */
  function overview(out) {
    const ov = D.overview, ms = ov.months, want = new Set(st.channels), rows = ov.rows.filter((r) => !want.size || want.has(r.channel)), cur = D.current;
    const tot = (r) => r.months.reduce((s, x) => s + x.com + x.va, 0), grand = rows.reduce((s, r) => s + tot(r), 0);
    const last = ms.length - 1, prev = last - 1;
    const data = rows.map((r) => { const o = { channel: tt(r.channel), total: tot(r), share: grand > 0 ? (tot(r) / grand) * 100 : null, mom: prev >= 0 && r.months[prev].com + r.months[prev].va > 0 ? ((r.months[last].com + r.months[last].va) / (r.months[prev].com + r.months[prev].va) - 1) * 100 : null };
      ms.forEach((m, i) => { o['m' + i] = r.months[i].com + r.months[i].va; }); return o; });
    const cols = [{ key: 'channel', label: 'Channel' }, ...ms.map((m, i) => ({ key: 'm' + i, label: m, num: true, fmt: n0 })), { key: 'total', label: 'Total (LKR)', num: true, fmt: n0 },
      { key: 'share', label: 'Share of spend', num: true, fmt: pc }, { key: 'mom', label: prev >= 0 ? `Change ${ms[prev]} to ${ms[last]}` : 'Change on last month', num: true, fmt: (v) => (v == null ? 'n/a' : (v > 0 ? '+' : '') + fmt.num(v, 1) + '%') }];
    const split = ms.map((m, i) => { const com = rows.reduce((s, r) => s + r.months[i].com, 0), va = rows.reduce((s, r) => s + r.months[i].va, 0); return { month: m, com, va, total: com + va, share: com + va > 0 ? (va / (com + va)) * 100 : null }; });
    out.innerHTML = `<div class="kpis">${kpi('TV spend (all months)', fmt.lkrc(grand), `${fmt.num(rows.length)} channels in the TVR sheet`)}${kpi(`Commercial spots, ${D.month === 'all' ? 'all months' : D.month}`, fmt.lkrc(cur.com_spend), `${fmt.num(cur.spots)} spots`)}
      ${kpi('Sponsorship items', fmt.lkrc(cur.va_spend), cur.spend > 0 ? pc((cur.va_spend / cur.spend) * 100) + ' of the month\'s spend' : '')}${kpi('Months uploaded', fmt.num(ms.length), `${ms[0] || ''} to ${ms[ms.length - 1] || ''}`)}</div>
      <div style="margin-top:16px" id="ov-t1"></div><div id="ov-t2"></div>`;
    const t1 = $('#ov-t1'); t1.innerHTML = card('Monthly spend by channel', 'Commercial spots plus sponsorship items, in LKR. Click a heading to sort.', '<div id="ov-a"></div>');
    table('ov-a', $('#ov-a'), { columns: cols, rows: data, defaultSort: { key: 'total', desc: true }, csv: 'pitch_spend_overview', search: true });
    $('#ov-t2').innerHTML = card('Sponsorship vs commercial split', 'Sponsorship = the items ticked in Settings of the Market card (billboards, tags, time checks and similar). Everything else is a commercial spot.', '<div id="ov-b"></div>');
    table('ov-b', $('#ov-b'), { columns: [{ key: 'month', label: 'Month' }, { key: 'com', label: 'Commercial spots (LKR)', num: true, fmt: n0 }, { key: 'va', label: 'Sponsorship items (LKR)', num: true, fmt: n0 }, { key: 'total', label: 'Total (LKR)', num: true, fmt: n0 }, { key: 'share', label: 'Sponsorship share', num: true, fmt: pc }], rows: split, search: false, defaultSort: { key: 'month', desc: false }, csv: 'pitch_sponsorship_split' });
  }

  /* ---------------------------------------------------------------- 2 current basket */
  /** What the channel's card and window say about the current buy (all from the LMRB and the rate card). */
  function chFacts(ch) {
    const cur = D.current, c = cur.channels.find((x) => x.channel === ch) || {}, ev = (D.evidence || []).find((x) => x.channel === ch) || {}, rows = cur.rows.filter((r) => r.channel === ch), sp = cur.sponsorship.filter((x) => x.channel === ch);
    const disc = ev.implied_discount_pct != null ? ev.implied_discount_pct : ev.deal && ev.deal.discount_pct != null ? ev.deal.discount_pct : null;
    return { c, ev, rows, sp, programmes: new Set(rows.map((r) => r.key)).size, spots: rows.reduce((x, r) => x + r.spots, 0), rack: ev.rack_value || 0, disc, discSrc: ev.implied_discount_pct != null ? 'from the investment' : 'your estimate', pt: ev.pt_share_pct };
  }
  function basket(out) {
    const cur = D.current, chs = cur.channels.map((c) => c.channel);
    out.innerHTML = `<div class="kpis">${kpi('Spend', fmt.lkrc(cur.com_spend), 'commercial spots')}${kpi('Spots', fmt.num(cur.spots), `${n1(cur.eq30)} as 30 sec ${tip('30s')}`)}${kpi('Average 30 sec rate', fmt.lkrc(cur.avg30), 'cost / 30 sec equivalents')}
      ${kpi('Average CPRP', fmt.lkrc(cur.cprp), 'cost per rating point (30 sec)', 'CPRP')}${kpi('GRPs (30 sec)', n1(cur.ngrp), 'TVR x 30 sec equivalents', 'NGRP')}
      ${kpi('ROI: commercial only', xr(cur.com_roi), 'rate card value / spend', 'ROI')}${kpi('ROI: all exposure', xr(cur.all_roi), 'includes sponsorship items', 'ROI')}${kpi('Spend with a rate', cur.rated_pct == null ? 'n/a' : pc(cur.rated_pct), 'ROI uses these rows only')}</div>
      <div class="card" style="margin-top:16px"><div class="card-head"><div><h3>Current basket by channel</h3><div class="sub">One card per channel. Press a card to see its programme basket (prime and non prime) and its sponsorship items. Rack value = the programmes bought, at the channel's rate card. Discount is shown when you entered an investment or a discount (Investment and discount).</div></div></div>
      <div class="bd-cards" id="bk-cards">${chs.map((ch) => { const f = chFacts(ch);
        return `<button class="bd-card built" type="button" data-ch="${esc(ch)}"><span class="bd-h"><b>${esc(tt(ch))}</b><span class="badge">${f.sp.length ? `${f.sp.length} sponsorship item${f.sp.length === 1 ? '' : 's'}` : 'no sponsorship'}</span></span>
          <span class="bd-g"><span>Programmes</span><b>${n0(f.programmes)}</b><span>Spots</span><b>${n0(f.spots)}</b><span>At rate card</span><b>${f.rack > 0 ? fmt.lkrc(f.rack) : 'no rate'}</b><span>Discount</span><b>${f.disc == null ? '<span class="muted">not entered</span>' : pc(f.disc)}</b><span>Prime time</span><b>${f.pt == null ? 'n/a' : pc(f.pt)} <span class="muted">of rack</span></b><span>Cost</span><b>${fmt.lkrc(f.c.com_spend)}</b><span>ROI</span><b>${xr(f.c.com_roi)}</b></span><span class="sc-go">Open &rarr;</span></button>`; }).join('')}</div></div>`;
    $$('#bk-cards .bd-card', out).forEach((b) => { b.onclick = () => basketWindow(b.dataset.ch); });
  }
  /** One channel of the current buy: its programme basket (prime, non prime) and its sponsorship items. Read only. */
  function basketWindow(ch) {
    const f = chFacts(ch), { c, ev } = f, old = $('#pt-ch-sheet'); if (old) old.remove(); const opener = document.activeElement;
    const ov = document.createElement('div'); ov.className = 'sheet-back'; ov.id = 'pt-ch-sheet'; ov.style.zIndex = 70; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-labelledby', 'cb-title');
    const cprps = f.rows.map((r) => r.cprp).filter((v) => v > 0).sort((x, y) => x - y), cut = cprps.length ? cprps[Math.floor(cprps.length * 0.8)] : Infinity;
    const line = (r) => `<tr class="${r.cprp >= cut ? 'worst' : ''}"><td><span class="pn"><b>${esc(tt(r.program))}</b><span class="sub">${esc(r.days)} ${esc(r.start)}${r.lmrb_program && r.lmrb_program.toLowerCase() !== String(r.program).toLowerCase() ? ` · LMRB: ${esc(r.lmrb_program)}` : ''}</span></span></td><td class="num">${n0(r.dur)}s</td><td class="num">${n0(r.spots)}</td><td class="num">${n2(r.tvr)}</td><td class="num">${n1(r.grp)}</td><td class="num">${r.card_rate ? n0(r.card_rate) : '<span class="muted">no rate</span>'}</td><td class="num">${r.neg_rate ? n0(r.neg_rate) : ''}</td><td class="num">${n0(r.avg_rate)}</td><td class="num">${n0(r.cost)}</td><td class="num">${r.rated && f.rack > 0 ? pc((r.value / f.rack) * 100) : ''}</td><td class="num">${n0(r.cprp)}</td></tr>`;
    const tot = (rows) => { const sp = rows.reduce((x, r) => x + r.spots, 0), cost = rows.reduce((x, r) => x + r.cost, 0), ng = rows.reduce((x, r) => x + r.ngrp, 0), vl = rows.reduce((x, r) => x + (r.rated ? r.value : 0), 0);
      return `<tr class="ex-tot"><td>Total</td><td></td><td class="num">${n0(sp)}</td><td class="num">${n2(sp > 0 ? rows.reduce((x, r) => x + r.tvr * r.spots, 0) / sp : 0)}</td><td class="num">${n1(rows.reduce((x, r) => x + r.grp, 0))}</td><td></td><td></td><td></td><td class="num">${n0(cost)}</td><td class="num">${f.rack > 0 ? pc((vl / f.rack) * 100) : ''}</td><td class="num">${n0(ng > 0 ? cost / ng : null)}</td></tr>`; };
    const head = '<thead><tr><th>Programme (TVR name)</th><th class="num">Dur</th><th class="num">Spots</th><th class="num">TVR</th><th class="num">GRP</th><th class="num">Rate card (this dur)</th><th class="num">Negotiated (this dur)</th><th class="num">Avg paid per spot</th><th class="num">Cost</th><th class="num">Share of rack</th><th class="num">CPRP</th></tr></thead>';
    const block = (title, rows) => (rows.length ? `<h4 class="cv-h">${title}</h4><div class="tbl-scroll"><table class="tbl cv-tbl">${head}<tbody>${rows.slice().sort((x, y) => String(x.program).localeCompare(String(y.program)) || y.dur - x.dur).map(line).join('')}</tbody><tfoot>${tot(rows)}</tfoot></table></div>` : '');
    ov.innerHTML = `<div class="sheet pt-sheet"><div class="sheet-bar"><div class="grow"><h2 id="cb-title">${esc(tt(ch))}: current basket</h2><div class="muted small">What the current agency bought on this channel (${D.month === 'all' ? 'all months' : D.month}). The worst 20% by CPRP are shaded.</div></div><div class="row"><button class="btn" id="cb-x" type="button">Close</button></div></div>
      <div class="sheet-body"><div class="cv-k" style="margin-bottom:6px"><div><span>Programmes</span><b>${n0(f.programmes)}</b></div><div><span>Spots</span><b>${n0(f.spots)}</b></div><div><span>At rate card (rack)</span><b>${f.rack > 0 ? fmt.lkrc(f.rack) : 'no rate'}</b></div><div><span>Cost of the programmes</span><b>${fmt.lkrc(c.com_spend)}</b></div><div><span>Discount</span><b>${f.disc == null ? 'not entered' : pc(f.disc)}</b></div><div><span>Prime time, share of rack</span><b>${f.pt == null ? 'n/a' : pc(f.pt)}</b></div><div><span>GRPs (30 sec)</span><b>${n1(f.rows.reduce((x, r) => x + r.ngrp, 0))}</b></div><div><span>CPRP</span><b>${fmt.lkrc(c.cprp)}</b></div><div><span>ROI commercial</span><b>${xr(c.com_roi)}</b></div><div><span>ROI all exposure</span><b>${xr(c.all_roi)}</b></div></div>
        ${f.rows.some((r) => !r.rated) ? `<div class="banner info"><span>${f.rows.filter((r) => !r.rated).length} row(s) have no rate card rate, so they are not in the rack value, the discount or the ROI.</span></div>` : ''}
        ${block('Prime time programmes', f.rows.filter((r) => r.pt))}${block('Non prime time programmes', f.rows.filter((r) => !r.pt))}${f.rows.length ? '' : '<p class="muted">No programme of this channel in this view.</p>'}
        <h4 class="cv-h">Sponsorship items</h4>${f.sp.length ? `<div class="tbl-scroll"><table class="tbl cv-tbl"><thead><tr><th>Item</th><th class="num">Durations x spots</th><th class="num">Spots</th><th class="num">Per month</th><th class="num">Avg cost per spot</th><th class="num">Spend</th><th class="num">TVR delivered</th><th class="num">GRPs</th><th class="num">CPRP</th></tr></thead><tbody>${f.sp.map((x) => `<tr><td><b>${esc(x.theme)}</b></td><td class="num">${esc(x.durs.map((q) => `${n0(q.dur)}s x ${n0(q.spots)}`).join(', '))}</td><td class="num">${n0(x.spots)}</td><td class="num">${n1(x.spots_per_month)}</td><td class="num">${n0(x.avg_cost)}</td><td class="num">${n0(x.spend)}</td><td class="num">${n2(x.tvr)}</td><td class="num">${n1(x.grp)}</td><td class="num">${n0(x.cprp)}</td></tr>`).join('')}</tbody><tfoot><tr class="ex-tot"><td>Total</td><td></td><td class="num">${n0(f.sp.reduce((x, r) => x + r.spots, 0))}</td><td></td><td></td><td class="num">${n0(f.sp.reduce((x, r) => x + r.spend, 0))}</td><td></td><td class="num">${n1(f.sp.reduce((x, r) => x + r.grp, 0))}</td><td></td></tr></tfoot></table></div><div class="muted small" style="margin-top:6px">TVR is worked out from the channel's average prime and non prime TVR, weighted by how many of the item's spots ran in each.</div>` : '<p class="muted">No sponsorship items on this channel.</p>'}
      </div></div>`;
    document.body.appendChild(ov);
    const close = () => { document.removeEventListener('keydown', onKey, true); ov.remove(); if (opener && opener.focus && document.contains(opener)) opener.focus(); };
    const onKey = (ev) => { if (ev.key === 'Escape' && !document.querySelector('.modal-back')) { ev.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true); $('#cb-x', ov).onclick = close; ov.addEventListener('mousedown', (ev) => { if (ev.target === ov) close(); }); $('#cb-x', ov).focus();
  }

  /* ---------------------------------------------------------------- investment and discount */
  function invest(out) {
    const ev = D.evidence || [], deals = st.deals, actual = st.settings.current_basis === 'actual';
    const sum = (k) => ev.reduce((a, e) => a + (e[k] || 0), 0), entered = ev.filter((e) => e.deal), rackEntered = entered.reduce((a, e) => a + e.rack_value, 0), comInv = entered.reduce((a, e) => a + e.commercial_investment * (e.lmrb_cost > 0 ? e.lmrb_rated_cost / e.lmrb_cost : 1), 0);
    const inp = (ch, f, v, w = 110, ph = '') => `<input class="rt-in dl-in" type="number" min="0" step="any" data-ch="${esc(ch)}" data-f="${f}" value="${v == null || v === '' ? '' : esc(v)}" placeholder="${ph}" style="width:${w}px" aria-label="${f} for ${esc(ch)}">`;
    out.innerHTML = `<div class="kpis">${kpi('Estimated at rate card', fmt.lkrc(sum('rack_value')), 'commercial spots x the channel\'s rack rate')}${kpi('Cost in the LMRB sheet', fmt.lkrc(sum('lmrb_rated_cost')), 'same programmes, as monitored')}
        ${kpi('Investment entered', entered.length ? fmt.lkrc(entered.reduce((a, e) => a + e.deal.investment, 0)) : 'none yet', entered.length ? `${entered.length} channel${entered.length === 1 ? '' : 's'}` : 'type it below')}${kpi('Real discount (entered channels)', entered.length && rackEntered > 0 ? pc((1 - comInv / rackEntered) * 100) : 'n/a', 'commercial investment vs rack value')}</div>
      <div class="card" style="margin-top:16px"><div class="card-head"><div><h3>Investment and discount</h3><div class="sub">The LMRB sheet shows what each spot was <b>monitored</b> at, which is not always what was paid. So the previous agency's spend on a channel is first <b>estimated at the channel's rate card</b>: for every programme they bought, spots x duration / 30 x the rack rate, commercial spots only. If you know the real investment (from the contract), type it: a share of it buys the commercial spots (100%, 90% or 80%) and the rest pays for the frequency and sponsorship items; the discount they really got follows. The tables under it show the programmes behind every number.</div></div></div>
        <div class="tbl-scroll"><table class="tbl ex-tbl" id="dl-t"><thead><tr><th>Channel</th><th class="num">Spots</th><th class="num">Estimated at rate card</th><th class="num">Cost in the LMRB sheet</th><th class="num">Actual investment (LKR)</th><th class="num">Estimated discount %</th><th class="num">Commercial share %</th><th class="num">Prime share %</th><th class="num">Commercial investment</th><th class="num">Real discount vs rack</th></tr></thead><tbody>
        ${ev.map((e) => { const d = deals[e.channel] || {}; return `<tr><td><b>${esc(tt(e.channel))}</b></td><td class="num">${n0(e.spots)}</td>
          <td class="num"><b>${n0(e.rack_value)}</b>${e.unrated_programmes ? `<span class="sub" title="These programmes have no rate card rate, so they are not in the estimate">${e.unrated_programmes} without a rate (${pc(100 - (e.coverage_pct == null ? 100 : e.coverage_pct))} of the cost) left out</span>` : ''}</td>
          <td class="num">${n0(e.lmrb_cost)}<span class="sub">${pc(e.lmrb_pct_of_rack)} of rack</span></td><td class="num">${inp(e.channel, 'investment', d.investment, 120, 'type it')}</td><td class="num">${inp(e.channel, 'discount_pct', d.discount_pct, 62, 'e.g. 70')}</td><td class="num">${inp(e.channel, 'commercial_pct', d.commercial_pct, 62, '100')}</td><td class="num">${inp(e.channel, 'prime_pct', d.prime_pct, 62, 'any')}</td>
          <td class="num">${e.deal ? n0(e.commercial_investment) : '<span class="muted">n/a</span>'}</td><td class="num">${e.implied_discount_pct == null ? (e.deal && e.deal.discount_pct != null ? `<b>${pc(e.deal.discount_pct)}</b><span class="sub">your estimate</span>` : '<span class="muted">enter the investment or a discount</span>') : `<b>${pc(e.implied_discount_pct)}</b><span class="sub">pays ${pc(e.implied_pays_pct)} of rack</span>${e.discount_gap_pts != null && Math.abs(e.discount_gap_pts) >= 2 ? `<span class="sub" style="color:var(--warn,#d97706)">you typed ${pc(e.typed_discount_pct)}: ${n1(Math.abs(e.discount_gap_pts))} points ${e.discount_gap_pts > 0 ? 'higher' : 'lower'} than the investment gives</span>` : ''}`}</td></tr>`; }).join('') || '<tr><td colspan="10" class="muted">No programmes with a rate in this view.</td></tr>'}</tbody></table></div>
        <div class="muted small" style="margin-top:8px">Real discount = 1 - (actual investment x commercial share) / estimated at rate card. When some programmes have no rate, only their share of the investment is compared, and the table says so. Prime share is how much of the commercial money goes to prime time (the contract's 50% / 50%); our plan follows it when the budget is taken from this investment. ${actual ? '<b>The current buy is costed at the actual investment (Settings).</b>' : 'In Settings the current buy can be costed at the actual investment instead of the LMRB cost.'}</div></div>
      <div id="dl-ev" style="margin-top:16px"></div>`;
    $('#dl-t').onchange = (e) => {
      const t = e.target; if (!t.dataset || !t.dataset.ch) return; const ch = t.dataset.ch, d = (deals[ch] = deals[ch] || {});
      if (t.value === '') delete d[t.dataset.f]; else d[t.dataset.f] = +t.value;
      if (!(d.investment > 0) && d.discount_pct === undefined) delete deals[ch]; save(); run();
    };
    $('#dl-ev').innerHTML = ev.map((e) => {
      const rows = D.current.rows.filter((r) => r.channel === e.channel).sort((a, b) => (b.value || 0) - (a.value || 0)), pt = e.pt_share_pct, dp = e.deal && e.deal.prime_pct;
      return `<details class="card" style="margin-bottom:12px" ${ev.length === 1 ? 'open' : ''}><summary><b>${esc(tt(e.channel))}</b>: ${n0(new Set(rows.map((r) => r.key)).size)} programmes, ${n0(e.spots)} spots, <b>${fmt.lkrc(e.rack_value)}</b> at rate card${e.implied_discount_pct == null ? '' : `, discount <b>${pc(e.implied_discount_pct)}</b>`}. Prime time is ${pc(pt)} of the rack value${dp ? ` (the deal says ${pc(dp)})` : ''}.</summary>
        <div class="tbl-scroll" style="margin-top:8px"><table class="tbl"><thead><tr><th>Programme (TVR name)</th><th class="num">Spots</th><th class="num">30 sec eq.</th><th class="num">Rack rate (30 sec)</th><th class="num">Value at rack</th><th class="num">Share of channel</th><th class="num">LMRB cost</th><th class="num">LMRB as % of rack</th></tr></thead><tbody>
        ${rows.map((r) => `<tr class="${r.rated ? '' : 'worst'}"><td><span class="pn"><b>${esc(tt(r.program))}</b><span class="sub">${esc(r.days)} ${esc(r.start)} · ${esc(r.daypart)}</span></span></td><td class="num">${n0(r.spots)}</td><td class="num">${n1(r.eq30)}</td>
          <td class="num">${r.rated ? n0(r.card30) : '<b>no rate</b>'}<span class="sub">${r.card_src ? `${esc(r.card_src)}${r.card_prog ? ': ' + esc(tt(r.card_prog)) + (r.card_eff ? ' ' + esc(r.card_eff) : '') : ''}` : 'not in the estimate'}</span></td><td class="num">${r.rated ? n0(r.value) : ''}</td><td class="num">${r.rated && e.rack_value > 0 ? pc((r.value / e.rack_value) * 100) : ''}</td><td class="num">${n0(r.cost_lmrb)}</td><td class="num">${r.rated ? pc((r.cost_lmrb / r.value) * 100) : ''}</td></tr>`).join('')}</tbody>
        <tfoot><tr class="ex-tot"><td>Total</td><td class="num">${n0(e.spots)}</td><td class="num">${n1(e.eq30)}</td><td></td><td class="num">${n0(e.rack_value)}</td><td></td><td class="num">${n0(e.lmrb_cost)}</td><td class="num">${pc(e.lmrb_pct_of_rack)}</td></tr></tfoot></table></div></details>`;
    }).join('');
  }

  /* ---------------------------------------------------------------- 3 daypart */
  function daypart(out) {
    const d = D.current.daypart, cur = D.current, side = (x) => x || {};
    out.innerHTML = `<div class="kpis">${kpi('Average prime time TVR', n2(d.prime.tvr), 'weighted by spots', 'TVR')}${kpi('Average non prime TVR', n2(d.non_prime.tvr), 'weighted by spots')}${kpi('Prime time share of spend', pc(cur.pt_spend_share), `${fmt.lkrc(d.prime.spend)} of ${fmt.lkrc(cur.com_spend)}`, 'PT')}${kpi('Prime time share of spots', pc(cur.pt_spot_share), `${fmt.num(d.prime.spots)} of ${fmt.num(cur.spots)} spots`)}</div>
      <div style="margin-top:16px" id="dp-0"></div>`;
    const rows = d.by_channel.map((c) => ({ ch: tt(c.channel), ptv: side(c.prime).tvr, pr: side(c.prime).avg30, pc: side(c.prime).cprp, ps: side(c.prime).spend, nt: side(c.non_prime).tvr, nr: side(c.non_prime).avg30, nc: side(c.non_prime).cprp, ns: side(c.non_prime).spend }));
    $('#dp-0').innerHTML = card('Prime vs non prime by channel', `Prime time = programmes starting ${st.settings.pt_start} to ${st.settings.pt_end}. Average rate is per 30 seconds. CPRP = rate / TVR.`, '<div id="dp-a"></div>');
    table('dp-a', $('#dp-a'), { search: false, csv: 'pitch_daypart', rows, defaultSort: { key: 'ps', desc: true }, columns: [{ key: 'ch', label: 'Channel' }, { key: 'ptv', label: 'Prime: avg TVR', num: true, fmt: n2 }, { key: 'pr', label: 'Prime: avg 30 sec rate', num: true, fmt: n0 }, { key: 'pc', label: 'Prime: avg CPRP', num: true, fmt: n0 }, { key: 'ps', label: 'Prime: spend', num: true, fmt: n0 },
      { key: 'nt', label: 'Non prime: avg TVR', num: true, fmt: n2 }, { key: 'nr', label: 'Non prime: avg 30 sec rate', num: true, fmt: n0 }, { key: 'nc', label: 'Non prime: avg CPRP', num: true, fmt: n0 }, { key: 'ns', label: 'Non prime: spend', num: true, fmt: n0 }] });
  }

  /* ---------------------------------------------------------------- 4 our plan */
  const allocate = () => window.MR.pitchAllocate(D.candidates, D.budgets, st.excluded, st.settings.objective, D.prime_share);
  /** The plan as it stands: channels you built (Build evaluation / the channel window) as built, the others as the optimiser suggests. */
  function planNumbers() {
    const a0 = allocate(), S = EVS('plan'), built = Object.keys(S).filter((ch) => S[ch].rows && S[ch].rows.length && D.budgets[ch] !== undefined);
    const rows = a0.rows.filter((r) => !built.includes(r.channel)), channels = { ...a0.channels };
    built.forEach((ch) => { let spend = 0, spots = 0, grp = 0;
      S[ch].rows.filter((r) => r.kind === 'com').forEach((r) => { const x = calc(r), eq = (+r.spots || 0) * ((+r.dur || 30) / 30); spend += x.cost; spots += eq; grp += x.ngrp;
        rows.push({ key: r.key, channel: ch, program: r.desc, days: r.day, start: r.from, end: r.to, pt: r.band === 'PT', tvr: +r.tvr || 0, spots: eq, spend: x.cost, grp: x.ngrp, card30: +r.card || 0, neg30: +r.rate || 0, built: true }); });
      channels[ch] = { budget: D.budgets[ch], spend, left: D.budgets[ch] - spend, spots, grp, built: true }; });
    const a = { rows, channels }, totals = window.MR.pitchPlanSummary(rows, D.budgets), cmp = { ...window.MR.pitchCompare(D.comparison.current, totals), current: D.comparison.current };
    return { a, totals, cmp };
  }
  /** Our recommended basket: one card per channel, each built in its own window. */
  function plan(out) {
    const s = st.settings, S = EVS('plan'), chs = Object.keys(D.budgets), pin = D.plan_inputs || {};
    out.innerHTML = `<div class="card" style="margin-bottom:16px"><div class="card-head"><div><h3>Our recommended basket</h3><div class="sub">Built <b>channel by channel</b>. Press a channel card: type the investment, our discount, commercial %, prime % and bonus %, then let the optimiser fill the programmes or pick them yourself. A channel you have not opened shows the optimiser's suggestion for the current agency's budget.</div></div></div>
      <div class="pt-bar"><div class="field"><label for="pl-t">Minimum TVR: <b id="pl-tv">${esc(s.min_tvr)}</b> ${tip('TVR')}</label><input id="pl-t" type="range" min="0" max="${Math.max(10, Math.ceil(Math.max(0, ...D.candidates.map((c) => c.tvr)) + 1))}" step="0.1" value="${esc(s.min_tvr)}"></div>
        <div class="field"><label for="pl-m">Most spots per episode: <b id="pl-mv">${esc(s.max_spots)}</b></label><input id="pl-m" type="range" min="1" max="8" step="1" value="${esc(s.max_spots)}"></div>
        <div class="field"><label for="pl-o">Optimise for ${tip('ROI')}</label><select id="pl-o">${[['grp', 'Most GRPs (cheapest rating points first)'], ['roi', 'Best ROI (most rate card value per rupee first)'], ['balanced', 'Balanced (GRPs and ROI)']].map(([v, l]) => `<option value="${v}" ${s.objective === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
      <div class="muted small" style="margin-top:6px">These three settings steer the suggestion and the optimiser. A channel you built keeps your rows until you press "Fill the programmes with the optimiser" in its window.</div></div>
      <div id="pl-kpi"></div><div class="bd-cards" id="pl-cards" style="margin-top:16px"></div><div id="pl-dp" style="margin-top:16px"></div>`;
    const slide = App.debounce(() => { save(); run(); }, 300);
    $('#pl-o').onchange = (e) => { s.objective = e.target.value; save(); run(); };
    $('#pl-t').oninput = (e) => { s.min_tvr = +e.target.value; $('#pl-tv').textContent = s.min_tvr; slide(); };
    $('#pl-m').oninput = (e) => { s.max_spots = +e.target.value; $('#pl-mv').textContent = s.max_spots; slide(); };
    const { a, totals } = planNumbers();
    $('#pl-kpi').innerHTML = `<div class="kpis">${kpi('Budget', fmt.lkrc(totals.budget), 'commercial, all channels')}${kpi('Planned spend', fmt.lkrc(totals.spend), totals.unspent > 0 ? `LKR ${fmt.num(totals.unspent)} unspent` : 'budget fully used')}${kpi('Spots (30 sec)', fmt.num(totals.spots))}${kpi('GRPs', n1(totals.ngrp), '', 'GRP')}${kpi('Average CPRP', fmt.lkrc(totals.cprp), '', 'CPRP')}${kpi('ROI at rate card', xr(totals.roi), '', 'ROI')}</div>`;
    $('#pl-cards').innerHTML = chs.map((ch) => {
      const e = S[ch] && S[ch].rows.length ? S[ch] : null, rows = a.rows.filter((r) => r.channel === ch), spend = rows.reduce((x, r) => x + r.spend, 0), ngrp = rows.reduce((x, r) => x + (r.grp || r.tvr * r.spots), 0), value = rows.reduce((x, r) => x + (r.card30 || 0) * r.spots, 0), spots = rows.reduce((x, r) => x + r.spots, 0);
      const T = e ? tally(e.rows) : null, bonus = T && T.bonusSpots;
      return `<button class="bd-card ${e ? 'built' : ''}" type="button" data-ch="${esc(ch)}"><span class="bd-h"><b>${esc(tt(ch))}</b><span class="badge ${e ? 'good' : ''}">${e ? 'built by you' : 'suggested'}</span></span>
        <span class="bd-g"><span>Commercial budget</span><b>${n0((pin[ch] || {}).commercial_budget || D.budgets[ch])}</b><span>Planned spend</span><b>${n0(spend)}</b><span>Spots (30 sec)</span><b>${n0(spots)}</b><span>GRPs</span><b>${n1(ngrp)}</b><span>CPRP</span><b>${ngrp > 0 ? n0(spend / ngrp) : 'n/a'}</b><span>ROI</span><b>${xr(spend > 0 ? value / spend : null)}</b>${bonus ? `<span>Bonus</span><b>${n0(bonus)} spots</b>` : ''}</span><span class="sc-go">${e ? 'Edit' : 'Build'} &rarr;</span></button>`;
    }).join('') || '<div class="muted">No channel has a rate yet. Add rates in Rates and negotiation.</div>';
    $$('#pl-cards .bd-card').forEach((b) => { b.onclick = () => chBuilder('plan', b.dataset.ch, out); });
    // prime and non prime of the plan, by channel
    const band = (rs) => { const sp = rs.reduce((x, r) => x + r.spots, 0), g = rs.reduce((x, r) => x + (r.grp || r.tvr * r.spots), 0), sd = rs.reduce((x, r) => x + r.spend, 0); return { spots: sp, spend: sd, tvr: sp > 0 ? g / sp : null, cprp: g > 0 ? sd / g : null }; };
    const line = (label, rs) => `<tr><td><b>${esc(label)}</b></td>${[rs.filter((r) => r.pt), rs.filter((r) => !r.pt), rs].map((x) => band(x)).map((b2, i) => `<td class="num">${n0(b2.spots)}</td><td class="num">${n0(b2.spend)}</td><td class="num">${n2(b2.tvr)}</td><td class="num"${i === 2 ? ' style="font-weight:700"' : ''}>${n0(b2.cprp)}</td>`).join('')}</tr>`;
    $('#pl-dp').innerHTML = card('Prime time and non prime time', 'Spots, spend, average TVR and CPRP (cost per rating point, 30 sec basis) of the plan, by channel.', `<div class="tbl-scroll"><table class="tbl"><thead><tr><th rowspan="2">Channel</th><th colspan="4" class="num">Prime time</th><th colspan="4" class="num">Non prime time</th><th colspan="4" class="num">Total</th></tr><tr>${['Spots', 'Spend', 'TVR', 'CPRP'].map((h) => `<th class="num">${h}</th>`).join('').repeat(3)}</tr></thead><tbody>${chs.map((ch) => line(tt(ch), a.rows.filter((r) => r.channel === ch))).join('')}</tbody><tfoot>${line('All channels', a.rows).replace('<tr>', '<tr class="ex-tot">')}</tfoot></table></div>`);
  }

  /* ---------------------------------------------------------------- 5 comparison */
  /** Scenarios: named snapshots of our plan (what we put into each channel and the channels as built), compared side by side. */
  function paintScenarios() {
    const el = $('#cm-sc'); if (!el) return; const now = planNumbers().totals, sc = st.scenarios || [];
    const row = (name, t, extra) => `<tr><td><b>${esc(name)}</b></td><td class="num">${n0(t.spend)}</td><td class="num">${n1(t.ngrp)}</td><td class="num">${n0(t.cprp)}</td><td class="num">${xr(t.roi)}</td><td class="num">${fmt.num(t.built || 0)}</td><td class="num">${extra || ''}</td></tr>`;
    el.innerHTML = card('Scenarios', 'Save the plan as it is now under a name, change it, and compare. Loading a scenario puts its investments, discounts and built channels back.', `<div class="row" style="margin-bottom:10px"><button class="btn primary" type="button" id="sc-save">Save the current plan as a scenario</button></div>
      <div class="tbl-scroll"><table class="tbl"><thead><tr><th>Scenario</th><th class="num">Spend (LKR)</th><th class="num">GRPs (30 sec)</th><th class="num">CPRP</th><th class="num">ROI</th><th class="num">Channels built</th><th></th></tr></thead><tbody>
      ${row('Now (unsaved)', { ...now, built: builtChannels('plan').length }, '')}${sc.map((x) => row(x.name, x.totals, `<button class="btn sm" type="button" data-load="${esc(x.id)}">Load</button> <button class="btn sm ghost danger" type="button" data-del="${esc(x.id)}" aria-label="Delete ${esc(x.name)}">x</button>`)).join('')}</tbody></table></div>`);
    $('#sc-save', el).onclick = () => {
      if ((st.scenarios || []).length >= 12) { App.toast('You can keep 12 scenarios. Delete one first.', 'error'); return; }
      const m = App.modal('Save the plan as a scenario', `<div class="field"><label for="sc-name">Name</label><input id="sc-name" type="text" maxlength="60" value="Scenario ${(st.scenarios || []).length + 1}" style="width:100%"></div><div class="row" style="margin-top:12px"><button class="btn primary" id="sc-ok" type="button">Save</button></div>`);
      const inp = $('#sc-name', m); inp.focus(); inp.select();
      $('#sc-ok', m).onclick = () => { const t = planNumbers().totals; st.scenarios = [...(st.scenarios || []), { id: uid(), name: (inp.value || 'Scenario').trim().slice(0, 60), saved: new Date().toISOString().slice(0, 16).replace('T', ' '), ours: JSON.parse(JSON.stringify(st.ours || {})), plan: JSON.parse(JSON.stringify(EVS('plan'))), excluded: st.excluded.slice(), totals: { spend: t.spend, ngrp: t.ngrp, cprp: t.cprp, roi: t.roi, built: builtChannels('plan').length } }]; save(); m.close(); paintScenarios(); App.toast('Scenario saved.', 'ok'); };
    };
    el.onclick = (ev) => { const l = ev.target.closest('[data-load]'), x = ev.target.closest('[data-del]');
      if (l) { const sc2 = st.scenarios.find((y) => y.id === l.dataset.load); if (!sc2) return; st.ours = JSON.parse(JSON.stringify(sc2.ours)); st.evals.plan = JSON.parse(JSON.stringify(sc2.plan)); st.excluded = sc2.excluded.slice(); save(); App.toast(`Loaded "${sc2.name}".`, 'ok'); run(); }
      if (x) { st.scenarios = st.scenarios.filter((y) => y.id !== x.dataset.del); save(); paintScenarios(); } };
  }
  const cur0Channels = () => D.current.channels.map((c) => c.channel);
  function compare(out) {
    const { totals: P, cmp } = planNumbers(), cur = D.comparison.current;
    const row = (label, a, b, f, g, better) => { const ch = a > 0 && b != null && a != null ? (b / a - 1) * 100 : null; return `<tr><td>${label}</td><td class="num">${f(a)}</td><td class="num"><b>${f(b)}</b></td><td class="num">${ch == null ? 'n/a' : `<span class="${better === 'lower' ? (ch < 0 ? 'good-t' : 'bad-t') : ch > 0 ? 'good-t' : 'bad-t'}">${ch > 0 ? '+' : ''}${fmt.num(ch, 1)}%</span>`}</td></tr>`; };
    out.innerHTML = `<div class="card pt-hero"><div class="muted small">The pitch in one line ${cur.channels && cur.channels.length ? `(channels: ${esc(cur.channels.map(tt).join(', '))})` : ''}</div><div class="pt-sentence" id="cm-s">${esc(cmp.sentence)}</div></div>
      <div class="grid g2" style="margin-top:16px"><div class="card"><h3>Current agency vs our plan</h3><div class="tbl-scroll"><table class="tbl" id="cm-t"><thead><tr><th>Measure</th><th class="num">Current agency</th><th class="num">Our plan</th><th class="num">Change</th></tr></thead><tbody>
        ${row('Total spend (LKR)', cur.spend, P.spend, n0, 0, 'same')}${row('Total spots (30 sec equivalent)', cur.eq30, P.eq30, n1, 0, 'higher')}${row('Total GRPs (30 sec) ' + tip('NGRP'), cur.ngrp, P.ngrp, n1, 0, 'higher')}${row('Average 30 sec rate (LKR)', cur.avg30, P.avg30, n0, 0, 'lower')}${row('Average CPRP (LKR) ' + tip('CPRP'), cur.cprp, P.cprp, n0, 0, 'lower')}
        ${row('Average prime time TVR', cur.pt_tvr, P.pt_tvr, n2, 0, 'higher')}${row('Average non prime TVR', cur.npt_tvr, P.npt_tvr, n2, 0, 'higher')}${row('Prime time share of spend', cur.pt_spend_share, P.pt_spend_share, pc, 0, 'higher')}${row('Prime time share of spots', cur.pt_spot_share, P.pt_spot_share, pc, 0, 'higher')}${row('ROI at rate card ' + tip('ROI'), cur.roi, P.roi, xr, 0, 'higher')}
        </tbody></table></div><p class="small muted">${cur.spend > 0 ? `Plan spends ${pc((P.spend / cur.spend) * 100)} of the current spend. ` : ''}Tax is not included. GRPs and rates are on a 30 second basis. ${D.comparison.basis === 'all' ? 'The current side includes sponsorship items.' : 'Sponsorship items are not part of this comparison.'}</p></div>
        <div class="card"><h3>GRPs for the same money</h3><div class="chart-wrap" style="height:260px"><canvas id="cm-chart" role="img" aria-label="GRPs: current agency against our plan"></canvas></div></div></div><div id="cm-ch" style="margin-top:16px"></div><div id="cm-sc" style="margin-top:16px"></div><div id="cm-how" style="margin-top:16px"></div>`;
    const { a: pa } = planNumbers(), chs = [...new Set([...cur0Channels(), ...pa.rows.map((r) => r.channel)])];
    const sum = (rows, f) => rows.reduce((x, r) => x + f(r), 0), pct = (x, y) => (x > 0 && y != null ? ((y / x - 1) * 100) : null), chg = (v, better) => (v == null ? '<span class="muted">n/a</span>' : `<span class="${(better === 'lower' ? v < 0 : v > 0) ? 'good-t' : 'bad-t'}">${v > 0 ? '+' : ''}${fmt.num(v, 1)}%</span>`);
    const line = (label, cr, pr) => { const c = { spend: sum(cr, (r) => r.cost), spots: sum(cr, (r) => r.eq30), ngrp: sum(cr, (r) => r.ngrp), value: sum(cr.filter((r) => r.rated), (r) => r.value), vcost: sum(cr.filter((r) => r.rated), (r) => r.cost) }, q = { spend: sum(pr, (r) => r.spend), spots: sum(pr, (r) => r.spots), ngrp: sum(pr, (r) => r.grp || r.tvr * r.spots), value: sum(pr, (r) => (r.card30 || 0) * r.spots), vcost: sum(pr.filter((r) => r.card30 > 0), (r) => r.spend) };
      const cp = c.ngrp > 0 ? c.spend / c.ngrp : null, pp = q.ngrp > 0 ? q.spend / q.ngrp : null, cr2 = c.vcost > 0 ? c.value / c.vcost : null, pr2 = q.vcost > 0 ? q.value / q.vcost : null;
      return `<tr><td><b>${esc(label)}</b></td><td class="num">${n0(c.spend)}</td><td class="num">${n0(q.spend)}</td><td class="num">${n1(c.ngrp)}</td><td class="num"><b>${n1(q.ngrp)}</b></td><td class="num">${chg(pct(c.ngrp, q.ngrp), 'higher')}</td><td class="num">${n0(cp)}</td><td class="num"><b>${n0(pp)}</b></td><td class="num">${chg(cp > 0 && pp != null ? (pp / cp - 1) * 100 : null, 'lower')}</td><td class="num">${xr(cr2)}</td><td class="num"><b>${xr(pr2)}</b></td></tr>`; };
    $('#cm-ch').innerHTML = card('By channel', 'Programmes only (sponsorship items and bonus are not in this table), 30 sec basis. Plan channels you built are shown as built; the others as the optimiser suggests.', `<div class="tbl-scroll"><table class="tbl"><thead><tr><th rowspan="2">Channel</th><th colspan="2" class="num">Spend (LKR)</th><th colspan="3" class="num">GRPs (30 sec)</th><th colspan="3" class="num">CPRP (LKR)</th><th colspan="2" class="num">ROI at rate card</th></tr><tr><th class="num">Current</th><th class="num">Plan</th><th class="num">Current</th><th class="num">Plan</th><th class="num">Change</th><th class="num">Current</th><th class="num">Plan</th><th class="num">Change</th><th class="num">Current</th><th class="num">Plan</th></tr></thead><tbody>${chs.map((ch) => line(tt(ch), D.current.rows.filter((r) => r.channel === ch), pa.rows.filter((r) => r.channel === ch))).join('')}</tbody></table></div>`);
    $('#cm-how').innerHTML = HOW;
    paintScenarios();
    C().bar({ id: 'cm-chart', labels: ['Current agency', 'Our plan'], valueFmt: (v) => fmt.num(v, 0), legend: false, datasets: [{ label: 'GRPs (30 sec)', data: [cur.ngrp, P.ngrp], backgroundColor: [C().PALETTE[1], C().PALETTE[0]] }] });
  }

  /* ---------------------------------------------------------------- 6 export */
  function exportTab(out) {
    out.innerHTML = card('Export the pitch', 'Excel has every table (comparison, current basket, sponsorship, channel ROI, our plan, rates, matches). The PDF and Word summaries hold the comparison, the key tables and the plain-language line.',
      `<h4 style="margin:0 0 6px">Evaluation sheets in your agency format (with live formulas)</h4><div class="muted small" style="margin-bottom:8px">A Summary sheet, one sheet per channel (programme rows, sponsorship rows, totals, SSCL, VAT, ROI) and a Formulas sheet with the settings and the formula of every column. Change a TVR, rate or number of spots and the sheet recalculates.</div>
      <div class="row" style="gap:10px;flex-wrap:wrap;margin-bottom:16px"><button class="btn primary" id="ev-c" type="button">Current agency estimate: evaluation</button><button class="btn primary" id="ev-p" type="button">Our plan: evaluation</button><button class="btn" id="ev-c30" type="button">Current agency estimate: 30 sec version</button><button class="btn" id="ev-p30" type="button">Our plan: 30 sec version</button></div><div class="muted small" style="margin:-8px 0 16px">Channels you built in <b>Build evaluation</b> are exported as you built them; the other channels come from the current buy and the recommended basket.</div>
      <h4 style="margin:0 0 6px">Number checks</h4><div id="ex-chk" style="margin-bottom:16px"></div>${HOW}
      <h4 style="margin:16px 0 6px">Other files</h4><div class="row" style="gap:10px;flex-wrap:wrap"><button class="btn" id="ex-x" type="button">Download all tables (Excel)</button><button class="btn" id="ex-p" type="button">Download PDF summary</button><button class="btn" id="ex-w" type="button">Download Word summary</button></div>`);
    $('#ex-chk').innerHTML = `<div class="pt-checks2">${numberChecks().map(([ok, l, v]) => `<div class="${ok ? 'ok' : 'bad'}"><span aria-hidden="true">${ok ? '&#10003;' : '&#10007;'}</span><span>${esc(l)}${v ? ` <span class="muted">(${esc(v)})</span>` : ''}</span></div>`).join('')}</div>`;
    $('#ev-c').onclick = () => downloadEval('current'); $('#ev-p').onclick = () => downloadEval('plan'); $('#ev-c30').onclick = () => downloadEval('current', true); $('#ev-p30').onclick = () => downloadEval('plan', true);
    $('#ex-x').onclick = exportExcel; $('#ex-p').onclick = () => exportDoc('pdf'); $('#ex-w').onclick = () => exportDoc('docx');
  }
  /** Every total is proved against the sheet itself. All of these must be ticked. */
  function numberChecks() {
    const au = D.audit || {}, cur = D.current, { a, totals } = planNumbers(), near = (x, y, tol = 0.5) => Math.abs(x - y) <= Math.max(tol, 1e-9 * Math.abs(y)), un = D.warnings.unmatched_spend || 0, checks = [];
    if (st.daypart === 'all') checks.push([near(cur.rows.reduce((x, r) => x + r.cost, 0) + cur.sponsorship.reduce((x, r) => x + r.spend, 0) + un, au.view_spend), 'Spend: programmes + sponsorship + unmatched = every TV row of the sheet in view', `${fmt.num(au.view_spend)} in the sheet`]);
    checks.push([cur.rows.reduce((x, r) => x + r.spots, 0) === cur.channels.reduce((x, c) => x + c.com_spots, 0), 'Spots: programme rows add up to the channel totals', `${fmt.num(cur.spots - cur.channels.reduce((x, c) => x + c.va_spots, 0))} spots`]);
    checks.push([cur.rows.every((r) => Math.abs(r.eq30 - (r.spots * r.dur) / 30) < 1e-9), '30 sec equivalents = spots x duration / 30 on every row', `${cur.rows.length} rows`]);
    checks.push([cur.rows.every((r) => Math.abs(r.ngrp - r.tvr * r.eq30) < 1e-6 && Math.abs(r.grp - r.tvr * r.spots) < 1e-6), 'GRP = TVR x spots and NGRP = TVR x 30 sec equivalents on every row', `${cur.rows.length} rows`]);
    checks.push([cur.rows.every((r) => !(r.cprp > 0) || Math.abs(r.cprp - r.cost / r.ngrp) < 1e-6 * r.cprp), 'CPRP = cost / NGRP on every row', '']);
    checks.push([cur.rows.every((r) => !r.rated || Math.abs(r.value - r.card30 * r.eq30) < 1e-6 * r.value), 'Rate card value = rate card 30 sec x 30 sec equivalents on every row', '']);
    checks.push([Object.entries(D.budgets).every(([ch, b]) => (a.channels[ch] ? a.channels[ch].spend : 0) <= b * 1.0000001 || (EVS('plan')[ch] && EVS('plan')[ch].rows.length)), 'Plan: no suggested channel spends more than its budget', '']);
    checks.push([near(totals.spend, a.rows.reduce((x, r) => x + r.spend, 0)), 'Plan: total spend = sum of the programme rows', fmt.lkrc(totals.spend)]);
    const ours = Object.entries(EVS('plan')).filter(([, e]) => e.rows.length);
    checks.push([ours.every(([, e]) => e.rows.every((r) => !r.card || !r.rate || r.kind === 'bonus' || r.rate <= r.card * 1.5 + 1e-9)), 'Built plan: no rate above 150% of the rate card', `${ours.length} channels built`]);
    return checks;
  }
  const HOW = `<details class="pt-how"><summary>How every number is calculated</summary><div class="small">
    <p><b>Spots</b>: one LMRB row is one spot. <b>30 sec equivalent</b> = spots x duration / 30. <b>Rate card value</b> = rate card 30 sec rate x 30 sec equivalents. <b>Negotiated rate</b> at a duration = 30 sec negotiated rate x duration / 30.</p>
    <p><b>GRP</b> = TVR x spots. <b>NGRP</b> = TVR x 30 sec equivalents. <b>CPRP</b> = cost / GRP; <b>NCPRP</b> = cost / NGRP. TVR is the average over the programme's airings in the TVR sheet.</p>
    <p><b>ROI</b> = rate card value / cost. Commercial ROI uses the programmes only; all exposure adds sponsorship items and bonus programmes (bonus costs nothing but counts at rate card value).</p>
    <p><b>Discount</b> = 1 - cost / rate card value. With an investment: commercial cost = investment x commercial %, and the discount follows. With a discount: cost = rate card value x (1 - discount), and the investment is the cost of the programmes plus sponsorship.</p>
    <p><b>Plan</b>: programmes are bought cheapest CPRP first (or best ROI) up to their capacity (episodes per month x most spots per episode) until the channel budget is used. Tax is not included.</p></div></details>`;
  function payload() {
    const { a, totals, cmp } = planNumbers(), cur = D.current;
    return { comparison: { ...cmp, plan: totals, basis: D.comparison.basis }, current: { totals: D.comparison.current, channels: cur.channels, rows: cur.rows.slice(0, 80), sponsorship: cur.sponsorship.slice(0, 40), daypart: cur.daypart },
      plan: { rows: a.rows.slice(0, 80), channels: a.channels, totals }, warnings: D.warnings, settings: D.settings, month: D.month, meta: { client: (App.shell.client() || {}).name || '', channels: st.channels, daypart: st.daypart } };
  }
  async function exportDoc(kind) {
    const b = $(kind === 'pdf' ? '#ex-p' : '#ex-w'), txt = b.textContent; b.disabled = true; b.textContent = 'Building...';
    try { const res = await App.api.blob('/api/pitch/' + kind, payload()); App.download(res.blob, res.name); App.toast(kind === 'pdf' ? 'PDF downloaded. A copy is kept under Reports.' : 'Word summary downloaded.', 'ok'); }
    catch (e) { App.toast('The file could not be built: ' + e.message, 'error'); } finally { b.disabled = false; b.textContent = txt; }
  }
  async function exportExcel() {
    try {
      const X = await loadXlsx(), wb = X.utils.book_new(), { a, totals: P, cmp } = planNumbers(), cur = D.current, R = Math.round;
      const put = (name, aoa, widths) => { const ws = X.utils.aoa_to_sheet(aoa); ws['!cols'] = (widths || []).map((w) => ({ wch: w })); X.utils.book_append_sheet(wb, ws, name); };
      const cc = D.comparison.current, m = (a1, b1) => (a1 > 0 && b1 != null ? b1 / a1 - 1 : '');
      put('Comparison', [['Client Pitch Evaluator: current agency vs our plan'], [`Client: ${(App.shell.client() || {}).name || ''}`, `Month: ${D.month}`], [cmp.sentence], [], ['Measure', 'Current agency', 'Our plan', 'Change'],
        ['Total spend (LKR)', R(cc.spend), R(P.spend), m(cc.spend, P.spend)], ['Total spots (30 sec equivalent)', cc.eq30, P.eq30, m(cc.eq30, P.eq30)], ['Total GRPs (30 sec)', cc.ngrp, P.ngrp, m(cc.ngrp, P.ngrp)], ['Average 30 sec rate', R(cc.avg30), R(P.avg30), m(cc.avg30, P.avg30)],
        ['Average CPRP', R(cc.cprp), R(P.cprp), m(cc.cprp, P.cprp)], ['Prime time TVR', cc.pt_tvr, P.pt_tvr, m(cc.pt_tvr, P.pt_tvr)], ['Non prime TVR', cc.npt_tvr, P.npt_tvr, m(cc.npt_tvr, P.npt_tvr)], ['ROI at rate card', cc.roi, P.roi, m(cc.roi, P.roi)]], [34, 18, 18, 12]);
      put('Channel ROI', [['Channel', 'Commercial only spend', 'All exposure spend', 'Rate card value (com)', 'Rate card value (all)', 'ROI com only', 'ROI all exposure', 'Spend with a rate %'], ...cur.channels.map((c) => [tt(c.channel), R(c.com_spend), R(c.spend), R(c.com_value), R(c.all_value), c.com_roi, c.all_roi, c.rated_pct])], [20, 18, 18, 20, 20, 12, 14, 16]);
      put('Current basket', [['Programme (TVR name)', 'Channel', 'Starts', 'Days', 'Daypart', 'Spots', '30 sec eq.', 'Cost', 'Avg 30 sec rate', 'TVR', 'GRPs (30 sec)', 'CPRP', 'Card 30 sec rate'], ...cur.rows.map((r) => [tt(r.program), tt(r.channel), r.start, r.days, r.daypart, r.spots, r.eq30, R(r.cost), R(r.avg30), r.tvr, r.ngrp, R(r.cprp), r.card30 == null ? '' : R(r.card30)])], [28, 14, 8, 10, 10, 8, 10, 12, 14, 8, 12, 10, 14]);
      put('Sponsorship', [['Channel', 'Item', 'Total spots', 'Spots per month', 'Average cost per spot', 'Spend', 'Channel avg prime TVR', 'Channel avg non prime TVR', 'Average TVR delivered', 'GRPs', 'CPRP'], ...cur.sponsorship.map((s) => [tt(s.channel), s.theme, s.spots, s.spots_per_month, R(s.avg_cost), R(s.spend), s.avg_pt_tvr, s.avg_npt_tvr, s.tvr, s.grp, R(s.cprp)])], [14, 24, 10, 12, 16, 12, 16, 18, 16, 10, 10]);
      put('Our plan', [['Programme (TVR name)', 'Channel', 'Starts', 'Days', 'Daypart', 'TVR', 'Our 30 sec rate', 'CPRP', 'Spots', 'Spend', 'GRPs'], ...a.rows.map((r) => [tt(r.program), tt(r.channel), r.start, r.days, r.daypart, r.tvr, R(r.neg30), R(r.cprp), r.spots, R(r.spend), r.grp])], [28, 14, 8, 10, 10, 8, 14, 10, 8, 12, 10]);
      put('Rates', [['Channel', 'Programme (TVR name)', 'Starts', 'Daypart', 'TVR', 'Card 30 sec', 'Negotiated 30 sec', 'Agency paid 30 sec', 'Saving vs card %', 'Saving vs agency %'], ...D.rates.map((r) => [tt(r.channel), tt(r.program), r.start, r.daypart, r.tvr, r.card30 == null ? '' : R(r.card30), r.neg30 == null ? '' : R(r.neg30), r.paid30 == null ? '' : R(r.paid30), r.saving_pct, r.saving_vs_paid_pct])], [14, 28, 8, 10, 8, 12, 16, 16, 14, 16]);
      put('Matches', [['Channel', 'LMRB programme', 'TVR programme', 'Spots', 'Spend', 'Confidence %', 'Method'], ...D.matches.map((g) => [tt(g.channel), g.lmrb_program, g.tvr_program || '(no match)', g.spots, R(g.spend), g.confidence, g.method])], [14, 28, 28, 8, 12, 12, 16]);
      put('Monthly spend', [['Channel', ...D.overview.months], ...D.overview.rows.map((r) => [tt(r.channel), ...r.months.map((x) => R(x.com + x.va))])], [16]);
      App.download(new Blob([X.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `pitch_evaluation_${(D.month || 'all')}.xlsx`);
    } catch (e) { App.toast('Excel export failed: ' + e.message, 'error'); }
  }

  /* ---------------------------------------------------------------- evaluation workbooks (agency format, with formulas) */
  const clientName = () => (App.shell.client() || {}).name || '';
  const primeWindow = () => [sec(st.settings.pt_start) / 86400, sec(st.settings.pt_end) / 86400];
  const numOf = (v) => (v === '' || v == null || !(+v >= 0) ? null : +v);
  const EVS = (k) => (st.evals[k] = st.evals[k] || {});
  const builtChannels = (k) => D.tvr_channels.filter((ch) => EVS(k)[ch] && EVS(k)[ch].rows.length);
  const dealSpec = (d, k) => { const o = {}; [['investment', 'investment'], ['commercial_pct', 'commercial_pct'], ['prime_pct', 'prime_pct'], ['bonus_pct', 'bonus_pct'], [k === 'current' ? 'est_discount_pct' : 'discount_pct', 'est_discount_pct']].forEach(([from, to]) => { const v = numOf((d || {})[from]); if (v != null) o[to] = v; }); return o; };
  const specRow = (r) => ({ band: r.band || '', desc: r.desc, day: r.day, from: r.from, to: r.to, dur: +r.dur || 30, tvr: +r.tvr || 0, spots: +r.spots || 0, card: +r.card || 0, rate: r.kind === 'bonus' ? 0 : +r.rate || 0 });
  const monthLabel = () => (D.month === 'all' ? 'All months' : D.month);
  const TITLE = { current: 'CURRENT AGENCY ESTIMATE: EVALUATION', plan: 'OUR PLAN: EVALUATION' };
  /** The evaluation as built in Build evaluation, for the channels given. */
  function specEval(k, chs) {
    return { client: clientName(), title: TITLE[k], month: monthLabel(), prime: primeWindow(), channels: chs.map((ch) => { const e = EVS(k)[ch], rows = e.rows;
      return { name: tt(ch), deal: dealSpec(e.deal, k), basket: rows.filter((r) => r.kind === 'com').map(specRow), sponsorship: rows.filter((r) => r.kind === 'va').map(specRow), bonus: rows.filter((r) => r.kind === 'bonus').map(specRow) }; }) };
  }
  function specCurrent() {
    const built = builtChannels('current'), cur = D.current, order = cur.channels.map((c) => c.channel), by = (list, ch) => list.filter((x) => x.channel === ch);
    const eng = { client: clientName(), title: TITLE.current, month: monthLabel(), prime: primeWindow(), channels: order.filter((ch) => !built.includes(ch)).map((ch) => ({ name: tt(ch), deal: dealSpec({ investment: (st.deals[ch] || {}).investment, commercial_pct: (st.deals[ch] || {}).commercial_pct, prime_pct: (st.deals[ch] || {}).prime_pct, est_discount_pct: (st.deals[ch] || {}).discount_pct }, 'current'),
      basket: by(cur.rows, ch).map((r) => ({ band: r.pt ? 'PT' : 'NPT', desc: tt(r.program), day: r.days, from: r.start, to: r.end, dur: r.avg_dur, tvr: r.tvr, spots: r.spots, card: r.card30 || 0, rate: r.avg30 || 0 })), bonus: [],
      sponsorship: by(cur.sponsorship, ch).flatMap((x) => x.durs.map((q) => ({ desc: x.theme, day: '', from: '', to: '', dur: q.dur, tvr: x.tvr, spots: q.spots, card: q.value > 0 ? q.value / q.eq30 : 0, rate: q.spend / q.eq30 }))) })) };
    return { ...eng, channels: [...specEval('current', built).channels, ...eng.channels] };
  }
  function specPlan() {
    const built = builtChannels('plan'), { a } = planNumbers(), order = [...new Set(a.rows.map((r) => r.channel))];
    const eng = order.filter((ch) => !built.includes(ch)).map((ch) => ({ name: tt(ch), deal: dealSpec(st.ours[ch], 'plan'), sponsorship: [], bonus: [],
      basket: a.rows.filter((r) => r.channel === ch).map((r) => ({ band: r.pt ? 'PT' : 'NPT', desc: tt(r.program), day: r.days, from: r.start, to: r.end, dur: 30, tvr: r.tvr, spots: r.spots, card: r.card30 || 0, rate: r.neg30 || 0 })) }));
    return { client: clientName(), title: TITLE.plan, month: monthLabel(), prime: primeWindow(), channels: [...specEval('plan', built).channels, ...eng] };
  }
  /** The 30 second version: one row per programme, spots and rates as 30 second equivalents, and the real duration and spot count in the description. */
  function to30(rows) {
    const m = new Map();
    (rows || []).forEach((r) => { const k = [r.desc, r.band || '', r.day || '', r.from || '', r.to || ''].join('|'), eq = (+r.spots || 0) * ((+r.dur || 30) / 30); let g = m.get(k); if (!g) m.set(k, (g = { ...r, spots: 0, cost: 0, parts: [] }));
      g.spots += eq; g.cost += eq * (+r.rate || 0); g.parts.push(`${n0(r.dur)}s x ${n0(r.spots)}`); });
    return [...m.values()].map((g) => { const { cost, parts, ...r } = g; return { ...r, dur: 30, rate: g.spots > 0 ? cost / g.spots : 0, desc: `${g.desc} (${parts.join(', ')})` }; });
  }
  const thirtySec = (spec) => ({ ...spec, title: `${spec.title} (30 SEC BASIS)`, note: 'All spots and rates are 30 second equivalents. The real duration and spot count of each programme are in brackets after its name.', channels: spec.channels.map((c) => ({ ...c, basket: to30(c.basket), sponsorship: to30(c.sponsorship), bonus: to30(c.bonus) })) });
  async function sendSpec(kind, spec, b, thirty) {
    if (thirty) spec = thirtySec(spec);
    const txt = b ? b.textContent : '';
    try {
      if (!spec.channels.length) { App.toast('Nothing to export yet. Add rates so there are programmes.', 'error'); return; }
      if (b) { b.disabled = true; b.textContent = 'Building...'; }
      const res = await App.api.blob('/api/pitch/evaluation', { kind, spec, basis: thirty ? '30sec' : '' }); App.download(res.blob, res.name); App.toast('Evaluation downloaded. A copy is kept under Reports.', 'ok');
    } catch (e) { App.toast('The evaluation could not be built: ' + e.message, 'error'); } finally { if (b) { b.disabled = false; b.textContent = txt; } }
  }
  const downloadEval = (kind, thirty) => sendSpec(kind, { current: specCurrent, plan: specPlan }[kind](), $({ current: thirty ? '#ev-c30' : '#ev-c', plan: thirty ? '#ev-p30' : '#ev-p' }[kind]), thirty);

  /* ---------------------------------------------------------------- build evaluation: a card per channel, two evaluations */
  const uid = () => Math.random().toString(36).slice(2, 9);
  const calc = (r) => { const dur = +r.dur || 30, grp = (+r.tvr || 0) * (+r.spots || 0); return { grp, ngrp: (grp * dur) / 30, value: ((+r.card || 0) * (+r.spots || 0) * dur) / 30, cost: ((+r.rate || 0) * (+r.spots || 0) * dur) / 30 }; };
  const KIND = { current: 'Current agency estimate', plan: 'Our plan' };
  /** Totals of one channel's rows. Commercial = programmes; sponsorship items are paid; bonus programmes are free but count at rate card value. */
  function tally(rows) {
    const T = { cost: 0, value: 0, cv: 0, cc: 0, ngrp: 0, spots: 0, ptCost: 0, vaCost: 0, bonusValue: 0, bonusSpots: 0 };
    rows.forEach((r) => { const x = calc(r); T.cost += x.cost; T.value += x.value; T.ngrp += x.ngrp;
      if (r.kind === 'va') T.vaCost += x.cost; else if (r.kind === 'bonus') { T.bonusValue += x.value; T.bonusSpots += +r.spots || 0; } else { T.cv += x.value; T.cc += x.cost; T.spots += +r.spots || 0; if (r.band === 'PT') T.ptCost += x.cost; } });
    return T;
  }
  const isCom = (r) => r.kind === 'com';
  const catRow = (kind, c, rate) => ({ id: uid(), kind, band: c.pt ? 'PT' : 'NPT', desc: tt(c.program), day: c.days, from: c.start, to: c.end, dur: 30, tvr: c.tvr, spots: 1, card: c.card30 || 0, rate, key: c.key });
  const curRows = (ch) => D.current.rows.filter((r) => r.channel === ch).map((r) => ({ id: uid(), kind: 'com', band: r.pt ? 'PT' : 'NPT', desc: tt(r.program), day: r.days, from: r.start, to: r.end, dur: r.dur || r.avg_dur || 30, tvr: r.tvr, spots: r.spots, card: r.card30 || 0, rate: r.avg30 || 0, lm: r.avg30 || 0, key: r.key }))
    .concat(D.current.sponsorship.filter((x) => x.channel === ch).flatMap((x) => x.durs.map((q) => ({ id: uid(), kind: 'va', band: '', desc: x.theme, day: '', from: '', to: '', dur: q.dur, tvr: x.tvr, spots: q.spots, card: q.value > 0 && q.eq30 > 0 ? q.value / q.eq30 : 0, rate: q.eq30 > 0 ? q.spend / q.eq30 : 0, lm: q.eq30 > 0 ? q.spend / q.eq30 : 0 }))));
  const planRows = (ch) => planNumbers().a.rows.filter((r) => r.channel === ch).map((r) => ({ id: uid(), kind: 'com', band: r.pt ? 'PT' : 'NPT', desc: tt(r.program), day: r.days, from: r.start, to: r.end, dur: 30, tvr: r.tvr, spots: r.spots, card: r.card30 || 0, rate: r.neg30 || 0, key: r.key }));
  /** The commercial budget of the deal: the investment x the commercial share. */
  const comBudget = (d) => (numOf(d.investment) > 0 ? (d.investment * (numOf(d.commercial_pct) || 100)) / 100 : null);
  const bonusAllowed = (e) => { const bp = numOf(e.deal.bonus_pct) || 0; return (bp / 100) * e.rows.filter(isCom).reduce((a, r) => a + calc(r).value, 0); };
  /** Current: the rates follow the investment (it wins) or the estimated discount. Plan: our discount on the rate card. */
  /** Current agency estimate: 'investment' = I know what they paid (the discount follows), 'discount' = I know the discount (the investment follows). */
  const modeOf = (e) => e.mode || (numOf((e.deal || {}).investment) > 0 ? 'investment' : 'discount');
  function applyRates(k, ch) {
    const e = EVS(k)[ch]; if (!e) return; const d = e.deal || {}, com = e.rows.filter(isCom), rated = com.filter((r) => +r.card > 0), val = (list) => list.reduce((a, r) => a + calc(r).value, 0);
    if (k === 'current') {
      const cb = comBudget(d), unrated = com.filter((r) => !(+r.card > 0)).reduce((a, r) => a + calc(r).cost, 0), rack = val(rated), mode = modeOf(e); let disc = null;
      if (mode === 'investment') { if (cb != null && rack > 0) disc = 1 - Math.max(0, cb - unrated) / rack; } else if (numOf(d.est_discount_pct) != null) disc = d.est_discount_pct / 100;
      e.eff_discount = disc; if (disc != null) rated.forEach((r) => { r.rate = Math.round(r.card * (1 - Math.min(disc, 1)) * 100) / 100; });
    } else { const dsc = numOf(d.discount_pct); if (dsc != null && dsc > 0) rated.filter((r) => r.key).forEach((r) => { r.rate = Math.round(r.card * (1 - Math.min(dsc, 100) / 100) * 100) / 100; }); }
  }
  /** Free extra programmes up to the allowance: the most TVR for the rate card value first. */
  function suggestBonus(ch, e) {
    const allow = bonusAllowed(e); let used = tally(e.rows).bonusValue, n = 0; const have = new Set(e.rows.filter((r) => r.kind === 'bonus').map((r) => r.key));
    const cands = (D.catalogue[ch] || []).filter((c) => c.card30 > 0 && c.tvr > 0 && !have.has(c.key)).sort((a, b) => b.tvr / b.card30 - a.tvr / a.card30);
    for (const c of cands) { if (used + c.card30 > allow) continue; e.rows.push(catRow('bonus', c, 0)); used += c.card30; if (++n >= 12) break; }
    return n;
  }
  function ensure(k, ch) {
    const S = EVS(k); if (S[ch]) return S[ch];
    if (k === 'current') { const d = st.deals[ch] || {}; S[ch] = { mode: d.investment > 0 ? 'investment' : 'discount', deal: { investment: d.investment, est_discount_pct: d.discount_pct, commercial_pct: d.commercial_pct, prime_pct: d.prime_pct }, rows: curRows(ch) }; applyRates(k, ch); }
    else { S[ch] = { deal: { ...(st.ours[ch] || {}) }, rows: planRows(ch) }; suggestBonus(ch, S[ch]); }
    save(); return S[ch];
  }

  function build(out) {
    const kind = st.build_kind === 'plan' ? 'plan' : 'current', S = EVS(kind), chs = kind === 'plan' ? Object.keys(D.budgets) : D.current.channels.map((c) => c.channel);
    const stats = chs.map((ch) => ({ ch, e: S[ch] && S[ch].rows.length ? S[ch] : null })).map((x) => ({ ...x, T: x.e ? tally(x.e.rows) : null }));
    const built = stats.filter((x) => x.e), A = built.reduce((m, x) => { Object.keys(x.T).forEach((k) => { m[k] = (m[k] || 0) + x.T[k]; }); m.inv += numOf(x.e.deal.investment) || 0; return m; }, { inv: 0 });
    const roiC = (T) => (T.cc > 0 ? T.cv / T.cc : null), roiA = (T) => (T.cost > 0 ? T.value / T.cost : null), cprp = (T) => (T.ngrp > 0 ? T.cost / T.ngrp : null);
    out.innerHTML = card('Build evaluation', 'Two evaluations per channel, built the same way. <b>Current agency estimate</b>: the latest month\'s programmes from the LMRB, costed with the investment and the estimated discount. <b>Our plan</b>: programmes we pick at our own discount, plus bonus programmes. Press a channel card to build it.',
      `<div class="row" style="gap:10px;flex-wrap:wrap;align-items:center"><div class="seg" role="group" aria-label="Which evaluation"><button type="button" data-k="current" aria-pressed="${kind === 'current'}">Current agency estimate</button><button type="button" data-k="plan" aria-pressed="${kind === 'plan'}">Our plan</button></div>
        <button class="btn primary" type="button" id="bd-start">${kind === 'current' ? 'Start from the current buy' : 'Start from our plan'}</button><button class="btn" type="button" id="bd-xl" ${built.length ? '' : 'disabled'}>Download Excel (${built.length} channel${built.length === 1 ? '' : 's'})</button><button class="btn" type="button" id="bd-xl30" ${built.length ? '' : 'disabled'}>Download 30 sec version</button><button class="btn ghost danger" type="button" id="bd-clear" ${built.length ? '' : 'disabled'}>Clear this evaluation</button></div>
        <div class="muted small" style="margin-top:8px">${kind === 'current' ? 'Asks each channel\'s investment and estimated discount, then builds every channel from the LMRB (spots, average 30 sec rate and TVR).' : 'Asks each channel\'s investment, discount, commercial %, bonus % and prime %, then fills the programmes with the optimiser and suggests the bonus programmes.'}</div>`) +
      (built.length ? `<div class="kpis">${kind === 'current' ? kpi('Spots', n0(A.spots), `${built.length} channel${built.length === 1 ? '' : 's'} built`) : kpi('Investment entered', A.inv > 0 ? fmt.lkrc(A.inv) : 'none', `${built.length} channel${built.length === 1 ? '' : 's'} built`)}${kpi('Cost of the programmes', fmt.lkrc(A.cost))}${kpi('Rate card value', fmt.lkrc(A.value), A.bonusValue > 0 ? `bonus ${fmt.lkrc(A.bonusValue)} included` : '')}${kpi('GRPs (30 sec)', n1(A.ngrp), '', 'NGRP')}${kpi('CPRP', fmt.lkrc(cprp(A)), '30 sec basis', 'CPRP')}${kpi('ROI: commercial', xr(roiC(A)), '', 'ROI')}${kpi('ROI: all exposure', xr(roiA(A)), '', 'ROI')}</div>` : '') +
      `<div class="bd-cards" style="margin-top:16px">${stats.map(({ ch, e, T }) => `<button class="bd-card ${e ? 'built' : ''}" type="button" data-ch="${esc(ch)}"><span class="bd-h"><b>${esc(tt(ch))}</b><span class="badge ${e ? 'good' : ''}">${e ? 'built' : 'not started'}</span></span>
        ${e ? `<span class="bd-g">${kind === 'current' ? (modeOf(e) === 'investment' ? `<span>Investment entered</span><b>${n0(e.deal.investment)}</b><span>Roughly, discount</span><b>${T.cv > 0 ? pc((1 - T.cc / T.cv) * 100) : 'n/a'}</b>` : `<span>Discount entered</span><b>${numOf(e.deal.est_discount_pct) != null ? pc(e.deal.est_discount_pct) : 'not set'}</b><span>Roughly, invested (100%)</span><b>${n0(T.cc / ((numOf(e.deal.commercial_pct) || 100) / 100))}</b>`) : `<span>Investment</span><b>${numOf(e.deal.investment) > 0 ? n0(e.deal.investment) : 'not set'}</b>`}<span>Spots</span><b>${n0(T.spots)}</b><span>ROI all exposure</span><b>${xr(roiA(T))}</b><span>CPRP</span><b>${n0(cprp(T))}</b>${T.bonusSpots ? `<span>Bonus</span><b>${n0(T.bonusSpots)} spots</b>` : ''}</span>` : '<span class="muted small">Press to open the channel and build it.</span>'}<span class="sc-go">${e ? 'Edit' : 'Build'} &rarr;</span></button>`).join('')}</div>`;
    $$('.seg button', out).forEach((b) => { b.onclick = () => { st.build_kind = b.dataset.k; save(); build(out); }; });
    $$('.bd-card', out).forEach((b) => { b.onclick = () => chBuilder(kind, b.dataset.ch, out); });
    $('#bd-start').onclick = () => startDialog(kind, chs, out);
    $('#bd-xl30').onclick = () => sendSpec(kind, specEval(kind, builtChannels(kind).filter((c) => chs.includes(c))), $('#bd-xl30'), true);
    $('#bd-xl').onclick = () => sendSpec(kind, specEval(kind, builtChannels(kind).filter((c) => chs.includes(c))), $('#bd-xl'));
    $('#bd-clear').onclick = () => { if (!confirm(`Remove every channel of the ${KIND[kind]} evaluation?`)) return; st.evals[kind] = {}; save(); build(out); };
  }

  /** "Start from ...": the numbers of every channel in one place, then all the channels are built. */
  function startDialog(kind, chs, out) {
    if (kind === 'current') return startCurrentDialog(chs, out);
    const isCur = false, F = isCur ? [['discount_pct', 'Estimated discount %', 110, 'e.g. 70']]
      : [['investment', 'Investment (LKR)', 120, 'type it'], ['discount_pct', 'Our discount %', 80, 'rate card'], ['commercial_pct', 'Commercial %', 70, '100'], ['bonus_pct', 'Bonus %', 64, '0'], ['prime_pct', 'Prime %', 64, 'any']];
    const src = (ch) => (isCur ? st.deals[ch] : st.ours[ch]) || {};
    const m = App.modal(isCur ? 'Start from the current buy' : 'Start from our plan', `<p class="small muted">${isCur ? 'Everything comes from the LMRB: programmes, duration, spots and TVR. You only type the discount you think each channel gave. The estimate is then the rate card rate (at each programme\'s duration) less that discount, times the spots.' : 'The investment is what we put into the channel. Commercial % of it buys programmes at our discount; bonus % is the free extra programmes the channel gives (a share of the commercial rate card value). Leave a channel empty to keep the current agency\'s spend as its budget.'}</p>
      <div class="tbl-scroll"><table class="tbl" id="sd-t"><thead><tr><th>Channel</th>${F.map((f) => `<th class="num">${f[1]}</th>`).join('')}</tr></thead><tbody>${chs.map((ch) => `<tr><td><b>${esc(tt(ch))}</b></td>${F.map(([f, l, w, ph]) => `<td class="num"><input class="rt-in" type="number" min="0" step="any" data-ch="${esc(ch)}" data-f="${f}" value="${src(ch)[f] == null ? '' : esc(src(ch)[f])}" placeholder="${ph}" style="width:${w}px" aria-label="${l} for ${esc(tt(ch))}"></td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <div class="row" style="margin-top:12px"><button class="btn primary" id="sd-go" type="button">Build all channels</button><span class="small muted">This replaces any channel you built before in this evaluation.</span></div>`);
    $('#sd-go', m).onclick = async () => {
      const target = isCur ? st.deals : st.ours;
      chs.forEach((ch) => { const o = isCur ? { ...(st.deals[ch] || {}) } : {}; if (isCur) delete o.discount_pct; $$('input', m).filter((i) => i.dataset.ch === ch).forEach((i) => { if (i.value !== '' && +i.value >= 0) o[i.dataset.f] = +i.value; });
        if (isCur ? (o.investment > 0 || o.discount_pct !== undefined) : Object.keys(o).length) target[ch] = o; else delete target[ch]; delete EVS(kind)[ch]; });
      if (isCur) st.settings.current_basis = 'actual';
      save(); m.close(); await run();
      if (!D || D.empty) return; chs.forEach((ch) => ensure(kind, ch)); save(); const o2 = $('#pt-out'); if (o2 && st.tab === 'build') build(o2);
      App.toast(`${KIND[kind]} built for ${builtChannels(kind).length} channels. Press a channel to adjust it.`, 'ok');
    };
  }

  /** Current agency estimate: either type what they paid (the discount follows) or the discount (the investment follows). */
  function startCurrentDialog(chs, out) {
    let mode = chs.some((ch) => (st.deals[ch] || {}).investment > 0) ? 'investment' : 'discount';
    const F = () => (mode === 'investment' ? [['investment', 'Investment (LKR)', 130, 'what they paid'], ['commercial_pct', 'Commercial %', 80, '100']] : [['discount_pct', 'Estimated discount %', 120, 'e.g. 70'], ['commercial_pct', 'Commercial %', 90, '100']]);
    const m = App.modal('Start from the current buy', `<p class="small muted">Everything comes from the LMRB: programmes, duration, spots and TVR. Choose what you know about each channel.</p>
      <div class="seg" role="group" aria-label="What do you know"><button type="button" data-m="investment" aria-pressed="${mode === 'investment'}">I know the investment: find the discount</button><button type="button" data-m="discount" aria-pressed="${mode === 'discount'}">I know the discount: find the investment</button></div>
      <div id="sd-body" style="margin-top:12px"></div><div class="row" style="margin-top:12px"><button class="btn primary" id="sd-go" type="button">Build all channels</button><span class="small muted">This replaces any channel you built before in this evaluation.</span></div>`);
    const draw = () => { const f = F(); $$('.seg button', m).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.m === mode)));
      $('#sd-body', m).innerHTML = `<div class="muted small" style="margin-bottom:8px">${mode === 'investment' ? 'Type what each channel was paid. The rates are set so the commercial programmes add up to it (investment x commercial %), and the discount is worked out.' : 'Type the discount you think each channel gave. The rate card rate less that discount times the spots gives the cost of the programmes. If only part of the investment (say 80%) bought programmes, type it as Commercial % and the full investment is worked out.'}</div>
        <div class="tbl-scroll"><table class="tbl" id="sd-t"><thead><tr><th>Channel</th>${f.map((x) => `<th class="num">${x[1]}</th>`).join('')}</tr></thead><tbody>${chs.map((ch) => `<tr><td><b>${esc(tt(ch))}</b></td>${f.map(([k, l, w, ph]) => { const o = st.deals[ch] || {}; return `<td class="num"><input class="rt-in" type="number" min="0" step="any" data-ch="${esc(ch)}" data-f="${k}" value="${o[k] == null ? '' : esc(o[k])}" placeholder="${ph}" style="width:${w}px" aria-label="${l} for ${esc(tt(ch))}"></td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`; };
    $$('.seg button', m).forEach((b) => { b.onclick = () => { mode = b.dataset.m; draw(); }; }); draw();
    $('#sd-go', m).onclick = async () => {
      chs.forEach((ch) => { const o = {}; $$('input', m).filter((i) => i.dataset.ch === ch).forEach((i) => { if (i.value !== '' && +i.value >= 0) o[i.dataset.f] = +i.value; });
        const keep = { ...(st.deals[ch] || {}) }; if (mode === 'investment') { delete keep.discount_pct; } else { delete keep.investment; }
        const nd = { ...keep, ...o }; if (nd.investment > 0 || nd.discount_pct !== undefined) st.deals[ch] = nd; else delete st.deals[ch]; delete EVS('current')[ch]; });
      st.settings.current_basis = 'actual'; save(); m.close(); await run();
      if (!D || D.empty) return; chs.forEach((ch) => { ensure('current', ch).mode = mode; applyRates('current', ch); }); save(); const o2 = $('#pt-out'); if (o2 && st.tab === 'build') build(o2);
      App.toast(`Current agency estimate built for ${builtChannels('current').length} channels. Press a channel to see the ${mode === 'investment' ? 'discount' : 'investment'} and the programmes.`, 'ok');
    };
  }

  /** The channel's own window: its deal numbers, budget meters, a programme picker and the rows of the evaluation. */
  function chBuilder(kind, ch, out) {
    const e = ensure(kind, ch), isCur = kind === 'current', d = e.deal; let q = '';
    const old = $('#pt-ch-sheet'); if (old) old.remove();
    const ov = document.createElement('div'); ov.className = 'sheet-back'; ov.id = 'pt-ch-sheet'; ov.style.zIndex = 70; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-labelledby', 'cb-title'); const opener = document.activeElement;
    ov.innerHTML = `<div class="sheet pt-sheet"><div class="sheet-bar"><div class="grow"><h2 id="cb-title">${esc(tt(ch))}: ${KIND[kind]}</h2><div class="muted small">${isCur ? 'Built from the LMRB. Enter the discount you estimate; the rest follows.' : 'Our rates, our programmes, and the bonus programmes the channel gives.'}</div></div><div class="row"><button class="btn" id="cb-undo" type="button" disabled>Undo</button><button class="btn" id="cb-reset" type="button">Start this channel again</button><button class="btn primary" id="cb-xl" type="button">Download this channel (Excel)</button><button class="btn" id="cb-xl30" type="button">30 sec version</button><button class="btn" id="cb-x" type="button">Done</button></div></div><div class="sheet-body"><div id="cb-body"></div></div></div>`;
    document.body.appendChild(ov);
    const close = () => { document.removeEventListener('keydown', onKey); ov.remove(); if (opener && opener.focus && document.contains(opener)) opener.focus(); if (!isCur) { run(); return; } if (out && st.tab === 'build' && $('#pt-out')) build($('#pt-out')); };
    const onKey = (ev) => { if (ev.key === 'Escape' && !document.querySelector('.modal-back')) { ev.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    $('#cb-x', ov).onclick = close; ov.addEventListener('mousedown', (ev) => { if (ev.target === ov) close(); });
    $('#cb-xl30', ov).onclick = () => sendSpec(kind, specEval(kind, [ch]), $('#cb-xl30', ov), true);
    $('#cb-xl', ov).onclick = () => sendSpec(kind, specEval(kind, [ch]), $('#cb-xl', ov));
    $('#cb-reset', ov).onclick = () => { if (!confirm('Go back to the starting point of this channel? Your changes to its rows are lost.')) return; delete EVS(kind)[ch]; save(); const n = ensure(kind, ch); Object.assign(e, n); paint(); };
    const body = $('#cb-body', ov);
    // undo: the state before every change is kept, newest last
    const hist = []; let lastSnap = 0;
    const state = () => JSON.stringify({ deal: e.deal, rows: e.rows, mode: e.mode });
    const sync = () => { const u = $('#cb-undo', ov); if (u) u.disabled = !hist.length; };
    const snap = () => { const j = state(); if (hist[hist.length - 1] !== j) { hist.push(j); if (hist.length > 40) hist.shift(); } sync(); };
    const undo = () => { while (hist.length) { const j = hist.pop(); if (j !== state()) { const o = JSON.parse(j); Object.keys(d).forEach((k) => delete d[k]); Object.assign(d, o.deal); e.rows = o.rows; e.mode = o.mode;
        if (!isCur) { const so = {}; ['investment', 'commercial_pct', 'prime_pct', 'discount_pct', 'bonus_pct'].forEach((k) => { if (numOf(d[k]) != null) so[k] = +d[k]; }); if (Object.keys(so).length) st.ours[ch] = so; else delete st.ours[ch]; }
        save(); paint(); sync(); return; } } sync(); };
    $('#cb-undo', ov).onclick = undo;
    ov.addEventListener('keydown', (ev) => { if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z' && !ev.shiftKey && !(ev.target.type === 'text' || ev.target.type === 'search')) { ev.preventDefault(); undo(); } });

    const meter = (label, used, cap, note) => { const pct = cap > 0 ? Math.min((used / cap) * 100, 100) : 0, over = cap > 0 && used > cap * 1.005; return `<div class="pt-meter ${over ? 'over' : ''}"><div class="pt-m-h"><span>${label}</span><b>${n0(used)}${cap > 0 ? ' of ' + n0(cap) : ''}</b></div><div class="pt-m-b"><i style="width:${pct}%"></i></div><div class="sub">${over ? 'Over the budget by ' + n0(used - cap) + '. ' : cap > 0 ? n0(Math.max(0, cap - used)) + ' left. ' : ''}${note || ''}</div></div>`; };
    const top = () => {
      const T = tally(e.rows), cb = comBudget(d), pp = numOf(d.prime_pct), inv = numOf(d.investment), bp = numOf(d.bonus_pct), disc = T.cv > 0 ? 1 - T.cc / T.cv : null;
      return `<div class="kpis">${kpi('Cost', fmt.lkrc(T.cost), `programmes ${fmt.lkrc(T.cc)}${T.vaCost ? ` · sponsorship ${fmt.lkrc(T.vaCost)}` : ''}`)}${kpi('Rate card value', fmt.lkrc(T.value), T.bonusValue > 0 ? `bonus ${fmt.lkrc(T.bonusValue)} included` : 'commercial + sponsorship')}${kpi('Discount vs rate card', disc == null ? 'n/a' : pc(disc * 100), 'commercial programmes')}${kpi('GRPs (30 sec)', n1(T.ngrp), '', 'NGRP')}${kpi('CPRP', fmt.lkrc(T.ngrp > 0 ? T.cost / T.ngrp : null), '30 sec basis', 'CPRP')}${kpi('ROI: commercial', xr(T.cc > 0 ? T.cv / T.cc : null), '', 'ROI')}${kpi('ROI: all exposure', xr(T.cost > 0 ? T.value / T.cost : null), '', 'ROI')}</div>
        <div class="bd-meters">${cb != null ? meter('Commercial benefits (programmes)', T.cc, cb, `${pc(numOf(d.commercial_pct) || 100)} of the investment`) : ''}${cb != null && pp ? meter('Prime time', T.ptCost, (cb * pp) / 100, `${pc(pp)} of the commercial money`) : ''}${inv != null && (numOf(d.commercial_pct) || 100) < 100 ? meter('Sponsorship items (the rest of the investment)', T.vaCost, inv - cb, 'add the items below') : ''}${!isCur && bp ? meter('Bonus (free, at rate card value)', T.bonusValue, bonusAllowed(e), `${pc(bp)} of the commercial rate card value`) : ''}${cb == null ? '<div class="muted small">Type the investment above to see the budget meters.</div>' : ''}</div>`;
    };
    const dealBar = () => { const f = (k, l, ph, w) => `<div class="field"><label>${l}</label><input class="cb-d rt-in" type="number" min="0" step="any" data-f="${k}" value="${d[k] == null ? '' : esc(d[k])}" placeholder="${ph}" style="width:${w}px"></div>`;
      return `<div class="pt-bar">${f('investment', 'Investment (LKR)', 'type it', 130)}${isCur ? f('est_discount_pct', 'Estimated discount %', 'e.g. 70', 96) : f('discount_pct', 'Our discount %', 'rate card', 96)}${f('commercial_pct', 'Commercial %', '100', 84)}${f('prime_pct', 'Prime share %', 'any', 84)}${isCur ? '' : f('bonus_pct', 'Bonus %', '0', 76)}</div>
        <div class="muted small">${isCur ? 'The investment wins: rates are set so the programmes add up to the investment x commercial %. With only a discount, the rate is the rate card less the discount.' : 'Our rates are the rate card less our discount. Bonus programmes cost nothing and count at rate card value, up to the bonus % of the commercial rate card value.'}</div>`; };
    let onlyCur = false, sortBy = 'cur';
    /** TVR programmes the current agency already has in its schedule (this advertiser, month and filters): spots and durations. */
    const used = () => { const m = new Map(); D.current.rows.filter((r) => r.channel === ch).forEach((r) => { const u = m.get(r.key) || { spots: 0, parts: [] }; u.spots += r.spots; u.parts.push(`${n0(r.dur)}s x ${n0(r.spots)}`); m.set(r.key, u); }); return m; };
    /** Best value: a TVR at least the channel's median with the lowest CPRP at our rate; the gap between the rate card and our rate breaks ties. */
    const valueOf = (c) => { const rate = c.neg30 > 0 ? c.neg30 : c.card30 > 0 ? c.card30 : 0; return { rate, cprp: rate > 0 && c.tvr > 0 ? rate / c.tvr : null, gap: c.card30 > 0 && c.neg30 > 0 ? (1 - c.neg30 / c.card30) * 100 : null }; };
    const picks = () => { const L = (D.catalogue[ch] || []).filter((c) => c.tvr > 0 && valueOf(c).cprp != null), tv = L.map((c) => c.tvr).sort((x, y) => x - y), med = tv.length ? tv[Math.floor(tv.length / 2)] : 0;
      return L.filter((c) => c.tvr >= med).sort((x, y) => valueOf(x).cprp - valueOf(y).cprp || (valueOf(y).gap || 0) - (valueOf(x).gap || 0)).slice(0, 6); };
    const picker = () => {
      const have = new Map(); e.rows.forEach((r) => { if (r.key) have.set(r.key + '|' + r.kind, (have.get(r.key + '|' + r.kind) || 0) + 1); });
      const cur = used(), nCur = (D.catalogue[ch] || []).filter((c) => cur.has(c.key)).length, top = picks(), topKeys = new Set(top.map((c) => c.key));
      const cmp = { cur: (x, y) => (cur.has(y.key) ? 1 : 0) - (cur.has(x.key) ? 1 : 0) || y.tvr - x.tvr, value: (x, y) => (valueOf(x).cprp || 1e18) - (valueOf(y).cprp || 1e18), tvr: (x, y) => y.tvr - x.tvr, gap: (x, y) => (valueOf(y).gap || -1) - (valueOf(x).gap || -1) }[sortBy];
      const list = (D.catalogue[ch] || []).filter((c) => (!q || tt(c.label).toLowerCase().includes(q.toLowerCase())) && (!onlyCur || cur.has(c.key))).sort(cmp).slice(0, 60);
      const pickCard = (c) => { const v = valueOf(c), u = cur.get(c.key); return `<div class="pk"><div class="pk-h"><b>${esc(tt(c.program))}</b><span class="badge">${c.pt ? 'Prime' : 'Non prime'}</span></div><div class="sub">${esc(c.days)} ${esc(c.start || '')}${u ? ` · current agency: ${n0(u.spots)} spots` : ''}</div>
        <div class="pk-g"><span>TVR</span><b>${n2(c.tvr)}</b><span>CPRP</span><b>${n0(v.cprp)}</b><span>Rate card</span><b>${n0(c.card30)}</b><span>Our rate</span><b>${n0(c.neg30)}</b></div><div class="pk-s">${v.gap == null ? '' : `Saves <b>${pc(v.gap)}</b> on the rate card`}</div>
        <div class="row" style="gap:6px"><button class="btn sm primary" type="button" data-add="${esc(c.key)}">Add</button>${isCur ? '' : `<button class="btn sm" type="button" data-bonus="${esc(c.key)}">Bonus</button>`}</div></div>`; };
      return `<div class="card" style="margin-top:16px"><div class="card-head"><div><h3>Add programmes</h3><div class="sub">Every TVR programme of this channel, with its CPRP at our rate. <span class="badge good">Current agency</span> marks the programmes the current agency already has in its schedule (${n0(nCur)} of ${n0((D.catalogue[ch] || []).length)}), with their spots.</div></div></div>
        ${top.length ? `<h4 class="cv-h" style="margin-top:6px">Best value on this channel</h4><div class="muted small" style="margin-bottom:8px">Programmes with a TVR of at least the channel's median and the lowest CPRP at our rate. The bigger the gap between the rate card and our rate, the better the deal.</div><div class="pk-row">${top.map(pickCard).join('')}</div>` : ''}
        <div class="row" style="gap:10px;flex-wrap:wrap;margin:14px 0 6px;align-items:end"><label class="small">Sort by <select id="cb-sort" aria-label="Sort programmes">${[['cur', 'Current agency first'], ['value', 'Best value (lowest CPRP)'], ['tvr', 'Highest TVR'], ['gap', 'Biggest saving on the rate card']].map(([k, l]) => `<option value="${k}" ${sortBy === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label><label class="row small" style="gap:6px"><input type="checkbox" id="cb-cur" ${onlyCur ? 'checked' : ''}> Only programmes the current agency used</label><input id="cb-q" type="search" placeholder="Search a programme" value="${esc(q)}" style="max-width:240px" aria-label="Search programmes"></div>
        <div class="tbl-scroll"><table class="tbl"><thead><tr><th>Programme (TVR name)</th><th>Time</th><th class="num">TVR</th><th class="num">Rate card 30 sec</th><th class="num">${isCur ? 'Rate 30 sec' : 'Our rate 30 sec'}</th><th class="num">Saving</th><th class="num">CPRP</th><th>Current agency</th><th></th></tr></thead><tbody>${list.map((c) => { const u = cur.get(c.key), v = valueOf(c);
          return `<tr><td><span class="pn"><b>${esc(tt(c.program))}</b><span class="sub">${esc(c.days)} ${esc(c.start || '')}${topKeys.has(c.key) ? ' · <b>best value</b>' : ''}${have.get(c.key + '|com') ? ` · in basket x${have.get(c.key + '|com')}` : ''}${have.get(c.key + '|bonus') ? ' · bonus' : ''}</span></span></td><td><span class="badge">${c.pt ? 'Prime' : 'Non prime'}</span></td><td class="num">${n2(c.tvr)}</td><td class="num">${c.card30 > 0 ? n0(c.card30) : '<span class="muted">no rate</span>'}</td><td class="num">${c.neg30 > 0 ? n0(c.neg30) : ''}</td><td class="num">${v.gap == null ? '' : pc(v.gap)}</td><td class="num">${v.cprp == null ? '' : n0(v.cprp)}</td>
          <td>${u ? `<span class="badge good">${n0(u.spots)} spots</span><span class="sub">${esc(u.parts.join(', '))}</span>` : '<span class="muted">not used</span>'}</td>
          <td class="num"><button class="btn sm" type="button" data-add="${esc(c.key)}">Add</button>${isCur ? '' : ` <button class="btn sm" type="button" data-bonus="${esc(c.key)}" ${c.card30 > 0 ? '' : 'disabled'}>Add as bonus</button>`}</td></tr>`; }).join('') || '<tr><td colspan="9" class="muted">No programme matches.</td></tr>'}</tbody></table></div></div>`;
    };
    const grpFoot = (rows) => { const T = tally(rows.map((r) => ({ ...r, kind: r.kind === 'va' ? 'va' : 'com' }))); return `<tr class="ex-tot"><td>Total</td><td></td><td class="num">${n2(T.ngrp && rows.reduce((a, r) => a + (+r.spots || 0), 0) ? rows.reduce((a, r) => a + (+r.tvr || 0) * (+r.spots || 0), 0) / rows.reduce((a, r) => a + (+r.spots || 0), 0) : 0)}</td><td class="num">${n0(rows.reduce((a, r) => a + (+r.spots || 0), 0))}</td><td></td><td></td><td class="num">${n0(T.value)}</td><td class="num">${n0(T.cost)}</td><td class="num">${n1(T.ngrp)}</td><td class="num"><b>${n0(T.ngrp > 0 ? T.cost / T.ngrp : null)}</b></td><td></td></tr>`; };
    const GROUPS_OF = { pt: () => e.rows.filter((r) => isCom(r) && r.band === 'PT'), npt: () => e.rows.filter((r) => isCom(r) && r.band !== 'PT'), va: () => e.rows.filter((r) => r.kind === 'va'), bonus: () => e.rows.filter((r) => r.kind === 'bonus') };
    const rowTbl = (gid, title, rows, note) => `<div class="card" style="margin-top:16px"><div class="card-head"><div><h3>${title}</h3>${note ? `<div class="sub">${note}</div>` : ''}</div></div><div class="tbl-scroll"><table class="tbl bd-tbl"><thead><tr><th>Programme</th><th class="num">Dur</th><th class="num">TVR</th><th class="num">Spots</th><th class="num">Rate card (this dur)</th><th class="num">${isCur ? 'Negotiated (this dur)' : 'Our rate (this dur)'}</th><th class="num">Value</th><th class="num">Cost</th><th class="num">GRP</th><th class="num">CPRP</th><th></th></tr></thead>${rows.length ? `<tfoot data-g="${gid}">${grpFoot(rows)}</tfoot>` : ''}<tbody>
      ${rows.map((r) => { const inp = (f, w) => `<input class="bd-in" type="number" min="0" step="any" data-id="${r.id}" data-f="${f}" ${f === 'card' || f === 'rate' ? 'data-conv="1"' : ''} value="${esc(r[f] == null ? '' : f === 'card' || f === 'rate' ? Math.round((r[f] * (+r.dur || 30)) / 30 * 100) / 100 : r[f])}" style="width:${w}px" aria-label="${f}">`; const derived = isCur && isCom(r) && e.eff_discount != null && r.card > 0;
        return `<tr data-row="${r.id}"><td>${r.kind === 'va' ? `<input class="bd-in" type="text" data-id="${r.id}" data-f="desc" value="${esc(r.desc)}" style="width:170px" aria-label="Sponsorship item">` : `<span class="pn"><b>${esc(r.desc)}</b><span class="sub">${esc(r.day || '')} ${esc(r.from || '')}${r.to ? '-' + esc(r.to) : ''}</span></span>`}</td><td class="num">${inp('dur', 44)}</td><td class="num">${inp('tvr', 54)}</td><td class="num">${inp('spots', 52)}</td><td class="num">${inp('card', 78)}</td>
          <td class="num" data-c="rate">${r.kind === 'bonus' ? '<span class="muted">free</span>' : derived ? n0((r.rate * (+r.dur || 30)) / 30) : inp('rate', 78)}</td><td class="num" data-c="value"></td><td class="num" data-c="cost"></td><td class="num" data-c="grp"></td><td class="num" data-c="cprp"></td><td><button class="btn sm ghost danger" type="button" data-rm="${r.id}" aria-label="Remove row">x</button></td></tr>`; }).join('') || '<tr><td colspan="11" class="muted">Nothing here yet.</td></tr>'}</tbody></table></div></div>`;
    const paintNums = () => {
      e.rows.forEach((r) => { const x = calc(r), tr = body.querySelector(`tr[data-row="${r.id}"]`); if (!tr) return; const dd = +r.dur || 30, why = (k, t) => { const c = tr.querySelector(`[data-c=${k}]`); if (c) c.title = t; };
        why('value', `Rate card ${n0(r.card)} (30 sec) x ${n0(r.spots)} spots x ${n0(dd)}/30 = ${n0(x.value)}`); why('cost', r.kind === 'bonus' ? 'Bonus: free' : `Rate ${n0(r.rate)} (30 sec) x ${n0(r.spots)} spots x ${n0(dd)}/30 = ${n0(x.cost)}`); why('grp', `TVR ${n2(r.tvr)} x ${n0(r.spots)} spots = ${n1(x.grp)}`); why('cprp', `Cost ${n0(x.cost)} / NGRP ${n1(x.ngrp)} (TVR x spots x ${n0(dd)}/30)`);
        tr.querySelector('[data-c=value]').textContent = n0(x.value); tr.querySelector('[data-c=cost]').textContent = n0(x.cost); tr.querySelector('[data-c=grp]').textContent = n1(x.grp); tr.querySelector('[data-c=cprp]').textContent = x.ngrp > 0 && r.kind !== 'bonus' ? n0(x.cost / x.ngrp) : '';
        const rc = tr.querySelector('[data-c=rate]'); if (rc && r.kind !== 'bonus') { const ri = rc.querySelector('input'); const rd = Math.round((r.rate * (+r.dur || 30)) / 30 * 100) / 100; if (!ri) rc.textContent = n0(rd); else if (document.activeElement !== ri) ri.value = rd; } });
      $$('tfoot[data-g]', body).forEach((f) => { const l = GROUPS_OF[f.dataset.g](); f.innerHTML = l.length ? grpFoot(l) : ''; });
      const t = $('#cb-top', body); if (t) t.innerHTML = top();
    };
    function curView() {
      const T = tally(e.rows), com = e.rows.filter(isCom), lmCost = e.rows.reduce((a, r) => a + ((+r.lm || 0) * (+r.spots || 0) * (+r.dur || 30)) / 30, 0), real = T.cv > 0 ? 1 - T.cc / T.cv : null, mode = modeOf(e), cp = numOf(d.commercial_pct) || 100;
      const line = (r) => { const x = calc(r), c = x.ngrp > 0 ? x.cost / x.ngrp : null; return `<tr><td><span class="pn"><b>${esc(r.desc)}</b><span class="sub">${esc(r.day || '')} ${esc(r.from || '')}${r.to ? '-' + esc(r.to) : ''}</span></span></td><td class="num">${n0(r.dur)}s</td><td class="num">${n0(r.spots)}</td><td class="num">${n2(r.tvr)}</td><td class="num">${n1(x.grp)}</td><td class="num">${r.card > 0 ? n0((r.card * r.dur) / 30) : '<span class="muted">no rate</span>'}</td><td class="num">${n0((r.rate * r.dur) / 30)}</td><td class="num">${n0(x.cost)}</td><td class="num">${c == null ? '' : n0(c)}</td></tr>`; };
      const tot = (rows, label) => { const t = tally(rows.map((r) => ({ ...r, kind: 'com' }))), sp = rows.reduce((a, r) => a + (+r.spots || 0), 0); return `<tr class="ex-tot"><td>${label}</td><td></td><td class="num">${n0(sp)}</td><td class="num">${n2(sp > 0 ? rows.reduce((a, r) => a + (+r.tvr || 0) * (+r.spots || 0), 0) / sp : 0)}</td><td class="num">${n1(rows.reduce((a, r) => a + calc(r).grp, 0))}</td><td></td><td></td><td class="num">${n0(t.cost)}</td><td class="num">${n0(t.ngrp > 0 ? t.cost / t.ngrp : null)}</td></tr>`; };
      const head = '<thead><tr><th>Programme</th><th class="num">Dur</th><th class="num">Spots</th><th class="num">TVR</th><th class="num">GRP</th><th class="num">Rate card</th><th class="num">Negotiated</th><th class="num">Cost</th><th class="num">CPRP</th></tr></thead>';
      const block = (title, rows) => (rows.length ? `<h4 class="cv-h">${title}</h4><div class="tbl-scroll"><table class="tbl cv-tbl">${head}<tbody>${rows.map(line).join('')}</tbody><tfoot>${tot(rows, 'Total')}</tfoot></table></div>` : '');
      const va = e.rows.filter((r) => r.kind === 'va'), srt = (l) => l.slice().sort((a, b) => String(a.desc).localeCompare(String(b.desc)) || b.dur - a.dur);
      const progCost = T.cc, rough = progCost / (cp / 100), inv = rough, res = mode === 'investment' ? `<div class="cv-res"><span>Roughly, the discount was</span><b>${real == null ? 'n/a' : pc(real * 100)}</b><span>they pay ${real == null ? 'n/a' : pc(100 - real * 100)} of the rate card</span></div>` : `<div class="cv-res"><span>Roughly, they invested (100%)</span><b>${fmt.lkrc(rough)}</b><span>programmes ${fmt.lkrc(progCost)}${cp < 100 ? ` / ${pc(cp)} commercial = ${fmt.lkrc(rough)}` : ' (all of the investment)'}</span>${T.vaCost ? `<span>Sponsorship items (${fmt.lkrc(T.vaCost)} in the LMRB) are not counted here.</span>` : ''}</div>`;
      body.innerHTML = `<div class="seg" role="group" aria-label="What do you know" style="margin-bottom:14px"><button type="button" data-m="investment" aria-pressed="${mode === 'investment'}">I know the investment: find the discount</button><button type="button" data-m="discount" aria-pressed="${mode === 'discount'}">I know the discount: find the investment</button></div>
        <div class="cv-top"><div>${mode === 'investment' ? `<div class="field"><label for="cv-i">Investment (LKR)</label><input id="cv-i" class="cb-d rt-in" type="number" min="0" step="any" data-f="investment" value="${d.investment == null ? '' : esc(d.investment)}" placeholder="what they paid"></div><div class="field" style="margin-top:8px"><label for="cv-c">Commercial %</label><input id="cv-c" class="cb-d rt-in" type="number" min="0" max="100" step="any" data-f="commercial_pct" value="${d.commercial_pct == null ? '' : esc(d.commercial_pct)}" placeholder="100"></div>` : `<div class="field"><label for="cv-d">Estimated discount %</label><input id="cv-d" class="cb-d rt-in" type="number" min="0" max="100" step="any" data-f="est_discount_pct" value="${d.est_discount_pct == null ? '' : esc(d.est_discount_pct)}" placeholder="e.g. 70"></div><div class="field" style="margin-top:8px"><label for="cv-c2">Commercial % (what share of the investment bought programmes)</label><input id="cv-c2" class="cb-d rt-in" type="number" min="1" max="100" step="any" data-f="commercial_pct" value="${d.commercial_pct == null ? '' : esc(d.commercial_pct)}" placeholder="100"></div>`}${res}</div>
        <div class="cv-k"><div><span>Spots</span><b>${n0(T.spots)}</b></div><div><span>Cost at this discount</span><b>${fmt.lkrc(T.cost)}</b></div><div><span>Cost in the LMRB sheet</span><b>${fmt.lkrc(lmCost)}</b></div><div><span>Rate card value</span><b>${fmt.lkrc(T.value)}</b></div><div><span>Discount (programmes)</span><b>${real == null ? 'n/a' : pc(real * 100)}</b></div><div><span>GRPs (30 sec)</span><b>${n1(T.ngrp)}</b></div><div><span>CPRP</span><b>${fmt.lkrc(T.ngrp > 0 ? T.cost / T.ngrp : null)}</b></div><div><span>ROI commercial</span><b>${xr(T.cc > 0 ? T.cv / T.cc : null)}</b></div><div><span>ROI all exposure</span><b>${xr(T.cost > 0 ? T.value / T.cost : null)}</b></div></div></div>
        ${e.eff_discount == null ? `<div class="banner info"><span>${mode === 'investment' ? 'No investment entered yet, so the rates are what the LMRB sheet shows. Type what they paid to find the discount.' : 'No discount entered yet, so the rates are what the LMRB sheet shows. Type a discount to find roughly what they invested.'}</span></div>` : ''}
        ${block('Prime time programmes', srt(com.filter((r) => r.band === 'PT')))}${block('Non prime time programmes', srt(com.filter((r) => r.band !== 'PT')))}
        ${va.length ? `<h4 class="cv-h">Sponsorship items</h4><div class="tbl-scroll"><table class="tbl cv-tbl"><thead><tr><th>Item</th><th class="num">Dur</th><th class="num">Spots</th><th class="num">Cost</th></tr></thead><tbody>${va.map((r) => `<tr><td><b>${esc(r.desc)}</b></td><td class="num">${n0(r.dur)}s</td><td class="num">${n0(r.spots)}</td><td class="num">${n0(calc(r).cost)}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
    }
    function paint() {
      if (isCur) { curView(); return; }
      const com = e.rows.filter(isCom), pt = com.filter((r) => r.band === 'PT'), npt = com.filter((r) => r.band !== 'PT');
      body.innerHTML = dealBar() + `<div id="cb-top" style="margin-top:12px">${top()}</div>
        <div class="row" style="gap:10px;flex-wrap:wrap;margin-top:12px">${isCur ? '' : '<button class="btn" type="button" id="cb-opt">Fill the programmes with the optimiser</button><button class="btn" type="button" id="cb-bon">Suggest bonus programmes</button>'}<button class="btn" type="button" id="cb-va">Add a sponsorship item</button></div>
        ${picker()}${rowTbl('pt', 'Prime time programmes', pt)}${rowTbl('npt', 'Non prime time programmes', npt)}${rowTbl('va', 'Sponsorship items you add', e.rows.filter((r) => r.kind === 'va'), 'Paid items (billboards, tags, time checks). They are costed at the rate you give and count in all exposure ROI.')}${isCur ? '' : rowTbl('bonus', 'Bonus programmes', e.rows.filter((r) => r.kind === 'bonus'), 'Free extra programmes. They cost nothing and count at rate card value.')}`;
      paintNums();
    }
    body.onchange = (ev) => { const t = ev.target; if (!t.classList.contains('cb-d')) return; snap(); if (t.value === '') delete d[t.dataset.f]; else d[t.dataset.f] = +t.value; if (!isCur) { const o = {}; ['investment', 'commercial_pct', 'prime_pct', 'discount_pct', 'bonus_pct'].forEach((k) => { if (numOf(d[k]) != null) o[k] = +d[k]; }); if (Object.keys(o).length) st.ours[ch] = o; else delete st.ours[ch]; } const was = e.eff_discount != null; applyRates(kind, ch); save(); if (isCur || (e.eff_discount != null) !== was) paint(); else paintNums(); };
    body.oninput = (ev) => { const t = ev.target;
      if (t.id === 'cb-q') { q = t.value; const pos = t.selectionStart; const host = $('#cb-q', body).closest('.card'); const tmp = document.createElement('div'); tmp.innerHTML = picker(); host.replaceWith(tmp.firstElementChild); const nq = $('#cb-q', body); nq.focus(); nq.setSelectionRange(pos, pos); return; }
      if (t.id === 'cb-sort') { sortBy = t.value; const host = $('#cb-q', body).closest('.card'), tmp = document.createElement('div'); tmp.innerHTML = picker(); host.replaceWith(tmp.firstElementChild); return; }
      if (t.id === 'cb-cur') { onlyCur = t.checked; const host = $('#cb-q', body).closest('.card'), tmp = document.createElement('div'); tmp.innerHTML = picker(); host.replaceWith(tmp.firstElementChild); return; }
      if (!t.dataset || !t.dataset.id) return; if (Date.now() - lastSnap > 1000) snap(); lastSnap = Date.now(); const r = e.rows.find((x) => x.id === t.dataset.id); if (!r) return; r[t.dataset.f] = t.type === 'number' ? (t.value === '' ? 0 : t.dataset.conv ? (+t.value * 30) / (+r.dur || 30) : +t.value) : t.value;
      if (isCur && t.dataset.f === 'card') applyRates(kind, ch); save(); paintNums(); };
    body.onclick = (ev) => {
      const g = (a) => ev.target.closest(`[${a}]`); if (ev.target.closest('button')) snap();
      const mb = g('data-m'); if (mb && isCur) { const T0 = tally(e.rows), to = mb.dataset.m; if (to !== modeOf(e)) { e.mode = to;
        if (to === 'discount' && numOf(d.est_discount_pct) == null && e.eff_discount != null) d.est_discount_pct = Math.round(e.eff_discount * 1000) / 10;
        if (to === 'investment' && !(numOf(d.investment) > 0)) { d.investment = Math.round(T0.cost); if (T0.vaCost > 0 && T0.cost > 0) d.commercial_pct = Math.round((T0.cc / T0.cost) * 1000) / 10; } applyRates(kind, ch); save(); paint(); } return; }
      let b = g('data-rm'); if (b) { e.rows = e.rows.filter((x) => x.id !== b.dataset.rm); save(); applyRates(kind, ch); paint(); return; }
      b = g('data-add'); if (b) { const c = (D.catalogue[ch] || []).find((x) => x.key === b.dataset.add); if (c) { const ex = e.rows.find((r) => r.key === c.key && isCom(r)); if (ex) ex.spots = (+ex.spots || 0) + 1; else e.rows.push(catRow('com', c, c.neg30 || c.card30 || 0)); applyRates(kind, ch); save(); paint(); } return; }
      b = g('data-bonus'); if (b) { const c = (D.catalogue[ch] || []).find((x) => x.key === b.dataset.bonus); if (c) { const ex = e.rows.find((r) => r.key === c.key && r.kind === 'bonus'); if (ex) ex.spots = (+ex.spots || 0) + 1; else e.rows.push(catRow('bonus', c, 0)); save(); paint(); } return; }
      if (ev.target.closest('#cb-va')) { e.rows.push({ id: uid(), kind: 'va', band: '', desc: 'Sponsorship item', day: 'Daily', from: '', to: '', dur: 10, tvr: 0, spots: 0, card: 0, rate: 0 }); save(); paint(); return; }
      if (ev.target.closest('#cb-bon')) { if (!(numOf(d.bonus_pct) > 0)) { App.toast('Type the bonus % first.', 'error'); return; } const n = suggestBonus(ch, e); save(); paint(); App.toast(n ? `${n} bonus programme${n === 1 ? '' : 's'} added. Change the spots or remove any you do not want.` : 'The bonus allowance is already used, or no programme fits.', n ? 'ok' : 'error'); return; }
      if (ev.target.closest('#cb-opt')) { const cap = comBudget(d) != null ? comBudget(d) : D.budgets[ch]; if (!(cap > 0)) { App.toast('This channel has no budget. Type the investment first.', 'error'); return; }
        const a = window.MR.pitchAllocate(D.candidates.filter((c) => c.channel === ch), { [ch]: cap }, st.excluded, st.settings.objective);
        if (!a.rows.length) { App.toast('No programme of this channel has a rate yet.', 'error'); return; }
        e.rows = e.rows.filter((r) => !isCom(r)).concat(a.rows.map((r) => ({ id: uid(), kind: 'com', band: r.pt ? 'PT' : 'NPT', desc: tt(r.program), day: r.days, from: r.start, to: r.end, dur: 30, tvr: r.tvr, spots: r.spots, card: r.card30 || 0, rate: r.neg30, key: r.key }))); applyRates(kind, ch); save(); paint(); }
    };
    paint(); const first = $('.cb-d', body) || $('#cb-x', ov); if (first) first.focus();
  }

  /* ---------------------------------------------------------------- 7 matches */
  const progOf = (key) => String(key || '').split('|')[1] || '';
  /** Remember what you approved: every name in the slot is the TVR programme chosen, in any slot, in any month. */
  function learn(slot, tvrKey) {
    const prog = progOf(tvrKey); if (!prog) return;
    (slot.names || []).forEach((n) => { const t = window.MR.pitchPrep(n.name).text; if (t) st.learned[`${slot.channel}|${t}`] = prog; });
  }
  function unlearn(slot) { (slot.names || []).forEach((n) => { delete st.learned[`${slot.channel}|${window.MR.pitchPrep(n.name).text}`]; }); }
  /** LMRB programmes that sit in the same time slot (same channel, start time and days: for example many movie titles) are one row, matched once. */
  function matches(out) {
    const slots = D.slots || [], f = st.match_filter, need = slots.filter((x) => !x.approved && !x.ignored), high = need.filter((x) => x.level === 'High' && x.tvr_key);
    const shown = f === 'all' ? slots : f === 'approved' ? slots.filter((x) => x.approved || x.ignored) : need;
    out.innerHTML = card('Review matches', `${fmt.num(D.matches.length)} LMRB programmes sit in ${fmt.num(slots.length)} time slots. Programmes with the same channel, start time and days (for example many movie titles) are one row: match the row once and every name inside it follows. Every name is compared with every TVR programme of its channel by <b>time</b> (its slot, or how close its start is), <b>name</b> (spelling, how it sounds, repeats like "- RPT", words in a different order, initials) and <b>kind</b> (a movie, the news, kids, music). The best five are listed for each row, with the reason. <b>Approve</b> keeps a match as correct and remembers those names for next time; pick another TVR programme from the list to correct it. Your choices are saved for this client.`,
      `<div class="row" style="margin-bottom:8px;gap:10px;flex-wrap:wrap"><div class="seg" id="mt-f"><button type="button" data-k="review" aria-pressed="${f !== 'all' && f !== 'approved'}">To check (${need.length})</button><button type="button" data-k="approved" aria-pressed="${f === 'approved'}">Approved (${slots.length - need.length})</button><button type="button" data-k="all" aria-pressed="${f === 'all'}">All (${slots.length})</button></div>
        <button class="btn primary" type="button" id="mt-high" ${high.length ? '' : 'disabled'}>Approve all high confidence (${high.length})</button></div><div id="mt-a"></div>`);
    $$('#mt-f button').forEach((b) => { b.onclick = () => { st.match_filter = b.dataset.k; save(); render(); }; });
    $('#mt-high').onclick = () => { high.forEach((x) => { st.mappings['SLOT|' + x.key] = x.tvr_key; learn(x, x.tvr_key); }); save(); App.toast(`${high.length} matches approved.`, 'ok'); run(); };
    table('mt-a', $('#mt-a'), { csv: 'pitch_matches', defaultSort: { key: 'spend', desc: true }, empty: f === 'review' ? 'Every time slot is approved.' : 'Nothing to show.', pageSize: 15, rows: shown.map((x) => ({ ...x, ch: tt(x.channel), slot: `${x.days || 'any day'} ${x.start || ''}`.trim() })), columns: [
      { key: 'ch', label: 'Channel' }, { key: 'slot', label: 'Time slot' },
      { key: 'n_names', label: 'Programmes in the slot', num: true, html: (v, x) => `<details><summary>${esc(x.names.slice(0, 2).map((n) => tt(n.name)).join(', '))}${v > 2 ? ` <span class="muted">+${v - 2} more</span>` : ''}</summary><div class="small" style="max-height:200px;overflow:auto">${x.names.map((n) => `${esc(tt(n.name))} <span class="muted">(${fmt.num(n.spots)} spots)</span>`).join('<br>')}${v > x.names.length ? `<br><span class="muted">and ${v - x.names.length} more</span>` : ''}</div></details>` },
      { key: 'spots', label: 'Spots', num: true, fmt: n0 }, { key: 'spend', label: 'Spend (LKR)', num: true, fmt: n0 },
      { key: 'tvr_program', label: 'Matched TVR programme', html: (v, x) => `<select data-mk="${esc(x.key)}" aria-label="TVR programme for the slot ${esc(x.days)} ${esc(x.start)}"><option value="">${x.approved || x.ignored ? 'Automatic (undo)' : esc(v ? `${tt(v)} (${x.tvr_start || ''})` : '(no match)')}</option>${x.approved ? `<option value="${esc(x.tvr_key)}" selected>${esc(`${tt(v)} (${x.tvr_start || ''})`)}</option>` : ''}${x.ignored ? '<option value="-" selected>Ignore this slot</option>' : '<option value="-">Ignore this slot</option>'}${(x.suggestions || []).filter((g) => g.key !== x.tvr_key || !x.approved).length ? `<optgroup label="Best suggestions">${(x.suggestions || []).map((g) => `<option value="${esc(g.key)}">${esc(`${tt(g.program)} (${g.start || ''}, ${g.days}) ${g.confidence}%`)}</option>`).join('')}</optgroup>` : ''}<optgroup label="All programmes of the channel">${((D.catalogue[x.channel]) || []).map((c) => `<option value="${esc(c.key)}">${esc(tt(c.label))}</option>`).join('')}</optgroup></select>` },
      { key: 'confidence', label: 'Confidence and why', num: true, html: (v, x) => `<span class="badge ${x.approved ? 'good' : x.level === 'High' ? 'good' : x.level === 'None' ? 'bad' : ''}">${x.approved ? 'Approved' : x.ignored ? 'Ignored' : x.level + (x.level === 'None' ? '' : ' ' + v + '%')}</span>${x.reason && !x.approved ? `<div class="small muted" style="max-width:260px;white-space:normal">${esc(x.reason)}</div>` : ''}` },
      { key: 'approved', label: 'Approve', sortable: false, html: (v, x) => (x.approved || x.ignored ? `<button class="btn sm" type="button" data-undo="${esc(x.key)}">Undo</button>` : x.tvr_key ? `<button class="btn sm primary" type="button" data-ok="${esc(x.key)}" data-to="${esc(x.tvr_key)}">Approve</button>` : '') }] });
    $('#mt-a').onchange = (e) => { const k = e.target.dataset && e.target.dataset.mk; if (!k) return; const sl = (D.slots || []).find((x) => x.key === k); if (e.target.value) { st.mappings['SLOT|' + k] = e.target.value; if (sl && e.target.value !== '-') learn(sl, e.target.value); } else { delete st.mappings['SLOT|' + k]; if (sl) unlearn(sl); } save(); run(); };
    $('#mt-a').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; const sl = (D.slots || []).find((x) => x.key === (b.dataset.ok || b.dataset.undo)); if (b.dataset.ok) { st.mappings['SLOT|' + b.dataset.ok] = b.dataset.to; if (sl) learn(sl, b.dataset.to); save(); run(); } else if (b.dataset.undo) { delete st.mappings['SLOT|' + b.dataset.undo]; if (sl) unlearn(sl); save(); run(); } };
  }

  /* ---------------------------------------------------------------- 8 rates */
  function rates(out) {
    const chs = D.tvr_channels, R = st.rates, N = st.nego;
    const chanRow = (ch) => { const c = R.channels[ch] || {}, rule = N.channels[ch] || {}; const inp = (b, k, v) => `<input class="rt-in" type="number" min="0" step="any" data-ch="${esc(ch)}" data-b="${b}" data-k="${k}" value="${v == null ? '' : esc(v)}" aria-label="${esc(ch)} ${b} ${k}">`;
      return `<tr><td><b>${esc(tt(ch))}</b></td><td>${inp('pt', 'rate', (c.pt || {}).rate)}</td><td>${inp('pt', 'secs', (c.pt || {}).secs || 30)}</td><td>${inp('npt', 'rate', (c.npt || {}).rate)}</td><td>${inp('npt', 'secs', (c.npt || {}).secs || 30)}</td>
        <td><select class="rt-ng" data-ch="${esc(ch)}" data-k="mode">${[['', 'Rate card / default'], ['none', 'No negotiation'], ['discount', 'Discount % off card']].map(([v, l]) => `<option value="${v}" ${(rule.mode || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
        <td><input class="rt-ng" type="number" min="0" step="any" data-ch="${esc(ch)}" data-k="value" value="${rule.value == null ? '' : esc(rule.value)}" aria-label="${esc(ch)} negotiation value"></td></tr>`; };
    const d = N.default || { mode: 'none', value: 0 };
    out.innerHTML = card('Rates and negotiation', `Card rates can be typed per programme (table below), or once per channel for prime and non prime time. A rate typed for 10 or 15 seconds is converted to 30 seconds. Then pick how we negotiate: a discount % off the card (rate card discounts, such as 73%, mean you pay 27% of the rack rate), or a special 30 sec rate for one programme. ${tip('30s')}`,
      `<div class="pt-bar"><div class="field"><label>Default negotiation (all channels)</label><select id="rt-dm">${[['none', 'No negotiation (card rate)'], ['discount', 'Discount % off card']].map(([v, l]) => `<option value="${v}" ${d.mode === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="field"><label>Value (% or LKR)</label><input id="rt-dv" type="number" min="0" step="any" value="${esc(d.value || 0)}"></div><div class="field"><label>&nbsp;</label><button class="btn" type="button" id="rt-add">Add a rate</button></div></div>
      <h4 style="margin:14px 0 6px">Channel rates (30 sec equivalent is worked out)</h4><div class="tbl-scroll"><table class="tbl"><thead><tr><th>Channel</th><th class="num">Prime rate</th><th class="num">Prime: for secs</th><th class="num">Non prime rate</th><th class="num">Non prime: for secs</th><th>Negotiation</th><th class="num">Value</th></tr></thead><tbody>${chs.map(chanRow).join('')}</tbody></table></div>
      <h4 style="margin:18px 0 6px">Programme rates</h4><div class="row" style="gap:14px;margin-bottom:8px"><label class="row small" style="gap:4px"><input type="checkbox" id="rt-ob" ${st.only_buy ? 'checked' : ''}> Only programmes in the current buy</label><label class="row small" style="gap:4px"><input type="checkbox" id="rt-om" ${st.only_missing ? 'checked' : ''}> Only programmes without a card rate</label></div><div id="rt-a"></div>`);
    $('#rt-dm').onchange = (e) => { N.default = { mode: e.target.value, value: +$('#rt-dv').value || 0 }; save(); run(); };
    $('#rt-dv').onchange = (e) => { N.default = { mode: $('#rt-dm').value, value: +e.target.value || 0 }; save(); run(); };
    $('#rt-add').onclick = addRateDialog;
    $('#pt-out').onchange = (e) => {
      const t = e.target, ch = t.dataset.ch; if (ch && t.classList.contains('rt-in')) { const b = t.dataset.b, c = (R.channels[ch] = R.channels[ch] || {}), x = (c[b] = c[b] || { rate: 0, secs: 30 }); x[t.dataset.k] = +t.value || (t.dataset.k === 'secs' ? 30 : 0); if (!(c.pt && c.pt.rate) && !(c.npt && c.npt.rate)) delete R.channels[ch]; save(); sources(); run(); return; }
      if (ch && t.classList.contains('rt-ng')) { const r = (N.channels[ch] = N.channels[ch] || {}); r[t.dataset.k] = t.dataset.k === 'value' ? +t.value || 0 : t.value; if (!r.mode) delete N.channels[ch]; save(); run(); return; }
      if (t.dataset.pk) { const k = t.dataset.pk, [what] = [t.dataset.w]; if (what === 'rate' || what === 'secs') { const cur = R.programmes[k] || { rate: 0, secs: 30 }; cur[what] = +t.value || (what === 'secs' ? 30 : 0); if (cur.rate > 0) R.programmes[k] = cur; else delete R.programmes[k]; } else { const r = (N.programmes[k] = N.programmes[k] || {}); r[what] = what === 'value' ? +t.value || 0 : t.value; if (!r.mode) delete N.programmes[k]; } save(); sources(); run(); }
      if (t.id === 'rt-ob') { st.only_buy = t.checked; save(); render(); } if (t.id === 'rt-om') { st.only_missing = t.checked; save(); render(); }
    };
    const rows = D.rates.filter((r) => (!st.only_buy || r.in_buy) && (!st.only_missing || !(r.card30 > 0))).map((r) => { const k = `${r.channel}|${r.program}`, pr = R.programmes[k] || {}, ng = N.programmes[k] || {}; return { ...r, ch: tt(r.channel), pr: tt(r.program), k, pr_rate: pr.rate, pr_secs: pr.secs || 30, ng_mode: ng.mode || '', ng_val: ng.value }; });
    table('rt-a', $('#rt-a'), { csv: 'pitch_rates', pageSize: 20, defaultSort: { key: 'tvr', desc: true }, empty: 'No programmes. Upload the TVR sheet.', rows, columns: [
      { key: 'pr', label: 'Programme (TVR name)', html: (v, r) => `<span class="pn"><b>${esc(v)}</b><span class="sub">${esc(r.days)} ${esc(r.start)} · ${esc(r.daypart)}</span></span>` }, { key: 'ch', label: 'Channel' }, { key: 'tvr', label: 'TVR', num: true, fmt: n2 },
      { key: 'pr_rate', label: 'Type a card rate, for how many seconds', num: true, html: (v, r) => `<span class="row" style="gap:4px;flex-wrap:nowrap;justify-content:flex-end"><input class="rt-in" type="number" min="0" step="any" style="width:84px" data-pk="${esc(r.k)}" data-w="rate" value="${v == null ? '' : esc(v)}" aria-label="Card rate for ${esc(r.pr)}"><select style="width:56px" data-pk="${esc(r.k)}" data-w="secs" aria-label="Seconds">${[10, 15, 20, 30, 45, 60].map((x) => `<option ${x === +r.pr_secs ? 'selected' : ''}>${x}</option>`).join('')}</select></span>` },
      { key: 'card30', label: 'Card 30 sec rate and where from', num: true, html: (v, r) => `${n0(v)}<span class="sub" ${r.card_prog ? `title="${esc('Rate card: ' + r.card_prog + ' (' + (r.card_eff || '') + ')')}"` : ''}>${r.card_src ? esc(r.card_src) + (r.card_prog ? ': ' + esc(tt(r.card_prog)) : '') : 'no rate'}</span>` },
      { key: 'ng_mode', label: 'Negotiation', html: (v, r) => `<span class="row" style="gap:4px;flex-wrap:nowrap"><select style="width:104px" data-pk="${esc(r.k)}" data-w="mode" aria-label="Negotiation for ${esc(r.pr)}">${[['', 'Default'], ['discount', 'Discount %'], ['special', 'Special rate']].map(([x, l]) => `<option value="${x}" ${v === x ? 'selected' : ''}>${l}</option>`).join('')}</select><input class="rt-in" type="number" min="0" step="any" style="width:70px" data-pk="${esc(r.k)}" data-w="value" value="${r.ng_val == null ? '' : esc(r.ng_val)}" aria-label="Negotiation value for ${esc(r.pr)}"></span>` },
      { key: 'neg30', label: 'Negotiated 30 sec', num: true, fmt: n0 }, { key: 'paid30', label: 'Effective: agency paid', num: true, fmt: n0 }, { key: 'saving_pct', label: 'Saving vs card', num: true, fmt: pc }, { key: 'saving_vs_paid_pct', label: 'Saving vs agency', num: true, fmt: pc }] });
  }

  /* ================================================================ boot */
  function boot() {
    root = $('#ws'); load(); App.loader.show('Initialising', 'Opening your data vault in this browser');
    App.shell.init('pitch').then(async () => {
      if (!App.clientId()) { App.loader.hide(0); App.shell.noClient(root); return; }
      try { await App.data.open(); status = await App.data.status(); await refreshRC(); load(); shell(); sources(); filters(); await run(); } catch (e) { root.innerHTML = App.emptyState('Could not open the data vault', e.message); }
      App.loader.hide(0);
    });
  }
  boot();
})(window.App);
