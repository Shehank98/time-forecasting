// node tests/js/themes.js '<json list of themes>'  -> [{theme, sponsor, key, item}]
const { load } = require('./load.js');
const MR = load();
const list = JSON.parse(process.argv[2] || '[]');
process.stdout.write(JSON.stringify(list.map((t) => ({ theme: t, sponsor: MR.isSponsorTheme(t), key: MR.sponsorKey(t), item: MR.sponsorItem(t) }))));
