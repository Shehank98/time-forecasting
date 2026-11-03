// node tests/js/themes.js '<json list of themes>' ['<json items override>']  -> [{theme, sponsor, key, item}]
const { load } = require('./load.js');
const MR = load();
const list = JSON.parse(process.argv[2] || '[]');
if (process.argv[3]) MR.configure({ sponsorship: { items: JSON.parse(process.argv[3]) } });
process.stdout.write(JSON.stringify(list.map((t) => ({ theme: t, sponsor: MR.isSponsorTheme(t), key: MR.sponsorKey(t), item: MR.sponsorItem(t) }))));
