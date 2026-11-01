/* Data worker: parses uploads off the main thread, keeps columnar tables in memory and in IndexedDB
 * (per signed-in user and client), and answers dashboard, rows, series and prediction requests.
 * Raw rows never leave the browser; only compact aggregates and series go to the server.
 */
/* global MR */
importScripts('/js/vendor/xlsx.full.min.js', '/js/engine/core.js', '/js/engine/ingest.js', '/js/engine/filters.js', '/js/engine/analytics_tv.js',
  '/js/engine/analytics_lmrb.js', '/js/engine/analytics_kpi.js', '/js/engine/ingest_kpi.js', '/js/engine/joins.js', '/js/engine/series.js', '/js/engine/predict.js');

const DB_NAME = 'media-radar', DB_VER = 1, MAX_CSV_ROWS = 1000000;
let scope = null;                       // "u<user>:c<client>"
const tables = { tv: null, lmrb: null, kpi: new Map() };
const pending = new Map();              // KPI proposals waiting for the column mapping
const sortCache = new Map();

/* ---------------- IndexedDB ---------------- */
let dbp = null;
function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, DB_VER);
      r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta'); if (!d.objectStoreNames.contains('cols')) d.createObjectStore('cols'); };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  return dbp;
}
const done = (tx) => new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error || new Error('Storage transaction failed')); });
const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
const range = (prefix) => IDBKeyRange.bound(prefix, prefix + '￿');
const slotOf = (kind, name) => (kind === 'kpi' ? `kpi:${name}` : kind);

async function saveTable(slot, T) {
  const d = await db(), key = `${scope}|${slot}`;
  const meta = { kind: T.kind, n: T.n, dicts: T.dicts, report: T.report, files: T.files || [], meta: T.meta || null, sig: T.sig, saved_at: Date.now(),
    cols: Object.keys(T.cols), types: Object.fromEntries(Object.entries(T.cols).map(([k, a]) => [k, a.constructor.name])) };
  try {
    const tx = d.transaction(['meta', 'cols'], 'readwrite');
    tx.objectStore('cols').delete(range(key + '|'));
    tx.objectStore('meta').put(meta, key);
    for (const [c, a] of Object.entries(T.cols)) tx.objectStore('cols').put(a, `${key}|${c}`);
    await done(tx);
    return true;
  } catch (e) {
    const full = e && (e.name === 'QuotaExceededError' || /quota/i.test(String(e.message)));
    throw new MR.IngestError(full ? 'Browser storage is full. The data is loaded for this session only. Free space by removing older sheets or clearing site data for other sites, then upload again.'
      : `Could not save the data in this browser (${e && e.message}). It is loaded for this session only.`);
  }
}
async function deleteTable(slot) {
  const d = await db(), key = `${scope}|${slot}`, tx = d.transaction(['meta', 'cols'], 'readwrite');
  tx.objectStore('meta').delete(key); tx.objectStore('cols').delete(range(key + '|'));
  await done(tx);
}
async function loadAll() {
  const d = await db();
  const tx = d.transaction(['meta', 'cols'], 'readonly');
  const keys = await req(tx.objectStore('meta').getAllKeys(range(scope + '|')));
  const metas = await req(tx.objectStore('meta').getAll(range(scope + '|')));
  const out = [];
  for (let k = 0; k < keys.length; k++) {
    const m = metas[k], key = keys[k], cols = {};
    for (const c of m.cols) cols[c] = await req(tx.objectStore('cols').get(`${key}|${c}`));
    if (m.cols.some((c) => !cols[c])) continue;     // incomplete write: skip
    out.push({ slot: key.slice(scope.length + 1), T: { kind: m.kind, n: m.n, cols, dicts: m.dicts, report: m.report, files: m.files, meta: m.meta, sig: m.sig } });
  }
  return out;
}
async function usage() {
  try { const e = await navigator.storage.estimate(); return { usage: e.usage || 0, quota: e.quota || 0 }; } catch (e) { return { usage: 0, quota: 0 }; }
}

/* ---------------- helpers ---------------- */
const sig = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
function table(kind, name) {
  const T = kind === 'kpi' ? tables.kpi.get(name || '') : tables[kind];
  if (!T || !T.n) throw new MR.IngestError(kind === 'kpi' ? 'Choose a KPI dataset or upload one.' : `No ${kind === 'tv' ? 'TVR' : 'LMRB'} data loaded yet. Upload the sheet first.`);
  return T;
}
const lmrbBase = (options) => (tables.tv ? MR.withGrps(tables.lmrb, tables.tv, (options && options.tv_data_set) || null) : tables.lmrb);
function baseFrame(kind, name, options) { if (kind === 'lmrb') { table('lmrb'); return lmrbBase(options); } return table(kind, name); }
function info(T) {
  if (!T) return null;
  const r = T.report || {};
  return { loaded: true, rows: T.n, files: T.files || [], date_min: r.date_min, date_max: r.date_max, sig: T.sig, report: r };
}
async function status() {
  return { scope, tv: info(tables.tv), lmrb: info(tables.lmrb), kpi: [...tables.kpi.entries()].map(([name, T]) => ({ name, ...info(T) })), storage: await usage() };
}
function competitorScope(L, idx, filters, options) {
  if (!options || !options.my_brand) return idx;
  const nodate = MR.applyFilters(L, 'lmrb', filters, true);
  const set = MR.codeSet(L, 'advertiser', MR.competitorSet(L, nodate, options.my_brand, options.competitors && options.competitors.length ? options.competitors : null));
  return MR.where(L, idx, (i) => set.has(L.cols.advertiser[i]));
}

/* ---------------- rows ---------------- */
const ROW_COLS = {
  tv: ['date', 'day', 'channel', 'start', 'end', 'program', 'category', 'data_set', 'daypart', 'duration', 'tvr', 'total_tvr', 'tvr_share', 'reach', 'reach_pct'],
  lmrb: ['date', 'day', 'channel', 'program', 'advt_time', 'daypart', 'advertiser', 'product', 'theme', 'product_group', 'lng', 'dur', 'dur_band', 'position', 'brkno', 'posinbrk', 'adsinbrk', 'cost', 'cps'],
};
function cellFn(T, c) {
  const C = T.cols;
  if (c === 'date') return (i) => MR.isoFromDay(C.date[i]);
  if (c === 'day') return (i) => MR.DAY_NAMES[MR.dowMon(C.date[i])];
  if (c === 'start' || c === 'end') return (i) => MR.hm(C[c][i]) || '';
  if (c === 'advt_time') return (i) => MR.hms(C.advt_sec[i]) || '';
  if (c === 'position') return (i) => MR.POS[C.position[i]];
  if (c === 'cps') return (i) => (C.dur[i] > 0 ? C.cost[i] / C.dur[i] : null);
  if (T.dicts[c]) return (i) => MR.S(T, c, i);
  const A = C[c];
  if (!A) return () => null;
  if (A instanceof Int32Array) return (i) => (A[i] < 0 ? null : A[i]);
  return (i) => (Number.isFinite(A[i]) ? A[i] : null);
}
function rowColumns(kind, T) { return kind === 'kpi' ? ['date', 'segment'].concat(T.meta.metrics.map((m) => m.key)) : ROW_COLS[kind]; }
function searchFilter(T, kind, idx, q) {
  q = String(q || '').trim().toUpperCase();
  if (!q) return idx;
  const strCols = rowColumns(kind, T).filter((c) => T.dicts[c]);
  const hits = strCols.map((c) => { const s = new Set(); T.dicts[c].forEach((v, k) => { if (String(v).toUpperCase().includes(q)) s.add(k); }); return [T.cols[c], s]; }).filter(([, s]) => s.size);
  return MR.where(T, idx, (i) => hits.some(([C, s]) => s.has(C[i])));
}
function sortedIdx(T, kind, idx, sort, desc, cacheKey) {
  if (!sort) return idx;
  const k = `${cacheKey}|${sort}|${desc}`;
  if (sortCache.has(k)) return sortCache.get(k);
  const f = cellFn(T, sort === 'day' ? 'date' : sort), arr = Array.from(idx), vals = new Map();
  if (T.dicts[sort]) { const C = T.cols[sort], order = T.dicts[sort].map((s, i) => [s, i]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)), rank = new Int32Array(order.length); order.forEach(([, c], r) => { rank[c] = r; }); arr.sort((a, b) => ((C[a] < 0 ? -1 : rank[C[a]]) - (C[b] < 0 ? -1 : rank[C[b]])) || (a - b)); }
  else {
    const raw = sort === 'date' || sort === 'day' ? T.cols.date : (T.cols[sort] && !(sort === 'start' || sort === 'end') ? T.cols[sort] : null);
    const get = raw ? (i) => raw[i] : (i) => { if (!vals.has(i)) vals.set(i, f(i)); return vals.get(i); };
    const key = (v) => (v == null || (typeof v === 'number' && !Number.isFinite(v)) ? -Infinity : v);
    arr.sort((a, b) => { const x = key(get(a)), y = key(get(b)); return (x < y ? -1 : x > y ? 1 : 0) || (a - b); });
  }
  if (desc) arr.reverse();
  const out = Int32Array.from(arr);
  sortCache.clear(); sortCache.set(k, out);
  return out;
}
const csvCell = (v) => { if (v == null) return ''; let s = String(v); if (/^[=+\-@\t\r]/.test(s) && typeof v === 'string') s = "'" + s; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/* ---------------- operations ---------------- */
const OPS = {
  async open({ uid, cid, config }) {
    if (config) MR.configure(config);
    const next = `u${uid}:c${cid}`;
    if (next !== scope) {
      scope = next; tables.tv = null; tables.lmrb = null; tables.kpi.clear(); pending.clear(); sortCache.clear();
      try {
        for (const { slot, T } of await loadAll()) {
          if (slot.startsWith('kpi:')) tables.kpi.set(slot.slice(4), T); else tables[slot] = T;
        }
      } catch (e) { /* storage unavailable (private mode): start empty */ }
    }
    return status();
  },
  status,
  configure({ config }) { MR.configure(config); return true; },

  async upload({ kind, file, mode }, progress) {
    if (!scope) throw new MR.IngestError('Sign in and pick a client first.');
    progress(0, `Reading ${file.name}`);
    const T = await MR.parseFile(kind, file, (p) => progress(Math.min(0.9, p * 0.9), `Reading ${file.name}`));
    T.files = [file.name];
    let out = T, merged = null;
    const old = tables[kind];
    if (mode === 'append' && old) {
      merged = MR.merge(kind, old, T);
      out = merged.T;
      out.files = (old.files || []).concat(file.name);
      const lo = MR.minMax(out.cols.date, MR.allIdx(out));
      out.report = { ...T.report, appended: true, rows_added: merged.added, rows_skipped_as_duplicates: merged.skipped, rows_total_after_merge: out.n,
        date_min: MR.isoFromDay(lo[0]), date_max: MR.isoFromDay(lo[1]), n_days: new Set(out.cols.date).size };
    }
    out.sig = sig();
    tables[kind] = out; sortCache.clear();
    progress(0.95, 'Saving in this browser');
    let saved = true, warning = null;
    try { await saveTable(kind, out); } catch (e) { saved = false; warning = e.message; }
    return { ...(await status()), report: out.report, saved, warning };
  },
  async remove({ kind, name }) {
    if (kind === 'kpi') tables.kpi.delete(name); else tables[kind] = null;
    sortCache.clear();
    try { await deleteTable(slotOf(kind, name)); } catch (e) { /* ignore */ }
    return status();
  },
  async clearAll() {
    const d = await db(), tx = d.transaction(['meta', 'cols'], 'readwrite');
    tx.objectStore('meta').delete(range(scope + '|')); tx.objectStore('cols').delete(range(scope + '|'));
    await done(tx);
    tables.tv = null; tables.lmrb = null; tables.kpi.clear();
    return status();
  },

  state({ kind, name }) {
    if (kind === 'kpi') {
      const datasets = [...tables.kpi.entries()].map(([n, T]) => ({ name: n, rows: T.n, date_min: T.report.date_min, date_max: T.report.date_max }));
      const T = tables.kpi.get(name || '');
      if (!T) return { loaded: false, datasets };
      return { loaded: true, datasets, files: T.files, report: T.report, meta: T.meta, options: MR.filterOptions(T, 'kpi'), sig: T.sig };
    }
    const T = tables[kind];
    if (!T) return { loaded: false };
    const st = { loaded: true, files: T.files, report: T.report, options: MR.filterOptions(T, kind), sig: T.sig };
    if (kind === 'lmrb' && tables.tv) st.tv_data_sets = MR.filterOptions(tables.tv, 'tv').data_set_list;
    return st;
  },
  globalOptions() { return MR.globalOptions(tables.tv, tables.lmrb); },

  dashboard({ kind, name, filters, options }) {
    const T = baseFrame(kind, name, options), f = filters || {}, o = options || {};
    const idx = MR.applyFilters(T, kind, f);
    const meta = { total_rows: T.n, filtered_rows: idx.length, chips: MR.describeFilters(kind, f), has_lmrb: !!tables.lmrb, has_tv: !!tables.tv, files: T.files || [] };
    let data;
    if (kind === 'tv') data = MR.tvDashboard(T, idx, tables.lmrb);
    else if (kind === 'lmrb') {
      data = MR.lmrbDashboard(T, MR.applyFilters(T, kind, f, true), f, o.my_brand || null, o.competitors && o.competitors.length ? o.competitors : null);
      if (T.grpStats) meta.grp_stats = T.grpStats;
    } else {
      data = MR.kpiDashboard(T, idx, MR.applyFilters(T, kind, f, true), f);
      meta.dataset_meta = T.meta;
    }
    return { data, meta };
  },
  head2head({ filters, options }) {
    const L = baseFrame('lmrb', '', options), f = filters || {};
    return MR.headToHead(L, MR.applyFilters(L, 'lmrb', f, true), f, options.a, options.b);
  },
  rows({ kind, name, filters, options, page = 1, page_size = 25, sort, desc, search }) {
    const T = baseFrame(kind, name, options);
    let idx = MR.applyFilters(T, kind, filters || {});
    idx = searchFilter(T, kind, idx, search);
    idx = sortedIdx(T, kind, idx, sort, desc, `${T.sig}|${kind}|${name || ''}|${JSON.stringify(filters || {})}|${search || ''}`);
    const cols = rowColumns(kind, T), fns = cols.map((c) => cellFn(T, c));
    const size = Math.max(1, Math.min(500, page_size)), start = (Math.max(1, page) - 1) * size;
    const rows = [];
    for (let k = start; k < Math.min(idx.length, start + size); k++) rows.push(fns.map((fn) => fn(idx[k])));
    return { columns: cols, rows, total: idx.length };
  },
  rowsCsv({ kind, name, filters, options }) {
    const T = baseFrame(kind, name, options), idx = MR.applyFilters(T, kind, filters || {});
    const cols = rowColumns(kind, T), fns = cols.map((c) => cellFn(T, c)), n = Math.min(idx.length, MAX_CSV_ROWS);
    const parts = [cols.join(',') + '\n'];
    let chunk = [];
    for (let k = 0; k < n; k++) { chunk.push(fns.map((fn) => csvCell(fn(idx[k]))).join(',')); if (chunk.length === 20000) { parts.push(chunk.join('\n') + '\n'); chunk = []; } }
    if (chunk.length) parts.push(chunk.join('\n') + '\n');
    return { blob: new Blob(parts, { type: 'text/csv' }), name: `${kind}_filtered_rows.csv`, truncated: idx.length > n };
  },

  entities({ kind, name, filters, options, entity_type, metric }) {
    const T = baseFrame(kind, name, options);
    const idx = kind === 'lmrb' ? competitorScope(T, MR.applyFilters(T, kind, filters || {}), filters || {}, options) : MR.applyFilters(T, kind, filters || {});
    const catalog = MR.metricCatalog(kind, T, T.meta);
    const date_max = T.report && T.report.date_max;
    const gran = kind === 'kpi' ? (T.meta.granularity || 'daily') : 'daily';
    let entities = [];
    if (entity_type) { try { entities = MR.rankEntities(T, idx, kind, entity_type, 60, T.meta, metric); } catch (e) { entities = []; } }
    return { catalog, entities, date_max, default_granularity: gran === 'daily' && kind !== 'kpi' ? 'daily' : gran };
  },
  series({ kind, name, filters, options, entity_type, metric, granularity, entities, history_days, max_entities }) {
    const T = baseFrame(kind, name, options);
    const idx = kind === 'lmrb' ? competitorScope(T, MR.applyFilters(T, kind, filters || {}), filters || {}, options) : MR.applyFilters(T, kind, filters || {});
    const res = MR.buildSeries(T, idx, kind, entity_type, metric, granularity, { entities, historyDays: history_days || null, maxEntities: max_entities || 8, meta: T.meta });
    return { series: res.series.map((s) => MR.payloadItem(s)), notes: res.notes, granularity: res.gran };
  },

  predictTvr({ filters }) {
    const T = table('tv'), idx = MR.applyFilters(T, 'tv', filters || {});
    return MR.tvrPayload(T, idx);
  },
  predictMarket({ filters, options }) {
    table('lmrb');
    const L = lmrbBase(options), idx = MR.applyFilters(L, 'lmrb', filters || {});
    return MR.marketPayload(L, idx, options || {});
  },

  async kpiPropose({ file }, progress) {
    const { proposal, pending: p } = await MR.proposeKpi(file, (x) => progress(x * 0.9, `Reading ${file.name}`));
    const token = sig();
    pending.clear(); pending.set(token, p);
    return { ...proposal, token };
  },
  async kpiApply({ token, dataset, mode, mapping }, progress) {
    const p = pending.get(token);
    if (!p) throw new MR.IngestError('This upload has expired. Please upload the file again.');
    let T = MR.applyKpi(p, mapping);
    T.files = [p.file_name];
    const old = tables.kpi.get(dataset);
    if (mode === 'append' && old) { const m = MR.mergeKpi(old, T); T = m.T; T.files = (old.files || []).concat(p.file_name); }
    T.sig = sig();
    tables.kpi.set(dataset, T); pending.delete(token); sortCache.clear();
    progress(0.95, 'Saving in this browser');
    let warning = null;
    try { await saveTable(slotOf('kpi', dataset), T); } catch (e) { warning = e.message; }
    return { ...OPS.state({ kind: 'kpi', name: dataset }), warning };
  },
  async kpiMeta({ dataset, metrics, ratios }) {
    const T = MR.updateKpiMeta(table('kpi', dataset), { metrics, ratios });
    T.sig = sig();
    tables.kpi.set(dataset, T);
    try { await saveTable(slotOf('kpi', dataset), T); } catch (e) { /* keep in memory */ }
    return OPS.state({ kind: 'kpi', name: dataset });
  },
};

self.onmessage = async (e) => {
  const { id, op, args } = e.data || {};
  const progress = (p, message) => self.postMessage({ id, progress: p, message });
  try {
    if (!OPS[op]) throw new Error(`Unknown operation ${op}`);
    const result = await OPS[op](args || {}, progress);
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: (err && err.message) || String(err), user: !!(err && err.name === 'IngestError') });
  }
};
