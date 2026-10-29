/* Agency admin: clients, users and access, branding, shared settings. */
(function (App) {
  const { esc, $, $$ } = App;
  const root = () => $('#admin');
  const logoInput = (id) => `<input type="file" id="${id}" accept="image/png,image/jpeg">`;
  async function uploadLogo(url, file) {
    if (!file) return;
    await App.api.upload(url, file);
  }

  async function clients() {
    const list = await App.api.get('/api/clients?all=true');
    root().innerHTML = `<div class="grid g-wide"><div class="card"><div class="card-head"><h3>Clients</h3></div><div id="cl-table"></div></div>
      <form class="card" id="cl-form"><h3 id="cl-title">New client</h3><input type="hidden" id="cl-id">
        <div class="field" style="margin-top:10px"><label for="cl-name">Name</label><input type="text" id="cl-name" required maxlength="200"></div>
        <div class="field" style="margin-top:10px"><label for="cl-ind">Industry</label><input type="text" id="cl-ind" placeholder="FMCG, Banking, Telco, Retail" maxlength="100"></div>
        <div class="field" style="margin-top:10px"><label for="cl-color">Brand colour (reports and charts)</label><input type="text" id="cl-color" value="#5B5CE6" placeholder="#1A2B3C"></div>
        <div class="field" style="margin-top:10px"><label for="cl-logo">Logo (PNG or JPEG, under 512 KB)</label>${logoInput('cl-logo')}</div>
        <div class="field" style="margin-top:10px"><label for="cl-notes">Notes</label><textarea id="cl-notes" rows="3" style="font-family:inherit"></textarea></div>
        <label class="row small" style="margin-top:10px"><input type="checkbox" id="cl-arch"> Archived (hidden from planners)</label>
        <div class="row" style="margin-top:12px"><button class="btn primary" type="submit">Save client</button><button class="btn" type="button" id="cl-new">New</button><button class="btn" type="button" id="cl-del" hidden>Delete</button></div></form></div>`;
    App.tables.create($('#cl-table'), { rows: list, csv: 'clients', pageSize: 12, columns: [
      { key: 'name', label: 'Client', html: (v, r) => `<span class="client-dot" style="background:${esc(r.brand_color)}"></span> ${esc(v)}` }, { key: 'industry', label: 'Industry' },
      { key: 'archived', label: 'Status', html: (v) => (v ? '<span class="badge warn">Archived</span>' : '<span class="badge good">Active</span>') },
      { key: 'id', label: '', sortable: false, html: (v) => `<button class="btn sm" type="button" data-edit="${v}">Edit</button>` }] });
    const fill = (c) => {
      $('#cl-title').textContent = c ? `Edit ${c.name}` : 'New client'; $('#cl-id').value = c ? c.id : ''; $('#cl-name').value = c ? c.name : ''; $('#cl-ind').value = c ? c.industry : '';
      $('#cl-color').value = c ? c.brand_color : '#5B5CE6'; $('#cl-notes').value = c ? (c.notes || '') : ''; $('#cl-arch').checked = !!(c && c.archived); $('#cl-del').hidden = !c; $('#cl-logo').value = '';
    };
    root().onclick = async (e) => { const b = e.target.closest('[data-edit]'); if (b) { const c = list.find((x) => String(x.id) === b.dataset.edit); fill({ ...c, notes: '' }); } };
    $('#cl-new').onclick = () => fill(null);
    $('#cl-del').onclick = async () => {
      const c = list.find((x) => String(x.id) === $('#cl-id').value); if (!c) return;
      const typed = prompt(`This permanently deletes ${c.name} with all stored data, saved forecasts and reports. Type the client name to confirm:`);
      if (typed === null) return;
      try { await App.api.del(`/api/clients/${c.id}?confirm=${encodeURIComponent(typed)}`); App.toast('Client deleted', 'ok'); clients(); } catch (x) { App.toast(x.message, 'error'); }
    };
    $('#cl-form').onsubmit = async (e) => {
      e.preventDefault();
      const body = { name: $('#cl-name').value, industry: $('#cl-ind').value, brand_color: $('#cl-color').value, notes: $('#cl-notes').value, archived: $('#cl-arch').checked };
      try {
        const id = $('#cl-id').value;
        const c = id ? await App.api.put(`/api/clients/${id}`, body) : await App.api.post('/api/clients', body);
        await uploadLogo(`/api/clients/${c.id}/logo`, $('#cl-logo').files[0]);
        if (!App.clientId()) localStorage.setItem('client', String(c.id));
        App.toast('Client saved', 'ok'); clients();
      } catch (x) { App.toast(x.message, 'error'); }
    };
  }

  async function users() {
    const [list, cls] = await Promise.all([App.api.get('/api/users'), App.api.get('/api/clients?all=true')]);
    const cname = Object.fromEntries(cls.map((c) => [c.id, c.name]));
    root().innerHTML = `<div class="grid g-wide"><div class="card"><div class="card-head"><h3>Users</h3></div><div id="u-table"></div></div>
      <form class="card" id="u-form"><h3 id="u-title">New user</h3><input type="hidden" id="u-id">
        <div class="field" style="margin-top:10px"><label for="u-email">Email</label><input type="text" id="u-email" autocomplete="off"></div>
        <div class="field" style="margin-top:10px"><label for="u-name">Name</label><input type="text" id="u-name"></div>
        <div class="field" style="margin-top:10px"><label for="u-role">Role</label><select id="u-role"><option value="planner">Planner (assigned clients only)</option><option value="admin">Admin (all clients, settings)</option></select></div>
        <div class="field" style="margin-top:10px"><label for="u-pw">Password <span class="muted" id="u-pwnote">(at least 10 characters)</span></label><input type="password" id="u-pw" autocomplete="new-password"></div>
        <div class="field" style="margin-top:10px"><label>Client access</label><div class="ms-list" style="max-height:180px;border:1px solid var(--border);border-radius:10px;padding:6px">${cls.map((c) => `<label class="ms-opt"><input type="checkbox" value="${c.id}" data-cl> ${esc(c.name)}</label>`).join('') || '<span class="muted small">Create clients first</span>'}</div></div>
        <label class="row small" style="margin-top:10px"><input type="checkbox" id="u-active" checked> Active</label>
        <div class="row" style="margin-top:12px"><button class="btn primary" type="submit">Save user</button><button class="btn" type="button" id="u-new">New</button></div></form></div>`;
    App.tables.create($('#u-table'), { rows: list, csv: 'users', pageSize: 12, columns: [
      { key: 'email', label: 'Email' }, { key: 'name', label: 'Name' }, { key: 'role', label: 'Role', html: (v) => `<span class="badge ${v === 'admin' ? 'info' : ''}">${esc(v)}</span>` },
      { key: 'client_ids', label: 'Clients', fmt: (v, r) => (r.role === 'admin' ? 'All' : (v || []).map((i) => cname[i] || i).join(', ')) },
      { key: 'active', label: 'Status', html: (v) => (v ? '<span class="badge good">Active</span>' : '<span class="badge bad">Disabled</span>') },
      { key: 'id', label: '', sortable: false, html: (v) => `<button class="btn sm" type="button" data-u="${v}">Edit</button>` }] });
    const fill = (u) => {
      $('#u-title').textContent = u ? `Edit ${u.email}` : 'New user'; $('#u-id').value = u ? u.id : ''; $('#u-email').value = u ? u.email : ''; $('#u-email').disabled = !!u;
      $('#u-name').value = u ? u.name : ''; $('#u-role').value = u ? u.role : 'planner'; $('#u-pw').value = ''; $('#u-pwnote').textContent = u ? '(leave blank to keep)' : '(at least 10 characters)';
      $('#u-active').checked = u ? u.active : true; $$('[data-cl]').forEach((c) => { c.checked = !!(u && u.client_ids.includes(+c.value)); });
    };
    root().onclick = (e) => { const b = e.target.closest('[data-u]'); if (b) fill(list.find((x) => String(x.id) === b.dataset.u)); };
    $('#u-new').onclick = () => fill(null);
    $('#u-form').onsubmit = async (e) => {
      e.preventDefault();
      const ids = $$('[data-cl]').filter((c) => c.checked).map((c) => +c.value);
      const body = { name: $('#u-name').value, role: $('#u-role').value, active: $('#u-active').checked, client_ids: ids };
      if ($('#u-pw').value) body.password = $('#u-pw').value;
      try {
        if ($('#u-id').value) await App.api.put(`/api/users/${$('#u-id').value}`, body);
        else await App.api.post('/api/users', { ...body, email: $('#u-email').value });
        App.toast('User saved', 'ok'); users();
      } catch (x) { App.toast(x.message, 'error'); }
    };
  }

  async function brand() {
    const b = await App.api.get('/api/branding');
    root().innerHTML = `<form class="card" id="b-form" style="max-width:760px"><h3>Report branding</h3><p class="muted small">Used on the sign-in page, the sidebar and every client report (PDF cover, PowerPoint title slide, Excel cover).</p>
      <div class="grid g2"><div class="field"><label for="b-name">Agency name</label><input type="text" id="b-name" value="${esc(b.agency_name)}"></div>
      <div class="field"><label for="b-color">Primary colour</label><input type="text" id="b-color" value="${esc(b.primary_color)}"></div></div>
      <div class="field" style="margin-top:10px"><label for="b-logo">Agency logo (PNG or JPEG, under 512 KB)</label>${logoInput('b-logo')}${b.has_logo ? '<img src="/api/branding/logo" alt="Current logo" style="max-height:48px;margin-top:8px">' : ''}</div>
      <div class="field" style="margin-top:10px"><label for="b-foot">Report footer</label><input type="text" id="b-foot" value="${esc(b.report_footer)}"></div>
      <div class="field" style="margin-top:10px"><label for="b-disc">Forecast disclaimer</label><textarea id="b-disc" rows="3" style="font-family:inherit">${esc(b.disclaimer)}</textarea></div>
      <div class="row" style="margin-top:12px"><button class="btn primary" type="submit">Save branding</button></div></form>`;
    $('#b-form').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await App.api.put('/api/branding', { agency_name: $('#b-name').value, primary_color: $('#b-color').value, report_footer: $('#b-foot').value, disclaimer: $('#b-disc').value });
        await uploadLogo('/api/branding/logo', $('#b-logo').files[0]);
        App.toast('Branding saved', 'ok'); brand();
      } catch (x) { App.toast(x.message, 'error'); }
    };
  }

  function settings() {
    root().innerHTML = `<div class="card"><h3>Shared settings</h3><p class="muted">Channel aliases, dayparts, time-belt size and the Sri Lankan event calendar used as forecast covariates. These apply to every client.</p><button class="btn primary" id="open-set" type="button">Open settings editor</button></div>`;
    $('#open-set').onclick = () => App.openSettings ? App.openSettings() : App.toast('Open any workspace to edit settings.', 'error');
  }

  const VIEWS = { clients, users, brand, settings };
  App.shell.init('admin').then((me) => {
    if (!me.user.is_admin) { root().innerHTML = App.emptyState('Admins only', 'Ask an agency admin for access.'); return; }
    $$('.tab').forEach((t) => { t.onclick = () => { $$('.tab').forEach((x) => x.setAttribute('aria-selected', String(x === t))); VIEWS[t.dataset.t]().catch?.((e) => App.toast(e.message, 'error')); }; });
    clients().catch((e) => App.toast(e.message, 'error'));
  }).catch((e) => { if (e.status !== 401) App.toast(e.message, 'error'); });
})(window.App);
