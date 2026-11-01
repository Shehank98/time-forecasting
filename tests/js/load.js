// Loads the browser engine into Node for parity tests (same files the worker uses).
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '../..');
const ENGINE = ['core.js', 'ingest.js', 'filters.js', 'analytics_tv.js', 'analytics_lmrb.js', 'analytics_kpi.js', 'ingest_kpi.js', 'joins.js', 'series.js', 'predict.js'];
function load() {
  globalThis.XLSX = require(path.join(ROOT, 'app/static/js/vendor/xlsx.full.min.js'));
  for (const f of ENGINE) {
    const p = path.join(ROOT, 'app/static/js/engine', f);
    if (fs.existsSync(p)) vm.runInThisContext(fs.readFileSync(p, 'utf8'), { filename: p });
  }
  const cfg = (n) => JSON.parse(fs.readFileSync(path.join(ROOT, 'app/config', n), 'utf8'));
  globalThis.MR.configure({ aliases: cfg('channel_aliases.json'), dayparts: cfg('dayparts.json'), holidays: cfg('holidays_lk.json') });
  return globalThis.MR;
}
const fileOf = (p) => ({ name: path.basename(p), text: fs.readFileSync(p, 'utf8') });
module.exports = { load, fileOf, ROOT };
