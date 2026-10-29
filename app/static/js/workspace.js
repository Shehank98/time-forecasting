/* Workspace controller shared by both cards: upload, parsing summary, filters, tabs and reloads. */
(function (App) {
  const { esc, fmt, $, $$ } = App;
  const EXPECTED = {
    tv: 'Rank, Data Set, Channel, Date, Day, Start, End, Program, Duration, Category, TVR, Total TVR, TVR Share %, Reach, Reach %, Avg Time',
    lmrb: 'Product_Group, Advertiser, Product, Advt_Theme, Ads, Channel, Program, Dd, Mn, Yr, Day, Prog_time, Advt_time, AdPos, TotAds, BrkNo, PosinBrk, AdsinBrk, Lng, Dur, Cost',
  };
  const ICON_UP = '<svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3"/></svg>';

  function summaryHtml(r) {
    const d = r.dropped || {};
    const chips = (a) => (a && a.length ? `<div class="chiplist">${a.map((x) => `<span class="badge warn">${esc(x)}</span>`).join('')}</div>` : '<span class="muted">None</span>');
    const unp = Object.entries(r.unparseable_values || {}).map(([k, v]) => `${k}: ${v}`);
    return `
      <div class="sum-grid">
        <div class="sum-item"><b>${fmt.num(r.rows_read)}</b><span>Rows read</span></div>
        <div class="sum-item"><b>${fmt.num(r.rows_kept)}</b><span>Rows kept</span></div>
        <div class="sum-item"><b>${fmt.num(r.rows_dropped_total)}</b><span>Bad or blank rows dropped</span></div>
        <div class="sum-item"><b>${esc(r.date_min || 'n/a')}</b><span>First date</span></div>
        <div class="sum-item"><b>${esc(r.date_max || 'n/a')}</b><span>Last date</span></div>
        <div class="sum-item"><b>${fmt.num(r.n_days)}</b><span>Distinct days</span></div>
      </div>
      ${r.appended ? `<div class="banner info"><span>Merged with existing data: ${fmt.num(r.rows_added)} new rows added, ${fmt.num(r.rows_skipped_as_duplicates)} duplicates skipped. History now has ${fmt.num(r.rows_total_after_merge)} rows.</span></div>` : ''}
      ${(r.warnings || []).map((w) => `<div class="banner"><span>${esc(w)}</span></div>`).join('')}
      <div class="grid g2">
        <div><div class="lbl">Dropped rows</div><div class="chiplist" style="margin-top:6px">${Object.entries(d).map(([k, v]) => `<span class="badge ${v ? 'warn' : 'good'}">${esc(k.replace(/_/g, ' '))}: ${v}</span>`).join('')}</div></div>
        <div><div class="lbl">Missing optional columns</div><div style="margin-top:6px">${chips(r.missing_columns)}</div></div>
        <div><div class="lbl">Values that could not be parsed</div><div style="margin-top:6px">${chips(unp)}</div></div>
        <div><div class="lbl">Channels not in the alias table</div><div style="margin-top:6px">${chips(r.unmatched_channels)}</div><div class="muted small" style="margin-top:4px">Add aliases under Settings to merge naming variants.</div></div>
      </div>`;
  }

  function workspace(cfg) {
    const kind = cfg.kind, root = $('#ws');
    App.shell.init(kind);
    let state = null, filtersCtl = null, data = null, meta = null, reqId = 0, active = App.store.get('tab:' + kind, cfg.tabs[0].id);
    const dirty = new Set(); let persp = App.store.get('persp:' + kind, { my_brand: '', competitors: [] });
    const ctx = {
      kind, get data() { return data; }, get meta() { return meta; }, get state() { return state; },
      filters: () => (filtersCtl ? filtersCtl.get() : {}), options: () => ({ my_brand: persp.my_brand || null, competitors: persp.competitors || [] }),
      persp: () => persp, reload: () => load(), panel: (id) => $('#panel-' + id),
      body: () => ({ kind, filters: ctx.filters(), options: ctx.options() }),
    };
    App.ctx = App.ctx || {}; App.ctx[kind] = ctx;

    root.innerHTML = `
      <section id="v-upload" hidden></section>
      <section id="v-summary" hidden></section>
      <section id="v-dash" hidden></section>
      <input type="file" id="file-in" accept=".xlsx,.xls,.csv" hidden>`;
    const fileIn = $('#file-in');
    let uploadMode = 'replace';

    /* ---------------- upload view ---------------- */
    function showUpload(canCancel) {
      $('#v-summary').hidden = true; $('#v-dash').hidden = true; const v = $('#v-upload'); v.hidden = false;
      v.innerHTML = `
        <div class="dropzone" id="dz" tabindex="0" role="button" aria-label="Upload a file. Press Enter to browse.">
          <div class="ic">${ICON_UP}</div><h2>Drop your ${esc(cfg.fileLabel)} here</h2>
          <p class="muted">or click to browse. Accepts .xlsx, .xls, .csv up to 25 MB.</p>
          <div id="up-prog" class="progress" hidden style="max-width:360px;margin:16px auto 0"><i></i></div><div id="up-msg" class="muted small" style="margin-top:8px"></div>
        </div>
        <details class="card" style="max-width:860px;margin-top:16px"><summary style="cursor:pointer;font-weight:700">Expected columns</summary><p class="muted">${esc(EXPECTED[kind])}</p>
        <p class="muted small">Headers are matched case-insensitively and extra spaces are ignored. Missing optional columns are reported, not fatal.</p></details>
        ${canCancel ? '<p><button class="btn" id="back-dash">Back to dashboard</button></p>' : ''}`;
      const dz = $('#dz');
      dz.onclick = () => fileIn.click(); dz.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } };
      ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
      ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('over'); }));
      dz.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) doUpload(e.dataTransfer.files[0]); });
      const b = $('#back-dash'); if (b) b.onclick = () => showDash();
    }
    async function doUpload(file) {
      const prog = $('#up-prog'), msg = $('#up-msg');
      if (!/\.(xlsx|xls|csv)$/i.test(file.name)) { App.toast('Please choose an .xlsx, .xls or .csv file.', 'error'); return; }
      if (file.size > 25 * 1024 * 1024) { App.toast('That file is larger than 25 MB.', 'error'); return; }
      if (prog) { prog.hidden = false; prog.firstElementChild.style.width = '0'; msg.textContent = `Uploading ${file.name}`; }
      try {
        const st = await App.api.upload(`/api/${kind}/upload?mode=${uploadMode}`, file, (p) => { if (prog) { prog.firstElementChild.style.width = Math.round(p * 100) + '%'; if (p >= 1) { prog.classList.add('indet'); msg.textContent = 'Parsing and validating'; } } });
        state = st; App.store.set('filters:' + kind, uploadMode === 'append' ? App.store.get('filters:' + kind, {}) : {});
        showSummary();
      } catch (e) { App.toast(e.message, 'error', 8000); if (prog) { prog.hidden = true; msg.textContent = e.message; } }
      fileIn.value = '';
    }
    fileIn.onchange = () => { if (fileIn.files[0]) doUpload(fileIn.files[0]); };

    /* ---------------- summary view ---------------- */
    function showSummary() {
      $('#v-upload').hidden = true; $('#v-dash').hidden = true; const v = $('#v-summary'); v.hidden = false;
      v.innerHTML = `<div class="card"><div class="card-head"><div><h2>File parsed: ${esc(state.files[state.files.length - 1])}</h2><div class="sub">Review the summary, then open the dashboard.</div></div>
        <button class="btn primary" id="open-dash">Open dashboard</button></div>${summaryHtml(state.report)}</div>`;
      $('#open-dash').onclick = () => showDash(true); $('#open-dash').focus();
    }

    /* ---------------- dashboard view ---------------- */
    function showDash(fresh) {
      $('#v-upload').hidden = true; $('#v-summary').hidden = true; const v = $('#v-dash'); v.hidden = false;
      if (v.dataset.built === state.report.file_name + state.report.rows_kept && !fresh) return;
      v.dataset.built = state.report.file_name + state.report.rows_kept;
      const tabs = cfg.tabs;
      v.innerHTML = `
        <div class="ws-head"><div class="grow"><span class="badge info">${esc(state.files.join(' + '))}</span> <span class="muted small">${esc(state.report.date_min)} to ${esc(state.report.date_max)}</span></div>
          <button class="btn" id="b-summary" type="button">Data summary</button>
          <button class="btn" id="b-append" type="button">Append file</button>
          <button class="btn" id="b-change" type="button">Change file</button>
          <button class="btn" id="b-settings" type="button">Settings</button>
          <div class="menu"><button class="btn primary" id="b-export" type="button" aria-haspopup="true" aria-expanded="false">Export</button><div class="menu-pop" id="export-pop" hidden></div></div></div>
        <div id="forecast-banner"></div>
        ${cfg.perspective ? '<div class="card" id="persp" style="margin-bottom:16px"></div>' : ''}
        <div class="card filters-card"><details id="filters-det" ${App.store.get('filters-open:' + kind, false) ? 'open' : ''}><summary><svg class="ico" viewBox="0 0 24 24"><path d="M3 5h18l-7 8v6l-4 2v-8z"/></svg>Filters <span class="counter" id="counter" style="margin-left:auto"></span></summary>
          <div id="filter-body"></div><div class="row" style="margin-top:12px"><button class="btn sm" id="reset" type="button">Reset filters</button></div></details>
          <div class="chips" id="chips"></div></div>
        <div class="tabs" role="tablist" aria-label="Sections" id="tablist">${tabs.map((t) => `<button class="tab" role="tab" id="tab-${t.id}" aria-controls="panel-${t.id}" aria-selected="false" data-tab="${t.id}" ${t.hidden && t.hidden(ctx) ? 'hidden' : ''}>${esc(t.label)}</button>`).join('')}</div>
        ${tabs.map((t) => `<div role="tabpanel" id="panel-${t.id}" aria-labelledby="tab-${t.id}" hidden></div>`).join('')}`;
      $('#b-summary').onclick = () => modal('Data summary', summaryHtml(state.report));
      $('#b-append').onclick = () => { uploadMode = 'append'; fileIn.click(); };
      $('#b-change').onclick = () => { uploadMode = 'replace'; showUpload(true); };
      $('#b-settings').onclick = openSettings;
      mountExport();
      filtersCtl = App.filters.init($('#filter-body'), kind, state.options, () => load());
      $('#reset').onclick = () => filtersCtl.reset();
      $('#filters-det').ontoggle = (e) => App.store.set('filters-open:' + kind, e.target.open);
      if (cfg.perspective) mountPersp();
      $$('.tab', v).forEach((b) => { b.onclick = () => select(b.dataset.tab); b.onkeydown = (e) => { const vis = $$('.tab:not([hidden])', v); const i = vis.indexOf(b); if (e.key === 'ArrowRight') vis[(i + 1) % vis.length].focus(); if (e.key === 'ArrowLeft') vis[(i - 1 + vis.length) % vis.length].focus(); }; });
      if (!tabs.find((t) => t.id === active)) active = tabs[0].id;
      select(active, true);
      load();
    }
    fileIn.addEventListener('click', () => { /* mode is set before click */ });

    function select(id, force) {
      active = id; App.store.set('tab:' + kind, id);
      $$('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === id)));
      cfg.tabs.forEach((t) => { const p = $('#panel-' + t.id); if (p) p.hidden = t.id !== id; });
      if (dirty.has(id) || force) renderTab(id);
    }
    function renderTab(id) {
      dirty.delete(id);
      const t = cfg.tabs.find((x) => x.id === id), p = $('#panel-' + id); if (!t || !p) return;
      if (!data) { p.innerHTML = App.skeleton(2); return; }
      if (data.empty && !t.alwaysRender) { p.innerHTML = `${App.emptyState('No rows match the current filters', 'Widen the date range or remove a filter.')}<div style="text-align:center"><button class="btn" id="empty-reset">Reset filters</button></div>`; const r = $('#empty-reset', p); if (r) r.onclick = () => filtersCtl.reset(); return; }
      try { t.render(p, ctx); } catch (e) { console.error(e); p.innerHTML = App.emptyState('This section could not be drawn', e.message); }
    }
    async function load() {
      const id = ++reqId;
      const counter = $('#counter');
      cfg.tabs.forEach((t) => dirty.add(t.id));
      const p = $('#panel-' + active); if (p && !data) p.innerHTML = App.skeleton(3);
      try {
        const res = await App.api.post(`/api/${kind}/dashboard`, { filters: ctx.filters(), options: ctx.options() });
        if (id !== reqId) return;
        data = res.data; meta = res.meta;
        if (counter) { counter.textContent = `Filtered rows: ${fmt.num(meta.filtered_rows)} of ${fmt.num(meta.total_rows)}`; counter.classList.toggle('warn', meta.filtered_rows === 0); }
        App.filters.chips($('#chips'), meta.chips, (k) => filtersCtl.remove(k));
        if (cfg.onData) cfg.onData(ctx);
        cfg.tabs.forEach((t) => { const b = $('#tab-' + t.id); if (b && t.hidden) b.hidden = !!t.hidden(ctx); });
        if (cfg.tabs.find((t) => t.id === active && t.hidden && t.hidden(ctx))) active = cfg.tabs[0].id;
        select(active, true);
      } catch (e) { if (id === reqId) { App.toast(e.message, 'error'); if (p) p.innerHTML = App.emptyState('Could not load the dashboard', e.message); } }
    }
    document.addEventListener('themechange', () => { if (!$('#v-dash').hidden && data) { cfg.tabs.forEach((t) => dirty.add(t.id)); renderTab(active); } });

    /* ---------------- perspective (LMRB) ---------------- */
    function mountPersp() {
      const el = $('#persp'), advs = state.options.advertiser || [];
      App.charts.register(advs);
      el.innerHTML = `<div class="card-head"><div><h3>Competitor set</h3><div class="sub" id="persp-note">Pick your brand to unlock share of voice and alerts. Default competitors are the advertisers in the same product group.</div></div></div>
        <div class="grid g2"><div class="field"><label for="my-brand">My brand / advertiser</label><select id="my-brand"><option value="">None (all advertisers)</option>${advs.map((a) => `<option ${a === persp.my_brand ? 'selected' : ''} value="${esc(a)}">${esc(a)}</option>`).join('')}</select></div><div id="comp-ms"></div></div>`;
      const save = () => { App.store.set('persp:' + kind, persp); load(); };
      $('#my-brand').onchange = (e) => { persp.my_brand = e.target.value; save(); };
      const ms = App.filters.multi({ key: 'competitors', label: 'Competitors (optional override)' }, advs, persp, save);
      $('#comp-ms').replaceWith(ms);
    }

    /* ---------------- export + settings ---------------- */
    function mountExport() {
      const btn = $('#b-export'), pop = $('#export-pop');
      pop.innerHTML = `<label class="row small" style="margin-bottom:8px"><input type="checkbox" id="ex-ai" checked> Include Gemini summary and actions</label>
        <label class="row small" style="margin-bottom:8px"><input type="checkbox" id="ex-fc" checked> Include last forecast</label>
        <button class="btn" data-fmt="xlsx" type="button">Excel report (.xlsx)</button><button class="btn" data-fmt="pdf" type="button">PDF report</button><div class="muted small" id="ex-msg"></div>`;
      btn.onclick = () => { pop.hidden = !pop.hidden; btn.setAttribute('aria-expanded', String(!pop.hidden)); };
      document.addEventListener('click', (e) => { if (!pop.hidden && !e.target.closest('.menu')) { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
      $$('[data-fmt]', pop).forEach((b) => { b.onclick = async () => {
        if (!App.exporter) { App.toast('Export is not available on this page.', 'error'); return; }
        const msg = $('#ex-msg', pop); b.disabled = true; msg.textContent = 'Building report...';
        try { await App.exporter.run(b.dataset.fmt, ctx, { includeAi: $('#ex-ai', pop).checked, includeForecast: $('#ex-fc', pop).checked }); msg.textContent = 'Downloaded.'; }
        catch (e) { App.toast(e.message, 'error', 8000); msg.textContent = ''; }
        b.disabled = false;
      }; });
    }
    function modal(title, html, wide) {
      const back = document.createElement('div'); back.className = 'modal-back';
      back.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="card-head"><h2>${esc(title)}</h2><button class="btn sm" data-x>Close</button></div>${html}</div>`;
      document.body.appendChild(back);
      const close = () => back.remove(); back.querySelector('[data-x]').onclick = close; back.onclick = (e) => { if (e.target === back) close(); };
      back.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); }); back.querySelector('[data-x]').focus();
      return back;
    }
    App.modal = modal;
    async function openSettings() {
      const names = [['channel_aliases', 'Channel aliases'], ['holidays', 'Holiday and event calendar'], ['dayparts', 'Dayparts']];
      const m = modal('Settings (editable JSON)', `<p class="muted small">Edit the JSON and save. Channel aliases and dayparts apply to the next upload. The event calendar is used by the next forecast. Re-upload the file to re-apply channel names.</p>
        <div class="seg" id="cfg-seg">${names.map(([k, l], i) => `<button type="button" data-k="${k}" aria-pressed="${i === 0}">${l}</button>`).join('')}</div>
        <textarea id="cfg-text" rows="18" style="margin-top:10px" spellcheck="false"></textarea><div class="row" style="margin-top:10px"><button class="btn primary" id="cfg-save">Save</button></div>`);
      let cur = 'channel_aliases';
      const load1 = async () => { $('#cfg-text', m).value = JSON.stringify(await App.api.get('/api/config/' + cur), null, 2); };
      $$('#cfg-seg button', m).forEach((b) => { b.onclick = () => { $$('#cfg-seg button', m).forEach((x) => x.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', 'true'); cur = b.dataset.k; load1(); }; });
      $('#cfg-save', m).onclick = async () => { try { await App.api.put('/api/config/' + cur, JSON.parse($('#cfg-text', m).value)); App.toast('Saved', 'ok'); } catch (e) { App.toast('Not saved: ' + e.message, 'error'); } };
      load1();
    }

    /* ---------------- boot ---------------- */
    (async () => {
      try { state = await App.api.get(`/api/${kind}/state`); } catch (e) { App.toast(e.message, 'error'); }
      if (state && state.loaded) showDash(true); else showUpload(false);
    })();
    return ctx;
  }
  App.workspace = workspace;
  App.summaryHtml = summaryHtml;
})(window.App);
