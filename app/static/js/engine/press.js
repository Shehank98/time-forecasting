/* Press: summary of the press sheet and contract detection. Runs in the worker and in Node tests.
 *
 * Size is Col x CM (column centimetres). The sheet's Dur is that area, for example 3 col x 26 cm = 78.
 *
 * A contract is the same advertiser and product, in the same publication, at the same size, on the same weekday, run again and again:
 *  - Daily and weekly papers: the same weekday (every Tuesday). A run continues while the next insertion is at most 14 days after the
 *    last one (one missed week is allowed). The run is a contract when it has min_times or more insertion dates (default 4).
 *  - Monthly (and any other periodicity) magazines: the same size in consecutive months (a gap of up to one month is allowed),
 *    min_times or more months.
 * The same advertiser can have several contracts in a paper (different sizes or weekdays), or a renewed contract after a break.
 */
(function (root) {
  const MR = root.MR;
  const { isoFromDay, dowMon } = MR;
  const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const pct = (a, b) => (b > 0 ? (a / b) * 100 : null);
  const codes = (P, col, names) => new Set((names || []).map((n) => P.dicts[col].indexOf(n)).filter((c) => c >= 0));
  const WEEKLY = new Set(['daily', 'weekly', 'fortnightly']);

  function select(P, idx, opts) {
    const C = P.cols, ads = codes(P, 'advertiser', opts.advertisers), pubs = codes(P, 'publication', opts.publications);
    if (((opts.advertisers || []).length && !ads.size) || ((opts.publications || []).length && !pubs.size)) return new Int32Array(0);     // picked names that are not in this sheet match nothing
    const a = opts.date_from ? MR.dayFromIso(opts.date_from) : -Infinity, b = opts.date_to ? MR.dayFromIso(opts.date_to) : Infinity;
    if (!ads.size && !pubs.size && !Number.isFinite(a) && !Number.isFinite(b)) return idx;
    return MR.where(P, idx, (i) => (!ads.size || ads.has(C.advertiser[i])) && (!pubs.size || pubs.has(C.publication[i])) && C.date[i] >= a && C.date[i] <= b);
  }
  const nm = (P, col, c) => (c >= 0 ? P.dicts[col][c] : 'Unknown');

  function pressOptions(P) {
    if (!P || !P.n) return {};
    const C = P.cols, idx = MR.allIdx(P), [lo, hi] = MR.minMax(C.date, idx);
    const rank = (col) => { const m = new Map(); for (let i = 0; i < P.n; i++) m.set(C[col][i], (m.get(C[col][i]) || 0) + C.cost[i]); return [...m.entries()].filter((e) => e[0] >= 0).sort((a, b) => b[1] - a[1]).map((e) => P.dicts[col][e[0]]); };
    return { date_min: isoFromDay(lo), date_max: isoFromDay(hi), advertiser: rank('advertiser'), publication: rank('publication') };
  }

  /** Spend, insertions and column-centimetres by publication, advertiser and month. */
  function pressSummary(P, idx, opts = {}) {
    const C = P.cols, rows = select(P, idx, opts);
    if (!rows.length) return { empty: true, options: pressOptions(P) };
    const by = (col) => { const m = new Map(); for (let k = 0; k < rows.length; k++) { const i = rows[k], c = C[col][i]; let a = m.get(c); if (!a) m.set(c, (a = { spend: 0, ins: 0, area: 0, ad: new Set() })); a.spend += C.cost[i]; a.ins++; if (C.area[i] > 0) a.area += C.area[i]; a.ad.add(C.advertiser[i]); } return m; };
    const tot = rows.reduce((s, i) => s + C.cost[i], 0), area = rows.reduce((s, i) => s + (C.area[i] > 0 ? C.area[i] : 0), 0);
    const list = (col, limit) => [...by(col).entries()].map(([c, a]) => ({ name: nm(P, col, c), spend: a.spend, insertions: a.ins, area: a.area, rate: a.area > 0 ? a.spend / a.area : null, share_pct: pct(a.spend, tot), advertisers: a.ad.size }))
      .sort((x, y) => y.spend - x.spend).slice(0, limit);
    const months = new Map(); for (let k = 0; k < rows.length; k++) { const i = rows[k], key = isoFromDay(C.date[i]).slice(0, 7); const a = months.get(key) || { spend: 0, ins: 0 }; a.spend += C.cost[i]; a.ins++; months.set(key, a); }
    const [lo, hi] = MR.minMax(C.date, rows);
    return { empty: false, options: pressOptions(P), period: [isoFromDay(lo), isoFromDay(hi)],
      totals: { spend: tot, insertions: rows.length, area, rate: area > 0 ? tot / area : null, advertisers: new Set(Array.from(rows, (i) => C.advertiser[i])).size, publications: new Set(Array.from(rows, (i) => C.publication[i])).size },
      publications: list('publication', 60), advertisers: list('advertiser', 40), sizes: list('size', 15), languages: list('lng', 6),
      months: [...months.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([month, a]) => ({ month, spend: a.spend, insertions: a.ins })) };
  }

  /** opts: {advertisers, publications, date_from, date_to, min_times (4)} */
  function pressContracts(P, idx, opts = {}) {
    const C = P.cols, minTimes = +opts.min_times > 0 ? +opts.min_times : 4, rows = select(P, idx, opts);
    const [, dataHi] = MR.minMax(C.date, MR.allIdx(P));
    if (!rows.length) return { empty: true, contracts: [], min_times: minTimes, options: pressOptions(P) };
    const nS = P.dicts.size.length + 1, nP = P.dicts.product.length + 1, nB = P.dicts.publication.length + 1, g = new Map();
    for (let k = 0; k < rows.length; k++) {
      const i = rows[k], per = String(nm(P, 'periodicity', C.periodicity[i])).toLowerCase(), weekly = WEEKLY.has(per), dow = dowMon(C.date[i]);
      const key = ((((C.advertiser[i] * nP + C.product[i]) * nB + C.publication[i]) * nS + C.size[i]) * 8) + (weekly ? dow : 7);
      let a = g.get(key); if (!a) g.set(key, (a = { i0: i, weekly, dow, per, rows: [] }));
      a.rows.push(i);
    }
    const contracts = [], inContract = new Set();
    for (const a of g.values()) {
      // one entry per insertion date (weekly) or per month (monthly): several ads on one date count once
      const unit = (i) => (a.weekly ? C.date[i] : +isoFromDay(C.date[i]).slice(0, 4) * 12 + (+isoFromDay(C.date[i]).slice(5, 7) - 1));
      const gapMax = a.weekly ? 14 : 2, step = a.weekly ? 7 : 1;
      const byUnit = new Map(); for (const i of a.rows) { const u = unit(i); let x = byUnit.get(u); if (!x) byUnit.set(u, (x = [])); x.push(i); }
      const units = [...byUnit.keys()].sort((x, y) => x - y);
      let run = [];
      const flush = () => {
        if (run.length >= minTimes) {
          const ins = run.flatMap((u) => byUnit.get(u)), costs = ins.map((i) => C.cost[i]), i0 = a.i0, last = Math.max(...ins.map((i) => C.date[i])), first = Math.min(...ins.map((i) => C.date[i]));
          const missed = run.slice(1).reduce((s, u, j) => s + Math.max(0, Math.round((u - run[j]) / step) - 1), 0), total = costs.reduce((x, y) => x + y, 0);
          ins.forEach((i) => inContract.add(i));
          const ordered = ins.slice().sort((x, y) => C.date[x] - C.date[y]);
          contracts.push({ advertiser: nm(P, 'advertiser', C.advertiser[i0]), product: nm(P, 'product', C.product[i0]), publication: nm(P, 'publication', C.publication[i0]), size: nm(P, 'size', C.size[i0]),
            cm: C.cm[i0], col: C.col[i0], area: C.area[i0], weekday: a.weekly ? DAY_NAMES[a.dow] : 'Every month', periodicity: nm(P, 'periodicity', C.periodicity[i0]), language: nm(P, 'lng', C.lng[i0]), type: nm(P, 'type', C.type[i0]),
            location: nm(P, 'location', C.location[i0]), times: run.length, insertions: ins.length, missed, first: isoFromDay(first), last: isoFromDay(last), total_cost: total, avg_cost: total / ins.length,
            min_cost: Math.min(...costs), max_cost: Math.max(...costs), steady_rate: Math.max(...costs) <= Math.min(...costs) * 1.05,
            status: last >= dataHi - (a.weekly ? 21 : 62) ? 'Active' : 'Ended', dates: ordered.slice(0, 200).map((i) => ({ date: isoFromDay(C.date[i]), cost: C.cost[i] })) });
        }
        run = [];
      };
      for (const u of units) { if (run.length && (u - run[run.length - 1]) > gapMax) flush(); run.push(u); }
      flush();
    }
    contracts.sort((x, y) => y.total_cost - x.total_cost);
    const all = rows.reduce((s, i) => s + C.cost[i], 0), cc = contracts.reduce((s, c) => s + c.total_cost, 0), cIns = contracts.reduce((s, c) => s + c.insertions, 0);
    const byAdv = new Map(); contracts.forEach((c) => { const a = byAdv.get(c.advertiser) || { advertiser: c.advertiser, contracts: 0, active: 0, spend: 0 }; a.contracts++; if (c.status === 'Active') a.active++; a.spend += c.total_cost; byAdv.set(c.advertiser, a); });
    return { empty: false, min_times: minTimes, options: pressOptions(P), data_end: isoFromDay(dataHi), contracts: contracts.slice(0, opts.limit || 400), n_contracts: contracts.length,
      totals: { contracts: contracts.length, active: contracts.filter((c) => c.status === 'Active').length, insertions: cIns, contract_spend: cc, all_spend: all, all_insertions: rows.length, adhoc_spend: all - cc, adhoc_insertions: rows.length - cIns,
        contract_share_pct: pct(cc, all), advertisers: byAdv.size },
      by_advertiser: [...byAdv.values()].sort((x, y) => y.spend - x.spend).slice(0, 30),
      rule: `${minTimes} or more insertions of the same advertiser and product, in the same publication, at the same size, ${'on the same weekday (daily and weekly papers) or in consecutive months (monthly magazines)'}.` };
  }

  Object.assign(MR, { pressOptions, pressSummary, pressContracts });
})(typeof self !== 'undefined' ? self : globalThis);
