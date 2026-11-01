// node tests/js/vaultrows.js lmrb|tv <file>  -> rows the browser sends to the vault, plus payload descriptors
const { load, fileOf } = require('./load.js');
const MR = load();
(async () => {
  const [kind, file] = process.argv.slice(2);
  const T = await MR.parseFile(kind, fileOf(file));
  const idx = MR.applyFilters(T, kind, {});
  const rows = kind === 'tv' ? MR.vaultRowsTv(T) : MR.vaultRowsLmrb(T);
  const pay = kind === 'tv' ? MR.tvrPayload(T, idx, 'daily', { vault: true }) : MR.marketPayload(T, idx, { mode: 'daily', vault: true });
  const plain = kind === 'tv' ? MR.tvrPayload(T, idx, 'daily', {}) : MR.marketPayload(T, idx, { mode: 'daily' });
  const desc = pay.daily.concat(pay.weekly || []).filter((s) => s.vault).map((s) => s.vault);
  process.stdout.write(JSON.stringify({ rows, desc, groups: [...new Set(desc.map((d) => d.group))], plain_has_vault: plain.daily.some((s) => s.vault) }));
})().catch((e) => { console.error(e.stack); process.exit(1); });
