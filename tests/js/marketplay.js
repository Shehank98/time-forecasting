// node tests/js/marketplay.js <lmrb.csv> [today YYYY-MM-DD] -> MR.marketPlay output
const { load, fileOf } = require('./load.js');
const MR = load();
(async () => {
  const [lf, today] = process.argv.slice(2);
  const L = await MR.parseFile('lmrb', fileOf(lf));
  process.stdout.write(JSON.stringify(MR.marketPlay(L, MR.allIdx(L), { today: today ? MR.dayFromIso(today) : undefined, my_brand: 'Nestle Lanka Ltd' })));
})().catch((e) => { console.error(e.stack); process.exit(1); });
