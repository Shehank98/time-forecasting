/* Sponsorship over time: for each advertiser x channel x programme, how long the sponsorship ran across the uploaded data,
 * the ads in every year period, which ads (themes) ran, and the months in between. Runs in the worker and in Node tests.
 *
 * Year periods:
 *  - 'data' (default): 12-month blocks counted from the first month of the uploaded data (Year 1, Year 2 ...), so a 2-year
 *    upload gives exactly two like-for-like years.
 *  - 'calendar': one period per calendar year (the first and last may be partial).
 * A row has sponsorship when the advertiser has at least one sponsorship item (billboard, logo, intro, outro, tag ...) in the programme. A YEAR counts as
 * sponsored only when those items were on at least half of the programme's airing days that year; fewer than that is "occasional".
 * "Airing days" are the days the programme aired (any advertiser), so "days sponsored of airing days" is a fair share.
 */
(function (root) {
  const MR = root.MR;
  const { isoFromDay } = MR;
  const { scan, pct } = MR._spot;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthName = (mi) => `${MON[mi % 12]} ${Math.floor(mi / 12)}`;
  const monthKey = (mi) => `${Math.floor(mi / 12)}-${String((mi % 12) + 1).padStart(2, '0')}`;
  const themeItem = (theme, kind) => {
    if (!kind) return 'Spot';
    const t = String(theme).toLowerCase();
    return /outro|extro/.test(t) ? 'Outro' : /intro/.test(t) ? 'Intro' : /logo/.test(t) ? 'Logo' : /time check/.test(t) ? 'Time check' : /(^|[\s-])tag$/.test(t) ? 'Tag' : /(^|[\s-])dj$/.test(t) ? 'DJ'
      : /-bb$|com break|next card/.test(t) ? 'Billboard' : 'Sponsorship item';
  };
  const ordinal = (k) => `Year ${k + 1}`;
  const CONSISTENT = 0.5;                         // share of the programme's airing days
  const RANK = { all: 0, started: 1, stopped: 1, some: 1, single: 2, occasional: 3, none: 4 };

  /** opts: {channel, program, advertiser, mode ('data'|'calendar'), show ('sponsor'|'all'), limit} */
  function sponsorshipTenure(L, idx, opts = {}) {
    const C = L.cols, mode = opts.mode === 'calendar' ? 'calendar' : 'data', sc = scan(L, idx);
    const memo = new Map(), mIdx = (d) => { let v = memo.get(d); if (v === undefined) { const s = isoFromDay(d); v = +s.slice(0, 4) * 12 + (+s.slice(5, 7) - 1); memo.set(d, v); } return v; };
    const empty = (extra) => ({ empty: true, mode, periods: [], rows: [], options: { channels: [], programmes: [], advertisers: [] }, ...extra });
    if (!idx.length) return empty({});
    const [lo, hi] = MR.minMax(C.date, idx), miMin = mIdx(lo), miMax = mIdx(hi);
    const periodOf = mode === 'calendar' ? (mi) => Math.floor(mi / 12) - Math.floor(miMin / 12) : (mi) => Math.floor((mi - miMin) / 12);
    const nPer = periodOf(miMax) + 1;
    const periods = Array.from({ length: nPer }, (_, p) => {
      const a = mode === 'calendar' ? Math.max(miMin, (Math.floor(miMin / 12) + p) * 12) : miMin + 12 * p, b = Math.min(miMax, mode === 'calendar' ? (Math.floor(miMin / 12) + p) * 12 + 11 : miMin + 12 * p + 11);
      return { index: p, label: mode === 'calendar' ? String(Math.floor(miMin / 12) + p) : ordinal(p), from: monthName(a), to: monthName(b), months: b - a + 1, range: `${monthName(a)} to ${monthName(b)}` };
    });
    const chCode = opts.channel ? L.dicts.channel.indexOf(opts.channel) : -2, pgCode = opts.program ? L.dicts.program.indexOf(opts.program) : -2, adCode = opts.advertiser ? L.dicts.advertiser.indexOf(opts.advertiser) : -2;
    // ---- picker lists, each narrowed by the choice above it (always from the whole upload)
    const nm = (col, c) => (c >= 0 ? L.dicts[col][c] : 'UNKNOWN');
    const inCh = chCode === -2 ? idx : MR.where(L, idx, (i) => C.channel[i] === chCode);
    const chSpend = new Map(); for (let k = 0; k < idx.length; k++) { const i = idx[k]; chSpend.set(C.channel[i], (chSpend.get(C.channel[i]) || 0) + C.cost[i]); }
    const nP = L.dicts.program.length + 1, pgs = new Map();
    for (let k = 0; k < inCh.length; k++) { const i = inCh[k], key = C.channel[i] * nP + C.program[i] + 1; let a = pgs.get(key); if (!a) pgs.set(key, (a = { ch: C.channel[i], pg: C.program[i], spend: 0, sp: 0 })); a.spend += C.cost[i]; if (sc.kinds[C.theme[i]]) a.sp += C.cost[i]; }
    const inPg = pgCode === -2 ? inCh : MR.where(L, inCh, (i) => C.program[i] === pgCode);
    const advs = new Map(); for (let k = 0; k < inPg.length; k++) { const i = inPg[k]; let a = advs.get(C.advertiser[i]); if (!a) advs.set(C.advertiser[i], (a = { spend: 0, sp: 0 })); a.spend += C.cost[i]; if (sc.kinds[C.theme[i]]) a.sp += C.cost[i]; }
    const options = {
      channels: [...chSpend.entries()].sort((a, b) => b[1] - a[1]).map((e) => nm('channel', e[0])),
      programmes: [...pgs.values()].sort((a, b) => (b.sp > 0) - (a.sp > 0) || b.spend - a.spend).slice(0, 1500).map((a) => ({ channel: nm('channel', a.ch), program: nm('program', a.pg), sponsored: a.sp > 0, spend: a.spend })),
      advertisers: [...advs.entries()].sort((a, b) => (b[1].sp > 0) - (a[1].sp > 0) || b[1].spend - a[1].spend).slice(0, 1000).map((e) => ({ advertiser: nm('advertiser', e[0]), sponsored: e[1].sp > 0, spend: e[1].spend })),
    };
    if (chCode === -1 || pgCode === -1 || adCode === -1) return { ...empty({ options }), periods, bounds: [isoFromDay(lo), isoFromDay(hi)] };

    // ---- groups: advertiser x programme
    const rows = MR.where(L, inPg, (i) => adCode === -2 || C.advertiser[i] === adCode), nA = L.dicts.advertiser.length + 1, g = new Map();
    for (let k = 0; k < rows.length; k++) {
      const i = rows[k], p = sc.pkey(i), key = p * nA + C.advertiser[i], d = C.date[i], mi = mIdx(d), per = periodOf(mi), kind = sc.kinds[C.theme[i]];
      let a = g.get(key);
      if (!a) g.set(key, (a = { p, ch: C.channel[i], pg: C.program[i], adv: C.advertiser[i], per: Array.from({ length: nPer }, () => ({ spots: 0, sp: 0, spend: 0, sp_spend: 0, days: new Set(), spdays: new Set() })), themes: new Map(), months: new Map(), products: new Map(), dmin: Infinity, dmax: -Infinity, sp: 0 }));
      const q = a.per[per]; q.spots++; q.spend += C.cost[i]; q.days.add(d); if (kind) { q.sp++; q.sp_spend += C.cost[i]; q.spdays.add(d); a.sp++; }
      if (d < a.dmin) a.dmin = d; if (d > a.dmax) a.dmax = d;
      const mo = a.months.get(mi) || { sp: 0, reg: 0 }; if (kind) mo.sp++; else mo.reg++; a.months.set(mi, mo);
      let t = a.themes.get(C.theme[i]); if (!t) a.themes.set(C.theme[i], (t = { kind, per: Array(nPer).fill(0), spots: 0, spend: 0, dmin: Infinity, dmax: -Infinity }));
      t.per[per]++; t.spots++; t.spend += C.cost[i]; if (d < t.dmin) t.dmin = d; if (d > t.dmax) t.dmax = d;
      a.products.set(C.product[i], (a.products.get(C.product[i]) || 0) + C.cost[i]);
    }
    const keep = [...g.values()].filter((a) => (opts.show === 'all' ? true : a.sp > 0));
    // programme airing days per period (any advertiser), only for the programmes we show
    const wanted = new Set(keep.map((a) => a.p)), air = new Map();
    for (let k = 0; k < inPg.length; k++) { const i = inPg[k], p = sc.pkey(i); if (!wanted.has(p)) continue; let a = air.get(p); if (!a) air.set(p, (a = Array.from({ length: nPer }, () => new Set()))); a[periodOf(mIdx(C.date[i]))].add(C.date[i]); }

    const out = keep.map((a) => {
      const A = air.get(a.p) || Array.from({ length: nPer }, () => new Set());
      const per = a.per.map((q, p) => ({ ...periods[p], airing_days: A[p].size, days_sponsored: 0, days_present: q.days.size, total_ads: q.spots, sponsorship_ads: q.sp, other_ads: q.spots - q.sp,
        spend: q.spend, sponsorship_spend: q.sp_spend, ads_per_airing: A[p].size ? q.spots / A[p].size : null, sponsored: q.sp > 0, aired: A[p].size > 0 }));
      per.forEach((x, p) => { x.days_sponsored = a.per[p].spdays.size; });
      const aired = per.filter((x) => x.aired), spon = per.filter((x) => x.sponsored);
      // a year counts as sponsored when the sponsorship was on at least half of the programme's airing days that year; a few stray items are "occasional"
      per.forEach((x) => { x.consistent = x.aired && x.airing_days > 0 && x.days_sponsored / x.airing_days >= CONSISTENT; });
      const consIdx = per.filter((x) => x.consistent).map((x) => x.index), firstC = consIdx[0], lastC = consIdx[consIdx.length - 1];
      const firstAir = per.findIndex((x) => x.aired), lastAir = per.length - 1 - [...per].reverse().findIndex((x) => x.aired);
      const yrs = (n) => `${n} year${n === 1 ? '' : 's'}`;
      let status, code;
      if (!spon.length) { status = 'No sponsorship items'; code = 'none'; }
      else if (!consIdx.length) { status = `Occasional sponsorship items (${spon.length} of ${yrs(aired.length)})`; code = 'occasional'; }
      else if (aired.length >= 2 && consIdx.length === aired.length) { status = `Sponsored all ${aired.length} years`; code = 'all'; }
      else if (aired.length === 1) { status = 'Sponsored (programme seen in 1 year only)'; code = 'single'; }
      else if (firstC > firstAir && lastC === lastAir && consIdx.length === lastAir - firstC + 1) { status = `Started in ${per[firstC].label}`; code = 'started'; }
      else if (lastC < lastAir && firstC === firstAir && consIdx.length === lastC - firstC + 1) { status = `Stopped after ${per[lastC].label}`; code = 'stopped'; }
      else { status = `Sponsored in ${consIdx.length} of ${yrs(aired.length)}`; code = 'some'; }
      // months from the first to the last month with any ad, with zero-sponsorship stretches marked as gaps
      const mFirst = Math.min(...a.months.keys()), mLast = Math.max(...a.months.keys()), months = [], gaps = [];
      let run = null;
      for (let mi = mFirst; mi <= mLast; mi++) {
        const m = a.months.get(mi) || { sp: 0, reg: 0 }; months.push({ month: monthKey(mi), label: monthName(mi), sponsorship_ads: m.sp, other_ads: m.reg, period: periodOf(mi) });
        if (m.sp === 0 && a.sp > 0) { if (!run) run = { from: monthName(mi), to: monthName(mi), months: 0 }; run.to = monthName(mi); run.months++; } else if (run) { gaps.push(run); run = null; }
      }
      const spMonths = months.filter((m) => m.sponsorship_ads > 0);
      const firstSpM = months.findIndex((m) => m.sponsorship_ads > 0), lastSpM = months.length - 1 - [...months].reverse().findIndex((m) => m.sponsorship_ads > 0);
      const realGaps = gaps.filter((x) => { const f = months.findIndex((m) => m.label === x.from), t = months.findIndex((m) => m.label === x.to); return f > firstSpM && t < lastSpM; });
      const sFirst = spMonths.length ? spMonths[0] : null, sLast = spMonths.length ? spMonths[spMonths.length - 1] : null;
      const span = sFirst ? (() => { const [y0, m0] = sFirst.month.split('-').map(Number), [y1, m1] = sLast.month.split('-').map(Number); return (y1 - y0) * 12 + (m1 - m0) + 1; })() : 0;
      const first = isoFromDay(a.dmin), last = isoFromDay(a.dmax);
      const sumK = (k) => per.reduce((s, x) => s + x[k], 0);
      const totalAds = sumK('total_ads'), spAds = sumK('sponsorship_ads'), airDays = A.reduce((s, x) => s + x.size, 0), present = sumK('days_present');
      const prods = [...a.products.entries()].sort((x, y) => y[1] - x[1]).map((e) => L.dicts.product[e[0]]);
      const advName = nm('advertiser', a.adv), chName = nm('channel', a.ch), pgName = nm('program', a.pg), chTitle = MR.title(chName), pgTitle = MR.title(pgName);
      const themes = [...a.themes.entries()].map(([t, v]) => ({ theme: nm('theme', t), item: themeItem(nm('theme', t), v.kind), sponsorship: v.kind > 0, per_period: v.per, spots: v.spots, spend: v.spend, first_seen: isoFromDay(v.dmin), last_seen: isoFromDay(v.dmax) }))
        .sort((x, y) => (y.sponsorship - x.sponsorship) || y.spots - x.spots).slice(0, 15);
      const headline = spAds ? `${advName} sponsored ${pgTitle} on ${chTitle} for ${span} month${span === 1 ? '' : 's'} (${sFirst.label} to ${sLast.label}): ${spAds.toLocaleString('en-US')} sponsorship ad${spAds === 1 ? '' : 's'} and ${(totalAds - spAds).toLocaleString('en-US')} other ad${totalAds - spAds === 1 ? '' : 's'}, ${totalAds.toLocaleString('en-US')} in total. ${status}.`
        : `${advName} ran ${totalAds.toLocaleString('en-US')} ad${totalAds === 1 ? '' : 's'} in ${pgTitle} on ${chTitle} (${first} to ${last}), with no sponsorship items.`;
      return { advertiser: advName, channel: chName, program: pgName, products: prods.slice(0, 3), status, status_code: code, first_seen: first, last_seen: last, sponsored_from: sFirst ? sFirst.label : null, sponsored_to: sLast ? sLast.label : null,
        months_span: span, months_with_sponsorship: spMonths.length, years_sponsored: consIdx.length, years_with_items: spon.length, years_aired: aired.length, periods: per, total_ads: totalAds, sponsorship_ads: spAds, other_ads: totalAds - spAds, spend: sumK('spend'), sponsorship_spend: sumK('sponsorship_spend'),
        airing_days: airDays, days_present: present, days_sponsored: sumK('days_sponsored'), presence_pct: pct(sumK('days_sponsored'), airDays), gaps: realGaps, months, themes, headline };
    }).sort((x, y) => RANK[x.status_code] - RANK[y.status_code] || y.sponsorship_ads - x.sponsorship_ads || y.months_span - x.months_span);
    const lim = opts.limit || 300;
    return { empty: !out.length, mode, periods, bounds: [isoFromDay(lo), isoFromDay(hi)], data_months: miMax - miMin + 1, options, rows: out.slice(0, lim), n_rows: out.length,
      totals: { rows: out.length, all_years: out.filter((r) => r.status_code === 'all').length, advertisers: new Set(out.map((r) => r.advertiser)).size, programmes: new Set(out.map((r) => r.channel + '|' + r.program)).size,
        total_ads: out.reduce((s, r) => s + r.total_ads, 0), sponsorship_ads: out.reduce((s, r) => s + r.sponsorship_ads, 0) },
      selection: { channel: opts.channel || null, program: opts.program || null, advertiser: opts.advertiser || null, show: opts.show || 'sponsor' } };
  }
  Object.assign(MR, { sponsorshipTenure });
})(typeof self !== 'undefined' ? self : globalThis);
