/* Competitor analysis on LMRB spots in the browser. Same JSON as app/services/analytics_lmrb.py. */
(function (root) {
  const MR = root.MR;
  const { S, isoFromDay, dayFromIso, weekStart, minMax, safeDiv, pctChange, title, fmtInt, range, where, std0, mean } = MR;
  const TOP_ADVERTISERS = 8, ALERT_CHANGE_PCT = 30, DISCOUNT_INDEX = 0.8, PREMIUM_INDEX = 1.25, MIN_SPOTS_PRICING = 3;
  const POS_NAMES = ['first', 'middle', 'last', 'unknown'];

  /* ---------------- helpers ---------------- */
  const col = (L, name) => L.cols[name];
  const nameOf = (L, colName) => (i) => S(L, colName, i);
  const keyFor = (L, k) => (typeof k === 'function' ? k : nameOf(L, k));
  const slice = (L, idx, a, b) => { const D = L.cols.date; return where(L, idx, (i) => D[i] >= a && D[i] <= b); };
  const cpsOf = (L, i) => (L.cols.dur[i] > 0 ? L.cols.cost[i] / L.cols.dur[i] : NaN);
  function sums(L, idx, keyFn, valFn = (i) => L.cols.cost[i]) {
    const m = new Map();
    for (let k = 0; k < idx.length; k++) { const i = idx[k], key = keyFn(i); const g = m.get(key) || { sum: 0, n: 0 }; g.sum += valFn(i); g.n++; m.set(key, g); }
    return m;
  }
  const bySumDesc = (m) => [...m.entries()].sort((a, b) => b[1].sum - a[1].sum).map((e) => e[0]);
  const uniqCount = (L, idx, c) => { const s = new Set(); const C = L.cols[c]; for (let k = 0; k < idx.length; k++) s.add(C[idx[k]]); return s.size; };
  const ordered = (rows, order, key = 'name') => { const p = new Map(order.map((n, i) => [n, i])); return rows.slice().sort((a, b) => (p.has(a[key]) ? p.get(a[key]) : 99) - (p.has(b[key]) ? p.get(b[key]) : 99)); };

  function competitorSet(L, all, my, comps) {
    const advNames = new Set(); for (let k = 0; k < all.length; k++) advNames.add(S(L, 'advertiser', all[k]));
    if (!my) return [...advNames].sort();
    if (comps && comps.length) return [...new Set([...comps, my])].sort();
    const groups = new Set(), out = new Set();
    for (let k = 0; k < all.length; k++) { const i = all[k]; if (S(L, 'advertiser', i) === my) groups.add(L.cols.product_group[i]); }
    for (let k = 0; k < all.length; k++) { const i = all[k]; if (groups.has(L.cols.product_group[i])) out.add(S(L, 'advertiser', i)); }
    return out.size ? [...out].sort() : [my];
  }

  function comparisonWindows(L, scope, start, end, forceWeekly) {
    const n = end - start + 1;
    if (!forceWeekly) {
      const ps = start - n, pe = start - 1, D = L.cols.date;
      for (let k = 0; k < scope.length; k++) { const d = D[scope[k]]; if (d >= ps && d <= pe) return { mode: 'period', cur: [start, end], prev: [ps, pe] }; }
    }
    const w = forceWeekly || n >= 14 ? 7 : Math.floor(n / 2);
    if (w < 1) return { mode: 'none', cur: [start, end], prev: null };
    return { mode: w === 7 ? 'weekly' : 'short', cur: [end - w + 1, end], prev: [end - 2 * w + 1, end - w] };
  }
  const winMeta = (w) => ({ mode: w.mode, cur: w.cur.map(isoFromDay), prev: w.prev ? w.prev.map(isoFromDay) : null });

  function kpiBlock(L, idx) {
    let spend = 0, vc = 0, vd = 0; const C = L.cols;
    for (let k = 0; k < idx.length; k++) { const i = idx[k]; spend += C.cost[i]; if (C.dur[i] > 0) { vc += C.cost[i]; vd += C.dur[i]; } }
    return { total_spend: spend, spots: idx.length, avg_cost_per_spot: safeDiv(spend, idx.length), avg_cost_per_second: safeDiv(vc, vd),
      active_creatives: uniqCount(L, idx, 'creative'), active_channels: uniqCount(L, idx, 'channel'), active_advertisers: uniqCount(L, idx, 'advertiser') };
  }

  function breakdown(L, cur, cmpCur, cmpPrev, k, limit = 500) {
    if (!cur.length) return [];
    const kf = keyFor(L, k);
    const g = sums(L, cur, kf);
    const total = [...g.values()].reduce((a, v) => a + v.sum, 0), totalSpots = cur.length;
    const cc = sums(L, cmpCur, kf), pp = cmpPrev ? sums(L, cmpPrev, kf) : null;
    return bySumDesc(g).slice(0, limit).map((name, r) => {
      const v = g.get(name), c = cc.has(name) ? cc.get(name).sum : 0, p = pp ? (pp.has(name) ? pp.get(name).sum : 0) : null;
      return { name: String(name), rank: r + 1, spend: v.sum, spots: v.n, share_pct: total ? (v.sum / total) * 100 : null, spot_share_pct: totalSpots ? (v.n / totalSpots) * 100 : null,
        prev_spend: p, change_pct: p != null ? pctChange(c, p) : null };
    });
  }

  function weeksOf(L, idx) { if (!idx.length) return []; const [a, b] = minMax(L.cols.date, idx); const out = []; for (let w = weekStart(a); w <= weekStart(b); w += 7) out.push(w); return out; }

  function sovWeekly(L, idx, topN = TOP_ADVERTISERS) {
    if (!idx.length) return { weeks: [], advertisers: [] };
    const weeks = weeksOf(L, idx), wpos = new Map(weeks.map((w, i) => [w, i]));
    const top = bySumDesc(sums(L, idx, nameOf(L, 'advertiser'))).slice(0, topN), topSet = new Set(top);
    const series = new Map();
    let others = false;
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k], a = S(L, 'advertiser', i), name = topSet.has(a) ? a : 'Others';
      if (name === 'Others') others = true;
      if (!series.has(name)) series.set(name, { spend: new Array(weeks.length).fill(0), spots: new Array(weeks.length).fill(0) });
      const s = series.get(name), w = wpos.get(weekStart(L.cols.date[i]));
      s.spend[w] += L.cols.cost[i]; s.spots[w] += 1;
    }
    const names = top.concat(others ? ['Others'] : []);
    return { weeks: weeks.map(isoFromDay), advertisers: names.map((n) => ({ name: n, spend: series.get(n).spend, spots: series.get(n).spots })) };
  }

  /** Heatmap pivot. rows ranked by cost; value 'sum' of cost or 'median' of cps. */
  function matrix(L, idx, rowK, colK, opts = {}) {
    if (!idx.length) return { rows: [], cols: [], values: [] };
    const rf = keyFor(L, rowK), cf = keyFor(L, colK);
    const rs = bySumDesc(sums(L, idx, rf)).slice(0, opts.topRows || 12);
    const cs = opts.colOrder && opts.colOrder.length ? opts.colOrder : bySumDesc(sums(L, idx, cf)).slice(0, opts.topCols || 14);
    const rset = new Set(rs), cset = new Set(cs), cells = new Map();
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k], r = rf(i), c = cf(i);
      if (!rset.has(r) || !cset.has(c)) continue;
      const key = r + '\u0001' + c;
      if (opts.agg === 'median') { if (!cells.has(key)) cells.set(key, []); cells.get(key).push(opts.value(i)); }
      else cells.set(key, (cells.get(key) || 0) + L.cols.cost[i]);
    }
    const val = (key) => { if (!cells.has(key)) return null; const v = cells.get(key); return opts.agg === 'median' ? MR.median(v) : v; };
    return { rows: rs, cols: cs, values: rs.map((r) => cs.map((c) => val(r + '\u0001' + c))) };
  }

  /* ---------------- flighting ---------------- */
  function runs(mask) {
    const out = []; let s = null;
    for (let i = 0; i < mask.length; i++) { if (mask[i] && s === null) s = i; if (!mask[i] && s !== null) { out.push([s, i - 1]); s = null; } }
    if (s !== null) out.push([s, mask.length - 1]);
    return out;
  }
  function flightStats(L, sub, ws, we) {
    const days = range(ws, we), n = days.length, spend = new Array(n).fill(0), spots = new Array(n).fill(0);
    let first = Infinity, last = -Infinity;
    for (let k = 0; k < sub.length; k++) { const i = sub[k], d = L.cols.date[i]; if (d < first) first = d; if (d > last) last = d; const p = d - ws; if (p >= 0 && p < n) { spend[p] += L.cols.cost[i]; spots[p]++; } }
    const active = spots.map((s) => s > 0);
    const span = last - first + 1, activeDays = active.filter(Boolean).length;
    const fi = Math.max(0, first - ws), li = Math.min(n - 1, last - ws);
    const inside = active.slice(fi, li + 1);
    const gapRuns = runs(inside.map((v) => !v)).filter((r) => r[1] - r[0] + 1 >= 2);
    const longest = gapRuns.reduce((m, r) => Math.max(m, r[1] - r[0] + 1), 0);
    const wk = new Map(); days.forEach((d, i) => { const w = weekStart(d); wk.set(w, (wk.get(w) || 0) + spend[i]); });
    const wv = [...wk.values()];
    const activeWeeks = wv.filter((v) => v > 0).length;
    const wm = mean(wv), cv = wm > 0 ? safeDiv(std0(wv), wm) : null;
    const sm = mean(spend), ssd = std0(spend), thr = sm + ssd;
    const burst = spend.map((v) => v > thr && ssd > 0);
    const merged = burst.some(Boolean) ? runs(burst.map((_, i) => (burst[i - 1] || false) + burst[i] + (burst[i + 1] || false) > 0)) : [];
    const bursts = [];
    for (const [a, b] of merged) {
      const seg = spend.slice(a, b + 1);
      if (seg.some((v) => v > thr)) bursts.push({ start: isoFromDay(days[a]), end: isoFromDay(days[b]), days: seg.length, spend: seg.reduce((x, y) => x + y, 0) });
    }
    const nWeeks = Math.max(wk.size, 1), coverage = activeWeeks / nWeeks;
    let pattern;
    if (activeDays <= 2) pattern = 'One-off';
    else if (nWeeks >= 2 && coverage >= 0.85 && (cv || 0) < 0.5 && longest < 7) pattern = 'Always-on';
    else if (bursts.length >= 2 || longest >= 7 || (cv || 0) >= 0.8) pattern = 'Pulsing';
    else if (span < 0.6 * n) pattern = 'Single flight';
    else pattern = 'Steady (uneven)';
    return { first_date: isoFromDay(first), last_date: isoFromDay(last), span_days: span, active_days: activeDays, active_ratio: activeDays / Math.max(n, 1),
      active_weeks: activeWeeks, total_weeks: nWeeks, longest_gap_days: longest, gaps: gapRuns.slice(0, 5).map(([a, b]) => ({ start: isoFromDay(days[a + fi]), days: b - a + 1 })),
      bursts: bursts.sort((x, y) => y.spend - x.spend).slice(0, 5), burst_count: bursts.length, pattern, weekly_cv: cv };
  }
  function flighting(L, cur, ws, we, topN = 12) {
    if (!cur.length) return { advertisers: [], calendar: { dates: [], rows: [] } };
    const g = sums(L, cur, nameOf(L, 'advertiser')), order = bySumDesc(g);
    const byAdv = new Map(); for (let k = 0; k < cur.length; k++) { const a = S(L, 'advertiser', cur[k]); if (!byAdv.has(a)) byAdv.set(a, []); byAdv.get(a).push(cur[k]); }
    const stats = order.slice(0, 60).map((a) => ({ ...flightStats(L, Int32Array.from(byAdv.get(a)), ws, we), advertiser: a, spend: g.get(a).sum, spots: g.get(a).n }));
    const days = range(ws, we), top = order.slice(0, topN);
    const values = top.map((a) => { const row = new Array(days.length).fill(0); for (const i of byAdv.get(a)) { const p = L.cols.date[i] - ws; if (p >= 0 && p < days.length) row[p]++; } return row; });
    return { advertisers: stats, calendar: { dates: days.map(isoFromDay), rows: top, values } };
  }

  /* ---------------- creatives ---------------- */
  function creatives(L, all, cur, prev, cmpCur, cmpStart) {
    if (!cur.length) return [];
    const C = L.cols, firstEver = new Map();
    for (let k = 0; k < all.length; k++) { const i = all[k], c = C.creative[i]; if (!firstEver.has(c) || C.date[i] < firstEver.get(c)) firstEver.set(c, C.date[i]); }
    const agg = new Map();
    for (let k = 0; k < cur.length; k++) {
      const i = cur[k], c = C.creative[i];
      let a = agg.get(c);
      if (!a) { a = { i, first: Infinity, last: -Infinity, spots: 0, spend: 0, ch: new Set() }; agg.set(c, a); }
      a.first = Math.min(a.first, C.date[i]); a.last = Math.max(a.last, C.date[i]); a.spots++; a.spend += C.cost[i]; a.ch.add(S(L, 'channel', i));
    }
    const cmpIds = new Set(); for (let k = 0; k < cmpCur.length; k++) cmpIds.add(C.creative[cmpCur[k]]);
    const prevIds = prev && prev.length ? new Set(Array.from(prev, (i) => C.creative[i])) : null;
    const rows = [];
    for (const [cid, a] of agg) {
      let status = 'ACTIVE';
      if (prevIds) {
        if (cmpIds.has(cid) && !prevIds.has(cid)) status = (firstEver.has(cid) ? firstEver.get(cid) : a.first) >= cmpStart ? 'NEW' : 'RETURNING';
        else if (!cmpIds.has(cid)) status = 'PAUSED';
      }
      const ch = [...a.ch].sort();
      rows.push({ creative_id: L.dicts.creative[cid], advertiser: S(L, 'advertiser', a.i), product: S(L, 'product', a.i), theme: S(L, 'theme', a.i),
        first_seen: isoFromDay(a.first), last_seen: isoFromDay(a.last), spots: a.spots, spend: a.spend, channels: ch, channel_count: ch.length, status });
    }
    if (prevIds) {
      for (const cid of [...prevIds].sort((x, y) => x - y)) {
        if (cmpIds.has(cid) || agg.has(cid)) continue;
        let first = Infinity, last = -Infinity, i0 = -1; const ch = new Set();
        for (let k = 0; k < prev.length; k++) { const i = prev[k]; if (C.creative[i] !== cid) continue; if (i0 < 0) i0 = i; first = Math.min(first, C.date[i]); last = Math.max(last, C.date[i]); ch.add(S(L, 'channel', i)); }
        rows.push({ creative_id: L.dicts.creative[cid], advertiser: S(L, 'advertiser', i0), product: S(L, 'product', i0), theme: S(L, 'theme', i0), first_seen: isoFromDay(first),
          last_seen: isoFromDay(last), spots: 0, spend: 0, channels: [...ch].sort(), channel_count: ch.size, status: 'DROPPED' });
      }
    }
    return rows.sort((a, b) => ((a.status !== 'NEW') - (b.status !== 'NEW')) || ((a.status !== 'DROPPED') - (b.status !== 'DROPPED')) || (b.spend - a.spend));
  }

  /* ---------------- pricing ---------------- */
  function pricing(L, cur) {
    const C = L.cols;
    const d = where(L, cur, (i) => C.dur[i] > 0 && Number.isFinite(C.cost[i] / C.dur[i]));
    if (!d.length) return { cells: [], discount_flags: [], outliers: [], heatmap: { rows: [], cols: [], values: [] }, outlier_counts: {} };
    const cd = (i) => S(L, 'channel', i) + '\u0001' + S(L, 'daypart', i);
    const groups = new Map();
    for (let k = 0; k < d.length; k++) { const i = d[k], key = cd(i); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(i); }
    const med = new Map(), q = new Map();
    for (const [key, ids] of groups) {
      const v = Float64Array.from(ids, (i) => cpsOf(L, i)).sort();
      med.set(key, MR.quantile(v, 0.5)); q.set(key, [MR.quantile(v, 0.25), MR.quantile(v, 0.75), v.length]);
    }
    const cells = new Map();
    for (let k = 0; k < d.length; k++) {
      const i = d[k], key = S(L, 'advertiser', i) + '\u0001' + cd(i);
      const c = cells.get(key) || { spots: 0, spend: 0, seconds: 0 }; c.spots++; c.spend += C.cost[i]; c.seconds += C.dur[i]; cells.set(key, c);
    }
    let rows = [...cells.entries()].map(([key, c]) => {
      const [advertiser, channel, daypart] = key.split('\u0001'), m = med.get(channel + '\u0001' + daypart), cps = c.spend / c.seconds, idx = cps / m;
      const flag = idx < DISCOUNT_INDEX && c.spots >= MIN_SPOTS_PRICING ? 'Below median (possible discount)' : idx > PREMIUM_INDEX && c.spots >= MIN_SPOTS_PRICING ? 'Above median (premium)' : '';
      return { advertiser, channel, daypart, spots: c.spots, spend: c.spend, seconds: c.seconds, cps, median_cps: m, index_vs_median: idx, flag };
    }).sort((a, b) => b.spend - a.spend);
    const outs = [];
    for (let k = 0; k < d.length; k++) {
      const i = d[k], key = cd(i), [q1, q3, n] = q.get(key), iqr = q3 - q1, v = cpsOf(L, i);
      if (n >= 8 && iqr > 0 && (v < q1 - 1.5 * iqr || v > q3 + 1.5 * iqr)) outs.push(i);
    }
    const counts = new Map(); outs.forEach((i) => { const a = S(L, 'advertiser', i); counts.set(a, (counts.get(a) || 0) + 1); });
    const present = new Set(); for (let k = 0; k < d.length; k++) present.add(S(L, 'daypart', d[k]));
    const heat = matrix(L, d, 'channel', 'daypart', { topRows: 12, colOrder: MR.daypartOrder().filter((x) => present.has(x)), agg: 'median', value: (i) => cpsOf(L, i) });
    return {
      cells: rows.slice(0, 1000), discount_flags: rows.filter((r) => r.flag.startsWith('Below')).slice(0, 50),
      outliers: outs.map((i) => ({ date: isoFromDay(C.date[i]), advertiser: S(L, 'advertiser', i), channel: S(L, 'channel', i), daypart: S(L, 'daypart', i), program: S(L, 'program', i),
        dur: C.dur[i], cost: C.cost[i], cps: cpsOf(L, i), median_cps: med.get(cd(i)) })).sort((a, b) => a.cps - b.cps).slice(0, 25),
      outlier_counts: Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1])), heatmap: heat,
    };
  }

  function positionStrategy(L, cur) {
    const P = L.cols.position, d = where(L, cur, (i) => P[i] !== 3);
    if (!d.length) return [];
    let tf = 0, tl = 0; const g = new Map();
    for (let k = 0; k < d.length; k++) {
      const i = d[k], a = S(L, 'advertiser', i), r = g.get(a) || { spots: 0, first: 0, last: 0, spend: 0 };
      r.spots++; r.spend += L.cols.cost[i]; if (P[i] === 0) { r.first++; tf++; } if (P[i] === 2) { r.last++; tl++; } g.set(a, r);
    }
    return [...g.entries()].sort((a, b) => b[1].spend - a[1].spend).map(([a, r]) => ({ advertiser: a, spots: r.spots, spend: r.spend, first_n: r.first, last_n: r.last,
      first_rate_pct: (r.first / r.spots) * 100, last_rate_pct: (r.last / r.spots) * 100, share_of_first_pct: tf ? (r.first / tf) * 100 : null, share_of_last_pct: tl ? (r.last / tl) * 100 : null }));
  }

  /* ---------------- alerts ---------------- */
  function alerts(L, scopeAll, end, my, price) {
    const notes = [];
    if (!scopeAll.length) return { items: [], notes: ['No data in scope.'], window: null };
    const w = comparisonWindows(L, scopeAll, end - 6, end, true);
    const [c0, c1] = w.cur, [p0, p1] = w.prev;
    const cur = slice(L, scopeAll, c0, c1), prev = slice(L, scopeAll, p0, p1);
    const dataMin = minMax(L.cols.date, scopeAll)[0];
    if (dataMin > p0) notes.push(`History starts ${isoFromDay(dataMin)}, so week-on-week alerts only cover ${Math.max(c1 - dataMin + 1, 0)} days.`);
    if (!prev.length) notes.push('No spots in the previous 7 days, so changes are shown as launches only.');
    const items = [];
    const advF = nameOf(L, 'advertiser');
    const sc = sums(L, cur, advF), sp = sums(L, prev, advF);
    const totalCur = [...sc.values()].reduce((a, v) => a + v.sum, 0) || 1, totalPrev = [...sp.values()].reduce((a, v) => a + v.sum, 0) || 1;
    const add = (severity, type, advertiser, text, evidence, magnitude = 0) => items.push({ severity, type, advertiser, is_mine: advertiser === my, text, evidence, magnitude });
    const byAdv = (idx) => { const m = new Map(); for (let k = 0; k < idx.length; k++) { const a = advF(idx[k]); if (!m.has(a)) m.set(a, []); m.get(a).push(idx[k]); } return m; };
    const curBy = byAdv(cur), prevBy = byAdv(prev);
    for (const adv of [...new Set([...sc.keys(), ...sp.keys()])].sort()) {
      const c = sc.has(adv) ? sc.get(adv).sum : 0, p = sp.has(adv) ? sp.get(adv).sum : 0;
      const ci = Int32Array.from(curBy.get(adv) || []), pi = Int32Array.from(prevBy.get(adv) || []);
      const cellKey = (i) => S(L, 'channel', i) + '\u0001' + S(L, 'daypart', i);
      const cd = sums(L, ci, cellKey), pdm = sums(L, pi, cellKey);
      const keys = [...new Set([...cd.keys(), ...pdm.keys()])].sort();
      let top = null, best = -1;
      for (const k of keys) { const dlt = Math.abs((cd.has(k) ? cd.get(k).sum : 0) - (pdm.has(k) ? pdm.get(k).sum : 0)); if (dlt > best) { best = dlt; top = k; } }
      const where_ = top ? ` on ${title(top.split('\u0001')[0])} ${top.split('\u0001')[1].toLowerCase()}` : '';
      const ev = { spend_last_7d: c, spend_prev_7d: p };
      if (p > 0 && c > 0) {
        const ch = pctChange(c, p);
        if (ch != null && ch >= ALERT_CHANGE_PCT && c >= 0.01 * totalCur) add(ch >= 60 ? 'high' : 'medium', 'spend_up', adv, `${adv} increased spend ${ch.toFixed(0)}% week on week${where_}.`, { ...ev, change_pct: ch }, ch);
        else if (ch != null && ch <= -ALERT_CHANGE_PCT && p >= 0.01 * totalPrev) add('medium', 'spend_down', adv, `${adv} cut spend ${Math.abs(ch).toFixed(0)}% week on week${where_}.`, { ...ev, change_pct: ch }, Math.abs(ch));
      } else if (p === 0 && c > 0 && prev.length) add('high', 'returned', adv, `${adv} is back on air after no activity in the previous 7 days.`, ev, 100);
      else if (c === 0 && p > 0) add('high', 'stopped', adv, `${adv} went off air this week (spent ${fmtInt(p)} LKR the week before).`, ev, 100);
      const cch = new Set(Array.from(ci, (i) => S(L, 'channel', i))), pch = new Set(Array.from(pi, (i) => S(L, 'channel', i)));
      if (pch.size) {
        for (const chName of [...pch].filter((x) => !cch.has(x)).sort()) {
          if (c > 0) { let lost = 0; for (const i of pi) if (S(L, 'channel', i) === chName) lost += L.cols.cost[i]; add('medium', 'channel_stop', adv, `${adv} stopped ${title(chName)} (was LKR ${fmtInt(lost)} the week before).`, { channel: chName, prev_spend: lost }, (lost / Math.max(p, 1)) * 100); }
        }
        for (const chName of [...cch].filter((x) => !pch.has(x)).sort()) {
          let gain = 0; for (const i of ci) if (S(L, 'channel', i) === chName) gain += L.cols.cost[i];
          add('medium', 'channel_start', adv, `${adv} started on ${title(chName)} (LKR ${fmtInt(gain)} this week).`, { channel: chName, spend: gain }, (gain / Math.max(c, 1)) * 100);
        }
      }
    }
    const C = L.cols, fe = new Map();
    for (let k = 0; k < scopeAll.length; k++) { const i = scopeAll[k], cid = C.creative[i]; if (!fe.has(cid) || C.date[i] < fe.get(cid)) fe.set(cid, C.date[i]); }
    const firstRow = (idx) => { const m = new Map(); for (let k = 0; k < idx.length; k++) { const cid = C.creative[idx[k]]; if (!m.has(cid)) m.set(cid, idx[k]); } return m; };
    const curFirst = firstRow(cur), prevFirst = firstRow(prev);
    const nameSort = (a, b) => (L.dicts.creative[a] < L.dicts.creative[b] ? -1 : L.dicts.creative[a] > L.dicts.creative[b] ? 1 : 0);
    for (const cid of [...curFirst.keys()].filter((x) => !prevFirst.has(x)).sort(nameSort)) {
      if (fe.get(cid) > dataMin && fe.get(cid) >= c0) {
        const i = curFirst.get(cid); let n = 0; for (let k = 0; k < cur.length; k++) if (C.creative[cur[k]] === cid) n++;
        add('medium', 'new_creative', S(L, 'advertiser', i), `${S(L, 'advertiser', i)} launched a new creative: ${S(L, 'theme', i)} (${S(L, 'product', i)}).`, { first_seen: isoFromDay(fe.get(cid)), spots: n }, 50);
      }
    }
    for (const cid of [...prevFirst.keys()].filter((x) => !curFirst.has(x)).sort(nameSort)) {
      const i = prevFirst.get(cid); let last = -Infinity; for (let k = 0; k < prev.length; k++) if (C.creative[prev[k]] === cid) last = Math.max(last, C.date[prev[k]]);
      add('low', 'dropped_creative', S(L, 'advertiser', i), `${S(L, 'advertiser', i)} dropped creative ${S(L, 'theme', i)} (${S(L, 'product', i)}) this week.`, { last_seen: isoFromDay(last) }, 10);
    }
    if (price) for (const f of (price.discount_flags || []).slice(0, 5)) {
      add('low', 'discount', f.advertiser, `${f.advertiser} pays ${((1 - f.index_vs_median) * 100).toFixed(0)}% below the ${title(f.channel)} ${f.daypart.toLowerCase()} median cost per second (possible discount deal).`,
        { index_vs_median: f.index_vs_median, spots: f.spots }, (1 - f.index_vs_median) * 30);
    }
    const rank = { high: 0, medium: 1, low: 2 };
    items.sort((a, b) => (rank[a.severity] - rank[b.severity]) || ((!a.is_mine) - (!b.is_mine)) || (b.magnitude - a.magnitude));
    return { items: items.slice(0, 60), notes, window: { cur: [isoFromDay(c0), isoFromDay(c1)], prev: [isoFromDay(p0), isoFromDay(p1)] } };
  }

  /* ---------------- GRPs ---------------- */
  function grpSummary(L, idx, k) {
    const G = L.cols.grp, kf = keyFor(L, k), g = new Map();
    for (let j = 0; j < idx.length; j++) { const i = idx[j]; if (!(G[i] > 0)) continue; const key = kf(i), r = g.get(key) || { grps: 0, cost: 0, spots: 0 }; r.grps += G[i]; r.cost += L.cols.cost[i]; r.spots++; g.set(key, r); }
    const tot = [...g.values()].reduce((a, v) => a + v.grps, 0);
    return [...g.entries()].sort((a, b) => b[1].grps - a[1].grps).map(([name, r]) => ({ name: String(name), grps: r.grps, cost: r.cost, spots: r.spots, cprp: r.grps > 0 ? r.cost / r.grps : null,
      grp_share_pct: tot ? (r.grps / tot) * 100 : null, avg_spot_rating: r.grps / r.spots }));
  }
  function grpBlock(L, cur, my) {
    if (!L.cols.grp) return null;
    const G = L.cols.grp, m = where(L, cur, (i) => G[i] > 0);
    if (!m.length) return null;
    let tg = 0, tc = 0; for (let k = 0; k < m.length; k++) { tg += G[m[k]]; tc += L.cols.cost[m[k]]; }
    const byAdv = grpSummary(L, cur, 'advertiser'), mine = byAdv.find((r) => r.name === my);
    const weeks = weeksOf(L, m), wpos = new Map(weeks.map((w, i) => [w, i])), top = byAdv.slice(0, 8).map((r) => r.name), topSet = new Set(top);
    const wk = new Map(top.map((a) => [a, new Array(weeks.length).fill(0)]));
    const cpc = new Map(), chs = new Set(), dps = new Set();
    for (let k = 0; k < m.length; k++) {
      const i = m[k], a = S(L, 'advertiser', i), ch = S(L, 'channel', i), dp = S(L, 'daypart', i);
      if (topSet.has(a)) wk.get(a)[wpos.get(weekStart(L.cols.date[i]))] += G[i];
      chs.add(ch); dps.add(dp);
      const c = cpc.get(ch + '\u0001' + dp) || { cost: 0, grp: 0 }; c.cost += L.cols.cost[i]; c.grp += G[i]; cpc.set(ch + '\u0001' + dp, c);
    }
    const rows = [...chs].sort(), cols = MR.daypartOrder().filter((d) => dps.has(d));
    return { matched_spots: m.length, spots: cur.length, match_rate_pct: cur.length ? (m.length / cur.length) * 100 : 0, total_grps: tg, cprp: tg ? tc / tg : null,
      my_grp_share_pct: mine ? mine.grp_share_pct : null, my_cprp: mine ? mine.cprp : null,
      by_advertiser: byAdv, by_channel: grpSummary(L, cur, 'channel'), by_daypart: ordered(grpSummary(L, cur, 'daypart'), MR.daypartOrder()),
      by_program: grpSummary(L, cur, (i) => `${S(L, 'channel', i)} / ${S(L, 'matched_program', i) || ''}`).slice(0, 25),
      weekly: { weeks: weeks.map(isoFromDay), advertisers: top.map((a) => ({ name: a, grps: wk.get(a) })) },
      cprp_heatmap: { rows, cols, values: rows.map((r) => cols.map((c) => { const v = cpc.get(r + '\u0001' + c); return v && v.grp ? v.cost / v.grp : null; })) },
      note: 'Spot ratings use the average TVR of the programme airing at the spot time, for the selected target audience.' };
  }

  /* ---------------- dashboard ---------------- */
  function bounds(L, idx, f) {
    const [lo, hi] = minMax(L.cols.date, idx);
    const a = dayFromIso(f && f.date_from), b = dayFromIso(f && f.date_to);
    return [Number.isFinite(a) ? a : lo, Number.isFinite(b) ? b : hi];
  }
  function dashboard(L, all, f, my, comps) {
    if (!all.length) return { empty: true };
    const [start, end] = bounds(L, all, f);
    const brands = competitorSet(L, all, my, comps), bset = MR.codeSet(L, 'advertiser', brands), A = L.cols.advertiser;
    const scopeAll = where(L, all, (i) => bset.has(A[i]));
    const cur = slice(L, scopeAll, start, end);
    if (!cur.length) return { empty: true, scope: brands };
    const win = comparisonWindows(L, scopeAll, start, end);
    const cmpCur = win.mode === 'period' ? cur : slice(L, scopeAll, win.cur[0], win.cur[1]);
    const cmpPrev = win.prev ? slice(L, scopeAll, win.prev[0], win.prev[1]) : null;
    const k = kpiBlock(L, cur);
    if (my) {
      let ms = 0, mn = 0; for (let j = 0; j < cur.length; j++) if (S(L, 'advertiser', cur[j]) === my) { ms += L.cols.cost[cur[j]]; mn++; }
      k.sov_spend_pct = k.total_spend ? (ms / k.total_spend) * 100 : null; k.sov_spots_pct = k.spots ? (mn / k.spots) * 100 : null;
    } else { k.sov_spend_pct = null; k.sov_spots_pct = null; }
    const advOrder = bySumDesc(sums(L, cur, nameOf(L, 'advertiser')));
    k.my_rank = my && advOrder.includes(my) ? advOrder.indexOf(my) + 1 : null;
    if (cmpPrev && cmpPrev.length) {
      let a = 0, b = 0; for (const i of cmpCur) a += L.cols.cost[i]; for (const i of cmpPrev) b += L.cols.cost[i];
      k.spend_change_pct = pctChange(a, b); k.spots_change_pct = pctChange(cmpCur.length, cmpPrev.length);
    }
    const price = pricing(L, cur);
    const presentDp = new Set(); for (const i of cur) presentDp.add(S(L, 'daypart', i));
    const lastScope = minMax(L.cols.date, scopeAll)[1];
    return {
      empty: false, scope: brands, my_brand: my || null, window: { start: isoFromDay(start), end: isoFromDay(end) }, comparison: winMeta(win), kpis: k,
      advertiser_order: advOrder, all_advertiser_order: bySumDesc(sums(L, all, nameOf(L, 'advertiser'))),
      sov_weekly: sovWeekly(L, cur),
      by_advertiser: breakdown(L, cur, cmpCur, cmpPrev, 'advertiser'), by_product: breakdown(L, cur, cmpCur, cmpPrev, 'product'),
      by_channel: breakdown(L, cur, cmpCur, cmpPrev, 'channel'), by_daypart: ordered(breakdown(L, cur, cmpCur, cmpPrev, 'daypart'), MR.daypartOrder()),
      by_language: breakdown(L, cur, cmpCur, cmpPrev, 'lng'), by_product_group: breakdown(L, cur, cmpCur, cmpPrev, 'product_group'),
      mix_channel: matrix(L, cur, 'advertiser', 'channel'),
      mix_daypart: matrix(L, cur, 'advertiser', 'daypart', { colOrder: MR.daypartOrder().filter((d) => presentDp.has(d)) }),
      mix_program: matrix(L, cur, 'advertiser', (i) => `${S(L, 'channel', i)} / ${S(L, 'program', i)}`, { topRows: 10, topCols: 15 }),
      flighting: flighting(L, cur, start, end),
      creatives: creatives(L, all, cur, win.prev ? slice(L, scopeAll, win.prev[0], win.prev[1]) : null, cmpCur, win.cur[0]),
      pricing: price, position: positionStrategy(L, cur), alerts: alerts(L, scopeAll, Math.min(end, lastScope), my, price), grp: grpBlock(L, cur, my),
    };
  }

  function headToHead(L, all, f, a, b) {
    if (!all.length) return { empty: true };
    const [start, end] = bounds(L, all, f);
    const cur = slice(L, all, start, end);
    const out = { empty: false, a, b, window: { start: isoFromDay(start), end: isoFromDay(end) }, sides: {} };
    const prime = new Set(MR.cfg.prime);
    for (const name of [a, b]) {
      const d = where(L, cur, (i) => S(L, 'advertiser', i) === name);
      if (!d.length) { out.sides[name] = { kpis: kpiBlock(L, d), empty: true }; continue; }
      const pos = positionStrategy(L, d), wk = sovWeekly(L, d, 1);
      let tot = 0, pr = 0; for (const i of d) { tot += L.cols.cost[i]; if (prime.has(S(L, 'daypart', i))) pr += L.cols.cost[i]; }
      out.sides[name] = { empty: false, kpis: kpiBlock(L, d), flighting: flightStats(L, d, start, end),
        by_channel: breakdown(L, d, d, null, 'channel'), by_daypart: ordered(breakdown(L, d, d, null, 'daypart'), MR.daypartOrder()),
        by_language: breakdown(L, d, d, null, 'lng'), by_product: breakdown(L, d, d, null, 'product'), weekly: wk.advertisers[0], weeks: wk.weeks,
        position: pos[0] || null, prime_spend_pct: (safeDiv(pr, tot) || 0) * 100, creatives: breakdown(L, d, d, null, 'theme', 30) };
    }
    const sa = out.sides[a], sb = out.sides[b], lines = [];
    if (!sa.empty && !sb.empty) {
      const ka = sa.kpis, kb = sb.kpis, ratio = safeDiv(ka.total_spend, kb.total_spend);
      if (ratio) lines.push(`${a} spent ${ratio.toFixed(1)}x as much as ${b}.`);
      lines.push(`Average cost per second: ${a} LKR ${fmtInt(ka.avg_cost_per_second || 0)} vs ${b} LKR ${fmtInt(kb.avg_cost_per_second || 0)}.`);
      lines.push(`Prime share of spend: ${a} ${sa.prime_spend_pct.toFixed(0)}% vs ${b} ${sb.prime_spend_pct.toFixed(0)}%.`);
      lines.push(`Flighting: ${a} is ${sa.flighting.pattern.toLowerCase()}, ${b} is ${sb.flighting.pattern.toLowerCase()}.`);
    }
    out.highlights = lines;
    return out;
  }

  Object.assign(MR, { lmrbDashboard: dashboard, headToHead, competitorSet, comparisonWindows, flightStats, grpSummary, lmrbBounds: bounds, lmrbSums: sums, POS_NAMES });
})(typeof self !== 'undefined' ? self : globalThis);
