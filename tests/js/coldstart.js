// node tests/js/coldstart.js <tv.csv> <json request>  -> cold-start estimate from the browser engine
const { load, fileOf } = require('./load.js');
const MR = load();
(async () => {
  const [tvFile, reqJson] = process.argv.slice(2);
  const T = await MR.parseFile('tv', fileOf(tvFile));
  process.stdout.write(JSON.stringify(MR.coldStart(T, { ...JSON.parse(reqJson), filters: {} })));
})().catch((e) => { console.error(e.stack); process.exit(1); });
