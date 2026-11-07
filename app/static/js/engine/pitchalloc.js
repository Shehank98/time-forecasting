/* Client Pitch Evaluator: basket allocation. Pure functions, no dependencies, used in the data worker, in the page (live toggles) and in tests.
 *
 * Each channel has its own budget (what the current agency spent on that channel). Candidates are TVR programmes with a negotiated 30 sec rate and a TVR.
 * The cheapest rating points come first: candidates are sorted by CPRP = negotiated 30 sec rate / programme TVR, and each is bought up to its capacity
 * (episodes per month x max spots per episode) until the channel budget is used.
 */
(function (root) {
  const MR = root.MR = root.MR || {};

  /**
   * cands: [{key, channel, tvr, neg30, cap, ...}], budgets: {channel: LKR}, excluded: Set|array of keys the user switched off.
   * Returns {rows: [{...cand, spots, spend, grp}], channels: {channel: {budget, spend, left, spots, grp}}}
   */
  function pitchAllocate(cands, budgets, excluded, objective, primeShare, strict) {
    const off = new Set(excluded || []), byCh = new Map();
    for (const c of cands) { if (!byCh.has(c.channel)) byCh.set(c.channel, []); byCh.get(c.channel).push(c); }
    const rows = [], channels = {};
    for (const [ch, budget] of Object.entries(budgets || {})) {
      const list = (byCh.get(ch) || []).filter((c) => !off.has(c.key) && c.neg30 > 0 && c.tvr > 0);
      const mxE = Math.max(1e-12, ...list.map((c) => 1 / c.cprp)), mxR = Math.max(1e-12, ...list.map((c) => c.roi_ratio || 0));
      const score = (c) => (objective === 'roi' ? c.roi_ratio || 0 : objective === 'balanced' ? (1 / c.cprp) / mxE + (c.roi_ratio || 0) / mxR : 1 / c.cprp);
      list.sort((a, b) => score(b) - score(a) || a.cprp - b.cprp || b.tvr - a.tvr || (a.key < b.key ? -1 : 1));
      const bought = new Map(), order = [];
      let left = budget;
      const buy = (items, cap) => {                      // buy in order until `cap` (a part of the budget) is used
        let room = Math.min(cap, left);
        for (const c of items) {
          const have = bought.get(c.key) ? bought.get(c.key).spots : 0, n = Math.max(0, Math.min(c.cap - have, Math.floor((room + 1e-9) / c.neg30)));
          if (!n) continue;
          const cost = n * c.neg30; room -= cost; left -= cost;
          let r = bought.get(c.key); if (!r) { r = { ...c, spots: 0, spend: 0, grp: 0 }; bought.set(c.key, r); order.push(r); }
          r.spots += n; r.spend += cost; r.grp += n * c.tvr;
        }
      };
      const share = primeShare && primeShare[ch];
      if (share && typeof share === 'object') {                    // bands with their own shares of the budget (Prime A / B / non prime, weekday / weekend ...)
        for (const id of Object.keys(share)) buy(list.filter((c) => c.band === id), budget * share[id]);
        if (!(strict && strict[ch])) buy(list, left);              // not strict: what a band cannot spend goes to the others
      } else if (share > 0 && share < 1) { buy(list.filter((c) => c.pt), budget * share); buy(list.filter((c) => !c.pt), budget * (1 - share)); buy(list, left); }      // what one side cannot spend goes to the other
      else buy(list, budget);
      let spend = 0, spots = 0, grp = 0; for (const r of order) { rows.push(r); spend += r.spend; spots += r.spots; grp += r.grp; }
      channels[ch] = { budget, spend, left: budget - spend, spots, grp };
    }
    return { rows, channels };
  }

  /** Negotiated 30 sec rate from a card rate and a rule {mode: 'discount'|'flat'|'special'|'none', value}. */
  function negotiated(card30, rule) {
    const m = rule && rule.mode, v = rule ? Number(rule.value) : NaN;
    if ((m === 'flat' || m === 'special') && v > 0) return v;
    if (m === 'discount' && Number.isFinite(v) && card30 > 0) return card30 * (1 - Math.min(Math.max(v, 0), 100) / 100);
    return card30 > 0 ? card30 : null;
  }

  /** A rate typed for N seconds, as the equivalent 30 second rate (rates scale with length). */
  function to30(rate, secs) { const r = Number(rate), s = Number(secs) > 0 ? Number(secs) : 30; return r > 0 ? (r * 30) / s : null; }

  const div = (a, b) => (b > 0 ? a / b : null);
  /** Totals of a plan, in the same terms as the current buy. All plan spots are 30 sec, so equivalents = spots. */
  function planSummary(rows, budgets) {
    let spend = 0, spots = 0, grp = 0, value = 0, valued = 0, ptT = 0, ptN = 0, npT = 0, npN = 0, ptS = 0, ptSp = 0;
    for (const r of rows) { spend += r.spend; spots += r.spots; grp += r.grp; if (r.card30 > 0) { value += r.card30 * r.spots; valued += r.spend; } if (r.pt) { ptT += r.tvr * r.spots; ptN += r.spots; ptS += r.spend; ptSp += r.spots; } else { npT += r.tvr * r.spots; npN += r.spots; } }
    const budget = Object.values(budgets).reduce((a, b) => a + b, 0);
    return { budget, spend, unspent: budget - spend, spots, eq30: spots, ngrp: grp, avg30: div(spend, spots), cprp: div(spend, grp), pt_tvr: div(ptT, ptN), npt_tvr: div(npT, npN), pt_spend_share: spend > 0 ? (ptS / spend) * 100 : null,
      pt_spot_share: spots > 0 ? (ptSp / spots) * 100 : null, roi: div(value, valued), valued_pct: spend > 0 ? (valued / spend) * 100 : null };
  }
  function compare(cur, plan) {
    const gain = (a, b) => (a > 0 && b != null ? (b / a - 1) * 100 : null);
    const g = gain(cur.ngrp, plan.ngrp), c = cur.cprp > 0 && plan.cprp > 0 ? (1 - plan.cprp / cur.cprp) * 100 : null;
    let sentence = 'Add rates and run the plan to see the comparison.';
    const same = cur.spend > 0 && Math.abs(plan.budget / cur.spend - 1) <= 0.02, bd = same ? 'for the same budget' : `with a budget ${plan.budget < cur.spend ? Math.abs((plan.budget / cur.spend - 1) * 100).toFixed(0) + '% lower' : Math.abs((plan.budget / cur.spend - 1) * 100).toFixed(0) + '% higher'} than the current buy`;
    if (g != null && cur.ngrp > 0 && plan.spend > 0) sentence = g >= 0 ? `${g.toFixed(1)}% more GRPs ${bd}: ${plan.ngrp.toFixed(1)} against ${cur.ngrp.toFixed(1)}, and ${c != null ? Math.abs(c).toFixed(1) + (c >= 0 ? '% lower' : '% higher') + ' cost per rating point' : 'a different cost per rating point'}.` : `The plan delivers ${Math.abs(g).toFixed(1)}% fewer GRPs than the current buy with these rates and limits. Check the rates, the minimum TVR and the max spots per episode.`;
    const unspent = plan.budget > 0 && plan.unspent > 0.02 * plan.budget;
    if (unspent && c != null) sentence = `${c >= 0 ? Math.abs(c).toFixed(1) + '% lower' : Math.abs(c).toFixed(1) + '% higher'} cost per rating point than the current buy. The plan uses ${((plan.spend / plan.budget) * 100).toFixed(0)}% of the budget with the current limits: raise the max spots per episode or add rates to use all of it.`;
    return { unspent, grp_gain_pct: g, cprp_gain_pct: c, avg30_change_pct: cur.avg30 > 0 && plan.avg30 > 0 ? (plan.avg30 / cur.avg30 - 1) * 100 : null, pt_tvr_gain_pct: gain(cur.pt_tvr, plan.pt_tvr), npt_tvr_gain_pct: gain(cur.npt_tvr, plan.npt_tvr),
      roi_gain_pts: cur.roi != null && plan.roi != null ? plan.roi - cur.roi : null, sentence };
  }

  Object.assign(MR, { pitchPlanSummary: planSummary, pitchCompare: compare, pitchAllocate, pitchNegotiated: negotiated, pitchTo30: to30 });
})(typeof self !== 'undefined' ? self : globalThis);
