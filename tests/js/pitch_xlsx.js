// node tests/js/pitch_xlsx.js <lmrb.csv> <tvr.csv> '<options json>'
// Prints the engine's current-buy numbers and the evaluation spec the page would send to /api/pitch/evaluation.
const { load, fileOf } = require('./load.js');
const fs = require('fs'), path = require('path'), vm = require('vm');
const MR = load();
for (const f of ['pitchalloc.js', 'pitchmatch.js', 'pitch.js']) vm.runInThisContext(fs.readFileSync(path.join(__dirname, '../../app/static/js/engine', f), 'utf8'));
(async () => {
  const [lf, tf, opts] = process.argv.slice(2), o = JSON.parse(opts || '{}');
  const L = await MR.parseFile('lmrb', fileOf(lf)), V = await MR.parseFile('tv', fileOf(tf)), D = MR.pitchBuild(L, MR.allIdx(L), V, o), cur = D.current;
  const spec = { client: 'Sampath Bank', title: 'CURRENT AGENCY BUY: EVALUATION', month: D.month, prime: [19 / 24, 22.5 / 24], channels: cur.channels.map((c) => ({ name: c.channel, deal: (o.deals || {})[c.channel],
    basket: cur.rows.filter((r) => r.channel === c.channel).map((r) => ({ band: r.pt ? 'PT' : 'NPT', desc: r.program, day: r.days, from: r.start, to: r.end, dur: r.avg_dur, tvr: r.tvr, spots: r.spots, card: r.card30 || 0, rate: r.avg30 || 0 })),
    sponsorship: cur.sponsorship.filter((x) => x.channel === c.channel).map((x) => ({ desc: x.theme, day: '', from: '', to: '', dur: (x.eq30 * 30) / x.spots, tvr: x.tvr, spots: x.spots, card: x.value > 0 ? x.value / x.eq30 : 0, rate: x.spend / x.eq30 })) })) };
  process.stdout.write(JSON.stringify({ channels: cur.channels, spec }));
})().catch((e) => { console.error(e.stack); process.exit(1); });
