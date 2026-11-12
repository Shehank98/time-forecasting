/* Mission control: the three prediction cards (each opens with the launch animation), data kept in this browser,
 * saved forecasts and client reports. */
(function (App) {
  const { esc, fmt, $ } = App;
  const SHOW_KPI = false;   // Client KPI Forecast is hidden for now (page still exists at /kpi.html)
  const ALL_CARDS = [
    { kind: 'tv', href: '/tv.html', cls: 'c1', tag: 'Card 01', title: 'TVR Audience Behaviour Prediction',
      text: 'Forecast ratings with low case to high case ranges, guaranteed audiences and GRPs, reach, daypart and weekday strength, genre share shifts and programme risk.',
      icon: '<path d="M2 12a10 10 0 0120 0"/><path d="M6 12a6 6 0 0112 0"/><path d="M12 12l5-5"/><circle cx="12" cy="12" r="1.6"/><path d="M4 18h16"/>' },
    { kind: 'lmrb', href: '/lmrb.html', cls: 'c2', tag: 'Card 02', title: 'Market Prediction',
      text: 'Predict competitor spend and campaign bursts, spot volume, break clutter and position, share of voice and the cheapest rating points to buy.',
      icon: '<path d="M3 20h18"/><path d="M5 16l4-5 4 3 6-8"/><path d="M15 6h4v4"/>' },
    { kind: 'pitch', href: '/pitch.html', cls: 'c4', tag: 'Card 04', title: 'Client Pitch Evaluator',
      text: 'Show a prospect what their current agency bought, rate it against the TVR sheet, then show more GRPs and a lower cost per rating point for the same money at our rates.',
      icon: '<path d="M4 19V9M10 19V5M16 19v-8M22 19H2"/><path d="M3 7l5-3 4 3 8-5"/>' },
    { kind: 'adtest', href: '/adtest.html', cls: 'c2', tag: 'Card 05', title: 'Pre-Launch Ad Test',
      text: 'Upload a video or a static ad. Get visual and hook scores, four simulated Sri Lankan viewers, a comment wall and a language and backlash check before launch.',
      icon: '<path d="M12 3l2.2 5.6L20 11l-5.8 2.4L12 19l-2.2-5.6L4 11l5.8-2.4z"/><path d="M19 3v4M17 5h4"/>' },
    { kind: 'kpi', href: '/kpi.html', cls: 'c3', tag: 'Card 03', title: 'Client KPI Forecast',
      text: 'Any dated client data: leads, sales, traffic and search demand. Forecasts, CPL, CPA and CPRP, spend scenarios, pacing and demand peaks.',
      icon: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>' },
  ];
  const CARDS = ALL_CARDS.filter((k) => SHOW_KPI || k.kind !== 'kpi');
  const when = (s) => (s ? String(s).slice(0, 16).replace('T', ' ') : '');
  const page = { tv: '/tv.html', lmrb: '/lmrb.html', kpi: '/kpi.html' };
  const mb = (b) => (b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : (b / 1e6).toFixed(0) + ' MB');
  const wave = (seed) => {
    const pts = Array.from({ length: 24 }, (_, i) => [i * (300 / 23), 26 + Math.sin(i / 2.2 + seed) * 9 + Math.sin(i / 0.9 + seed * 2) * 4]);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    return `<svg class="spark" viewBox="0 0 300 50" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="g${seed}" x1="0" x2="1"><stop offset="0" stop-color="#3de0ff"/><stop offset=".6" stop-color="#8b5cf6"/><stop offset="1" stop-color="#ff4fd8"/></linearGradient></defs>
      <path d="${d}" fill="none" stroke="url(#g${seed})" stroke-width="2" stroke-dasharray="${seed > 1 ? '0' : '0'}"/><path d="M200 0V50" stroke="rgba(61,224,255,.35)" stroke-dasharray="3 4"/></svg>`;
  };
  function status(kind, st) {
    if (!st) return '<span class="muted">Checking this browser</span>';
    if (kind === 'kpi') return st.kpi.length ? `<span class="badge good">${st.kpi.length} dataset${st.kpi.length === 1 ? '' : 's'}</span> ${esc(st.kpi.map((x) => x.name).join(', '))}` : '<span class="muted">No data yet: upload once, it stays in this browser</span>';
    if (kind === 'adtest') return '<span class="muted">Upload the ad when you open it. Nothing is stored.</span>';
    if (kind === 'pitch') return st.lmrb && st.tv ? '<span class="badge good">Ready</span> LMRB and TVR sheets loaded' : st.lmrb || st.tv ? `<span class="badge">Needs the ${st.lmrb ? 'TVR' : 'LMRB'} sheet</span>` : '<span class="muted">Upload the LMRB and TVR sheets of the prospect</span>';
    const s = st[kind];
    return s ? `<span class="badge good">Ready</span> ${fmt.num(s.rows)} rows, ${esc(s.date_min)} to ${esc(s.date_max)}` : '<span class="muted">No data yet: upload once, it stays in this browser</span>';
  }
  function launch(card) {
    App.loader.show(`Launching ${card.title}`, 'Spinning up the prediction engine');
    let p = 0; const t = setInterval(() => { p = Math.min(0.92, p + 0.12); App.loader.progress(p); }, 90);
    setTimeout(() => { clearInterval(t); App.loader.progress(1); location.href = card.href; }, 900);
  }

  const PANES = [['fc', 'Saved forecasts'], ['rep', 'Client reports'], ['data', 'Data in this browser']];
  const PANE_ICON = { fc: '<path d="M4 19V5"/><path d="M4 19h16"/><path d="M7 15l4-4 3 3 5-6"/>', rep: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M10 13h6M10 17h6"/>',
    data: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>' };
  let pane = App.store.get('home-pane', 'fc');
  if (!PANES.some((x) => x[0] === pane)) pane = 'fc';
  const count = (k, n) => { const el = document.getElementById('wc-' + k); if (el) { el.textContent = String(n); el.classList.toggle('zero', !n); } };
  const empty = (title, text, icon) => `<div class="ws-empty"><span class="ws-ic lg" aria-hidden="true"><svg viewBox="0 0 24 24">${icon}</svg></span><b>${esc(title)}</b><span>${esc(text)}</span></div>`;
  async function render() {
    await App.shell.init('home');
    const root = $('#home');
    const c = App.shell.client();
    if (!c) { App.shell.noClient(root); return; }
    $('#client-head').innerHTML = `<div class="row">${c.has_logo ? `<img src="/api/clients/${c.id}/logo" alt="" class="client-logo lg">` : `<span class="client-dot lg" style="background:${esc(c.brand_color)};color:${esc(c.brand_color)}"></span>`}<div><div class="eyebrow">Mission control</div><h1>${esc(c.name)}</h1></div></div>`;
    root.innerHTML = `<section class="hero"><h1>Which prediction do you need <span class="grad-text">today</span>?</h1></section>
      <div class="home-cards ${CARDS.length > 2 ? 'three' : 'two'}" id="cards">${CARDS.map((k, i) => `<a class="home-card ${k.cls}" href="${k.href}" data-i="${i}"><span class="tag">${k.tag}</span><div class="ic"><svg viewBox="0 0 24 24">${k.icon}</svg></div>
        <h2>${k.title}</h2><p>${k.text}</p>${wave(i + 1)}<div class="small" data-st="${k.kind}">${status(k.kind, null)}</div><span class="go">Open prediction <span aria-hidden="true">&rarr;</span></span></a>`).join('')}</div>
      <section class="card ws-panel" id="h-ws" aria-label="Client workspace">
        <div class="ws-tabs" role="tablist" aria-label="Client workspace">${PANES.map(([k, l]) => `<button type="button" role="tab" id="wt-${k}" data-p="${k}" aria-controls="wp-${k}" aria-selected="${pane === k}">
          <span class="ws-ic" aria-hidden="true"><svg viewBox="0 0 24 24">${PANE_ICON[k]}</svg></span><span class="ws-l">${l}</span><span class="ws-count" id="wc-${k}">&nbsp;</span></button>`).join('')}</div>
        <div class="ws-pane" role="tabpanel" id="wp-fc" aria-labelledby="wt-fc" ${pane === 'fc' ? '' : 'hidden'}><p class="ws-sub">Forecasts, scenario plans and pacing checks saved for ${esc(c.name)}</p><div id="h-fc">${App.skeleton(1)}</div></div>
        <div class="ws-pane" role="tabpanel" id="wp-rep" aria-labelledby="wt-rep" ${pane === 'rep' ? '' : 'hidden'}><p class="ws-sub">Every PDF, PowerPoint and Excel report generated for ${esc(c.name)}</p><div id="h-rep">${App.skeleton(1)}</div></div>
        <div class="ws-pane" role="tabpanel" id="wp-data" aria-labelledby="wt-data" ${pane === 'data' ? '' : 'hidden'}><p class="ws-sub">What is stored for ${esc(c.name)}</p><div id="h-data"></div></div>
      </section>`;
    // right after sign-in: play the intro film unless the planner chose not to see it again
    try { if (sessionStorage.getItem('intro:pending') === '1') { sessionStorage.removeItem('intro:pending'); App.loadIntro().then(() => App.intro.open(false)); } } catch (e) { /* ignore */ }
    root.querySelectorAll('.ws-tabs [role=tab]').forEach((t) => { t.onclick = () => { pane = t.dataset.p; App.store.set('home-pane', pane);
      root.querySelectorAll('.ws-tabs [role=tab]').forEach((x) => x.setAttribute('aria-selected', String(x === t))); root.querySelectorAll('.ws-pane').forEach((x) => { x.hidden = x.id !== 'wp-' + pane; }); }; });
    root.querySelectorAll('.home-card').forEach((a) => { a.onclick = (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); launch(CARDS[+a.dataset.i]); }; });
    App.data.status().then((st) => {
      CARDS.forEach((k) => { const el = root.querySelector(`[data-st="${k.kind}"]`); if (el) el.innerHTML = status(k.kind, st); });
      const s = st.storage || {}, pct = s.quota ? (s.usage / s.quota) * 100 : 0;
      const rows = [['TVR sheet', st.tv], ['LMRB sheet', st.lmrb]].concat(st.kpi.map((x) => [`KPI: ${x.name}`, x]));
      count('data', rows.filter((r) => r[1]).length);
      $('#h-data').innerHTML = `<div class="card-head"><div><h3>Data in this browser ${App.help('Uploaded sheets are parsed and kept in this browser\'s local database (IndexedDB), separately for each signed-in user and client. The server only receives compact series and summaries.', 'Upload once and reuse on this computer. Another planner or another computer keeps its own copy, so share files as usual.', { howLabel: 'How it works' })}</h3>
        <div class="sub">${s.quota ? `${mb(s.usage)} used of about ${mb(s.quota)} available to this site` : 'Storage estimate not available'}</div></div>
        <button class="btn sm ghost danger" id="clear-all" type="button">Clear this client's data from this browser</button></div>
        ${s.quota ? `<div class="storage-meter" style="margin-bottom:12px"><i style="width:${pct.toFixed(1)}%"></i></div>` : ''}
        <div class="sum-grid">${rows.map(([l, x]) => `<div class="sum-item"><b>${x ? fmt.num(x.rows) : '0'}</b><span>${esc(l)}${x ? `: ${esc(x.date_min)} to ${esc(x.date_max)}` : ', not loaded'}</span></div>`).join('')}</div>`;
      $('#clear-all').onclick = async () => { if (!confirm(`Remove every sheet stored for ${c.name} in this browser? Saved forecasts and reports on the server are kept.`)) return; await App.data.clearAll(); render(); };
    }).catch((e) => { $('#h-data').innerHTML = App.emptyState('This browser cannot store data locally', e.message); });
    let s;
    try { s = await App.api.get('/api/workspace/summary'); } catch (e) { $('#h-fc').innerHTML = App.emptyState('Could not load the client', e.message); $('#h-rep').innerHTML = ''; return; }
    count('fc', s.forecasts.length); count('rep', s.reports.length);
    if (!s.forecasts.length) $('#h-fc').innerHTML = empty('Nothing saved yet.', 'Use "Save to client" in any Forecast studio.', PANE_ICON.fc);
    else App.tables.create($('#h-fc'), { csv: 'saved_forecasts', pageSize: 8, empty: 'Nothing saved yet. Use "Save to client" in any Forecast studio.', rows: s.forecasts, columns: [
      { key: 'title', label: 'Title', html: (v, r) => `<a href="${page[r.kind] || '/'}?tab=forecast&saved=${r.id}${r.dataset ? '&dataset=' + encodeURIComponent(r.dataset) : ''}">${esc(v)}</a>` },
      { key: 'ftype', label: 'Type', fmt: fmt.title }, { key: 'kind', label: 'Card', fmt: (v) => ({ tv: 'TVR', lmrb: 'Market', kpi: 'KPI' }[v] || v) }, { key: 'backend', label: 'Model', fmt: (v) => (v === 'timesfm' ? 'Forecast engine' : v === 'timesfm_xreg' ? 'Driver model' : v) },
      { key: 'created_at', label: 'Saved', fmt: when }, { key: 'id', label: '', sortable: false, html: (v) => `<button class="btn sm" data-delfc="${v}" type="button">Delete</button>` }] });
    if (!s.reports.length) $('#h-rep').innerHTML = empty('No reports yet.', 'Use "Client report" in any card.', PANE_ICON.rep);
    else App.tables.create($('#h-rep'), { csv: 'reports', pageSize: 8, empty: 'No reports yet. Use "Client report" in any card.', rows: s.reports, columns: [
      { key: 'filename', label: 'File', html: (v, r) => `<a href="#" data-dl="${r.id}">${esc(v)}</a>` }, { key: 'format', label: 'Format', fmt: (v) => v.toUpperCase() },
      { key: 'size', label: 'Size', num: true, fmt: (v) => fmt.num(v / 1024, 0) + ' KB' }, { key: 'by', label: 'By' }, { key: 'created_at', label: 'Created', fmt: when },
      { key: 'id', label: '', sortable: false, html: (v) => `<button class="btn sm" data-delrep="${v}" type="button">Delete</button>` }] });
    root.onclick = async (e) => {
      const dl = e.target.closest('[data-dl]'), dfc = e.target.closest('[data-delfc]'), drep = e.target.closest('[data-delrep]');
      try {
        if (dl) { e.preventDefault(); const res = await fetch(`/api/reports/${dl.dataset.dl}/download`, { headers: { 'X-Client-Id': App.clientId() } }); if (!res.ok) throw new Error('Download failed'); App.download(await res.blob(), dl.textContent); }
        if (dfc && confirm('Delete this saved forecast?')) { await App.api.del('/api/saved-forecasts/' + dfc.dataset.delfc); render(); }
        if (drep && confirm('Delete this report?')) { await App.api.del('/api/reports/' + drep.dataset.delrep); render(); }
      } catch (x) { App.toast(x.message, 'error'); }
    };
  }
  render().catch((e) => { if (e.status !== 401) App.toast(e.message, 'error'); });
})(window.App);
