// node tests/js/stealth.js payload <lmrb.csv>            -> series payload and context
// node tests/js/stealth.js alerts <bundle.json>          -> alerts from {ctx, results}
const { load, fileOf } = require('./load.js');
const fs = require('fs');
const MR = load();
(async () => {
  const [mode, file] = process.argv.slice(2);
  if (mode === 'payload') {
    const L = await MR.parseFile('lmrb', fileOf(file)); const idx = MR.applyFilters(L, 'lmrb', {});
    process.stdout.write(JSON.stringify(MR.stealthPayload(L, idx, {})));
  } else {
    const b = JSON.parse(fs.readFileSync(file, 'utf8'));
    process.stdout.write(JSON.stringify(MR.stealthAlerts(b.results, b.ctx)));
  }
})().catch((e) => { console.error(e.stack); process.exit(1); });
