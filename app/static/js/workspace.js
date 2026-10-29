/* Workspace controller shared by all cards: upload (with column mapping for client KPIs), summary, filters, tabs and reloads. */
(function (App) {
  const { esc, fmt, $, $$ } = App;
  const EXPECTED = {
    tv: 'Rank, Data Set, Channel, Date, Day, Start, End, Program, Duration, Category, TVR, Total TVR, TVR Share %, Reach, Reach %, Avg Time',
    lmrb: 'Product_Group, Advertiser, Product, Advt_Theme, Ads, Channel, Program, Dd, Mn, Yr, Day, Prog_time, Advt_time, AdPos, TotAds, BrkNo, PosinBrk, AdsinBrk, Lng, Dur, Cost',
    kpi: 'Any sheet with one date column (daily, weekly or monthly) and numeric columns such as Spend, Leads, Sales, Clicks, Impressions, Website visits, Search volume or GRPs. An optional text column (campaign, channel, product, region) becomes the segment.',
  };
  const ICON_UP = '<svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3"/></svg>';
  const UNITS = [['number', 'Count'], ['currency', 'Currency (LKR)'], ['percent', 'Percent'], ['rating', 'Rating / GRP']];

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
        <div class="sum-item"><b>${fmt.num(r.n_days)}</b><span>Distinct ${r.granularity ? esc(r.granularity) + ' periods' : 'days'}</span></div>
      </div>
      ${r.appended ? `<div class="banner info"><span>Merged with stored history: ${fmt.num(r.rows_added)} new rows added, ${fmt.num(r.rows_skipped_as_duplicates)} duplicate or restated rows replaced. History now has ${fmt.num(r.rows_total_after_merge)} rows.</span></div>` : ''}
      ${(r.warnings || []).map((w) => `<div class="banner"><span>${esc(w)}</span></div>`).join('')}
      <div class="grid g2">
        <div><div class="lbl">Dropped rows</div><div class="chiplist" style="margin-top:6px">${Object.entries(d).map(([k, v]) => `<span class="badge ${v ? 'warn' : 'good'}">${esc(k.replace(/_/g, ' '))}: ${v}</span>`).join('')}</div></div>
        <div><div class="lbl">Missing optional columns</div><div style="margin-top:6px">${chips(r.missing_columns)}</div></div>
        <div><div class="lbl">Values that could not be parsed</div><div style="margin-top:6px">${chips(unp)}</div></div>
        ${r.kind === 'kpi' ? '' : `<div><div class="lbl">Channels not in the alias table</div><div style="margin-top:6px">${chips(r.unmatched_channels)}</div><div class="muted small" style="margin-top:4px">Admins can add aliases under Settings to merge naming variants.</div></div>`}
      </div>`;
  }

  function modal(title, html) {
    const back = document.createElement('div'); back.className = 'modal-back';
    back.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="card-head"><h2>${esc(title)}</h2><button class="btn sm" data-x>Close</button></div>${html}</div>`;
    document.body.appendChild(back);
    const close = () => back.remove(); back.querySelector('[data-x]').onclick = close; back.onclick = (e) => { if (e.target === back) close(); };
    back.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); }); back.querySelector('[data-x]').focus();
    back.close = close;
    return back;
  }
  App.modal = modal;

  function metricRows(metrics, editable) {
    return `<div class="tbl-scroll"><table class="tbl"><thead><tr>${editable ? '<th>Keep</th><th>Column</th>' : ''}<th>Label</th><th>Unit</th><th>Aggregate</th><th>Role</th></tr></thead><tbody>
      ${metrics.map((m, i) => `<tr data-i="${i}">${editable ? `<td><input type="checkbox" data-f="include" ${m.include !== false ? 'checked' : ''} aria-label="Keep ${esc(m.column)}"></td><td>${esc(m.column)}</td>` : ''}
        <td><input type="text" data-f="label" value="${esc(m.label)}" aria-label="Label"></td>
        <td><select data-f="unit">${UNITS.map(([k, l]) => `<option value="${k}" ${m.unit === k ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
        <td><select data-f="agg"><option value="sum" ${m.agg === 'sum' ? 'selected' : ''}>Sum (totals)</option><option value="mean" ${m.agg === 'mean' ? 'selected' : ''}>Average (rates)</option></select></td>
        <td><select data-f="role"><option value="kpi" ${m.role === 'kpi' ? 'selected' : ''}>Result (KPI)</option><option value="driver" ${m.role === 'driver' ? 'selected' : ''}>Driver (spend, price)</option></select></td></tr>`).join('')}</tbody></table></div>`;
  }
  function ratioRows(ratios, metrics) {
    const opt = (sel) => metrics.map((m) => `<option value="${esc(m.key)}" ${m.key === sel ? 'selected' : ''}>${esc(m.label)}</option>`).join('');
    return `<div id="ratio-list" class="stack" style="gap:8px">${ratios.map((r) => `<div class="row ratio-row" style="flex-wrap:nowrap">
        <input type="text" data-f="label" value="${esc(r.label)}" aria-label="Ratio name" style="max-width:240px">
        <select data-f="num" aria-label="Numerator">${opt(r.num)}</select><span class="muted">per</span><select data-f="den" aria-label="Denominator">${opt(r.den)}</select>
        <select data-f="scale" aria-label="Scale"><option value="1" ${+r.scale !== 1000 ? 'selected' : ''}>x 1</option><option value="1000" ${+r.scale === 1000 ? 'selected' : ''}>x 1000 (CPM)</option></select>
        <button class="btn sm" type="button" data-rm aria-label="Remove ratio">Remove</button></div>`).join('')}</div>
      <button class="btn sm" type="button" id="ratio-add" style="margin-top:8px">Add cost-per-result ratio</button>`;
  }
  function readMetrics(root, base) {
    return $$('tr[data-i]', root).map((tr) => { const m = { ...base[+tr.dataset.i] }; $$('[data-f]', tr).forEach((el) => { m[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value; }); return m; });
  }
  function readRatios(root) {
    return $$('.ratio-row', root).map((r) => { const o = {}; $$('[data-f]', r).forEach((el) => { o[el.dataset.f] = el.value; }); o.scale = +o.scale; return o; }).filter((r) => r.num && r.den && r.num !== r.den);
  }
  function wireRatios(root, metricsFn) {
    root.addEventListener('click', (e) => {
      if (e.target.closest('[data-rm]')) e.target.closest('.ratio-row').remove();
      if (e.target.id === 'ratio-add') {
        const ms = metricsFn(); if (ms.length < 2) return;
        const cur = ms.find((m) => m.unit === 'currency') || ms[0], other = ms.find((m) => m.key !== cur.key);
        $('#ratio-list', root).insertAdjacentHTML('beforeend', ratioRows([{ label: `Cost per ${other.label}`, num: cur.key, den: other.key, scale: 1 }], ms));
      }
    });
  }

  async function openSettings() {
    const names = [['channel_aliases', 'Channel aliases'], ['holidays', 'Holiday and event calendar'], ['dayparts', 'Dayparts and time-belts']];
    const m = modal('Settings (editable JSON)', `<p class="muted small">Edit the JSON and save. Channel aliases and dayparts apply to the next upload. The event calendar is used by the next forecast. Settings are shared by all clients.</p>
      <div class="seg" id="cfg-seg">${names.map(([k, l], i) => `<button type="button" data-k="${k}" aria-pressed="${i === 0}">${l}</button>`).join('')}</div>
      <textarea id="cfg-text" rows="18" style="margin-top:10px" spellcheck="false"></textarea><div class="row" style="margin-top:10px"><button class="btn primary" id="cfg-save">Save</button></div>`);
    let cur = 'channel_aliases';
    const load1 = async () => { $('#cfg-text', m).value = JSON.stringify(await App.api.get('/api/config/' + cur), null, 2); };
    $$('#cfg-seg button', m).forEach((b) => { b.onclick = () => { $$('#cfg-seg button', m).forEach((x) => x.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', 'true'); cur = b.dataset.k; load1(); }; });
    $('#cfg-save', m).onclick = async () => { try { await App.api.put('/api/config/' + cur, JSON.parse($('#cfg-text', m).value)); App.toast('Saved', 'ok'); } catch (e) { App.toast('Not saved: ' + e.message, 'error'); } };
    load1();
  }
  App.openSettings = openSettings;

  function workspace(cfg) {
    const kind = cfg.kind, root = $('#ws');
    let state = null, filtersCtl = null, data = null, meta = null, reqId = 0, active = App.store.get('tab:' + kind, cfg.tabs[0].id);
    const dirty = new Set();
    let persp = App.store.get('persp:' + kind, { my_brand: '', competitors: [], tv_data_set: '' });
    let ds = kind === 'kpi' ? (new URLSearchParams(location.search).get('dataset') || App.store.get('kpi-ds:' + App.clientId(), '')) : '';
    const ctx = {
      kind, get data() { return data; }, get meta() { return meta; }, get state() { return state; },
      dataset: () => ds, fkey: () => kind + ':' + ds,
      filters: () => (filtersCtl ? filtersCtl.get() : {}),
      options: () => ({ my_brand: persp.my_brand || null, competitors: persp.competitors || [], tv_data_set: persp.tv_data_set || null }),
      persp: () => persp, reload: () => load(), panel: (id) => $('#panel-' + id),
      body: (extra) => ({ kind, dataset: ds, filters: ctx.filters(), options: ctx.options(), ...(extra || {}) }),
    };
    App.ctx = App.ctx || {}; App.ctx[kind] = ctx;
    const filterKey = () => 'filters:' + kind + ':' + App.clientId() + ':' + ds;

    root.innerHTML = `<section id="v-upload" hidden></section><section id="v-summary" hidden></section><section id="v-dash" hidden></section>
      <input type="file" id="file-in" accept=".xlsx,.xls,.csv" hidden>`;
    const fileIn = $('#file-in');
    let uploadMode = 'replace';

    /* ---------------- upload view ---------------- */
    function showUpload(canCancel, newDataset) {
      $('#v-summary').hidden = true; $('#v-dash').hidden = true; const v = $('#v-upload'); v.hidden = false;
      const nameField = kind === 'kpi' ? `<div class="card" style="max-width:860px;margin-bottom:16px"><div class="grid g2">
          <div class="field"><label for="ds-name">Dataset name</label><input type="text" id="ds-name" maxlength="120" placeholder="For example: Leads and spend 2026, Search demand, Website traffic" value="${esc(newDataset ? '' : ds)}"></div>
          <div class="field"><label for="ds-mode">If the dataset exists</label><select id="ds-mode"><option value="append" ${uploadMode === 'append' ? 'selected' : ''}>Append to its history</option><option value="replace" ${uploadMode !== 'append' ? 'selected' : ''}>Replace it</option></select></div></div></div>` : '';
      v.innerHTML = `${nameField}
        <div class="dropzone" id="dz" tabindex="0" role="button" aria-label="Upload a file. Press Enter to browse.">
          <div class="ic">${ICON_UP}</div><h2>Drop your ${esc(cfg.fileLabel)} here</h2>
          <p class="muted">or click to browse. Accepts .xlsx, .xls, .csv up to 25 MB. ${uploadMode === 'append' && kind !== 'kpi' ? '<b>Rows will be appended to the stored history.</b>' : ''}</p>
          <div id="up-prog" class="progress" hidden style="max-width:360px;margin:16px auto 0"><i></i></div><div id="up-msg" class="muted small" style="margin-top:8px"></div>
        </div>
        <details class="card" style="max-width:860px;margin-top:16px"><summary style="cursor:pointer;font-weight:700">Expected columns</summary><p class="muted">${esc(EXPECTED[kind])}</p>
        <p class="muted small">Headers are matched case-insensitively and extra spaces are ignored. Anything unparseable is reported, not fatal.</p></details>
        ${canCancel ? '<p><button class="btn" id="back-dash">Back to dashboard</button></p>' : ''}`;
      const dz = $('#dz');
      dz.onclick = () => fileIn.click(); dz.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } };
      ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
      ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('over'); }));
      dz.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) doUpload(e.dataTransfer.files[0]); });
      const b = $('#back-dash'); if (b) b.onclick = () => showDash();
      if ($('#ds-name')) $('#ds-name').focus();
    }
    async function doUpload(file) {
      const prog = $('#up-prog'), msg = $('#up-msg');
      if (!/\.(xlsx|xls|csv)$/i.test(file.name)) { App.toast('Please choose an .xlsx, .xls or .csv file.', 'error'); return; }
      if (file.size > 25 * 1024 * 1024) { App.toast('That file is larger than 25 MB.', 'error'); return; }
      let dsName = '';
      if (kind === 'kpi') {
        dsName = ($('#ds-name').value || '').trim();
        if (!dsName || dsName.includes(':')) { App.toast('Give the dataset a name (no colons) first.', 'error'); $('#ds-name').focus(); fileIn.value = ''; return; }
        uploadMode = $('#ds-mode').value;
      }
      if (prog) { prog.hidden = false; prog.classList.remove('indet'); prog.firstElementChild.style.width = '0'; msg.textContent = `Uploading ${file.name}`; }
      const onp = (p) => { if (prog) { prog.firstElementChild.style.width = Math.round(p * 100) + '%'; if (p >= 1) { prog.classList.add('indet'); msg.textContent = 'Reading and validating'; } } };
      try {
        if (kind === 'kpi') {
          const prop = await App.api.upload('/api/kpi/propose', file, onp);
          showMapping(prop, dsName);
        } else {
          state = await App.api.upload(`/api/${kind}/upload?mode=${uploadMode}`, file, onp);
          if (uploadMode !== 'append') App.store.set(filterKey(), {});
          showSummary();
        }
      } catch (e) { App.toast(e.message, 'error', 8000); if (prog) { prog.hidden = true; msg.textContent = e.message; } }
      fileIn.value = '';
    }
    fileIn.onchange = () => { if (fileIn.files[0]) doUpload(fileIn.files[0]); };

    /* ---------------- KPI column mapping ---------------- */
    function showMapping(prop, dsName) {
      const v = $('#v-upload'), s = prop.suggested;
      const dateCols = prop.columns.filter((c) => c.type === 'date').map((c) => c.name);
      const textCols = prop.columns.filter((c) => c.type === 'text').map((c) => c.name);
      v.innerHTML = `<div class="card"><div class="card-head"><div><h2>Map the columns of ${esc(prop.file_name)}</h2><div class="sub">${fmt.num(prop.rows)} rows found under header row ${prop.header_row}. Check the suggestions, then import into "${esc(dsName)}".</div></div></div>
        <div class="grid g2"><div class="field"><label for="m-date">Date column</label><select id="m-date">${dateCols.map((c) => `<option ${c === s.date_column ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
          <div class="field"><label for="m-seg">Segment column (optional)</label><select id="m-seg"><option value="">None, one total series</option>${textCols.map((c) => `<option ${c === s.segment_column ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select><span class="muted small">For example campaign, channel, product or region.</span></div></div>
        <h3 style="margin:16px 0 8px">Metrics</h3><p class="muted small" style="margin-top:0">Totals (spend, leads, sales) should be summed. Rates (CTR, conversion rate, TVR) should be averaged. Drivers are things you control, like spend or price, used for scenarios.</p>
        <div id="m-metrics">${metricRows(s.metrics, true)}</div>
        <h3 style="margin:16px 0 8px">Cost-per-result ratios</h3><p class="muted small" style="margin-top:0">For example CPL = Spend per Lead, CPA = Spend per Acquisition, CPRP = Spend per GRP. Computed as total numerator divided by total denominator for each period.</p>
        <div id="m-ratios">${ratioRows(s.ratios, s.metrics)}</div>
        <div class="row" style="margin-top:16px"><button class="btn primary" id="m-apply" type="button">Import data</button><button class="btn" id="m-cancel" type="button">Cancel</button></div></div>`;
      wireRatios($('#m-ratios'), () => readMetrics($('#m-metrics'), s.metrics).filter((m) => m.include));
      $('#m-cancel').onclick = () => (state && state.loaded ? showDash() : showUpload(false));
      $('#m-apply').onclick = async (e) => {
        const btn = e.currentTarget; btn.disabled = true;
        const mapping = { date_column: $('#m-date').value, segment_column: $('#m-seg').value || null, metrics: readMetrics($('#m-metrics'), s.metrics), ratios: readRatios($('#m-ratios')) };
        try {
          state = await App.api.post('/api/kpi/apply', { token: prop.token, dataset: dsName, mode: uploadMode, mapping });
          ds = dsName; App.store.set('kpi-ds:' + App.clientId(), ds);
          if (uploadMode !== 'append') App.store.set(filterKey(), {});
          showSummary();
        } catch (err) { App.toast(err.message, 'error', 8000); btn.disabled = false; }
      };
    }
    function editMetrics() {
      const base = state.meta.metrics;
      const m = modal('Edit metrics and ratios', `<div id="e-metrics">${metricRows(base, false)}</div><h3 style="margin:16px 0 8px">Cost-per-result ratios</h3><div id="e-ratios">${ratioRows(state.meta.ratios || [], base)}</div>
        <div class="row" style="margin-top:14px"><button class="btn primary" id="e-save">Save</button></div>`);
      wireRatios($('#e-ratios', m), () => base);
      $('#e-save', m).onclick = async () => {
        try { state = await App.api.put('/api/kpi/meta', { dataset: ds, metrics: readMetrics($('#e-metrics', m), base), ratios: readRatios($('#e-ratios', m)) }); m.close(); showDash(true); App.toast('Saved', 'ok'); }
        catch (e) { App.toast(e.message, 'error'); }
      };
    }

    /* ---------------- summary view ---------------- */
    function showSummary() {
      $('#v-upload').hidden = true; $('#v-dash').hidden = true; const v = $('#v-summary'); v.hidden = false;
      v.innerHTML = `<div class="card"><div class="card-head"><div><h2>File processed: ${esc(state.files[state.files.length - 1])}</h2><div class="sub">Saved to ${esc(App.shell.client() ? App.shell.client().name : 'this client')}. Review the summary, then open the dashboard.</div></div>
        <button class="btn primary" id="open-dash">Open dashboard</button></div>${summaryHtml(state.report)}</div>`;
      $('#open-dash').onclick = () => showDash(true); $('#open-dash').focus();
    }

    /* ---------------- dashboard view ---------------- */
    function showDash(fresh) {
      $('#v-upload').hidden = true; $('#v-summary').hidden = true; const v = $('#v-dash'); v.hidden = false;
      const sig = ds + state.report.file_name + state.report.rows_kept + JSON.stringify(state.meta || {});
      if (v.dataset.built === sig && !fresh) return;
      v.dataset.built = sig;
      const tabs = cfg.tabs, isAdmin = App.shell.me && App.shell.me.user.is_admin;
      const dsPicker = kind === 'kpi' ? `<select id="ds-sel" aria-label="KPI dataset" style="max-width:260px">${(state.datasets || []).map((d) => `<option ${d.name === ds ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>
        <button class="btn" id="b-newds" type="button">New dataset</button><button class="btn" id="b-meta" type="button">Edit metrics</button>` : '';
      v.innerHTML = `
        <div class="ws-head"><div class="grow row">${dsPicker}<span class="badge info">${esc(state.files.slice(-3).join(' + '))}${state.files.length > 3 ? ` +${state.files.length - 3}` : ''}</span> <span class="muted small">${esc(state.report.date_min)} to ${esc(state.report.date_max)}</span></div>
          <button class="btn" id="b-summary" type="button">Data summary</button>
          <button class="btn" id="b-append" type="button">Append file</button>
          <button class="btn" id="b-change" type="button">Replace file</button>
          ${isAdmin && kind !== 'kpi' ? '<button class="btn" id="b-settings" type="button">Settings</button>' : ''}
          <div class="menu"><button class="btn primary" id="b-export" type="button" aria-haspopup="true" aria-expanded="false">Client report</button><div class="menu-pop" id="export-pop" hidden></div></div></div>
        <div id="forecast-banner"></div>
        ${cfg.perspective ? '<div class="card" id="persp" style="margin-bottom:16px"></div>' : ''}
        <div class="card filters-card"><details id="filters-det" ${App.store.get('filters-open:' + kind, false) ? 'open' : ''}><summary><svg class="ico" viewBox="0 0 24 24"><path d="M3 5h18l-7 8v6l-4 2v-8z"/></svg>Filters <span class="counter" id="counter" style="margin-left:auto"></span></summary>
          <div id="filter-body"></div><div class="row" style="margin-top:12px"><button class="btn sm" id="reset" type="button">Reset filters</button></div></details>
          <div class="chips" id="chips"></div></div>
        <div class="tabs" role="tablist" aria-label="Sections" id="tablist">${tabs.map((t) => `<button class="tab" role="tab" id="tab-${t.id}" aria-controls="panel-${t.id}" aria-selected="false" data-tab="${t.id}" ${t.hidden && t.hidden(ctx) ? 'hidden' : ''}>${esc(t.label)}</button>`).join('')}</div>
        ${tabs.map((t) => `<div role="tabpanel" id="panel-${t.id}" aria-labelledby="tab-${t.id}" hidden></div>`).join('')}`;
      $('#b-summary').onclick = () => modal('Data summary', summaryHtml(state.report));
      $('#b-append').onclick = () => { uploadMode = 'append'; kind === 'kpi' ? showUpload(true) : fileIn.click(); };
      $('#b-change').onclick = () => { uploadMode = 'replace'; showUpload(true); };
      if ($('#b-settings')) $('#b-settings').onclick = openSettings;
      if (kind === 'kpi') {
        $('#ds-sel').onchange = async (e) => { ds = e.target.value; App.store.set('kpi-ds:' + App.clientId(), ds); data = null; state = await App.api.get(`/api/kpi/state?dataset=${encodeURIComponent(ds)}`); showDash(true); };
        $('#b-newds').onclick = () => { uploadMode = 'replace'; showUpload(true, true); };
        $('#b-meta').onclick = editMetrics;
      }
      mountExport();
      filtersCtl = App.filters.init($('#filter-body'), kind, state.options, () => load(), filterKey());
      $('#reset').onclick = () => filtersCtl.reset();
      $('#filters-det').ontoggle = (e) => App.store.set('filters-open:' + kind, e.target.open);
      if (cfg.perspective) mountPersp();
      $$('.tab', v).forEach((b) => { b.onclick = () => select(b.dataset.tab); b.onkeydown = (e) => { const vis = $$('.tab:not([hidden])', v); const i = vis.indexOf(b); if (e.key === 'ArrowRight') vis[(i + 1) % vis.length].focus(); if (e.key === 'ArrowLeft') vis[(i - 1 + vis.length) % vis.length].focus(); }; });
      const want = new URLSearchParams(location.search).get('tab');
      if (want && tabs.find((t) => t.id === want)) active = want;
      if (!tabs.find((t) => t.id === active)) active = tabs[0].id;
      select(active, true);
      load();
    }

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
        const res = await App.api.post(`/api/${kind}/dashboard`, ctx.body());
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
      const el = $('#persp'), advs = state.options.advertiser || [], sets = state.tv_data_sets || [];
      App.charts.register(advs);
      el.innerHTML = `<div class="card-head"><div><h3>Competitor set</h3><div class="sub">Pick the client's brand to unlock share of voice, GRP share and alerts. Default competitors are the advertisers in the same product group.</div></div></div>
        <div class="grid ${sets.length ? 'g3' : 'g2'}"><div class="field"><label for="my-brand">Client brand / advertiser</label><select id="my-brand"><option value="">None (all advertisers)</option>${advs.map((a) => `<option ${a === persp.my_brand ? 'selected' : ''} value="${esc(a)}">${esc(a)}</option>`).join('')}</select></div><div id="comp-ms"></div>
        ${sets.length ? `<div class="field"><label for="tv-set">TVR target audience for GRPs</label><select id="tv-set">${sets.map((s) => `<option ${s === persp.tv_data_set ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>` : ''}</div>`;
      const save = () => { App.store.set('persp:' + kind, persp); load(); };
      $('#my-brand').onchange = (e) => { persp.my_brand = e.target.value; save(); };
      if ($('#tv-set')) $('#tv-set').onchange = (e) => { persp.tv_data_set = e.target.value; save(); };
      const ms = App.filters.multi({ key: 'competitors', label: 'Competitors (optional override)' }, advs, persp, save);
      $('#comp-ms').replaceWith(ms);
    }

    /* ---------------- client report menu + settings ---------------- */
    function mountExport() {
      const btn = $('#b-export'), pop = $('#export-pop');
      const last = (store) => App[store] && App[store][ctx.fkey()];
      pop.innerHTML = `<div class="field" style="margin-bottom:8px"><label for="ex-title">Report title</label><input type="text" id="ex-title" maxlength="120" placeholder="${esc(cfg.fileLabel.replace(/ file$/, ''))} report"></div>
        <label class="row small" style="margin-bottom:6px"><input type="checkbox" id="ex-ai" checked> Executive summary (Gemini, rule-based if unavailable)</label>
        <label class="row small" style="margin-bottom:6px"><input type="checkbox" id="ex-fc" checked> Last forecast run</label>
        <label class="row small" style="margin-bottom:6px"><input type="checkbox" id="ex-sc" checked> Last scenario plan</label>
        <label class="row small" style="margin-bottom:10px"><input type="checkbox" id="ex-pc" checked> Last pacing check</label>
        <button class="btn" data-fmt="pdf" type="button">Branded PDF report</button><button class="btn" data-fmt="pptx" type="button">PowerPoint deck</button><button class="btn" data-fmt="xlsx" type="button">Excel workbook</button>
        <div class="muted small" id="ex-msg">Copies are kept under Client overview.</div>`;
      btn.onclick = () => {
        pop.hidden = !pop.hidden; btn.setAttribute('aria-expanded', String(!pop.hidden));
        [['ex-fc', 'lastForecast'], ['ex-sc', 'lastScenarios'], ['ex-pc', 'lastPacing']].forEach(([id, st]) => { const c = $('#' + id, pop); c.disabled = !last(st); if (!last(st)) c.checked = false; });
      };
      document.addEventListener('click', (e) => { if (!pop.hidden && !e.target.closest('.menu')) { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
      $$('[data-fmt]', pop).forEach((b) => { b.onclick = async () => {
        const msg = $('#ex-msg', pop); b.disabled = true; msg.textContent = 'Building report. This can take up to a minute.';
        try {
          await App.exporter.run(b.dataset.fmt, ctx, { title: $('#ex-title', pop).value, includeAi: $('#ex-ai', pop).checked, includeForecast: $('#ex-fc', pop).checked,
            includeScenarios: $('#ex-sc', pop).checked, includePacing: $('#ex-pc', pop).checked });
          msg.textContent = 'Downloaded. A copy is saved under Client overview.';
        } catch (e) { App.toast(e.message, 'error', 8000); msg.textContent = ''; }
        b.disabled = false;
      }; });
    }

    /* ---------------- boot ---------------- */
    App.shell.init(kind).then(async () => {
      if (!App.clientId()) { App.shell.noClient(root); return; }
      try { state = await App.api.get(`/api/${kind}/state${kind === 'kpi' ? `?dataset=${encodeURIComponent(ds)}` : ''}`); } catch (e) { App.toast(e.message, 'error'); return; }
      if (kind === 'kpi' && !state.loaded && state.datasets && state.datasets.length) {
        ds = state.datasets[0].name; App.store.set('kpi-ds:' + App.clientId(), ds);
        state = await App.api.get(`/api/kpi/state?dataset=${encodeURIComponent(ds)}`);
      }
      if (state.loaded) showDash(true); else showUpload(false, kind === 'kpi');
    }).catch((e) => { if (e.status !== 401) App.toast(e.message, 'error'); });
    return ctx;
  }
  App.workspace = workspace;
  App.summaryHtml = summaryHtml;
})(window.App);
