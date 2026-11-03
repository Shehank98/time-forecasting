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
  const dayName = (d) => { const s = isoFromDay(d); return `${+s.slice(8, 10)} ${MON[+s.slice(5, 7) - 1]} ${s.slice(0, 4)}`; };
  const monthKey = (mi) => `${Math.floor(mi / 12)}-${String((mi % 12) + 1).padStart(2, '0')}`;
  const themeItem = (theme, kind) => (kind ? (MR.sponsorItem(theme) || 'Sponsorship item') : 'Spot');

  const ordinal = (k) => `Year ${k + 1}`;
  const CONSISTENT = 0.5;                         // share of the programme's airing days
  const STEADY_CV = 0.15;
  const FREQ_ITEMS = { tag: 'Tag', 'com break': 'Com Break', 'time check': 'Time Check' };   // frequency sponsorships, never programme sponsorship                         // monthly sponsorship value varying by 15% or less is "steady"
  const RANK = { all: 0, started: 1, stopped: 1, some: 1, single: 2, occasional: 3, none: 4 };

  /** opts: {channel, program, advertiser, mode ('data'|'calendar'), show ('sponsor'|'all'), limit, lite (advertiser list only: no per-row months, themes or rows)} */
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
    // Frequency sponsorships are bought on the channel, not in a programme: Tag, Com Break and Time Check items, and any ad that is
    // max_dur seconds or shorter and averages min_daily or more spots a day on the channel. They are kept out of programme sponsorship.
    const fq = MR.frequencyGroups(L, idx, opts);
    const freqTheme = L.dicts.theme.map((t) => { const k = MR.sponsorKey(t); return FREQ_ITEMS[k] || null; });
    const isFreq = (i) => freqTheme[C.theme[i]] !== null || fq.groups.get(fq.key(i)).frequency;
    const kinds = sc.kinds.map((k, c) => (freqTheme[c] ? 0 : k));                // programme sponsorship kinds only
    const chCode = opts.channel ? L.dicts.channel.indexOf(opts.channel) : -2, pgCode = opts.program ? L.dicts.program.indexOf(opts.program) : -2, adCode = opts.advertiser ? L.dicts.advertiser.indexOf(opts.advertiser) : -2;
    // ---- picker lists, each narrowed by the choice above it (always from the whole upload)
    const nm = (col, c) => (c >= 0 ? L.dicts[col][c] : 'UNKNOWN');
    const inCh = chCode === -2 ? idx : MR.where(L, idx, (i) => C.channel[i] === chCode);
    const chSpend = new Map(); for (let k = 0; k < idx.length; k++) { const i = idx[k]; chSpend.set(C.channel[i], (chSpend.get(C.channel[i]) || 0) + C.cost[i]); }
    const nP = L.dicts.program.length + 1, pgs = new Map();
    for (let k = 0; k < inCh.length; k++) { const i = inCh[k], key = C.channel[i] * nP + C.program[i] + 1; let a = pgs.get(key); if (!a) pgs.set(key, (a = { ch: C.channel[i], pg: C.program[i], spend: 0, sp: 0 })); a.spend += C.cost[i]; if (kinds[C.theme[i]] && !isFreq(i)) a.sp += C.cost[i]; }
    const inPg = pgCode === -2 ? inCh : MR.where(L, inCh, (i) => C.program[i] === pgCode);
    const advs = new Map(); for (let k = 0; k < inPg.length; k++) { const i = inPg[k]; let a = advs.get(C.advertiser[i]); if (!a) advs.set(C.advertiser[i], (a = { spend: 0, sp: 0 })); a.spend += C.cost[i]; if (kinds[C.theme[i]] && !isFreq(i)) a.sp += C.cost[i]; }
    const options = {
      channels: [...chSpend.entries()].sort((a, b) => b[1] - a[1]).map((e) => nm('channel', e[0])),
      programmes: [...pgs.values()].sort((a, b) => (b.sp > 0) - (a.sp > 0) || b.spend - a.spend).slice(0, 1500).map((a) => ({ channel: nm('channel', a.ch), program: nm('program', a.pg), sponsored: a.sp > 0, spend: a.spend })),
      advertisers: [...advs.entries()].sort((a, b) => (b[1].sp > 0) - (a[1].sp > 0) || b[1].spend - a[1].spend).slice(0, 1000).map((e) => ({ advertiser: nm('advertiser', e[0]), sponsored: e[1].sp > 0, spend: e[1].spend })),
    };
    if (chCode === -1 || pgCode === -1 || adCode === -1) return { ...empty({ options }), periods, bounds: [isoFromDay(lo), isoFromDay(hi)] };

    // ---- groups: advertiser x programme
    const rows = MR.where(L, inPg, (i) => adCode === -2 || C.advertiser[i] === adCode), nA = L.dicts.advertiser.length + 1, g = new Map();
    const primeCodes = new Set(L.dicts.daypart.map((n, c) => ((MR.cfg && MR.cfg.prime) || ['Prime']).includes(n) ? c : -1).filter((c) => c >= 0));
    for (let k = 0; k < rows.length; k++) {
      if (isFreq(rows[k])) continue;                                   // frequency items have their own section
      const i = rows[k], p = sc.pkey(i), key = p * nA + C.advertiser[i], d = C.date[i], mi = mIdx(d), per = periodOf(mi), kind = kinds[C.theme[i]];
      let a = g.get(key);
      if (!a) g.set(key, (a = { p, ch: C.channel[i], pg: C.program[i], adv: C.advertiser[i], per: Array.from({ length: nPer }, () => ({ spots: 0, sp: 0, spend: 0, sp_spend: 0, days: new Set(), spdays: new Set(), spFirst: Infinity, spLast: -Infinity })), themes: new Map(), months: new Map(), products: new Map(), dmin: Infinity, dmax: -Infinity, sp: 0,
        pt: { va_pt: 0, va_pt_v: 0, va_npt: 0, va_npt_v: 0, com_pt: 0, com_pt_v: 0, com_npt: 0, com_npt_v: 0 } }));
      const cost = C.cost[i], prime = primeCodes.has(C.daypart[i]);
      const q = a.per[per]; q.spots++; q.spend += cost; q.days.add(d); if (kind) { q.sp++; q.sp_spend += cost; q.spdays.add(d); a.sp++; if (d < q.spFirst) q.spFirst = d; if (d > q.spLast) q.spLast = d; }
      a.pt[(kind ? 'va_' : 'com_') + (prime ? 'pt' : 'npt')]++; a.pt[(kind ? 'va_' : 'com_') + (prime ? 'pt_v' : 'npt_v')] += cost;
      if (d < a.dmin) a.dmin = d; if (d > a.dmax) a.dmax = d;
      const mo = a.months.get(mi) || { sp: 0, reg: 0, sp_v: 0, reg_v: 0, sp_pt: 0 }; if (kind) { mo.sp++; mo.sp_v += cost; if (prime) mo.sp_pt++; } else { mo.reg++; mo.reg_v += cost; } a.months.set(mi, mo);
      let t = a.themes.get(C.theme[i]); if (!t) a.themes.set(C.theme[i], (t = { kind, per: Array(nPer).fill(0), spots: 0, spend: 0, pt: 0, dmin: Infinity, dmax: -Infinity }));
      t.per[per]++; t.spots++; t.spend += cost; if (prime) t.pt++; if (d < t.dmin) t.dmin = d; if (d > t.dmax) t.dmax = d;
      a.products.set(C.product[i], (a.products.get(C.product[i]) || 0) + C.cost[i]);
    }
    const keep = [...g.values()].filter((a) => (opts.show === 'all' ? true : a.sp > 0));
    // programme airing days per period (any advertiser), only for the programmes we show
    const wanted = new Set(keep.map((a) => a.p)), air = new Map();
    for (let k = 0; k < inPg.length; k++) { const i = inPg[k], p = sc.pkey(i); if (!wanted.has(p)) continue; let a = air.get(p); if (!a) air.set(p, (a = Array.from({ length: nPer }, () => new Set()))); a[periodOf(mIdx(C.date[i]))].add(C.date[i]); }

    const out = keep.map((a) => {
      const A = air.get(a.p) || Array.from({ length: nPer }, () => new Set());
      const per = a.per.map((q, p) => ({ ...periods[p], airing_days: A[p].size, days_sponsored: 0, days_present: q.days.size, total_ads: q.spots, sponsorship_ads: q.sp, other_ads: q.spots - q.sp,
        spend: q.spend, sponsorship_spend: q.sp_spend, commercial_spend: q.spend - q.sp_spend, sponsored_start: q.sp ? isoFromDay(q.spFirst) : null, sponsored_end: q.sp ? isoFromDay(q.spLast) : null, ads_per_airing: A[p].size ? q.spots / A[p].size : null, sponsored: q.sp > 0, aired: A[p].size > 0 }));
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
        const m = a.months.get(mi) || { sp: 0, reg: 0, sp_v: 0, reg_v: 0, sp_pt: 0 }; months.push({ month: monthKey(mi), label: monthName(mi), sponsorship_ads: m.sp, other_ads: m.reg, sponsorship_value: m.sp_v, commercial_value: m.reg_v, sponsorship_prime_ads: m.sp_pt, sponsorship_other_time_ads: m.sp - m.sp_pt, period: periodOf(mi) });
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
      const themes = opts.lite ? [] : [...a.themes.entries()].map(([t, v]) => ({ theme: nm('theme', t), item: themeItem(nm('theme', t), v.kind), sponsorship: v.kind > 0, per_period: v.per, spots: v.spots, spend: v.spend, prime_ads: v.pt, other_time_ads: v.spots - v.pt, first_seen: isoFromDay(v.dmin), last_seen: isoFromDay(v.dmax) }))
        .sort((x, y) => (y.sponsorship - x.sponsorship) || y.spots - x.spots).slice(0, 15);
      // does the sponsorship cost about the same every month? A flat monthly value usually means a fixed sponsorship package.
      // The first and last sponsored months are often part months, so they are left out when there are 5 or more.
      const spm = months.filter((m) => m.sponsorship_ads > 0), used = spm.length >= 5 ? spm.slice(1, -1) : spm;
      const stat = (vs) => { const mean = vs.reduce((x, y) => x + y, 0) / vs.length, sd = Math.sqrt(vs.reduce((x, y) => x + (y - mean) ** 2, 0) / vs.length); return { mean, sd, cv: sd / mean, dev: Math.max(...vs.map((v) => Math.abs(v - mean))) / mean, min: Math.min(...vs), max: Math.max(...vs) }; };
      const lkr = (v) => 'LKR ' + Math.round(v).toLocaleString('en-US');
      let pattern = null;
      if (used.length >= 3) {
        const all = stat(used.map((m) => m.sponsorship_value)), steady = all.cv <= STEADY_CV;
        const byPeriod = periods.map((pd) => { const vs = used.filter((m) => m.period === pd.index).map((m) => m.sponsorship_value); if (!vs.length) return null; const st = stat(vs); return { label: pd.label, months: vs.length, mean: st.mean, cv_pct: st.cv * 100, steady: vs.length >= 3 && st.cv <= STEADY_CV }; }).filter(Boolean);
        const judged = byPeriod.filter((x) => x.months >= 3), eachYear = !steady && judged.length >= 2 && judged.every((x) => x.steady);
        let text;
        if (steady) text = `Steady sponsorship value: about ${lkr(all.mean)} every month (within ${Math.round(all.dev * 100)}% across ${used.length} months). A flat monthly value usually means a fixed sponsorship package.`;
        else if (eachYear) {
          const f = judged[0], l = judged[judged.length - 1], ch = ((l.mean - f.mean) / f.mean) * 100;
          text = `Steady within each year, but the monthly value changed between years: ${judged.map((x) => `${x.label} about ${lkr(x.mean)} a month`).join(', ')} (${Math.abs(Math.round(ch))}% ${ch >= 0 ? 'higher' : 'lower'} in ${l.label}). Each year looks like a fixed package, with a different package in the later year.`;
        } else text = `Sponsorship value changes from month to month (${lkr(all.min)} to ${lkr(all.max)}, average ${lkr(all.mean)}), so these look like items bought as needed rather than a fixed package.`;
        pattern = { months: used.length, mean: all.mean, min: all.min, max: all.max, cv_pct: all.cv * 100, max_dev_pct: all.dev * 100, steady, steady_each_year: eachYear, by_period: byPeriod, text };
      }
      const pt = a.pt, vaAds = pt.va_pt + pt.va_npt, ptShare = vaAds ? pt.va_pt / vaAds : null;
      const timeMix = !vaAds ? null : ptShare >= 0.9 ? 'Prime time' : ptShare <= 0.1 ? 'Non-prime time' : 'Prime and non-prime';
      const primeSplit = { sponsorship: { prime_ads: pt.va_pt, prime_value: pt.va_pt_v, other_ads: pt.va_npt, other_value: pt.va_npt_v }, commercial: { prime_ads: pt.com_pt, prime_value: pt.com_pt_v, other_ads: pt.com_npt, other_value: pt.com_npt_v },
        prime_share_pct: ptShare == null ? null : ptShare * 100, time_mix: timeMix };
      const headline = spAds ? `${advName} sponsored ${pgTitle} on ${chTitle} for ${span} month${span === 1 ? '' : 's'} (${sFirst.label} to ${sLast.label}): ${spAds.toLocaleString('en-US')} sponsorship ad${spAds === 1 ? '' : 's'} and ${(totalAds - spAds).toLocaleString('en-US')} other ad${totalAds - spAds === 1 ? '' : 's'}, ${totalAds.toLocaleString('en-US')} in total. ${status}.`
        : `${advName} ran ${totalAds.toLocaleString('en-US')} ad${totalAds === 1 ? '' : 's'} in ${pgTitle} on ${chTitle} (${first} to ${last}), with no sponsorship items.`;
      return { advertiser: advName, channel: chName, program: pgName, products: prods.slice(0, 3), status, status_code: code, first_seen: first, last_seen: last, sponsored_from: sFirst ? sFirst.label : null, sponsored_to: sLast ? sLast.label : null,
        months_span: span, months_with_sponsorship: spMonths.length, years_sponsored: consIdx.length, years_with_items: spon.length, years_aired: aired.length, periods: per, total_ads: totalAds, sponsorship_ads: spAds, other_ads: totalAds - spAds, spend: sumK('spend'), sponsorship_spend: sumK('sponsorship_spend'),
        airing_days: airDays, days_present: present, days_sponsored: sumK('days_sponsored'), presence_pct: pct(sumK('days_sponsored'), airDays), sponsored_first: per.map((x) => x.sponsored_start).filter(Boolean).sort()[0] || null, sponsored_last: per.map((x) => x.sponsored_end).filter(Boolean).sort().slice(-1)[0] || null, gaps: realGaps, months, themes, pattern, prime: primeSplit, time_mix: timeMix, headline };
    }).sort((x, y) => RANK[x.status_code] - RANK[y.status_code] || y.sponsorship_ads - x.sponsorship_ads || y.months_span - x.months_span);
    // ---- frequency sponsorships by advertiser x channel
    const fRows = MR.where(L, inCh, (i) => (adCode === -2 || C.advertiser[i] === adCode) && isFreq(i)), nC = L.dicts.channel.length + 1, fg = new Map();
    for (let k = 0; k < fRows.length; k++) {
      const i = fRows[k], key = C.advertiser[i] * nC + C.channel[i], d = C.date[i], mi = mIdx(d), type = freqTheme[C.theme[i]] || 'Short spots', cost = C.cost[i];
      let a = fg.get(key);
      if (!a) fg.set(key, (a = { adv: C.advertiser[i], ch: C.channel[i], ads: 0, value: 0, types: {}, days: new Set(), months: new Map(), themes: new Map(), per: Array.from({ length: nPer }, () => ({ ads: 0, first: Infinity, last: -Infinity })), dmin: Infinity, dmax: -Infinity }));
      a.ads++; a.value += cost; a.types[type] = (a.types[type] || 0) + 1; a.days.add(d); if (d < a.dmin) a.dmin = d; if (d > a.dmax) a.dmax = d;
      const q = a.per[periodOf(mi)]; q.ads++; if (d < q.first) q.first = d; if (d > q.last) q.last = d;
      const m = a.months.get(mi) || { Tag: 0, 'Com Break': 0, 'Time Check': 0, 'Short spots': 0, value: 0 }; m[type]++; m.value += cost; a.months.set(mi, m);
      let t = a.themes.get(C.theme[i]); if (!t) a.themes.set(C.theme[i], (t = { type, ads: 0, value: 0, days: new Set(), secs: 0, timed: 0, dmin: Infinity, dmax: -Infinity }));
      t.ads++; t.value += cost; t.days.add(d); if (C.dur[i] > 0) { t.secs += C.dur[i]; t.timed++; } if (d < t.dmin) t.dmin = d; if (d > t.dmax) t.dmax = d;
    }
    const fOut = [...fg.values()].map((a) => {
      const adv = nm('advertiser', a.adv), ch = nm('channel', a.ch), ty = (k) => a.types[k] || 0, daily = a.ads / a.days.size;
      const base = { advertiser: adv, channel: ch, ads: a.ads, value: a.value, tag: ty('Tag'), com_break: ty('Com Break'), time_check: ty('Time Check'), short_spots: ty('Short spots'), days: a.days.size, daily_avg: daily,
        first_seen: isoFromDay(a.dmin), last_seen: isoFromDay(a.dmax), periods: a.per.map((q, p) => ({ label: periods[p].label, range: periods[p].range, ads: q.ads, start: q.ads ? isoFromDay(q.first) : null, end: q.ads ? isoFromDay(q.last) : null })) };
      if (opts.lite) return base;
      const mF = Math.min(...a.months.keys()), mL = Math.max(...a.months.keys()), months = [];
      for (let mi = mF; mi <= mL; mi++) { const m = a.months.get(mi) || { Tag: 0, 'Com Break': 0, 'Time Check': 0, 'Short spots': 0, value: 0 };
        months.push({ month: monthKey(mi), label: monthName(mi), period: periodOf(mi), tag: m.Tag, com_break: m['Com Break'], time_check: m['Time Check'], short_spots: m['Short spots'], total: m.Tag + m['Com Break'] + m['Time Check'] + m['Short spots'], value: m.value }); }
      const themes = [...a.themes.entries()].map(([tc, t]) => ({ theme: nm('theme', tc), type: t.type, ads: t.ads, value: t.value, days: t.days.size, daily_avg: t.ads / t.days.size, length: t.timed ? t.secs / t.timed : null, first_seen: isoFromDay(t.dmin), last_seen: isoFromDay(t.dmax) }))
        .sort((x, y) => y.ads - x.ads).slice(0, 12);
      const parts = [['Tag', base.tag], ['Com Break', base.com_break], ['Time Check', base.time_check], [`short spots (${fq.max_dur}s and under, ${fq.min_daily}+ a day)`, base.short_spots]].filter((x) => x[1]).map(([n, v]) => `${v.toLocaleString('en-US')} ${n}`);
      const headline = `${adv} ran ${a.ads.toLocaleString('en-US')} frequency ads on ${MR.title(ch)} from ${dayName(a.dmin)} to ${dayName(a.dmax)}: ${parts.join(', ')}. About ${daily.toFixed(1)} a day on the ${a.days.size.toLocaleString('en-US')} days they ran.`;
      return { ...base, months, themes, headline };
    }).sort((x, y) => y.ads - x.ads);
    const frequency = { rule: { min_daily: fq.min_daily, max_dur: fq.max_dur, items: Object.values(FREQ_ITEMS) }, rows: opts.lite ? [] : fOut.slice(0, 200), n_rows: fOut.length,
      totals: { ads: fOut.reduce((s2, r) => s2 + r.ads, 0), value: fOut.reduce((s2, r) => s2 + r.value, 0), advertisers: new Set(fOut.map((r) => r.advertiser)).size, channels: new Set(fOut.map((r) => r.channel)).size } };
    // advertisers who only buy frequency still belong in the advertiser list
    const fBy = new Map(); fOut.forEach((r) => { const x = fBy.get(r.advertiser) || { ads: 0, channels: new Set() }; x.ads += r.ads; x.channels.add(r.channel); fBy.set(r.advertiser, x); });
    const bySum = new Map();
    out.forEach((r) => { let a = bySum.get(r.advertiser); if (!a) bySum.set(r.advertiser, (a = { advertiser: r.advertiser, programmes: 0, channels: new Set(), consistent: 0, all_years: 0, occasional: 0, sponsorship_ads: 0, total_ads: 0, spend: 0 }));
      a.programmes++; a.channels.add(r.channel); a.sponsorship_ads += r.sponsorship_ads; a.total_ads += r.total_ads; a.spend += r.spend;
      if (r.status_code === 'all') a.all_years++; if (['all', 'started', 'stopped', 'some', 'single'].includes(r.status_code)) a.consistent++; if (r.status_code === 'occasional') a.occasional++; });
    for (const [adv, x] of fBy) if (!bySum.has(adv)) bySum.set(adv, { advertiser: adv, programmes: 0, channels: new Set(), consistent: 0, all_years: 0, occasional: 0, sponsorship_ads: 0, total_ads: 0, spend: 0 });
    const advertiserSummary = [...bySum.values()].map((a) => ({ ...a, channels: a.channels.size, frequency_ads: (fBy.get(a.advertiser) || { ads: 0 }).ads, frequency_channels: (fBy.get(a.advertiser) || { channels: new Set() }).channels.size })).sort((x, y) => y.all_years - x.all_years || y.consistent - x.consistent || y.sponsorship_ads - x.sponsorship_ads || y.frequency_ads - x.frequency_ads).slice(0, 400);
    // the channels (and how many programmes) the chosen advertiser sponsors, ignoring the channel filter so they can all be listed
    let advertiserChannels = [];
    if (adCode >= 0) {
      const m = new Map();
      for (let k = 0; k < idx.length; k++) { const i = idx[k]; if (C.advertiser[i] !== adCode || isFreq(i)) continue; const ch = C.channel[i]; let a = m.get(ch); if (!a) m.set(ch, (a = { progs: new Set(), sp: new Set(), ads: 0, spAds: 0 }));
        a.progs.add(C.program[i]); a.ads++; if (kinds[C.theme[i]]) { a.sp.add(C.program[i]); a.spAds++; } }
      advertiserChannels = [...m.entries()].map(([ch, a]) => ({ channel: nm('channel', ch), programmes: opts.show === 'all' ? a.progs.size : a.sp.size, ads: a.ads, sponsorship_ads: a.spAds })).filter((x) => x.programmes > 0).sort((x, y) => y.sponsorship_ads - x.sponsorship_ads || y.ads - x.ads);
    }
    const lim = opts.lite ? 0 : (opts.limit || 500);
    return { empty: !out.length && !fOut.length, frequency, advertiser_summary: advertiserSummary, advertiser_channels: advertiserChannels, mode, periods, bounds: [isoFromDay(lo), isoFromDay(hi)], data_months: miMax - miMin + 1, options, rows: out.slice(0, lim), n_rows: out.length,
      totals: { rows: out.length, all_years: out.filter((r) => r.status_code === 'all').length, advertisers: new Set(out.map((r) => r.advertiser)).size, programmes: new Set(out.map((r) => r.channel + '|' + r.program)).size,
        total_ads: out.reduce((s, r) => s + r.total_ads, 0), sponsorship_ads: out.reduce((s, r) => s + r.sponsorship_ads, 0) },
      selection: { channel: opts.channel || null, program: opts.program || null, advertiser: opts.advertiser || null, show: opts.show || 'sponsor' } };
  }
  Object.assign(MR, { sponsorshipTenure });
})(typeof self !== 'undefined' ? self : globalThis);
