/* Shared helpers: escaping, formatting, toasts and the fetch wrapper. */
window.App = window.App || {};
(function (App) {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = (v, d = 0) => Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmt = {
    lkr: (v) => (v == null ? 'n/a' : 'LKR ' + nf(Math.round(v))),
    lkrc: (v) => (v == null ? 'n/a' : 'LKR ' + fmt.compact(v)),
    num: (v, d = 0) => (v == null ? 'n/a' : nf(v, d)),
    pct: (v, d = 1) => (v == null ? 'n/a' : Number(v).toFixed(d) + '%'),
    compact(v) {
      if (v == null) return 'n/a';
      const a = Math.abs(v);
      if (a >= 1e9) return (v / 1e9).toFixed(1) + 'B';
      if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M';
      if (a >= 1e3) return (v / 1e3).toFixed(1) + 'K';
      return nf(v, a < 10 ? 2 : 0);
    },
    delta(v) {
      if (v == null) return '<span class="muted">n/a</span>';
      const cls = v > 0.05 ? 'up' : v < -0.05 ? 'down' : '';
      return `<span class="delta ${cls}">${v > 0 ? '+' : ''}${Number(v).toFixed(1)}%</span>`;
    },
    title: (s) => String(s ?? '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()),
  };
  function toast(msg, type = 'info', ms = 5000) {
    let box = document.querySelector('.toasts');
    if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    const t = document.createElement('div');
    t.className = 'toast ' + type; t.textContent = msg; box.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }
  async function request(url, opts = {}) {
    let res;
    try { res = await fetch(url, { credentials: 'same-origin', ...opts }); }
    catch (e) { throw Object.assign(new Error('Network problem. Check your connection and try again.'), { status: 0 }); }
    if (!res.ok) {
      let detail = res.statusText;
      try { const j = await res.json(); detail = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail); } catch (e) { /* keep status text */ }
      throw Object.assign(new Error(detail || 'Request failed'), { status: res.status });
    }
    return res;
  }
  const api = {
    async get(url) { return (await request(url)).json(); },
    async post(url, body) { return (await request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })).json(); },
    async put(url, body) { return (await request(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json(); },
    async del(url) { return (await request(url, { method: 'DELETE' })).json(); },
    async blob(url, body) {
      const res = await request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
      const cd = res.headers.get('Content-Disposition') || '';
      const m = /filename="?([^";]+)"?/.exec(cd);
      return { blob: await res.blob(), name: m ? m[1] : 'download' };
    },
    upload(url, file, onProgress) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url);
        xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
        xhr.onload = () => {
          let j = {};
          try { j = JSON.parse(xhr.responseText); } catch (e) { /* ignore */ }
          if (xhr.status >= 200 && xhr.status < 300) resolve(j);
          else reject(Object.assign(new Error(typeof j.detail === 'string' ? j.detail : 'Upload failed'), { status: xhr.status }));
        };
        xhr.onerror = () => reject(new Error('Network problem during upload.'));
        const fd = new FormData(); fd.append('file', file); xhr.send(fd);
      });
    },
  };
  function download(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const store = {
    get(k, d) { try { const v = sessionStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } },
  };
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const skeleton = (n = 3) => '<div class="stack">' + Array.from({ length: n }, () => '<div class="skeleton" style="height:120px"></div>').join('') + '</div>';
  const emptyState = (title, text) => `<div class="empty"><strong>${esc(title)}</strong>${esc(text || '')}</div>`;
  Object.assign(App, { esc, fmt, toast, api, download, debounce, store, $, $$, skeleton, emptyState });
})(window.App);
