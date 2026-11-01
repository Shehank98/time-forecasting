/* Client KPI sheets (spend, leads, sales, traffic, GRPs...) in the browser. Mirrors app/services/ingest_kpi.py.
 * Step 1 proposeKpi: read the sheet, find the header row, detect date, segment and metric columns, suggest ratios.
 * Step 2 applyKpi: with the planner's confirmed mapping, build a columnar table plus a parsing report.
 */
(function (root) {
  const MR = root.MR;
  const { IngestError, parseDate, parseNum, isoFromDay } = MR;
  const MAX_KPI_ROWS = 3000000;

  const CURRENCY = /spend|cost|budget|invest|revenue|sales.?value|amount|lkr|rs\b|\bprice|cpc|cpm|cpl|cpa/i;
  const DRIVER = /spend|cost|budget|invest|price|discount|promo/i;
  const RATE = /ctr|cvr|rate|%|pct|percent|share|tvr|rating|avg|average|position|frequency/i;
  const RATIO_TARGETS = [
    [/lead/i, 'cpl', 'Cost per lead (CPL)', 1],
    [/conversion|acquisition|signup|sign.?up|registration|install|order|purchase|sale(?!s.?value)|customer|account/i, 'cpa', 'Cost per acquisition (CPA)', 1],
    [/click/i, 'cpc', 'Cost per click (CPC)', 1],
    [/impression|views?\b/i, 'cpm', 'Cost per thousand impressions (CPM)', 1000],
    [/\bgrps?\b|\btrps?\b|rating.?points/i, 'cprp', 'Cost per rating point (CPRP)', 1],
    [/visit|session|traffic/i, 'cpv', 'Cost per visit', 1],
  ];

  const slug = (s) => (String(s == null ? '' : s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'col').slice(0, 40);
  const isNA = (v) => v == null || (typeof v === 'number' && Number.isNaN(v)) || (typeof v === 'string' && v === '');
  const blank = (v) => isNA(v) || ['', 'nan', 'None'].includes(String(v).trim());
  const str = (v) => (v instanceof Date ? isoFromDay(parseDate(v)) : String(v));

  function headerRow(raw) {
    let best = 0, score = -1;
    for (let i = 0; i < Math.min(15, raw.length); i++) {
      const vals = raw[i].filter((v) => !blank(v));
      const texty = vals.filter((v) => typeof v === 'string' && !/^[\d.,/\-: ]+$/.test(v.trim())).length;
      if (texty >= 2 && texty > score) { best = i; score = texty; if (texty >= Math.max(2, vals.length * 0.8)) break; }
    }
    return best;
  }

  /** Read the sheet and suggest a mapping. Returns {proposal, pending}; pending stays in the worker for step 2. */
  async function proposeKpi(file, onProgress) {
    let rows = [];
    await MR.readRows(file, (r) => { rows.push(r); if (rows.length > MAX_KPI_ROWS) throw new IngestError(`KPI sheets are limited to ${MAX_KPI_ROWS.toLocaleString('en-US')} rows.`); }, onProgress, { cellDates: true });
    // drop all-empty rows and columns (pandas dropna how='all')
    rows = rows.filter((r) => r && r.some((v) => !isNA(v)));
    if (!rows.length) throw new IngestError('The sheet is empty.');
    const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
    const keepCols = []; for (let c = 0; c < width; c++) if (rows.some((r) => !isNA(r[c]))) keepCols.push(c);
    const raw = rows.map((r) => keepCols.map((c) => (r[c] === undefined ? null : r[c])));
    rows = null;
    const h = headerRow(raw);
    const headers = [], used = new Set();
    raw[h].forEach((v, i) => {
      let name = !blank(v) ? str(v).trim() : `Column ${i + 1}`;
      const base = name; let n = 2;
      while (used.has(name)) { name = `${base} (${n})`; n++; }
      used.add(name); headers.push(name);
    });
    const body = raw.slice(h + 1).filter((r) => r.some((v) => !isNA(v)));
    if (!body.length) throw new IngestError('No data rows were found under the header row.');
    const cols = headers.map((c, j) => {
      const vals = []; for (const r of body) { const v = r[j]; if (!isNA(v) && String(v).trim() !== '') vals.push(v); }
      const n = vals.length || 1;
      let nd = 0, nn = 0, marker = 0, nDateObj = 0;
      const uniq = new Set();
      for (const v of vals) {
        if (v instanceof Date) nDateObj++;
        if (Number.isFinite(typeof v === 'number' ? NaN : parseDate(v))) nd++;
        if (Number.isFinite(parseNum(v))) nn++;
        const s = str(v);
        if (/[/\-]|[A-Za-z]{3}/.test(s)) marker++;
        uniq.add(s);
      }
      const dateShare = nd / n, numShare = nn / n;
      const looksDate = (nDateObj && nDateObj === vals.length) || (dateShare >= 0.8 && (numShare < 0.5 || marker / n > 0.5));
      const type = looksDate ? 'date' : numShare >= 0.8 ? 'number' : 'text';
      return { name: c, type, unique: uniq.size, samples: vals.slice(0, 3).map(str) };
    });
    const dateCols = cols.filter((c) => c.type === 'date').map((c) => c.name);
    if (!dateCols.length) throw new IngestError('No date column was found. The sheet needs one column of dates (for example 2026-09-01 or 01/09/2026).');
    const segCols = cols.filter((c) => c.type === 'text' && c.unique > 1 && c.unique <= 300).map((c) => c.name);
    const metrics = [];
    for (const c of cols) {
      if (c.type !== 'number') continue;
      const name = c.name;
      const unit = /%|pct|percent|rate|ctr|cvr|share/i.test(name) ? 'percent' : (/tvr|rating|grp|trp/i.test(name) && !/cost/i.test(name) ? 'rating' : (CURRENCY.test(name) ? 'currency' : 'number'));
      const agg = (RATE.test(name) && !/grp|trp/i.test(name)) || unit === 'percent' ? 'mean' : 'sum';
      const role = DRIVER.test(name) && agg === 'sum' ? 'driver' : 'kpi';
      metrics.push({ column: name, key: slug(name), label: name, unit, agg, role, include: true });
    }
    if (!metrics.length) throw new IngestError('No numeric columns were found to forecast.');
    const proposal = { file_name: file.name, rows: body.length, header_row: h + 1, columns: cols,
      suggested: { date_column: dateCols[0], segment_column: segCols.length === 1 ? segCols[0] : null, segment_options: segCols, metrics, ratios: suggestRatios(metrics) } };
    return { proposal, pending: { headers, body, file_name: file.name, rows_read: body.length } };
  }

  function suggestRatios(metrics) {
    const spend = metrics.filter((m) => m.role === 'driver' && m.unit === 'currency' && /spend|cost|budget|invest/i.test(m.label));
    if (!spend.length) return [];
    const s = spend[0], out = [], seen = new Set();
    for (const m of metrics) {
      if (m.key === s.key || m.agg !== 'sum' || m.unit === 'currency') continue;
      for (const [rx, key, label, scale] of RATIO_TARGETS) {
        if (rx.test(m.label) && !seen.has(key)) { seen.add(key); out.push({ key, label, num: s.key, den: m.key, scale, unit: 'currency' }); break; }
      }
    }
    return out;
  }

  function detectGranularity(days) {
    const u = [...new Set(days)].sort((a, b) => a - b);
    if (u.length < 3) return 'daily';
    const gaps = []; for (let i = 1; i < u.length; i++) gaps.push(u[i] - u[i - 1]);
    const gap = MR.median(gaps);
    return gap <= 2 ? 'daily' : gap <= 10 ? 'weekly' : 'monthly';
  }

  /** Build the table from the pending sheet and the confirmed mapping. Returns a KPI table with report and meta. */
  function applyKpi(pending, mapping) {
    if (!pending) throw new IngestError('This upload has expired. Please upload the file again.');
    const { headers, body } = pending;
    const dcol = mapping.date_column, scol = mapping.segment_column || null;
    const di = headers.indexOf(dcol), si = scol ? headers.indexOf(scol) : -1;
    if (di < 0) throw new IngestError('Choose the date column.');
    if (scol && si < 0) throw new IngestError('The segment column was not found.');
    const metrics = (mapping.metrics || []).filter((m) => m.include !== false && headers.includes(m.column)).map((m) => ({ ...m }));
    if (!metrics.length) throw new IngestError('Pick at least one metric to keep.');
    const keys = new Set();
    for (const m of metrics) {
      m.key = slug(m.key || m.column);
      if (keys.has(m.key) || ['date', 'segment', 'week_start', 'month'].includes(m.key)) m.key += '_2';
      keys.add(m.key);
      if (!['sum', 'mean'].includes(m.agg)) m.agg = 'sum';
      if (!['number', 'currency', 'percent', 'rating'].includes(m.unit)) m.unit = 'number';
      m.label = String(m.label || m.column).slice(0, 80);
    }
    const n0 = body.length, dates = new Int32Array(n0), seg = new Int32Array(n0), segDict = new MR.DictCol();
    const vals = metrics.map(() => new Float64Array(n0)), mi = metrics.map((m) => headers.indexOf(m.column));
    const unparsed = {};
    for (let r = 0; r < n0; r++) {
      const row = body[r], d = parseDate(row[di]);
      dates[r] = Number.isFinite(d) ? d : -2147483648;
      let s = 'All';
      if (si >= 0) { const v = row[si]; s = isNA(v) ? 'Unknown' : str(v).trim(); if (['nan', '', 'None'].includes(s)) s = 'Unknown'; }
      seg[r] = segDict.code(s);
      metrics.forEach((m, k) => {
        const v = row[mi[k]], x = parseNum(v);
        vals[k][r] = x;
        if (!Number.isFinite(x) && !isNA(v) && String(v).trim() !== '') unparsed[m.label] = (unparsed[m.label] || 0) + 1;
      });
    }
    const dropped = { bad_date: 0, no_values: 0, duplicates: 0 };
    const keep = [], seen = new Set();
    for (let r = 0; r < n0; r++) {
      if (dates[r] === -2147483648) { dropped.bad_date++; continue; }
      if (vals.every((a) => !Number.isFinite(a[r]))) { dropped.no_values++; continue; }
      const key = [dates[r], seg[r], ...vals.map((a) => (Number.isFinite(a[r]) ? a[r] : 'NA'))].join('|');
      if (seen.has(key)) { dropped.duplicates++; continue; }
      seen.add(key); keep.push(r);
    }
    if (!keep.length) throw new IngestError('No usable rows after cleaning. Check the date column and metric columns.');
    const T = { kind: 'kpi', n: keep.length, cols: { date: Int32Array.from(keep, (r) => dates[r]), segment: Int32Array.from(keep, (r) => seg[r]) }, dicts: { segment: segDict.dict } };
    metrics.forEach((m, k) => { T.cols[m.key] = Float64Array.from(keep, (r) => vals[k][r]); });
    const gran = detectGranularity(T.cols.date);
    const ratios = (mapping.ratios || []).filter((r) => keys.has(r.num) && keys.has(r.den)).map((r) => ({ ...r, key: slug(r.key || `${r.num}_per_${r.den}`),
      label: String(r.label || r.key || `${r.num}_per_${r.den}`).slice(0, 80), scale: Number(r.scale || 1) }));
    ratios.forEach((r) => { if (!r.label) r.label = r.key; });
    T.meta = { metrics: metrics.map((m) => ({ key: m.key, label: m.label, unit: m.unit, agg: m.agg, role: m.role, column: m.column })), ratios,
      date_column: dcol, segment_column: scol, granularity: gran };
    T.report = kpiReport(T, pending.file_name, pending.rows_read, dropped, unparsed);
    return T;
  }

  function kpiReport(T, fileName, rowsRead, dropped, unparsed) {
    const [lo, hi] = MR.minMax(T.cols.date, MR.allIdx(T));
    const nDays = new Set(T.cols.date).size, gran = T.meta.granularity;
    const minPts = { daily: 14, weekly: 8, monthly: 12 }[gran], warnings = [];
    if (nDays < minPts) warnings.push(`Only ${nDays} distinct ${gran} periods. Forecasts will be marked Low reliability (minimum ${minPts}).`);
    return { kind: 'kpi', file_name: fileName, rows_read: rowsRead, rows_kept: T.n, dropped, rows_dropped_total: dropped.bad_date + dropped.no_values + dropped.duplicates,
      missing_columns: [], unparseable_values: unparsed || {}, unmatched_channels: [], date_min: isoFromDay(lo), date_max: isoFromDay(hi), n_days: nDays,
      granularity: gran, segments: T.dicts.segment.length, warnings };
  }

  /** Append rows; rows for the same date and segment are replaced by the newer file (restated numbers). */
  function mergeKpi(A, B) {
    if (!A || !A.n) return { T: B, added: B.n, replaced: 0 };
    const ka = A.meta.metrics.map((m) => m.key).sort().join(','), kb = B.meta.metrics.map((m) => m.key).sort().join(',');
    if (ka !== kb) throw new IngestError('The new file has different metrics from the stored dataset. Map the same columns or upload as a new dataset.');
    const newKeys = new Set(); for (let i = 0; i < B.n; i++) newKeys.add(B.cols.date[i] + '|' + B.dicts.segment[B.cols.segment[i]]);
    const keepOld = MR.where(A, MR.allIdx(A), (i) => !newKeys.has(A.cols.date[i] + '|' + A.dicts.segment[A.cols.segment[i]]));
    const C = MR.concat(MR.take(A, keepOld), B);
    const segName = (i) => C.dicts.segment[C.cols.segment[i]];
    const order = Array.from(MR.allIdx(C)).sort((x, y) => (C.cols.date[x] - C.cols.date[y]) || (segName(x) < segName(y) ? -1 : segName(x) > segName(y) ? 1 : 0) || (x - y));
    const merged = MR.take(C, Int32Array.from(order));
    merged.meta = { ...B.meta, ratios: A.meta.ratios || B.meta.ratios, granularity: detectGranularity(merged.cols.date) };
    const [lo, hi] = MR.minMax(merged.cols.date, MR.allIdx(merged));
    merged.report = { ...B.report, appended: true, rows_added: merged.n - A.n, rows_skipped_as_duplicates: A.n - keepOld.length, rows_total_after_merge: merged.n,
      date_min: isoFromDay(lo), date_max: isoFromDay(hi), n_days: new Set(merged.cols.date).size, granularity: merged.meta.granularity, segments: merged.dicts.segment.length };
    return { T: merged, added: merged.n - A.n, replaced: A.n - keepOld.length };
  }

  /** Edit labels, units, aggregation, roles and ratios without re-uploading. */
  function updateKpiMeta(T, upd) {
    const meta = JSON.parse(JSON.stringify(T.meta)), keys = new Set(meta.metrics.map((m) => m.key));
    if (upd.metrics) {
      const by = Object.fromEntries(upd.metrics.map((m) => [m.key, m]));
      for (const m of meta.metrics) {
        const u = by[m.key] || {};
        if (u.label) m.label = String(u.label).slice(0, 80);
        if (['number', 'currency', 'percent', 'rating'].includes(u.unit)) m.unit = u.unit;
        if (['sum', 'mean'].includes(u.agg)) m.agg = u.agg;
        if (['kpi', 'driver'].includes(u.role)) m.role = u.role;
      }
    }
    if (upd.ratios) {
      meta.ratios = upd.ratios.filter((r) => keys.has(r.num) && keys.has(r.den) && r.num !== r.den).map((r) => ({ key: slug(r.key || r.label || 'ratio'),
        label: String(r.label || 'Ratio').slice(0, 80), num: r.num, den: r.den, scale: Number(r.scale || 1), unit: r.unit || 'currency' }));
    }
    return { ...T, meta };
  }

  Object.assign(MR, { proposeKpi, applyKpi, mergeKpi, updateKpiMeta, kpiSlug: slug, detectGranularity });
})(typeof self !== 'undefined' ? self : globalThis);
