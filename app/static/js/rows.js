/* Paginated raw rows view, paged by the data worker from the sheets stored in this browser. */
(function (App) {
  const NUMERIC = new Set(['duration', 'tvr', 'total_tvr', 'tvr_share', 'reach', 'reach_pct', 'dur', 'brkno', 'posinbrk', 'adsinbrk', 'cost', 'cps']);
  const COLS = {
    tv: ['date', 'day', 'channel', 'start', 'end', 'program', 'category', 'data_set', 'daypart', 'duration', 'tvr', 'total_tvr', 'tvr_share', 'reach', 'reach_pct'],
    lmrb: ['date', 'day', 'channel', 'program', 'advt_time', 'daypart', 'advertiser', 'product', 'theme', 'product_group', 'lng', 'dur', 'dur_band', 'position', 'brkno', 'posinbrk', 'adsinbrk', 'cost', 'cps'],
  };
  App.rawRows = function (p, ctx) {
    p.innerHTML = '<div class="card"><div class="card-head"><div><h3>Filtered rows</h3><div class="sub">Paged from the data stored in this browser. Export downloads every filtered row as CSV.</div></div></div><div id="raw"></div></div>';
    const metrics = ctx.kind === 'kpi' ? ctx.state.meta.metrics : [];
    const cols = ctx.kind === 'kpi' ? ['date', 'segment'].concat(metrics.map((m) => m.key)) : COLS[ctx.kind];
    const labels = Object.fromEntries(metrics.map((m) => [m.key, m.label]));
    const isNum = (c) => NUMERIC.has(c) || !!labels[c];
    App.tables.create(p.querySelector('#raw'), {
      pageSize: 25, csv: ctx.kind + '_filtered_rows', defaultSort: { key: 'date', desc: true },
      columns: cols.map((c) => ({ key: c, label: labels[c] || c.replace(/_/g, ' '), num: isNum(c), fmt: isNum(c) ? (v) => App.fmt.num(v, c === 'cps' || c.includes('tvr') || c.includes('pct') || labels[c] ? 2 : 0) : undefined })),
      remote: async ({ page, pageSize, sort, desc, search }) => {
        const r = await App.data.rows(ctx.body({ page, page_size: pageSize, sort, desc, search }));
        return { total: r.total, rows: r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c, row[i]]))) };
      },
      csvRemote: async () => { const r = await App.data.rowsCsv(ctx.body()); if (r.truncated) App.toast('The CSV holds the first 1,000,000 filtered rows. Narrow the filters for the rest.', 'info', 8000); return r; },
    });
  };
})(window.App);
