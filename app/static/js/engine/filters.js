/* Filters on columnar tables: row selection, filter chips and filter options. Mirrors app/services/filters.py. */
(function (root) {
  const MR = root.MR;
  const { DAY_NAMES, dowMon, dayFromIso } = MR;
  const POS = ['first', 'middle', 'last', 'unknown'];
  // filter key -> column. 'program' is shared so the global Program filter works on both sheets.
  const MULTI = {
    tv: { channel: 'channel', program: 'program', category: 'category', day: 'day', daypart: 'daypart', data_set: 'data_set' },
    lmrb: { product_group: 'product_group', advertiser: 'advertiser', product: 'product', channel: 'channel', program: 'program', language: 'lng',
      duration_band: 'dur_band', daypart: 'daypart', ad_position: 'position' },
    kpi: { segment: 'segment' },
  };
  const LABELS = { data_set: 'Data Set', product_group: 'Product Group', ad_position: 'Ad Position', duration_band: 'Duration Band' };
  const asList = (v) => (v == null ? [] : (Array.isArray(v) ? v : [v]).map(String).filter((x) => x !== ''));
  const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

  /** Row indices passing the filters. skipDate leaves the date range out (used for comparison windows). */
  function applyFilters(T, kind, f, skipDate) {
    f = f || {};
    const tests = [];
    if (!skipDate) {
      const d0 = dayFromIso(f.date_from), d1 = dayFromIso(f.date_to), D = T.cols.date;
      if (Number.isFinite(d0)) tests.push((i) => D[i] >= d0);
      if (Number.isFinite(d1)) tests.push((i) => D[i] <= d1);
    }
    for (const [key, col] of Object.entries(MULTI[kind])) {
      const vals = asList(f[key]);
      if (!vals.length) continue;
      if (col === 'day') { const want = new Set(vals.map((v) => DAY_NAMES.indexOf(v))); const D = T.cols.date; tests.push((i) => want.has(dowMon(D[i]))); continue; }
      if (col === 'position') { const want = new Set(vals.map((v) => POS.indexOf(v))); const P = T.cols.position; tests.push((i) => want.has(P[i])); continue; }
      if (!T.cols[col]) continue;
      const codes = MR.codeSet(T, col, vals), C = T.cols[col];
      tests.push((i) => codes.has(C[i]));
    }
    if (kind === 'tv') {
      const q = String(f.program_search || '').trim().toUpperCase();
      if (q) { const P = T.cols.program, dict = T.dicts.program, hit = dict.map((s) => s.includes(q)); tests.push((i) => P[i] >= 0 && hit[P[i]]); }
      const lo = num(f.tvr_min), hi = num(f.tvr_max), V = T.cols.tvr;
      if (lo != null) tests.push((i) => V[i] >= lo);
      if (hi != null) tests.push((i) => V[i] <= hi);
    } else if (kind === 'lmrb') {
      const lo = num(f.cost_min), hi = num(f.cost_max), V = T.cols.cost;
      if (lo != null) tests.push((i) => V[i] >= lo);
      if (hi != null) tests.push((i) => V[i] <= hi);
    }
    const out = new MR.NumCol(Int32Array, Math.max(16, T.n >> 1));
    outer: for (let i = 0; i < T.n; i++) { for (let t = 0; t < tests.length; t++) if (!tests[t](i)) continue outer; out.push(i); }
    return out.done();
  }

  function describeFilters(kind, f) {
    f = f || {};
    const out = [];
    if (f.date_from || f.date_to) out.push({ key: 'date', label: 'Dates', value: `${f.date_from || '...'} to ${f.date_to || '...'}` });
    for (const key of Object.keys(MULTI[kind])) {
      const vals = asList(f[key]);
      if (vals.length) out.push({ key, label: LABELS[key] || MR.title(key.replace(/_/g, ' ')), value: vals.slice(0, 4).join(', ') + (vals.length > 4 ? ` +${vals.length - 4}` : '') });
    }
    if (kind === 'tv') {
      if (f.program_search) out.push({ key: 'program_search', label: 'Programme', value: String(f.program_search) });
      if (num(f.tvr_min) != null || num(f.tvr_max) != null) out.push({ key: 'tvr', label: 'TVR', value: `${f.tvr_min || '0'} to ${f.tvr_max || 'max'}` });
    } else if (kind === 'lmrb' && (num(f.cost_min) != null || num(f.cost_max) != null)) out.push({ key: 'cost', label: 'Cost', value: `${f.cost_min || '0'} to ${f.cost_max || 'max'}` });
    return out;
  }

  /** Values for the filter controls. */
  function filterOptions(T, kind, programLimit = 400) {
    if (!T || !T.n) return {};
    const idx = MR.allIdx(T);
    const [lo, hi] = MR.minMax(T.cols.date, idx);
    const out = { date_min: MR.isoFromDay(lo), date_max: MR.isoFromDay(hi) };
    const counts = (col, val) => { const m = new Map(); const C = T.cols[col], V = val && T.cols[val]; for (let i = 0; i < T.n; i++) { const c = C[i]; if (c < 0) continue; m.set(c, (m.get(c) || 0) + (V ? V[i] : 1)); } return m; };
    const present = (col) => new Set([...counts(col).keys()].map((c) => T.dicts[col][c]));
    for (const [key, col] of Object.entries(MULTI[kind])) {
      let vals;
      if (col === 'day') { const s = new Set(); for (let i = 0; i < T.n; i++) s.add(DAY_NAMES[dowMon(T.cols.date[i])]); vals = DAY_NAMES.filter((d) => s.has(d)); }
      else if (col === 'position') vals = ['first', 'middle', 'last'];
      else if (!T.cols[col]) continue;
      else if (kind === 'lmrb' && key === 'advertiser') vals = [...counts(col, 'cost').entries()].sort((a, b) => b[1] - a[1]).map((e) => T.dicts[col][e[0]]);
      else if (key === 'program') vals = [...counts(col).entries()].sort((a, b) => b[1] - a[1]).slice(0, programLimit).map((e) => T.dicts[col][e[0]]);
      else if (key === 'daypart') { const p = present(col), order = MR.daypartOrder(); vals = order.filter((d) => p.has(d)).concat([...p].filter((d) => !order.includes(d)).sort()); }
      else if (key === 'duration_band') { const p = present(col); vals = MR.bandOrder().filter((d) => p.has(d)); }
      else vals = [...present(col)].sort();
      out[key] = vals;
    }
    if (kind === 'tv') {
      out.tvr_range = MR.minMax(T.cols.tvr, idx);
      out.data_set_list = [...present('data_set')].sort();
      out.category = out.category || [];
    } else if (kind === 'lmrb') {
      out.cost_range = MR.minMax(T.cols.cost, idx);
      const g = {};
      for (let i = 0; i < T.n; i++) { const a = T.dicts.advertiser[T.cols.advertiser[i]]; (g[a] = g[a] || new Set()).add(T.dicts.product_group[T.cols.product_group[i]]); }
      out.advertiser_groups = Object.fromEntries(Object.entries(g).map(([k, v]) => [k, [...v].sort()]));
    }
    return out;
  }

  Object.assign(MR, { MULTI, POS, applyFilters, describeFilters, filterOptions });
})(typeof self !== 'undefined' ? self : globalThis);
