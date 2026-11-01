/* Match LMRB spots to TVR programmes for GRPs and CPRP. Mirrors app/services/joins.py.
 * Each spot gets the average TVR of the programme airing on the same channel and date at the spot time.
 */
(function (root) {
  const MR = root.MR;
  const { S } = MR;
  const cache = new Map();

  function pickDataSet(T, wanted) {
    const counts = new Map();
    for (let i = 0; i < T.n; i++) { const d = S(T, 'data_set', i); counts.set(d, (counts.get(d) || 0) + 1); }
    if (wanted && counts.has(wanted)) return wanted;
    let best = null, n = -1; for (const [k, v] of counts) if (v > n) { best = k; n = v; }
    return best;
  }

  /** Returns a copy of L with grp, matched_program and cost_matched columns, plus join statistics. */
  function matchSpots(L, T, dataSet) {
    const ds = pickDataSet(T, dataSet), dsCode = T.dicts.data_set.indexOf(ds);
    const byKey = new Map();
    for (let i = 0; i < T.n; i++) {
      if (dsCode >= 0 && T.cols.data_set[i] !== dsCode) continue;
      const st = T.cols.start[i]; if (st < 0) continue;
      let en = T.cols.end[i];
      if (en < 0) en = st + (Number.isFinite(T.cols.duration[i]) ? T.cols.duration[i] : 30) * 60;
      if (en <= st) en += 86400;
      const key = S(T, 'channel', i) + '|' + T.cols.date[i];
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push([st, en, T.cols.tvr[i], i]);
    }
    for (const arr of byKey.values()) arr.sort((a, b) => a[0] - b[0]);
    const tvCh = new Set(); for (let i = 0; i < T.n; i++) if (dsCode < 0 || T.cols.data_set[i] === dsCode) tvCh.add(S(T, 'channel', i));
    const grp = new Float64Array(L.n).fill(NaN), costM = new Float64Array(L.n), prog = new Int32Array(L.n).fill(-1);
    const pd = new MR.DictCol();
    let matched = 0;
    let onRated = 0;
    for (let i = 0; i < L.n; i++) {
      const ch = S(L, 'channel', i);
      if (tvCh.has(ch)) onRated++;
      const sec = L.cols.sec[i]; if (sec < 0) continue;
      const arr = byKey.get(ch + '|' + L.cols.date[i]); if (!arr) continue;
      let lo = 0, hi = arr.length - 1, hit = -1;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (arr[mid][0] <= sec) { hit = mid; lo = mid + 1; } else hi = mid - 1; }   // last start <= spot time
      if (hit < 0 || !(sec < arr[hit][1])) continue;
      grp[i] = arr[hit][2]; prog[i] = pd.code(S(T, 'program', arr[hit][3])); matched++;
      if (grp[i] > 0) costM[i] = L.cols.cost[i];
    }
    const out = { ...L, cols: { ...L.cols, grp, cost_matched: costM, matched_program: prog }, dicts: { ...L.dicts, matched_program: pd.dict } };
    let dmin = Infinity, dmax = -Infinity; for (let i = 0; i < T.n; i++) { dmin = Math.min(dmin, T.cols.date[i]); dmax = Math.max(dmax, T.cols.date[i]); }
    out.grpStats = { data_set: ds, data_sets: [...new Set(T.dicts.data_set)].sort(), spots: L.n, matched_spots: matched, match_rate_pct: L.n ? (matched / L.n) * 100 : 0,
      spots_on_rated_channels_pct: L.n ? (onRated / L.n) * 100 : 0, tv_date_range: [MR.isoFromDay(dmin), MR.isoFromDay(dmax)] };
    return out;
  }

  /** Cached by both table signatures and the audience. */
  function withGrps(L, T, dataSet) {
    const key = `${L.sig || L.n}|${T.sig || T.n}|${dataSet || ''}`;
    if (cache.has(key)) return cache.get(key);
    const out = matchSpots(L, T, dataSet);
    cache.clear(); cache.set(key, out);
    return out;
  }

  Object.assign(MR, { withGrps, matchSpots });
})(typeof self !== 'undefined' ? self : globalThis);
