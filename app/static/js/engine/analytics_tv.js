/* TV programme (TVR sheet) analytics in the browser. Same JSON as app/services/analytics_tv.py. */
(function (root) {
  const MR = root.MR;
  const { S, DAY_NAMES, dowMon, weekStart, isoFromDay, hm, safeDiv } = MR;

  /** Running stats that skip NaN (pandas semantics). */
  const acc = () => ({ n: 0, c: 0, s: 0, max: -Infinity, min: Infinity, rs: 0, rc: 0, rsum: 0, pc: 0, ps: 0, sc: 0, ss: 0, dc: 0, ds: 0 });
  function addRow(a, T, i) {
    const C = T.cols;
    a.n++;
    const t = C.tvr[i]; if (Number.isFinite(t)) { a.c++; a.s += t; if (t > a.max) a.max = t; if (t < a.min) a.min = t; }
    const r = C.reach[i]; if (Number.isFinite(r)) { a.rc++; a.rs += r; a.rsum += r; }
    const rp = C.reach_pct[i]; if (Number.isFinite(rp)) { a.pc++; a.ps += rp; }
    const sh = C.tvr_share[i]; if (Number.isFinite(sh)) { a.sc++; a.ss += sh; }
    const d = C.duration[i]; if (Number.isFinite(d)) { a.dc++; a.ds += d; }
  }
  const mean = (s, c) => (c ? s / c : null);
  function groupStats(T, idx, keyFn) {
    const m = new Map();
    for (let k = 0; k < idx.length; k++) { const i = idx[k], key = keyFn(i); let a = m.get(key); if (!a) { a = acc(); a.first = i; m.set(key, a); } addRow(a, T, i); }
    return m;
  }
  const row = (a) => ({ airings: a.n, avg_tvr: mean(a.s, a.c), max_tvr: a.c ? a.max : null, avg_reach: mean(a.rs, a.rc), total_reach: a.rsum,
    avg_reach_pct: mean(a.ps, a.pc), avg_share: mean(a.ss, a.sc), avg_duration: mean(a.ds, a.dc) });
  const byDesc = (k) => (x, y) => ((y[k] == null ? -Infinity : y[k]) - (x[k] == null ? -Infinity : x[k]));

  function heat(T, idx, rowFn, colFn, colOrder, topRows = 15) {
    if (!idx.length) return { rows: [], cols: [], values: [] };
    const byRow = groupStats(T, idx, rowFn);
    const rs = [...byRow.entries()].map(([k, a]) => [k, mean(a.s, a.c)]).sort((a, b) => (b[1] ?? -Infinity) - (a[1] ?? -Infinity)).slice(0, topRows).map((e) => e[0]);
    const presentCols = new Set(); for (let k = 0; k < idx.length; k++) presentCols.add(colFn(idx[k]));
    const cs = (colOrder || [...presentCols].filter((c) => c != null).sort()).filter((c) => presentCols.has(c));
    const cell = groupStats(T, idx, (i) => rowFn(i) + '\u0001' + colFn(i));
    return { rows: rs, cols: cs, values: rs.map((r) => cs.map((c) => { const a = cell.get(r + '\u0001' + c); return a ? mean(a.s, a.c) : null; })) };
  }

  const programKey = (T, i) => `${S(T, 'program', i)} | ${S(T, 'channel', i)} | ${DAY_NAMES[dowMon(T.cols.date[i])]} | ${hm(T.cols.start[i]) || ''}`;

  function consistency(T, idx, minAirings = 2) {
    const g = new Map();
    for (let k = 0; k < idx.length; k++) { const i = idx[k], key = programKey(T, i); const v = T.cols.tvr[i]; if (!g.has(key)) g.set(key, []); if (Number.isFinite(v)) g.get(key).push(v); }
    const rows = [];
    for (const [key, vals] of g) {
      if (vals.length < minAirings) continue;
      const m = MR.mean(vals), sd = MR.std1(vals), cv = safeDiv(sd, m);
      const label = cv != null && cv < 0.15 ? 'Very reliable' : cv != null && cv < 0.3 ? 'Reliable' : cv != null && cv < 0.5 ? 'Variable' : 'Volatile';
      const [program, channel, day, start] = (key.split(' | ').concat(['', '', '', ''])).slice(0, 4);
      rows.push({ program, channel, day, start, airings: vals.length, mean_tvr: m, std_tvr: sd, cv, min_tvr: Math.min(...vals), max_tvr: Math.max(...vals), reliability: label });
    }
    return rows.sort((a, b) => (a.cv == null) - (b.cv == null) || a.cv - b.cv).slice(0, 500);
  }

  /** pandas rank(pct=True) with average ties. */
  function pctRank(values) {
    const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const out = new Array(values.length);
    for (let a = 0; a < order.length;) { let b = a; while (b + 1 < order.length && order[b + 1][0] === order[a][0]) b++; const r = (a + b + 2) / 2 / values.length; for (let k = a; k <= b; k++) out[order[k][1]] = r; a = b + 1; }
    return out;
  }

  function opportunity(T, idx, L) {
    if (!L || !L.n || !idx.length) return null;
    const tvCh = new Set(); for (let k = 0; k < idx.length; k++) tvCh.add(S(T, 'channel', idx[k]));
    const lmCh = new Set(L.dicts.channel);
    const common = [...tvCh].filter((c) => lmCh.has(c));
    if (!common.length) return null;
    const cs = new Set(common);
    const key = (ch, day, dp) => `${ch}\u0001${day}\u0001${dp}`;
    const tvCell = new Map();
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k], ch = S(T, 'channel', i); if (!cs.has(ch)) continue;
      const kk = key(ch, DAY_NAMES[dowMon(T.cols.date[i])], S(T, 'daypart', i));
      let a = tvCell.get(kk); if (!a) { a = { s: 0, c: 0, n: 0 }; tvCell.set(kk, a); }
      a.n++; const v = T.cols.tvr[i]; if (Number.isFinite(v)) { a.s += v; a.c++; }
    }
    const load = new Map();
    for (let i = 0; i < L.n; i++) {
      const ch = S(L, 'channel', i); if (!cs.has(ch)) continue;
      const kk = key(ch, DAY_NAMES[dowMon(L.cols.date[i])], S(L, 'daypart', i));
      let a = load.get(kk); if (!a) { a = { spots: 0, spend: 0, days: new Set() }; load.set(kk, a); }
      a.spots++; a.spend += L.cols.cost[i]; a.days.add(L.cols.date[i]);
    }
    const rows = [...tvCell.entries()].map(([kk, a]) => {
      const [channel, day, daypart] = kk.split('\u0001'), l = load.get(kk);
      const days = l ? Math.max(1, l.days.size) : 1;
      return { channel, day, daypart, avg_tvr: a.c ? a.s / a.c : null, airings: a.n, spots: l ? l.spots : null, spend: l ? l.spend : null, days: l ? l.days.size : null,
        ad_load_per_day: l ? l.spots / days : 0, spend_per_day: l ? l.spend / days : 0 };
    });
    const tp = pctRank(rows.map((r) => r.avg_tvr ?? -Infinity)), lp = pctRank(rows.map((r) => r.ad_load_per_day));
    rows.forEach((r, i) => { r.tvr_pctile = tp[i]; r.load_pctile = lp[i]; r.score = tp[i] - lp[i]; });
    const cand = rows.filter((r) => r.tvr_pctile >= 0.5 && r.load_pctile <= 0.5).sort((a, b) => b.score - a.score);
    return { rows: cand.slice(0, 30), channels: common.sort(), note: 'Ad load counts monitored LMRB spots per day in the same channel, weekday and daypart.' };
  }

  function timebeltHeat(T, idx) {
    const sub = MR.where(T, idx, (i) => T.cols.start[i] >= 0);
    if (!sub.length) return { rows: [], cols: [], values: [] };
    const belt = (i) => MR.timebelt(T.cols.start[i]);
    const h = heat(T, sub, belt, (i) => DAY_NAMES[dowMon(T.cols.date[i])], DAY_NAMES, 1e9);
    const order = [...h.rows].sort();
    const pos = new Map(h.rows.map((r, i) => [r, i]));
    return { rows: order, cols: h.cols, values: order.map((r) => h.values[pos.get(r)]) };
  }

  function dashboard(T, idx, L) {
    if (!idx.length) return { empty: true };
    const C = T.cols;
    const prog = groupStats(T, idx, (i) => C.program[i] * 65536 + C.channel[i]);
    const byProg = [...prog.entries()].map(([k, a]) => ({ program: T.dicts.program[Math.floor(k / 65536)], channel: T.dicts.channel[k % 65536], ...row(a) })).sort(byDesc('avg_tvr'));
    const byChan = [...groupStats(T, idx, (i) => C.channel[i]).entries()].map(([k, a]) => ({ channel: T.dicts.channel[k], ...row(a) })).sort(byDesc('avg_tvr'));
    const byCat = [...groupStats(T, idx, (i) => C.category[i]).entries()].map(([k, a]) => ({ category: T.dicts.category[k], ...row(a) })).sort(byDesc('avg_tvr'));
    const eff = byProg.map((r) => ({ ...r, tvr_per_min: r.avg_duration ? r.avg_tvr / r.avg_duration : null, reach_per_min: r.avg_duration ? r.avg_reach / r.avg_duration : null }))
      .sort(byDesc('tvr_per_min'));
    const [d0, d1] = MR.minMax(C.date, idx);
    const weeks = []; for (let w = weekStart(d0); w <= weekStart(d1); w += 7) weeks.push(w);
    const topCats = byCat.slice(0, 6).map((r) => r.category);
    const catCode = new Map(topCats.map((c) => [T.dicts.category.indexOf(c), c]));
    const tr = new Map();
    for (let k = 0; k < idx.length; k++) { const i = idx[k]; if (!catCode.has(C.category[i]) || !Number.isFinite(C.tvr[i])) continue; const key = C.category[i] + ':' + weekStart(C.date[i]); const a = tr.get(key) || { s: 0, c: 0 }; a.s += C.tvr[i]; a.c++; tr.set(key, a); }
    const daily = new Map();
    for (let k = 0; k < idx.length; k++) { const i = idx[k]; if (!Number.isFinite(C.tvr[i])) continue; const a = daily.get(C.date[i]) || { s: 0, c: 0 }; a.s += C.tvr[i]; a.c++; daily.set(C.date[i], a); }
    const dd = [...daily.keys()].sort((a, b) => a - b);
    let tvrS = 0, tvrC = 0, reachS = 0;
    for (let k = 0; k < idx.length; k++) { const i = idx[k]; if (Number.isFinite(C.tvr[i])) { tvrS += C.tvr[i]; tvrC++; } if (Number.isFinite(C.reach[i])) reachS += C.reach[i]; }
    const progs = new Set(); for (let k = 0; k < idx.length; k++) progs.add(C.program[idx[k]]);
    const top = byProg[0], topc = byChan[0];
    return {
      empty: false,
      kpis: { programmes: progs.size, channels: byChan.length, airings: idx.length, avg_tvr: tvrC ? tvrS / tvrC : null, total_reach: reachS,
        top_programme: { name: top.program, channel: top.channel, avg_tvr: top.avg_tvr }, top_channel: { name: topc.channel, avg_tvr: topc.avg_tvr } },
      top_programmes: byProg.slice(0, 300), by_channel: byChan, by_category: byCat,
      heat_category: heat(T, idx, (i) => S(T, 'channel', i), (i) => S(T, 'category', i)),
      heat_daypart: heat(T, idx, (i) => S(T, 'channel', i), (i) => S(T, 'daypart', i), MR.daypartOrder()),
      heat_day: heat(T, idx, (i) => S(T, 'channel', i), (i) => DAY_NAMES[dowMon(C.date[i])], DAY_NAMES),
      heat_timebelt: timebeltHeat(T, idx),
      category_trend: { weeks: weeks.map(isoFromDay), series: topCats.map((c) => { const code = T.dicts.category.indexOf(c); return { name: c, values: weeks.map((w) => { const a = tr.get(code + ':' + w); return a ? a.s / a.c : null; }) }; }) },
      daily_tvr: { dates: dd.map(isoFromDay), values: dd.map((d) => daily.get(d).s / daily.get(d).c) },
      efficiency: eff.slice(0, 300), consistency: consistency(T, idx), opportunity: opportunity(T, idx, L),
    };
  }

  Object.assign(MR, { tvDashboard: dashboard, tvProgramKey: programKey, pctRank });
})(typeof self !== 'undefined' ? self : globalThis);
