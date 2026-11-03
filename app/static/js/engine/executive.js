/* Executive Negotiation Summary: overall campaign summary, channel-wise breakdown and programmes & sponsorship,
 * with drill-down details for any channel or programme. Runs in the worker and in Node tests.
 *
 * Classification, per programme (a programme is one channel + programme name) and per ad (advertiser + theme):
 *  - High-Frequency Reminders: on the days the ad ran in the programme it averaged MORE than min_daily spots a day,
 *    or it was max_dur seconds or shorter and averaged min_daily or more spots a day (defaults 10 and 10).
 *  - Exclusive Sponsorship / Value-Add: the theme is a sponsorship item (Logo, Intro, Outro/Extro, -BB, Com Break, Next Card,
 *    Tag, Time Check, DJ, -Tr) and it appears consistently in the programme: on at least half of the programme's airing days
 *    (and at least 3 days, or every airing when there are fewer).
 *  - Sponsorship / Value-Add: a sponsorship item that does not recur consistently.
 *  - Regular: everything else.
 * An ad can be both a sponsorship and high-frequency (for example a logo shown 12 times an episode).
 */
(function (root) {
  const MR = root.MR;
  const { isoFromDay } = MR;
  const SP = MR._spot;
  const { scan, acc, add, out, inDates, durIdx, DUR, pct } = SP;
  const HF = 'High-Frequency Reminders', EX = 'Exclusive Sponsorship / Value-Add', SPN = 'Sponsorship / Value-Add';
  const CONSISTENT_SHARE = 0.5, CONSISTENT_DAYS = 3;
  /** TV, Radio or Press for a row: the sheet's own medium column (from the channel prefix) when it has one, else a guess from the name. */
  const rowMedium = (L, i) => (L.cols.medium ? L.dicts.medium[L.cols.medium[i]] : medium(L.dicts.channel[L.cols.channel[i]]));
  const medium = (ch) => (/\bFM\b|RADIO/i.test(String(ch)) ? 'Radio' : 'TV');
  const codes = (L, col, names) => new Set((names || []).map((n) => L.dicts[col].indexOf(n)).filter((c) => c >= 0));
  const DUR_ALL = DUR.concat(['No length']);

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
  const byDurOrder = (x, y) => DUR_ALL.indexOf(x.name) - DUR_ALL.indexOf(y.name);
  function ratings(L, rows) {
    const G = L.cols.grp; if (!G) return null;
    let grp = 0, cost = 0, n = 0; for (let k = 0; k < rows.length; k++) { const i = rows[k]; if (G[i] > 0) { grp += G[i]; cost += L.cols.cost[i]; n++; } }
    return { grps: grp, rated_spots: n, rated_pct: pct(n, rows.length), avg_spot_rating: n ? grp / n : null, cprp: grp > 0 ? cost / grp : null };
  }
  function money(a) { const o = out(a); return { ...o, commercial_spend: o.regular_spend + o.special_spend, commercial_spots: o.regular_spots + o.special_spots, value_add_spend: o.sponsor_spend, value_add_items: o.sponsor_items }; }
  function itemLabel(theme, kind) { return kind ? (MR.sponsorItem(theme) || 'Sponsorship item') : 'Spot'; }


  /** Every ad (advertiser + theme) in every programme, classified. `dated` gives each programme's airing days (all advertisers). */
  function classify(L, rows, dated, sc, opts) {
    const C = L.cols, minDaily = +opts.min_daily > 0 ? +opts.min_daily : 10, maxDur = +opts.max_dur > 0 ? +opts.max_dur : 10;
    const nA = L.dicts.advertiser.length + 1, nT = L.dicts.theme.length + 1, airings = new Map();
    for (let k = 0; k < dated.length; k++) { const i = dated[k], p = sc.pkey(i); let s = airings.get(p); if (!s) airings.set(p, (s = new Set())); s.add(C.date[i]); }
    const g = new Map();
    for (let k = 0; k < rows.length; k++) {
      const i = rows[k], p = sc.pkey(i), key = (p * nA + C.advertiser[i]) * nT + (C.theme[i] + 1); let a = g.get(key);
      if (!a) g.set(key, (a = { i0: i, p, kind: sc.kinds[C.theme[i]], spots: 0, spend: 0, days: new Set(), dur: [0, 0, 0, 0, 0, 0, 0], short: 0, secs: 0, timed: 0, first: 0, last: 0, mid: 0, unk: 0, dmin: Infinity, dmax: -Infinity }));
      const d = C.date[i], dur = C.dur[i], pos = C.posinbrk[i], ads = C.adsinbrk[i];
      a.spots++; a.spend += C.cost[i]; a.days.add(d); if (d < a.dmin) a.dmin = d; if (d > a.dmax) a.dmax = d;
      a.dur[durIdx(dur) + 1]++; if (dur > 0) { a.secs += dur; a.timed++; if (dur <= maxDur) a.short++; }
      if (!(pos >= 1 && ads >= 1)) a.unk++; else if (pos === 1) a.first++; else if (pos === ads && ads > 1) a.last++; else a.mid++;
    }
    const nm = (col, c) => (c >= 0 ? L.dicts[col][c] : 'UNKNOWN');
    return [...g.values()].map((a) => {
      const i = a.i0, days = a.days.size, air = (airings.get(a.p) || a.days).size, daily = a.spots / days, shortDaily = a.short / days;
      const hf = daily > minDaily || shortDaily >= minDaily;
      const consistent = a.kind > 0 && days >= Math.min(CONSISTENT_DAYS, air) && days / air >= CONSISTENT_SHARE;
      const types = [...(a.kind ? [consistent ? EX : SPN] : []), ...(hf ? [HF] : [])];
      return { channel: nm('channel', C.channel[i]), program: nm('program', C.program[i]), advertiser: nm('advertiser', C.advertiser[i]), product: nm('product', C.product[i]), theme: nm('theme', C.theme[i]),
        item: itemLabel(nm('theme', C.theme[i]), a.kind), types: types.length ? types : ['Regular'], sponsorship: a.kind > 0, exclusive: consistent, frequency: hf,
        spots: a.spots, spend: a.spend, days, airings: air, presence_pct: pct(days, air), daily_avg: daily, short_daily: shortDaily, length: a.timed ? a.secs / a.timed : null,
        dur_split: Object.fromEntries(DUR.map((n, k) => [n, a.dur[k + 1]])), placement: { first: a.first, last: a.last, middle: a.mid, unknown: a.unk },
        first_seen: isoFromDay(a.dmin), last_seen: isoFromDay(a.dmax) };
    });
  }
  const rankClass = (r) => (r.exclusive ? 0 : r.sponsorship ? 1 : r.frequency ? 2 : 3);
  const sortClass = (a, b) => rankClass(a) - rankClass(b) || (b.frequency - a.frequency) || b.spots - a.spots;

  /** Drill-down for a set of rows: commercial details, ratings and volume, sponsorship details and the classified ads. */
  function detail(L, rows, sc, groups) {
    const C = L.cols, a = acc(); for (let k = 0; k < rows.length; k++) { const i = rows[k]; add(a, L, i, sc.kinds[C.theme[i]], sc.isSpecial(i)); }
    const o = money(a);
    const com = MR.where(L, rows, (i) => !sc.kinds[C.theme[i]]);
    const days = new Map(); for (let k = 0; k < rows.length; k++) { const d = C.date[rows[k]]; days.set(d, (days.get(d) || 0) + 1); }
    const peak = [...days.entries()].sort((x, y) => y[1] - x[1])[0];
    const cls = groups.filter((r) => r.sponsorship || r.frequency).sort(sortClass);
    const sum = (f, fn) => cls.filter(f).reduce((s, r) => s + fn(r), 0);
    return {
      commercial: { spots: o.commercial_spots, spend: o.commercial_spend, special_spots: o.special_spots, by_duration: split(L, com, null, (i) => durName(L, i)).sort(byDurOrder), by_daypart: split(L, com, 'daypart').slice(0, 8), by_advertiser: split(L, com, 'advertiser').slice(0, 10) },
      volume: { spots: o.spots, active_days: days.size, spots_per_day: days.size ? o.spots / days.size : null, peak_day: peak ? { date: isoFromDay(peak[0]), spots: peak[1] } : null,
        avg_clutter: o.avg_clutter, fib_pct: o.fib_pct, bumper_pct: o.bumper_pct, avg_dur: o.avg_dur, first_seen: o.first_seen, last_seen: o.last_seen, ratings: ratings(L, rows) },
      sponsorship: { items: o.sponsor_items, spend: o.sponsor_spend, billboards: o.billboard_items, logos: o.logo_items },
      classification: { exclusive_ads: cls.filter((r) => r.exclusive).length, exclusive_spots: sum((r) => r.exclusive, (r) => r.spots), sponsorship_ads: cls.filter((r) => r.sponsorship && !r.exclusive).length,
        sponsorship_spots: sum((r) => r.sponsorship && !r.exclusive, (r) => r.spots), frequency_ads: cls.filter((r) => r.frequency).length, frequency_spots: sum((r) => r.frequency, (r) => r.spots) },
      classified: cls.slice(0, 40),
    };
  }

  /** opts: {advertisers, channels, date_from, date_to, min_daily, max_dur, details, max_detail_channels, max_detail_programmes} */
  function executiveSummary(L, idx, opts = {}) {
    const C = L.cols, { dated, rows } = select(L, idx, opts);
    const sel = { advertisers: opts.advertisers || [], channels: opts.channels || [], date_from: opts.date_from || null, date_to: opts.date_to || null };
    const rank = (r, col) => { const m = new Map(); for (let k = 0; k < r.length; k++) { const i = r[k]; m.set(C[col][i], (m.get(C[col][i]) || 0) + C.cost[i]); } return [...m.entries()].filter((e) => e[0] >= 0).sort((a, b) => b[1] - a[1]).map((e) => L.dicts[col][e[0]]); };
    const chs = codes(L, 'channel', opts.channels), inCh = chs.size ? MR.where(L, dated, (i) => chs.has(C.channel[i])) : dated;
    const options = { channels: rank(dated, 'channel'), advertisers: rank(inCh, 'advertiser').slice(0, 1000) };
    const [lo0, hi0] = idx.length ? MR.minMax(C.date, idx) : [NaN, NaN];
    const bounds = [Number.isFinite(lo0) ? isoFromDay(lo0) : null, Number.isFinite(hi0) ? isoFromDay(hi0) : null];
    if (!rows.length) return { empty: true, selection: sel, options, bounds };
    const sc = scan(L, dated);
    const groups = classify(L, rows, dated, sc, opts);
    const minDaily = +opts.min_daily > 0 ? +opts.min_daily : 10, maxDur = +opts.max_dur > 0 ? +opts.max_dur : 10;
    const tot = acc(); for (let k = 0; k < rows.length; k++) { const i = rows[k]; add(tot, L, i, sc.kinds[C.theme[i]], sc.isSpecial(i)); }
    const T = money(tot);
    const hfg = groups.filter((r) => r.frequency), exg = groups.filter((r) => r.exclusive);
    const overall = { ...T, brands: new Set(Array.from(rows, (i) => C.advertiser[i])).size, products: new Set(Array.from(rows, (i) => C.product[i])).size,
      channels: new Set(Array.from(rows, (i) => C.channel[i])).size, programmes: new Set(Array.from(rows, (i) => C.channel[i] * 1e6 + C.program[i])).size,
      commercial_share: pct(T.commercial_spend, T.spend), value_add_share: pct(T.value_add_spend, T.spend), ratings: ratings(L, rows),
      frequency_ads: hfg.length, frequency_spots: hfg.reduce((s, r) => s + r.spots, 0), exclusive_ads: exg.length, exclusive_spots: exg.reduce((s, r) => s + r.spots, 0), exclusive_spend: exg.reduce((s, r) => s + r.spend, 0) };
    const languages = split(L, rows, 'lng'), media = split(L, rows, null, (i) => rowMedium(L, i));
    const durations = split(L, rows, null, (i) => durName(L, i)).sort(byDurOrder), brands = split(L, rows, 'advertiser').slice(0, 15);
    // section 2
    const byCh = new Map(); for (let k = 0; k < rows.length; k++) { const i = rows[k]; let a = byCh.get(C.channel[i]); if (!a) byCh.set(C.channel[i], (a = { acc: acc(), rows: [] })); add(a.acc, L, i, sc.kinds[C.theme[i]], sc.isSpecial(i)); a.rows.push(i); }
    const channels = [...byCh.entries()].map(([c, a]) => { const o = money(a.acc), name = L.dicts.channel[c];
      return { channel: name, medium: rowMedium(L, a.rows[0]), commercial_spend: o.commercial_spend, value_add_spend: o.value_add_spend, spend: o.spend, commercial_spots: o.commercial_spots, value_add_items: o.value_add_items, spots: o.spots,
        sow_pct: pct(o.spend, T.spend), spots_per_day: o.active_days ? o.spots / o.active_days : null, avg_clutter: o.avg_clutter, fib_pct: o.fib_pct,
        frequency_ads: groups.filter((r) => r.channel === name && r.frequency).length, exclusive_ads: groups.filter((r) => r.channel === name && r.exclusive).length, ratings: ratings(L, Int32Array.from(a.rows)) }; })
      .sort((a, b) => b.spend - a.spend).map((x, k) => ({ rank: k + 1, ...x }));
    // section 3
    const nP = L.dicts.program.length + 1, byP = new Map();
    for (let k = 0; k < rows.length; k++) { const i = rows[k], key = C.channel[i] * nP + C.program[i] + 1; let a = byP.get(key);
      if (!a) byP.set(key, (a = { ch: C.channel[i], pg: C.program[i], acc: acc(), days: new Set() })); add(a.acc, L, i, sc.kinds[C.theme[i]], sc.isSpecial(i)); a.days.add(C.date[i]); }
    const programmes = [...byP.values()].map((a) => { const o = money(a.acc), ch = L.dicts.channel[a.ch], pg = a.pg >= 0 ? L.dicts.program[a.pg] : 'UNKNOWN';
      const gs = groups.filter((r) => r.channel === ch && r.program === pg), ex = gs.filter((r) => r.exclusive), hf = gs.filter((r) => r.frequency), sp = gs.filter((r) => r.sponsorship);
      const names = (arr, f) => [...new Set(arr.map(f))];
      return { channel: ch, program: pg, sponsored: sp.length > 0, exclusive_ads: ex.length, exclusive_spots: ex.reduce((s, r) => s + r.spots, 0), frequency_ads: hf.length, frequency_spots: hf.reduce((s, r) => s + r.spots, 0),
        sponsors: names(sp, (r) => r.advertiser).map((adv) => ({ advertiser: adv, items: sp.filter((r) => r.advertiser === adv).reduce((s, r) => s + r.spots, 0), exclusive: sp.some((r) => r.advertiser === adv && r.exclusive) })).sort((x, y) => y.items - x.items),
        frequency_advertisers: names(hf, (r) => r.advertiser),
        value_add_items: o.value_add_items, value_add_spend: o.value_add_spend, commercial_spots: o.commercial_spots, commercial_spend: o.commercial_spend, spots: o.spots, spend: o.spend,
        airing_days: a.days.size, spots_per_airing: a.days.size ? o.spots / a.days.size : null }; })
      .sort((a, b) => (b.exclusive_ads > 0) - (a.exclusive_ads > 0) || (b.sponsored - a.sponsored) || (b.frequency_ads > 0) - (a.frequency_ads > 0) || b.value_add_spend - a.value_add_spend || b.spend - a.spend);
    const [lo, hi] = MR.minMax(C.date, rows);
    const res = { empty: false, items_counted: MR.SPONSOR_THEMES.filter((k) => MR.sponsorEnabled(k)).map((k) => MR.sponsorLabel(k)), selection: sel, options, bounds, period: [isoFromDay(lo), isoFromDay(hi)], range: [opts.date_from || bounds[0], opts.date_to || bounds[1]], has_ratings: !!C.grp,
      rule: { min_daily: minDaily, max_dur: maxDur, consistent_share: CONSISTENT_SHARE * 100, consistent_days: CONSISTENT_DAYS }, labels: { frequency: HF, exclusive: EX, sponsorship: SPN },
      overall, languages, media, durations, brands, channels, programmes: programmes.slice(0, 80), n_programmes: programmes.length, sponsored_programmes: programmes.filter((p) => p.sponsored).length,
      classified: groups.filter((r) => r.sponsorship || r.frequency).sort(sortClass).slice(0, 150), n_classified: groups.filter((r) => r.sponsorship || r.frequency).length };
    if (opts.details) {
      const sub = (channel, program) => { const ch = L.dicts.channel.indexOf(channel), pg = program == null ? -2 : L.dicts.program.indexOf(program);
        return detail(L, MR.where(L, rows, (i) => C.channel[i] === ch && (pg === -2 || C.program[i] === pg)), sc, groups.filter((r) => r.channel === channel && (program == null || r.program === program))); };
      res.channel_details = channels.slice(0, opts.max_detail_channels || 10).map((c) => ({ channel: c.channel, ...sub(c.channel, null) }));
      res.programme_details = programmes.slice(0, opts.max_detail_programmes || 12).map((p) => ({ channel: p.channel, program: p.program, ...sub(p.channel, p.program) }));
    }
    return res;
  }
  /** One drill-down, for a click: opts as executiveSummary plus {channel, program}. */
  function executiveDetail(L, idx, opts = {}) {
    const C = L.cols, { dated, rows } = select(L, idx, opts);
    if (!rows.length) return { empty: true };
    const sc = scan(L, dated), groups = classify(L, rows, dated, sc, opts);
    const ch = L.dicts.channel.indexOf(opts.channel), pg = opts.program ? L.dicts.program.indexOf(opts.program) : -2;
    const subRows = MR.where(L, rows, (i) => C.channel[i] === ch && (pg === -2 || C.program[i] === pg));
    if (!subRows.length) return { empty: true };
    return { empty: false, channel: opts.channel, program: opts.program || null, ...detail(L, subRows, sc, groups.filter((r) => r.channel === opts.channel && (!opts.program || r.program === opts.program))) };
  }
  Object.assign(MR, { executiveSummary, executiveDetail, mediumOf: medium, EXEC_LABELS: { HF, EX, SPN } });
})(typeof self !== 'undefined' ? self : globalThis);
