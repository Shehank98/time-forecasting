/* Regularly spaced series for forecasting, built in the browser. Mirrors app/services/series.py.
 * Only these compact series are sent to the server for the forecast engine; the raw rows stay in the browser.
 */
(function (root) {
  const MR = root.MR;
  const { S, isoFromDay, weekStart, monthStart, addMonths, dowMon } = MR;
  const GRANULARITIES = ['daily', 'weekly', 'monthly'];
  const DAYS_PER = { daily: 1, weekly: 7, monthly: 30.4 };
  const PER_NAME = { daily: 'day', weekly: 'week', monthly: 'month' };

  const M = (key, label, agg, o = {}) => ({ key, label, agg, col: o.col || null, num: o.num || null, den: o.den || null,
    zero_fill: o.zero_fill != null ? o.zero_fill : true, unit: o.unit || 'number', scale: o.scale || 1 });
  const additive = (m) => m.agg === 'sum' || m.agg === 'count';

  /* ---------------- catalogs ---------------- */
  function lmrbMetrics(T) {
    const m = {
      spend: M('spend', 'Spend (LKR)', 'sum', { col: 'cost', unit: 'currency' }),
      spots: M('spots', 'Spot count', 'count'),
      sov: M('sov', 'Share of voice, spend (%)', 'share', { col: 'cost', unit: 'percent' }),
      cps: M('cps', 'Cost per second (LKR)', 'ratio', { num: 'cost', den: 'dur', zero_fill: false, unit: 'currency' }),
    };
    if (T && T.cols.grp && T.cols.grp.some(Number.isFinite)) {
      m.grp = M('grp', 'GRPs delivered', 'sum', { col: 'grp', unit: 'rating' });
      m.cprp = M('cprp', 'Cost per GRP, CPRP (LKR)', 'ratio', { num: 'cost_matched', den: 'grp', zero_fill: false, unit: 'currency' });
      m.sog = M('sog', 'Share of GRPs (%)', 'share', { col: 'grp', unit: 'percent' });
    }
    // browser-only extras used by the Market Prediction tab
    m.clutter = M('clutter', 'Average ads in break', 'mean', { col: 'adsinbrk', zero_fill: false });
    m.posinbrk = M('posinbrk', 'Average position in break', 'mean', { col: 'posinbrk', zero_fill: false });
    m.cost_per_spot = M('cost_per_spot', 'Average cost per spot (LKR)', 'mean', { col: 'cost', zero_fill: false, unit: 'currency' });
    return m;
  }
  const TV_METRICS = {
    tvr: M('tvr', 'Average TVR', 'mean', { col: 'tvr', zero_fill: false, unit: 'rating' }),
    reach: M('reach', 'Average reach per airing', 'mean', { col: 'reach', zero_fill: false }),
    share: M('share', 'Average TVR share (%)', 'mean', { col: 'tvr_share', zero_fill: false, unit: 'percent' }),
    reach_pct: M('reach_pct', 'Average reach (%)', 'mean', { col: 'reach_pct', zero_fill: false, unit: 'percent' }),
    tvr_sum: M('tvr_sum', 'TVR share of the day (%)', 'share', { col: 'tvr', unit: 'percent' }),
  };
  function kpiMetrics(meta) {
    const out = {};
    if (!meta) return out;
    for (const m of meta.metrics || []) {
      const agg = m.agg === 'mean' ? 'mean' : 'sum';
      out[m.key] = M(m.key, m.label, agg, { col: m.key, zero_fill: m.zero_fill != null ? !!m.zero_fill : agg === 'sum', unit: m.unit || 'number' });
    }
    for (const r of meta.ratios || []) {
      if (out[r.num] && out[r.den]) out[r.key] = M(r.key, r.label, 'ratio', { num: r.num, den: r.den, zero_fill: false, unit: r.unit || 'currency', scale: Number(r.scale || 1) });
    }
    return out;
  }
  const LMRB_ENTITIES = { advertiser: 'advertiser', product_group: 'product_group', channel: 'channel', daypart: 'daypart', total: null,
    product: 'product', program: (T) => (i) => `${S(T, 'channel', i)} / ${S(T, 'program', i)}` };
  const TV_ENTITIES = { channel: 'channel', category: 'category', daypart: 'daypart', timebelt: (T) => (i) => MR.timebelt(T.cols.start[i]),
    program: (T) => (i) => MR.tvProgramKey(T, i), total: null, hour: (T) => (i) => MR.hourBand(T.cols.start[i]),
    day: (T) => (i) => MR.DAY_NAMES[dowMon(T.cols.date[i])] };

  function catalog(kind, T, meta) {
    if (kind === 'lmrb') return [lmrbMetrics(T), LMRB_ENTITIES];
    if (kind === 'tv') return [TV_METRICS, TV_ENTITIES];
    const ents = { segment: 'segment', total: null };
    if (T && (!T.cols.segment || T.dicts.segment.length <= 1)) delete ents.segment;
    return [kpiMetrics(meta || T.meta), ents];
  }
  function metricCatalog(kind, T, meta) {
    const [metrics, ents] = catalog(kind, T, meta);
    return { metrics: Object.fromEntries(Object.entries(metrics).map(([k, v]) => [k, v.label])), units: Object.fromEntries(Object.entries(metrics).map(([k, v]) => [k, v.unit])),
      entities: Object.keys(ents), granularities: GRANULARITIES };
  }

  /** Entity of a row as a string ('All' for totals), matching pandas astype(str). */
  function entityFn(T, ent) {
    if (ent == null) return () => 'All';
    if (typeof ent === 'function') { const f = ent(T); return (i) => { const v = f(i); return v == null ? 'None' : String(v); }; }
    return (i) => { const v = S(T, ent, i); return v == null ? 'None' : v; };
  }
  /** Column value with the ingest NA codes (-1 for missing integers) turned into NaN. */
  function valFn(T, col) {
    const C = T.cols[col];
    if (!C) return null;
    if (C instanceof Int32Array || C instanceof Int16Array || C instanceof Int8Array) return (i) => (C[i] < 0 ? NaN : C[i]);
    return (i) => C[i];
  }

  /* ---------------- periods ---------------- */
  const periodOf = (gran) => (gran === 'daily' ? (d) => d : gran === 'weekly' ? weekStart : monthStart);
  const nextPeriod = (d, gran) => (gran === 'daily' ? d + 1 : gran === 'weekly' ? d + 7 : addMonths(d, 1));
  function axis(lo, hi, gran) { const out = []; for (let d = lo; d <= hi; d = nextPeriod(d, gran)) out.push(d); return out; }
  function futureDates(last, n, gran) { const out = []; let d = last; for (let k = 0; k < n; k++) { d = nextPeriod(d, gran); out.push(d); } return out; }
  const horizonPoints = (days, gran) => Math.max(1, Math.ceil(days / DAYS_PER[gran]));

  function volumeFn(T, kind, metrics, metric) {
    if (kind === 'lmrb') return (i) => T.cols.cost[i];
    if (kind === 'kpi' && metric && metrics[metric]) {
      const m = metrics[metric], c = m.col || m.den;
      if (T.cols[c]) return (i) => { const v = T.cols[c][i]; return Number.isFinite(v) ? Math.abs(v) : 0; };
    }
    return () => 1;
  }

  /** Candidate entities ranked by volume, for the entity picker. */
  function rankEntities(T, idx, kind, entityType, limit = 60, meta = null, metric = null) {
    const [metrics, ents] = catalog(kind, T, meta);
    if (!(entityType in ents)) throw new Error(`Unknown entity type: ${entityType}`);
    const vol = volumeFn(T, kind, metrics, metric);
    if (ents[entityType] == null) { let s = 0; for (let k = 0; k < idx.length; k++) s += vol(idx[k]); return [{ name: 'All', volume: s, rows: idx.length }]; }
    const ef = entityFn(T, ents[entityType]), g = new Map();
    for (let k = 0; k < idx.length; k++) { const i = idx[k], e = ef(i), r = g.get(e) || { sum: 0, n: 0 }; r.sum += vol(i); r.n++; g.set(e, r); }
    return [...g.entries()].sort((a, b) => (b[1].sum - a[1].sum) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).slice(0, limit).map(([name, r]) => ({ name, volume: r.sum, rows: r.n }));
  }

  /** Per period x entity values for a metric (null where the cell has no data). */
  function pivot(T, idx, m, ef, per, pos, nPer) {
    const cells = new Map();
    const cell = (e) => { let c = cells.get(e); if (!c) { c = { a: new Float64Array(nPer), b: new Float64Array(nPer), n: new Int32Array(nPer) }; cells.set(e, c); } return c; };
    if (m.agg === 'ratio') {
      const num = valFn(T, m.num), den = valFn(T, m.den);
      for (let k = 0; k < idx.length; k++) { const i = idx[k], dv = den(i); if (!(dv > 0)) continue; const c = cell(ef(i)), p = pos.get(per(T.cols.date[i])); const nv = num(i); if (Number.isFinite(nv)) c.a[p] += nv; c.b[p] += dv; c.n[p]++; }
      const out = new Map(); for (const [e, c] of cells) out.set(e, Array.from(c.a, (v, p) => (c.n[p] ? (v / c.b[p]) * m.scale : null))); return out;
    }
    const val = m.col ? valFn(T, m.col) : () => 1;
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k], c = cell(ef(i)), p = pos.get(per(T.cols.date[i])), v = val(i);
      if (m.agg === 'count') { c.a[p]++; c.n[p]++; continue; }
      if (Number.isFinite(v)) { c.a[p] += v; c.b[p]++; }
      c.n[p]++;
    }
    const out = new Map();
    if (m.agg === 'share') {
      const tot = new Float64Array(nPer); for (const c of cells.values()) for (let p = 0; p < nPer; p++) tot[p] += c.a[p];
      for (const [e, c] of cells) out.set(e, Array.from(c.a, (v, p) => (tot[p] ? (v / tot[p]) * 100 : 0)));
      return out;
    }
    for (const [e, c] of cells) {
      if (m.agg === 'mean') out.set(e, Array.from(c.a, (v, p) => (c.b[p] ? v / c.b[p] : null)));
      else out.set(e, Array.from(c.a, (v, p) => (c.n[p] ? v : null)));
    }
    return out;
  }

  function interpolate(vals) {
    const out = vals.slice(), known = [];
    for (let i = 0; i < out.length; i++) if (out[i] != null && Number.isFinite(out[i])) known.push(i);
    if (!known.length) return out;
    for (let i = 0; i < out.length; i++) {
      if (out[i] != null && Number.isFinite(out[i])) continue;
      if (i < known[0]) out[i] = out[known[0]];
      else if (i > known[known.length - 1]) out[i] = out[known[known.length - 1]];
      else { let j = 0; while (known[j + 1] < i) j++; const a = known[j], b = known[j + 1]; out[i] = out[a] + ((out[b] - out[a]) * (i - a)) / (b - a); }
    }
    return out;
  }

  /**
   * One regularly spaced series per entity.
   * opts: {entities, historyDays, maxEntities, meta, metricDef, entity (column name or (T)=>fn)}
   * Returns {series: [{entity, metric, label, unit, agg, zero_fill, dates, values, raw, n_active, n_observed}], notes, gran}.
   * `values` are filled (zeros or interpolation) for charts; `raw` keeps gaps as null for the server payload.
   */
  function buildSeries(T, idx, kind, entityType, metric, gran, opts = {}) {
    const [metrics, ents] = catalog(kind, T, opts.meta);
    const m = opts.metricDef || metrics[metric];
    if (!m) throw new Error(`Unknown metric: ${metric}`);
    const entSpec = opts.entity !== undefined ? opts.entity : ents[entityType];
    if (opts.entity === undefined && !(entityType in ents)) throw new Error(`Unknown entity type: ${entityType}`);
    if (!GRANULARITIES.includes(gran)) throw new Error('granularity must be daily, weekly or monthly');
    const notes = [];
    if (entityType === 'program' && kind === 'tv' && gran === 'daily') { gran = 'weekly'; notes.push('Programmes recur weekly, so the series was built weekly.'); }
    if (!idx.length) return { series: [], notes: ['No rows match the current filters.'], gran };
    if (opts.historyDays) { const hi = MR.minMax(T.cols.date, idx)[1], lo = hi - (opts.historyDays - 1); idx = MR.where(T, idx, (i) => T.cols.date[i] >= lo); }
    for (const c of [m.col, m.num, m.den]) if (c && !T.cols[c]) return { series: [], notes: [`Column for ${m.label} is not available in this data.`], gran };
    const per = periodOf(gran), [dmin, dmax] = MR.minMax(T.cols.date, idx);
    let days = axis(per(dmin), per(dmax), gran);
    const pos = new Map(days.map((d, p) => [d, p]));
    const ef = entityFn(T, entSpec);
    let entities = opts.entities && opts.entities.length ? opts.entities : null;
    if (!entities) {
      if (opts.entity !== undefined) {
        const g = new Map(); for (let k = 0; k < idx.length; k++) { const e = ef(idx[k]); g.set(e, (g.get(e) || 0) + (kind === 'lmrb' ? T.cols.cost[idx[k]] : 1)); }
        entities = [...g.entries()].sort((a, b) => b[1] - a[1]).slice(0, opts.maxEntities || 8).map((e) => e[0]);
      } else entities = rankEntities(T, idx, kind, entityType, opts.maxEntities || 8, opts.meta, metric).map((r) => r.name);
    }
    const pv = pivot(T, idx, m, ef, per, pos, days.length);
    const wanted = entities.filter((e) => pv.has(e));
    if (!wanted.length) return { series: [], notes: ['None of the selected entities have rows in the filtered data.'], gran };
    let a = 0, b = days.length;
    if (additive(m) && gran !== 'daily' && days.length >= 4) {
      const firstPartial = gran === 'weekly' ? dowMon(dmin) !== 0 : isoFromDay(dmin).slice(8) !== '01';
      const lastPartial = gran === 'weekly' ? dowMon(dmax) !== 6 : addMonths(dmax, 1) - 1 !== dmax;
      if (firstPartial) { a = 1; notes.push(`Dropped the first partial ${PER_NAME[gran]} so totals are comparable.`); }
      if (lastPartial) { b -= 1; notes.push(`Dropped the last partial ${PER_NAME[gran]} so totals are comparable.`); }
    }
    days = days.slice(a, b);
    const series = [];
    for (const e of wanted) {
      const raw = pv.get(e).slice(a, b);
      const nObs = raw.filter((v) => v != null && Number.isFinite(v)).length;
      let values;
      if (m.zero_fill) values = raw.map((v) => (v == null || !Number.isFinite(v) ? 0 : v));
      else { if (!nObs) continue; values = interpolate(raw); }
      series.push({ entity: e, metric: m.key, label: m.label, unit: m.unit, agg: m.agg, zero_fill: m.zero_fill, dates: days.map(isoFromDay),
        values, raw: m.zero_fill ? values : raw, n_active: values.filter((v) => v !== 0).length, n_observed: m.zero_fill ? values.length : nObs });
    }
    if (!m.zero_fill) notes.push('Periods with no data were filled by linear interpolation because they are missing, not zero.');
    return { series, notes, gran };
  }

  /** The compact payload item the server's /api/forecast/run accepts. */
  const payloadItem = (s, group = '') => ({ entity: s.entity, group, metric: s.metric, label: s.label, unit: s.unit, agg: s.agg, zero_fill: s.zero_fill, dates: s.dates, values: s.raw });

  Object.assign(MR, { GRANULARITIES, seriesCatalog: catalog, metricCatalog, rankEntities, buildSeries, payloadItem, seriesAxis: axis, futureDates, horizonPoints, periodOf, interpolate, metricDef: M });
})(typeof self !== 'undefined' ? self : globalThis);
