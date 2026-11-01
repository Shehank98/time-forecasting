/* AI insights tab: structured Gemini output with collapsible evidence, plus a chat box. */
(function (App) {
  const { esc } = App;
  App.lastInsights = App.lastInsights || {};
  const SECTIONS = [['competitor_moves', 'Competitor moves'], ['threats', 'Threats'], ['opportunities', 'Opportunities'], ['predicted_behaviour', 'Predicted behaviour'], ['recommended_actions', 'Recommended actions']];
  const confCls = { high: 'good', medium: 'warn', low: 'bad' };

  const evidence = (list, unverified) => `<details class="evidence"><summary>Evidence (${list.length} number${list.length === 1 ? '' : 's'})</summary>
    <ul>${list.map((e) => `<li><b>${esc(e.id)}</b> ${esc(e.label)}: ${esc(e.value)}</li>`).join('') || '<li>No numbers were cited for this statement.</li>'}${unverified && unverified.length ? `<li class="delta down">Cited ids not found in the data: ${esc(unverified.join(', '))}</li>` : ''}</ul></details>`;
  const item = (i) => `<li><div class="row" style="align-items:flex-start;flex-wrap:nowrap"><span class="badge ${confCls[i.confidence]}" style="margin-top:2px">${esc(i.confidence)}</span><div>${esc(i.statement)}${evidence(i.evidence, i.unverified)}</div></div></li>`;

  function render(box, res) {
    const d = res.insights;
    box.innerHTML = `<div class="card"><div class="card-head"><div><h3>Executive summary</h3><div class="sub">Model ${esc(res.model)}${res.cached ? ', served from cache' : ''}. Based on ${res.fact_count} aggregated numbers, never the raw sheet.</div></div>
        <span class="badge ${confCls[d.executive_summary.confidence]}">${esc(d.executive_summary.confidence)} confidence</span></div>
        <p style="font-size:15px;margin:0">${esc(d.executive_summary.statement)}</p>${evidence(d.executive_summary.evidence, d.executive_summary.unverified)}</div>
      <div class="grid g2" style="margin-top:16px">${SECTIONS.map(([k, l]) => `<div class="card"><h3>${l}</h3><ul class="insight-list" style="margin-top:10px">${d[k].length ? d[k].map(item).join('') : '<li class="muted">Nothing to report from the numbers provided.</li>'}</ul></div>`).join('')}
        <div class="card"><h3>Data caveats</h3><ul class="insight-list" style="margin-top:10px">${d.data_caveats.map((c) => `<li>${esc(c)}</li>`).join('') || '<li class="muted">None</li>'}</ul></div></div>`;
  }

  function tab(p, ctx) {
    const kind = ctx.fkey(), hasFc = !!(App.lastForecast && App.lastForecast[kind]);
    p.innerHTML = `<div class="card"><div class="card-head"><div><h3>AI insights</h3><div class="sub">Gemini reads the compact summary your browser computed for the current filters (never the raw sheet), plus the latest prediction evidence, and returns structured, evidence-backed findings.</div></div></div>
      <div class="row"><button class="btn primary" id="ai-go" type="button">Generate insights</button>
        <label class="row small"><input type="checkbox" id="ai-fc" ${hasFc ? 'checked' : 'disabled'}> Include last forecast${hasFc ? '' : ' (run one in the Forecast tab first)'}</label>
        <span class="muted small" id="ai-msg"></span></div></div>
      <div id="ai-out" style="margin-top:16px">${App.lastInsights[kind] ? '' : App.emptyState('No insights yet', 'Click Generate insights. Results respect the current filters.')}</div>
      <div class="card" style="margin-top:16px"><div class="card-head"><div><h3>Ask about this data</h3><div class="sub">Answers use only the current filtered aggregates.</div></div></div>
        <div class="chat-log" id="chat-log" aria-live="polite"></div>
        <form class="row" id="chat-form" style="flex-wrap:nowrap"><label class="sr-only" for="chat-q">Your question</label><input type="text" id="chat-q" placeholder="For example: Which competitor increased prime time spend the most?" maxlength="500" autocomplete="off"><button class="btn primary" type="submit">Ask</button></form></div>`;
    const out = p.querySelector('#ai-out'), msg = p.querySelector('#ai-msg');
    if (App.lastInsights[kind]) render(out, App.lastInsights[kind]);
    const fcResult = () => (p.querySelector('#ai-fc').checked ? App.lastForecast[kind].result : null);
    const pe = App.predictEvidence && App.predictEvidence[ctx.kind];
    const body = (extra) => ({ kind: ctx.kind, dash: ctx.data, meta: ctx.meta, forecast: fcResult() || (pe && pe.result) || null, evidence: pe ? pe.lines.slice(0, 12) : [], ...extra });
    p.querySelector('#ai-go').onclick = async (e) => {
      const b = e.currentTarget; b.disabled = true; msg.textContent = 'Asking Gemini. This usually takes 10 to 30 seconds.'; out.innerHTML = App.skeleton(2);
      try {
        const res = await App.api.post('/api/insights', body({ refresh: true }));
        App.lastInsights[kind] = res; render(out, res); msg.textContent = '';
      } catch (err) { out.innerHTML = App.emptyState('Insights are not available right now', err.message); msg.textContent = ''; App.toast(err.message, 'error', 8000); }
      b.disabled = false;
    };
    const log = p.querySelector('#chat-log'), history = [];
    p.querySelector('#chat-form').onsubmit = async (e) => {
      e.preventDefault(); const q = p.querySelector('#chat-q'), text = q.value.trim(); if (!text) return; q.value = '';
      log.insertAdjacentHTML('beforeend', `<div class="msg user">${esc(text)}</div>`); const wait = document.createElement('div'); wait.className = 'msg bot muted'; wait.textContent = 'Thinking...'; log.appendChild(wait); log.scrollTop = log.scrollHeight;
      try {
        const r = await App.api.post('/api/chat', body({ question: text, history }));
        history.push({ role: 'user', text }, { role: 'assistant', text: r.answer });
        wait.className = 'msg bot'; wait.innerHTML = `${esc(r.answer)} <span class="badge ${confCls[r.confidence]}">${esc(r.confidence)}</span>${evidence(r.evidence, r.unverified_citations)}`;
      } catch (err) { wait.className = 'msg bot'; wait.innerHTML = `<span class="delta down">${esc(err.message)}</span>`; }
      log.scrollTop = log.scrollHeight;
    };
  }
  App.insights = { tab };
})(window.App);
