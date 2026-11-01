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
    run(daily, 'channel_share', 'channel', 'tvr_sum', G, { maxEntities: 8 });
    const cdp = (T2) => (i) => `${S(T2, 'channel', i)} | ${S(T2, 'daypart', i)}`;
    run(daily, 'chan_daypart', 'channel', 'tvr', G, { entity: cdp, maxEntities: 48 });
    const wk = run(monthly ? daily : weekly, 'program_tvr', 'program', 'tvr', monthly ? 'monthly' : 'weekly', { maxEntities: 16 });
    // stickiness: reach % and viewing time for the same programme slots, so TVR can be set against reach
    const slotNames = wk.series.map((x) => x.entity);
    if (slotNames.length && ctx.has_reach_pct) run(monthly ? daily : weekly, 'program_reach', 'program', 'reach_pct', monthly ? 'monthly' : 'weekly', { entities: slotNames });
    ctx.has_avg_time = hasValues(T, 'avg_time', idx);
    if (slotNames.length && ctx.has_avg_time) run(monthly ? daily : weekly, 'program_avgtime', 'program', 'avg_time', monthly ? 'monthly' : 'weekly', { entities: slotNames });
    // how much audience each hour carries (recent 8 weeks): peak hours are the busiest quarter
    { const lvl = new Map(), days = new Set(); const lo8 = hi - 55;
      for (let k = 0; k < idx.length; k++) { const i = idx[k]; if (T.cols.date[i] < lo8 || T.cols.start[i] < 0 || !Number.isFinite(T.cols.tvr[i])) continue; const h = MR.hourBand(T.cols.start[i]); lvl.set(h, (lvl.get(h) || 0) + T.cols.tvr[i]); days.add(T.cols.date[i]); }
      ctx.hour_level = Object.fromEntries([...lvl.entries()].map(([h, v]) => [h, v / Math.max(1, days.size)])); }
    { const cc = new Map(), kc = new Map(); for (let k = 0; k < idx.length; k++) { const i = idx[k]; cc.set(S(T, 'channel', i), (cc.get(S(T, 'channel', i)) || 0) + 1); const g = S(T, 'category', i); if (g) kc.set(g, (kc.get(g) || 0) + 1); }
      ctx.channels = [...cc.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]); ctx.categories = [...kc.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]); }
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
    // premium position (PosinBrk 1 or 2) as a 100/0 flag so its mean is a percentage
    { const P = L.cols.posinbrk, f = new Float32Array(L.n); for (let i = 0; i < L.n; i++) f[i] = P[i] >= 1 ? (P[i] <= 2 ? 100 : 0) : NaN; L = { ...L, cols: { ...L.cols, first2: f } }; }
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
    // sponsorship items (Time Check, -BB, Tag ...) versus commercial spots: spend and price per second, each forecast on its own
    const spFlag = L.dicts.theme.map(MR.isSponsorTheme), typeOf = (L2) => (i) => (L2.cols.theme[i] >= 0 && spFlag[L2.cols.theme[i]] ? 'Sponsorship' : 'Commercial');
    const nSp = MR.where(L, gIdx, (i) => spFlag[L.cols.theme[i]]).length;
    ctx.sponsor_spots = nSp;
    if (nSp >= 20 && nSp < gIdx.length) {
      run('type_spend', gIdx, 'adtype', 'spend', { entity: typeOf, entities: ['Commercial', 'Sponsorship'] });
      run('type_cps', gIdx, 'adtype', 'cps', { entity: typeOf, entities: ['Commercial', 'Sponsorship'] });
    }
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
    // channel mix and competitor x channel (media specialist views)
    run('chan_mix', gIdx, 'channel', 'sov', { maxEntities: 8 });
    const topCh = topBy(L, gIdx, (i) => S(L, 'channel', i), cost, 4), topAd = comp.slice(0, 6);
    const pairs = []; for (const a of topAd) for (const c of topCh) pairs.push(a + ' | ' + c);
    const advCh = (L2) => (i) => `${S(L2, 'advertiser', i)} | ${S(L2, 'channel', i)}`;
    run('adv_channel', gIdx, 'advertiser', 'spend', { entity: advCh, entities: pairs });
    ctx.top_channels = topCh; ctx.top_advertisers = topAd;
    // focus brand against rivals by daypart and language (the same advertisers as the channel view)
    const pairsOf = (keyFn, vals) => { const o = []; for (const a of topAd) for (const v of vals) o.push(a + ' | ' + v); return o; };
    const advDp = (L2) => (i) => `${S(L2, 'advertiser', i)} | ${S(L2, 'daypart', i)}`, advLg = (L2) => (i) => `${S(L2, 'advertiser', i)} | ${S(L2, 'lng', i)}`;
    ctx.top_dayparts = topBy(L, gIdx, (i) => S(L, 'daypart', i), cost, 5); ctx.top_langs = topBy(L, gIdx, (i) => S(L, 'lng', i), cost, 3);
    run('adv_daypart', gIdx, 'advertiser', 'spend', { entity: advDp, entities: pairsOf(null, ctx.top_dayparts) });
    run('adv_lang', gIdx, 'advertiser', 'spend', { entity: advLg, entities: pairsOf(null, ctx.top_langs) });
    // break clutter and premium positions per channel and daypart, for any medium that records them
    { const cdE = (L2) => (i) => `${S(L2, 'channel', i)} | ${S(L2, 'daypart', i)}`;
      const cdIdx = MR.where(L, idx, (i) => L.cols.adsinbrk[i] >= 0 || L.cols.posinbrk[i] >= 1);
      const cds = topBy(L, cdIdx, cdE(L), () => 1, 10); ctx.cd_pairs = cds;
      if (cds.length) {
        run('clutter_cd', cdIdx, 'cd', 'clutter', { entity: cdE, entities: cds });
        run('first2_cd', cdIdx, 'cd', 'first2', { entity: cdE, entities: cds, metricDef: MR.metricDef('first2', 'Spots in position 1 or 2 (%)', 'mean', { col: 'first2', zero_fill: false, unit: 'percent' }) });
      } }
    // multi-year history analytics (not forecasts): recurring competitor bursts and creative lifecycles
    ctx.history_years = (hi - lo) / 365.25;
    ctx.radar = seasonalBursts(L, gIdx, comp);
    ctx.lifecycle = themeLifecycle(L, gIdx, comp.slice(0, 8), hi);
    ctx.bridge = L.bridgeStats || null;
    // CPRP efficiency: matched programme ratings (needs the TVR sheet)
    if (ctx.has_grp) {
      run('sog', gIdx, 'advertiser', 'sog', { entities: comp });
      run('cprp_total', gIdx, 'total', 'cprp');
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


  /* ---------------- multi-year burst radar ---------------- */
  /** Weekly spend bursts per advertiser: a week more than 1.5x the median of the 8 weeks before it (and not trivial) starts or continues an episode. */
  function seasonalBursts(L, gIdx, advertisers) {
    const want = new Set(advertisers), per = new Map();
    for (let k = 0; k < gIdx.length; k++) {
      const i = gIdx[k], a = S(L, 'advertiser', i); if (!want.has(a)) continue;
      const w = MR.weekStart(L.cols.date[i]); let m = per.get(a); if (!m) { m = new Map(); per.set(a, m); }
      m.set(w, (m.get(w) || 0) + L.cols.cost[i]);
    }
    const out = {};
    for (const [a, m] of per) {
      const weeks = [...m.keys()].sort((x, y) => x - y), w0 = weeks[0], w1 = weeks[weeks.length - 1], arr = [];
      for (let w = w0; w <= w1; w += 7) arr.push(m.get(w) || 0);
      const peak = Math.max(...arr), eps = []; let cur = null;
      for (let j = 0; j < arr.length; j++) {
        const prev = arr.slice(Math.max(0, j - 8), j); if (prev.length < 4) continue;
        const base = median(prev) || 0, hit = arr[j] >= peak * 0.12 && (base > 0 ? arr[j] > base * 1.5 : true);
        if (hit) { if (cur && cur.endW === j - 1) { cur.endW = j; cur.spend += arr[j]; cur.lift = Math.max(cur.lift, base > 0 ? arr[j] / base : 3); } else { cur = { startW: j, endW: j, spend: arr[j], lift: base > 0 ? arr[j] / base : 3 }; eps.push(cur); } }
      }
      out[a] = eps.map((e) => ({ start: w0 + e.startW * 7, end: w0 + e.endW * 7 + 6, spend: e.spend, lift: e.lift }));
    }
    return out;
  }
  /** Chance that an advertiser starts a burst in the next `horizon` days, from how many past years had one in the same calendar window (+/- tol days). Needs 2 covered years. */
  function radarProb(episodes, loDay, hiDay, horizon, tol = 10) {
    const ws = hiDay + 1, we = hiDay + horizon; let covered = 0, hits = 0; const dates = [];
    for (let y = 1; y <= 6; y++) {
      const a = Math.round(ws - y * 365.25), b = Math.round(we - y * 365.25);
      if (a - tol < loDay || b > hiDay) continue;       // that year is not fully in the data
      covered++;
      const hit = episodes.filter((e) => e.start >= a - tol && e.start <= b + tol);
      if (hit.length) { hits++; dates.push(...hit.map((e) => MR.isoFromDay(e.start))); }
    }
    const lifts = episodes.map((e) => e.lift).filter(finite);
    return { covered, hits, prob: covered >= 2 ? hits / covered : null, dates, typical_lift: lifts.length ? median(lifts) : null };
  }

  /* ---------------- creative lifecycle ---------------- */
  /** Per advertiser: how long each Advt_Theme ran, the typical lifespan of finished themes, and whether the current main theme is ageing, wearing out or due for refresh. */
  function themeLifecycle(L, gIdx, advertisers, hiDay) {
    const want = new Set(advertisers), th = new Map(), T = L.cols.theme;
    for (let k = 0; k < gIdx.length; k++) {
      const i = gIdx[k], a = S(L, 'advertiser', i); if (!want.has(a)) continue;
      const name = S(L, 'theme', i); if (MR.isSponsorTheme(name)) continue;
      const key = a + '\u0001' + name; let r = th.get(key); if (!r) { r = { advertiser: a, theme: name, rows: [] }; th.set(key, r); }
      r.rows.push([L.cols.date[i], L.cols.dur[i], L.cols.cost[i]]);
    }
    const items = [];
    for (const r of th.values()) {
      r.rows.sort((x, y) => x[0] - y[0]);
      const n = r.rows.length, first = r.rows[0][0], last = r.rows[n - 1][0];
      const q = Math.max(1, Math.floor(n / 4)), dm = (rows) => mean(rows.map((x) => x[1]).filter((v) => v > 0));
      const wk = new Map(); r.rows.forEach((x) => { const w = MR.weekStart(x[0]); wk.set(w, (wk.get(w) || 0) + 1); });
      const counts = [...wk.entries()].sort((x, y) => x[0] - y[0]).map((e) => e[1]), peak = Math.max(...counts);
      const recent = r.rows.filter((x) => x[0] > hiDay - 28).length / 4;
      items.push({ advertiser: r.advertiser, theme: r.theme, first, last, spots: n, spend: r.rows.reduce((s2, x) => s2 + x[2], 0), life: last - first + 1,
        dur_early: dm(r.rows.slice(0, q)), dur_late: dm(r.rows.slice(-q)), peak_weekly: peak, recent_weekly: recent, active: last >= hiDay - 21 });
    }
    const done = items.filter((x) => !x.active && x.life >= 14).map((x) => x.life), allMed = done.length >= 3 ? median(done) : null;
    const out = [];
    for (const a of advertisers) {
      const mine = items.filter((x) => x.advertiser === a); if (!mine.length) continue;
      const fin = mine.filter((x) => !x.active && x.life >= 14).map((x) => x.life), typical = fin.length >= 2 ? median(fin) : allMed;
      const cur = mine.filter((x) => x.active).sort((x, y) => y.recent_weekly - x.recent_weekly || y.spend - x.spend)[0]; if (!cur) continue;
      const age = hiDay - cur.first + 1, wear = cur.peak_weekly > 0 ? cur.recent_weekly / cur.peak_weekly : 1;
      const shorter = cur.dur_early > 0 && cur.dur_late > 0 && cur.dur_late <= cur.dur_early * 0.6;
      let status = 'Fresh';
      if (typical && age >= typical * 0.9) status = 'Refresh due'; else if (wear <= 0.6 || shorter) status = 'Wearing out'; else if (typical && age >= typical * 0.7) status = 'Ageing';
      out.push({ advertiser: a, theme: cur.theme, first: MR.isoFromDay(cur.first), age_days: age, typical_days: typical, finished_themes: fin.length, due_date: typical ? MR.isoFromDay(cur.first + Math.round(typical)) : null,
        due_in_days: typical ? Math.round(cur.first + typical - hiDay) : null, wear_pct: wear * 100, dur_early: cur.dur_early, dur_late: cur.dur_late, shorter_spots: shorter, spots: cur.spots, status });
    }
    return out;
  }


  /* ---------------- New programme (cold start) estimator ---------------- */
  /**
   * A programme with no history of its own is estimated from three signals in the TVR sheet:
   *  1. the target channel's own audience in that exact slot, plus what the programme just before it hands over (lead-in),
   *  2. how loyal the rival channels' audiences are in the same slot (stickiness, viewing time, steadiness) which caps the upside
   *     and shows how much audience can be stolen, and
   *  3. how earlier launches of the same category grew or faded in their first 4 weeks.
   * No forecasting model is involved (there is nothing to forecast from), so the result is labelled an estimate.
   */
  function coldStart(T, o) {
    const notes = [], Z = 1.2816;
    const idx = MR.applyFilters(T, 'tv', o.filters || {});
    const s0 = MR.parseTime(o.start), s1raw = MR.parseTime(o.end);
    if (s0 < 0 || s1raw < 0) return { ok: false, message: 'Enter the start and end time, for example 20:00 and 20:30.' };
    const s1 = s1raw <= s0 ? s1raw + 86400 : s1raw, span = s1 - s0, days = new Set((o.days && o.days.length ? o.days : [0, 1, 2, 3, 4, 5, 6]).map(Number));
    if (!idx.length) return { ok: false, message: 'No TVR rows match the current filters.' };
    const [dmin, dmax] = MR.minMax(T.cols.date, idx), recent = dmax - 55;
    const D = T.cols.date, ST = T.cols.start, EN = T.cols.end, TV = T.cols.tvr;
    const endOf = (i) => { let e = EN[i]; if (e < 0) e = ST[i] + (Number.isFinite(T.cols.duration[i]) ? T.cols.duration[i] : 30) * 60; if (e <= ST[i]) e += 86400; return e; };
    const num = (col, i) => { const c = T.cols[col]; if (!c) return NaN; const v = c[i]; return Number.isFinite(v) && v >= 0 ? v : NaN; };
    const mean = (a) => { const v = a.filter(Number.isFinite); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null; };
    const sd = (a) => { const v = a.filter(Number.isFinite), m = mean(v); return v.length > 1 ? Math.sqrt(v.reduce((x, y) => x + (y - m) ** 2, 0) / (v.length - 1)) : null; };
    const med = (a) => { const v = a.filter(Number.isFinite).sort((x, y) => x - y); if (!v.length) return null; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
    const chName = (i) => S(T, 'channel', i);
    // rows that fill the slot: on the chosen weekdays, with at least half of the window covered
    const inSlot = (i, from) => ST[i] >= 0 && days.has(MR.dowMon(D[i])) && D[i] >= from && Math.min(endOf(i), s1) - Math.max(ST[i], s0) >= span * 0.5 && Number.isFinite(TV[i]);
    const slotRows = new Map();
    for (let k = 0; k < idx.length; k++) { const i = idx[k]; if (!inSlot(i, recent)) continue; const c = chName(i); if (!slotRows.has(c)) slotRows.set(c, []); slotRows.get(c).push(i); }
    const target = o.channel, mine = slotRows.get(target) || [];
    // 1. baseline and lead-in
    const vals = mine.map((i) => TV[i]), b0 = mean(vals), sdb = sd(vals);
    // hand-over: programmes that finish within 5 minutes before the slot on the target channel, and how much of the previous programme's audience the next one keeps
    const pairs = [];
    const byDay = new Map();
    for (let k = 0; k < idx.length; k++) { const i = idx[k]; if (chName(i) !== target || ST[i] < 0 || !Number.isFinite(TV[i]) || TV[i] <= 0) continue; const key = D[i]; if (!byDay.has(key)) byDay.set(key, []); byDay.get(key).push(i); }
    for (const arr of byDay.values()) { arr.sort((a, b) => ST[a] - ST[b]); for (let j = 1; j < arr.length; j++) if (Math.abs(ST[arr[j]] - endOf(arr[j - 1])) <= 600) pairs.push(TV[arr[j]] / TV[arr[j - 1]]); }
    const rho = pairs.length >= 5 ? Math.min(1.3, Math.max(0.5, med(pairs))) : 0.9;
    const lead = [];
    for (let k = 0; k < idx.length; k++) { const i = idx[k]; if (chName(i) !== target || D[i] < recent || ST[i] < 0 || !days.has(MR.dowMon(D[i])) || !Number.isFinite(TV[i])) continue; const e = endOf(i); if (e <= s0 + 300 && e >= s0 - 600 && ST[i] < s0) lead.push(i); }
    const L = mean(lead.map((i) => TV[i])), leadName = lead.length ? S(T, 'program', lead[0]) : null, leadEst = L != null ? L * rho : null;
    let base = null, basis = 'none';
    if (b0 != null && leadEst != null) { base = 0.5 * b0 + 0.5 * leadEst; basis = 'slot history and lead-in'; }
    else if (b0 != null) { base = b0; basis = 'slot history'; }
    else if (leadEst != null) { base = leadEst; basis = 'lead-in only'; }
    else { const all = idx.filter((i) => chName(i) === target && D[i] >= recent && Number.isFinite(TV[i]) && ST[i] >= 0 && Math.abs(ST[i] - s0) <= 7200).map((i) => TV[i]); base = mean(all); basis = base != null ? 'channel at nearby hours' : 'none'; }
    if (base == null) return { ok: false, message: `${target} has no recorded airings near ${o.start}. Pick a channel that is in the TVR sheet.` };
    if (b0 == null) notes.push('Nothing airs in this exact slot in the last 8 weeks, so the estimate leans on the lead-in and nearby hours and is less certain.');
    // 2. rival loyalty in the same slot
    const rivals = [];
    for (const [c, rows] of slotRows) {
      if (c === target) continue;
      const t = rows.map((i) => TV[i]), tm = mean(t), r = mean(rows.map((i) => num('reach_pct', i))), a = mean(rows.map((i) => num('avg_time', i))), d = mean(rows.map((i) => { const x = T.cols.duration[i]; return Number.isFinite(x) ? x : (endOf(i) - ST[i]) / 60; }));
      const half = Math.floor(rows.length / 2), sorted = rows.slice().sort((x, y) => D[x] - D[y]), recentHalf = mean(sorted.slice(half).map((i) => TV[i])), earlyHalf = mean(sorted.slice(0, half).map((i) => TV[i]));
      rivals.push({ channel: c, tvr: tm, reach: r, stickiness: r > 0 ? tm / r : null, retention: a != null && d > 0 ? Math.min(1, a / d) : null, volatility: tm > 0 && t.length > 2 ? sd(t) / tm : null,
        trend: earlyHalf > 0 && rows.length >= 6 ? recentHalf / earlyHalf - 1 : null, airings: rows.length });
    }
    const stickRank = (v) => { const all = rivals.map((x) => x.stickiness).filter(Number.isFinite).sort((x, y) => x - y); return all.length > 1 && Number.isFinite(v) ? all.filter((x) => x < v).length / (all.length - 1) : null; };
    rivals.forEach((x) => { const parts = [stickRank(x.stickiness), x.retention, x.volatility != null ? 1 - Math.min(1, x.volatility) : null].filter(Number.isFinite); x.loyalty = parts.length ? mean(parts) : null; });
    const medT = med(rivals.map((x) => x.tvr)) || 0, CAPTURE = 0.15;
    rivals.forEach((x) => { x.zapping = x.loyalty != null && (x.loyalty < 0.4 || (x.trend != null && x.trend <= -0.05)); x.stealable = x.loyalty != null ? CAPTURE * x.tvr * (1 - x.loyalty) : 0; });
    rivals.sort((a, b) => b.stealable - a.stealable);
    const strong = rivals.filter((x) => x.loyalty != null && x.tvr >= medT * 0.5).sort((a, b) => b.loyalty - a.loyalty)[0] || null;
    const capFactor = strong ? 1.15 + 0.35 * (1 - strong.loyalty) : 1.35, pool = rivals.reduce((s2, x) => s2 + x.stealable, 0), uplift = Math.min(pool, base * 0.25);
    // 3. category launch curve
    const first = new Map();
    for (let k = 0; k < idx.length; k++) { const i = idx[k]; if (!Number.isFinite(TV[i])) continue; const key = chName(i) + '\u0001' + S(T, 'program', i); const f = first.get(key); if (!f || D[i] < f.d) first.set(key, { d: D[i], ch: chName(i), cat: o.category && T.cols.category ? S(T, 'category', i) : null }); }
    const wk = new Map();
    for (let k = 0; k < idx.length; k++) { const i = idx[k]; if (!Number.isFinite(TV[i])) continue; const key = chName(i) + '\u0001' + S(T, 'program', i), f = first.get(key); const w = Math.floor((D[i] - f.d) / 7); if (w > 3) continue; const m = wk.get(key) || [[], [], [], []]; m[w].push(TV[i]); wk.set(key, m); }
    const curves = (sameChannel) => { const out = []; for (const [key, m] of wk) { const f = first.get(key); if (!f || f.d < dmin + 28 || m.some((x) => x.length < 2)) continue; if (o.category && f.cat !== o.category) continue; if (sameChannel && f.ch !== target) continue; const w = m.map(mean); if (w[0] > 0) out.push({ title: key.split('\u0001')[1], ch: f.ch, c: w.map((x) => x / w[0]) }); } return out; };
    let cv = curves(true), cbasis = 'launches of this category on this channel';
    if (cv.length < 2) { cv = curves(false); cbasis = 'launches of this category on all channels'; }
    if (!cv.length) { cbasis = 'none'; notes.push('No earlier launch of this category was found in the sheet, so a flat launch curve is used and the range is wider.'); }
    const curve = [0, 1, 2, 3].map((k) => (cv.length ? Math.max(0.3, med(cv.map((x) => x.c[k]))) : 1));
    const curveSd = [0, 1, 2, 3].map((k) => (cv.length >= 3 ? Math.min(0.5, sd(cv.map((x) => x.c[k])) || 0.1) : 0.12 + 0.04 * k));
    // trajectory: the median level is the baseline times the curve, with the stealable audience phased in from week 2
    const relB = sdb != null && b0 > 0 ? sdb / b0 : 0.15, weeks = [];
    for (let k = 0; k < 4; k++) {
      const p50 = base * curve[k] + uplift * [0.4, 0.8, 1, 1][k];
      const sig = p50 * Math.sqrt(relB ** 2 + curveSd[k] ** 2 + 0.15 ** 2);
      weeks.push({ week: k + 1, p10: Math.max(0, p50 - Z * sig), p50, p90: Math.min(p50 + Z * sig, p50 * capFactor), curve: curve[k] });
    }
    const avg = (key) => mean(weeks.map((w) => w[key]));
    return { ok: true, notes, inputs: { channel: target, days: [...days], start: o.start, end: o.end, category: o.category || null },
      baseline: { slot_tvr: b0, slot_sd: sdb, slot_airings: mine.length, lead_in: leadName, lead_in_tvr: L, retention: rho, lead_estimate: leadEst, estimate: base, basis },
      rivals: rivals.slice(0, 8), strongest_rival: strong ? { channel: strong.channel, loyalty: strong.loyalty } : null, cap_factor: capFactor, stealable_pool: pool, uplift,
      curve: { basis: cbasis, launches: cv.length, titles: cv.slice(0, 5).map((x) => `${x.title} (${x.ch})`), weeks: curve },
      weeks, verdict: { p50: avg('p50'), p10: avg('p10'), p90: avg('p90'), biggest_loser: rivals[0] && rivals[0].stealable > 0 ? rivals[0].channel : null, loser_share: rivals[0] ? rivals[0].stealable : 0 } };
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

  Object.assign(MR, { HORIZON_MAX, tvrPayload, marketPayload, seasonalBursts, radarProb, themeLifecycle, coldStart, sliceForecast, bursts, dowHourMatrix, monthHourMatrix, recentMean, buyingZone, globalOptions, pmean: mean, psum: sum, pmedian: median });
})(typeof self !== 'undefined' ? self : globalThis);
