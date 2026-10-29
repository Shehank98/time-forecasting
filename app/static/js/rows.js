/* Paginated raw rows view (server paged, respects filters). */
(function (App) {
  App.rawRows = function (p, ctx) {
    p.innerHTML = '<div class="card"><div class="card-head"><div><h3>Filtered rows</h3><div class="sub">Server-side paging. Only the current page is sent to the browser.</div></div></div><div id="raw"></div></div>';
    const cols = ctx.kind === 'tv'
      ? ['date', 'day', 'channel', 'start', 'end', 'program', 'category', 'data_set', 'daypart', 'duration', 'tvr', 'total_tvr', 'tvr_share', 'reach', 'reach_pct']
      : ['date', 'day', 'channel', 'program', 'advt_time', 'daypart', 'advertiser', 'product', 'theme', 'product_group', 'lng', 'dur', 'dur_band', 'position', 'brkno', 'posinbrk', 'adsinbrk', 'cost', 'cps'];
    const numeric = new Set(['duration', 'tvr', 'total_tvr', 'tvr_share', 'reach', 'reach_pct', 'dur', 'brkno', 'posinbrk', 'adsinbrk', 'cost', 'cps']);
    T_create(p.querySelector('#raw'), cols, numeric, ctx);
  };
  function T_create(el, cols, numeric, ctx) {
    App.tables.create(el, {
      pageSize: 25, csv: ctx.kind + '_filtered_rows', defaultSort: { key: 'date', desc: true },
      columns: cols.map((c) => ({ key: c, label: c.replace(/_/g, ' '), num: numeric.has(c), fmt: numeric.has(c) ? (v) => App.fmt.num(v, c === 'cps' || c.includes('tvr') || c.includes('pct') || c === 'tvr_share' ? 2 : 0) : undefined })),
      remote: async ({ page, pageSize, sort, desc, search }) => {
        const r = await App.api.post(`/api/${ctx.kind}/rows`, { filters: ctx.filters(), options: ctx.options(), page, page_size: pageSize, sort, desc, search });
        return { total: r.total, rows: r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c, row[i]]))) };
      },
      csvRemote: () => App.api.blob(`/api/${ctx.kind}/rows/csv`, { filters: ctx.filters(), options: ctx.options() }),
    });
  }
})(window.App);
