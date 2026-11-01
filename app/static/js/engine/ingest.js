/* Readers (streaming CSV, Excel) and the TV and LMRB table builders. Mirrors app/services/ingest.py. */
(function (root) {
  const MR = root.MR;
  const { parseNum, parseDate, parseTime, headerKey, NumCol, DictCol, normaliseChannel, normaliseProgram, daypartFor, durationBand, dedupe, dayFromYMD } = MR;

  const MAX_XLSX_MB = 150;
  class IngestError extends Error {}

  /* ---------------- streaming CSV ---------------- */
  /** Incremental RFC 4180 parser: push(text) as chunks arrive, end() at the close. Calls onRow(fields). */
  class CsvParser {
    constructor(onRow, delim) { this.onRow = onRow; this.delim = delim; this.field = ''; this.row = []; this.q = false; this.afterQ = false; this.pendingCR = false; }
    push(text) {
      if (!this.delim) {                      // sniff on the first chunk: tab, semicolon or comma
        const head = text.slice(0, 8192);
        const c = (ch) => (head.match(new RegExp(ch === '\t' ? '\\t' : ch, 'g')) || []).length;
        const counts = [[',', c(',')], ['\t', c('\t')], [';', c(';')]].sort((a, b) => b[1] - a[1]);
        this.delim = counts[0][1] ? counts[0][0] : ',';
      }
      const d = this.delim;
      let field = this.field, row = this.row, q = this.q;
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (q) {
          if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else if (i + 1 === text.length) { this.afterQ = true; q = false; } else q = false; }
          else field += ch;
          continue;
        }
        if (this.afterQ) { this.afterQ = false; if (ch === '"') { field += '"'; q = true; continue; } }
        if (ch === '"' && field === '') { q = true; continue; }
        if (ch === d) { row.push(field); field = ''; continue; }
        if (ch === '\n') { row.push(field); this.onRow(row); row = []; field = ''; continue; }
        if (ch === '\r') continue;
        field += ch;
      }
      this.field = field; this.row = row; this.q = q;
    }
    end() { if (this.field !== '' || this.row.length) { this.row.push(this.field); this.onRow(this.row); } this.row = []; this.field = ''; }
  }

  /**
   * Read any supported file row by row. file: a File/Blob (browser) or {name, text} (tests).
   * onRow(fields) may return false to stop early. onProgress(fraction).
   */
  async function readRows(file, onRow, onProgress, opts = {}) {
    const name = (file.name || '').toLowerCase();
    if (!/\.(csv|txt|xlsx|xls)$/.test(name)) throw new IngestError('Unsupported file type. Please upload .csv, .xlsx or .xls.');
    let stopped = false;
    const emit = (r) => { if (!stopped && onRow(r) === false) stopped = true; };
    if (/\.(csv|txt)$/.test(name)) {
      const p = new CsvParser(emit);
      if (file.text && !file.stream) { p.push(String(file.text).replace(/^﻿/, '')); p.end(); return; }
      const size = file.size || 1, reader = file.stream().getReader(), dec = new TextDecoder(opts.encoding || 'utf-8');
      let read = 0, first = true;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        read += value.length;
        let t = dec.decode(value, { stream: true });
        if (first) { t = t.replace(/^﻿/, ''); first = false; }
        p.push(t);
        if (onProgress) onProgress(read / size);
        if (stopped) { try { await reader.cancel(); } catch (e) { /* ignore */ } return; }
      }
      p.push(dec.decode()); p.end();
      return;
    }
    if ((file.size || 0) > MAX_XLSX_MB * 1024 * 1024) {
      throw new IngestError(`Excel files above ${MAX_XLSX_MB} MB cannot be opened safely in a browser. Open it in Excel and use File > Save As > CSV, then upload the CSV (any size works).`);
    }
    if (typeof XLSX === 'undefined') throw new IngestError('The Excel reader is not available.');
    const buf = file.arrayBuffer ? await file.arrayBuffer() : file.buffer;
    if (onProgress) onProgress(0.3);
    const wb = XLSX.read(buf, { type: 'array', dense: true, cellDates: !!opts.cellDates, cellText: false, cellFormula: false, cellHTML: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
    if (onProgress) onProgress(0.6);
    for (let i = 0; i < rows.length && !stopped; i++) { emit(rows[i]); if (onProgress && i % 50000 === 0) onProgress(0.6 + 0.4 * (i / rows.length)); }
  }

  /** Buffers the first rows, finds the header row (most known headers among the first 15), then streams the body. */
  function headerFinder(known, onHeader, onBody, minHits = 3) {
    const buf = [];
    let decided = false;
    const decide = () => {
      let best = -1, bi = 0;
      buf.forEach((r, i) => { const hits = r.filter((v) => known.has(headerKey(v))).length; if (hits > best) { best = hits; bi = i; } });
      if (best < minHits) throw new IngestError('Could not find a header row. Check that column names match the expected template.');
      decided = true;
      onHeader(buf[bi], bi);
      for (let i = bi + 1; i < buf.length; i++) onBody(buf[i]);
    };
    return {
      row(r) { if (decided) return onBody(r); buf.push(r); if (buf.length >= 15) decide(); },
      end() { if (!decided) { if (!buf.length) throw new IngestError('The file is empty.'); decide(); } },
    };
  }

  const isBlank = (r) => r.every((v) => v == null || String(v).trim() === '' || v === 'nan' || v === 'None');
  const txt = (v, dflt) => { if (v == null) return dflt; const s = String(v).trim(); return !s || s === 'nan' || s === 'None' ? dflt : s; };
  const titleCase = (s) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  /* ---------------- schemas ---------------- */
  const TV_HEADERS = { rank: 'rank', dataset: 'data_set', channel: 'channel', date: 'date', day: 'day', start: 'start', end: 'end', program: 'program', programme: 'program',
    duration: 'duration', category: 'category', tvr: 'tvr', totaltvr: 'total_tvr', tvrsharepct: 'tvr_share', tvrshare: 'tvr_share', reach: 'reach', reachpct: 'reach_pct', avgtime: 'avg_time' };
  const TV_EXPECTED = ['rank', 'data_set', 'channel', 'date', 'day', 'start', 'end', 'program', 'duration', 'category', 'tvr', 'total_tvr', 'tvr_share', 'reach', 'reach_pct', 'avg_time'];
  const TV_REQUIRED = ['channel', 'date', 'program', 'tvr'];
  const LM_HEADERS = { productgroup: 'product_group', advertiser: 'advertiser', product: 'product', advttheme: 'theme', ads: 'ads', channel: 'channel', program: 'program', programme: 'program',
    dd: 'dd', mn: 'mn', yr: 'yr', day: 'day', progtime: 'prog_time', advttime: 'advt_time', adpos: 'adpos', totads: 'totads', brkno: 'brkno', posinbrk: 'posinbrk', adsinbrk: 'adsinbrk',
    lng: 'lng', dur: 'dur', cost: 'cost' };
  const LM_EXPECTED = ['product_group', 'advertiser', 'product', 'theme', 'ads', 'channel', 'program', 'dd', 'mn', 'yr', 'day', 'prog_time', 'advt_time', 'adpos', 'totads', 'brkno', 'posinbrk', 'adsinbrk', 'lng', 'dur', 'cost'];
  const LM_REQUIRED = ['advertiser', 'channel', 'cost', 'dd', 'mn', 'yr'];
  const SCHEMA = { tv: { headers: TV_HEADERS, expected: TV_EXPECTED, required: TV_REQUIRED }, lmrb: { headers: LM_HEADERS, expected: LM_EXPECTED, required: LM_REQUIRED } };

  function mapHeader(kind, headerRow) {
    const sch = SCHEMA[kind], pos = {}, seen = new Set();
    headerRow.forEach((h, i) => { const k = sch.headers[headerKey(h)]; if (k && !seen.has(k)) { pos[k] = i; seen.add(k); } });
    const missing = sch.expected.filter((c) => !(c in pos));
    const reqMissing = sch.required.filter((c) => !(c in pos));
    if (reqMissing.length) throw new IngestError(`Missing required columns: ${reqMissing.join(', ')}. Found: ${Object.keys(pos).join(', ') || 'none'}`);
    return { pos, missing };
  }

  /** Numeric field reader that counts values that were present but not numbers. */
  function numReader(bad) {
    return (row, p, name) => {
      if (p === undefined) return NaN;
      const v = row[p];
      const n = parseNum(v);
      if (Number.isNaN(n) && v != null && String(v).trim() !== '' && String(v).trim() !== '-') bad[name] = (bad[name] || 0) + 1;
      return n;
    };
  }

  /* ---------------- TV builder ---------------- */
  function tvBuilder() {
    const c = { date: new NumCol(Int32Array), start: new NumCol(Int32Array), end: new NumCol(Int32Array), duration: new NumCol(Float64Array), tvr: new NumCol(Float64Array),
      total_tvr: new NumCol(Float64Array), tvr_share: new NumCol(Float64Array), reach: new NumCol(Float64Array), reach_pct: new NumCol(Float64Array), avg_time: new NumCol(Float64Array),
      rank: new NumCol(Float64Array), channel: new DictCol(), program: new DictCol(), data_set: new DictCol(), category: new DictCol(), daypart: new DictCol() };
    const dropped = { bad_date: 0, missing_required: 0, blank_rows: 0 }, bad = {}, unmatched = new Set();
    let pos = null, rowsRead = 0;
    const num = numReader(bad);
    return {
      header(h) { const m = mapHeader('tv', h); pos = m.pos; this.missing = m.missing; },
      row(r) {
        rowsRead++;
        if (isBlank(r)) { dropped.blank_rows++; return; }
        const date = parseDate(r[pos.date]);
        const tvr = num(r, pos.tvr, 'tvr');
        const chRaw = txt(r[pos.channel], null), prog = txt(r[pos.program], null);
        for (const k of ['rank', 'duration', 'total_tvr', 'tvr_share', 'reach', 'reach_pct', 'avg_time']) num(r, pos[k], k);
        if (!Number.isFinite(date)) { dropped.bad_date++; return; }
        if (!chRaw || !prog || !Number.isFinite(tvr)) { dropped.missing_required++; return; }
        const [ch, ok] = normaliseChannel(chRaw);
        if (!ok) unmatched.add(chRaw);
        const st = pos.start !== undefined ? parseTime(r[pos.start]) : -1, en = pos.end !== undefined ? parseTime(r[pos.end]) : -1;
        let dur = parseNum(pos.duration !== undefined ? r[pos.duration] : null);
        if (!Number.isFinite(dur) && st >= 0 && en >= 0) dur = (((en - st) % 86400) + 86400) % 86400 / 60;
        c.date.push(date); c.start.push(st); c.end.push(en); c.duration.push(dur); c.tvr.push(tvr);
        for (const k of ['total_tvr', 'tvr_share', 'reach', 'reach_pct', 'avg_time', 'rank']) c[k].push(parseNum(pos[k] !== undefined ? r[pos[k]] : null));
        c.channel.push(ch); c.program.push(normaliseProgram(prog)); c.data_set.push(txt(r[pos.data_set], 'All'));
        c.category.push(txt(r[pos.category], 'UNKNOWN').toUpperCase()); c.daypart.push(daypartFor(st));
      },
      finish(fileName) {
        let T = { kind: 'tv', n: c.date.n, cols: {}, dicts: {} };
        for (const [k, v] of Object.entries(c)) { T.cols[k] = v.done(); if (v.dict) T.dicts[k] = v.dict; }
        const before = T.n;
        const keep = dedupe(T.n, (i) => [T.cols.data_set[i], T.cols.channel[i], T.cols.date[i], T.cols.start[i] >= 0 ? MR.hm(T.cols.start[i]) : '', T.cols.program[i]],
          (i, j) => ['data_set', 'channel', 'date', 'program'].every((k) => T.cols[k][i] === T.cols[k][j]) && MR.hm(T.cols.start[i]) === MR.hm(T.cols.start[j]));
        if (keep.length !== before) T = MR.take(T, keep);
        dropped.duplicates = before - T.n;
        T.report = report('tv', fileName, T, rowsRead, dropped, this.missing || [], bad, [...unmatched].sort());
        return T;
      },
    };
  }

  /* ---------------- LMRB builder ---------------- */
  function lmrbBuilder() {
    const c = { date: new NumCol(Int32Array), sec: new NumCol(Int32Array), advt_sec: new NumCol(Int32Array), prog_sec: new NumCol(Int32Array), dur: new NumCol(Float32Array),
      cost: new NumCol(Float64Array), ads: new NumCol(Float32Array), adpos: new NumCol(Int32Array), totads: new NumCol(Int32Array), brkno: new NumCol(Int32Array),
      posinbrk: new NumCol(Int32Array), adsinbrk: new NumCol(Int32Array), position: new NumCol(Int8Array),
      channel: new DictCol(), program: new DictCol(), advertiser: new DictCol(), product_group: new DictCol(), product: new DictCol(), theme: new DictCol(),
      creative: new DictCol(), lng: new DictCol(), daypart: new DictCol(), dur_band: new DictCol() };
    const dropped = { bad_date: 0, missing_required: 0, blank_rows: 0 }, bad = {}, unmatched = new Set();
    let pos = null, rowsRead = 0;
    const num = numReader(bad);
    const int = (v) => (Number.isFinite(v) ? Math.round(v) : -1);
    return {
      header(h) { const m = mapHeader('lmrb', h); pos = m.pos; this.missing = m.missing; },
      row(r) {
        rowsRead++;
        if (isBlank(r)) { dropped.blank_rows++; return; }
        const dd = num(r, pos.dd, 'dd'), yr = num(r, pos.yr, 'yr');
        let mn = parseNum(r[pos.mn]);
        if (!Number.isFinite(mn)) mn = MONTHS[String(r[pos.mn] || '').trim().toLowerCase().slice(0, 3)] || NaN;
        const cost = num(r, pos.cost, 'cost');
        const vals = {}; for (const k of ['ads', 'adpos', 'totads', 'brkno', 'posinbrk', 'adsinbrk', 'dur']) vals[k] = num(r, pos[k], k);
        const date = dayFromYMD(yr, mn, dd);
        const adv = txt(r[pos.advertiser], null), chRaw = txt(r[pos.channel], null);
        if (!Number.isFinite(date)) { dropped.bad_date++; return; }
        if (!adv || !chRaw || !Number.isFinite(cost)) { dropped.missing_required++; return; }
        const [ch, ok] = normaliseChannel(chRaw);
        if (!ok) unmatched.add(chRaw);
        const advt = pos.advt_time !== undefined ? parseTime(r[pos.advt_time]) : -1, prog = pos.prog_time !== undefined ? parseTime(r[pos.prog_time]) : -1;
        const sec = advt >= 0 ? advt : prog;
        const product = txt(r[pos.product], 'Unknown'), theme = txt(r[pos.theme], 'Unknown');
        const pib = vals.posinbrk, aib = vals.adsinbrk;
        const first = pib === 1, last = Number.isFinite(pib) && pib === aib && aib > 1;
        c.date.push(date); c.sec.push(sec); c.advt_sec.push(advt); c.prog_sec.push(prog); c.dur.push(vals.dur); c.cost.push(cost);
        c.ads.push(Number.isFinite(vals.ads) ? vals.ads : 1);
        for (const k of ['adpos', 'totads', 'brkno', 'posinbrk', 'adsinbrk']) c[k].push(int(vals[k]));
        c.position.push(!Number.isFinite(pib) ? 3 : first ? 0 : last ? 2 : 1);
        c.channel.push(ch); c.program.push(normaliseProgram(txt(r[pos.program], 'Unknown'))); c.advertiser.push(adv);
        c.product_group.push(txt(r[pos.product_group], 'Unknown')); c.product.push(product); c.theme.push(theme); c.creative.push(`${adv} | ${product} | ${theme}`);
        c.lng.push(titleCase(txt(r[pos.lng], 'Unknown'))); c.daypart.push(daypartFor(sec)); c.dur_band.push(durationBand(vals.dur));
      },
      finish(fileName) {
        let T = { kind: 'lmrb', n: c.date.n, cols: {}, dicts: {} };
        for (const [k, v] of Object.entries(c)) { T.cols[k] = v.done(); if (v.dict) T.dicts[k] = v.dict; }
        const K = ['advertiser', 'product', 'theme', 'channel', 'date', 'advt_sec', 'brkno', 'posinbrk', 'adpos', 'cost'];
        const before = T.n;
        const keep = dedupe(T.n, (i) => K.map((k) => T.cols[k][i]), (i, j) => K.every((k) => T.cols[k][i] === T.cols[k][j]));
        if (keep.length !== before) T = MR.take(T, keep);
        dropped.duplicates = before - T.n;
        T.report = report('lmrb', fileName, T, rowsRead, dropped, this.missing || [], bad, [...unmatched].sort());
        return T;
      },
    };
  }

  function report(kind, fileName, T, rowsRead, dropped, missing, bad, unmatched) {
    const warnings = [];
    let dmin = null, dmax = null, nDays = 0;
    if (T.n) {
      const [lo, hi] = MR.minMax(T.cols.date, MR.allIdx(T));
      dmin = MR.isoFromDay(lo); dmax = MR.isoFromDay(hi);
      nDays = new Set(T.cols.date).size;
    }
    const thin = MR.cfg.minPoints.daily || 14;
    if (!T.n) warnings.push('No valid rows were found after cleaning.');
    else if (nDays < thin) warnings.push(`Only ${nDays} distinct days of history. Forecasts will be marked Low reliability (minimum is ${thin}).`);
    if (missing.length) warnings.push('Optional columns not found: ' + missing.join(', '));
    return { kind, file_name: fileName, rows_read: rowsRead, rows_kept: T.n, dropped, rows_dropped_total: Object.values(dropped).reduce((a, b) => a + b, 0),
      missing_columns: missing, unparseable_values: bad, unmatched_channels: unmatched, date_min: dmin, date_max: dmax, n_days: nDays, warnings };
  }

  /** Parse a TV or LMRB file into a columnar table. */
  async function parseFile(kind, file, onProgress) {
    const b = kind === 'tv' ? tvBuilder() : lmrbBuilder();
    const finder = headerFinder(new Set(Object.keys(SCHEMA[kind].headers)), (h) => b.header(h), (r) => b.row(r));
    await readRows(file, (r) => finder.row(r), onProgress);
    finder.end();
    return b.finish(file.name);
  }

  /** Append a new table to the stored one and de-duplicate (same keys as a single file). */
  function merge(kind, A, B) {
    if (!A || !A.n) return { T: B, added: B.n, skipped: 0 };
    let T = MR.concat(A, B);
    const K = kind === 'tv' ? ['data_set', 'channel', 'date', 'start', 'program'] : ['advertiser', 'product', 'theme', 'channel', 'date', 'advt_sec', 'brkno', 'posinbrk', 'adpos', 'cost'];
    const keep = dedupe(T.n, (i) => K.map((k) => T.cols[k][i]), (i, j) => K.every((k) => T.cols[k][i] === T.cols[k][j]));
    T = MR.take(T, keep);
    const added = T.n - A.n;
    return { T, added, skipped: B.n - added };
  }

  Object.assign(MR, { IngestError, CsvParser, readRows, headerFinder, parseFile, merge, MAX_XLSX_MB, SCHEMA });
})(typeof self !== 'undefined' ? self : globalThis);
