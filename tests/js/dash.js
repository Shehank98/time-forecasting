// node tests/js/dash.js <kind> <file> [lmrb_or_tv_file] [json-options]  -> prints the browser engine's dashboard JSON
const { load, fileOf } = require('./load.js');
const MR = load();
(async () => {
  const [kind, file, other, optsJson] = process.argv.slice(2);
  const opts = optsJson ? JSON.parse(optsJson) : {};
  const T = await MR.parseFile(kind, fileOf(file));
  const O = other ? await MR.parseFile(kind === 'tv' ? 'lmrb' : 'tv', fileOf(other)) : null;
  const filters = opts.filters || {};
  let out;
  if (kind === 'tv') out = MR.tvDashboard(T, MR.applyFilters(T, 'tv', filters), O);
  else {
    let L = T;
    if (O && MR.withGrps) L = MR.withGrps(T, O, opts.tv_data_set || null);
    out = MR.lmrbDashboard(L, MR.applyFilters(L, 'lmrb', filters, true), filters, opts.my_brand || null, opts.competitors || null);
    if (opts.h2h) out = MR.headToHead(L, MR.applyFilters(L, 'lmrb', filters, true), filters, opts.h2h[0], opts.h2h[1]);
  }
  process.stdout.write(JSON.stringify({ dash: out, report: T.report, options: MR.filterOptions(T, kind), chips: MR.describeFilters(kind, filters) }));
})().catch((e) => { console.error(e.stack); process.exit(1); });
