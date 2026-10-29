/* Sortable, searchable, paginated tables with CSV download. Local or server paged. */
(function (App) {
  const { esc } = App;
  let uid = 0;
  const csvCell = (v) => { if (v == null) return ''; if (Array.isArray(v)) v = v.join('; '); v = String(v); if (/^[=+\-@\t\r]/.test(v) && Number.isNaN(Number(v))) v = "'" + v; return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  function toCsv(cols, rows) {
    return '﻿' + [cols.map((c) => csvCell(c.label)).join(',')].concat(rows.map((r) => cols.map((c) => csvCell(r[c.key])).join(','))).join('\n');
  }
  /**
   * cfg: {columns:[{key,label,num,fmt(v,row)->text,html(v,row)->html,sortable}], rows, pageSize, search, csv,
   *       defaultSort:{key,desc}, remote:async({page,pageSize,sort,desc,search})=>({rows,total}), csvRemote:async()=>blob, empty}
   */
  function create(el, cfg) {
    const id = 't' + ++uid;
    const st = { page: 1, size: cfg.pageSize || 15, sort: cfg.defaultSort ? cfg.defaultSort.key : null, desc: cfg.defaultSort ? !!cfg.defaultSort.desc : true, q: '' };
    let all = cfg.rows || [], view = [], total = 0, busy = false;
    const cols = cfg.columns;
    const cmp = (a, b) => (a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true }));
    async function compute() {
      if (cfg.remote) {
        busy = true; paint();
        try { const r = await cfg.remote({ page: st.page, pageSize: st.size, sort: st.sort, desc: st.desc, search: st.q }); view = r.rows; total = r.total; }
        catch (e) { App.toast(e.message, 'error'); view = []; total = 0; }
        busy = false; return;
      }
      let rows = all;
      if (st.q) { const q = st.q.toLowerCase(); rows = rows.filter((r) => cols.some((c) => String(Array.isArray(r[c.key]) ? r[c.key].join(' ') : r[c.key] ?? '').toLowerCase().includes(q))); }
      if (st.sort) { const k = st.sort; rows = rows.slice().sort((a, b) => (st.desc ? -1 : 1) * cmp(a[k], b[k])); }
      total = rows.length; view = rows.slice((st.page - 1) * st.size, st.page * st.size);
    }
    function paint() {
      const pages = Math.max(1, Math.ceil(total / st.size));
      const searchable = cfg.search !== false;
      el.innerHTML = `
        <div class="tbl-tools">${searchable ? `<input type="search" placeholder="Search table" aria-label="Search table" value="${esc(st.q)}" data-q>` : ''}
          <span class="muted small">${App.fmt.num(total)} rows</span><span class="grow" style="flex:1"></span>
          <button class="btn sm" type="button" data-csv>Download CSV</button></div>
        <div class="tbl-scroll"><table class="tbl"><thead><tr>${cols.map((c) => `<th class="${c.num ? 'num' : ''}" ${c.sortable === false ? '' : `data-sort="${esc(c.key)}" tabindex="0"`} ${st.sort === c.key ? `aria-sort="${st.desc ? 'descending' : 'ascending'}"` : ''}>${esc(c.label)}</th>`).join('')}</tr></thead>
        <tbody>${busy ? `<tr><td colspan="${cols.length}"><div class="skeleton" style="height:60px"></div></td></tr>` : view.length ? view.map((r) => `<tr>${cols.map((c) => {
          const v = r[c.key]; const inner = c.html ? c.html(v, r) : esc(c.fmt ? c.fmt(v, r) : v ?? '');
          return `<td class="${c.num ? 'num' : ''}">${inner}</td>`; }).join('')}</tr>`).join('') : `<tr><td colspan="${cols.length}" class="muted" style="text-align:center;padding:24px">${esc(cfg.empty || 'No rows to show')}</td></tr>`}</tbody></table></div>
        <div class="pager"><span class="muted small">Page ${st.page} of ${pages}</span><span class="row"><button class="btn sm" data-prev ${st.page <= 1 ? 'disabled' : ''}>Previous</button><button class="btn sm" data-next ${st.page >= pages ? 'disabled' : ''}>Next</button></span></div>`;
      const q = el.querySelector('[data-q]');
      if (q) { q.oninput = App.debounce(async () => { st.q = q.value; st.page = 1; await compute(); paint(); const n = el.querySelector('[data-q]'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); }
      el.querySelectorAll('th[data-sort]').forEach((th) => {
        const go = async () => { const k = th.dataset.sort; if (st.sort === k) st.desc = !st.desc; else { st.sort = k; st.desc = !!cols.find((c) => c.key === k).num; } st.page = 1; await compute(); paint(); };
        th.onclick = go; th.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
      });
      el.querySelector('[data-prev]').onclick = async () => { st.page--; await compute(); paint(); };
      el.querySelector('[data-next]').onclick = async () => { st.page++; await compute(); paint(); };
      el.querySelector('[data-csv]').onclick = async () => {
        if (cfg.csvRemote) { try { const b = await cfg.csvRemote(); App.download(b.blob, (cfg.csv || 'table') + '.csv'); } catch (e) { App.toast(e.message, 'error'); } return; }
        let rows = all;
        if (st.q) { const q = st.q.toLowerCase(); rows = rows.filter((r) => cols.some((c) => String(r[c.key] ?? '').toLowerCase().includes(q))); }
        if (st.sort) rows = rows.slice().sort((a, b) => (st.desc ? -1 : 1) * cmp(a[st.sort], b[st.sort]));
        App.download(new Blob([toCsv(cols, rows)], { type: 'text/csv' }), (cfg.csv || 'table') + '.csv');
      };
    }
    compute().then(paint);
    return { refresh(rows) { if (rows) all = rows; st.page = 1; return compute().then(paint); } };
  }
  App.tables = { create };
})(window.App);
