// node tests/js/market.js <lmrb.csv> [tv.csv]  -> market payload facts from the browser engine
const { load, fileOf } = require('./load.js');
const MR = load();
(async () => {
  const [lmFile, tvFile] = process.argv.slice(2);
  let L = await MR.parseFile('lmrb', fileOf(lmFile)); L.sig = 'x';
  let bridge = null;
  if (tvFile) { const T = await MR.parseFile('tv', fileOf(tvFile)); T.sig = 'y'; L = MR.withTimebands(L, T, null); bridge = L.bridgeStats; }
  const idx = MR.applyFilters(L, 'lmrb', {});
  const pay = MR.marketPayload(L, idx, { mode: 'monthly' });
  const groups = {}; pay.daily.forEach((s) => { groups[s.group] = (groups[s.group] || 0) + 1; });
  const hi = MR.dayFromIso(pay.ctx.date_max), lo = MR.dayFromIso(pay.ctx.date_min);
  const prob = {}; for (const [a, eps] of Object.entries(pay.ctx.radar)) prob[a] = MR.radarProb(eps, lo, hi, 60);
  const asof = MR.dayFromIso('2026-03-31'), spring = {}; for (const [a, eps] of Object.entries(pay.ctx.radar)) spring[a] = MR.radarProb(eps, lo, asof, 30);
  const slots = (L.dicts.matched_program || []).slice(0, 5);
  process.stdout.write(JSON.stringify({ spring, groups, bridge, prob, lifecycle: pay.ctx.lifecycle, years: pay.ctx.history_years, slots, has_grp: pay.ctx.has_grp }));
})().catch((e) => { console.error(e.stack); process.exit(1); });
