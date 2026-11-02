/* Deep Negotiation & Brand Intelligence: LMRB spots grouped Channel -> Advertiser -> Advt_Theme, with share of wallet,
 * theme rotation, clutter and position vulnerability, and negotiation leverage. Runs in the worker and in Node tests.
 *
 * Definitions (also shown in the UI and the PDF):
 *  - Share of wallet (SoW): an advertiser's spend on a channel as a share of that advertiser's total spend in the selection.
 *  - Share of channel: an advertiser's spend on a channel as a share of everyone's spend on that channel in the selection.
 *  - First-in-break %: spots with PosinBrk = 1. Premium %: first or last in break.
 *  - Vulnerability index (0-100): for every spot with PosinBrk and AdsinBrk, clutter factor min(1, AdsinBrk / clutter threshold)
 *    times depth factor (distance from the nearest edge of the break, 0 at first or last, 1 in the dead middle); averaged and x100.
 *  - Volume rebate: an advertiser's spend on one channel at or above the rebate threshold -> retroactive volume discount opportunity of 10-15%.
 *  - Clutter penalty: a channel (or channel and daypart) whose average AdsinBrk is above the clutter threshold.
 */
(function (root) {
  const MR = root.MR;
  const { S, isoFromDay } = MR;
  const DUR = ['5s', '10s', '15s', '20s', '30s', '30s+', 'No duration'];
  const durBucket = (d) => (!(d > 0) ? 6 : d < 7.5 ? 0 : d <= 12.5 ? 1 : d <= 17.5 ? 2 : d <= 25 ? 3 : d <= 30 ? 4 : 5);
  const pct = (a, b) => (b > 0 ? (a / b) * 100 : null);

  function acc() {
    return { spend: 0, spots: 0, seconds: 0, clutSum: 0, clutN: 0, posSum: 0, posN: 0, first: 0, last: 0, both: 0, buried: 0, vulnSum: 0, vulnN: 0,
      dur: new Float64Array(DUR.length), durSpend: new Float64Array(DUR.length), dmin: Infinity, dmax: -Infinity };
  }
  function add(a, L, i, thr) {
    const C = L.cols, cost = C.cost[i], dur = C.dur[i], ads = C.adsinbrk[i], pos = C.posinbrk[i], d = C.date[i];
    a.spend += cost; a.spots++; if (dur > 0) a.seconds += dur;
    const b = durBucket(dur); a.dur[b]++; a.durSpend[b] += cost;
    if (d < a.dmin) a.dmin = d; if (d > a.dmax) a.dmax = d;
    if (ads > 0) { a.clutSum += ads; a.clutN++; }
    if (pos >= 1) { a.posSum += pos; a.posN++; if (pos === 1) a.first++; }
    if (pos >= 1 && ads >= 1) {
      a.both++;
      if (pos === ads && pos !== 1) a.last++;
      const depth = ads > 2 ? Math.min(pos - 1, ads - pos) / ((ads - 1) / 2) : 0;
      a.vulnSum += Math.min(1, ads / thr) * Math.max(0, Math.min(1, depth)); a.vulnN++;
      if (ads >= thr && pos > 1 && pos < ads) a.buried++;
    }
  }
  function out(a) {
    return { spend: a.spend, spots: a.spots, seconds: a.seconds, avg_dur: a.seconds > 0 ? a.seconds / Math.max(1, a.spots - a.dur[6]) : null,
      avg_clutter: a.clutN ? a.clutSum / a.clutN : null, avg_pos: a.posN ? a.posSum / a.posN : null,
      first_pct: a.posN ? (a.first / a.posN) * 100 : null, premium_pct: a.both ? ((a.first + a.last) / a.both) * 100 : (a.posN ? (a.first / a.posN) * 100 : null),
      buried_pct: a.both ? (a.buried / a.both) * 100 : null, vulnerability: a.vulnN ? (a.vulnSum / a.vulnN) * 100 : null,
      first_seen: Number.isFinite(a.dmin) ? isoFromDay(a.dmin) : null, last_seen: Number.isFinite(a.dmax) ? isoFromDay(a.dmax) : null,
      days_run: Number.isFinite(a.dmin) ? a.dmax - a.dmin + 1 : 0,
      dur_mix: DUR.map((n, k) => ({ band: n, spots: a.dur[k], spend: a.durSpend[k] })).filter((x) => x.spots) };
  }
  const sortSpend = (a, b) => b.spend - a.spend || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

  /**
   * opts: {channels, product_group, advertisers, themes, rebate_threshold, clutter_threshold, max_brands, max_themes}
   * Returns {totals, options, channels (with brands and themes), matrix, themes, shifts, clutter, leverage, definitions}.
   */
  function negotiationHub(L, idx, opts = {}) {
    const thr = Number(opts.clutter_threshold) > 0 ? Number(opts.clutter_threshold) : 35;
    const rebate = Number(opts.rebate_threshold) > 0 ? Number(opts.rebate_threshold) : 10000000;
    const C = L.cols, code = (col, names) => new Set((names || []).map((n) => L.dicts[col].indexOf(n)).filter((c) => c >= 0));
    // option lists cascade: channel and product group narrow the advertisers, advertisers narrow the themes
    const spendBy = (rows, col) => { const m = new Map(); for (let k = 0; k < rows.length; k++) { const i = rows[k], c = C[col][i]; m.set(c, (m.get(c) || 0) + C.cost[i]); } return [...m.entries()].sort((a, b) => b[1] - a[1]).map((e) => L.dicts[col][e[0]]).filter((x) => x != null); };
    const pgCode = opts.product_group ? L.dicts.product_group.indexOf(opts.product_group) : -1;
    const chSet = code('channel', opts.channels), advSet = code('advertiser', opts.advertisers);
    const inPg = pgCode >= 0 ? MR.where(L, idx, (i) => C.product_group[i] === pgCode) : idx;
    const inCh = chSet.size ? MR.where(L, inPg, (i) => chSet.has(C.channel[i])) : inPg;
    const inAdv = advSet.size ? MR.where(L, inCh, (i) => advSet.has(C.advertiser[i])) : inCh;
    const thSet = code('theme', opts.themes);
    const rows = thSet.size ? MR.where(L, inAdv, (i) => thSet.has(C.theme[i])) : inAdv;
    const options = { channels: spendBy(idx, 'channel'), product_groups: spendBy(idx, 'product_group'), advertisers: spendBy(inCh, 'advertiser').slice(0, 300), themes: spendBy(inAdv, 'theme').slice(0, 300) };
    if (!rows.length) return { empty: true, options, totals: { spend: 0, spots: 0 }, definitions: defs(thr, rebate) };

    const tot = acc(), byCh = new Map(), byChAdv = new Map(), byChAdvTh = new Map(), byAdv = new Map(), byAdvTh = new Map(), byChDp = new Map();
    const get = (m, k) => { let a = m.get(k); if (!a) { a = acc(); m.set(k, a); } return a; };
    for (let k = 0; k < rows.length; k++) {
      const i = rows[k], ch = C.channel[i], ad = C.advertiser[i], th = C.theme[i];
      add(tot, L, i, thr); add(get(byCh, ch), L, i, thr); add(get(byAdv, ad), L, i, thr);
      add(get(byChAdv, ch + '|' + ad), L, i, thr); add(get(byChAdvTh, ch + '|' + ad + '|' + th), L, i, thr); add(get(byAdvTh, ad + '|' + th), L, i, thr);
      add(get(byChDp, ch + '|' + C.daypart[i]), L, i, thr);
    }
    const nm = (col, c) => L.dicts[col][c];
    const advTotal = new Map([...byAdv.entries()].map(([k, a]) => [k, a.spend]));
    const maxBrands = opts.max_brands || 25, maxThemes = opts.max_themes || 12;
    const channels = [...byCh.entries()].map(([ch, a]) => {
      const o = out(a);
      const brands = [...byChAdv.entries()].filter(([k]) => +k.split('|')[0] === ch).map(([k, b]) => {
        const ad = +k.split('|')[1], ob = out(b);
        const themes = [...byChAdvTh.entries()].filter(([kk]) => kk.startsWith(ch + '|' + ad + '|')).map(([kk, t]) => ({ name: nm('theme', +kk.split('|')[2]), ...out(t) }))
          .sort(sortSpend).slice(0, maxThemes);
        return { name: nm('advertiser', ad), ...ob, share_of_channel: pct(b.spend, a.spend), sow: pct(b.spend, advTotal.get(ad)), rebate_eligible: b.spend >= rebate, themes };
      }).sort(sortSpend).slice(0, maxBrands);
      return { name: nm('channel', ch), ...o, share_pct: pct(a.spend, tot.spend), brands };
    }).sort(sortSpend);

    // Channel x brand matrix: spend, share of wallet and share of channel
    const mCh = channels.slice(0, 12).map((c) => c.name), mAd = [...byAdv.entries()].sort((a, b) => b[1].spend - a[1].spend).slice(0, 15).map(([k]) => nm('advertiser', k));
    const cell = (adv, ch) => { const a = byChAdv.get(L.dicts.channel.indexOf(ch) + '|' + L.dicts.advertiser.indexOf(adv)); return a ? a.spend : 0; };
    const matrix = { rows: mAd, cols: mCh, spend: mAd.map((a) => mCh.map((c) => cell(a, c))) };
    matrix.sow = matrix.spend.map((r, i) => r.map((v) => pct(v, advTotal.get(L.dicts.advertiser.indexOf(mAd[i])))));
    matrix.share_of_channel = matrix.spend.map((r) => r.map((v, j) => pct(v, (byCh.get(L.dicts.channel.indexOf(mCh[j])) || { spend: 0 }).spend)));

    // Theme rotation: every theme of every brand, plus whether the brand is moving to shorter spots
    const [lo, hi] = MR.minMax(C.date, rows);
    const themes = [...byAdvTh.entries()].map(([k, a]) => { const [ad, th] = k.split('|').map(Number); const o = out(a); return { advertiser: nm('advertiser', ad), name: nm('theme', th), ...o, active: a.dmax >= hi - 14 }; })
      .sort(sortSpend).slice(0, 60);
    const shifts = [...byAdv.keys()].map((ad) => {
      const r = MR.where(L, rows, (i) => C.advertiser[i] === ad); if (r.length < 10) return null;
      const [a0, a1] = MR.minMax(C.date, r), mid = a0 + (a1 - a0) / 2;
      const short = (part) => { const p = r.filter((i) => (part ? C.date[i] > mid : C.date[i] <= mid) && C.dur[i] > 0); return p.length ? (p.filter((i) => C.dur[i] <= 12.5).length / p.length) * 100 : null; };
      const early = short(false), late = short(true), nTh = new Set(r.map((i) => C.theme[i])).size, newTh = new Set(r.filter((i) => C.date[i] > hi - 30).map((i) => C.theme[i])).size;
      const delta = early != null && late != null ? late - early : null;
      const tactic = delta == null ? 'No duration data' : delta >= 15 ? 'Shifting to short reminder spots (10s and below)' : delta <= -15 ? 'Shifting to longer spots' : 'Steady spot lengths';
      return { advertiser: nm('advertiser', ad), short_early_pct: early, short_late_pct: late, change_pts: delta, themes: nTh, themes_last_30d: newTh, tactic, spend: byAdv.get(ad).spend };
    }).filter(Boolean).sort((a, b) => b.spend - a.spend).slice(0, 25);

    // Clutter by channel and daypart (timeband)
    const clutter = [...byChDp.entries()].map(([k, a]) => { const [ch, dp] = k.split('|').map(Number); const o = out(a); return { channel: nm('channel', ch), daypart: dp >= 0 ? nm('daypart', dp) : 'Not timed', spots: o.spots, spend: o.spend, avg_clutter: o.avg_clutter, first_pct: o.first_pct, flag: o.avg_clutter != null && o.avg_clutter > thr }; })
      .filter((x) => x.avg_clutter != null).sort((a, b) => b.avg_clutter - a.avg_clutter);

    // Negotiation leverage
    const leverage = [];
    channels.forEach((c) => c.brands.forEach((b) => { if (b.rebate_eligible) leverage.push({ type: 'rebate', channel: c.name, advertiser: b.name, spend: b.spend, est_low: b.spend * 0.10, est_high: b.spend * 0.15,
      text: `${b.name} spent ${Math.round(b.spend).toLocaleString('en-US')} on ${c.name}, above the ${Math.round(rebate).toLocaleString('en-US')} threshold: Retroactive Volume Discount Opportunity (10-15%), worth about ${Math.round(b.spend * 0.10).toLocaleString('en-US')} to ${Math.round(b.spend * 0.15).toLocaleString('en-US')}.` }); }));
    channels.forEach((c) => { if (c.avg_clutter != null && c.avg_clutter > thr) leverage.push({ type: 'clutter', channel: c.name, daypart: null, avg_clutter: c.avg_clutter, spots: c.spots,
      text: `High commercial clutter on ${c.name} (average ${c.avg_clutter.toFixed(1)} ads per break): demand 3 free bonus spots or priority First-in-Break placement.` }); });
    clutter.filter((x) => x.flag).slice(0, 15).forEach((x) => { leverage.push({ type: 'clutter', channel: x.channel, daypart: x.daypart, avg_clutter: x.avg_clutter, spots: x.spots,
      text: `High commercial clutter on ${x.channel} in ${x.daypart} (average ${x.avg_clutter.toFixed(1)} ads per break): demand 3 free bonus spots or priority First-in-Break placement in this timeband.` }); });
    leverage.sort((a, b) => (a.type === b.type ? (b.spend || b.avg_clutter || 0) - (a.spend || a.avg_clutter || 0) : a.type === 'rebate' ? -1 : 1));

    const o = out(tot);
    return { empty: false, options, selection: { channels: opts.channels || [], product_group: opts.product_group || null, advertisers: opts.advertisers || [], themes: opts.themes || [] },
      thresholds: { rebate, clutter: thr }, period: [isoFromDay(lo), isoFromDay(hi)],
      totals: { ...o, channels: byCh.size, advertisers: byAdv.size, themes: byAdvTh.size, rebate_low: leverage.filter((l) => l.type === 'rebate').reduce((s, l) => s + l.est_low, 0), rebate_high: leverage.filter((l) => l.type === 'rebate').reduce((s, l) => s + l.est_high, 0) },
      channels, matrix, themes, shifts, clutter: clutter.slice(0, 40), leverage, definitions: defs(thr, rebate) };
  }
  function defs(thr, rebate) {
    return {
      share_of_wallet: "An advertiser's spend on a channel as a share of that advertiser's total spend in the selection.",
      share_of_channel: "An advertiser's spend on a channel as a share of all spend on that channel in the selection.",
      first_in_break: 'Spots in position 1 of the break. Premium = first or last in break.',
      vulnerability: `0 to 100. For each spot: min(1, ads in break / ${thr}) x how deep it sits in the break (0 first or last, 1 dead middle), averaged.`,
      rebate: `Spend by one advertiser on one channel of ${Math.round(rebate).toLocaleString('en-US')} or more: a retroactive volume discount of 10-15% can be asked for.`,
      clutter: `Average ads in break above ${thr}: ask for 3 free bonus spots or priority first-in-break placement.`,
    };
  }
  Object.assign(MR, { negotiationHub, NEGOTIATION_DUR: DUR });
})(typeof self !== 'undefined' ? self : globalThis);
