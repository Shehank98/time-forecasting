/* Programme & Sponsorship Spotlight: who sponsors which programme, how many spots they run in it, and how well those spots are placed.
 * Runs in the worker and in Node tests.
 *
 * Spot classes inside a programme:
 *  - Sponsorship item: theme is a sponsorship item (MR.isSponsorTheme). Billboard kind = -BB, -Intro, -Extro, Com Break, Next Card.
 *    Logo kind = -LLogo, Tag, Time Check, DJ, -Tr.
 *  - Special placement: not a sponsorship theme, but 60 seconds or longer and costing 3x or more the programme's median spot.
 *  - Regular spot: everything else.
 * Brand role in a programme (channel + programme, judged on all spot lengths):
 *  - Title Sponsor: has billboard items and the largest sponsorship spend in the programme, with at least 25% of it.
 *  - Co-Sponsor: has billboard items but is not the title sponsor.
 *  - Logo Placement: only logo kind items.
 *  - Regular Spot: no sponsorship items.
 */
(function (root) {
  const MR = root.MR;
  const { isoFromDay } = MR;
  const BILLBOARD = ['-bb', 'com break', '-extro', '-intro', 'next card'];
  const DUR = ['5s', '10s', '15s', '20s', '30s', '30s+'];
  const durIdx = (d) => (!(d > 0) ? -1 : d <= 7 ? 0 : d <= 12 ? 1 : d <= 17 ? 2 : d <= 25 ? 3 : d <= 30 ? 4 : 5);
  const DUR_FILTER = { all: () => true, 5: (d) => durIdx(d) === 0, 10: (d) => durIdx(d) === 1, le10: (d) => d > 0 && d <= 12, 15: (d) => durIdx(d) === 2, 20: (d) => durIdx(d) === 3, 30: (d) => durIdx(d) === 4, '30p': (d) => durIdx(d) === 5 };
  const ROLES = ['Title Sponsor', 'Co-Sponsor', 'Logo Placement', 'Regular Spot'];
  const pct = (a, b) => (b > 0 ? (a / b) * 100 : null);
  const median = (a) => { if (!a.length) return null; const s = Float64Array.from(a).sort(), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const { weekStart, monthStart } = MR;

  /** Per theme code: 0 = not sponsorship, 1 = billboard kind, 2 = logo kind. */
  function themeKinds(L) {
    return L.dicts.theme.map((t) => {
      if (!MR.isSponsorTheme(t)) return 0;
      const x = String(t).trim().toLowerCase();
      return BILLBOARD.some((k) => x === k || (k[0] === '-' && x.endsWith(k))) ? 1 : 2;
    });
  }

  function acc() { return { spend: 0, spots: 0, sp_spend: 0, sp_items: 0, bb: 0, logo: 0, special: 0, special_spend: 0, reg_spend: 0, reg_spots: 0, secs: 0, c_secs: 0, c_spend: 0, clutSum: 0, clutN: 0, posSum: 0, posN: 0, first: 0, last: 0, both: 0, dur: [0, 0, 0, 0, 0, 0, 0], days: new Set(), dmin: Infinity, dmax: -Infinity }; }
  function add(a, L, i, kind, special) {
    const C = L.cols, cost = C.cost[i], dur = C.dur[i], ads = C.adsinbrk[i], pos = C.posinbrk[i], d = C.date[i];
    a.spend += cost; a.spots++; if (dur > 0) a.secs += dur;
    if (!kind && dur > 0) { a.c_secs += dur; a.c_spend += cost; }
    if (kind) { a.sp_spend += cost; a.sp_items++; if (kind === 1) a.bb++; else a.logo++; } else if (special) { a.special++; a.special_spend += cost; } else { a.reg_spend += cost; a.reg_spots++; }
    a.dur[durIdx(dur) + 1]++;
    a.days.add(d); if (d < a.dmin) a.dmin = d; if (d > a.dmax) a.dmax = d;
    if (ads > 0) { a.clutSum += ads; a.clutN++; }
    if (pos >= 1) { a.posSum += pos; a.posN++; if (pos === 1) a.first++; }
    if (pos >= 1 && ads >= 1) { a.both++; if (pos === ads && ads > 1) a.last++; }
  }
  function out(a) {
    const timed = a.spots - a.dur[0];
    return { spend: a.spend, spots: a.spots, sponsor_spend: a.sp_spend, sponsor_items: a.sp_items, billboard_items: a.bb, logo_items: a.logo, special_spots: a.special, special_spend: a.special_spend,
      regular_spend: a.reg_spend, regular_spots: a.reg_spots, avg_clutter: a.clutN ? a.clutSum / a.clutN : null, avg_pos: a.posN ? a.posSum / a.posN : null,
      fib_pct: a.posN ? (a.first / a.posN) * 100 : null, bumper_pct: a.both ? ((a.first + a.last) / a.both) * 100 : null,
      cps: a.secs > 0 ? a.spend / a.secs : null, commercial_cps: a.c_secs > 0 ? a.c_spend / a.c_secs : null, cost_per_spot: a.spots ? a.spend / a.spots : null, avg_dur: timed > 0 ? a.secs / timed : null,
      dur_split: Object.fromEntries(DUR.map((n, k) => [n, a.dur[k + 1]])), dur_unknown: a.dur[0], active_days: a.days.size,
      first_seen: Number.isFinite(a.dmin) ? isoFromDay(a.dmin) : null, last_seen: Number.isFinite(a.dmax) ? isoFromDay(a.dmax) : null };
  }

  /** Shared pass: programme groups (channel x programme), the median spot cost of each, and the role of every brand in each. */
  function scan(L, idx) {
    const C = L.cols, nP = L.dicts.program.length + 1, kinds = themeKinds(L);
    const pkey = (i) => C.channel[i] * nP + (C.program[i] + 1);
    const costs = new Map();
    for (let k = 0; k < idx.length; k++) { const i = idx[k]; if (kinds[C.theme[i]] > 0) continue; const p = pkey(i); let a = costs.get(p); if (!a) costs.set(p, (a = [])); a.push(C.cost[i]); }
    const med = new Map(); for (const [p, a] of costs) med.set(p, median(a));
    const isSpecial = (i) => { const m = med.get(pkey(i)); return !(kinds[C.theme[i]] > 0) && C.dur[i] >= 60 && m > 0 && C.cost[i] >= 3 * m; };
    // brand sponsorship per programme, for roles
    const sp = new Map();
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k], kd = kinds[C.theme[i]]; if (!kd) continue;
      const p = pkey(i); let m = sp.get(p); if (!m) sp.set(p, (m = new Map()));
      let b = m.get(C.advertiser[i]); if (!b) m.set(C.advertiser[i], (b = { spend: 0, bb: 0, logo: 0 }));
      b.spend += C.cost[i]; if (kd === 1) b.bb++; else b.logo++;
    }
    const roles = new Map();
    for (const [p, m] of sp) {
      const tot = [...m.values()].reduce((s, b) => s + b.spend, 0);
      let best = null; for (const [a, b] of m) if (b.bb > 0 && (!best || b.spend > m.get(best).spend)) best = a;
      const r = new Map();
      for (const [a, b] of m) r.set(a, b.bb > 0 ? (a === best && b.spend >= 0.25 * tot ? 0 : 1) : 2);
      roles.set(p, r);
    }
    const roleOf = (p, adv) => { const r = roles.get(p); return r && r.has(adv) ? r.get(adv) : 3; };
    return { kinds, pkey, nP, isSpecial, roleOf, med };
  }

  /** Programme list for the picker: one entry per channel x programme, plus programme names across channels. */
  function spotlightIndex(L, idx) {
    const C = L.cols, sc = scan(L, idx), by = new Map();
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k], p = sc.pkey(i); let a = by.get(p);
      if (!a) by.set(p, (a = { ch: C.channel[i], pg: C.program[i], spend: 0, spots: 0, sp: 0, advs: new Set(), days: new Set() }));
      a.spend += C.cost[i]; a.spots++; if (sc.kinds[C.theme[i]]) a.sp += C.cost[i]; a.advs.add(C.advertiser[i]); a.days.add(C.date[i]);
    }
    const nm = (col, c) => (c >= 0 ? L.dicts[col][c] : 'UNKNOWN');
    const list = [...by.values()].map((a) => ({ channel: nm('channel', a.ch), program: nm('program', a.pg), spend: a.spend, spots: a.spots, sponsor_spend: a.sp, brands: a.advs.size, episodes: a.days.size }))
      .sort((a, b) => b.spend - a.spend);
    const names = new Map(); list.forEach((x) => { const n = names.get(x.program) || { program: x.program, channels: [], spend: 0, spots: 0, sponsor_spend: 0 }; n.channels.push(x.channel); n.spend += x.spend; n.spots += x.spots; n.sponsor_spend += x.sponsor_spend; names.set(x.program, n); });
    return { programmes: list.slice(0, 600), names: [...names.values()].filter((n) => n.channels.length > 1).sort((a, b) => b.spend - a.spend).slice(0, 200), total: list.length };
  }

  const periodOf = (gran) => (gran === 'month' ? monthStart : gran === 'week' ? weekStart : (d) => d);
  const periodLabel = (gran, d) => (gran === 'month' ? isoFromDay(d).slice(0, 7) : isoFromDay(d));

  /**
   * opts: {program, channel (null = every channel airing it), brand, gran ('day'|'week'|'month'|'auto'), clutter_threshold}
   */
  function programmeSpotlight(L, idx, opts = {}) {
    const C = L.cols, sc = scan(L, idx);
    const pg = L.dicts.program.indexOf(opts.program), ch = opts.channel ? L.dicts.channel.indexOf(opts.channel) : -2;
    const rows = pg < 0 || ch === -1 ? [] : MR.where(L, idx, (i) => C.program[i] === pg && (ch === -2 || C.channel[i] === ch));
    if (!rows.length) return { empty: true, program: opts.program || null, channel: opts.channel || null };
    const tot = acc(), byAdv = new Map(), roleBest = new Map();
    for (let k = 0; k < rows.length; k++) {
      const i = rows[k], a = C.advertiser[i]; let b = byAdv.get(a); if (!b) byAdv.set(a, (b = { acc: acc(), prod: new Map() }));
      const kd = sc.kinds[C.theme[i]], spc = sc.isSpecial(i);
      add(tot, L, i, kd, spc); add(b.acc, L, i, kd, spc); b.prod.set(C.product[i], (b.prod.get(C.product[i]) || 0) + C.cost[i]);
      const r = sc.roleOf(sc.pkey(i), a); roleBest.set(a, Math.min(roleBest.has(a) ? roleBest.get(a) : 3, r));
    }
    const T = out(tot);
    const brands = [...byAdv.entries()].map(([a, b]) => { const o = out(b.acc); const prod = [...b.prod.entries()].sort((x, y) => y[1] - x[1]);
      return { name: L.dicts.advertiser[a], products: prod.slice(0, 3).map((p) => L.dicts.product[p[0]]), role: ROLES[roleBest.get(a)], ...o, sov_spend: pct(o.spend, T.spend), sov_spots: pct(o.spots, T.spots), share_of_sponsorship: pct(o.sponsor_spend, T.sponsor_spend) }; })
      .sort((x, y) => (ROLES.indexOf(x.role) - ROLES.indexOf(y.role)) || y.sponsor_spend - x.sponsor_spend || y.spend - x.spend);
    const byspend = brands.slice().sort((x, y) => y.spend - x.spend);
    const focusName = opts.brand && byAdv.has(L.dicts.advertiser.indexOf(opts.brand)) ? opts.brand : (brands.find((b) => b.role === 'Title Sponsor') || byspend[0]).name;
    const fa = L.dicts.advertiser.indexOf(focusName);
    const [lo, hi] = MR.minMax(C.date, rows), span = hi - lo + 1;
    const gran = opts.gran && opts.gran !== 'auto' ? opts.gran : T.active_days > 90 || span > 180 ? (span > 540 ? 'month' : 'week') : 'day';
    const per = periodOf(gran);
    // timeline: one point per airing period (days with no airing are skipped for daily, so episodes line up)
    const tl = new Map(), fper = new Map();
    for (let k = 0; k < rows.length; k++) {
      const i = rows[k], p = per(C.date[i]); let t = tl.get(p); if (!t) tl.set(p, (t = { spots: 0, focus: 0, focus_sp: 0, clut: 0, clutN: 0, days: new Set() }));
      t.spots++; t.days.add(C.date[i]); if (C.adsinbrk[i] > 0) { t.clut += C.adsinbrk[i]; t.clutN++; }
      if (C.advertiser[i] === fa) { t.focus++; if (sc.kinds[C.theme[i]]) t.focus_sp++; let f = fper.get(p); if (!f) fper.set(p, (f = acc())); add(f, L, i, sc.kinds[C.theme[i]], sc.isSpecial(i)); }
    }
    const keys = [...tl.keys()].sort((a, b) => a - b);
    const perDay = keys.map((p) => tl.get(p).spots / Math.max(1, tl.get(p).days.size)), mdn = median(perDay) || 0;
    const peaks = keys.map((p, j) => j).filter((j) => keys.length >= 5 && perDay[j] >= 1.5 * mdn && perDay[j] >= mdn + 3);
    const timeline = { gran, labels: keys.map((p) => periodLabel(gran, p)), spots: keys.map((p) => tl.get(p).spots), focus_spots: keys.map((p) => tl.get(p).focus), focus_sponsor: keys.map((p) => tl.get(p).focus_sp),
      airings: keys.map((p) => tl.get(p).days.size), spots_per_airing: perDay, avg_clutter: keys.map((p) => (tl.get(p).clutN ? tl.get(p).clut / tl.get(p).clutN : null)), peaks, median_per_airing: mdn };
    const fb = brands.find((b) => b.name === focusName);
    const fperiods = [...fper.entries()].sort((a, b) => a[0] - b[0]).map(([p, a]) => ({ period: periodLabel(gran, p), ...out(a) }));
    // break position distribution of the focus brand
    const dist = { first: 0, early: 0, middle: 0, last: 0 };
    for (let k = 0; k < rows.length; k++) { const i = rows[k]; if (C.advertiser[i] !== fa) continue; const pos = C.posinbrk[i], ads = C.adsinbrk[i]; if (!(pos >= 1 && ads >= 1)) continue;
      if (pos === 1) dist.first++; else if (pos === ads) dist.last++; else if (pos <= 3) dist.early++; else dist.middle++; }
    const chans = [...new Set(Array.from(rows, (i) => C.channel[i]))].map((c) => L.dicts.channel[c]);
    const res = { empty: false, program: opts.program, channel: opts.channel || null, channels: chans, period: [isoFromDay(lo), isoFromDay(hi)], gran,
      totals: { ...T, brands: byAdv.size, episodes: T.active_days, sponsors: brands.filter((b) => b.sponsor_items > 0).length },
      brands: brands.slice(0, 40), focus: { ...fb, periods: fperiods, position: dist }, timeline };
    res.brief = brief(res, opts.clutter_threshold || 35);
    return res;
  }

  const lkr = (v) => 'LKR ' + Math.round(v).toLocaleString('en-US');
  const f1 = (v) => (v == null ? 'n/a' : (Math.round(v * 10) / 10).toString());
  const f0 = (v) => (v == null ? 'n/a' : Math.round(v).toString());
  function periodWords(a, b) {
    const m0 = a.slice(0, 7), m1 = b.slice(0, 7), nm = (m) => new Date(m + '-01T00:00:00Z').toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
    return m0 === m1 ? `in ${nm(m0)}` : `from ${a} to ${b}`;
  }
  /** Plain talking points for media buyers. */
  function brief(r, thr) {
    const pts = [], f = r.focus, prog = MR.title ? MR.title(r.program) : r.program, when = periodWords(f.first_seen || r.period[0], f.last_seen || r.period[1]);
    const lead = f.role === 'Title Sponsor' ? `holds the primary sponsorship for ${prog}` : f.role === 'Co-Sponsor' ? `is a co-sponsor of ${prog}` : f.role === 'Logo Placement' ? `runs logo placements in ${prog}` : `buys regular spots in ${prog}`;
    const fib = f.fib_pct, clut = f.avg_clutter;
    let pos = '';
    if (fib != null) pos = fib >= 25 ? ` Out of these, ${f0(fib)}% were positioned as First-in-Break, maximizing recall despite an average break clutter of ${f1(clut)} spots.`
      : ` Only ${f0(fib)}% were positioned as First-in-Break, so recall is at risk in an average break of ${f1(clut)} spots.`;
    pts.push({ kind: 'lead', text: `${f.name} ${lead} with a total investment of ${lkr(f.spend)} and ${f.spots.toLocaleString('en-US')} spots ${when}.${pos}` });
    if (f.sponsor_items) pts.push({ kind: 'split', text: `${f0(pct(f.sponsor_spend, f.spend))}% of ${f.name}'s money in this programme went on ${f.sponsor_items} sponsorship items (${f.billboard_items} billboards, ${f.logo_items} logo items) and ${f0(pct(f.regular_spend, f.spend))}% on ${f.regular_spots} regular spots.` });
    pts.push({ kind: 'sov', text: `${f.name} has ${f0(f.sov_spend)}% of the money and ${f0(f.sov_spots)}% of the spots in this programme block, among ${r.totals.brands} advertisers.` });
    const rivals = r.brands.filter((b) => b.name !== f.name && b.sponsor_items > 0).slice(0, 2);
    if (rivals.length) pts.push({ kind: 'rivals', text: `Other sponsors here: ${rivals.map((b) => `${b.name} (${b.role}, ${lkr(b.sponsor_spend)} on sponsorship)`).join('; ')}.` });
    const tl = r.timeline;
    if (tl.peaks.length) { const top = tl.peaks.slice().sort((a, b) => tl.spots_per_airing[b] - tl.spots_per_airing[a]).slice(0, 3);
      pts.push({ kind: 'peaks', text: `Ad density jumps on ${top.map((j) => tl.labels[j]).join(', ')}: up to ${f0(tl.spots_per_airing[top[0]])} spots per airing against a usual ${f0(tl.median_per_airing)}. These look like key episodes (finales, eviction nights); book them early.` }); }
    if (clut != null && clut > thr) pts.push({ kind: 'clutter', text: `Average break clutter is ${f1(clut)}, above ${thr}: ask for bonus spots or guaranteed first-in-break for the sponsor.` });
    const short = (f.dur_split['5s'] || 0) + (f.dur_split['10s'] || 0);
    if (f.spots && short / f.spots >= 0.4) pts.push({ kind: 'short', text: `${f0(short / f.spots * 100)}% of ${f.name}'s spots here are 10 seconds or shorter: a high-frequency reminder pattern.` });
    return pts;
  }

  /* ---------------- Short-form and sponsorship matrix ---------------- */
  function health(o, progMedCps, thr) {
    const clutter = o.avg_clutter == null ? 20 : 40 * Math.max(0, Math.min(1, (thr - o.avg_clutter) / Math.max(1, thr - 5)));
    const position = o.bumper_pct == null ? 17.5 : 35 * Math.max(0, Math.min(1, o.bumper_pct / 50));
    const index = o.commercial_cps && progMedCps ? o.commercial_cps / progMedCps : null;
    const price = index == null ? 12.5 : 25 * Math.max(0, Math.min(1, 1.5 - index));
    const score = Math.round(clutter + position + price);
    return { score, band: score >= 65 ? 'good' : score >= 40 ? 'fair' : 'poor', label: score >= 65 ? 'High value' : score >= 40 ? 'Fair' : 'High clutter / low impact', price_index: index,
      parts: { clutter: Math.round(clutter), position: Math.round(position), price: Math.round(price) } };
  }

  /**
   * opts: {dur ('all','5','10','le10','15','20','30','30p'), channel, tag (a role), search, clutter_threshold, limit}
   * Roles come from all spot lengths; the numbers in each row use only the chosen spot lengths.
   */
  function shortFormMatrix(L, idx, opts = {}) {
    const C = L.cols, sc = scan(L, idx), thr = +opts.clutter_threshold > 0 ? +opts.clutter_threshold : 35;
    const durOk = DUR_FILTER[opts.dur || 'all'] || DUR_FILTER.all, chf = opts.channel ? L.dicts.channel.indexOf(opts.channel) : -2;
    const q = String(opts.search || '').trim().toUpperCase();
    const by = new Map(), nA = L.dicts.advertiser.length + 1;
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k]; if (!durOk(C.dur[i]) || (chf !== -2 && C.channel[i] !== chf)) continue;
      const p = sc.pkey(i), kd = sc.kinds[C.theme[i]];
      const key = p * nA + C.advertiser[i]; let a = by.get(key);
      if (!a) by.set(key, (a = { p, ch: C.channel[i], pg: C.program[i], adv: C.advertiser[i], acc: acc(), prod: new Map() }));
      add(a.acc, L, i, kd, sc.isSpecial(i)); a.prod.set(C.product[i], (a.prod.get(C.product[i]) || 0) + C.cost[i]);
    }
    // programme going rate: median of the brands' commercial price per second inside the programme (chosen lengths only)
    const cpsList = new Map();
    for (const a of by.values()) { const o = a.acc; if (o.c_secs > 0) { let l = cpsList.get(a.p); if (!l) cpsList.set(a.p, (l = [])); l.push(o.c_spend / o.c_secs); } }
    const progMed = new Map(); for (const [p, l] of cpsList) progMed.set(p, median(l));
    const counts = Object.fromEntries(ROLES.map((r) => [r, 0]));
    let rows = [];
    for (const a of by.values()) {
      const role = ROLES[sc.roleOf(a.p, a.adv)];
      counts[role]++;
      if (opts.tag && opts.tag !== role) continue;
      const chn = L.dicts.channel[a.ch], pgn = a.pg >= 0 ? L.dicts.program[a.pg] : 'UNKNOWN', adn = L.dicts.advertiser[a.adv];
      const prods = [...a.prod.entries()].sort((x, y) => y[1] - x[1]).map((x) => L.dicts.product[x[0]]);
      if (q && !(`${chn} ${pgn} ${adn} ${prods.join(' ')}`.toUpperCase().includes(q))) continue;
      const o = out(a.acc), months = new Set([...a.acc.days].map((d) => isoFromDay(d).slice(0, 7))).size;
      rows.push({ channel: chn, program: pgn, advertiser: adn, product: prods[0] || null, products: prods.slice(0, 4), role, ...o,
        per_day: o.active_days ? o.spots / o.active_days : null, per_month: months ? o.spots / months : null, months,
        short_pct: pct(o.dur_split['5s'] + o.dur_split['10s'], o.spots), programme_cps: progMed.get(a.p) || null, health: health(o, progMed.get(a.p), thr) });
    }
    rows.sort((x, y) => y.spend - x.spend);
    const n = rows.length, lim = opts.limit || 400;
    const tot = rows.reduce((s, r) => { s.spend += r.spend; s.spots += r.spots; s.sponsor_items += r.sponsor_items; s.short += r.dur_split['5s'] + r.dur_split['10s']; return s; }, { spend: 0, spots: 0, sponsor_items: 0, short: 0 });
    const bands = { good: 0, fair: 0, poor: 0 }; rows.forEach((r) => bands[r.health.band]++);
    const channels = [...new Set(Array.from(idx, (i) => C.channel[i]))].map((c) => L.dicts.channel[c]).sort();
    return { rows: rows.slice(0, lim), n_rows: n, totals: { ...tot, short_pct: pct(tot.short, tot.spots), pairs: n, health: bands }, roles: counts, channels, durations: DUR, clutter_threshold: thr, filters: { dur: opts.dur || 'all', channel: opts.channel || null, tag: opts.tag || null, search: opts.search || '' } };
  }

  /** Detail for one programme x brand row: spots and spend per airing day, price against the programme, themes and lengths. */
  function shortFormRow(L, idx, opts = {}) {
    const C = L.cols, sc = scan(L, idx), durOk = DUR_FILTER[opts.dur || 'all'] || DUR_FILTER.all;
    const ch = L.dicts.channel.indexOf(opts.channel), pg = L.dicts.program.indexOf(opts.program), ad = L.dicts.advertiser.indexOf(opts.advertiser);
    if (ch < 0 || ad < 0) return { empty: true };
    const prog = MR.where(L, idx, (i) => C.channel[i] === ch && C.program[i] === pg && durOk(C.dur[i]));
    const rows = MR.where(L, prog, (i) => C.advertiser[i] === ad);
    if (!rows.length) return { empty: true };
    const days = new Map(), progDays = new Map(), themes = new Map(), a = acc(), all = acc();
    for (let k = 0; k < prog.length; k++) { const i = prog[k]; add(all, L, i, sc.kinds[C.theme[i]], sc.isSpecial(i)); progDays.set(C.date[i], (progDays.get(C.date[i]) || 0) + 1); }
    for (let k = 0; k < rows.length; k++) {
      const i = rows[k], d = C.date[i]; let x = days.get(d); if (!x) days.set(d, (x = { spots: 0, spend: 0, sponsor: 0 }));
      x.spots++; x.spend += C.cost[i]; if (sc.kinds[C.theme[i]]) x.sponsor++;
      add(a, L, i, sc.kinds[C.theme[i]], sc.isSpecial(i));
      const t = C.theme[i]; const th = themes.get(t) || { spots: 0, spend: 0, kind: sc.kinds[t] }; th.spots++; th.spend += C.cost[i]; themes.set(t, th);
    }
    const ks = [...progDays.keys()].sort((x, y) => x - y);
    const o = out(a), po = out(all);
    return { empty: false, ...o, programme: { spots: po.spots, cps: po.commercial_cps, cost_per_spot: po.cost_per_spot, avg_clutter: po.avg_clutter, fib_pct: po.fib_pct, airings: ks.length },
      price_index: o.commercial_cps && po.commercial_cps ? o.commercial_cps / po.commercial_cps : null, spot_cost_index: o.cost_per_spot && po.cost_per_spot ? o.cost_per_spot / po.cost_per_spot : null,
      daily: ks.map((d) => ({ date: isoFromDay(d), spots: (days.get(d) || {}).spots || 0, spend: (days.get(d) || {}).spend || 0, sponsor: (days.get(d) || {}).sponsor || 0, programme_spots: progDays.get(d) })),
      themes: [...themes.entries()].sort((x, y) => y[1].spend - x[1].spend).slice(0, 8).map(([t, v]) => ({ theme: L.dicts.theme[t], spots: v.spots, spend: v.spend, type: v.kind === 1 ? 'Billboard' : v.kind === 2 ? 'Logo / tag' : 'Spot' })) };
  }

  Object.assign(MR, { spotlightIndex, programmeSpotlight, shortFormMatrix, shortFormRow, SPOTLIGHT_ROLES: ROLES, SPOTLIGHT_DUR: DUR, spotlightThemeKinds: themeKinds });
})(typeof self !== 'undefined' ? self : globalThis);
