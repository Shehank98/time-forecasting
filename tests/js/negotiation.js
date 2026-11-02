// node tests/js/negotiation.js <lmrb.csv> '<options json>'  -> negotiation hub payload
const { load, fileOf } = require('./load.js');
const MR = load();
(async () => {
  const [file, opts] = process.argv.slice(2);
  const L = await MR.parseFile('lmrb', fileOf(file)); const idx = MR.applyFilters(L, 'lmrb', {});
  process.stdout.write(JSON.stringify(MR.negotiationHub(L, idx, JSON.parse(opts || '{}'))));
})().catch((e) => { console.error(e.stack); process.exit(1); });
