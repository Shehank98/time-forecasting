/* Client KPI analytics in the browser. Same JSON as app/services/analytics_kpi.py. */
(function (root) {
  const MR = root.MR;
  const { isoFromDay, dowMon, safeDiv, pctChange } = MR;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmt = (v, d) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

  function metricValue(T, idx, m) {
    if (!idx.length) return null;
    if (m.agg === 'sum' || m.agg === 'count') { if (!m.col) return idx.length; let s = 0; for (const i of idx) { const v = T.cols[m.col][i]; if (Number.isFinite(v)) s += v; } return s; }
    if (m.agg === 'mean') { let s = 0, c = 0; for (const i of idx) { const v = T.cols[m.col][i]; if (Number.isFinite(v)) { s += v; c++; } } return c ? s / c : null; }
    if (m.agg === 'ratio') {
      let a = 0, b = 0, n = 0; const N = T.cols[m.num], D = T.cols[m.den];
      for (const i of idx) { if (!(D[i] > 0)) continue; n++; if (Number.isFinite(N[i])) a += N[i]; b += D[i]; }
      return n && b ? safeDiv(a, b) * m.scale : null;
    }
    return null;
  }

  function polyfit1(x, y) {
    const n = x.length, mx = MR.mean(x), my = MR.mean(y);
    let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
    return { slope: sxy / sxx, r: sxy / Math.sqrt(sxx * syy) };
  }

  function driverEffects(T, idx, metrics, gran) {
    const drivers = Object.keys(metrics).filter((k) => metrics[k].agg === 'sum' && metrics[k].unit === 'currency');
    const kpis = Object.keys(metrics).filter((k) => metrics[k].agg === 'sum' && metrics[k].unit !== 'currency');
    if (!drivers.length || !kpis.length || !idx.length) return [];
    const per = MR.periodOf(gran), g = new Map();
    for (const i of idx) {
      const p = per(T.cols.date[i]); let r = g.get(p);
      if (!r) { r = {}; for (const k of drivers.concat(kpis)) r[k] = 0; g.set(p, r); }
      for (const k of drivers.concat(kpis)) { const v = T.cols[k][i]; if (Number.isFinite(v)) r[k] += v; }
    }
    const periods = [...g.keys()].sort((a, b) => a - b), out = [];
    const perName = gran !== 'daily' ? gran.slice(0, -2) : 'day';
    for (const d of drivers) for (const k of kpis) {
      const x = periods.map((p) => g.get(p)[d]), y = periods.map((p) => g.get(p)[k]);
      if (x.length < 6 || MR.std0(x) === 0 || MR.std0(y) === 0) continue;
      const { slope, r } = polyfit1(x, y), unit = MR.mean(x) > 100000 ? 100000 : 1000;
      out.push({ driver: metrics[d].label, kpi: metrics[k].label, slope, per_unit: unit, kpi_per_unit: slope * unit, correlation: r, r2: r * r, periods: x.length,
        text: `Each extra ${fmt(unit, 0)} of ${metrics[d].label} has gone with about ${fmt(slope * unit, 1)} more ${metrics[k].label} per ${perName} (correlation ${r.toFixed(2)}).` });
    }
    return out.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation)).slice(0, 8);
  }

  function seasonality(T, idx, m, gran) {
    const out = {};
    if (!idx.length || !m || !m.col) return out;
    const g = new Map();
    for (const i of idx) { const d = T.cols.date[i], v = T.cols[m.col][i]; let r = g.get(d); if (!r) { r = { s: 0, c: 0 }; g.set(d, r); } if (Number.isFinite(v)) { r.s += v; r.c++; } }
    const daily = new Map([...g.entries()].map(([d, r]) => [d, m.agg === 'sum' ? r.s : (r.c ? r.s / r.c : NaN)]));
    const days = [...daily.keys()];
    const groupMean = (keyFn) => { const a = new Map(); for (const [d, v] of daily) { if (!Number.isFinite(v)) continue; const k = keyFn(d), r = a.get(k) || { s: 0, c: 0 }; r.s += v; r.c++; a.set(k, r); } return new Map([...a.entries()].sort((x, y) => x[0] - y[0]).map(([k, r]) => [k, r.s / r.c])); };
    if (gran === 'daily' && days.length >= 14) {
      const dow = groupMean(dowMon), mu = MR.mean([...dow.values()]);
      if (mu) out.day_of_week = { labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], index: [0, 1, 2, 3, 4, 5, 6].map((i) => (dow.has(i) ? (dow.get(i) / mu) * 100 : null)) };
    }
    const span = Math.max(...days) - Math.min(...days);
    if (span >= 330) {
      const mon = groupMean((d) => +isoFromDay(d).slice(5, 7)), mu = MR.mean([...mon.values()]);
      if (mu) out.month = { labels: [...mon.keys()].map((k) => MON[k - 1]), index: [...mon.values()].map((v) => (v / mu) * 100) };
    }
    return out;
  }

  /** idx: rows after all filters; nodate: rows after filters except the date range; f: the filters (for the window). */
  function kpiDashboard(T, idx, nodate, f) {
    if (!idx.length) return { empty: true };
    const meta = T.meta || {}, [metrics] = MR.seriesCatalog('kpi', T, meta), gran = meta.granularity || 'daily';
    const [lo, hi] = MR.minMax(T.cols.date, idx);
    const s0 = MR.dayFromIso(f && f.date_from), e0 = MR.dayFromIso(f && f.date_to);
    const start = Number.isFinite(s0) ? s0 : lo, end = Number.isFinite(e0) ? e0 : hi, n = end - start + 1;
    const prev = MR.where(T, nodate, (i) => T.cols.date[i] >= start - n && T.cols.date[i] < start);
    const kpis = Object.entries(metrics).map(([k, m]) => {
      const cur = metricValue(T, idx, m), pv = prev.length ? metricValue(T, prev, m) : null;
      return { key: k, label: m.label, unit: m.unit, agg: m.agg, value: cur, prev: pv, change_pct: pv != null ? pctChange(cur, pv) : null };
    });
    const tg = gran === 'daily' && hi - lo > 180 ? 'weekly' : gran;
    const per = MR.periodOf(tg), axis = MR.seriesAxis(per(lo), per(hi), tg), pos = new Map(axis.map((d, p) => [d, p]));
    const trend = { granularity: tg, dates: axis.map(isoFromDay), series: [] };
    for (const [k, m] of Object.entries(metrics)) {
      const L = axis.length, a = new Float64Array(L), b = new Float64Array(L), c = new Int32Array(L), dn = new Int32Array(L);
      for (const i of idx) {
        const p = pos.get(per(T.cols.date[i]));
        if (m.agg === 'ratio') { const x = T.cols[m.num][i], y = T.cols[m.den][i]; c[p]++; if (Number.isFinite(x)) a[p] += x; if (y > 0) { b[p] += y; dn[p]++; } }
        else { const v = T.cols[m.col][i]; c[p]++; if (Number.isFinite(v)) { a[p] += v; b[p]++; } }
      }
      let values;
      if (m.agg === 'ratio') values = Array.from(a, (v, p) => (c[p] && dn[p] && b[p] ? (v / b[p]) * m.scale : null));
      else if (m.agg === 'mean') values = Array.from(a, (v, p) => (b[p] ? v / b[p] : null));
      else values = Array.from(a);
      trend.series.push({ key: k, label: m.label, unit: m.unit, values });
    }
    let segs = [];
    if (T.dicts.segment.length > 1) {
      const present = new Map(); for (const i of idx) { const s = T.dicts.segment[T.cols.segment[i]]; if (!present.has(s)) present.set(s, []); present.get(s).push(i); }
      if (present.size > 1) {
        const firstSum = Object.keys(metrics).find((k) => metrics[k].agg === 'sum');
        segs = [...present.keys()].sort().map((s) => { const ids = present.get(s), row = { segment: s, rows: ids.length }; for (const [k, m] of Object.entries(metrics)) row[k] = metricValue(T, ids, m); return row; });
        if (firstSum) {
          const tot = segs.reduce((acc, r) => acc + (r[firstSum] || 0), 0) || 1;
          segs.forEach((r) => { r.share_pct = ((r[firstSum] || 0) / tot) * 100; });
          segs.sort((x, y) => (y[firstSum] || 0) - (x[firstSum] || 0));
        }
      }
    }
    const mv = Object.values(metrics);
    const main = mv.find((m) => m.agg === 'sum' && m.unit !== 'currency') || mv[0] || null;
    return { empty: false, granularity: gran, window: { start: isoFromDay(start), end: isoFromDay(end) }, kpis, trend, segments: segs,
      metrics: Object.entries(metrics).map(([k, m]) => ({ key: k, label: m.label, unit: m.unit, agg: m.agg })),
      driver_effects: driverEffects(T, idx, metrics, gran !== 'daily' ? gran : 'weekly'),
      seasonality: seasonality(T, idx, main, gran), seasonality_metric: main ? main.label : null,
      drivers: Object.keys(metrics).filter((k) => metrics[k].agg === 'sum' && metrics[k].unit === 'currency'),
      targets: Object.keys(metrics).filter((k) => metrics[k].agg === 'sum' && metrics[k].unit !== 'currency') };
  }

  Object.assign(MR, { kpiDashboard, kpiMetricValue: metricValue });
})(typeof self !== 'undefined' ? self : globalThis);
