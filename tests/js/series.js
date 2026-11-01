// node tests/js/series.js <kind> <file> <json-opts>  -> series built by the browser engine
const { load, fileOf } = require('./load.js');
const MR = load();
(async () => {
  const [kind, file, optsJson] = process.argv.slice(2);
  const o = JSON.parse(optsJson || '{}');
  let T = await MR.parseFile(kind, fileOf(file));
  if (o.tv) T = MR.withGrps(T, await MR.parseFile('tv', fileOf(o.tv)), null);
  const idx = MR.applyFilters(T, kind, o.filters || {});
  const out = MR.buildSeries(T, idx, kind, o.entity_type, o.metric, o.gran, { maxEntities: o.max_entities || 8, historyDays: o.history_days, entities: o.entities });
  const ranked = MR.rankEntities(T, idx, kind, o.entity_type, 60, null, o.metric);
  process.stdout.write(JSON.stringify({ ...out, ranked }));
})().catch((e) => { console.error(e.stack); process.exit(1); });
