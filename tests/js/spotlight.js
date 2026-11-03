// node tests/js/spotlight.js <op> <lmrb.csv> '<options json>'   op = index | programme | matrix | row
const { load, fileOf } = require('./load.js');
const MR = load();
(async () => {
  const [op, file, opts] = process.argv.slice(2);
  const L = await MR.parseFile('lmrb', fileOf(file)); const idx = MR.applyFilters(L, 'lmrb', {});
  const o = JSON.parse(opts || '{}');
  if (o._items) { MR.configure({ sponsorship: { items: o._items } }); delete o._items; }
  const f = { index: () => MR.spotlightIndex(L, idx), programme: () => MR.programmeSpotlight(L, idx, o), matrix: () => MR.shortFormMatrix(L, idx, o), row: () => MR.shortFormRow(L, idx, o), options: () => MR.sponsorshipOptions(L, idx, o), report: () => MR.sponsorshipReport(L, idx, o), list: () => MR.sponsorshipList(L, idx, o), exec: () => MR.executiveSummary(L, idx, o), execDetail: () => MR.executiveDetail(L, idx, o), tenure: () => MR.sponsorshipTenure(L, idx, o), lookup: () => MR.sponsorshipLookup(L, idx, o) }[op];
  process.stdout.write(JSON.stringify(f()));
})().catch((e) => { console.error(e.stack); process.exit(1); });
