/* Client Pitch Evaluator (TV only). Runs in the data worker and in Node tests.
 *
 * Shows what the current agency bought (LMRB sheet) against the TVR sheet, then what the same money buys at our negotiated rates.
 *  - Only channels that appear in the TVR sheet are evaluated. Other TV channels are listed as skipped.
 *  - LMRB programme names rarely equal TVR names, so each LMRB programme (per channel) is matched to a TVR programme by channel + weekday + start time
 *    first, then by name similarity. The user can fix a match; fixes arrive as opts.mappings.
 *  - 30 sec equivalent = spots x duration / 30. Average 30 sec rate = cost / 30 sec equivalents. CPRP (30 sec) = cost / (TVR x 30 sec equivalents).
 *  - GRP = TVR x spots. NGRP (30 sec equivalent GRP) = TVR x 30 sec equivalents. TVR is the programme's average over every uploaded TVR month.
 *  - Value at rate card = card 30 sec rate x 30 sec equivalents. ROI = value at rate card / spend (commercial only, and all exposure = commercial + value add).
 *  - Prime time is the programme's start time inside the prime window (default 19:00 to 22:30).
 */
(function (root) {
  const MR = root.MR;
  const { isoFromDay, dowMon } = MR;
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const hm = (s) => { if (!(s >= 0)) return ''; const m = Math.round(s / 60) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
  const div = (a, b) => (b > 0 ? a / b : null);
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const bigrams = (s) => { const t = s.replace(/ /g, ''), o = new Map(); for (let i = 0; i < t.length - 1; i++) { const g = t.slice(i, i + 2); o.set(g, (o.get(g) || 0) + 1); } return o; };
  /** Name similarity 0..1: equal, one contains the other, or bigram overlap. */
  function sim(a, b) {
    a = norm(a); b = norm(b); if (!a || !b) return 0; if (a === b) return 1;
    if (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a))) return 0.9;
    const A = bigrams(a), B = bigrams(b); let hit = 0, nA = 0, nB = 0;
    A.forEach((v) => { nA += v; }); B.forEach((v) => { nB += v; }); A.forEach((v, k) => { if (B.has(k)) hit += Math.min(v, B.get(k)); });
    return nA + nB ? (2 * hit) / (nA + nB) : 0;
  }
  const dayLabel = (cnt) => {
    const mx = Math.max(...cnt); if (!mx) return 'Unknown';
    const on = cnt.map((c) => c >= mx * 0.25), k = on.filter(Boolean).length;
    if (k === 7) return 'Daily'; if (on.slice(0, 5).every(Boolean) && !on[5] && !on[6]) return 'Mon-Fri'; if (!on.slice(0, 5).some(Boolean) && on[5] && on[6]) return 'Sat-Sun';
    return DAYS.filter((_, i) => on[i]).join(' ') || 'Unknown';
  };
  const monthOf = (() => { const memo = new Map(); return (d) => { let v = memo.get(d); if (!v) { v = isoFromDay(d).slice(0, 7); memo.set(d, v); } return v; }; })();

  /** TVR programmes: one entry per channel + programme + start time (rounded to 15 minutes), TVR averaged over every airing in the sheet. */
  function catalogue(V, dataSet) {
    const C = V.cols, byKey = new Map(), months = new Set();
    for (let i = 0; i < V.n; i++) {
      if (dataSet && C.data_set && V.dicts.data_set[C.data_set[i]] !== dataSet) continue;      // one target audience only: TVRs of different audiences must never be averaged together
      const ch = V.dicts.channel[C.channel[i]], pr = V.dicts.program[C.program[i]], st = C.start[i] >= 0 ? Math.round(C.start[i] / 900) * 900 : -1, key = `${ch}|${pr}|${hm(st)}`;
      let e = byKey.get(key);
      if (!e) byKey.set(key, (e = { key, channel: ch, program: pr, start: st, end: C.end[i], n: 0, tvr_sum: 0, zero: 0, days: Array(7).fill(0), months: new Set() }));
      const t = C.tvr[i]; e.n++; e.tvr_sum += t; if (!(t > 0)) e.zero++; e.days[dowMon(C.date[i])]++; const m = monthOf(C.date[i]); e.months.add(m); months.add(m);
    }
    // The same programme listed at slightly different times or days (13:30 and 13:15, "Fri" and "Tue Fri") is one programme: merge slots of the same name that start within 30 minutes of each other and share a day.
    const alias = new Map(), same = new Map();
    for (const e of byKey.values()) { const k = `${e.channel}|${e.program}`; if (!same.has(k)) same.set(k, []); same.get(k).push(e); }
    for (const list of same.values()) {
      if (list.length < 2) continue; list.sort((a, b) => b.n - a.n || (a.key < b.key ? -1 : 1)); const kept = [];
      for (const e of list) {
        const host = kept.find((h) => h.start >= 0 && e.start >= 0 && Math.abs(h.start - e.start) <= 1800 && h.days.some((c, i) => c > 0 && e.days[i] > 0));
        if (!host) { kept.push(e); continue; }
        host.n += e.n; host.tvr_sum += e.tvr_sum; host.zero += e.zero; e.days.forEach((c, i) => { host.days[i] += c; }); e.months.forEach((m) => host.months.add(m));
        (host.merged = host.merged || []).push({ start: hm(e.start), n: e.n }); alias.set(e.key, host.key); byKey.delete(e.key);
      }
    }
    if (alias.size) { const get = Map.prototype.get, has = Map.prototype.has; byKey.get = (k) => (has.call(byKey, k) ? get.call(byKey, k) : get.call(byKey, alias.get(k))); byKey.has = (k) => has.call(byKey, k) || has.call(byKey, alias.get(k)); }
    const byCh = new Map();
    for (const e of byKey.values()) {
      e.tvr = e.tvr_sum / e.n; e.per_month = e.n / Math.max(1, e.months.size); e.day_label = dayLabel(e.days); e.start_hm = hm(e.start); e.end_hm = hm(e.end); e.pt = null;
      if (!byCh.has(e.channel)) byCh.set(e.channel, []); byCh.get(e.channel).push(e);
    }
    return { byKey, byCh, months: [...months].sort(), merged_slots: alias.size };
  }
  const isPT = (start, o) => start >= 0 && start >= o.pt_start && start < o.pt_end;

  /** Programme matching. Every LMRB programme name is scored against every TVR programme of its channel, from three kinds of evidence:
   *   time  : its spots fall in the TVR programme's slot (votes), or start close to it on the same weekdays (graded: 5 min, 15 min, 30 min, 60 min)
   *   name  : cleaned, sound-based and word-by-word comparison of the names (see pitchmatch.js), incl. repeats ("- RPT") and what you approved before
   *   kind  : both are movies, news, kids, music or reality programmes
   *  LMRB programmes in the same time slot (same channel, start time, days: for example many movie titles) are one slot, matched once; a slot that finds nothing
   *  falls back to its names one by one. The best five are kept as suggestions for the review table. opts.match_min (default 45) is the lowest score accepted. */
  function matchGroups(L, rows, cat, o) {
    const C = L.cols, groups = new Map(), P = MR.pitchPrep, NS = MR.pitchNameScorePrepared;
    for (const i of rows) {
      const ch = L.dicts.channel[C.channel[i]], name = L.dicts.program[C.program[i]], gk = `${ch}|${name}`;
      let g = groups.get(gk); if (!g) groups.set(gk, (g = { key: gk, channel: ch, lmrb_program: name, prep: P(name), spots: 0, spend: 0, votes: new Map(), slotted: 0, starts: new Map(), days: Array(7).fill(0) }));
      g.spots++; g.spend += C.cost[i];
      const dow = dowMon(C.date[i]), ps = C.prog_sec[i], at = C.advt_sec[i]; g.days[dow]++;
      if (ps >= 0) { const b = Math.round(ps / 900) * 900; g.starts.set(b, (g.starts.get(b) || 0) + 1); }
      const list = cat.byCh.get(ch); if (!list) continue;
      let best = null;
      if (ps >= 0) { let bd = 901; for (const e of list) { if (e.start < 0 || e.days[dow] === 0) continue; const d = Math.abs(e.start - ps); if (d < bd || (d === bd && best && e.n > best.n)) { bd = d; best = e; } } }
      if (!best && at >= 0) {
        for (const e of list) {
          if (e.start < 0 || e.days[dow] === 0) continue;
          const en = e.end > e.start ? e.end : e.end + 86400, t = at < e.start - 900 && en > 86400 ? at + 86400 : at;
          if (t >= e.start - 900 && t < en && (!best || e.start > best.start)) best = e;
        }
      }
      if (best) { g.votes.set(best.key, (g.votes.get(best.key) || 0) + 1); g.slotted++; }
    }
    // slots
    const slots = new Map();
    for (const g of groups.values()) {
      let st = -1, bn = 0; g.starts.forEach((n, b) => { if (n > bn) { bn = n; st = b; } });
      const sk = st >= 0 ? `${g.channel}|${hm(st)}|${dayLabel(g.days)}` : `${g.channel}|name|${g.lmrb_program}`;
      g.slot = sk;
      let sl = slots.get(sk); if (!sl) slots.set(sk, (sl = { key: sk, channel: g.channel, startSec: st, start: st >= 0 ? hm(st) : '', days: st >= 0 ? dayLabel(g.days) : '', dayCount: Array(7).fill(0), members: [], votes: new Map(), spots: 0, spend: 0 }));
      sl.members.push(g); sl.spots += g.spots; sl.spend += g.spend; g.votes.forEach((v, k) => sl.votes.set(k, (sl.votes.get(k) || 0) + v)); g.days.forEach((n, d) => { sl.dayCount[d] += n; });
    }
    const mp = o.mappings || {}, minConf = (Number.isFinite(+o.match_min) ? +o.match_min : 45) / 100;
    // what you approved before: a name approved for a programme is that programme wherever it turns up
    const learned = new Map(Object.entries(o.learned || {}));
    const teach = (g, entry) => { if (entry && g.prep.text) learned.set(`${g.channel}|${g.prep.text}`, entry.program); };
    slots.forEach((sl) => { const m = mp['SLOT|' + sl.key]; if (m && m !== '-' && cat.byKey.has(m)) sl.members.forEach((g) => teach(g, cat.byKey.get(m))); });
    groups.forEach((g) => { const m = mp[g.key]; if (m && m !== '-' && cat.byKey.has(m)) teach(g, cat.byKey.get(m)); });
    const onDays = (cnt) => { const mx = Math.max(...cnt); return cnt.map((c) => mx > 0 && c >= mx * 0.25); };
    const ePrep = (e) => e.prep || (e.prep = P(e.program)), eDays = (e) => e.dset || (e.dset = onDays(e.days));
    /** Score one set of names (a slot, or a single programme) against one TVR programme. */
    function scoreOne(ctx, e) {
      const ep = ePrep(e), multi = ctx.members.length > 1;
      let N = 0, learnedHit = false, kind = false, clash = false, bestName = '';
      for (const g of ctx.members) {
        const l = learned.get(`${g.channel}|${g.prep.text}`); if (l && l === e.program) { N = Math.max(N, 0.97); learnedHit = true; bestName = g.lmrb_program; continue; }
        const s = NS(g.prep, ep); if (s > N) { N = s; bestName = g.lmrb_program; }
        if (MR.pitchSameKind(g.prep, ep)) kind = true;
      }
      if (kind && N < 0.5) N = 0.5;
      if (!kind && ep.kinds.size && ctx.members.some((g) => g.prep.kinds.size) && ctx.members.every((g) => !g.prep.kinds.size || ![...g.prep.kinds].some((k) => ep.kinds.has(k)))) clash = true;       // a movie against the news
      const share = ctx.spots ? (ctx.votes.get(e.key) || 0) / ctx.spots : 0;
      const dlt = ctx.startSec >= 0 && e.start >= 0 ? Math.abs(ctx.startSec - e.start) : Infinity;
      const prox = dlt <= 300 ? 1 : dlt <= 900 ? 0.85 : dlt <= 1800 ? 0.55 : dlt <= 3600 ? 0.25 : 0, es = eDays(e), sd = onDays(ctx.dayCount), nd = sd.filter(Boolean).length;
      const overlap = nd ? sd.filter((on, i) => on && es[i]).length / nd : 0;
      const T = Math.max(share, prox * (0.4 + 0.6 * overlap)), wT = multi ? 0.8 : 0.6;
      let conf = wT * T + (1 - wT) * N;
      if (N >= 0.8) conf = Math.max(conf, 0.7 * N);                            // the same name at another time (a repeat, a moved slot)
      if (clash && N < 0.6) conf *= 0.5;
      if (learnedHit) conf = Math.max(conf, 0.85);
      const parts = [];
      if (share >= 0.5) parts.push(`${Math.round(share * 100)}% of the spots run in its slot`); else if (prox >= 0.55) parts.push(`starts ${Math.round(dlt / 60)} min from it`); else if (T > 0.2) parts.push('close in time');
      if (learnedHit) parts.push(`you approved "${bestName}" for it before`); else if (N >= 0.5 && !(kind && N === 0.5)) parts.push(`name ${Math.round(N * 100)}%`); if (kind && !learnedHit) parts.push('same kind of programme');
      const method = learnedHit ? 'your earlier approval' : [T >= 0.5 ? 'time slot' : T > 0.2 ? 'near in time' : '', N >= 0.5 && !(kind && N === 0.5) ? 'name' : '', kind ? 'same kind' : ''].filter(Boolean).join(' + ') || 'weak match';
      return { e, conf, T, N, method: multi && T >= 0.5 && N < 0.5 ? 'same time slot' : method, reason: parts.join(', ') };
    }
    function rank(ctx, list) { return list.map((e) => scoreOne(ctx, e)).sort((a, b) => b.conf - a.conf || b.T - a.T || b.e.n - a.e.n); }
    const level = (c) => (c >= 75 ? 'High' : c >= 50 ? 'Medium' : 'Low');
    const slotOut = new Map();
    for (const sl of slots.values()) {
      const manual = mp['SLOT|' + sl.key], list = cat.byCh.get(sl.channel) || [], ranked = rank(sl, list), top = ranked[0];
      let entry = null, conf = 0, method = 'none', reason = '';
      if (manual === '-') method = 'ignored';
      else if (manual && cat.byKey.has(manual)) { entry = cat.byKey.get(manual); conf = 100; method = 'manual'; reason = 'you chose it'; }
      else if (top && top.conf >= minConf) { entry = top.e; conf = Math.round(top.conf * 100); method = top.method; reason = top.reason; }
      slotOut.set(sl.key, { entry, conf, method, reason, level: !entry ? 'None' : level(conf), manual: !!manual && manual !== '-' ? true : manual === '-',
        suggestions: ranked.filter((x) => x.conf >= 0.25).slice(0, 5).map((x) => ({ key: x.e.key, program: x.e.program, start: x.e.start_hm, days: x.e.day_label, confidence: Math.round(x.conf * 100), reason: x.reason })) });
    }
    const out = [];
    for (const g of groups.values()) {
      const list = cat.byCh.get(g.channel) || [], manual = mp[g.key], sl = slotOut.get(g.slot);
      let entry = null, conf = 0, method = 'none', reason = '';
      if (manual === '-') method = 'ignored';
      else if (manual && cat.byKey.has(manual)) { entry = cat.byKey.get(manual); conf = 100; method = 'manual'; reason = 'you chose it'; }
      else if (sl.method === 'ignored') method = 'ignored';
      else if (sl.entry) { entry = sl.entry; conf = sl.conf; method = sl.method; reason = sl.reason; }
      else {                                       // the slot found nothing: this name on its own, by its own time and name
        const top = rank({ members: [g], votes: g.votes, spots: g.spots, startSec: [...g.starts.entries()].sort((a, b) => b[1] - a[1]).map((x) => x[0])[0] ?? -1, dayCount: g.days }, list)[0];
        if (top && top.conf >= minConf) { entry = top.e; conf = Math.round(top.conf * 100); method = top.method; reason = top.reason; }
      }
      out.push({ key: g.key, slot: g.slot, channel: g.channel, lmrb_program: g.lmrb_program, spots: g.spots, spend: g.spend, tvr_key: entry ? entry.key : null, tvr_program: entry ? entry.program : null,
        tvr_start: entry ? entry.start_hm : null, tvr_days: entry ? entry.day_label : null, confidence: conf, method, reason, level: !entry ? 'None' : level(conf) });
    }
    const byGroup = new Map(out.map((m) => [m.slot, m]));
    const slotRows = [...slots.values()].map((sl) => { const r = slotOut.get(sl.key);
      // a slot that found nothing as a whole but whose names each found a programme: show what the names found
      let e = r.entry, conf = r.conf, method = r.method, reason = r.reason, lv = r.level;
      if (!e && r.method !== 'ignored') { const own = out.filter((m) => m.slot === sl.key && m.tvr_key).sort((a, b) => b.spend - a.spend)[0]; if (own) { e = cat.byKey.get(own.tvr_key); conf = own.confidence; method = own.method; reason = own.reason; lv = own.level; } }
      return { key: sl.key, channel: sl.channel, start: sl.start, days: sl.days, n_names: sl.members.length, spots: sl.spots, spend: sl.spend,
        names: sl.members.slice().sort((a, b) => b.spend - a.spend).slice(0, 60).map((g) => ({ name: g.lmrb_program, spots: g.spots, spend: g.spend })),
        tvr_key: e ? e.key : null, tvr_program: e ? e.program : null, tvr_start: e ? e.start_hm : null, tvr_days: e ? e.day_label : null, confidence: conf, level: lv, method, reason, suggestions: r.suggestions, approved: r.manual === true, ignored: r.method === 'ignored' }; })
      .sort((a, b) => b.spend - a.spend);
    void byGroup;
    out.sort((a, b) => b.spend - a.spend); out.slots = slotRows;
    return out;
  }

  /** Card and negotiated 30 sec rate for a TVR programme.
   *  Card rate: a rate typed for the programme, else the agency rate card (database) row that matches it, else the channel's prime / non prime rate.
   *  Negotiation: a rule typed for the programme, else the channel's own rule, else the rate card row's negotiated rate (a discount, or a special rate), else the default rule.
   *  A rate card row matches a TVR programme by channel + weekday + start time (within 15 minutes) first, then by name. */
  function rateResolver(o) {
    const R = o.rates || {}, N = o.nego || {}, byCh = new Map(), useCardNego = o.use_card_nego !== false, memo = new Map();
    for (const r of o.ratecard || []) { if (!byCh.has(r.channel)) byCh.set(r.channel, []); byCh.get(r.channel).push(r); }
    const days = (e) => { const mx = Math.max(...e.days); return e.days.map((c) => mx > 0 && c >= mx * 0.25); };
    const cardRow = (e) => {
      if (memo.has(e.key)) return memo.get(e.key);
      const list = byCh.get(e.channel); let best = null, bs = 0;
      if (list) {
        const ds = days(e);
        for (const r of list) {
          const ns = MR.pitchNameScore(e.program, r.programme), timeOk = e.start >= 0 && r.start != null && Math.abs(r.start - e.start) <= 900 && ds.some((on, i) => on && r.mask[i] === '1');
          const sc = timeOk ? 0.6 + 0.4 * ns : ns >= 0.85 ? 0.7 * ns : 0;
          if (sc > bs) { bs = sc; best = r; }
        }
      }
      const row = bs >= 0.6 ? best : null; memo.set(e.key, row); return row;
    };
    const typed = (e) => R.programmes && R.programmes[`${e.channel}|${e.program}`];
    const card = (e) => {
      const p = typed(e);
      if (p && p.rate > 0) return MR.pitchTo30(p.rate, p.secs);
      const row = cardRow(e); if (row && row.rack30 > 0) return row.rack30;
      const c = R.channels && R.channels[e.channel], d = c && (e.pt ? c.pt : c.npt);
      return d && d.rate > 0 ? MR.pitchTo30(d.rate, d.secs) : null;
    };
    const source = (e) => { const p = typed(e); if (p && p.rate > 0) return 'typed'; const row = cardRow(e); if (row && row.rack30 > 0) return 'rate card'; const c = R.channels && R.channels[e.channel], d = c && (e.pt ? c.pt : c.npt); return d && d.rate > 0 ? 'channel rate' : null; };
    const rule = (e) => {
      const pr = N.programmes && N.programmes[`${e.channel}|${e.program}`]; if (pr && pr.mode) return pr;
      const ch = N.channels && N.channels[e.channel]; if (ch && ch.mode) return ch;
      const pd = (o.plan_deals || {})[e.channel]; if (pd && pd.discount_pct !== undefined && pd.discount_pct !== null && pd.discount_pct !== '' && +pd.discount_pct >= 0) return { mode: 'discount', value: Math.min(+pd.discount_pct, 100) };
      const row = useCardNego ? cardRow(e) : null; if (row && row.neg_mode) return { mode: row.neg_mode, value: row.neg_value };
      return N.default || null;
    };
    return { card, rule, source, row: cardRow, neg: (e) => MR.pitchNegotiated(card(e), rule(e)) };
  }

  /** opts: see the README. L/lidx: LMRB table and rows, V: TVR table. */
  function pitchBuild(L, lidx, V, opts) {
    const o = { bands: {}, pt_start: 19 * 3600, pt_end: 22.5 * 3600, min_tvr: 1, max_spots: 2, budget_basis: 'com', objective: 'grp', use_card_nego: true, ratecard: [], deals: {}, plan_deals: {}, current_basis: 'lmrb', month: null, channels: [], daypart: 'all', excluded: [], ...opts };
    const dsAll = V.cols.data_set && V.dicts.data_set ? V.dicts.data_set : [], dsCount = new Map(); if (V.cols.data_set) for (let i = 0; i < V.n; i++) dsCount.set(V.cols.data_set[i], (dsCount.get(V.cols.data_set[i]) || 0) + 1);
    const dataSets = [...dsCount.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ name: dsAll[k], rows: n })), dataSet = dataSets.length > 1 ? (o.data_set && dataSets.some((x) => x.name === o.data_set) ? o.data_set : dataSets[0].name) : null;
    const cat = catalogue(V, dataSet);
    cat.byKey.forEach((e) => { e.pt = isPT(e.start, o); const cfg = (o.bands || {})[e.channel] || null, b = MR.pitchBands.classify(e, cfg); e.band = b.id; e.band_name = b.name; e.band_listed = b.listed; if (cfg && cfg.preset === 'abc') e.pt = b.prime; });      // the channel's own bands: prime A / B and non prime count as prime and non prime
    const tvrChannels = [...cat.byCh.keys()].sort(), inTvr = new Set(tvrChannels);
    const chAvg = {};      // channel -> average TVR of its prime time and non prime airings in the TVR sheet
    cat.byKey.forEach((e) => { const a = (chAvg[e.channel] = chAvg[e.channel] || { pt: [0, 0], npt: [0, 0] }), b = e.pt ? a.pt : a.npt; b[0] += e.tvr_sum; b[1] += e.n; });
    Object.values(chAvg).forEach((a) => { const all = (a.pt[0] + a.npt[0]) / Math.max(1, a.pt[1] + a.npt[1]); a.pt_tvr = a.pt[1] ? a.pt[0] / a.pt[1] : all; a.npt_tvr = a.npt[1] ? a.npt[0] / a.npt[1] : all; });
    const LC = L.cols, med = LC.medium, sponsor = L.dicts.theme.map(MR.isSponsorTheme);
    // TV rows of the LMRB sheet whose channel is in the TVR sheet
    const tvRows = [], skipped = new Map(), advSpend = new Map(); let noMedium = !med;
    const adv = LC.advertiser && L.dicts.advertiser ? LC.advertiser : null, advWanted = adv && o.advertiser ? o.advertiser : null;
    for (let k = 0; k < lidx.length; k++) {
      const i = lidx[k]; if (med && L.dicts.medium[med[i]] !== 'TV') continue;
      if (adv) { const an = L.dicts.advertiser[adv[i]]; advSpend.set(an, (advSpend.get(an) || 0) + LC.cost[i]); if (advWanted && an !== advWanted) continue; }      // the evaluation is about one advertiser
      const ch = L.dicts.channel[LC.channel[i]];
      if (inTvr.has(ch)) tvRows.push(i); else { const s = skipped.get(ch) || { channel: ch, spend: 0, spots: 0 }; s.spend += LC.cost[i]; s.spots++; skipped.set(ch, s); }
    }
    const allMonths = [...new Set(tvRows.map((i) => monthOf(LC.date[i])))].sort();
    const month = o.month && o.month !== 'all' && allMonths.includes(o.month) ? o.month : o.month === 'all' ? 'all' : allMonths[allMonths.length - 1] || null;
    const groups = matchGroups(L, tvRows, cat, o), slotRows = groups.slots, gmap = new Map(groups.map((g) => [g.key, g]));
    const rr = rateResolver(o);

    // overview: spend by channel and month, commercial and sponsorship
    const ov = new Map();
    for (const i of tvRows) {
      const ch = L.dicts.channel[LC.channel[i]], m = monthOf(LC.date[i]); let r = ov.get(ch); if (!r) ov.set(ch, (r = new Map()));
      const a = r.get(m) || { com: 0, va: 0 }; if (LC.theme[i] >= 0 && sponsor[LC.theme[i]]) a.va += LC.cost[i]; else a.com += LC.cost[i]; r.set(m, a);
    }

    // current buy for the chosen month: one pass, aggregated per TVR programme
    const sel = (i) => month === 'all' || monthOf(LC.date[i]) === month;
    const chWanted = new Set(o.channels || []);
    const prog = new Map(), spon = new Map(), unmatched = new Map(), aud = { view_spend: 0, view_spots: 0, no_duration_rows: 0, zero_cost_rows: 0, negative_cost_rows: 0 };
    for (const i of tvRows) {
      if (!sel(i)) continue;
      const ch = L.dicts.channel[LC.channel[i]]; if (chWanted.size && !chWanted.has(ch)) continue;
      aud.view_spend += LC.cost[i]; aud.view_spots++;      // read straight from the sheet, to prove nothing is lost or counted twice
      if (!(Number.isFinite(LC.dur[i]) && LC.dur[i] > 0)) aud.no_duration_rows++; if (LC.cost[i] < 0) aud.negative_cost_rows++; else if (!(LC.cost[i] > 0)) aud.zero_cost_rows++;
      const g = gmap.get(`${ch}|${L.dicts.program[LC.program[i]]}`), e = g && g.tvr_key ? cat.byKey.get(g.tvr_key) : null;
      const isVa = LC.theme[i] >= 0 && sponsor[LC.theme[i]], dur = Number.isFinite(LC.dur[i]) && LC.dur[i] > 0 ? LC.dur[i] : 30, eq = dur / 30, cost = LC.cost[i];
      if (isVa) {      // sponsorship items are grouped by channel + item; prime or not comes from the programme start (else the ad time), so they do not need a programme match
        const ps = LC.prog_sec[i] >= 0 ? LC.prog_sec[i] : LC.advt_sec[i], pt = ps >= 0 ? isPT(ps, o) : !!(e && e.pt);
        if (o.daypart !== 'all' && (o.daypart === 'PT') !== pt) continue;
        const th = L.dicts.theme[LC.theme[i]], k2 = `${ch}|${th}`; let s = spon.get(k2);
        if (!s) spon.set(k2, (s = { channel: ch, theme: th, spots: 0, eq30: 0, spend: 0, pt_spots: 0, npt_spots: 0, value: 0, rated_spend: 0, durs: new Map() }));
        s.spots++; s.eq30 += eq; s.spend += cost; if (pt) s.pt_spots++; else s.npt_spots++;
        const c30 = e ? rr.card(e) : null; if (c30 > 0) { s.value += c30 * eq; s.rated_spend += cost; }
        const dd = s.durs.get(dur) || { dur, spots: 0, eq30: 0, spend: 0, value: 0 }; dd.spots++; dd.eq30 += eq; dd.spend += cost; if (c30 > 0) dd.value += c30 * eq; s.durs.set(dur, dd);      // every real duration of the item (10, 5 ...), not an average
        continue;
      }
      if (!e) { const u = unmatched.get(g ? g.key : ch) || { channel: ch, lmrb_program: g ? g.lmrb_program : '', spots: 0, spend: 0, ignored: g && g.method === 'ignored' }; u.spots++; u.spend += cost; unmatched.set(g ? g.key : ch, u); continue; }
      if (o.daypart !== 'all' && (o.daypart === 'PT') !== e.pt) continue;
      const pk = `${e.key}|${g.lmrb_program}|${dur}`;      // one row per LMRB programme and duration, so the spot count is the one in the sheet
      let p = prog.get(pk);
      if (!p) prog.set(pk, (p = { e, lmrb: g.lmrb_program, dur, spots: 0, eq30: 0, cost: 0, dur_sum: 0 }));
      p.spots++; p.eq30 += eq; p.cost += cost; p.dur_sum += dur;
    }
    const rows = [...prog.values()].map((p) => {
      const e = p.e, card30 = rr.card(e), neg30 = rr.neg(e), avg30 = div(p.cost, p.eq30), grp = e.tvr * p.spots, ngrp = e.tvr * p.eq30;
      return { key: e.key, channel: e.channel, program: e.program, start: e.start_hm, end: e.end_hm, days: e.day_label, daypart: e.pt ? 'Prime' : 'Non prime', pt: e.pt, band: e.band, band_name: e.band_name, lmrb_program: p.lmrb, dur: p.dur, spots: p.spots, eq30: p.eq30, avg_dur: p.dur_sum / p.spots, cost: p.cost, avg_rate: div(p.cost, p.spots), card_rate: card30 > 0 ? (card30 * p.dur) / 30 : null, neg_rate: neg30 > 0 ? (neg30 * p.dur) / 30 : null, cost_lmrb: p.cost,
        avg30, tvr: e.tvr, airings: e.n, grp, ngrp, cprp: div(p.cost, ngrp), card30, neg30, value: card30 > 0 ? card30 * p.eq30 : null, rated: card30 > 0, zero_tvr: !(e.tvr > 0),
        card_src: rr.source(e), card_prog: rr.row(e) ? rr.row(e).programme : null, card_eff: rr.row(e) ? rr.row(e).effective_from : null };
    }).sort((a, b) => b.cost - a.cost);
    const monthsInView = month === 'all' ? Math.max(1, allMonths.length) : 1;
    const sponsorship = [...spon.values()].map((x) => { const a = chAvg[x.channel] || { pt_tvr: 0, npt_tvr: 0 }, tvr = (x.pt_spots * a.pt_tvr + x.npt_spots * a.npt_tvr) / x.spots;
      return { ...x, durs: [...x.durs.values()].sort((p, q) => q.spots - p.spots), spots_per_month: x.spots / monthsInView, avg_cost: x.spend / x.spots, spend_lmrb: x.spend, avg_pt_tvr: a.pt_tvr, avg_npt_tvr: a.npt_tvr, tvr, grp: tvr * x.spots, ngrp: tvr * x.eq30, cprp: div(x.spend, tvr * x.eq30) }; }).sort((a, b) => b.spend - a.spend);

    // ---- Deal and investment evidence. The agency's contract gives one investment per channel; a share of it (100%, 90%, 80%) buys the commercial spots, the rest
    //      pays for the sponsorship / frequency items. Without the real investment the previous agency's spend is estimated from what the programmes cost at the channel's rate card:
    //      spots x rack rate, commercial only. With it, the discount they really got is 1 - (commercial investment / that rack value).
    const pct0 = (v, dflt) => (+v > 0 ? Math.min(+v, 100) : dflt), has = (v) => v !== undefined && v !== null && v !== '' && Number.isFinite(+v) && +v >= 0;
    const dealOf = (ch) => { const d = (o.deals || {})[ch]; if (!d) return null; const inv = +d.investment > 0 ? +d.investment : null, disc = has(d.discount_pct) ? Math.min(+d.discount_pct, 100) : null; if (!inv && disc == null) return null;
      return { investment: inv, commercial_pct: pct0(d.commercial_pct, 100), prime_pct: pct0(d.prime_pct, null), discount_pct: disc }; };
    /** What we put into a channel (our plan): investment, commercial share, prime share, bonus %, and the discount we negotiate. */
    const planDealOf = (ch) => { const d = (o.plan_deals || {})[ch]; if (!d) return null; const inv = +d.investment > 0 ? +d.investment : null, disc = has(d.discount_pct) ? Math.min(+d.discount_pct, 100) : null, bonus = +d.bonus_pct > 0 ? +d.bonus_pct : null;
      if (!inv && disc == null && !bonus && !(+d.prime_pct > 0)) return null; return { investment: inv, commercial_pct: pct0(d.commercial_pct, 100), prime_pct: pct0(d.prime_pct, null), discount_pct: disc, bonus_pct: bonus }; };
    const evidence = [...new Set(rows.map((r) => r.channel))].map((ch) => {
      const R = rows.filter((r) => r.channel === ch), rated = R.filter((r) => r.rated), sum = (xs, f) => xs.reduce((a, x) => a + f(x), 0), d = dealOf(ch);
      const rack = sum(rated, (r) => r.value), lmrbCom = sum(R, (r) => r.cost_lmrb), ratedCost = sum(rated, (r) => r.cost_lmrb), unratedCost = lmrbCom - ratedCost;
      const ptV = sum(rated.filter((r) => r.pt), (r) => r.value), nptV = rack - ptV;
      // the commercial investment: the one entered x its commercial share, else worked out from the estimated discount (rack value x what is paid) plus what the unrated programmes cost
      const src = d && d.investment ? 'entered' : d && d.discount_pct != null ? 'from the discount' : null, comInv = src === 'entered' ? (d.investment * d.commercial_pct) / 100 : src ? rack * (1 - d.discount_pct / 100) + unratedCost : null;
      const coverage = lmrbCom > 0 ? (ratedCost / lmrbCom) * 100 : null, share = lmrbCom > 0 ? ratedCost / lmrbCom : 1;
      const comInvRated = comInv == null ? null : src === 'entered' ? comInv * share : rack * (1 - d.discount_pct / 100);                    // when some programmes have no rate, only their share of the investment is compared with the rack value
      return { channel: ch, spots: sum(R, (r) => r.spots), eq30: sum(R, (r) => r.eq30), rack_value: rack, lmrb_cost: lmrbCom, lmrb_rated_cost: ratedCost, lmrb_unrated_cost: unratedCost, coverage_pct: coverage,
        lmrb_pct_of_rack: rack > 0 ? (ratedCost / rack) * 100 : null, lmrb_discount_pct: rack > 0 ? (1 - ratedCost / rack) * 100 : null, unrated_programmes: R.length - rated.length,
        pt_value: ptV, npt_value: nptV, pt_share_pct: rack > 0 ? (ptV / rack) * 100 : null, deal: d, investment_source: src, commercial_investment: comInv, sponsorship_investment: src === 'entered' ? d.investment - comInv : null, typed_discount_pct: d && d.discount_pct != null ? d.discount_pct : null,
        implied_discount_pct: comInvRated != null && rack > 0 ? (1 - comInvRated / rack) * 100 : null, implied_pays_pct: comInvRated != null && rack > 0 ? (comInvRated / rack) * 100 : null,
        estimated_commercial_investment: rack + unratedCost, rows: R.map((r) => r.key) };
    }).map((e) => { e.discount_gap_pts = e.typed_discount_pct != null && e.investment_source === 'entered' && e.implied_discount_pct != null ? e.typed_discount_pct - e.implied_discount_pct : null; return e;
    });
    if (o.current_basis === 'actual') {           // the current buy at what was really paid: the investment is spread over the programmes in proportion to their rack value (one discount for the channel)
      for (const ev of evidence) {
        if (!ev.deal) continue;
        const R = rows.filter((r) => r.channel === ev.channel), rated = R.filter((r) => r.rated), base = ev.commercial_investment - ev.lmrb_unrated_cost;
        if (ev.rack_value > 0 && base > 0) { const k = base / ev.rack_value; rated.forEach((r) => { r.cost = r.value * k; }); }
        else if (ev.lmrb_cost > 0) { const f = ev.commercial_investment / ev.lmrb_cost; R.forEach((r) => { r.cost = r.cost_lmrb * f; }); }
        R.forEach((r) => { r.avg30 = div(r.cost, r.eq30); r.cprp = div(r.cost, r.ngrp); });
        const S = sponsorship.filter((x) => x.channel === ev.channel), lm = S.reduce((a, x) => a + x.spend_lmrb, 0), f2 = ev.sponsorship_investment == null ? 1 : lm > 0 ? ev.sponsorship_investment / lm : 0;
        S.forEach((x) => { x.spend = x.spend_lmrb * f2; x.rated_spend *= f2; x.avg_cost = x.spend / x.spots; x.cprp = div(x.spend, x.ngrp); });
      }
    }

    // per channel (current evaluation, ROI)
    const sumRows = (rs) => {
      const t = { spots: 0, eq30: 0, cost: 0, ngrp: 0, grp: 0, rated_cost: 0, value: 0, tvr_w: 0, tvr_n: 0, rated_eq30: 0, rated_ngrp: 0 };
      for (const r of rs) { t.spots += r.spots; t.eq30 += r.eq30; t.cost += r.cost; t.ngrp += r.ngrp; t.grp += r.grp; t.tvr_w += r.tvr * r.spots; t.tvr_n += r.spots; if (r.rated) { t.rated_cost += r.cost; t.value += r.value; t.rated_eq30 += r.eq30; t.rated_ngrp += r.ngrp; } }
      return t;
    };
    const chNames = [...new Set([...rows.map((r) => r.channel), ...sponsorship.map((s) => s.channel)])];
    const channels = chNames.map((ch) => {
      const R = rows.filter((r) => r.channel === ch), S = sponsorship.filter((s) => s.channel === ch), c = sumRows(R);
      const va = S.reduce((a, s) => ({ spend: a.spend + s.spend, spots: a.spots + s.spots, eq30: a.eq30 + s.eq30, ngrp: a.ngrp + s.ngrp, grp: a.grp + s.grp, rated_spend: a.rated_spend + s.rated_spend, value: a.value + s.value }), { spend: 0, spots: 0, eq30: 0, ngrp: 0, grp: 0, rated_spend: 0, value: 0 });
      const total = c.cost + va.spend, ratedAll = c.rated_cost + va.rated_spend, valueAll = c.value + va.value;
      return { channel: ch, com_spend: c.cost, va_spend: va.spend, spend: total, com_spots: c.spots, va_spots: va.spots, spots: c.spots + va.spots, eq30: c.eq30, ngrp: c.ngrp, grp: c.grp, avg30: div(c.cost, c.eq30), cprp: div(c.cost, c.ngrp),
        avg_tvr: div(c.tvr_w, c.tvr_n), com_value: c.value, all_value: valueAll, com_roi: div(c.value, c.rated_cost), all_roi: div(valueAll, ratedAll), rated_pct: total > 0 ? (ratedAll / total) * 100 : null, share_pct: null };
    }).sort((a, b) => b.spend - a.spend);
    const tot = channels.reduce((a, x) => a + x.spend, 0); channels.forEach((x) => { x.share_pct = tot > 0 ? (x.spend / tot) * 100 : null; });

    // prime / non prime
    const dp = (rs) => { const t = sumRows(rs); return { spend: t.cost, spots: t.spots, eq30: t.eq30, ngrp: t.ngrp, tvr: div(t.tvr_w, t.tvr_n), avg30: div(t.cost, t.eq30), cprp: div(t.cost, t.ngrp), avg30_card: div(t.value, t.rated_eq30), cprp_card: div(t.value, t.rated_ngrp), rated_pct: t.cost > 0 ? (t.rated_cost / t.cost) * 100 : null, rack_value: t.value }; };
    const PT = rows.filter((r) => r.pt), NPT = rows.filter((r) => !r.pt);
    const daypart = { prime: dp(PT), non_prime: dp(NPT), by_channel: chNames.map((ch) => ({ channel: ch, prime: dp(PT.filter((r) => r.channel === ch)), non_prime: dp(NPT.filter((r) => r.channel === ch)) })) };
    const totalsFor = (set) => {
      const R = set ? rows.filter((r) => set.has(r.channel)) : rows, S = set ? sponsorship.filter((x) => set.has(x.channel)) : sponsorship;
      const ct = sumRows(R), va = S.reduce((a, x) => ({ spend: a.spend + x.spend, spots: a.spots + x.spots, eq30: a.eq30 + x.eq30, ngrp: a.ngrp + x.ngrp, value: a.value + (x.value || 0), rated: a.rated + x.rated_spend }), { spend: 0, spots: 0, eq30: 0, ngrp: 0, value: 0, rated: 0 });
      const P = R.filter((r) => r.pt), N = R.filter((r) => !r.pt), dpt = dp(P), dnp = dp(N);
      return { com_spend: ct.cost, va_spend: va.spend, spend: ct.cost + va.spend, spots: ct.spots, eq30: ct.eq30, ngrp: ct.ngrp, avg30: div(ct.cost, ct.eq30), cprp: div(ct.cost, ct.ngrp), pt_tvr: dpt.tvr, npt_tvr: dnp.tvr,
        pt_spend_share: ct.cost > 0 ? (dpt.spend / ct.cost) * 100 : null, pt_spot_share: ct.spots > 0 ? (dpt.spots / ct.spots) * 100 : null,
        com_roi: div(ct.value, ct.rated_cost), all_roi: div(ct.value + va.value, ct.rated_cost + va.rated), rated_pct: ct.cost + va.spend > 0 ? ((ct.rated_cost + va.rated) / (ct.cost + va.spend)) * 100 : null, va };
    };
    const current = totalsFor(null);
    // channels where a plan can be built (they have candidate programmes with a rate); the comparison covers only those, on both sides
    const planned = new Set(); cat.byKey.forEach((e) => { if (chNames.includes(e.channel) && e.tvr >= o.min_tvr && e.tvr > 0 && rr.neg(e) > 0 && (o.daypart === 'all' || (o.daypart === 'PT') === e.pt)) planned.add(e.channel); });
    const allBasis = o.budget_basis === 'all', cmp = totalsFor(planned);
    if (allBasis) { cmp.spots += cmp.va.spots; cmp.eq30 += cmp.va.eq30; cmp.ngrp += cmp.va.ngrp; cmp.avg30 = div(cmp.spend, cmp.eq30); cmp.cprp = div(cmp.spend, cmp.ngrp); cmp.roi = cmp.all_roi; }
    else { cmp.spend = cmp.com_spend; cmp.roi = cmp.com_roi; }
    cmp.channels = [...planned].sort(); cmp.left_out = chNames.filter((c) => !planned.has(c));
    // our basket: same budget per channel, bought at our negotiated rates
    const budgets = {}, primeShare = {}, bandShares = {}, bandStrict = {};
    for (const x of channels) if (planned.has(x.channel)) { const d = dealOf(x.channel), pd = planDealOf(x.channel); budgets[x.channel] = pd && pd.investment ? (pd.investment * pd.commercial_pct) / 100 : o.budget_basis === 'deal' && d && d.investment ? (d.investment * d.commercial_pct) / 100 : allBasis ? x.spend : x.com_spend;
      const pp = pd && pd.prime_pct ? pd.prime_pct : d && d.prime_pct ? d.prime_pct : null; if (pp) primeShare[x.channel] = pp / 100;
      const cfg = (o.bands || {})[x.channel], sh = MR.pitchBands.shares(cfg); if (sh) { bandShares[x.channel] = sh; bandStrict[x.channel] = !!cfg.strict; delete primeShare[x.channel]; } }
    const cands = [];
    cat.byKey.forEach((e) => {
      if (!(e.channel in budgets) || !(e.tvr >= o.min_tvr) || !(e.tvr > 0)) return;
      if (o.daypart !== 'all' && (o.daypart === 'PT') !== e.pt) return;
      const neg30 = rr.neg(e); if (!(neg30 > 0)) return;
      cands.push({ key: e.key, channel: e.channel, program: e.program, start: e.start_hm, end: e.end_hm, days: e.day_label, daypart: e.pt ? 'Prime' : 'Non prime', pt: e.pt, band: e.band, band_name: e.band_name, tvr: e.tvr, card30: rr.card(e), neg30, cprp: neg30 / e.tvr, roi_ratio: rr.card(e) > 0 ? rr.card(e) / neg30 : null,
        per_month: e.per_month, cap: Math.max(1, Math.ceil(e.per_month * o.max_spots)) });
    });
    const plan = MR.pitchAllocate(cands, budgets, o.excluded, o.objective, { ...primeShare, ...bandShares }, bandStrict);
    const planTotals = MR.pitchPlanSummary(plan.rows, budgets);
    const planInputs = {};      // what was put into each channel, with the bonus the channel gives (a share of the commercial rate card value)
    for (const ch of Object.keys(budgets)) { const pd = planDealOf(ch), rv = plan.rows.filter((r) => r.channel === ch).reduce((a, r) => a + (r.card30 || 0) * r.spots, 0);
      planInputs[ch] = { ...(pd || {}), commercial_budget: budgets[ch], source: pd && pd.investment ? 'entered' : o.budget_basis === 'deal' && dealOf(ch) && dealOf(ch).investment ? 'current deal' : 'current buy', card_value: rv, bonus_allowed: pd && pd.bonus_pct ? (pd.bonus_pct / 100) * rv : 0 }; }

    // rates table (every TVR programme on the evaluated channels, with what the current agency paid)
    const paid = new Map(), pw = new Map(); for (const r of rows) { const a = pw.get(r.key) || [0, 0]; a[0] += r.cost; a[1] += r.eq30; pw.set(r.key, a); } pw.forEach((a, k) => paid.set(k, div(a[0], a[1])));
    const ratesRows = [];
    cat.byKey.forEach((e) => {
      if (!(chWanted.size ? chWanted.has(e.channel) : inTvr.has(e.channel))) return;
      const card30 = rr.card(e), neg30 = rr.neg(e), rule = rr.rule(e);
      ratesRows.push({ key: e.key, channel: e.channel, program: e.program, start: e.start_hm, days: e.day_label, daypart: e.pt ? 'Prime' : 'Non prime', tvr: e.tvr, in_buy: paid.has(e.key), paid30: paid.get(e.key) ?? null,
        card30, neg30, card_src: rr.source(e), card_prog: rr.row(e) ? rr.row(e).programme : null, card_eff: rr.row(e) ? rr.row(e).effective_from : null, rule_mode: rule ? rule.mode : 'none', rule_value: rule ? rule.value : null, saving_pct: card30 > 0 && neg30 > 0 ? (1 - neg30 / card30) * 100 : null,
        saving_vs_paid_pct: paid.get(e.key) > 0 && neg30 > 0 ? (1 - neg30 / paid.get(e.key)) * 100 : null });
    });

    const unm = [...unmatched.values()].filter((u) => !u.ignored), missing = rows.filter((r) => !r.rated);
    const warnings = {
      unmatched_programmes: unm.length, unmatched_spend: unm.reduce((a, u) => a + u.spend, 0), unmatched_list: unm.sort((a, b) => b.spend - a.spend).slice(0, 25),
      missing_rate_programmes: missing.length, missing_rate_spend: missing.reduce((a, r) => a + r.cost, 0), missing_rate_list: missing.slice(0, 25).map((r) => ({ channel: r.channel, program: r.program, cost: r.cost })),
      zero_tvr_programmes: rows.filter((r) => r.zero_tvr).length, zero_tvr_rows: [...cat.byKey.values()].reduce((a, e) => a + e.zero, 0), low_confidence_matches: groups.filter((g) => g.level === 'Low' || g.level === 'Medium').length,
      skipped_channels: [...skipped.values()].sort((a, b) => b.spend - a.spend), no_medium: noMedium, candidates_without_rate: [...cat.byKey.values()].filter((e) => e.channel in budgets && e.tvr >= o.min_tvr && !(rr.neg(e) > 0)).length };
    return { empty: !rows.length && !sponsorship.length, data_sets: dataSets, data_set: dataSet, audit: { ...aud, merged_tvr_slots: cat.merged_slots }, advertiser: advWanted, advertisers: [...advSpend.entries()].sort((a, b) => b[1] - a[1]).map(([name, spend]) => ({ name, spend })), month, months: allMonths, tvr_months: cat.months, tvr_channels: tvrChannels, settings: { pt_start: o.pt_start, pt_end: o.pt_end, min_tvr: o.min_tvr, max_spots: o.max_spots, budget_basis: o.budget_basis, objective: o.objective, current_basis: o.current_basis },
      overview: { months: allMonths, rows: [...ov.entries()].map(([channel, m]) => ({ channel, months: allMonths.map((k) => m.get(k) || { com: 0, va: 0 }) })).sort((a, b) => b.months.reduce((s, x) => s + x.com + x.va, 0) - a.months.reduce((s, x) => s + x.com + x.va, 0)) },
      matches: groups, slots: slotRows, catalogue: [...cat.byCh.entries()].reduce((m, [ch, list]) => { m[ch] = list.sort((a, b) => b.n - a.n).map((e) => ({ key: e.key, program: e.program, label: `${e.program} (${e.start_hm || 'no time'}, ${e.day_label})`, start: e.start_hm, end: e.end_hm, days: e.day_label, tvr: e.tvr, pt: e.pt, band: e.band, band_name: e.band_name, card30: rr.card(e), neg30: rr.neg(e) })); return m; }, {}),
      current: { ...current, rows, sponsorship, channels, daypart }, candidates: cands, budgets, plan: { rows: plan.rows, channels: plan.channels, totals: planTotals }, rates: ratesRows, warnings, evidence, prime_share: primeShare, band_shares: bandShares, band_strict: bandStrict, bands: Object.fromEntries(tvrChannels.map((ch) => [ch, { set: MR.pitchBands.bandSet((o.bands || {})[ch]), preset: ((o.bands || {})[ch] || {}).preset || 'pt', uncategorised: (o.bands || {})[ch] && o.bands[ch].preset === 'abc' ? [...cat.byKey.values()].filter((e) => e.channel === ch && !e.band_listed).map((e) => ({ key: e.key, program: e.program, days: e.day_label, start: e.start_hm })) : [] }])), plan_inputs: planInputs,
      comparison: { ...MR.pitchCompare(cmp, planTotals), current: cmp, basis: allBasis ? 'all' : 'com' } };
  }

  Object.assign(MR, { pitchBuild, pitchSim: (a, b) => MR.pitchNameScore(a, b), pitchCatalogue: catalogue });
})(typeof self !== 'undefined' ? self : globalThis);
