// node tests/js/kpi.js <file> <json-opts> -> proposal, table report/meta, dashboard and series from the browser engine
const { load, fileOf } = require('./load.js');
const MR = load();
(async () => {
  const [file, optsJson] = process.argv.slice(2);
  const o = JSON.parse(optsJson || '{}');
  const { proposal, pending } = await MR.proposeKpi(fileOf(file));
  const s = proposal.suggested;
  const mapping = o.mapping || { date_column: s.date_column, segment_column: s.segment_column, metrics: s.metrics, ratios: s.ratios };
  let T = MR.applyKpi(pending, JSON.parse(JSON.stringify(mapping)));
  if (o.append) { const p2 = await MR.proposeKpi(fileOf(o.append)); T = MR.mergeKpi(T, MR.applyKpi(p2.pending, JSON.parse(JSON.stringify(mapping)))).T; }
  const f = o.filters || {};
  const idx = MR.applyFilters(T, 'kpi', f), nodate = MR.applyFilters(T, 'kpi', f, true);
  const dash = MR.kpiDashboard(T, idx, nodate, f);
  const series = o.series ? MR.buildSeries(T, idx, 'kpi', o.series.entity_type, o.series.metric, o.series.gran, { meta: T.meta }) : null;
  process.stdout.write(JSON.stringify({ proposal, report: T.report, meta: T.meta, n: T.n, dash, series }));
})().catch((e) => { console.error(e.stack); process.exit(1); });
