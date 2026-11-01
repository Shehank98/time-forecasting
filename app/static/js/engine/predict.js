/* Data preparation for the two prediction tabs (TVR & Audience, Market & Competitor).
 * Builds the compact series sent to the forecast engine and the small history aggregates the charts need.
 * Pure functions: the same file runs in the worker and in Node tests.
 */
(function (root) {
  const MR = root.MR;
  const { S, isoFromDay } = MR;
  const HORIZON_MAX = 60;            // forecasts always run 60 days ahead; the horizon slider only slices
  const finite = (v) => v != null && Number.isFinite(v);
  const mean = (a) => { let s = 0, c = 0; for (const v of a) if (finite(v)) { s += v; c++; } return c ? s / c : null; };
  const sum = (a) => { let s = 0; for (const v of a) if (finite(v)) s += v; return s; };

  function hasValues(T, col, idx) { const C = T.cols[col]; if (!C) return false; for (let k = 0; k < idx.length; k++) if (Number.isFinite(C[idx[k]])) return true; return false; }
  const items = (res, group) => res.series.map((s) => MR.payloadItem(s, group));

  /* ---------------- TVR & Audience ---------------- */
  /** mode 'daily' (60 days ahead) or 'monthly' (12 months ahead). In monthly mode every series is monthly and goes in `daily` (the primary batch). */
  function tvrPayload(T, idx, mode) {
    const monthly = mode === 'monthly', G = monthly ? 'monthly' : 'daily';
    const daily = [], weekly = [], notes = [];
    const ctx = { mode: monthly ? 'monthly' : 'daily', gran: G, rows: idx.length, heat_metric: hasValues(T, 'tvr_share', idx) ? 'share' : 'tvr', has_reach_pct: hasValues(T, 'reach_pct', idx) };
    if (!idx.length) return { daily, weekly, notes: ['No TVR rows match the current filters.'], ctx, gran: G };
    const [lo, hi] = MR.minMax(T.cols.date, idx);
    ctx.date_min = isoFromDay(lo); ctx.date_max = isoFromDay(hi);
    const run = (arr, group, et, metric, gran, opts) => { const r = MR.buildSeries(T, idx, 'tv', et, metric, gran, opts || {}); arr.push(...items(r, group)); return r; };
    run(daily, 'tvr_total', 'total', 'tvr', G);
    if (ctx.has_reach_pct) run(daily, 'reach_total', 'total', 'reach_pct', G);
    run(daily, 'cat_share', 'category', 'tvr_sum', G, { maxEntities: 6 });
    run(daily, 'hour_share', 'hour', ctx.heat_metric, G, { maxEntities: 24 });
    run(daily, 'channel_tvr', 'channel', 'tvr', G, { maxEntities: 8 });
    const wk = run(monthly ? daily : weekly, 'program_tvr', 'program', 'tvr', monthly ? 'monthly' : 'weekly', { maxEntities: 12 });
    ctx.months_of_history = Math.round((hi - lo) / 30.4);
    notes.push(...wk.notes.filter((n) => !/recur weekly/.test(n)));
    return { daily, weekly, notes, ctx, gran: G };
  }

  /* ---------------- Market & Competitor ---------------- */
  const progOf = (T) => (i) => `${S(T, 'channel', i)} / ${S(T, 'program', i)}`;
  const matchedOf = (T) => (i) => (T.cols.matched_program && T.cols.matched_program[i] >= 0 ? `${S(T, 'channel', i)} / ${T.dicts.matched_program[T.cols.matched_program[i]]}` : null);

  function topBy(T, idx, keyFn, valFn, n) {
    const g = new Map();
    for (let k = 0; k < idx.length; k++) { const i = idx[k], key = keyFn(i); if (key == null) continue; g.set(key, (g.get(key) || 0) + valFn(i)); }
    return [...g.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map((e) => e[0]);
  }
  function avgBy(T, idx, keyFn, col, keys) {
    const want = new Set(keys), g = new Map(), C = T.cols[col];
    for (let k = 0; k < idx.length; k++) { const i = idx[k], key = keyFn(i); if (!want.has(key)) continue; const v = C[i]; if (!(v >= 0) || !Number.isFinite(v)) continue; const r = g.get(key) || { s: 0, c: 0 }; r.s += v; r.c++; g.set(key, r); }
    return Object.fromEntries(keys.map((k) => [k, g.has(k) ? g.get(k).s / g.get(k).c : null]));
  }

  function marketPayload(L, idx, opt = {}) {
    const monthly = opt.mode === 'monthly', G = monthly ? 'monthly' : 'daily', recentDays = monthly ? 91 : 28;
    const daily = [], notes = [];
    const ctx = { mode: monthly ? 'monthly' : 'daily', gran: G, rows: idx.length, has_grp: !!(L.cols.grp && hasValues(L, 'grp', idx)) };
    if (!idx.length) return { daily, weekly: [], notes: ['No LMRB rows match the current filters.'], ctx, gran: G };
    const [lo, hi] = MR.minMax(L.cols.date, idx);
    ctx.date_min = isoFromDay(lo); ctx.date_max = isoFromDay(hi);
    const cost = (i) => L.cols.cost[i];
    ctx.product_groups = topBy(L, idx, (i) => S(L, 'product_group', i), cost, 200);
    let group = opt.product_group && ctx.product_groups.includes(opt.product_group) ? opt.product_group : null;
    if (!group && opt.my_brand) { const g = topBy(L, MR.where(L, idx, (i) => S(L, 'advertiser', i) === opt.my_brand), (i) => S(L, 'product_group', i), cost, 1); group = g[0] || null; }
    group = group || ctx.product_groups[0];
    ctx.product_group = group;
    const gCode = L.dicts.product_group.indexOf(group);
    const gIdx = MR.where(L, idx, (i) => L.cols.product_group[i] === gCode);
    ctx.group_rows = gIdx.length;
    ctx.advertisers = topBy(L, gIdx, (i) => S(L, 'advertiser', i), cost, 100);
    ctx.my_brand = opt.my_brand && ctx.advertisers.includes(opt.my_brand) ? opt.my_brand : null;
    const comp = ctx.advertisers.slice(0, 6);
    if (ctx.my_brand && !comp.includes(ctx.my_brand)) comp.push(ctx.my_brand);
    const run = (group_, rows, et, metric, opts) => { const r = MR.buildSeries(L, rows, 'lmrb', et, metric, G, opts || {}); daily.push(...items(r, group_)); return r; };
    run('comp_spend', gIdx, 'advertiser', 'spend', { entities: comp });
    run('sov', gIdx, 'advertiser', 'sov', { entities: comp });
    run('spots_total', gIdx, 'total', 'spots');
    run('daypart_spend', gIdx, 'daypart', 'spend', { maxEntities: 8 });
    run('cps_total', gIdx, 'total', 'cps');
    // break clutter on the programmes this product group buys (all advertisers' spots describe the breaks)
    const progs = topBy(L, gIdx, progOf(L), () => 1, 10);
    ctx.programs = progs;
    if (L.cols.adsinbrk.some((v) => v >= 0)) {
      run('clutter', idx, 'program', 'clutter', { entities: progs });
      run('posinbrk', idx, 'program', 'posinbrk', { entities: progs });
    } else notes.push('AdsinBrk is empty in this sheet, so break clutter cannot be forecast.');
    const recent = MR.where(L, idx, (i) => L.cols.date[i] > hi - recentDays);
    ctx.months_of_history = Math.round((hi - lo) / 30.4);
    ctx.clutter_recent = avgBy(L, recent, progOf(L), 'adsinbrk', progs);
    ctx.pos_recent = avgBy(L, recent, progOf(L), 'posinbrk', progs);
    // CPRP efficiency: matched programme ratings (needs the TVR sheet)
    if (ctx.has_grp) {
      const slots = topBy(L, idx, matchedOf(L), () => 1, 12);
      ctx.slots = slots;
      ctx.slot_clutter = avgBy(L, idx, matchedOf(L), 'adsinbrk', slots);
      ctx.slot_spots = Object.fromEntries(slots.map((s) => [s, 0])); for (let k = 0; k < idx.length; k++) { const s = matchedOf(L)(idx[k]); if (s in ctx.slot_spots) ctx.slot_spots[s]++; }
      const rating = MR.metricDef('rating', 'Average spot rating (TVR)', 'mean', { col: 'grp', zero_fill: false, unit: 'rating' });
      const costSpot = MR.metricDef('cost_spot', 'Average cost per spot (LKR)', 'mean', { col: 'cost', zero_fill: false, unit: 'currency' });
      run('slot_rating', idx, 'slot', 'rating', { entity: matchedOf, entities: slots, metricDef: rating });
      run('slot_cost', idx, 'slot', 'cost_spot', { entity: matchedOf, entities: slots, metricDef: costSpot });
    } else notes.push('Load the TVR sheet as well to see programme ratings, CPRP and the optimal buying zone.');
    return { daily, weekly: [], notes, ctx, gran: G };
  }

  /* ---------------- helpers for results ---------------- */
  /** First H points of a forecast (daily H, or the matching number of weekly points). */
  function sliceForecast(r, horizonDays) {
    const g = r.granularity || 'daily', n = Math.max(1, Math.min(r.forecast.dates.length, MR.horizonPoints(horizonDays, g)));
    const f = r.forecast;
    return { dates: f.dates.slice(0, n), p10: f.p10.slice(0, n), p50: f.p50.slice(0, n), p90: f.p90.slice(0, n) };
  }

  /** Forecast days whose P50 is more than `ratio` above the trailing `win`-day average (history then forecast). */
  function bursts(hist, p50, { win = 7, ratio = 1.25, floorShare = 0.05 } = {}) {
    const series = hist.concat(p50), n0 = hist.length, peak = Math.max(...series.filter(finite), 0), out = [];
    for (let j = 0; j < p50.length; j++) {
      const i = n0 + j, w = series.slice(Math.max(0, i - win), i).filter(finite);
      if (w.length < Math.min(win, 3)) continue;
      const avg = w.reduce((a, b) => a + b, 0) / w.length, v = p50[j];
      if (finite(v) && v > avg * ratio && v >= peak * floorShare && v > 0) out.push({ index: j, value: v, rolling_avg: avg, lift_pct: avg > 0 ? (v / avg - 1) * 100 : null });
    }
    return out;
  }

  /** Month x hour matrix of the forecast P50 (rows = forecast months, columns = hours). */
  function monthHourMatrix(results, months) {
    const hours = results.map((r) => r.entity).filter((h) => /^\d\d:00$/.test(h)).sort();
    const first = results.find((r) => r.forecast.dates.length);
    const dates = first ? first.forecast.dates.slice(0, months) : [];
    const values = dates.map((d, k) => hours.map((h) => { const r = results.find((q) => q.entity === h); const v = r && r.forecast.p50[k]; return finite(v) ? v : null; }));
    return { rows: dates.map((d) => d.slice(0, 7)), cols: hours, values };
  }

  /** Day-of-week x hour matrix of the average forecast P50 (rows Mon..Sun, columns hours). */
  function dowHourMatrix(results, horizonDays) {
    const hours = results.map((r) => r.entity).filter((h) => /^\d\d:00$/.test(h)).sort();
    const acc = MR.DAY_NAMES.map(() => hours.map(() => ({ s: 0, c: 0 })));
    results.forEach((r) => {
      const c = hours.indexOf(r.entity); if (c < 0) return;
      const f = sliceForecast(r, horizonDays);
      f.dates.forEach((d, k) => { const v = f.p50[k]; if (!finite(v)) return; const dw = MR.dowMon(MR.dayFromIso(d)); acc[dw][c].s += v; acc[dw][c].c++; });
    });
    return { rows: MR.DAY_NAMES.slice(), cols: hours, values: acc.map((row) => row.map((x) => (x.c ? x.s / x.c : null))) };
  }

  /** Mean of the last n history values. */
  const recentMean = (r, n = 28) => mean(r.history.values.slice(-n));
  const median = (a) => { const v = a.filter(finite).sort((x, y) => x - y); if (!v.length) return null; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };

  /** Bubble points with the optimal buying zone: rating at or above the median and cost at or below the median. */
  function buyingZone(points) {
    const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
    const mx = median(xs), my = median(ys);
    const out = points.map((p) => ({ ...p, cprp: p.x > 0 && finite(p.y) ? p.y / p.x : null, optimal: finite(p.x) && finite(p.y) && p.x >= mx && p.y <= my }));
    const best = out.filter((p) => p.optimal && p.cprp != null).sort((a, b) => a.cprp - b.cprp)[0] || out.filter((p) => p.cprp != null).sort((a, b) => a.cprp - b.cprp)[0] || null;
    return { points: out, x_median: mx, y_median: my, best };
  }

  /** Union of values for the global filter bar across the loaded sheets. */
  function globalOptions(tv, lm) {
    const vals = (T, col) => (T && T.dicts[col] ? T.dicts[col] : []);
    const byCount = (T, col, limit) => { if (!T || !T.cols[col]) return []; const m = new Map(); const C = T.cols[col]; for (let i = 0; i < T.n; i++) if (C[i] >= 0) m.set(C[i], (m.get(C[i]) || 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map((e) => T.dicts[col][e[0]]); };
    const uniq = (a) => [...new Set(a)];
    return {
      channel: uniq(vals(tv, 'channel').concat(vals(lm, 'channel'))).sort(),
      program: uniq(byCount(tv, 'program', 300).concat(byCount(lm, 'program', 300))),
      category: vals(tv, 'category').slice().sort(),
      product_group: vals(lm, 'product_group').slice().sort(),
      advertiser: lm ? MR.filterOptions(lm, 'lmrb').advertiser : [],
    };
  }

  Object.assign(MR, { HORIZON_MAX, tvrPayload, marketPayload, sliceForecast, bursts, dowHourMatrix, monthHourMatrix, recentMean, buyingZone, globalOptions, pmean: mean, psum: sum, pmedian: median });
})(typeof self !== 'undefined' ? self : globalThis);
