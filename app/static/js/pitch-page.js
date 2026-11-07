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
  const DEF = () => ({ month: null, channels: [], daypart: 'all', tab: 'overview', settings: { pt_start: '19:00', pt_end: '22:30', min_tvr: 1, max_spots: 2, budget_basis: 'com' },
    rates: { programmes: {}, channels: {} }, nego: { default: { mode: 'none', value: 0 }, channels: {}, programmes: {} }, mappings: {}, excluded: [], rates_file: '', only_buy: true, only_missing: false, match_filter: 'review' });
  let st = DEF(), D = null, root = null, status = null, seq = 0, tabTables = {};
  const load = () => { try { const v = App.store.get(KEY(), null); st = { ...DEF(), ...(v || {}), settings: { ...DEF().settings, ...((v || {}).settings || {}) } }; } catch (e) { st = DEF(); } };
  const save = () => { try { App.store.set(KEY(), st); } catch (e) { /* storage blocked */ } };
  const sec = (hm) => { const [h, m] = String(hm).split(':').map(Number); return (h || 0) * 3600 + (m || 0) * 60; };
  const opts = () => ({ month: st.month, channels: st.channels, daypart: st.daypart, pt_start: sec(st.settings.pt_start), pt_end: sec(st.settings.pt_end), min_tvr: +st.settings.min_tvr, max_spots: +st.settings.max_spots,
    budget_basis: st.settings.budget_basis, mappings: st.mappings, rates: st.rates, nego: st.nego, excluded: st.excluded });
  const loadXlsx = () => (window.XLSX ? Promise.resolve(window.XLSX) : new Promise((ok, no) => { const s = document.createElement('script'); s.src = '/js/vendor/xlsx.full.min.js'; s.onload = () => ok(window.XLSX); s.onerror = () => no(new Error('The Excel library could not load.')); document.head.appendChild(s); }));
  const SHEET = { lmrb: 'LMRB sheet', tv: 'TVR sheet' };
  const TABS = [['overview', 'Spend overview'], ['basket', 'Current basket'], ['daypart', 'Daypart view'], ['plan', 'Our recommended basket'], ['compare', 'Comparison'], ['export', 'Export'], ['matches', 'Review matches'], ['rates', 'Rates and negotiation']];

  /* ================================================================ shell */
  function shell() {
    root.innerHTML = `<div class="card" id="pt-src"></div>
      <div class="card" id="pt-filters" style="margin-top:16px"></div>
      <div id="pt-warn" style="margin-top:16px"></div>
      <div class="seg pt-tabs" id="pt-tabs" role="tablist" style="margin-top:16px">${TABS.map(([k, l]) => `<button type="button" role="tab" data-t="${k}" aria-pressed="${k === st.tab}">${esc(l)}</button>`).join('')}</div>
      <div id="pt-out" style="margin-top:16px"></div>`;
    $$('#pt-tabs button').forEach((b) => { b.onclick = () => { st.tab = b.dataset.t; save(); $$('#pt-tabs button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); render(); }; });
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
        <div class="up-slot ${st.rates_file ? 'loaded' : ''}" data-kind="rates"><div class="up-t">Rate card file</div><div class="up-meta">${st.rates_file ? esc(st.rates_file) + `<br><span class="muted small">${fmt.num(nProg)} programme rates</span>` : 'Columns: Channel, Programme, Rate, Seconds. Rates for 10 or 15 sec are converted to 30 sec.'}</div>
          <div class="row" style="gap:6px;margin-top:8px"><button class="btn sm" type="button" id="pt-ratefile">${st.rates_file ? 'Replace' : 'Choose file'}</button><button class="btn sm" type="button" id="pt-tpl">Template</button></div><input type="file" accept=".csv,.xlsx,.xls" hidden id="pt-ratein"></div>
        <div class="up-slot ${nProg + nChan ? 'loaded' : ''}" data-kind="manual"><div class="up-t">Manual rate input</div><div class="up-meta">Type a 30 sec rate where the rate card has none: for one programme, or one prime / non prime rate for a whole channel.<br><span class="muted small">${fmt.num(nProg)} programme rates, ${fmt.num(nChan)} channel rates saved</span></div>
          <div class="row" style="gap:6px;margin-top:8px"><button class="btn sm primary" type="button" id="pt-addrate">Add a rate</button><button class="btn sm" type="button" id="pt-paste">Paste from Excel</button></div></div></div>`;
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
    const chs = (D && D.tvr_channels) || [], months = (D && D.months) || [], cur = D ? D.month : null;
    $('#pt-filters').innerHTML = `<div class="pt-bar"><div class="field"><label for="pf-m">Month</label><select id="pf-m"><option value="all" ${cur === 'all' ? 'selected' : ''}>All months</option>${months.slice().reverse().map((m) => `<option ${m === cur ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
      <div data-ms="pch"></div><div class="field"><label>Prime / non prime ${tip('PT')}</label><div class="seg" id="pf-dp">${[['all', 'All'], ['PT', 'Prime'], ['NPT', 'Non prime']].map(([k, l]) => `<button type="button" data-k="${k}" aria-pressed="${st.daypart === k}">${l}</button>`).join('')}</div></div>
      <div class="field"><label>&nbsp;</label><button class="btn" type="button" id="pf-set">Settings</button></div></div>
      <div class="muted small" style="margin-top:6px">Client: <b>${esc(((App.shell.client() || {}).name) || 'none selected')}</b>. Change the client in the left menu: each client keeps its own files, rates and match fixes. Only channels in the TVR sheet are evaluated.</div>`;
    const again = App.debounce(() => { save(); run(); }, 250);
    const m = App.filters.multi({ key: 'channels', label: 'Channel' }, chs, st, again); m.dataset.ms = 'pch'; $('[data-ms="pch"]').replaceWith(m);
    $('#pf-m').onchange = (e) => { st.month = e.target.value; save(); run(); };
    $$('#pf-dp button').forEach((b) => { b.onclick = () => { st.daypart = b.dataset.k; save(); run(); }; });
    $('#pf-set').onclick = settingsDialog;
  }
  function settingsDialog() {
    const s = st.settings;
    const m = App.modal('Settings', `<div class="grid g2"><div class="field"><label>Prime time starts ${tip('PT')}</label><input id="se-p0" type="time" value="${esc(s.pt_start)}"></div><div class="field"><label>Prime time ends</label><input id="se-p1" type="time" value="${esc(s.pt_end)}"></div>
      <div class="field"><label>Minimum TVR for our plan</label><input id="se-tvr" type="number" min="0" step="0.1" value="${esc(s.min_tvr)}"></div><div class="field"><label>Most spots per episode in our plan</label><input id="se-ms" type="number" min="1" step="1" value="${esc(s.max_spots)}"></div>
      <div class="field"><label>Our plan is compared with</label><select id="se-b"><option value="com" ${s.budget_basis === 'com' ? 'selected' : ''}>Programme basket only (commercial spots)</option><option value="all" ${s.budget_basis === 'all' ? 'selected' : ''}>All exposure (commercial + sponsorship items)</option></select></div></div>
      <p class="small muted">Budget per channel = what the current agency spent on that channel (same basis as the choice above). Tax (VAT, SSCL) is not included anywhere.</p><div class="row" style="margin-top:10px"><button class="btn primary" id="se-go" type="button">Save</button></div>`);
    $('#se-go', m).onclick = () => { Object.assign(st.settings, { pt_start: $('#se-p0', m).value || '19:00', pt_end: $('#se-p1', m).value || '22:30', min_tvr: +$('#se-tvr', m).value || 0, max_spots: Math.max(1, +$('#se-ms', m).value || 1), budget_basis: $('#se-b', m).value }); save(); m.close(); run(); };
  }

  /* ================================================================ run */
  async function run() {
    const my = ++seq, out = $('#pt-out');
    if (!status || !status.lmrb || !status.tv) { D = null; filters(); $('#pt-warn').innerHTML = `<div class="banner info"><span>Upload the client's LMRB sheet and the TVR sheet above to start, or press <b>Load sample data</b> to see how it works.</span></div>`; out.innerHTML = App.emptyState('Nothing to evaluate yet', 'Both sheets are needed: LMRB for what was bought, TVR for the audience each programme delivered.'); return; }
    out.innerHTML = App.skeleton(3);
    let d; try { d = await App.data.pitchBuild({ options: opts() }); } catch (e) { out.innerHTML = App.emptyState('The evaluation could not be built', e.message); return; }
    if (my !== seq) return;
    D = d; if (!st.month || st.month === 'null') st.month = d.month; filters(); warnings(); render();
  }
  function warnings() {
    const w = D.warnings, b = [];
    if (w.no_medium) b.push('This LMRB sheet was loaded before TV and radio were separated, so radio rows may be counted. Upload it again for a clean TV-only view.');
    if (w.unmatched_programmes) b.push(`${w.unmatched_programmes} LMRB programme${w.unmatched_programmes === 1 ? '' : 's'} (LKR ${fmt.num(w.unmatched_spend)}) could not be matched to a TVR programme and ${w.unmatched_programmes === 1 ? 'is' : 'are'} left out of the TVR numbers. Fix them in <b>Review matches</b>.`);
    if (w.missing_rate_programmes) b.push(`${w.missing_rate_programmes} programme${w.missing_rate_programmes === 1 ? '' : 's'} you bought (LKR ${fmt.num(w.missing_rate_spend)}) have no rate card rate, so ROI leaves them out. Add rates in <b>Rates and negotiation</b>.`);
    if (w.zero_tvr_rows) b.push(`${fmt.num(w.zero_tvr_rows)} TVR row${w.zero_tvr_rows === 1 ? ' has' : 's have'} a TVR of zero. They count as zero in the average TVR.`);
    if (w.skipped_channels.length) b.push(`Channels not in the TVR sheet, skipped: ${w.skipped_channels.slice(0, 6).map((c) => `${esc(tt(c.channel))} (LKR ${fmt.num(c.spend)})`).join(', ')}.`);
    if (D.comparison.current.left_out && D.comparison.current.left_out.length) b.push(`No plan can be built yet for ${D.comparison.current.left_out.map((c) => esc(tt(c))).join(', ')}: add a rate for at least one of their programmes. The comparison covers the other channels only.`);
    $('#pt-warn').innerHTML = b.map((x) => `<div class="banner"><span>${x}</span></div>`).join('');
  }
  function render() {
    const out = $('#pt-out'); if (!D) return; tabTables = {};
    if (D.empty) { out.innerHTML = App.emptyState('No TV spots for this choice', 'Pick another month or clear the channel and prime / non prime filters.'); return; }
    ({ overview, basket, daypart, plan, compare, export: exportTab, matches, rates })[st.tab](out);
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
  function basket(out) {
    const cur = D.current, rows = cur.rows, cprps = rows.map((r) => r.cprp).filter((v) => v > 0).sort((a, b) => a - b), cut = cprps.length ? cprps[Math.floor(cprps.length * 0.8)] : Infinity;
    const chRows = cur.channels.map((c) => ({ ...c, name: tt(c.channel) }));
    out.innerHTML = `<div class="kpis">${kpi('Spend', fmt.lkrc(cur.com_spend), 'commercial spots')}${kpi('Spots', fmt.num(cur.spots), `${n1(cur.eq30)} as 30 sec ${tip('30s')}`)}${kpi('Average 30 sec rate', fmt.lkrc(cur.avg30), 'cost / 30 sec equivalents')}
      ${kpi('Average CPRP', fmt.lkrc(cur.cprp), 'cost per rating point (30 sec)', 'CPRP')}${kpi('GRPs (30 sec)', n1(cur.ngrp), 'TVR x 30 sec equivalents', 'NGRP')}
      ${kpi('ROI: commercial only', xr(cur.com_roi), 'rate card value / spend', 'ROI')}${kpi('ROI: all exposure', xr(cur.all_roi), 'includes sponsorship items', 'ROI')}${kpi('Spend with a rate', cur.rated_pct == null ? 'n/a' : pc(cur.rated_pct), 'ROI uses these rows only')}</div>
      <div style="margin-top:16px" id="bk-0"></div><div id="bk-1"></div><div id="bk-2"></div>`;
    $('#bk-0').innerHTML = card('Current evaluation by channel', 'What each channel cost, and what it would have cost at rate card prices. ROI = rate card value / spend. All exposure adds the sponsorship items.', '<div id="bk-a"></div>');
    table('bk-a', $('#bk-a'), { search: false, csv: 'pitch_channel_roi', defaultSort: { key: 'spend', desc: true }, rows: chRows, columns: [{ key: 'name', label: 'Channel' }, { key: 'com_spend', label: 'Commercial only spend', num: true, fmt: n0 }, { key: 'spend', label: 'All exposure spend (com + VA)', num: true, fmt: n0 },
      { key: 'com_value', label: 'Rate card value: com', num: true, fmt: n0 }, { key: 'all_value', label: 'Rate card value: all', num: true, fmt: n0 }, { key: 'com_roi', label: 'ROI com only', num: true, fmt: xr }, { key: 'all_roi', label: 'ROI all exposure', num: true, fmt: xr }, { key: 'rated_pct', label: 'Spend with a rate', num: true, fmt: pc }] });
    $('#bk-1').innerHTML = card('Programme basket', `Programmes use their TVR names. The worst 20% by CPRP are shaded.`, '<div id="bk-b"></div>');
    table('bk-b', $('#bk-b'), { rowClass: (r) => (r.cprp >= cut ? 'worst' : ''), csv: 'pitch_current_basket', defaultSort: { key: 'cost', desc: true }, empty: 'No commercial spots here.',
      rows: rows.map((r) => ({ ...r, ch: tt(r.channel), pr: tt(r.program) })), columns: [{ key: 'pr', label: 'Programme (TVR name)' }, { key: 'ch', label: 'Channel' }, { key: 'start', label: 'Starts' }, { key: 'daypart', label: 'Daypart' }, { key: 'spots', label: 'Spots', num: true, fmt: n0 }, { key: 'eq30', label: '30 sec eq.', num: true, fmt: n1 }, { key: 'cost', label: 'Cost (LKR)', num: true, fmt: n0 },
        { key: 'avg30', label: 'Avg 30 sec rate', num: true, fmt: n0 }, { key: 'tvr', label: 'TVR', num: true, fmt: n2 }, { key: 'ngrp', label: 'GRPs (30 sec)', num: true, fmt: n1 }, { key: 'cprp', label: 'CPRP', num: true, fmt: n0 }, { key: 'card30', label: 'Card 30 sec rate', num: true, fmt: n0 }] });
    $('#bk-2').innerHTML = card('Sponsorship items (shown apart from the basket)', 'Spend, programme, channel and the TVR those items delivered.', '<div id="bk-c"></div>');
    table('bk-c', $('#bk-c'), { csv: 'pitch_sponsorship', defaultSort: { key: 'spend', desc: true }, empty: 'No sponsorship items in this view.', rows: cur.sponsorship.map((s) => ({ ...s, ch: tt(s.channel), pr: tt(s.program) })),
      columns: [{ key: 'ch', label: 'Channel' }, { key: 'pr', label: 'Programme (TVR name)' }, { key: 'theme', label: 'Sponsorship item' }, { key: 'spots', label: 'Spots', num: true, fmt: n0 }, { key: 'spend', label: 'Spend (LKR)', num: true, fmt: n0 }, { key: 'tvr', label: 'TVR delivered', num: true, fmt: n2 }, { key: 'grp', label: 'GRPs', num: true, fmt: n1 }, { key: 'cprp', label: 'CPRP', num: true, fmt: n0 }] });
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
  const allocate = () => window.MR.pitchAllocate(D.candidates, D.budgets, st.excluded);
  function planNumbers() { const a = allocate(), totals = window.MR.pitchPlanSummary(a.rows, D.budgets), cmp = { ...window.MR.pitchCompare(D.comparison.current, totals), current: D.comparison.current }; return { a, totals, cmp }; }
  function plan(out) {
    const s = st.settings;
    out.innerHTML = `<div class="card" style="margin-bottom:16px"><div class="card-head"><div><h3>Our recommended basket</h3><div class="sub">Same budget per channel as the current agency spent. Programmes are bought cheapest rating points first (lowest CPRP), at our negotiated 30 sec rates, up to the limit below. Switch a programme off to take it out; the totals update at once.</div></div></div>
      <div class="pt-bar"><div class="field"><label for="pl-t">Minimum TVR: <b id="pl-tv">${esc(s.min_tvr)}</b> ${tip('TVR')}</label><input id="pl-t" type="range" min="0" max="${Math.max(10, Math.ceil(Math.max(0, ...D.candidates.map((c) => c.tvr)) + 1))}" step="0.1" value="${esc(s.min_tvr)}"></div>
        <div class="field"><label for="pl-m">Most spots per episode: <b id="pl-mv">${esc(s.max_spots)}</b></label><input id="pl-m" type="range" min="1" max="8" step="1" value="${esc(s.max_spots)}"></div></div></div>
      <div id="pl-kpi"></div><div id="pl-ch" style="margin-top:16px"></div><div id="pl-tbl" style="margin-top:16px"></div>`;
    const slide = App.debounce(() => { save(); run(); }, 300);
    $('#pl-t').oninput = (e) => { s.min_tvr = +e.target.value; $('#pl-tv').textContent = s.min_tvr; slide(); };
    $('#pl-m').oninput = (e) => { s.max_spots = +e.target.value; $('#pl-mv').textContent = s.max_spots; slide(); };
    const rowsOf = () => { const a = allocate(), by = new Map(a.rows.map((r) => [r.key, r])); return D.candidates.map((c) => { const r = by.get(c.key), off = st.excluded.includes(c.key); return { ...c, ch: tt(c.channel), pr: tt(c.program), on: !off, spots: r ? r.spots : 0, spend: r ? r.spend : 0, grp: r ? r.grp : 0 }; }); };
    const paintTotals = () => {
      const { a, totals, cmp } = planNumbers();
      $('#pl-kpi').innerHTML = `<div class="kpis">${kpi('Budget (same as current)', fmt.lkrc(totals.budget))}${kpi('Planned spend', fmt.lkrc(totals.spend), totals.unspent > 0 ? `LKR ${fmt.num(totals.unspent)} unspent` : 'budget fully used')}${kpi('Spots (30 sec)', fmt.num(totals.spots))}${kpi('GRPs', n1(totals.ngrp), '', 'GRP')}${kpi('Average CPRP', fmt.lkrc(totals.cprp), '', 'CPRP')}${kpi('Gain in GRPs', cmp.grp_gain_pct == null ? 'n/a' : (cmp.grp_gain_pct > 0 ? '+' : '') + n1(cmp.grp_gain_pct) + '%', 'vs the current buy')}</div>`;
      const chRows = Object.entries(D.budgets).map(([ch, b]) => { const x = a.channels[ch] || { spend: 0, left: b, spots: 0, grp: 0 }; return { ch: tt(ch), budget: b, spend: x.spend, left: x.left, spots: x.spots, grp: x.grp }; });
      $('#pl-ch').innerHTML = card('Budget by channel', '', `<div class="tbl-scroll"><table class="tbl"><thead><tr><th>Channel</th><th class="num">Budget (LKR)</th><th class="num">Planned spend</th><th class="num">Unspent</th><th class="num">Spots</th><th class="num">GRPs</th></tr></thead><tbody>${chRows.map((r) => `<tr><td>${esc(r.ch)}</td><td class="num">${n0(r.budget)}</td><td class="num">${n0(r.spend)}</td><td class="num">${n0(r.left)}</td><td class="num">${n0(r.spots)}</td><td class="num">${n1(r.grp)}</td></tr>`).join('')}</tbody></table></div>`);
    };
    paintTotals();
    $('#pl-tbl').innerHTML = card('Programmes to buy', D.candidates.length ? 'On = in the plan. Programmes with no rate or a TVR below the minimum are not listed.' : 'No programme has a rate yet. Add rates in Rates and negotiation.', '<div id="pl-a"></div>');
    const t = table('pl-a', $('#pl-tbl #pl-a'), { rowClass: (r) => (r.on ? '' : 'off'), csv: 'pitch_plan', defaultSort: { key: 'cprp', desc: false }, empty: 'No programmes available.', rows: rowsOf(), columns: [
      { key: 'on', label: 'In plan', sortable: true, html: (v, r) => `<label class="row small" style="gap:4px"><input type="checkbox" data-k="${esc(r.key)}" ${v ? 'checked' : ''} aria-label="Include ${esc(r.pr)}"> ${v ? 'On' : 'Off'}</label>` },
      { key: 'pr', label: 'Programme (TVR name)' }, { key: 'ch', label: 'Channel' }, { key: 'start', label: 'Starts' }, { key: 'days', label: 'Days' }, { key: 'daypart', label: 'Daypart' }, { key: 'tvr', label: 'TVR', num: true, fmt: n2 }, { key: 'neg30', label: 'Our 30 sec rate', num: true, fmt: n0 }, { key: 'cprp', label: 'CPRP', num: true, fmt: n0 },
      { key: 'cap', label: 'Most spots', num: true, fmt: n0 }, { key: 'spots', label: 'Planned spots', num: true, fmt: n0 }, { key: 'spend', label: 'Planned spend', num: true, fmt: n0 }, { key: 'grp', label: 'GRPs', num: true, fmt: n1 }] });
    $('#pl-a').onchange = (e) => { const k = e.target.dataset && e.target.dataset.k; if (!k) return; const set = new Set(st.excluded); e.target.checked ? set.delete(k) : set.add(k); st.excluded = [...set]; save(); paintTotals(); t.refresh(rowsOf()); };
  }

  /* ---------------------------------------------------------------- 5 comparison */
  function compare(out) {
    const { totals: P, cmp } = planNumbers(), cur = D.comparison.current;
    const row = (label, a, b, f, g, better) => { const ch = a > 0 && b != null && a != null ? (b / a - 1) * 100 : null; return `<tr><td>${label}</td><td class="num">${f(a)}</td><td class="num"><b>${f(b)}</b></td><td class="num">${ch == null ? 'n/a' : `<span class="${better === 'lower' ? (ch < 0 ? 'good-t' : 'bad-t') : ch > 0 ? 'good-t' : 'bad-t'}">${ch > 0 ? '+' : ''}${fmt.num(ch, 1)}%</span>`}</td></tr>`; };
    out.innerHTML = `<div class="card pt-hero"><div class="muted small">The pitch in one line ${cur.channels && cur.channels.length ? `(channels: ${esc(cur.channels.map(tt).join(', '))})` : ''}</div><div class="pt-sentence" id="cm-s">${esc(cmp.sentence)}</div></div>
      <div class="grid g2" style="margin-top:16px"><div class="card"><h3>Current agency vs our plan</h3><div class="tbl-scroll"><table class="tbl" id="cm-t"><thead><tr><th>Measure</th><th class="num">Current agency</th><th class="num">Our plan</th><th class="num">Change</th></tr></thead><tbody>
        ${row('Total spend (LKR)', cur.spend, P.spend, n0, 0, 'same')}${row('Total spots (30 sec equivalent)', cur.eq30, P.eq30, n1, 0, 'higher')}${row('Total GRPs (30 sec) ' + tip('NGRP'), cur.ngrp, P.ngrp, n1, 0, 'higher')}${row('Average 30 sec rate (LKR)', cur.avg30, P.avg30, n0, 0, 'lower')}${row('Average CPRP (LKR) ' + tip('CPRP'), cur.cprp, P.cprp, n0, 0, 'lower')}
        ${row('Average prime time TVR', cur.pt_tvr, P.pt_tvr, n2, 0, 'higher')}${row('Average non prime TVR', cur.npt_tvr, P.npt_tvr, n2, 0, 'higher')}${row('Prime time share of spend', cur.pt_spend_share, P.pt_spend_share, pc, 0, 'higher')}${row('Prime time share of spots', cur.pt_spot_share, P.pt_spot_share, pc, 0, 'higher')}${row('ROI at rate card ' + tip('ROI'), cur.roi, P.roi, xr, 0, 'higher')}
        </tbody></table></div><p class="small muted">${cur.spend > 0 ? `Plan spends ${pc((P.spend / cur.spend) * 100)} of the current spend. ` : ''}Tax is not included. GRPs and rates are on a 30 second basis. ${D.comparison.basis === 'all' ? 'The current side includes sponsorship items.' : 'Sponsorship items are not part of this comparison.'}</p></div>
        <div class="card"><h3>GRPs for the same money</h3><div class="chart-wrap" style="height:260px"><canvas id="cm-chart" role="img" aria-label="GRPs: current agency against our plan"></canvas></div></div></div>`;
    C().bar({ id: 'cm-chart', labels: ['Current agency', 'Our plan'], valueFmt: (v) => fmt.num(v, 0), legend: false, datasets: [{ label: 'GRPs (30 sec)', data: [cur.ngrp, P.ngrp], backgroundColor: [C().PALETTE[1], C().PALETTE[0]] }] });
  }

  /* ---------------------------------------------------------------- 6 export */
  function exportTab(out) {
    out.innerHTML = card('Export the pitch', 'Excel has every table (comparison, current basket, sponsorship, channel ROI, our plan, rates, matches). The PDF and Word summaries hold the comparison, the key tables and the plain-language line.',
      `<div class="row" style="gap:10px;flex-wrap:wrap"><button class="btn primary" id="ex-x" type="button">Download Excel</button><button class="btn primary" id="ex-p" type="button">Download PDF summary</button><button class="btn" id="ex-w" type="button">Download Word summary</button></div>`);
    $('#ex-x').onclick = exportExcel; $('#ex-p').onclick = () => exportDoc('pdf'); $('#ex-w').onclick = () => exportDoc('docx');
  }
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
      put('Sponsorship', [['Channel', 'Programme (TVR name)', 'Item', 'Spots', 'Spend', 'TVR delivered', 'GRPs', 'CPRP'], ...cur.sponsorship.map((s) => [tt(s.channel), tt(s.program), s.theme, s.spots, R(s.spend), s.tvr, s.grp, R(s.cprp)])], [14, 28, 24, 8, 12, 12, 10, 10]);
      put('Our plan', [['Programme (TVR name)', 'Channel', 'Starts', 'Days', 'Daypart', 'TVR', 'Our 30 sec rate', 'CPRP', 'Spots', 'Spend', 'GRPs'], ...a.rows.map((r) => [tt(r.program), tt(r.channel), r.start, r.days, r.daypart, r.tvr, R(r.neg30), R(r.cprp), r.spots, R(r.spend), r.grp])], [28, 14, 8, 10, 10, 8, 14, 10, 8, 12, 10]);
      put('Rates', [['Channel', 'Programme (TVR name)', 'Starts', 'Daypart', 'TVR', 'Card 30 sec', 'Negotiated 30 sec', 'Agency paid 30 sec', 'Saving vs card %', 'Saving vs agency %'], ...D.rates.map((r) => [tt(r.channel), tt(r.program), r.start, r.daypart, r.tvr, r.card30 == null ? '' : R(r.card30), r.neg30 == null ? '' : R(r.neg30), r.paid30 == null ? '' : R(r.paid30), r.saving_pct, r.saving_vs_paid_pct])], [14, 28, 8, 10, 8, 12, 16, 16, 14, 16]);
      put('Matches', [['Channel', 'LMRB programme', 'TVR programme', 'Spots', 'Spend', 'Confidence %', 'Method'], ...D.matches.map((g) => [tt(g.channel), g.lmrb_program, g.tvr_program || '(no match)', g.spots, R(g.spend), g.confidence, g.method])], [14, 28, 28, 8, 12, 12, 16]);
      put('Monthly spend', [['Channel', ...D.overview.months], ...D.overview.rows.map((r) => [tt(r.channel), ...r.months.map((x) => R(x.com + x.va))])], [16]);
      App.download(new Blob([X.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `pitch_evaluation_${(D.month || 'all')}.xlsx`);
    } catch (e) { App.toast('Excel export failed: ' + e.message, 'error'); }
  }

  /* ---------------------------------------------------------------- 7 matches */
  function matches(out) {
    const all = D.matches, bad = all.filter((g) => g.level !== 'High'), f = st.match_filter;
    const shown = f === 'all' ? all : bad;
    out.innerHTML = card('Review matches', `Each LMRB programme is matched to a TVR programme by channel + weekday + start time first, then by name. The score mixes how many spots fit the time slot with how alike the names are. The evaluation always shows the TVR programme names. Fix a match with the list; your choice is saved for next time.`,
      `<div class="row" style="margin-bottom:8px"><div class="seg" id="mt-f"><button type="button" data-k="review" aria-pressed="${f !== 'all'}">Needs a look (${bad.length})</button><button type="button" data-k="all" aria-pressed="${f === 'all'}">All (${all.length})</button></div></div><div id="mt-a"></div>`);
    $$('#mt-f button').forEach((b) => { b.onclick = () => { st.match_filter = b.dataset.k; save(); render(); }; });
    table('mt-a', $('#mt-a'), { csv: 'pitch_matches', defaultSort: { key: 'spend', desc: true }, empty: 'Every programme matched with high confidence.', pageSize: 20, rows: shown.map((g) => ({ ...g, ch: tt(g.channel) })), columns: [
      { key: 'ch', label: 'Channel' }, { key: 'lmrb_program', label: 'Programme in the LMRB sheet' }, { key: 'spots', label: 'Spots', num: true, fmt: n0 }, { key: 'spend', label: 'Spend (LKR)', num: true, fmt: n0 },
      { key: 'tvr_program', label: 'Matched TVR programme', html: (v, g) => `<select data-mk="${esc(g.key)}" aria-label="TVR programme for ${esc(g.lmrb_program)}"><option value="">${g.method === 'manual' || g.method === 'ignored' ? 'Automatic' : esc(v ? `${tt(v)} (${g.tvr_start || ''})` : '(no match)')}</option>${g.method === 'manual' || g.method === 'ignored' ? `<option value="${esc(g.tvr_key || '-')}" selected>${esc(g.method === 'ignored' ? 'Ignore this programme' : tt(v))}</option>` : ''}<option value="-">Ignore this programme</option>${((D.catalogue[g.channel]) || []).map((x) => `<option value="${esc(x.key)}">${esc(tt(x.label))}</option>`).join('')}</select>` },
      { key: 'confidence', label: 'Confidence', num: true, html: (v, g) => `<span class="badge ${g.level === 'High' ? 'good' : g.level === 'None' ? 'bad' : ''}">${g.level} ${g.level === 'None' ? '' : v + '%'}</span>` }, { key: 'method', label: 'Matched by' }] });
    $('#mt-a').onchange = (e) => { const k = e.target.dataset && e.target.dataset.mk; if (!k) return; if (e.target.value) st.mappings[k] = e.target.value; else delete st.mappings[k]; save(); run(); };
  }

  /* ---------------------------------------------------------------- 8 rates */
  function rates(out) {
    const chs = D.tvr_channels, R = st.rates, N = st.nego;
    const chanRow = (ch) => { const c = R.channels[ch] || {}, rule = N.channels[ch] || {}; const inp = (b, k, v) => `<input class="rt-in" type="number" min="0" step="any" data-ch="${esc(ch)}" data-b="${b}" data-k="${k}" value="${v == null ? '' : esc(v)}" aria-label="${esc(ch)} ${b} ${k}">`;
      return `<tr><td><b>${esc(tt(ch))}</b></td><td>${inp('pt', 'rate', (c.pt || {}).rate)}</td><td>${inp('pt', 'secs', (c.pt || {}).secs || 30)}</td><td>${inp('npt', 'rate', (c.npt || {}).rate)}</td><td>${inp('npt', 'secs', (c.npt || {}).secs || 30)}</td>
        <td><select class="rt-ng" data-ch="${esc(ch)}" data-k="mode">${[['', 'Channel default'], ['none', 'No negotiation'], ['discount', 'Discount % off card'], ['flat', 'Flat 30 sec rate']].map(([v, l]) => `<option value="${v}" ${(rule.mode || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
        <td><input class="rt-ng" type="number" min="0" step="any" data-ch="${esc(ch)}" data-k="value" value="${rule.value == null ? '' : esc(rule.value)}" aria-label="${esc(ch)} negotiation value"></td></tr>`; };
    const d = N.default || { mode: 'none', value: 0 };
    out.innerHTML = card('Rates and negotiation', `Card rates can be typed per programme (table below), or once per channel for prime and non prime time. A rate typed for 10 or 15 seconds is converted to 30 seconds. Then pick how we negotiate: a discount % off the card, a flat 30 sec rate, or a special rate for one programme. ${tip('30s')}`,
      `<div class="pt-bar"><div class="field"><label>Default negotiation (all channels)</label><select id="rt-dm">${[['none', 'No negotiation (card rate)'], ['discount', 'Discount % off card'], ['flat', 'Flat 30 sec rate']].map(([v, l]) => `<option value="${v}" ${d.mode === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
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
      { key: 'pr', label: 'Programme (TVR name)' }, { key: 'ch', label: 'Channel' }, { key: 'start', label: 'Starts' }, { key: 'daypart', label: 'Daypart' }, { key: 'tvr', label: 'TVR', num: true, fmt: n2 },
      { key: 'pr_rate', label: 'Card rate (type here)', num: true, html: (v, r) => `<input class="rt-in" type="number" min="0" step="any" data-pk="${esc(r.k)}" data-w="rate" value="${v == null ? '' : esc(v)}" aria-label="Card rate for ${esc(r.pr)}">` },
      { key: 'pr_secs', label: 'For secs', num: true, html: (v, r) => `<select data-pk="${esc(r.k)}" data-w="secs" aria-label="Seconds">${[10, 15, 20, 30, 45, 60].map((s) => `<option ${s === +v ? 'selected' : ''}>${s}</option>`).join('')}</select>` },
      { key: 'card30', label: 'Card 30 sec rate', num: true, fmt: n0 },
      { key: 'ng_mode', label: 'Negotiation', html: (v, r) => `<select data-pk="${esc(r.k)}" data-w="mode" aria-label="Negotiation for ${esc(r.pr)}">${[['', 'Channel / default'], ['discount', 'Discount %'], ['special', 'Special 30 sec rate']].map(([x, l]) => `<option value="${x}" ${v === x ? 'selected' : ''}>${l}</option>`).join('')}</select>` },
      { key: 'ng_val', label: 'Value', num: true, html: (v, r) => `<input class="rt-in" type="number" min="0" step="any" data-pk="${esc(r.k)}" data-w="value" value="${v == null ? '' : esc(v)}" aria-label="Negotiation value for ${esc(r.pr)}">` },
      { key: 'neg30', label: 'Negotiated 30 sec', num: true, fmt: n0 }, { key: 'paid30', label: 'Effective: agency paid', num: true, fmt: n0 }, { key: 'saving_pct', label: 'Saving vs card', num: true, fmt: pc }, { key: 'saving_vs_paid_pct', label: 'Saving vs agency', num: true, fmt: pc }] });
  }

  /* ================================================================ boot */
  function boot() {
    root = $('#ws'); load(); App.loader.show('Initialising', 'Opening your data vault in this browser');
    App.shell.init('pitch').then(async () => {
      if (!App.clientId()) { App.loader.hide(0); App.shell.noClient(root); return; }
      try { await App.data.open(); status = await App.data.status(); load(); shell(); sources(); filters(); await run(); } catch (e) { root.innerHTML = App.emptyState('Could not open the data vault', e.message); }
      App.loader.hide(0);
    });
  }
  boot();
})(window.App);
