/* App shell: sidebar with agency brand, client picker, navigation, theme, model status and the signed-in user. */
(function (App) {
  const { esc } = App;
  const I = {
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
    tv: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    kpi: '<path d="M3 17l5-6 4 4 8-10"/><path d="M15 5h5v5"/>',
    admin: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/>',
    side: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
    out: '<path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3"/>',
    film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M10 9l5 3-5 3z"/>',
  };
  const svg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${I[k]}</svg>`;
  const isDark = () => (document.documentElement.dataset.theme || 'dark') === 'dark';

  function setTheme(t) {
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('theme', t); } catch (e) { /* ignore */ }
    document.dispatchEvent(new Event('themechange'));
    paintThemeBtn();
  }
  function paintThemeBtn() {
    const b = document.getElementById('theme-btn'); if (!b) return;
    b.innerHTML = svg(isDark() ? 'sun' : 'moon') + `<span class="txt">${isDark() ? 'Light mode' : 'Dark mode'}</span>`;
    b.setAttribute('aria-label', isDark() ? 'Switch to light mode' : 'Switch to dark mode');
  }
  async function pollModel() {
    const pill = document.getElementById('model-pill'); if (!pill) return;
    try {
      const s = await App.api.get('/api/model-status');
      const ok = s.backend === 'timesfm' && s.loaded;
      pill.innerHTML = `<span class="dot ${ok ? 'ok' : 'warn'}"></span><span class="txt">${ok ? 'Forecast engine ready' : s.backend === 'fallback' ? 'Fallback model in use' : 'Forecast engine starts on first run'}</span>`;
      pill.title = s.backend === 'fallback' ? 'The main forecast model could not start; a simpler statistical model is in use.' : '';
    } catch (e) { pill.innerHTML = '<span class="dot"></span><span class="txt">Model status unavailable</span>'; }
  }
  function setClient(id) {
    try { localStorage.setItem('client', String(id)); } catch (e) { /* ignore */ }
  }

  /* ---------------- animated loader ---------------- */
  const loader = {
    el: null, t0: 0, n: 0,
    show(title = 'Initialising', sub = '') {
      loader.n += 1;
      if (!loader.el) {
        loader.el = document.createElement('div'); loader.el.className = 'loader'; loader.el.setAttribute('role', 'status'); loader.el.setAttribute('aria-live', 'polite');
        loader.el.innerHTML = `<div><div class="core"><div class="ring r1"></div><div class="ring r2"></div><div class="ring r3"></div><div class="orb"></div><div class="scan"></div></div>
          <div class="txt"><span data-t></span><small data-s></small></div><div class="bar indet"><i></i></div></div>`;
        document.body.appendChild(loader.el);
        requestAnimationFrame(() => loader.el && loader.el.classList.add('on'));
        loader.t0 = performance.now();
      }
      loader.el.querySelector('[data-t]').textContent = title;
      loader.el.querySelector('[data-s]').textContent = sub;
    },
    progress(p, sub) {
      if (!loader.el) return;
      const bar = loader.el.querySelector('.bar');
      if (p == null) bar.classList.add('indet'); else { bar.classList.remove('indet'); bar.firstElementChild.style.width = Math.round(Math.max(0, Math.min(1, p)) * 100) + '%'; }
      if (sub != null) loader.el.querySelector('[data-s]').textContent = sub;
    },
    async hide(minMs = 650) {
      loader.n = Math.max(0, loader.n - 1);
      if (loader.n > 0 || !loader.el) return;
      const wait = minMs - (performance.now() - loader.t0);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      const el = loader.el; loader.el = null;
      el.classList.remove('on'); setTimeout(() => el.remove(), 260);
    },
  };
  App.loader = loader;
  /** The intro film is loaded only when needed. */
  App.loadIntro = () => (App.intro ? Promise.resolve() : new Promise((res, rej) => { const s = document.createElement('script'); s.src = '/js/intro.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); }));

  /** "?" icon with a hover/focus explanation: how the chart predicts and what the planner gets from it. */
  App.help = function (how, get, opts = {}) {
    const esc2 = App.esc;
    return `<span class="help ${opts.left ? 'left' : ''}" tabindex="0" role="button" aria-label="How to read this chart"><span aria-hidden="true">?</span><span class="tip" role="tooltip">
      <b>${esc2(opts.howLabel || 'How it predicts')}</b><p>${esc2(how)}</p><b>What you get</b><p>${esc2(get)}</p></span></span>`;
  };
  /** Planner's Evidence box: plain-language findings and recommendations under a chart. */
  App.evidenceBox = function (items, title = "Planner's Evidence", opts = {}) {
    const list = (items || []).filter(Boolean);
    if (!list.length) return '';
    return `<div class="evidence-box"><div class="ev-head"><svg class="ico" viewBox="0 0 24 24" style="width:16px;height:16px"><path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>${App.esc(title)}</div>
      ${opts.note ? `<div class="ev-note">${App.esc(opts.note)}</div>` : ''}<ul>${list.map((x) => (typeof x === 'string' ? `<li>${App.esc(x)}</li>` : `<li class="${x.rec ? 'rec' : ''}">${x.rec ? '&#9656; ' : ''}${App.esc(x.text)}</li>`)).join('')}</ul></div>`;
  };

  App.shell = {
    me: null,
    client: () => (App.shell.me ? App.shell.me.clients.find((c) => String(c.id) === App.clientId()) : null),
    async init(active) {
      const me = await App.api.get('/api/auth/me');   // redirects to sign in on 401
      App.shell.me = me;
      if (!me.clients.find((c) => String(c.id) === App.clientId())) setClient(me.clients.length ? me.clients[0].id : '');
      const cur = App.shell.client();
      let side = document.getElementById('sidebar');
      if (!side) { side = document.createElement('aside'); side.id = 'sidebar'; document.querySelector('.layout').prepend(side); }
      side.className = 'sidebar';
      side.setAttribute('aria-label', 'Main navigation');
      const b = me.branding;
      const mark = b.has_logo ? '<img src="/api/branding/logo" alt="" class="brand-logo">'
        : '<span class="brand-mark"><svg class="ico" style="stroke:#fff" viewBox="0 0 24 24"><path d="M3 17l5-6 4 4 8-10"/><path d="M15 5h5v5"/></svg></span>';
      const link = (href, key, icon, label) => `<a href="${href}" ${active === key ? 'aria-current="page"' : ''}>${svg(icon)}<span class="txt">${label}</span></a>`;
      side.innerHTML = `
        <div class="brand">${mark}<span class="brand-text">${esc(b.agency_name)}</span></div>
        <div class="client-pick">
          <label class="nav-label" for="client-sel">Client</label>
          ${me.clients.length ? `<div class="client-row">${cur && cur.has_logo ? `<img src="/api/clients/${cur.id}/logo" alt="" class="client-logo">` : `<span class="client-dot" style="background:${esc(cur ? cur.brand_color : '#5b5ce6')}"></span>`}
            <select id="client-sel" aria-label="Choose client">${me.clients.map((c) => `<option value="${c.id}" ${cur && c.id === cur.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>`
          : `<div class="txt small" style="padding:0 10px">${me.user.is_admin ? '<a href="/admin.html" style="color:#c7c8ff">Create your first client</a>' : 'No clients assigned yet'}</div>`}
        </div>
        <nav class="nav" aria-label="Workspaces">
          <div class="nav-label">Workspaces</div>
          ${link('/', 'home', 'home', 'Mission control')}
          ${link('/tv.html', 'tv', 'tv', 'TVR Audience Prediction')}
          ${link('/lmrb.html', 'lmrb', 'chart', 'Market Prediction')}
          ${me.user.is_admin ? `<div class="nav-label">Agency</div>${link('/admin.html', 'admin', 'admin', 'Admin')}` : ''}
        </nav>
        <div class="side-foot nav">
          <div class="model-pill" id="model-pill"><span class="dot"></span><span class="txt">Checking model</span></div>
          <button id="intro-btn" type="button">${svg('film')}<span class="txt">Watch intro</span></button>
          <button id="theme-btn" type="button"></button>
          <button id="collapse-btn" type="button" aria-label="Collapse sidebar">${svg('side')}<span class="txt">Collapse</span></button>
          <button id="signout-btn" type="button" title="${esc(me.user.email)}">${svg('out')}<span class="txt">Sign out <span class="small" style="opacity:.6">${esc(me.user.email)}</span></span></button>
        </div>`;
      const sel = document.getElementById('client-sel');
      if (sel) sel.onchange = () => { setClient(sel.value); App.loader.show('Switching client', 'Loading this client\'s data from your browser'); location.reload(); };
      try { if (localStorage.getItem('side') === '1') document.body.classList.add('side-collapsed'); } catch (e) { /* ignore */ }
      document.getElementById('intro-btn').onclick = () => App.loadIntro().then(() => App.intro.open(true));
      document.getElementById('theme-btn').onclick = () => setTheme(isDark() ? 'light' : 'dark');
      document.getElementById('collapse-btn').onclick = () => {
        const c = document.body.classList.toggle('side-collapsed');
        try { localStorage.setItem('side', c ? '1' : '0'); } catch (e) { /* ignore */ }
      };
      document.getElementById('signout-btn').onclick = async () => { try { await App.api.post('/api/auth/logout'); } catch (e) { /* ignore */ } location.href = '/login.html'; };
      const mb = document.getElementById('menu-btn');
      if (mb) mb.onclick = () => {
        const open = document.body.classList.toggle('menu-open');
        let s = document.querySelector('.scrim');
        if (open && !s) { s = document.createElement('div'); s.className = 'scrim'; s.onclick = () => { document.body.classList.remove('menu-open'); s.remove(); }; document.body.appendChild(s); }
        if (!open && s) s.remove();
      };
      if (cur) document.documentElement.style.setProperty('--client', cur.brand_color);
      paintThemeBtn(); pollModel();
      return me;
    },
    refreshModel: pollModel,
    noClient(root) {
      root.innerHTML = App.emptyState('No client selected', App.shell.me && App.shell.me.user.is_admin ? 'Create a client in Admin, then pick it in the sidebar.' : 'Ask an admin to give you access to a client.');
    },
  };
})(window.App);
