/* Browser data store: talks to the data worker, which keeps each user's sheets in IndexedDB for the selected client.
 * Pages call App.data.* instead of server data endpoints. Only summaries and compact series reach the server.
 */
(function (App) {
  let worker = null, seq = 0, opened = null, persistAsked = false;
  const waiting = new Map();

  function boot() {
    if (worker) return worker;
    if (!window.Worker || !window.indexedDB) throw new Error('This browser cannot keep data locally. Use a current version of Chrome, Edge, Firefox or Safari.');
    worker = new Worker('/js/data-worker.js');
    worker.onmessage = (e) => {
      const m = e.data, w = waiting.get(m.id);
      if (!w) return;
      if (m.ok === undefined) { if (w.onProgress) w.onProgress(m.progress, m.message); return; }
      waiting.delete(m.id);
      if (m.ok) w.resolve(m.result); else w.reject(Object.assign(new Error(m.error), { user: m.user }));
    };
    worker.onerror = (e) => {
      const err = new Error('The data engine stopped (' + (e.message || 'out of memory?') + '). Reload the page. Very large Excel files should be saved as CSV.');
      waiting.forEach((w) => w.reject(err)); waiting.clear(); worker = null; opened = null;
    };
    return worker;
  }
  function call(op, args, onProgress) {
    const w = boot(), id = ++seq;
    return new Promise((resolve, reject) => { waiting.set(id, { resolve, reject, onProgress }); w.postMessage({ id, op, args }); });
  }
  async function config() {
    const [aliases, dayparts, holidays, sponsorship] = await Promise.all(['channel_aliases', 'dayparts', 'holidays', 'sponsorship'].map((n) => App.api.get('/api/config/' + n)));
    App.sponsorItems = (sponsorship && sponsorship.items) || {};
    return { aliases, dayparts, holidays, sponsorship };
  }
  /** Opens the current user's store for the selected client. Safe to call many times. */
  function open() {
    if (!opened) {
      opened = (async () => {
        const me = App.shell.me || (await App.api.get('/api/auth/me'));
        const cfg = await config();
        if (window.MR && window.MR.configure) window.MR.configure(cfg);     // main-thread helpers (daypart order, horizon maths)
        return call('open', { uid: me.user.id, cid: App.clientId(), config: cfg });
      })().catch((e) => { opened = null; throw e; });
    }
    return opened;
  }
  async function persist() {
    if (persistAsked) return; persistAsked = true;
    try { if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch (e) { /* optional */ }
  }
  const after = async (p) => { const r = await p; App.data.version++; document.dispatchEvent(new CustomEvent('datachange', { detail: r })); return r; };

  App.data = {
    version: 0,
    open, call,
    status: () => open().then(() => call('status')),
    async upload(kind, file, mode, onProgress) { await open(); persist(); return after(call('upload', { kind, file, mode }, onProgress)); },
    async remove(kind, name) { await open(); return after(call('remove', { kind, name })); },
    async clearAll() { await open(); return after(call('clearAll')); },
    async reconfigure() { await open(); const r = await call('configure', { config: await config() }); App.data.version++; document.dispatchEvent(new CustomEvent('datachange', { detail: { sponsorship: true } })); return r; },
    /** Applies the ticked sponsorship items right now, without saving (used when the settings cannot be saved). */
    async applySponsorItems(items) { await open(); App.sponsorItems = items; if (window.MR && window.MR.configure) window.MR.configure({ sponsorship: { items } }); await call('configure', { config: { sponsorship: { items } } }); App.data.version++; document.dispatchEvent(new CustomEvent('datachange', { detail: { sponsorship: true } })); },
    state: (kind, name) => open().then(() => call('state', { kind, name })),
    globalOptions: () => open().then(() => call('globalOptions')),
    dashboard: (b) => open().then(() => call('dashboard', b)),
    head2head: (b) => open().then(() => call('head2head', b)),
    rows: (b) => open().then(() => call('rows', b)),
    rowsCsv: (b) => open().then(() => call('rowsCsv', b)),
    entities: (b) => open().then(() => call('entities', b)),
    series: (b) => open().then(() => call('series', b)),
    predictTvr: (b) => open().then(() => call('predictTvr', b)),
    predictMarket: (b) => open().then(() => call('predictMarket', b)),
    vaultRows: (b) => open().then(() => call('vaultRows', b)),
    pressSummary: (b) => open().then(() => call('pressSummary', b)),
    pressContracts: (b) => open().then(() => call('pressContracts', b)),
    mediaOptions: (b) => open().then(() => call('mediaOptions', b)),
    mediaSpend: (b) => open().then(() => call('mediaSpend', b)),
    sponsorshipLookup: (b) => open().then(() => call('sponsorshipLookup', b)),
    sponsorshipTenure: (b) => open().then(() => call('sponsorshipTenure', b)),
    executiveSummary: (b) => open().then(() => call('executiveSummary', b)),
    executiveDetail: (b) => open().then(() => call('executiveDetail', b)),
    sponsorshipList: (b) => open().then(() => call('sponsorshipList', b)),
    sponsorshipOptions: (b) => open().then(() => call('sponsorshipOptions', b)),
    sponsorshipReport: (b) => open().then(() => call('sponsorshipReport', b)),
    spotlightIndex: (b) => open().then(() => call('spotlightIndex', b)),
    programmeSpotlight: (b) => open().then(() => call('programmeSpotlight', b)),
    shortFormMatrix: (b) => open().then(() => call('shortFormMatrix', b)),
    shortFormRow: (b) => open().then(() => call('shortFormRow', b)),
    negotiation: (b) => open().then(() => call('negotiation', b)),
    predictStealth: (b) => open().then(() => call('predictStealth', b)),
    coldStart: (b) => open().then(() => call('coldStart', b)),
    async kpiPropose(file, onProgress) { await open(); persist(); return call('kpiPropose', { file }, onProgress); },
    async kpiApply(b, onProgress) { await open(); return after(call('kpiApply', b, onProgress)); },
    async kpiMeta(b) { await open(); return after(call('kpiMeta', b)); },
  };

  /** Run a the forecast engine job on compact series and wait for it. onProgress(p, message). */
  App.runJob = async function (url, body, onProgress) {
    const { job_id: jid } = await App.api.post(url, body);
    for (;;) {
      await new Promise((r) => setTimeout(r, 600));
      const j = await App.api.get('/api/forecast/job/' + jid);
      if (onProgress) onProgress(j.progress || 0, j.message || '');
      if (j.status === 'error') throw new Error(j.error || 'Forecast failed');
      if (j.status !== 'running') return j.result;
    }
  };
})(window.App);
