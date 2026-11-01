/* Data engine core: shared by the browser worker and the Node parity tests.
 * Columnar tables with dictionary-encoded strings keep 500 MB+ sheets in a few hundred MB of memory.
 * Dates are day numbers (days since 1970-01-01, UTC). Times are seconds since midnight (-1 when missing).
 */
(function (root) {
  const MR = (root.MR = root.MR || {});
  const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  /* ---------------- dates ---------------- */
  const dayFromYMD = (y, m, d) => {
    if (!(y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return NaN;
    const t = Date.UTC(y, m - 1, d);
    const dt = new Date(t);
    if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return NaN;   // 31 Feb and friends
    return Math.round(t / 86400000);
  };
  const isoFromDay = (n) => (Number.isFinite(n) ? new Date(n * 86400000).toISOString().slice(0, 10) : null);
  const dayFromIso = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? dayFromYMD(+m[1], +m[2], +m[3]) : NaN; };
  const dowMon = (day) => ((day + 3) % 7 + 7) % 7;               // Monday = 0
  const weekStart = (day) => day - dowMon(day);
  const monthStart = (day) => { const d = new Date(day * 86400000); return dayFromYMD(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); };
  const monthKey = (day) => isoFromDay(day).slice(0, 7);
  const addMonths = (day, k) => { const d = new Date(day * 86400000); return dayFromYMD(d.getUTCFullYear() + Math.floor((d.getUTCMonth() + k) / 12), ((d.getUTCMonth() + k) % 12 + 12) % 12 + 1, 1); };

  /** Parse dates the way the Python reference does: Y/M/D, Y-M-D, D/M/Y, D-M-Y, D.M.Y, Y.M.D, M/D/Y, '1 Sep 2026', Excel serials and Date objects. */
  function parseDate(v) {
    if (v == null || v === '') return NaN;
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? NaN : dayFromYMD(v.getFullYear(), v.getMonth() + 1, v.getDate());
    if (typeof v === 'number') return v > 20000 && v < 80000 ? Math.floor(v) - 25569 : NaN;   // Excel serial (1954..2119), time part ignored
    const s = String(v).trim();
    let m;
    if ((m = /^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})(?:[ T].*)?$/.exec(s))) return dayFromYMD(+m[1], +m[2], +m[3]);
    if ((m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})(?:[ T].*)?$/.exec(s))) {
      const a = dayFromYMD(+m[3], +m[2], +m[1]);                 // day first (Sri Lankan convention)
      return Number.isFinite(a) ? a : dayFromYMD(+m[3], +m[1], +m[2]);
    }
    if ((m = /^(\d{1,2})[\s\-]([A-Za-z]{3})[A-Za-z]*[\s\-,]+(\d{4})$/.exec(s))) return dayFromYMD(+m[3], MONTHS[m[2].toLowerCase()] || 0, +m[1]);
    if ((m = /^([A-Za-z]{3})[A-Za-z]*\s+(\d{1,2}),?\s+(\d{4})$/.exec(s))) return dayFromYMD(+m[3], MONTHS[m[1].toLowerCase()] || 0, +m[2]);
    if ((m = /^(\d{4})[/\-](\d{1,2})$/.exec(s))) return dayFromYMD(+m[1], +m[2], 1);       // 2026-09 (monthly data)
    if ((m = /^([A-Za-z]{3})[A-Za-z]*[\s\-]+(\d{4})$/.exec(s))) return dayFromYMD(+m[2], MONTHS[m[1].toLowerCase()] || 0, 1);
    return NaN;
  }

  /* ---------------- numbers and times ---------------- */
  function parseNum(v) {
    if (v == null) return NaN;
    if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
    if (typeof v === 'boolean') return NaN;
    let s = String(v);
    // fast path: plain decimal numbers (the vast majority of cells)
    let plain = s.length > 0 && s.length < 24;
    for (let k = 0; plain && k < s.length; k++) { const c = s.charCodeAt(k); if (!((c >= 48 && c <= 57) || c === 46 || (k === 0 && c === 45))) plain = false; }
    if (plain && s !== '-' && s !== '.') { const n = +s; if (Number.isFinite(n)) return n; }
    s = s.trim();
    if (!s || s === '-' || s.toLowerCase() === 'nan' || s === 'None') return NaN;
    s = s.replace(/,/g, '').replace(/%/g, '').replace(/\b(lkr|rs\.?)\b/gi, '').trim();
    if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return NaN;
    return parseFloat(s);
  }
  /** Clock times to seconds since midnight: '09:14:07', '9.14', '9:14 PM', Excel fractions, Date objects. */
  function parseTime(v) {
    if (v == null || v === '') return -1;
    if (v instanceof Date) return v.getHours() * 3600 + v.getMinutes() * 60 + v.getSeconds();
    if (typeof v === 'number') { const f = v >= 1 ? v - Math.floor(v) : v; return v >= 0 ? Math.round(f * 86400) % 86400 : -1; }   // Excel fraction or datetime serial
    const m = /^(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*([AaPp][Mm])?$/.exec(String(v).trim());
    if (!m) return -1;
    let h = +m[1]; const mi = +m[2], se = +(m[3] || 0);
    if (m[4]) h = (h % 12) + (m[4].toLowerCase() === 'pm' ? 12 : 0);
    if (h > 24 || mi > 59 || se > 59) return -1;
    return h * 3600 + mi * 60 + se;
  }
  const hm = (sec) => (sec >= 0 ? `${String(Math.floor(sec / 3600) % 24).padStart(2, '0')}:${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}` : null);
  const hms = (sec) => (sec >= 0 ? `${hm(sec)}:${String(sec % 60).padStart(2, '0')}` : null);
  const headerKey = (h) => String(h == null ? '' : h).trim().toLowerCase().replace(/%/g, 'pct').replace(/[^a-z0-9]/g, '');

  /* ---------------- configuration (channel aliases, dayparts) ---------------- */
  const cfg = { aliases: {}, dayparts: [], prime: ['Prime'], bands: [], minPoints: { daily: 14, weekly: 8, monthly: 12 }, timebelt: 30 };
  let aliasLookup = null, chanCache = new Map();
  const clean = (v) => String(v).replace(/\s+/g, ' ').trim().toUpperCase();
  function configure(c) {
    if (c.aliases) { cfg.aliases = c.aliases; aliasLookup = null; chanCache = new Map(); }
    if (c.dayparts) {
      cfg.dayparts = c.dayparts.dayparts || [];
      cfg.prime = c.dayparts.prime || ['Prime'];
      cfg.bands = c.dayparts.duration_bands || [];
      cfg.minPoints = c.dayparts.min_points || cfg.minPoints;
      cfg.timebelt = c.dayparts.timebelt_minutes || 30;
    }
  }
  function lookup() {
    if (aliasLookup) return aliasLookup;
    aliasLookup = new Map();
    for (const [canon, list] of Object.entries(cfg.aliases)) {
      if (canon.startsWith('_')) continue;
      aliasLookup.set(clean(canon), canon);
      for (const a of list || []) aliasLookup.set(clean(a), canon);
    }
    return aliasLookup;
  }
  /** 'Tv - Derana', 'DERANA' and 'Derana TV' all become 'DERANA'. Returns [name, matched]. */
  function normaliseChannel(raw) {
    if (raw == null) return ['UNKNOWN', false];
    const key = String(raw);
    if (chanCache.has(key)) return chanCache.get(key);
    const L = lookup();
    const c = clean(key);
    let out = ['UNKNOWN', false];
    if (c) {
      const stripped = c.replace(/^TV\s*[-:–]\s*/, '');
      const nosuffix = stripped.replace(/\s+(TV|CHANNEL)$/, '');
      out = [stripped || 'UNKNOWN', false];
      for (const cand of [c, stripped, nosuffix]) if (L.has(cand)) { out = [L.get(cand), true]; break; }
    }
    chanCache.set(key, out);
    return out;
  }
  /** Programme names: uppercase, single spaces. programBase also drops repeat markers so both sheets join. */
  const normaliseProgram = (v) => (v == null || String(v).trim() === '' ? 'UNKNOWN' : clean(v));
  const programBase = (p) => String(p).replace(/\s*[-(\[]\s*(REP|REPEAT|R)\s*[)\]]?\s*$/i, '').replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  function daypartFor(sec) {
    if (!(sec >= 0)) return 'Unknown';
    const h = Math.floor(sec / 3600) % 24;
    for (const d of cfg.dayparts) {
      if (d.start < d.end && h >= d.start && h < d.end) return d.name;
      if (d.start > d.end && (h >= d.start || h < d.end)) return d.name;
    }
    return 'Unknown';
  }
  const daypartOrder = () => cfg.dayparts.map((d) => d.name);
  function durationBand(sec) {
    if (!Number.isFinite(sec)) return 'Unknown';
    for (const b of cfg.bands) if (b.max == null || sec <= b.max) return b.label;
    return 'Unknown';
  }
  const bandOrder = () => cfg.bands.map((b) => b.label);
  function timebelt(sec, minutes) {
    if (!(sec >= 0)) return null;
    const step = (minutes || cfg.timebelt) * 60, a = Math.floor(sec / step) * step;
    return `${hm(a)}-${hm(a + step)}`;
  }
  const hourBand = (sec) => (sec >= 0 ? `${String(Math.floor(sec / 3600) % 24).padStart(2, '0')}:00` : null);

  /* ---------------- growable columns ---------------- */
  class NumCol {
    constructor(Type, cap = 4096) { this.Type = Type; this.a = new Type(cap); this.n = 0; }
    push(v) { if (this.n === this.a.length) { const b = new this.Type(this.a.length * 2); b.set(this.a); this.a = b; } this.a[this.n++] = v; }
    done() { return this.a.slice(0, this.n); }
  }
  class DictCol {
    constructor() { this.codes = new NumCol(Int32Array); this.map = new Map(); this.dict = []; }
    code(s) { let c = this.map.get(s); if (c === undefined) { c = this.dict.length; this.dict.push(s); this.map.set(s, c); } return c; }
    push(s) { this.codes.push(s == null ? -1 : this.code(s)); }
    done() { return this.codes.done(); }
  }

  /* ---------------- tables and views ---------------- */
  /** A table: {kind, n, cols:{name: TypedArray}, dicts:{name: string[]}, report, meta, files, sig}. */
  const S = (T, name, i) => { const c = T.cols[name][i]; return c < 0 ? null : T.dicts[name][c]; };
  const allIdx = (T) => { const a = new Int32Array(T.n); for (let i = 0; i < T.n; i++) a[i] = i; return a; };
  function where(T, idx, pred) { const out = new NumCol(Int32Array, Math.max(16, idx.length >> 2)); for (let k = 0; k < idx.length; k++) if (pred(idx[k])) out.push(idx[k]); return out.done(); }
  function codeSet(T, col, names) { const want = new Set(names); const s = new Set(); T.dicts[col].forEach((v, i) => { if (want.has(v)) s.add(i); }); return s; }
  function minMax(arr, idx) { let lo = Infinity, hi = -Infinity; for (let k = 0; k < idx.length; k++) { const v = arr[idx[k]]; if (v < lo) lo = v; if (v > hi) hi = v; } return [lo, hi]; }
  /** Sum and count of a value per key. keyFn(i) must return a primitive (number or string). */
  function group(idx, keyFn, valFn) {
    const m = new Map();
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k], key = keyFn(i);
      let g = m.get(key);
      if (!g) { g = { sum: 0, n: 0 }; m.set(key, g); }
      g.sum += valFn ? valFn(i) : 0; g.n++;
    }
    return m;
  }
  const sortedKeys = (m, by = 'sum') => [...m.entries()].sort((a, b) => b[1][by] - a[1][by]).map((e) => e[0]);
  function quantile(sorted, q) {      // linear interpolation, like pandas
    if (!sorted.length) return NaN;
    const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }
  const median = (arr) => quantile(Float64Array.from(arr).sort(), 0.5);
  const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
  const std0 = (a) => { if (!a.length) return NaN; const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / a.length); };
  const std1 = (a) => { if (a.length < 2) return NaN; const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - 1)); };
  const safeDiv = (a, b) => (b == null || a == null || !b || !Number.isFinite(a) || !Number.isFinite(b) ? null : a / b);
  const pctChange = (c, p) => (p == null || c == null || !p || !Number.isFinite(p) || !Number.isFinite(c) ? null : ((c - p) / Math.abs(p)) * 100);
  const title = (s) => String(s == null ? '' : s).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  const fmtInt = (v) => Math.round(v).toLocaleString('en-US');
  const range = (a, b) => { const out = []; for (let d = a; d <= b; d++) out.push(d); return out; };

  /** 52-bit hash of a list of numbers and strings (FNV-1a in two lanes), used for de-duplication. */
  function hash52(parts) {
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (const p of parts) {
      const s = p == null ? '\u0000' : String(p);
      for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ c, 2246822519); }
      h1 = Math.imul(h1 ^ 31, 16777619); h2 = Math.imul(h2 ^ 31, 2246822519);
    }
    return (h1 >>> 0) * 1048576 + ((h2 >>> 0) & 0xfffff);
  }
  /** Indices of rows to keep, first occurrence wins. keyFn(i) -> array of parts; equal(i, j) confirms real duplicates. */
  function dedupe(n, keyFn, equal) {
    const h = new Float64Array(n);
    for (let i = 0; i < n; i++) h[i] = hash52(keyFn(i));
    const order = new Int32Array(n); for (let i = 0; i < n; i++) order[i] = i;
    order.sort((a, b) => (h[a] - h[b]) || (a - b));
    const drop = new Uint8Array(n);
    for (let k = 1; k < n; k++) {
      const i = order[k];
      for (let j = k - 1; j >= 0 && h[order[j]] === h[i]; j--) if (!drop[order[j]] && equal(order[j], i)) { drop[i] = 1; break; }
    }
    const keep = new NumCol(Int32Array, n); for (let i = 0; i < n; i++) if (!drop[i]) keep.push(i);
    return keep.done();
  }
  /** Copy the selected rows of a table into a new table (dictionaries are shared). */
  function take(T, idx) {
    const cols = {};
    for (const [k, a] of Object.entries(T.cols)) { const b = new a.constructor(idx.length); for (let j = 0; j < idx.length; j++) b[j] = a[idx[j]]; cols[k] = b; }
    return { ...T, n: idx.length, cols };
  }
  /** Concatenate two tables of the same kind, re-encoding dictionaries. */
  function concat(A, B) {
    const cols = {}, dicts = {};
    for (const k of Object.keys(A.cols)) {
      const a = A.cols[k], b = B.cols[k];
      if (A.dicts[k]) {
        const d = new DictCol(); A.dicts[k].forEach((s) => d.code(s));
        const remap = B.dicts[k].map((s) => d.code(s));
        const out = new Int32Array(A.n + B.n); out.set(a); for (let i = 0; i < B.n; i++) out[A.n + i] = b[i] < 0 ? -1 : remap[b[i]];
        cols[k] = out; dicts[k] = d.dict;
      } else {
        const out = new a.constructor(A.n + B.n); out.set(a); out.set(b || new a.constructor(B.n).fill(NaN), A.n); cols[k] = out;
      }
    }
    return { ...A, n: A.n + B.n, cols, dicts };
  }

  Object.assign(MR, {
    DAY_NAMES, dayFromYMD, isoFromDay, dayFromIso, dowMon, weekStart, monthStart, monthKey, addMonths, parseDate, parseNum, parseTime, hm, hms, headerKey,
    cfg, configure, normaliseChannel, normaliseProgram, programBase, daypartFor, daypartOrder, durationBand, bandOrder, timebelt, hourBand,
    NumCol, DictCol, S, allIdx, where, codeSet, minMax, group, sortedKeys, quantile, median, mean, std0, std1, safeDiv, pctChange, title, fmtInt, range,
    hash52, dedupe, take, concat,
  });
})(typeof self !== 'undefined' ? self : globalThis);
