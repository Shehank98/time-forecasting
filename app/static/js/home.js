/* Client overview: the three workspaces, stored datasets, saved forecasts, reports and upload history. */
(function (App) {
  const { esc, fmt, $ } = App;
  const CARDS = [
    ['tv', '/tv.html', 'TV Programme Analysis', 'TVR sheet: top programmes, time-belt and channel heatmaps, efficiency, consistency, slot opportunities and TVR forecasts.', '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>'],
    ['lmrb', '/lmrb.html', 'LMRB Ad Monitoring', 'Competitor spots and spend: share of voice, GRPs and CPRP, flighting, creatives, pricing, alerts and competitor forecasts.', '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'],
    ['kpi', '/kpi.html', 'Client KPI Forecast', 'Any dated client data: leads, sales, traffic, search demand. CPL, CPA and CPRP, spend scenarios, pacing and demand peaks.', '<path d="M3 17l5-6 4 4 8-10"/><path d="M15 5h5v5"/>'],
  ];
  const when = (s) => (s ? String(s).slice(0, 16).replace('T', ' ') : '');
  const page = { tv: '/tv.html', lmrb: '/lmrb.html', kpi: '/kpi.html' };

  async function render() {
    const me = await App.shell.init('home');
    const root = $('#home');
    const c = App.shell.client();
    if (!c) { App.shell.noClient(root); return; }
    $('#client-head').innerHTML = `<div class="row">${c.has_logo ? `<img src="/api/clients/${c.id}/logo" alt="" class="client-logo lg">` : `<span class="client-dot lg" style="background:${esc(c.brand_color)}"></span>`}<div><h1>${esc(c.name)}</h1><div class="muted">${esc(c.industry || 'Client')} overview</div></div></div>`;
    root.innerHTML = App.skeleton(2);
    let s;
    try { s = await App.api.get('/api/workspace/summary'); } catch (e) { root.innerHTML = App.emptyState('Could not load the client', e.message); return; }
    const byKind = (k) => s.datasets.filter((d) => d.kind === k);
    root.innerHTML = `<div class="home-cards three">${CARDS.map(([k, href, title, text, icon]) => {
        const d = byKind(k);
        const status = d.length ? (k === 'kpi' ? `<span class="badge good">${d.length} dataset${d.length === 1 ? '' : 's'}</span> ${esc(d.map((x) => x.name).join(', '))}`
          : `<span class="badge good">Loaded</span> ${fmt.num(d[0].rows)} rows, ${esc(d[0].date_min)} to ${esc(d[0].date_max)}`) : '<span class="muted">No data yet</span>';
        return `<a class="home-card" href="${href}"><div class="ic"><svg viewBox="0 0 24 24">${icon}</svg></div><h2>${title}</h2><p>${text}</p><div class="small">${status}</div><span class="go">Open workspace &rarr;</span></a>`; }).join('')}</div>
      <div class="grid g2" style="margin-top:24px">
        <div class="card"><div class="card-head"><div><h3>Saved forecasts</h3><div class="sub">Forecasts, scenario plans and pacing checks saved for ${esc(c.name)}</div></div></div><div id="h-fc"></div></div>
        <div class="card"><div class="card-head"><div><h3>Client reports</h3><div class="sub">Every PDF, PowerPoint and Excel report generated for ${esc(c.name)}</div></div></div><div id="h-rep"></div></div></div>
      <div class="card" style="margin-top:16px"><div class="card-head"><div><h3>Upload history</h3><div class="sub">History grows with every append, month by month</div></div></div><div id="h-up"></div></div>`;
    App.tables.create($('#h-fc'), { csv: 'saved_forecasts', pageSize: 8, empty: 'Nothing saved yet. Use "Save to client" in any Forecast tab.', rows: s.forecasts, columns: [
      { key: 'title', label: 'Title', html: (v, r) => `<a href="${page[r.kind] || '/'}?tab=forecast&saved=${r.id}${r.dataset ? '&dataset=' + encodeURIComponent(r.dataset) : ''}">${esc(v)}</a>` },
      { key: 'ftype', label: 'Type', fmt: fmt.title }, { key: 'kind', label: 'Workspace', fmt: (v) => ({ tv: 'TV', lmrb: 'LMRB', kpi: 'KPI' }[v] || v) }, { key: 'backend', label: 'Model', fmt: (v) => (v === 'timesfm' ? 'TimesFM' : v === 'timesfm_xreg' ? 'TimesFM + XReg' : v) },
      { key: 'created_at', label: 'Saved', fmt: when }, { key: 'id', label: '', sortable: false, html: (v) => `<button class="btn sm" data-delfc="${v}" type="button">Delete</button>` }] });
    App.tables.create($('#h-rep'), { csv: 'reports', pageSize: 8, empty: 'No reports yet. Use "Client report" in any workspace.', rows: s.reports, columns: [
      { key: 'filename', label: 'File', html: (v, r) => `<a href="#" data-dl="${r.id}">${esc(v)}</a>` }, { key: 'format', label: 'Format', fmt: (v) => v.toUpperCase() },
      { key: 'size', label: 'Size', num: true, fmt: (v) => fmt.num(v / 1024, 0) + ' KB' }, { key: 'by', label: 'By' }, { key: 'created_at', label: 'Created', fmt: when },
      { key: 'id', label: '', sortable: false, html: (v) => `<button class="btn sm" data-delrep="${v}" type="button">Delete</button>` }] });
    App.tables.create($('#h-up'), { csv: 'uploads', pageSize: 8, empty: 'No uploads yet.', rows: s.uploads, columns: [
      { key: 'at', label: 'When', fmt: when }, { key: 'kind', label: 'Workspace', fmt: (v) => v.toUpperCase() }, { key: 'name', label: 'Dataset' }, { key: 'file_name', label: 'File' },
      { key: 'mode', label: 'Mode' }, { key: 'rows_in', label: 'Rows in file', num: true }, { key: 'rows_added', label: 'Rows added', num: true }, { key: 'by', label: 'By' }] });
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
