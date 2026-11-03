// node tests/js/press.js <op> <press.csv> '<options json>' [<lmrb.csv>]   op = parse | summary | contracts | spend
const { load, fileOf } = require('./load.js');
const MR = load();
(async () => {
  const [op, file, opts, lfile] = process.argv.slice(2);
  const o = JSON.parse(opts || '{}');
  if (o._items) { MR.configure({ sponsorship: { items: o._items } }); delete o._items; }
  const P = file && file !== '-' ? await MR.parseFile('press', fileOf(file)) : null;
  const L = lfile ? await MR.parseFile('lmrb', fileOf(lfile)) : null;
  const out = {
    parse: () => ({ report: P.report, n: P.n, dicts: P.dicts, first: { cost: P.cols.cost[0], area: P.cols.area[0], col: P.cols.col[0], cm: P.cols.cm[0], date: MR.isoFromDay(P.cols.date[0]) } }),
    summary: () => MR.pressSummary(P, MR.allIdx(P), o),
    contracts: () => MR.pressContracts(P, MR.allIdx(P), o),
    spend: () => MR.mediaSpend(L, L ? MR.allIdx(L) : null, P, P ? MR.allIdx(P) : null, o),
    lmrb: () => ({ medium: L.dicts.medium, channels: L.dicts.channel, pairs: [...new Set(Array.from(L.cols.channel, (c, i) => L.dicts.channel[c] + '|' + L.dicts.medium[L.cols.medium[i]]))] }),
  }[op]();
  process.stdout.write(JSON.stringify(out));
})().catch((e) => { console.error(e.stack); process.exit(1); });
