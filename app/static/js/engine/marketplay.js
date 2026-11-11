/* Competitor playbook from the LMRB: when do rivals spend (salary days, weekends), how does each rival run its campaigns,
 * and what is each likely to do next. Pure functions on the columnar table, so they run in the data worker and in Node tests.
 * Everything here is measured from the data; the "next move" lines are estimates and are labelled as such by the page. */
(function (root) {
  const MR = root.MR;
  const { S, isoFromDay, dowMon, weekStart } = MR;
  const finite = (v) => v != null && Number.isFinite(v);
  const median = (a) => { const v = a.filter(finite).sort((x, y) => x - y); if (!v.length) return null; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
  const sum = (a) => a.reduce((x, y) => x + (finite(y) ? y : 0), 0);
  const BANDS = [['1st to 3rd', 1, 3], ['4th to 10th', 4, 10], ['11th to 17th', 11, 17], ['18th to 24th', 18, 24], ['25th to month end', 25, 31]];
  const WINDOW_DEFAULT = { from: 25, to: 3 };            // salary days: the last week of the month and the first days of the next
  const inWindow = (dom, w) => (w.from > w.to ? dom >= w.from || dom <= w.to : dom >= w.from && dom <= w.to);

  /** Daily spend by calendar day for one set of rows. Missing days count as zero. */
  function dailyMap(L, idx, pick) {
    const m = new Map();
    for (let k = 0; k < idx.length; k++) { const i = idx[k]; if (pick && !pick(i)) continue; const d = L.cols.date[i], c = L.cols.cost[i]; if (finite(c)) m.set(d, (m.get(d) || 0) + c); }
    return m;
  }

  /** Index of a window of days against the month it sits in, taken over every full month; the middle value so one big month cannot decide it. */
  function calendarIndex(daily, lo, hi, test) {
    const months = new Map();
    for (let d = lo; d <= hi; d++) {
      const iso = isoFromDay(d), mk = iso.slice(0, 7), dom = +iso.slice(8), v = daily.get(d) || 0;
      let m = months.get(mk); if (!m) { m = { n: 0, t: 0, wn: 0, wt: 0, first: d, last: d }; months.set(mk, m); }
      m.n++; m.t += v; m.last = d; if (test(dom, d)) { m.wn++; m.wt += v; }
    }
    const per = [];
    for (const m of months.values()) {
      const full = m.first === lo ? +isoFromDay(m.first).slice(8) === 1 : true, endFull = m.last === hi ? isoFromDay(m.last + 1).slice(8) === '01' : true;
      if (!full || !endFull || m.t <= 0 || m.wn === 0 || m.wn === m.n) continue;
      per.push((m.wt / m.wn) / (m.t / m.n));
    }
    const idx = median(per);
    return { index: idx, lift_pct: idx != null ? (idx - 1) * 100 : null, months: per.length, share: null };
  }

  /** Weekly spend bursts (a week well above the weeks before it), with the start dates used for the cycle. */
  function episodes(weekly, w0) {
    const arr = weekly, peak = Math.max(...arr, 0), eps = []; let cur = null;
    for (let j = 0; j < arr.length; j++) {
      const prev = arr.slice(Math.max(0, j - 8), j); if (prev.length < 3) continue;
      const base = median(prev) || 0, hit = arr[j] >= peak * 0.12 && (base > 0 ? arr[j] > base * 1.4 : arr[j] > 0);
      if (hit) { if (cur && cur.endW === j - 1) { cur.endW = j; cur.spend += arr[j]; } else { cur = { startW: j, endW: j, spend: arr[j] }; eps.push(cur); } }
    }
    return eps.map((e) => ({ start: w0 + e.startW * 7, end: w0 + e.endW * 7 + 6, weeks: e.endW - e.startW + 1, spend: e.spend }));
  }

  const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

  /**
   * opts: { top: rivals to profile (default 12), my_brand, window: {from,to}, today: day number (default: last data day) }
   */
  function marketPlay(L, idx, opts = {}) {
    const out = { ok: false, notes: [], window: { ...WINDOW_DEFAULT, ...(opts.window || {}) } };
    if (opts.product_group) idx = idx.filter((i) => S(L, 'product_group', i) === opts.product_group);
    if (!idx.length) { out.notes.push('No LMRB rows match the current filters.'); return out; }
    const [lo, hi] = MR.minMax(L.cols.date, idx), W = out.window;
    out.date_min = isoFromDay(lo); out.date_max = isoFromDay(hi); out.months = Math.round((hi - lo) / 30.4);
    const today = Number.isFinite(opts.today) ? opts.today : hi;
    out.today = isoFromDay(today);
    const market = dailyMap(L, idx), total = sum([...market.values()]);
    // market calendar behaviour
    const pay = calendarIndex(market, lo, hi, (dom) => inWindow(dom, W));
    pay.share = (() => { let s = 0; for (const [d, v] of market) if (inWindow(+isoFromDay(d).slice(8), W)) s += v; return total > 0 ? s / total : null; })();
    const wkd = calendarIndex(market, lo, hi, (dom, d) => dowMon(d) >= 5);
    const bands = BANDS.map(([label, a, b]) => ({ label, ...calendarIndex(market, lo, hi, (dom) => dom >= a && dom <= b) }));
    const dow = MR.DAY_NAMES.map((name, k) => ({ name, ...calendarIndex(market, lo, hi, (dom, d) => dowMon(d) === k) }));
    out.market = { total, payday: pay, weekend: wkd, bands, dow, enough: out.months >= 4 };
    if (!out.market.enough) out.notes.push('Under 4 months of LMRB data: salary day and weekend patterns are shown but are not reliable yet.');
    // who to profile
    const byAdv = new Map(); for (let k = 0; k < idx.length; k++) { const i = idx[k], a = S(L, 'advertiser', i); byAdv.set(a, (byAdv.get(a) || 0) + (finite(L.cols.cost[i]) ? L.cols.cost[i] : 0)); }
    const names = top(byAdv, opts.top || 12).map((e) => e[0]);
    const rows = [];
    const recentFrom = hi - 90, priorFrom = hi - 181;
    for (const a of names) {
      const ai = idx.filter((i) => S(L, 'advertiser', i) === a);
      const daily = dailyMap(L, ai), spend = byAdv.get(a);
      const [alo, ahi] = MR.minMax(L.cols.date, ai);
      // weekly series for flights
      const w0 = weekStart(alo), w1 = weekStart(ahi), weekly = [];
      const wm = new Map(); for (const [d, v] of daily) { const w = weekStart(d); wm.set(w, (wm.get(w) || 0) + v); }
      for (let w = w0; w <= w1; w += 7) weekly.push(wm.get(w) || 0);
      const eps = episodes(weekly, w0), starts = eps.map((e) => e.start);
      const gaps = starts.slice(1).map((s, k) => s - starts[k]), cycle = median(gaps), flightWeeks = median(eps.map((e) => e.weeks));
      const mean = gaps.length ? sum(gaps) / gaps.length : null, cv = mean ? Math.sqrt(sum(gaps.map((g) => (g - mean) ** 2)) / gaps.length) / mean : null;
      const lastStart = starts.length ? starts[starts.length - 1] : null, lastEp = eps.length ? eps[eps.length - 1] : null;
      // salary day behaviour of this rival (uses the same full-month window as the market)
      const pi = (alo > lo || ahi < hi) ? calendarIndex(daily, Math.max(lo, alo), Math.min(hi, ahi), (dom) => inWindow(dom, W)) : calendarIndex(daily, lo, hi, (dom) => inWindow(dom, W));
      const startInWindow = starts.length ? starts.filter((d) => inWindow(+isoFromDay(d).slice(8), W)).length / starts.length : null;
      // mix now against before
      const mixNow = new Map(), mixPrev = new Map(), dpNow = new Map();
      for (const i of ai) { const d = L.cols.date[i], c = L.cols.cost[i]; if (!finite(c)) continue; if (d > recentFrom) { const ch = S(L, 'channel', i); mixNow.set(ch, (mixNow.get(ch) || 0) + c); const dp = S(L, 'daypart', i); dpNow.set(dp, (dpNow.get(dp) || 0) + c); } else if (d > priorFrom) { const ch = S(L, 'channel', i); mixPrev.set(ch, (mixPrev.get(ch) || 0) + c); } }
      const nowT = sum([...mixNow.values()]), prevT = sum([...mixPrev.values()]);
      const chNow = top(mixNow, 3).map(([ch, v]) => ({ channel: ch, share: nowT > 0 ? v / nowT : 0 }));
      const risers = [...mixNow.keys()].map((ch) => ({ channel: ch, now: nowT > 0 ? mixNow.get(ch) / nowT : 0, before: prevT > 0 ? (mixPrev.get(ch) || 0) / prevT : 0 })).map((x) => ({ ...x, shift: x.now - x.before })).filter((x) => prevT > 0).sort((x, y) => y.shift - x.shift);
      // the last 8 weeks against the 8 before
      let r8 = 0, p8 = 0; for (const [d, v] of daily) { if (d > hi - 56) r8 += v; else if (d > hi - 112) p8 += v; }
      const trend = p8 > 0 ? (r8 / p8 - 1) * 100 : (r8 > 0 ? null : 0);
      const inFlight = !!lastEp && lastEp.end >= hi - 13;
      // next move
      let next = null, confidence = 'Low', basis = '';
      const quiet = hi - (ahi || hi) > 90;
      if (quiet) { basis = `No spend since ${isoFromDay(ahi)}, so no next move is predicted.`; }
      else if (cycle && starts.length >= 3) {
        let ns = lastStart + Math.round(cycle); while (ns < today - 7 && cycle > 0) ns += Math.round(cycle);   // keep the cycle going until it reaches the future
        const regular = cv != null && cv < 0.35;
        confidence = starts.length >= 5 && regular ? 'High' : starts.length >= 4 ? 'Medium' : 'Low';
        if (startInWindow != null && startInWindow >= 0.6) { // they like to launch on salary days: pull the date to the next salary window start
          let d = ns; for (let k = 0; k < 40 && !inWindow(+isoFromDay(d).slice(8), W); k++) d++;
          if (Math.abs(d - ns) <= 14) ns = d;
        }
        const ahead = Math.round((ns - lastStart) / cycle); if (ahead >= 3) confidence = 'Low';
        next = { date: isoFromDay(ns), days_from_today: ns - today, cycle_days: Math.round(cycle), flights: starts.length, cycles_ahead: ahead };
        basis = `${ahead >= 3 ? `Projected ${ahead} cycles past the last flight (${isoFromDay(lastStart)}), so treat the date as rough. ` : ''}${starts.length} past flights about ${Math.round(cycle)} days apart${regular ? ', fairly regular' : ', not very regular'}${startInWindow != null && startInWindow >= 0.6 ? `; ${Math.round(startInWindow * 100)}% start on salary days` : ''}`;
      } else if (inFlight) { basis = 'Running a flight now; not enough past flights to time the next one.'; }
      else basis = 'Too few separate flights in the data to time the next one.';
      rows.push({
        advertiser: a, is_me: a === opts.my_brand, spend, share: total > 0 ? spend / total : null,
        payday: { index: pi.index, lift_pct: pi.lift_pct, months: pi.months, starts_in_window: startInWindow },
        flights: { count: eps.length, median_weeks: flightWeeks, cycle_days: cycle != null ? Math.round(cycle) : null, last_start: lastStart != null ? isoFromDay(lastStart) : null, last_end: lastEp ? isoFromDay(lastEp.end) : null, in_flight: inFlight },
        trend_pct: trend, recent_spend: r8, channels: chNow, daypart: top(dpNow, 1).map(([d]) => d)[0] || null,
        mover: risers.length && risers[0].shift > 0.08 ? risers[0] : null, faller: risers.length && risers[risers.length - 1].shift < -0.08 ? risers[risers.length - 1] : null,
        next, confidence, basis,
      });
    }
    out.rivals = rows; out.ok = true;
    return out;
  }

  Object.assign(MR, { marketPlay, CAL_WINDOW: WINDOW_DEFAULT, CAL_BANDS: BANDS });
})(typeof self !== 'undefined' ? self : globalThis);
