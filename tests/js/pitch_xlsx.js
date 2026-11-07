// node tests/js/pitch_xlsx.js <lmrb.csv> <tvr.csv> '<options json>' <out prefix>
// Builds the evaluation workbook from the engine's current buy twice: with cached values, and with the cached values removed
// (so a spreadsheet program has to calculate every formula itself). Prints the engine's channel numbers for comparison.
const { load, fileOf } = require('./load.js');
const fs = require('fs'), path = require('path'), vm = require('vm');
const MR = load();
for (const f of ['pitchalloc.js', 'pitchmatch.js', 'pitch.js']) vm.runInThisContext(fs.readFileSync(path.join(__dirname, '../../app/static/js/engine', f), 'utf8'));
globalThis.window = globalThis; globalThis.App = {};
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '../../app/static/js/pitch-xlsx.js'), 'utf8'));
(async () => {
  const [lf, tf, opts, out] = process.argv.slice(2);
  const L = await MR.parseFile('lmrb', fileOf(lf)), V = await MR.parseFile('tv', fileOf(tf)), D = MR.pitchBuild(L, MR.allIdx(L), V, JSON.parse(opts || '{}')), cur = D.current;
  const spec = { client: 'Sampath Bank', title: 'CURRENT AGENCY BUY: EVALUATION', month: D.month, channels: cur.channels.map((c) => ({ name: c.channel,
    basket: cur.rows.filter((r) => r.channel === c.channel).map((r) => ({ desc: r.program, day: r.days, from: r.start, to: r.end, dur: r.avg_dur, tvr: r.tvr, spots: r.spots, card: r.card30 || 0, rate: r.avg30 || 0 })),
    sponsorship: cur.sponsorship.filter((x) => x.channel === c.channel).map((x) => ({ desc: x.theme, day: '', from: '', to: '', dur: (x.eq30 * 30) / x.spots, tvr: x.tvr, spots: x.spots, card: x.value > 0 ? x.value / x.eq30 : 0, rate: x.spend / x.eq30 })) })) };
  const X = globalThis.XLSX, wb = globalThis.App.pitchXlsx.build(X, spec);
  const save = (name) => fs.writeFileSync(name, X.write(wb, { bookType: 'xlsx', type: 'buffer' }));
  save(out + '_cached.xlsx');
  for (const ws of Object.values(wb.Sheets)) for (const [k, c] of Object.entries(ws)) if (k[0] !== '!' && c.f) delete c.v;
  save(out + '_nocache.xlsx');
  process.stdout.write(JSON.stringify({ channels: cur.channels, sheets: wb.SheetNames }));
})().catch((e) => { console.error(e.stack); process.exit(1); });
