/* Filter panel: multi-selects, ranges, chips bar and Reset. State persists for the page session. */
(function (App) {
  const { esc, $, $$ } = App;
  const SCHEMA = {
    tv: [
      { type: 'date', label: 'Date range' },
      { key: 'channel', label: 'Channel', type: 'multi' }, { key: 'category', label: 'Category', type: 'multi' },
      { key: 'day', label: 'Day', type: 'multi' }, { key: 'daypart', label: 'Daypart', type: 'multi' },
      { key: 'data_set', label: 'Data set', type: 'multi' },
      { key: 'program_search', label: 'Programme search', type: 'text' },
      { type: 'range', label: 'TVR range', min: 'tvr_min', max: 'tvr_max', opt: 'tvr_range' },
    ],
    lmrb: [
      { type: 'date', label: 'Date range' },
      { key: 'product_group', label: 'Product group', type: 'multi' }, { key: 'advertiser', label: 'Advertiser', type: 'multi' },
      { key: 'product', label: 'Product', type: 'multi' }, { key: 'channel', label: 'Channel', type: 'multi' },
      { key: 'program', label: 'Programme', type: 'multi' }, { key: 'language', label: 'Language', type: 'multi' },
      { key: 'duration_band', label: 'Duration band', type: 'multi' }, { key: 'daypart', label: 'Daypart', type: 'multi' },
      { key: 'ad_position', label: 'Ad position', type: 'multi' },
      { type: 'range', label: 'Cost range (LKR)', min: 'cost_min', max: 'cost_max', opt: 'cost_range' },
    ],
    kpi: [{ type: 'date', label: 'Date range' }, { key: 'segment', label: 'Segment', type: 'multi' }],
  };

  function multi(field, options, state, onChange) {
    const wrap = document.createElement('div'); wrap.className = 'field ms';
    const id = 'ms-' + field.key;
    wrap.innerHTML = `<label for="${id}">${esc(field.label)}</label><button type="button" class="ms-btn" id="${id}" aria-haspopup="listbox" aria-expanded="false"><span></span><span aria-hidden="true">&#9662;</span></button>`;
    const btn = $('button', wrap), label = $('span', btn);
    const paint = () => { const n = (state[field.key] || []).length; label.textContent = n === 0 ? 'All' : n === 1 ? state[field.key][0] : `${n} selected`; };
    let pop = null;
    const close = () => { if (pop) { pop.remove(); pop = null; btn.setAttribute('aria-expanded', 'false'); document.removeEventListener('click', outside, true); } };
    const outside = (e) => { if (pop && !wrap.contains(e.target)) close(); };
    const open = () => {
      pop = document.createElement('div'); pop.className = 'ms-pop';
      pop.innerHTML = `<input type="search" placeholder="Search" aria-label="Search ${esc(field.label)}"><div class="row" style="margin-top:6px"><button type="button" class="btn sm" data-clear>Clear</button><span class="muted small" data-count></span></div><div class="ms-list" role="listbox" aria-multiselectable="true"></div>`;
      wrap.appendChild(pop); btn.setAttribute('aria-expanded', 'true');
      const list = $('.ms-list', pop), search = $('input', pop);
      const draw = () => {
        const q = search.value.toLowerCase(); const sel = new Set(state[field.key] || []);
        list.innerHTML = options.filter((o) => o.toLowerCase().includes(q)).slice(0, 300).map((o) => `<label class="ms-opt" role="option"><input type="checkbox" value="${esc(o)}" ${sel.has(o) ? 'checked' : ''}> <span>${esc(o)}</span></label>`).join('') || '<div class="muted small" style="padding:6px">No matches</div>';
        $('[data-count]', pop).textContent = options.length + ' options';
      };
      list.onchange = (e) => { const v = e.target.value; const s = new Set(state[field.key] || []); e.target.checked ? s.add(v) : s.delete(v); state[field.key] = [...s]; if (!s.size) delete state[field.key]; paint(); onChange(); };
      $('[data-clear]', pop).onclick = () => { delete state[field.key]; paint(); draw(); onChange(); };
      search.oninput = draw; draw(); search.focus();
      document.addEventListener('click', outside, true);
    };
    btn.onclick = () => (pop ? close() : open());
    wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') { close(); btn.focus(); } });
    paint(); wrap.repaint = paint;
    return wrap;
  }

  function init(container, kind, opts, onChange, storeKey) {
    const key = storeKey || 'filters:' + kind;
    let state = App.store.get(key, {});
    const fire = App.debounce(() => { App.store.set(key, state); onChange(state); }, 350);
    const change = () => { App.store.set(key, state); fire(); };
    const grid = document.createElement('div'); grid.className = 'filter-grid';
    const widgets = [];
    for (const f of SCHEMA[kind]) {
      if (f.type === 'multi') {
        if (!opts[f.key]) continue;
        const w = multi(f, opts[f.key], state, change); widgets.push(w); grid.appendChild(w);
      } else if (f.type === 'date') {
        const w = document.createElement('div'); w.className = 'field';
        w.innerHTML = `<label>${f.label}</label><div class="row" style="flex-wrap:nowrap"><input type="date" aria-label="From date" data-k="date_from" min="${opts.date_min}" max="${opts.date_max}"><input type="date" aria-label="To date" data-k="date_to" min="${opts.date_min}" max="${opts.date_max}"></div>`;
        grid.appendChild(w); widgets.push(w);
      } else if (f.type === 'text') {
        const w = document.createElement('div'); w.className = 'field';
        w.innerHTML = `<label>${f.label}</label><input type="search" data-k="${f.key}" placeholder="Type to search">`;
        grid.appendChild(w); widgets.push(w);
      } else if (f.type === 'range') {
        const r = opts[f.opt] || [0, 0];
        const w = document.createElement('div'); w.className = 'field';
        w.innerHTML = `<label>${f.label}</label><div class="row" style="flex-wrap:nowrap"><input type="number" step="any" data-k="${f.min}" placeholder="${Math.floor(r[0])}" aria-label="Minimum"><input type="number" step="any" data-k="${f.max}" placeholder="${Math.ceil(r[1])}" aria-label="Maximum"></div>`;
        grid.appendChild(w); widgets.push(w);
      }
    }
    const sync = () => { $$('[data-k]', grid).forEach((i) => { i.value = state[i.dataset.k] ?? ''; }); widgets.forEach((w) => w.repaint && w.repaint()); };
    grid.addEventListener('input', (e) => {
      const k = e.target.dataset && e.target.dataset.k; if (!k) return;
      const v = e.target.value; if (v === '') delete state[k]; else state[k] = v; change();
    });
    container.replaceChildren(grid); sync();
    return {
      get: () => ({ ...state }),
      reset() { state = {}; App.store.set(key, state); sync(); onChange(state); },
      remove(chipKey) {
        const map = { date: ['date_from', 'date_to'], tvr: ['tvr_min', 'tvr_max'], cost: ['cost_min', 'cost_max'] };
        (map[chipKey] || [chipKey]).forEach((k) => delete state[k]);
        App.store.set(key, state); sync(); onChange(state);
      },
      active: () => Object.keys(state).length > 0,
    };
  }
  function chips(el, list, onRemove) {
    el.innerHTML = list.length ? list.map((c) => `<span class="chip">${esc(c.label)}: ${esc(c.value)}<button type="button" data-k="${esc(c.key)}" aria-label="Remove ${esc(c.label)} filter">&times;</button></span>`).join('') : '<span class="muted small">No filters applied</span>';
    el.querySelectorAll('button[data-k]').forEach((b) => { b.onclick = () => onRemove(b.dataset.k); });
  }
  App.filters = { init, chips, multi };
})(window.App);
