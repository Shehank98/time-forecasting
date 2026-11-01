/* Workspace controller shared by all cards: global control bar (uploads kept in this browser, horizon, global filters),
 * KPI column mapping, data summary, advanced filters, tabs and reloads. */
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
    $('#cfg-save', m).onclick = async () => { try { await App.api.put('/api/config/' + cur, JSON.parse($('#cfg-text', m).value)); if (App.data) await App.data.reconfigure(); App.toast('Saved. Channel aliases and dayparts apply to the next upload.', 'ok'); } catch (e) { App.toast('Not saved: ' + e.message, 'error'); } };
    load1();
  }
  App.openSettings = openSettings;


  const GMAP = { tv: ['channel', 'program', 'category'], lmrb: ['channel', 'program', 'product_group', 'advertiser'] };
  const GFIELDS = [['channel', 'Channel'], ['program', 'Programme'], ['category', 'Category'], ['product_group', 'Product group'], ['advertiser', 'Advertiser']];
  const SHEET = { tv: 'TVR sheet', lmrb: 'LMRB sheet' };
  const SHEET_HINT = { tv: 'Programme ratings: Channel, Date, Start, Program, Category, TVR, Reach', lmrb: 'Ad monitoring: Advertiser, Channel, Program, date parts, AdsinBrk, PosinBrk, Cost' };
  const mb = (b) => (b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : (b / 1e6).toFixed(0) + ' MB');

  const SECTION_ICON = '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12h8M12 8v8"/>';
  const SECTION_INFO = {
    'p-tvr': { text: 'Forecast ratings with guaranteed P10 floors, daypart heatmap, genre shifts and programme risk.', icon: '<path d="M2 12a10 10 0 0120 0"/><path d="M6 12a6 6 0 0112 0"/><path d="M12 12l5-5"/><circle cx="12" cy="12" r="1.6"/>' },
    'p-market': { text: 'Predict competitor spend and bursts, break clutter, share of voice and the cheapest rating points.', icon: '<path d="M3 20h18"/><path d="M5 16l4-5 4 3 6-8"/><path d="M15 6h4v4"/>' },
    overview: { text: 'Headline numbers and trends for the current filters.', icon: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>' },
    programmes: { text: 'Every programme ranked by audience, reach and share.', icon: '<path d="M4 6h16M4 12h16M4 18h10"/>' },
    heat: { text: 'Channel by category, daypart, day and time-belt heatmaps.', icon: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>' },
    categories: { text: 'Which genres perform best and how they trend.', icon: '<path d="M12 3a9 9 0 109 9h-9z"/><path d="M15 3.5A9 9 0 0120.5 9H15z"/>' },
    efficiency: { text: 'Audience and reach per minute of airtime.', icon: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>' },
    consistency: { text: 'Which recurring slots give predictable audiences.', icon: '<path d="M3 12h4l2-6 4 12 2-6h6"/>' },
    opportunity: { text: 'Strong audience with low ad clutter from rivals.', icon: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>' },
    forecast: { text: 'Custom forecasts, spend scenarios and pacing checks.', icon: '<path d="M3 17l5-6 4 4 8-10"/><path d="M15 5h5v5"/>' },
    ai: { text: 'Gemini findings with evidence, plus a chat about your data.', icon: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>' },
    rows: { text: 'Browse and export the filtered rows.', icon: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/>' },
    spend: { text: 'Spend ranked by advertiser, product, channel and more.', icon: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>' },
    mix: { text: 'Advertiser by channel, daypart and programme.', icon: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>' },
    flighting: { text: 'When each competitor is on air, in bursts or always on.', icon: '<path d="M3 17l18-6-6 10-3-6z"/>' },
    creatives: { text: 'New, returning, paused and dropped creatives.', icon: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9l5 3-5 3z"/>' },
    pricing: { text: 'Cost per second, discounts and price outliers.', icon: '<circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5c0-1 1-1.5 2.5-1.5s2.5.6 2.5 1.7c0 2.3-5 1.3-5 3.6 0 1.1 1 1.7 2.5 1.7s2.5-.5 2.5-1.5"/>' },
    position: { text: 'Who buys first and last position in the break.', icon: '<path d="M5 6h14M5 12h14M5 18h14"/><circle cx="5" cy="6" r="1.2"/>' },
    grp: { text: 'GRPs, CPRP and share of GRPs from matched ratings.', icon: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/>' },
    alerts: { text: 'Competitor moves in the last 7 days.', icon: '<path d="M6 16V11a6 6 0 0112 0v5l2 2H4z"/><path d="M10 20a2 2 0 004 0"/>' },
    h2h: { text: 'Compare two advertisers side by side.', icon: '<path d="M8 4v16M16 4v16M3 8l5-4 5 4M11 16l5 4 5-4"/>' },
    segments: { text: 'Results by campaign, channel or product.', icon: '<path d="M12 3a9 9 0 109 9h-9z"/>' },
    drivers: { text: 'How results moved with spend in your history.', icon: '<path d="M4 20l6-8 4 4 6-10"/>' },
  };

  function workspace(cfg) {
    const kind = cfg.kind, root = $('#ws'), predictMode = kind !== 'kpi';
    const allTabs = (predictMode ? (cfg.predict || []) : []).concat(cfg.tabs);
    let state = null, status = null, filtersCtl = null, data = null, meta = null, reqId = 0, gopts = {};
    let active = null;   // id of the section open in the popup, or null
    const dirty = new Set();
    let persp = App.store.get('persp:lmrb', { my_brand: '', competitors: [], tv_data_set: '' });
    let ds = kind === 'kpi' ? (new URLSearchParams(location.search).get('dataset') || App.store.get('kpi-ds:' + App.clientId(), '')) : '';
    const gKey = () => 'gf:' + App.clientId();
    let gf = App.store.get(gKey(), {});
    let horizon = App.store.get('horizon', 14), months = App.store.get('months', 6), hmode = App.store.get('hmode', 'monthly');
    const ctx = {
      kind, get data() { return data; }, get meta() { return meta; }, get state() { return state; }, get status() { return status; },
      dataset: () => ds, fkey: () => kind + ':' + ds,
      filters: () => ctx.filtersFor(kind),
      filtersFor(k) {
        const out = k === kind && filtersCtl ? filtersCtl.get() : {};
        if (predictMode) for (const g of GMAP[k] || []) { if (gf[g] && gf[g].length) out[g] = gf[g]; }
        return out;
      },
      options: () => ({ my_brand: persp.my_brand || null, competitors: persp.competitors || [], tv_data_set: persp.tv_data_set || null }),
      setPersp(p) { persp = { ...persp, ...p }; App.store.set('persp:lmrb', persp); if (kind === 'lmrb') load(); },
      horizon: () => horizon, mode: () => (hmode === 'monthly' ? 'monthly' : 'daily'), months: () => months, persp: () => persp, reload: () => load(), panel: (id) => $('#panel-' + id),
      has: (k) => !!(status && (k === 'kpi' ? status.kpi.length : status[k])),
      body: (extra) => ({ kind, name: ds, dataset: ds, filters: ctx.filters(), options: ctx.options(), ...(extra || {}) }),
      select: (id) => select(id),
    };
    App.ctx = App.ctx || {}; App.ctx[kind] = ctx;
    const filterKey = () => 'filters:' + kind + ':' + App.clientId() + ':' + ds;

    root.innerHTML = `${predictMode ? '<section id="v-control"></section>' : ''}<section id="v-upload" hidden></section><section id="v-summary" hidden></section><section id="v-dash" hidden></section>
      <input type="file" id="file-in" accept=".xlsx,.xls,.csv" hidden>`;
    const fileIn = $('#file-in');
    let uploadMode = 'replace';

    /* ================= global control bar (TVR and Market pages) ================= */
    function slotHtml(k) {
      const s = status && status[k];
      return `<div class="up-slot ${s ? 'loaded' : ''}" data-kind="${k}" tabindex="0" aria-label="${SHEET[k]}: drop a file or press Enter to upload">
        <div class="up-head"><span class="up-name">${SHEET[k]}</span>${s ? '<span class="badge good">In this browser</span>' : '<span class="badge warn">Not loaded</span>'}</div>
        <div class="up-meta" title="${esc(s ? s.files.join(', ') : SHEET_HINT[k])}">${s ? `${fmt.num(s.rows)} rows, ${esc(s.date_min)} to ${esc(s.date_max)}` : esc(SHEET_HINT[k])}</div>
        <div class="progress" hidden><i></i></div><div class="up-msg muted small" hidden></div>
        <div class="up-actions">${s ? `<button class="btn sm" type="button" data-act="append">Append new period</button><button class="btn sm" type="button" data-act="replace">Replace</button>
          <button class="btn sm" type="button" data-act="summary">Summary</button><button class="btn sm ghost danger" type="button" data-act="remove">Remove</button>`
          : '<button class="btn sm primary" type="button" data-act="replace">Upload CSV or Excel</button>'}</div>
        <input type="file" accept=".csv,.txt,.xlsx,.xls" hidden></div>`;
    }
    function renderControl() {
      const el = $('#v-control'); if (!el) return;
      const st = status.storage || {}, pct = st.quota ? Math.min(100, (st.usage / st.quota) * 100) : 0;
      el.innerHTML = `<div class="card glow" style="margin-bottom:16px"><div class="control-bar">
        <div class="cb-section"><div class="cb-title">Data sources ${App.help('Each sheet is read once, inside your browser, and kept in its local storage for this client. Nothing is uploaded to the server. Only compact daily series (a few kilobytes) are sent to TimesFM when you open a prediction.',
          'Upload once, then come back any time on this computer. Use "Append new period" each month to grow the history; duplicate rows are skipped automatically. CSV works at any size (500 MB and more); Excel files up to 150 MB.')}
          <span class="muted small" style="margin-left:auto;text-transform:none;letter-spacing:0">${st.quota ? `Browser storage ${mb(st.usage)} of ${mb(st.quota)}` : ''}</span></div>
          ${st.quota ? `<div class="storage-meter" title="${pct.toFixed(1)}% used"><i style="width:${pct.toFixed(1)}%"></i></div>` : ''}
          <div class="uploads">${slotHtml('tv')}${slotHtml('lmrb')}</div></div>
        <div class="cb-section"><div class="cb-title">Forecast horizon ${App.help('Months view: TimesFM 2.5 forecasts monthly totals and averages up to 12 months ahead, with P10, P50 and P90 ranges and Sri Lankan holiday effects. It needs at least 12 months of history (24 or more is best) and gives the clearest picture for planning. Days view: the next 60 days, day by day.',
          'Use months for budget and strategy decisions (3, 6 or 12 months) and days for tactical weekly planning. Changing the horizon inside a view is instant; switching between days and months runs a new forecast.')}</div>
          <div class="row" style="gap:12px"><div class="seg" id="hz-mode" role="group" aria-label="Forecast view"><button type="button" data-m="monthly" aria-pressed="${hmode === 'monthly'}">Months</button><button type="button" data-m="daily" aria-pressed="${hmode !== 'monthly'}">Days</button></div></div>
          <div class="horizon" id="hz-box"></div>
          <div class="cb-title">Global filters ${App.help('These filters apply to both sheets: channel and programme to both, category to the TVR sheet, product group and advertiser to the LMRB sheet. Forecasts are rebuilt from the filtered rows.', 'Focus every prediction on the channels, programmes or competitors you are planning for.')}</div>
          <div class="gfilters" id="gfilters"></div></div></div>
        <div class="chips" id="gchips"></div></div>`;
      $$('.up-slot', el).forEach(wireSlot);
      $$('#hz-mode button', el).forEach((b) => { b.onclick = () => setMode(b.dataset.m); });
      paintHorizon();
      renderGlobalFilters();
    }
    const isM = () => hmode === 'monthly';
    function paintHorizon() {
      const box = $('#hz-box'); if (!box) return;
      const quick = isM() ? [3, 6, 12] : [7, 14, 30], cur = isM() ? months : horizon, max = isM() ? 12 : 60, unit = isM() ? 'mo' : 'd';
      box.innerHTML = `<div class="seg" id="hz-quick">${quick.map((d) => `<button type="button" data-d="${d}" aria-pressed="${cur === d}">${d} ${isM() ? 'months' : 'days'}</button>`).join('')}</div>
        <input type="range" min="1" max="${max}" step="1" id="hz-range" class="slider" value="${cur}" aria-label="Custom horizon in ${isM() ? 'months' : 'days'}"><span class="val" id="hz-val">${cur}${unit}</span>`;
      $$('#hz-quick button', box).forEach((b) => { b.onclick = () => setHorizon(+b.dataset.d); });
      const range = $('#hz-range', box);
      range.oninput = () => { $('#hz-val', box).textContent = range.value + unit; };
      range.onchange = () => setHorizon(+range.value);
    }
    /** Horizon controls inside the popup, so the view can be changed without closing it. */
    function paintSheetHz() {
      const box = $('#sheet-hz'); if (!box) return;
      const isPredict = !!(active && (cfg.predict || []).some((t) => t.id === active));
      box.hidden = !isPredict; if (!isPredict) return;
      const quick = isM() ? [3, 6, 12] : [7, 14, 30], cur = isM() ? months : horizon;
      box.innerHTML = `<div class="seg" role="group" aria-label="Forecast view"><button type="button" data-m="monthly" aria-pressed="${isM()}">Months</button><button type="button" data-m="daily" aria-pressed="${!isM()}">Days</button></div>
        <div class="seg" role="group" aria-label="Horizon">${quick.map((d) => `<button type="button" data-d="${d}" aria-pressed="${cur === d}">${d}${isM() ? ' mo' : ' d'}</button>`).join('')}</div>`;
      $$('[data-m]', box).forEach((b) => { b.onclick = () => setMode(b.dataset.m); });
      $$('[data-d]', box).forEach((b) => { b.onclick = () => setHorizon(+b.dataset.d); });
    }
    function refreshPredict() {
      paintSheetHz();
      (cfg.predict || []).forEach((t) => dirty.add(t.id));
      if (active && (cfg.predict || []).some((t) => t.id === active)) renderTab(active);
      document.dispatchEvent(new CustomEvent('horizonchange', { detail: isM() ? months : horizon }));
    }
    function setMode(m) {
      if (m === hmode) return;
      hmode = m; App.store.set('hmode', m);
      $$('#hz-mode button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.m === hmode)));
      paintHorizon(); refreshPredict();
    }
    function setHorizon(d) {
      if (isM()) { months = Math.max(1, Math.min(12, d)); App.store.set('months', months); }
      else { horizon = Math.max(1, Math.min(60, d)); App.store.set('horizon', horizon); }
      paintHorizon(); refreshPredict();
    }
    function renderGlobalFilters() {
      const box = $('#gfilters'); if (!box) return;
      box.innerHTML = '';
      const onChange = App.debounce(() => { App.store.set(gKey(), gf); paintGlobalChips(); load(); }, 350);
      GFIELDS.forEach(([k, l]) => { const opts = gopts[k] || []; if (!opts.length) return; box.appendChild(App.filters.multi({ key: 'g-' + k, label: l }, opts, proxy(k), onChange)); });
      if (!box.children.length) box.innerHTML = '<div class="muted small">Filters appear after the first upload.</div>';
      paintGlobalChips();
    }
    // App.filters.multi stores under field.key, so map 'g-channel' to gf.channel
    function proxy(k) { return new Proxy(gf, { get: (t, p) => (p === 'g-' + k ? t[k] : t[p]), set: (t, p, v) => { t[p === 'g-' + k ? k : p] = v; return true; }, deleteProperty: (t, p) => { delete t[p === 'g-' + k ? k : p]; return true; } }); }
    function paintGlobalChips() {
      const el = $('#gchips'); if (!el) return;
      const list = GFIELDS.filter(([k]) => gf[k] && gf[k].length).map(([k, l]) => ({ key: k, label: l, value: gf[k].slice(0, 3).join(', ') + (gf[k].length > 3 ? ` +${gf[k].length - 3}` : '') }));
      el.innerHTML = list.length ? list.map((c) => `<span class="chip">${esc(c.label)}: ${esc(c.value)}<button type="button" data-k="${esc(c.key)}" aria-label="Remove ${esc(c.label)} filter">&times;</button></span>`).join('') + '<button class="btn sm ghost" type="button" data-clear-g>Clear global filters</button>' : '';
      $$('button[data-k]', el).forEach((b) => { b.onclick = () => { delete gf[b.dataset.k]; App.store.set(gKey(), gf); renderGlobalFilters(); load(); }; });
      const c = $('[data-clear-g]', el); if (c) c.onclick = () => { gf = {}; App.store.set(gKey(), gf); renderGlobalFilters(); load(); };
    }
    function wireSlot(slot) {
      const k = slot.dataset.kind, inp = $('input[type=file]', slot);
      let mode = 'replace';
      const pick = (m) => { mode = m; inp.click(); };
      slot.onclick = (e) => {
        const b = e.target.closest('[data-act]'); if (!b) return;
        const act = b.dataset.act;
        if (act === 'append' || act === 'replace') pick(act);
        if (act === 'summary') modal(`${SHEET[k]} summary`, summaryHtml(status[k].report) + `<p class="muted small">Files: ${esc(status[k].files.join(', '))}</p>`);
        if (act === 'remove' && confirm(`Remove the ${SHEET[k]} from this browser? You can upload it again later.`)) App.data.remove(k).then(refreshAll).catch((x) => App.toast(x.message, 'error'));
      };
      slot.onkeydown = (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === slot) { e.preventDefault(); pick(status && status[k] ? 'append' : 'replace'); } };
      inp.onchange = () => { if (inp.files[0]) doUpload(k, inp.files[0], mode, slot); inp.value = ''; };
      ['dragenter', 'dragover'].forEach((ev) => slot.addEventListener(ev, (e) => { e.preventDefault(); slot.classList.add('over'); }));
      ['dragleave', 'drop'].forEach((ev) => slot.addEventListener(ev, (e) => { e.preventDefault(); slot.classList.remove('over'); }));
      slot.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) doUpload(k, f, status && status[k] ? (confirm(`Append ${f.name} to the stored ${SHEET[k]}? Press Cancel to replace it instead.`) ? 'append' : 'replace') : 'replace', slot); });
    }
    async function doUpload(k, file, mode, slot) {
      if (!/\.(xlsx|xls|csv|txt)$/i.test(file.name)) { App.toast('Please choose a .csv, .xlsx or .xls file.', 'error'); return; }
      const prog = $('.progress', slot), msg = $('.up-msg', slot);
      prog.hidden = false; msg.hidden = false; prog.firstElementChild.style.width = '0'; msg.textContent = `Reading ${file.name} (${mb(file.size)})`;
      $$('button', slot).forEach((b) => { b.disabled = true; });
      try {
        const res = await App.data.upload(k, file, mode, (p, m) => { prog.firstElementChild.style.width = Math.round(p * 100) + '%'; if (m) msg.textContent = m; });
        if (mode !== 'append') App.store.set('filters:' + k + ':' + App.clientId() + ':', {});
        const r = res.report;
        App.toast(r.appended ? `${SHEET[k]}: ${fmt.num(r.rows_added)} new rows added, ${fmt.num(r.rows_skipped_as_duplicates)} duplicates skipped.` : `${SHEET[k]} loaded: ${fmt.num(r.rows_kept)} rows, ${r.date_min} to ${r.date_max}.`, 'ok', 7000);
        if (res.warning) App.toast(res.warning, 'error', 12000);
        if ((r.warnings || []).length || r.rows_dropped_total) modal(`${SHEET[k]} processed`, summaryHtml(r));
        await refreshAll();
      } catch (e) {
        App.toast(e.message, 'error', 12000); msg.textContent = e.message; prog.hidden = true;
        $$('button', slot).forEach((b) => { b.disabled = false; });
      }
    }
    async function refreshAll() {
      status = await App.data.status();
      gopts = predictMode ? await App.data.globalOptions() : {};
      if (predictMode) renderControl();
      state = await App.data.state(kind, ds);
      (cfg.predict || []).forEach((t) => dirty.add(t.id));
      showDash(true);
    }

    /* ================= KPI upload view ================= */
    function showUpload(canCancel, newDataset) {
      $('#v-summary').hidden = true; $('#v-dash').hidden = true; const v = $('#v-upload'); v.hidden = false;
      const nameField = kind === 'kpi' ? `<div class="card" style="max-width:860px;margin-bottom:16px"><div class="grid g2">
          <div class="field"><label for="ds-name">Dataset name</label><input type="text" id="ds-name" maxlength="120" placeholder="For example: Leads and spend 2026, Search demand, Website traffic" value="${esc(newDataset ? '' : ds)}"></div>
          <div class="field"><label for="ds-mode">If the dataset exists</label><select id="ds-mode"><option value="append" ${uploadMode === 'append' ? 'selected' : ''}>Append to its history</option><option value="replace" ${uploadMode !== 'append' ? 'selected' : ''}>Replace it</option></select></div></div></div>` : '';
      v.innerHTML = `${nameField}
        <div class="dropzone" id="dz" tabindex="0" role="button" aria-label="Upload a file. Press Enter to browse.">
          <div class="ic">${ICON_UP}</div><h2>Drop your ${esc(cfg.fileLabel)} here</h2>
          <p class="muted">or click to browse. CSV of any size, Excel up to 150 MB. The file is read and stored in this browser only.</p>
          <div id="up-prog" class="progress" hidden style="max-width:360px;margin:16px auto 0"><i></i></div><div id="up-msg" class="muted small" style="margin-top:8px"></div>
        </div>
        <details class="card" style="max-width:860px;margin-top:16px"><summary style="cursor:pointer;font-weight:700">Expected columns</summary><p class="muted">${esc(EXPECTED[kind])}</p>
        <p class="muted small">Headers are matched case-insensitively and extra spaces are ignored. Anything unparseable is reported, not fatal.</p></details>
        ${canCancel ? '<p><button class="btn" id="back-dash">Back to dashboard</button></p>' : ''}`;
      const dz = $('#dz');
      dz.onclick = () => fileIn.click(); dz.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } };
      ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
      ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('over'); }));
      dz.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) doKpiUpload(e.dataTransfer.files[0]); });
      const b = $('#back-dash'); if (b) b.onclick = () => showDash();
      if ($('#ds-name')) $('#ds-name').focus();
    }
    async function doKpiUpload(file) {
      const prog = $('#up-prog'), msg = $('#up-msg');
      if (!/\.(xlsx|xls|csv|txt)$/i.test(file.name)) { App.toast('Please choose an .xlsx, .xls or .csv file.', 'error'); return; }
      const dsName = ($('#ds-name').value || '').trim();
      if (!dsName || dsName.includes(':')) { App.toast('Give the dataset a name (no colons) first.', 'error'); $('#ds-name').focus(); fileIn.value = ''; return; }
      uploadMode = $('#ds-mode').value;
      prog.hidden = false; prog.firstElementChild.style.width = '0'; msg.textContent = `Reading ${file.name}`;
      try {
        const prop = await App.data.kpiPropose(file, (p, m) => { prog.firstElementChild.style.width = Math.round(p * 100) + '%'; if (m) msg.textContent = m; });
        showMapping(prop, dsName);
      } catch (e) { App.toast(e.message, 'error', 8000); prog.hidden = true; msg.textContent = e.message; }
      fileIn.value = '';
    }
    fileIn.onchange = () => { if (fileIn.files[0]) doKpiUpload(fileIn.files[0]); };

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
          state = await App.data.kpiApply({ token: prop.token, dataset: dsName, mode: uploadMode, mapping });
          if (state.warning) App.toast(state.warning, 'error', 12000);
          ds = dsName; App.store.set('kpi-ds:' + App.clientId(), ds);
          if (uploadMode !== 'append') App.store.set(filterKey(), {});
          status = await App.data.status();
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
        try { state = await App.data.kpiMeta({ dataset: ds, metrics: readMetrics($('#e-metrics', m), base), ratios: readRatios($('#e-ratios', m)) }); m.close(); showDash(true); App.toast('Saved', 'ok'); }
        catch (e) { App.toast(e.message, 'error'); }
      };
    }
    function showSummary() {
      $('#v-upload').hidden = true; $('#v-dash').hidden = true; const v = $('#v-summary'); v.hidden = false;
      v.innerHTML = `<div class="card glow"><div class="card-head"><div><h2>File processed: ${esc(state.files[state.files.length - 1])}</h2><div class="sub">Stored in this browser for ${esc(App.shell.client() ? App.shell.client().name : 'this client')}. Review the summary, then open the dashboard.</div></div>
        <button class="btn primary" id="open-dash">Open dashboard</button></div>${summaryHtml(state.report)}</div>`;
      $('#open-dash').onclick = () => showDash(true); $('#open-dash').focus();
    }

    /* ================= dashboard ================= */
    function welcome() {
      return `<div class="card" style="text-align:center;padding:42px 20px"><div class="eyebrow">One-time setup</div><h2 style="margin:8px 0 6px;font-size:24px">Load your sheets to start predicting</h2>
        <p class="muted" style="max-width:640px;margin:0 auto">Drop the TVR programme sheet, the LMRB ad monitoring sheet, or both into the data sources above. They are read and stored in this browser only, so even 500 MB files never travel to the server. Next time you open this client on this computer, everything is already here.</p></div>`;
    }
    function showDash(fresh) {
      $('#v-upload').hidden = true; $('#v-summary').hidden = true; const v = $('#v-dash'); v.hidden = false;
      const pageLoaded = !!(state && state.loaded);
      if (predictMode && !ctx.has('tv') && !ctx.has('lmrb')) { v.innerHTML = welcome(); v.dataset.built = ''; return; }
      const sig = [ds, state && state.sig, status && status.tv && status.tv.sig, status && status.lmrb && status.lmrb.sig, JSON.stringify((state && state.meta) || {})].join('|');
      if (v.dataset.built === sig && !fresh) return;
      v.dataset.built = sig;
      const isAdmin = App.shell.me && App.shell.me.user.is_admin;
      const dsPicker = kind === 'kpi' ? `<select id="ds-sel" aria-label="KPI dataset" style="max-width:260px">${(state.datasets || []).map((d) => `<option ${d.name === ds ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>
        <button class="btn" id="b-newds" type="button">New dataset</button><button class="btn" id="b-meta" type="button">Edit metrics</button><button class="btn" id="b-append" type="button">Append file</button><button class="btn" id="b-change" type="button">Replace file</button>
        <button class="btn ghost danger" id="b-delds" type="button">Remove dataset</button>` : '';
      const INFO = SECTION_INFO;
      const tabBtn = (t) => { const i = INFO[t.id] || {}; return `<button class="tab scard ${t.predict ? 'predict' : ''}" type="button" id="tab-${t.id}" aria-haspopup="dialog" aria-controls="sheet" aria-selected="false" data-tab="${t.id}">
        <span class="sc-ic"><svg viewBox="0 0 24 24" aria-hidden="true">${i.icon || SECTION_ICON}</svg></span><span class="sc-t">${esc(t.label)}${t.predict ? '<span class="pulse" aria-hidden="true"></span>' : ''}</span>
        <span class="sc-d">${esc(i.text || '')}</span><span class="sc-go" aria-hidden="true">Open &rarr;</span></button>`; };
      const pTabs = predictMode ? (cfg.predict || []) : [];
      v.innerHTML = `
        <div class="ws-head"><div class="grow row">${dsPicker}${pageLoaded ? `<span class="badge info">${esc(state.files.slice(-3).join(' + '))}${state.files.length > 3 ? ` +${state.files.length - 3}` : ''}</span> <span class="muted small">${esc(state.report.date_min)} to ${esc(state.report.date_max)}</span>` : ''}</div>
          ${pageLoaded ? '<button class="btn" id="b-summary" type="button">Data summary</button>' : ''}
          ${isAdmin && kind !== 'kpi' ? '<button class="btn" id="b-settings" type="button">Settings</button>' : ''}
          <div class="menu"><button class="btn primary" id="b-export" type="button" aria-haspopup="true" aria-expanded="false">Client report</button><div class="menu-pop" id="export-pop" hidden></div></div></div>
        <div id="forecast-banner"></div>
        ${cfg.perspective && pageLoaded ? '<div class="card" id="persp" style="margin-bottom:16px"></div>' : ''}
        ${pageLoaded ? `<div class="card filters-card"><details id="filters-det" ${App.store.get('filters-open:' + kind, false) ? 'open' : ''}><summary><svg class="ico" viewBox="0 0 24 24"><path d="M3 5h18l-7 8v6l-4 2v-8z"/></svg>${predictMode ? 'Advanced filters for the analysis tabs' : 'Filters'} <span class="counter" id="counter" style="margin-left:auto"></span></summary>
          <div id="filter-body"></div><div class="row" style="margin-top:12px"><button class="btn sm" id="reset" type="button">Reset filters</button></div></details>
          <div class="chips" id="chips"></div></div>` : ''}
        ${pTabs.length ? `<div class="sec-title">Predictions</div><div class="section-cards feature" id="tablist" aria-label="Predictions">${pTabs.map(tabBtn).join('')}</div>` : ''}
        <div class="sec-title">${pTabs.length ? 'Analysis' : 'Sections'}</div><div class="section-cards" ${pTabs.length ? '' : 'id="tablist"'} aria-label="Sections">${cfg.tabs.map(tabBtn).join('')}</div>
        <div class="sheet-back" id="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" hidden><div class="sheet">
          <div class="sheet-bar"><h2 id="sheet-title"></h2><div class="row" id="sheet-hz" hidden></div><div class="row"><a class="btn sm" id="sheet-new" target="_blank" rel="noopener">Open in new tab</a><button class="btn sm primary" id="sheet-close" type="button">Close</button></div></div>
          <div class="sheet-body">${allTabs.map((t) => `<div role="region" id="panel-${t.id}" aria-label="${esc(t.label)}" hidden></div>`).join('')}</div></div></div>`;
      if ($('#b-summary')) $('#b-summary').onclick = () => modal('Data summary', summaryHtml(state.report));
      if ($('#b-settings')) $('#b-settings').onclick = openSettings;
      if (kind === 'kpi') {
        $('#ds-sel').onchange = async (e) => { ds = e.target.value; App.store.set('kpi-ds:' + App.clientId(), ds); data = null; state = await App.data.state('kpi', ds); showDash(true); };
        $('#b-newds').onclick = () => { uploadMode = 'replace'; showUpload(true, true); };
        $('#b-meta').onclick = editMetrics;
        $('#b-append').onclick = () => { uploadMode = 'append'; showUpload(true); };
        $('#b-change').onclick = () => { uploadMode = 'replace'; showUpload(true); };
        $('#b-delds').onclick = async () => {
          if (!confirm(`Remove the dataset "${ds}" from this browser?`)) return;
          await App.data.remove('kpi', ds); state = await App.data.state('kpi', '');
          ds = state.datasets.length ? state.datasets[0].name : ''; App.store.set('kpi-ds:' + App.clientId(), ds);
          state = await App.data.state('kpi', ds); if (state.loaded) showDash(true); else showUpload(false, true);
        };
      }
      mountExport();
      if (pageLoaded) {
        filtersCtl = App.filters.init($('#filter-body'), kind, state.options, () => load(), filterKey(), predictMode ? GMAP[kind] : []);
        $('#reset').onclick = () => filtersCtl.reset();
        $('#filters-det').ontoggle = (e) => App.store.set('filters-open:' + kind, e.target.open);
        if (cfg.perspective) mountPersp();
      } else filtersCtl = null;
      $$('.tab', v).forEach((b) => { b.onclick = () => select(b.dataset.tab, true); });
      $('#sheet-close', v).onclick = () => select(null);
      $('#sheet', v).addEventListener('mousedown', (e) => { if (e.target.id === 'sheet') select(null); });
      $('#sheet', v).addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); select(null); } });
      const want = new URLSearchParams(location.search).get('tab');
      active = null;
      if (want && allTabs.find((t) => t.id === want) && (pageLoaded || (cfg.predict || []).some((t) => t.id === want))) select(want, true);
      load();
    }

    /** Opens a section in the popup (null closes it). */
    function select(id, force) {
      const sheet = $('#sheet'); if (!sheet) return;
      const prev = active; active = id;
      $$('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === id)));
      allTabs.forEach((t) => { const p = $('#panel-' + t.id); if (p) p.hidden = t.id !== id; });
      sheet.hidden = !id; document.body.classList.toggle('sheet-open', !!id);
      if (!id) { App.charts.destroyAll(); const b = prev && $('#tab-' + prev); if (b) b.focus(); return; }
      const t = allTabs.find((x) => x.id === id);
      $('#sheet-title').textContent = t ? t.label : '';
      paintSheetHz();
      $('#sheet-new').href = location.pathname + '?tab=' + encodeURIComponent(id);
      const body = $('.sheet-body', sheet); if (body) body.scrollTop = 0;
      if (prev && prev !== id) App.charts.destroyAll();
      if (dirty.has(id) || force) renderTab(id);
      $('#sheet-close').focus();
    }
    function renderTab(id) {
      dirty.delete(id);
      const t = allTabs.find((x) => x.id === id), p = $('#panel-' + id); if (!t || !p) return;
      if (t.predict) { try { t.render(p, ctx); } catch (e) { console.error(e); p.innerHTML = App.emptyState('This prediction could not be drawn', e.message); } return; }
      if (!(state && state.loaded)) { p.innerHTML = App.emptyState(`Upload the ${kind === 'tv' ? 'TVR' : kind === 'lmrb' ? 'LMRB' : 'client'} sheet to unlock this section`, 'Use the data sources panel above. The file stays in this browser.'); return; }
      if (!data) { p.innerHTML = App.skeleton(2); return; }
      if (data.empty && !t.alwaysRender) { p.innerHTML = `${App.emptyState('No rows match the current filters', 'Widen the date range or remove a filter.')}<div style="text-align:center"><button class="btn" id="empty-reset">Reset filters</button></div>`; const r = $('#empty-reset', p); if (r) r.onclick = () => filtersCtl && filtersCtl.reset(); return; }
      try { const r = t.render(p, ctx); App.decorateHelp(p); if (r && r.then) r.then(() => App.decorateHelp(p)).catch(() => {}); } catch (e) { console.error(e); p.innerHTML = App.emptyState('This section could not be drawn', e.message); }
    }
    async function load() {
      const id = ++reqId;
      const counter = $('#counter');
      allTabs.forEach((t) => dirty.add(t.id));
      if (!(state && state.loaded)) { data = null; meta = null; if (active) renderTab(active); return; }
      const p = active && $('#panel-' + active); if (p && !data && !(cfg.predict || []).some((t) => t.id === active)) p.innerHTML = App.skeleton(3);
      try {
        const res = await App.data.dashboard(ctx.body());
        if (id !== reqId) return;
        data = res.data; meta = res.meta;
        if (counter) { counter.textContent = `Filtered rows: ${fmt.num(meta.filtered_rows)} of ${fmt.num(meta.total_rows)}`; counter.classList.toggle('warn', meta.filtered_rows === 0); }
        if ($('#chips')) App.filters.chips($('#chips'), meta.chips, (k) => (GMAP[kind] || []).includes(k) ? (delete gf[k], App.store.set(gKey(), gf), renderGlobalFilters(), load()) : filtersCtl.remove(k));
        if (cfg.onData) cfg.onData(ctx);
        allTabs.forEach((t) => { const b = $('#tab-' + t.id); if (b && t.hidden) b.hidden = !!t.hidden(ctx); });
        if (active && allTabs.find((t) => t.id === active && t.hidden && t.hidden(ctx))) select(null);
        else if (active) renderTab(active);
      } catch (e) { if (id === reqId) { App.toast(e.message, 'error'); if (p) p.innerHTML = App.emptyState('Could not load the dashboard', e.message); } }
    }
    document.addEventListener('themechange', () => { if (!$('#v-dash').hidden) { allTabs.forEach((t) => dirty.add(t.id)); if (active) renderTab(active); } });

    /* ---------------- perspective (LMRB) ---------------- */
    function mountPersp() {
      const el = $('#persp'), advs = state.options.advertiser || [], sets = state.tv_data_sets || [];
      App.charts.register(advs);
      el.innerHTML = `<div class="card-head"><div><h3>Competitor set ${App.help('Your brand and its competitors define share of voice, GRP share and alerts. By default competitors are the advertisers in the same product group.', 'Pick the client brand once; the Market prediction tab and the analysis tabs use it.')}</h3><div class="sub">Pick the client's brand to unlock share of voice, GRP share and alerts. Default competitors are the advertisers in the same product group.</div></div></div>
        <div class="grid ${sets.length ? 'g3' : 'g2'}"><div class="field"><label for="my-brand">Client brand / advertiser</label><select id="my-brand"><option value="">None (all advertisers)</option>${advs.map((a) => `<option ${a === persp.my_brand ? 'selected' : ''} value="${esc(a)}">${esc(a)}</option>`).join('')}</select></div><div id="comp-ms"></div>
        ${sets.length ? `<div class="field"><label for="tv-set">TVR target audience for GRPs</label><select id="tv-set">${sets.map((s) => `<option ${s === persp.tv_data_set ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>` : ''}</div>`;
      const save = () => { App.store.set('persp:lmrb', persp); (cfg.predict || []).forEach((t) => dirty.add(t.id)); load(); };
      $('#my-brand').onchange = (e) => { persp.my_brand = e.target.value; save(); };
      if ($('#tv-set')) $('#tv-set').onchange = (e) => { persp.tv_data_set = e.target.value; save(); };
      const ms = App.filters.multi({ key: 'competitors', label: 'Competitors (optional override)' }, advs, persp, save);
      $('#comp-ms').replaceWith(ms);
    }

    /* ---------------- client report menu ---------------- */
    function mountExport() {
      const btn = $('#b-export'), pop = $('#export-pop');
      const last = (store) => App[store] && App[store][ctx.fkey()];
      pop.innerHTML = `<div class="field" style="margin-bottom:8px"><label for="ex-title">Report title</label><input type="text" id="ex-title" maxlength="120" placeholder="${esc(cfg.reportTitle || cfg.fileLabel.replace(/ file$/, ''))} report"></div>
        <label class="row small" style="margin-bottom:6px"><input type="checkbox" id="ex-ai" checked> Executive summary (Gemini, rule-based if unavailable)</label>
        ${predictMode ? '<label class="row small" style="margin-bottom:6px"><input type="checkbox" id="ex-pr" checked> Prediction tabs and Planner\'s Evidence</label>' : ''}
        <label class="row small" style="margin-bottom:6px"><input type="checkbox" id="ex-fc" checked> Last Forecast studio run</label>
        <label class="row small" style="margin-bottom:6px"><input type="checkbox" id="ex-sc" checked> Last scenario plan</label>
        <label class="row small" style="margin-bottom:10px"><input type="checkbox" id="ex-pc" checked> Last pacing check</label>
        <button class="btn" data-fmt="pdf" type="button">Branded PDF report</button><button class="btn" data-fmt="pptx" type="button">PowerPoint deck</button><button class="btn" data-fmt="xlsx" type="button">Excel workbook</button>
        <div class="muted small" id="ex-msg">Copies are kept under Mission control.</div>`;
      btn.onclick = () => {
        if (!(state && state.loaded) || !data) { App.toast(`Upload the ${kind === 'tv' ? 'TVR' : kind === 'lmrb' ? 'LMRB' : 'client'} sheet first. Reports summarise this page's data.`, 'error'); return; }
        pop.hidden = !pop.hidden; btn.setAttribute('aria-expanded', String(!pop.hidden));
        [['ex-fc', 'lastForecast'], ['ex-sc', 'lastScenarios'], ['ex-pc', 'lastPacing']].forEach(([id, st]) => { const c = $('#' + id, pop); c.disabled = !last(st); if (!last(st)) c.checked = false; });
        const pr = $('#ex-pr', pop); if (pr) { const has = App.exporter.hasPrediction(kind); pr.disabled = !has; if (!has) pr.checked = false; }
      };
      document.addEventListener('click', (e) => { if (!pop.hidden && !e.target.closest('.menu')) { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
      $$('[data-fmt]', pop).forEach((b) => { b.onclick = async () => {
        const msg = $('#ex-msg', pop); b.disabled = true; msg.textContent = 'Building report. This can take up to a minute.';
        try {
          await App.exporter.run(b.dataset.fmt, ctx, { title: $('#ex-title', pop).value, includeAi: $('#ex-ai', pop).checked, includeForecast: $('#ex-fc', pop).checked,
            includeScenarios: $('#ex-sc', pop).checked, includePacing: $('#ex-pc', pop).checked, includePrediction: !!($('#ex-pr', pop) && $('#ex-pr', pop).checked) });
          msg.textContent = 'Downloaded. A copy is saved under Mission control.';
        } catch (e) { App.toast(e.message, 'error', 8000); msg.textContent = ''; }
        b.disabled = false;
      }; });
    }

    // every card title that gains content later (forecast results, head-to-head) gets its "?" too
    let helpT = null;
    new MutationObserver(() => { clearTimeout(helpT); helpT = setTimeout(() => App.decorateHelp(root), 60); }).observe(root, { childList: true, subtree: true });

    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && active && !document.querySelector('.modal-back') && !document.querySelector('.ms-pop')) select(null); });

    /* ---------------- boot ---------------- */
    App.loader.show('Initialising', 'Opening your data vault in this browser');
    App.shell.init(kind).then(async () => {
      if (!App.clientId()) { App.loader.hide(0); App.shell.noClient(root); return; }
      try {
        status = await App.data.open();
        if (kind === 'kpi') {
          state = await App.data.state('kpi', ds);
          if (!state.loaded && state.datasets && state.datasets.length) { ds = state.datasets[0].name; App.store.set('kpi-ds:' + App.clientId(), ds); state = await App.data.state('kpi', ds); }
          if (state.loaded) showDash(true); else showUpload(false, true);
        } else {
          App.loader.progress(null, 'Calibrating the prediction engine');
          gopts = await App.data.globalOptions();
          state = await App.data.state(kind, '');
          renderControl();
          showDash(true);
        }
      } catch (e) { App.toast(e.message, 'error', 10000); root.insertAdjacentHTML('beforeend', App.emptyState('Could not open the data in this browser', e.message)); }
      App.loader.hide();
    }).catch((e) => { App.loader.hide(0); if (e.status !== 401) App.toast(e.message, 'error'); });
    return ctx;
  }
  App.workspace = workspace;
  App.summaryHtml = summaryHtml;
})(window.App);
