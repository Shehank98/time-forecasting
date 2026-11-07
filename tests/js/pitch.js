// node tests/js/pitch.js <lmrb.csv> <tvr.csv> '<options json>'   prints MR.pitchBuild(...) as JSON
const { load, fileOf } = require('./load.js');
const fs = require('fs'), path = require('path');
const MR = load();
vmLoad(path.join(__dirname, '../../app/static/js/engine/pitchalloc.js')); vmLoad(path.join(__dirname, '../../app/static/js/engine/pitchmatch.js')); vmLoad(path.join(__dirname, '../../app/static/js/engine/pitch.js'));
function vmLoad(p) { require('vm').runInThisContext(fs.readFileSync(p, 'utf8'), { filename: p }); }
(async () => {
  const [lf, tf, opts, cm] = process.argv.slice(2);
  const L = await MR.parseFile('lmrb', fileOf(lf), undefined, cm ? JSON.parse(cm) : undefined), V = await MR.parseFile('tv', fileOf(tf));
  process.stdout.write(JSON.stringify(MR.pitchBuild(L, MR.allIdx(L), V, JSON.parse(opts || '{}'))));
})().catch((e) => { console.error(e.stack); process.exit(1); });
