/* Themes ("skins"). Loaded in <head> so the saved skin is applied before the page paints.
 * The colours live in css/app.css under [data-skin="..."]; this file holds the list, the chart palettes and the picker.
 */
(function () {
  window.App = window.App || {};
  const P = (s) => s.split(' ');
  const SKINS = [
    { id: 'space', name: 'Deep Space', mode: 'dark', note: 'Futuristic neon on midnight', sw: ['#050816', '#3de0ff', '#8b5cf6', '#ff4fd8'],
      pal: P('#3de0ff #8b5cf6 #ff4fd8 #22f5a6 #ffb547 #4f8bff #ff6b6b #a3e635 #f472b6 #2dd4bf #facc15 #94a3b8') },
    { id: 'aurora', name: 'Aurora Light', mode: 'light', note: 'Deep Space, in daylight', sw: ['#eef3ff', '#0891b2', '#7c3aed', '#db2777'],
      pal: P('#0891b2 #7c3aed #db2777 #059669 #d97706 #2563eb #dc2626 #65a30d #c026d3 #0d9488 #ca8a04 #64748b') },
    { id: 'daylight', name: 'Daylight Studio', mode: 'light', note: 'Clean, light, agency', sw: ['#f5f7fb', '#ffffff', '#0d9488', '#1b2140'],
      pal: P('#0d9488 #2563eb #d97706 #7c3aed #e11d48 #059669 #0891b2 #a16207 #db2777 #4f46e5 #65a30d #64748b') },
    { id: 'ledger', name: 'Midnight Ledger', mode: 'dark', note: 'Executive navy and gold', sw: ['#0e1424', '#0a0f1c', '#d4a84b', '#e9e6dc'],
      pal: P('#d4a84b #6aa3d9 #c97b63 #8fbf8f #b79ad6 #e0c36a #5fb3b3 #d98aa0 #9aa8c7 #c2a878 #7fb069 #8c93a8') },
    { id: 'control', name: 'Broadcast Control Room', mode: 'dark', note: 'TV gallery, amber on charcoal', sw: ['#16171a', '#0d0e10', '#ffb020', '#ececec'],
      pal: P('#ffb020 #4fc3f7 #ff6b5a #7bd88f #c792ea #f4d35e #26c6da #ff8a65 #aed581 #ba68c8 #90a4ae #ffd54f') },
    { id: 'warm', name: 'Warm Studio', mode: 'light', note: 'Cream, coral and forest green', sw: ['#fbf6ee', '#1f4d3f', '#e8654a', '#2b2a26'],
      pal: P('#e8654a #1f6f5c #e0a030 #5b7fc7 #b85c8a #7a9e3c #d9822b #3a8f9e #a15c3b #6c5ba7 #c4553d #8a8478') },
    { id: 'paper', name: 'Paper & Ink', mode: 'light', note: 'Minimal editorial, icon rail', sw: ['#fafaf7', '#111111', '#e0312d', '#111111'],
      pal: P('#111111 #e0312d #2b6cb0 #2f855a #b7791f #6b46c1 #c05621 #2c7a7b #97266d #4a5568 #718096 #a0aec0') },
    { id: 'ocean', name: 'Ocean Glass', mode: 'light', note: 'Fresh blue-white with deep teal', sw: ['#eef7fa', '#0b3c49', '#0e7490', '#f59e0b'],
      pal: P('#0e7490 #2563eb #f59e0b #10b981 #8b5cf6 #ef4444 #06b6d4 #84cc16 #ec4899 #6366f1 #14b8a6 #64748b') },
    { id: 'violet', name: 'Violet Night', mode: 'dark', note: 'Rich purple with pink pop', sw: ['#140d24', '#0e0819', '#c084fc', '#f472b6'],
      pal: P('#c084fc #22d3ee #f472b6 #a3e635 #fbbf24 #60a5fa #fb7185 #34d399 #e879f9 #818cf8 #2dd4bf #a1a1aa') },
    { id: 'forest', name: 'Forest Dusk', mode: 'dark', note: 'Deep green with lime', sw: ['#0f1a14', '#0a120d', '#a3e635', '#34d399'],
      pal: P('#a3e635 #34d399 #fbbf24 #38bdf8 #f472b6 #fb923c #c084fc #2dd4bf #facc15 #4ade80 #f87171 #a8b5a0') },
    { id: 'slate', name: 'Slate Pro', mode: 'dark', note: 'Neutral grey, compact and calm', sw: ['#1b1f27', '#14171d', '#60a5fa', '#34d399'],
      pal: P('#60a5fa #34d399 #fbbf24 #f87171 #a78bfa #22d3ee #fb923c #f472b6 #a3e635 #818cf8 #2dd4bf #94a3b8') },
    { id: 'sunset', name: 'Sunset Pop', mode: 'light', note: 'Warm gradient, bold and bright', sw: ['#fff7f1', '#3b1d3a', '#f97316', '#db2777'],
      pal: P('#f97316 #db2777 #7c3aed #0891b2 #16a34a #eab308 #ef4444 #2563eb #c026d3 #0d9488 #a16207 #64748b') },
  ];
  const byId = (id) => SKINS.find((s) => s.id === id) || SKINS[0];
  const load = () => { try { const v = localStorage.getItem('skin'); if (v) return v; const old = localStorage.getItem('theme'); return old === 'light' ? 'aurora' : 'space'; } catch (e) { return 'space'; } };
  let current = byId(load());

  function apply(id, silent) {
    current = byId(id);
    const r = document.documentElement;
    r.dataset.skin = current.id; r.dataset.theme = current.mode;
    try { localStorage.setItem('skin', current.id); localStorage.setItem('theme', current.mode); } catch (e) { /* ignore */ }
    if (!silent) document.dispatchEvent(new Event('themechange'));
  }
  apply(current.id, true);

  let pop = null;
  function closePicker() { if (pop) { pop.remove(); pop = null; document.removeEventListener('keydown', onKey, true); document.removeEventListener('mousedown', onOut, true); } }
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closePicker(); } };
  const onOut = (e) => { if (pop && !pop.contains(e.target) && !e.target.closest('[data-skin-btn]')) closePicker(); };
  /** Opens the theme picker next to the given button. */
  function openPicker(anchor) {
    if (pop) { closePicker(); return; }
    pop = document.createElement('div'); pop.className = 'skin-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Choose a theme');
    pop.innerHTML = `<div class="skin-head"><b>Choose a theme</b><span>Saved on this computer</span></div><div class="skin-grid">${SKINS.map((s) => `<button type="button" class="skin-opt" data-id="${s.id}" aria-pressed="${s.id === current.id}">
        <span class="skin-sw" style="background:${s.sw[0]}"><i style="background:${s.sw[1]}"></i><i style="background:${s.sw[2]}"></i><i style="background:${s.sw[3]}"></i></span>
        <span class="skin-n">${s.name}</span><span class="skin-d">${s.note}</span></button>`).join('')}</div>`;
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect(), w = Math.min(560, innerWidth - 16);
    pop.style.width = w + 'px';
    pop.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left < innerWidth / 2 ? r.left : r.right - w)) + 'px';
    const h = pop.offsetHeight, below = r.bottom + 8 + h <= innerHeight;
    pop.style.top = Math.max(8, below ? r.bottom + 8 : r.top - h - 8) + 'px';
    pop.querySelectorAll('.skin-opt').forEach((b) => { b.onclick = () => { apply(b.dataset.id); pop.querySelectorAll('.skin-opt').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }; });
    document.addEventListener('keydown', onKey, true); document.addEventListener('mousedown', onOut, true);
    const on = pop.querySelector('[aria-pressed="true"]'); if (on) on.focus();
  }
  window.App.skins = { list: SKINS, current: () => current, palette: () => current.pal, apply, openPicker, closePicker };
})();
