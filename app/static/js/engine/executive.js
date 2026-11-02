/* Executive Negotiation Summary: overall campaign summary, channel-wise breakdown and programmes & sponsorship,
 * with drill-down details (commercial, ratings and volume, sponsorship) for any channel or programme.
 * Uses the same sponsorship, special placement and frequency rules as the Programme & Sponsorship Spotlight.
 * Runs in the worker and in Node tests.
 */
(function (root) {
  const MR = root.MR;
  const { isoFromDay } = MR;
  const SP = MR._spot;
  const { scan, acc, add, out, themeRows, inDates, durIdx, DUR, pct } = SP;
  const medium = (ch) => (/\bFM\b|RADIO/i.test(String(ch)) ? 'Radio' : 'TV');
  const codes = (L, col, names) => new Set((names || []).map((n) => L.dicts[col].indexOf(n)).filter((c) => c >= 0));

  /** Rows inside the selection: page filters, dates, channels and advertisers. */
  function select(L, idx, opts) {
    const C = L.cols, dated = inDates(L, idx, opts.date_from, opts.date_to);
    const chs = codes(L, 'channel', opts.channels), ads = codes(L, 'advertiser', opts.advertisers);
    return { dated, rows: (chs.size || ads.size) ? MR.where(L, dated, (i) => (!chs.size || chs.has(C.channel[i])) && (!ads.size || ads.has(C.advertiser[i]))) : dated };
  }
  function split(L, rows, col, fn) {
    const C = L.cols, m = new Map(); let tot = 0, totN = 0;
    for (let k = 0; k < rows.length; k++) { const i = rows[k], key = fn ? fn(i) : (C[col][i] >= 0 ? L.dicts[col][C[col][i]] : 'Unknown'); const x = m.get(key) || { name: key, spend: 0, spots: 0 }; x.spend += C.cost[i]; x.spots++; m.set(key, x); tot += C.cost[i]; totN++; }
    return [...m.values()].sort((a, b) => b.spend - a.spend).map((x) => ({ ...x, spend_share: pct(x.spend, tot), spot_share: pct(x.spots, totN) }));
  }
  const durName = (L, i) => { const k = durIdx(L.cols.dur[i]); return k < 0 ? 'No length' : DUR[k]; };
  function ratings(L, rows) {
    const G = L.cols.grp; if (!G) return null;
    let grp = 0, cost = 0, n = 0; for (let k = 0; k < rows.length; k++) { const i = rows[k]; if (G[i] > 0) { grp += G[i]; cost += L.cols.cost[i]; n++; } }
    return { grps: grp, rated_spots: n, rated_pct: pct(n, rows.length), avg_spot_rating: n ? grp / n : null, cprp: grp > 0 ? cost / grp : null };
  }
  function money(a) { const o = out(a); return { ...o, commercial_spend: o.regular_spend + o.special_spend, commercial_spots: o.regular_spots + o.special_spots, value_add_spend: o.sponsor_spend, value_add_items: o.sponsor_items }; }

  /** Drill-down for a set of rows: commercial details, ratings and volume, sponsorship details. */
  function detail(L, rows, sc, freqRows, programFilter) {
    const C = L.cols, a = acc(); for (let k = 0; k < rows.length; k++) { const i = rows[k]; add(a, L, i, sc.kinds[C.theme[i]], sc.isSpecial(i)); }
    const o = money(a);
    const com = MR.where(L, rows, (i) => !sc.kinds[C.theme[i]]);
    const byDur = split(L, com, null, (i) => durName(L, i)).sort((x, y) => DUR.concat(['No length']).indexOf(x.name) - DUR.concat(['No length']).indexOf(y.name));
    const days = new Map(); for (let k = 0; k < rows.length; k++) { const d = C.date[rows[k]]; days.set(d, (days.get(d) || 0) + 1); }
    const peak = [...days.entries()].sort((x, y) => y[1] - x[1])[0];
    const sp = (freqRows || []).filter((r) => r.sponsorship || r.frequency).map((r) => {
      const inProg = programFilter ? r.programmes.find((x) => x.program === programFilter) : null;
      return { advertiser: r.advertiser, theme: r.theme, item: r.item, types: r.types, spots: programFilter ? (inProg ? inProg.spots : 0) : r.spots, channel_spots: r.spots, daily_avg: r.daily_avg, length: r.length,
        programmes: r.programmes.slice(0, 6), first_seen: r.first_seen, last_seen: r.last_seen };
    }).filter((r) => r.spots > 0).sort((x, y) => (y.types.includes('Sponsorship') - x.types.includes('Sponsorship')) || y.spots - x.spots);
    return {
      commercial: { spots: o.commercial_spots, spend: o.commercial_spend, special_spots: o.special_spots, by_duration: byDur, by_daypart: split(L, com, 'daypart').slice(0, 8), by_advertiser: split(L, com, 'advertiser').slice(0, 10), by_language: split(L, com, 'lng').slice(0, 5) },
      volume: { spots: o.spots, active_days: days.size, spots_per_day: days.size ? o.spots / days.size : null, peak_day: peak ? { date: isoFromDay(peak[0]), spots: peak[1] } : null,
        avg_clutter: o.avg_clutter, fib_pct: o.fib_pct, bumper_pct: o.bumper_pct, avg_dur: o.avg_dur, first_seen: o.first_seen, last_seen: o.last_seen, ratings: ratings(L, rows) },
      sponsorship: { items: o.sponsor_items, spend: o.sponsor_spend, billboards: o.billboard_items, logos: o.logo_items, tags: sp.filter((r) => r.types.includes('Sponsorship')).slice(0, 25), frequency: sp.filter((r) => r.types.includes('Frequency')).slice(0, 25) },
    };
  }

  /**
   * opts: {advertisers, channels, date_from, date_to, min_daily, max_dur, details (true: add drill-downs for the top channels and programmes, for the PDF)}
   */
  function executiveSummary(L, idx, opts = {}) {
    const C = L.cols, { dated, rows } = select(L, idx, opts);
    const sel = { advertisers: opts.advertisers || [], channels: opts.channels || [], date_from: opts.date_from || null, date_to: opts.date_to || null };
    const rank = (r, col) => { const m = new Map(); for (let k = 0; k < r.length; k++) { const i = r[k]; m.set(C[col][i], (m.get(C[col][i]) || 0) + C.cost[i]); } return [...m.entries()].filter((e) => e[0] >= 0).sort((a, b) => b[1] - a[1]).map((e) => L.dicts[col][e[0]]); };
    const chs = codes(L, 'channel', opts.channels), inCh = chs.size ? MR.where(L, dated, (i) => chs.has(C.channel[i])) : dated;
    const options = { channels: rank(dated, 'channel'), advertisers: rank(inCh, 'advertiser').slice(0, 1000) };
    const [lo0, hi0] = idx.length ? MR.minMax(C.date, idx) : [NaN, NaN];
    const bounds = [Number.isFinite(lo0) ? isoFromDay(lo0) : null, Number.isFinite(hi0) ? isoFromDay(hi0) : null];
    if (!rows.length) return { empty: true, selection: sel, options, bounds };
    const sc = scan(L, dated);   // programme rules judged on everyone in the date range
    const tot = acc(); for (let k = 0; k < rows.length; k++) { const i = rows[k]; add(tot, L, i, sc.kinds[C.theme[i]], sc.isSpecial(i)); }
    const T = money(tot);
    const th = themeRows(L, rows, sc, { ...opts, show: 'all' });
    // ---- section 1: overall
    const overall = { ...T, brands: new Set(Array.from(rows, (i) => C.advertiser[i])).size, products: new Set(Array.from(rows, (i) => C.product[i])).size,
      channels: new Set(Array.from(rows, (i) => C.channel[i])).size, programmes: new Set(Array.from(rows, (i) => C.channel[i] * 1e6 + C.program[i])).size,
      commercial_share: pct(T.commercial_spend, T.spend), value_add_share: pct(T.value_add_spend, T.spend), frequency_buys: th.totals.frequency_buys, sponsorship_themes: th.totals.sponsorship_themes,
      ratings: ratings(L, rows) };
    const languages = split(L, rows, 'lng'), media = split(L, rows, null, (i) => medium(L.dicts.channel[C.channel[i]]));
    const durations = split(L, rows, null, (i) => durName(L, i)).sort((x, y) => DUR.concat(['No length']).indexOf(x.name) - DUR.concat(['No length']).indexOf(y.name));
    const brands = split(L, rows, 'advertiser').slice(0, 15);
    // ---- section 2: channels
    const byCh = new Map(); for (let k = 0; k < rows.length; k++) { const i = rows[k]; let a = byCh.get(C.channel[i]); if (!a) byCh.set(C.channel[i], (a = { acc: acc(), rows: [] })); add(a.acc, L, i, sc.kinds[C.theme[i]], sc.isSpecial(i)); a.rows.push(i); }
    const channels = [...byCh.entries()].map(([c, a]) => { const o = money(a.acc), name = L.dicts.channel[c];
      return { channel: name, medium: medium(name), commercial_spend: o.commercial_spend, value_add_spend: o.value_add_spend, spend: o.spend, commercial_spots: o.commercial_spots, value_add_items: o.value_add_items, spots: o.spots,
        sow_pct: pct(o.spend, T.spend), spots_per_day: o.active_days ? o.spots / o.active_days : null, avg_clutter: o.avg_clutter, fib_pct: o.fib_pct,
        frequency_buys: th.list.filter((r) => r.channel === name && r.frequency).length, ratings: ratings(L, Int32Array.from(a.rows)) }; })
      .sort((a, b) => b.spend - a.spend).map((x, k) => ({ rank: k + 1, ...x }));
    // ---- section 3: programmes and sponsorship
    const nP = L.dicts.program.length + 1, byP = new Map();
    for (let k = 0; k < rows.length; k++) { const i = rows[k], key = C.channel[i] * nP + C.program[i] + 1; let a = byP.get(key);
      if (!a) byP.set(key, (a = { ch: C.channel[i], pg: C.program[i], acc: acc(), sponsors: new Map(), days: new Set() }));
      const kd = sc.kinds[C.theme[i]]; add(a.acc, L, i, kd, sc.isSpecial(i)); a.days.add(C.date[i]); if (kd) a.sponsors.set(C.advertiser[i], (a.sponsors.get(C.advertiser[i]) || 0) + 1); }
    const programmes = [...byP.values()].map((a) => { const o = money(a.acc), ch = L.dicts.channel[a.ch], pg = a.pg >= 0 ? L.dicts.program[a.pg] : 'UNKNOWN';
      const fq = th.list.filter((r) => r.frequency && r.channel === ch && r.programmes.some((p) => p.program === pg));
      return { channel: ch, program: pg, sponsored: a.sponsors.size > 0, sponsors: [...a.sponsors.entries()].sort((x, y) => y[1] - x[1]).map(([adv, n]) => ({ advertiser: L.dicts.advertiser[adv], items: n })),
        value_add_items: o.value_add_items, value_add_spend: o.value_add_spend, commercial_spots: o.commercial_spots, commercial_spend: o.commercial_spend, spots: o.spots, spend: o.spend,
        airing_days: a.days.size, spots_per_airing: a.days.size ? o.spots / a.days.size : null, frequency_buys: fq.length, frequency_advertisers: [...new Set(fq.map((r) => r.advertiser))] }; })
      .sort((a, b) => (b.sponsored - a.sponsored) || b.value_add_spend - a.value_add_spend || b.spend - a.spend);
    const [lo, hi] = MR.minMax(C.date, rows);
    const res = { empty: false, selection: sel, options, bounds, period: [isoFromDay(lo), isoFromDay(hi)], range: [opts.date_from || bounds[0], opts.date_to || bounds[1]], has_ratings: !!C.grp,
      rule: { min_daily: th.fq.min_daily, max_dur: th.fq.max_dur }, overall, languages, media, durations, brands, channels, programmes: programmes.slice(0, 80), n_programmes: programmes.length,
      sponsored_programmes: programmes.filter((p) => p.sponsored).length };
    if (opts.details) {
      res.channel_details = channels.slice(0, opts.max_detail_channels || 10).map((c) => ({ channel: c.channel, ...executiveDetailRows(L, rows, sc, th, c.channel, null) }));
      res.programme_details = programmes.slice(0, opts.max_detail_programmes || 10).map((p) => ({ channel: p.channel, program: p.program, ...executiveDetailRows(L, rows, sc, th, p.channel, p.program) }));
    }
    return res;
  }
  function executiveDetailRows(L, rows, sc, th, channel, program) {
    const C = L.cols, ch = L.dicts.channel.indexOf(channel), pg = program == null ? -2 : L.dicts.program.indexOf(program);
    const sub = MR.where(L, rows, (i) => C.channel[i] === ch && (pg === -2 || C.program[i] === pg));
    return detail(L, sub, sc, th.list.filter((r) => r.channel === channel), program);
  }
  /** One drill-down, for a click: opts as executiveSummary plus {channel, program}. */
  function executiveDetail(L, idx, opts = {}) {
    const { dated, rows } = select(L, idx, opts);
    if (!rows.length) return { empty: true };
    const sc = scan(L, dated), th = themeRows(L, rows, sc, { ...opts, show: 'all' });
    return { empty: false, channel: opts.channel, program: opts.program || null, ...executiveDetailRows(L, rows, sc, th, opts.channel, opts.program || null) };
  }
  Object.assign(MR, { executiveSummary, executiveDetail, mediumOf: medium });
})(typeof self !== 'undefined' ? self : globalThis);
