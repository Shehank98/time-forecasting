/* "Which items count as sponsorship?": tick boxes for the ten sponsorship items. Saved in Settings (shared by the agency) when the user is an admin. */
(function (App) {
  const { esc } = App;
  const ITEMS = [
    ['-bb', '-BB', 'A billboard: "Teledrama -BB", "Lakshapathi BB"'],
    ['com break', 'Com Break', 'A commercial-break sponsor: "Com Break"'],
    ['dj', 'DJ', 'A DJ mention: "DJ", "Morning DJ"'],
    ['-extro', '-Extro (and Outro)', 'The closing credit: "Dream Star -Extro", "Show Outro"'],
    ['-intro', '-Intro', 'The opening credit: "Dream Star -Intro", "Lakshapathi_Intro"'],
    ['-llogo', '-LLogo (and Logo)', 'A logo: "Dream Star -LLogo", "Island Tea Logo"'],
    ['next card', 'Next Card', 'The "coming next" card: "Next Card", "Lakshapathi Next Card"'],
    ['tag', 'Tag', 'A tag line: "Tag". Counted as a frequency sponsorship in Sponsorship over time'],
    ['time check', 'Time Check', 'A time check: "Time Check". Counted as a frequency sponsorship in Sponsorship over time'],
    ['-tr', '-Tr', 'A transition: "News -Tr". Off by default'],
  ];
  const label = () => { const on = ITEMS.filter(([k]) => on_(k)); return on.length ? on.map((x) => x[1].replace(/ \(.*\)/, '')).join(', ') : 'nothing'; };
  const on_ = (k) => { const it = App.sponsorItems || {}; return k in it ? !!it[k] : k !== '-tr'; };

  function open() {
    const back = document.createElement('div'); back.className = 'modal-back';
    back.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="Sponsorship items" style="max-width:640px"><div class="card-head"><h2>Which items count as sponsorship?</h2><button class="btn sm" type="button" data-x>Close</button></div>
      <p class="muted small">Tick the items you treat as sponsorship (value addition). Anything not ticked is counted as an ordinary commercial in every sponsorship report, table and PDF. It works on how the theme is written: letter case, a "(10)(Sin)" ending and the programme name before or after the item do not matter.</p>
      <div class="si-list">${ITEMS.map(([k, name, ex]) => `<label class="si-row"><input type="checkbox" data-k="${esc(k)}" ${on_(k) ? 'checked' : ''}><span><b>${esc(name)}</b><span class="muted small"> ${esc(ex)}</span></span></label>`).join('')}</div>
      <div class="row" style="margin-top:12px;gap:8px"><button class="btn primary" type="button" id="si-save">Save</button><button class="btn" type="button" id="si-reset">Back to the standard list</button><span class="muted small" id="si-msg"></span></div></div>`;
    document.body.appendChild(back);
    const close = () => back.remove();
    back.querySelector('[data-x]').onclick = close; back.addEventListener('click', (e) => { if (e.target === back) close(); });
    back.querySelector('#si-reset').onclick = () => back.querySelectorAll('input[data-k]').forEach((c) => { c.checked = c.dataset.k !== '-tr'; });
    back.querySelector('#si-save').onclick = async () => {
      const items = {}; back.querySelectorAll('input[data-k]').forEach((c) => { items[c.dataset.k] = c.checked; });
      const msg = back.querySelector('#si-msg'), btn = back.querySelector('#si-save'); btn.disabled = true; msg.textContent = 'Saving...';
      try {
        await App.api.put('/api/config/sponsorship', { items });
        await App.data.reconfigure();
        App.toast('Saved. Every sponsorship report now uses these items.', 'ok'); close();
      } catch (e) {
        if (e.status === 403) {
          try { await App.data.applySponsorItems(items); App.toast('Applied for now. Only an admin can save this for everyone, so it goes back to the saved list when you reload.', 'info', 9000); close(); } catch (e2) { msg.textContent = e2.message; }
        } else msg.textContent = e.message;
      } finally { btn.disabled = false; }
    };
  }
  App.sponsorItemsPanel = { open, label };
})(window.App);
