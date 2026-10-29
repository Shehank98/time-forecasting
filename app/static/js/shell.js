/* App shell: sidebar, theme toggle, collapse, model status pill. */
(function (App) {
  const I = {
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
    tv: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/>',
    side: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  };
  const svg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${I[k]}</svg>`;
  const isDark = () => (document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';

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
      pill.innerHTML = `<span class="dot ${ok ? 'ok' : 'warn'}"></span><span class="txt">${ok ? 'TimesFM 2.0 ready' : s.backend === 'fallback' ? 'Fallback model in use' : 'TimesFM loads on first forecast'}</span>`;
      pill.title = s.error || s.note || '';
    } catch (e) { pill.innerHTML = '<span class="dot"></span><span class="txt">Model status unavailable</span>'; }
  }
  App.shell = {
    init(active) {
      let side = document.getElementById('sidebar');
      if (!side) { side = document.createElement('aside'); side.id = 'sidebar'; document.querySelector('.layout').prepend(side); }
      side.className = 'sidebar';
      side.setAttribute('aria-label', 'Main navigation');
      side.innerHTML = `
        <div class="brand"><span class="brand-mark"><svg class="ico" style="stroke:#fff" viewBox="0 0 24 24"><path d="M3 17l5-6 4 4 8-10"/><path d="M15 5h5v5"/></svg></span><span class="brand-text">Media Radar</span></div>
        <nav class="nav" aria-label="Workspaces">
          <div class="nav-label">Workspaces</div>
          <a href="/" ${active === 'home' ? 'aria-current="page"' : ''}>${svg('home')}<span class="txt">Home</span></a>
          <a href="/tv.html" ${active === 'tv' ? 'aria-current="page"' : ''}>${svg('tv')}<span class="txt">TV Programme Analysis</span></a>
          <a href="/lmrb.html" ${active === 'lmrb' ? 'aria-current="page"' : ''}>${svg('chart')}<span class="txt">LMRB Ad Monitoring</span></a>
        </nav>
        <div class="side-foot nav">
          <div class="model-pill" id="model-pill"><span class="dot"></span><span class="txt">Checking model</span></div>
          <button id="theme-btn" type="button"></button>
          <button id="collapse-btn" type="button" aria-label="Collapse sidebar">${svg('side')}<span class="txt">Collapse</span></button>
        </div>`;
      try { if (localStorage.getItem('side') === '1') document.body.classList.add('side-collapsed'); } catch (e) { /* ignore */ }
      document.getElementById('theme-btn').onclick = () => setTheme(isDark() ? 'light' : 'dark');
      document.getElementById('collapse-btn').onclick = () => {
        const c = document.body.classList.toggle('side-collapsed');
        try { localStorage.setItem('side', c ? '1' : '0'); } catch (e) { /* ignore */ }
      };
      const mb = document.getElementById('menu-btn');
      if (mb) mb.onclick = () => {
        const open = document.body.classList.toggle('menu-open');
        let s = document.querySelector('.scrim');
        if (open && !s) { s = document.createElement('div'); s.className = 'scrim'; s.onclick = () => { document.body.classList.remove('menu-open'); s.remove(); }; document.body.appendChild(s); }
        if (!open && s) s.remove();
      };
      paintThemeBtn(); pollModel();
      matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (!document.documentElement.dataset.theme) { paintThemeBtn(); document.dispatchEvent(new Event('themechange')); } });
    },
    refreshModel: pollModel,
  };
})(window.App);
