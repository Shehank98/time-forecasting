/* Spend by year: one block per year, channels (TV channels, radio stations, press publications) down the side, months across the top,
 * with the spend split into Commercial only and VAL (value addition = sponsorship items). Runs in the worker and in Node tests.
 *
 *  - Medium comes from the channel name in the LMRB sheet: "TV - Sirasa TV" is TV, "Radio - Shakthi FM" is Radio, a name with neither prefix is
 *    counted as Press (and listed in `unprefixed` so it can be checked). The press sheet is Press.
 *  - VAL is the LMRB spend on the sponsorship items ticked in Settings (-BB, Com Break, DJ, -Extro, -Intro, -LLogo, Next Card, Tag, Time Check ...).
 *    Every press ad is commercial.
 */
(function (root) {
  const MR = root.MR;
  const { isoFromDay } = MR;
  const ORDER = ['TV', 'Radio', 'Press'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const codes = (T, col, names) => new Set((names || []).map((n) => T.dicts[col].indexOf(n)).filter((c) => c >= 0));
  /** Rows to count: when advertisers are picked, an advertiser that is not in this sheet at all means no rows from it (not every row). */
  const wanted = (T, names) => { if (!names || !names.length) return null; return codes(T, 'advertiser', names); };
  const add12 = (a, b) => { for (let m = 0; m < 12; m++) a[m] += b[m]; };

  /**
   * L: LMRB table with its row index, P: press table (or null) with its row index.
   * opts: {advertisers: [names]}
   */
  function mediaSpend(L, lidx, P, pidx, opts = {}) {
    const rows = new Map();                       // `${year}|${medium}|${name}` -> {year, medium, name, com: [12], val: [12]}
    const years = new Set(), unprefixed = new Map();
    const memo = new Map(), ym = (d) => { let v = memo.get(d); if (!v) { const s = isoFromDay(d); v = [+s.slice(0, 4), +s.slice(5, 7) - 1]; memo.set(d, v); } return v; };
    const get = (year, medium, name) => { const k = `${year}|${medium}|${name}`; let r = rows.get(k); if (!r) rows.set(k, (r = { year, medium, name, com: Array(12).fill(0), val: Array(12).fill(0) })); return r; };
    let noMedium = false;
    if (L && lidx && lidx.length) {
      const C = L.cols, ads = wanted(L, opts.advertisers), med = C.medium, flag = L.dicts.theme.map(MR.isSponsorTheme);
      noMedium = !med;
      for (let k = 0; k < lidx.length; k++) {
        const i = lidx[k]; if (ads && !ads.has(C.advertiser[i])) continue;
        const [y, m] = ym(C.date[i]), medium = med ? L.dicts.medium[med[i]] : 'TV', name = C.channel[i] >= 0 ? L.dicts.channel[C.channel[i]] : 'UNKNOWN';
        years.add(y);
        if (med && medium === 'Press') unprefixed.set(name, (unprefixed.get(name) || 0) + 1);
        const r = get(y, medium || 'TV', name), sp = C.theme[i] >= 0 && flag[C.theme[i]];
        (sp ? r.val : r.com)[m] += C.cost[i];
      }
    }
    if (P && pidx && pidx.length) {
      const C = P.cols, ads = wanted(P, opts.advertisers);
      for (let k = 0; k < pidx.length; k++) {
        const i = pidx[k]; if (ads && !ads.has(C.advertiser[i])) continue;
        const [y, m] = ym(C.date[i]); years.add(y);
        get(y, 'Press', P.dicts.publication[C.publication[i]]).com[m] += C.cost[i];     // all press is commercial
      }
    }
    const sum = (a) => a.reduce((x, y) => x + y, 0);
    const out = [...years].sort((a, b) => a - b).map((year) => {
      const yr = [...rows.values()].filter((r) => r.year === year);
      const block = (key) => {
        const list = yr.map((r) => ({ medium: r.medium, name: r.name, months: key === 'total' ? r.com.map((v, m) => v + r.val[m]) : r[key] })).filter((r) => sum(r.months) > 0);
        const rank = new Map(yr.map((r) => [`${r.medium}|${r.name}`, sum(r.com) + sum(r.val)]));
        list.sort((a, b) => ORDER.indexOf(a.medium) - ORDER.indexOf(b.medium) || rank.get(`${b.medium}|${b.name}`) - rank.get(`${a.medium}|${a.name}`) || (a.name < b.name ? -1 : 1));
        list.forEach((r) => { r.total = sum(r.months); });
        const media = ORDER.map((m) => { const x = list.filter((r) => r.medium === m), months = Array(12).fill(0); x.forEach((r) => add12(months, r.months)); return { medium: m, months, total: sum(months), channels: x.length }; });
        const grand = Array(12).fill(0); media.forEach((m) => add12(grand, m.months));
        return { rows: list, media, grand: { months: grand, total: sum(grand) } };
      };
      const commercial = block('com'), value_add = block('val'), total = block('total');
      return { year, commercial, value_add, total };
    });
    return { empty: !out.length, months: MONTHS, years: out, no_medium: noMedium, has_press: !!(P && P.n), unprefixed: [...unprefixed.entries()].sort((a, b) => b[1] - a[1]).map(([name, rows2]) => ({ name, rows: rows2 })),
      items_counted: MR.SPONSOR_THEMES.filter((k) => MR.sponsorEnabled(k)).map((k) => MR.sponsorLabel(k)), advertisers: opts.advertisers || [] };
  }

  /** Advertisers across both sheets, by spend. */
  function mediaSpendOptions(L, P) {
    const m = new Map();
    for (const T of [L, P]) { if (!T || !T.n) continue; const C = T.cols; for (let i = 0; i < T.n; i++) { const n = T.dicts.advertiser[C.advertiser[i]]; m.set(n, (m.get(n) || 0) + C.cost[i]); } }
    return { advertisers: [...m.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]) };
  }
  Object.assign(MR, { mediaSpend, mediaSpendOptions });
})(typeof self !== 'undefined' ? self : globalThis);
