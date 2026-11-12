/* Pre-Launch Ad Test: one form, then a scorecard, the ad beside the focus group, a comment wall, visual and cultural analysis, and fixes.
 * The ad goes to the server only for the test (held in memory, never stored). Results stay on this page; download the report to keep them. */
(function (App) {
  const { esc, fmt, $, $$ } = App;
  const n1 = (v) => (v == null || !Number.isFinite(v) ? 'n/a' : fmt.num(v, 1));
  const n0 = (v) => (v == null || !Number.isFinite(v) ? 'n/a' : fmt.num(v, 0));
  const TABS = [['group', 'Focus group'], ['wall', 'Comment wall'], ['visual', 'Visual and attention'], ['culture', 'Language and culture'], ['fixes', 'Fixes']];
  const EMOJI = { Positive: '❤️', Neutral: '😐', Troll: '😂', Angry: '😡' };
  const TONE = { Low: 'good', Medium: 'warn', High: 'bad', Critical: 'bad' };
  let root, st = { type: 'static', file: null, url: '', status: null, result: null, tab: 'group', running: false, filter: 'All', form: {} };

  const kpi = (label, value, sub, cls = '') => `<div class="kpi ${cls}"><div class="k-lbl">${esc(label)}</div><div class="k-val">${value}</div>${sub ? `<div class="k-sub">${sub}</div>` : ''}</div>`;
  const meter = (v, top = 10) => `<span class="at-meter" role="img" aria-label="${n1(v)} out of ${top}"><i style="width:${Math.max(0, Math.min(100, (v / top) * 100))}%"></i></span>`;

  // ------------------------------------------------------------------ the form
  function form() {
    const f = st.form, video = st.type === 'video', lim = (st.status || {}).limits || {};
    const accept = video ? '.mp4,.mov,.webm,.m4v' : '.jpg,.jpeg,.png,.webp';
    const field = (id, label, ph, rows) => `<div class="field"><label for="at-${id}">${label}</label>${rows ? `<textarea id="at-${id}" rows="${rows}" maxlength="4000" placeholder="${esc(ph)}">${esc(f[id] || '')}</textarea>` : `<input id="at-${id}" maxlength="200" placeholder="${esc(ph)}" value="${esc(f[id] || '')}">`}</div>`;
    const preview = st.file ? (video ? `<video src="${esc(st.url)}" controls muted playsinline class="at-prev"></video>` : `<img src="${esc(st.url)}" alt="The ad you chose" class="at-prev">`) : '';
    $('#at-form').innerHTML = `<div class="card"><div class="row" style="gap:12px;flex-wrap:wrap;align-items:center"><div class="seg" role="group" aria-label="Ad type">
        <button type="button" data-t="video" aria-pressed="${video}">Video commercial</button><button type="button" data-t="static" aria-pressed="${!video}">Static image or press ad</button></div>
        <span class="muted small">${video ? `TVC, TikTok or Reel. MP4 up to ${lim.video_mb || 80} MB and ${lim.video_seconds || 180} seconds. Audio is not analysed: paste the voice-over in the script box.` : `Facebook or Instagram image, carousel slide or newspaper artwork. JPG, PNG or WebP up to ${lim.image_mb || 15} MB.`}</span></div>
      <div class="at-grid"><div><label class="at-drop" id="at-drop" tabindex="0"><input type="file" id="at-file" accept="${accept}" hidden>${preview || `<span><b>Choose the ${video ? 'video' : 'image'}</b><br><span class="muted small">or drop it here</span></span>`}</label>
          ${st.file ? `<div class="muted small" style="margin-top:6px">${esc(st.file.name)} (${st.file.size < 1048576 ? fmt.num(st.file.size / 1024, 0) + ' KB' : fmt.num(st.file.size / 1048576, 1) + ' MB'}) <button class="btn sm ghost" type="button" id="at-clear">Remove</button></div>` : ''}</div>
        <div class="at-fields"><div class="at-two">${field('brand', 'Brand', 'e.g. Sampath Bank')}${field('product', 'Product or offer', 'e.g. Personal loan')}</div>
          ${field('headline', 'Headline on the ad', 'The main line, in the language used on the ad', 0)}
          ${field('copy', video ? 'Script and voice-over' : 'Body copy and call to action', video ? 'What is said and sung, in order' : 'All other text on the ad', 3)}
          <details class="g-det"><summary>More context (optional)</summary><div class="at-two" style="margin-top:8px">${field('audience', 'Target audience', 'Who is it for?', 2)}${field('objective', 'Campaign objective', 'e.g. app downloads, awareness', 2)}</div>${field('market_notes', 'Anything else', 'Season, competitor ads, sensitivities to watch', 2)}</details></div></div>
      <div class="row" style="margin-top:12px;gap:12px;flex-wrap:wrap;align-items:center"><button class="btn primary" type="button" id="at-run" ${st.file && !st.running && (st.status || {}).configured ? '' : 'disabled'}>Run pre-launch simulation</button>
        <span class="muted small">${(st.status || {}).configured === false ? 'The Gemini key is not set on the server, so tests cannot run.' : 'The ad and text are sent to Gemini for the test. They are not stored on our server. Takes about a minute.'}</span></div></div>`;
    $$('#at-form .seg button').forEach((b) => { b.onclick = () => { readForm(); st.type = b.dataset.t; st.file = null; st.url = ''; st.result = null; paint(); }; });
    const input = $('#at-file'), drop = $('#at-drop');
    input.onchange = () => pick(input.files[0]);
    drop.onclick = (e) => { if (!e.target.closest('video')) input.click(); };
    drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } };
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); }; drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); pick(e.dataTransfer.files[0]); };
    const clr = $('#at-clear'); if (clr) clr.onclick = () => { readForm(); st.file = null; st.url = ''; form(); };
    $('#at-run').onclick = run;
  }
  function readForm() { ['brand', 'product', 'headline', 'copy', 'audience', 'objective', 'market_notes'].forEach((k) => { const el = $('#at-' + k); if (el) st.form[k] = el.value; }); }
  function pick(file) {
    if (!file) return;
    const video = st.type === 'video', lim = (st.status || {}).limits || {}, mb = file.size / 1048576;
    if (video ? !/\.(mp4|mov|webm|m4v)$/i.test(file.name) : !/\.(jpe?g|png|webp)$/i.test(file.name)) { App.toast(`Choose a ${video ? 'video (MP4)' : 'JPG, PNG or WebP image'}.`, 'error'); return; }
    if (mb > (video ? lim.video_mb || 80 : lim.image_mb || 15)) { App.toast(`That file is ${fmt.num(mb, 0)} MB, over the limit.`, 'error'); return; }
    readForm(); if (st.url) URL.revokeObjectURL(st.url);
    st.file = file; st.url = URL.createObjectURL(file); st.result = null; paint();
  }

  // ------------------------------------------------------------------ running
  async function run() {
    readForm();
    const fd = new FormData(); fd.append('ad_type', st.type); fd.append('file', st.file);
    Object.entries(st.form).forEach(([k, v]) => fd.append(k, v || ''));
    st.running = true; st.result = null; paint(); progress(0.01, 'Uploading the ad');
    try {
      const { job } = await App.api.form('/api/adtest/run', fd, (p) => progress(p * 0.04, 'Uploading the ad'));
      for (;;) {
        await new Promise((r) => setTimeout(r, 1200));
        const j = await App.api.get('/api/adtest/job/' + job);
        if (j.status === 'running') { progress(j.progress, j.message); continue; }
        if (j.status === 'error') throw new Error(j.error || 'The test failed.');
        st.result = j.result; st.tab = 'group'; st.filter = 'All'; break;
      }
    } catch (e) { App.toast(e.message, 'error'); st.result = null; }
    st.running = false; paint();
    if (st.result) { const el = $('#at-out'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }
  function progress(p, msg) {
    const el = $('#at-out'); if (!el) return;
    el.innerHTML = `<div class="card at-prog"><div class="row" style="justify-content:space-between"><b>${esc(msg || 'Working')}</b><span class="muted small">${Math.round(p * 100)}%</span></div><div class="progress"><i style="width:${Math.round(p * 100)}%"></i></div>
      <div class="muted small" style="margin-top:6px">Steps: read the ad, four consumers react, language and culture check, scorecard.</div></div>`;
  }

  // ------------------------------------------------------------------ results
  function results() {
    const out = $('#at-out'), r = st.result; if (!r) { if (!st.running) out.innerHTML = ''; return; }
    const k = r.scorecard, b = r.brief, v = r.vision, video = b.ad_type === 'video';
    const bl = k.backlash_risk, blCls = bl >= 65 ? 'bad' : bl >= 35 ? 'warn' : 'good';
    out.innerHTML = `<div class="banner ${k.verdict_tone === 'bad' ? 'warn' : 'info'} at-verdict ${k.verdict_tone}"><span><b>${esc(k.verdict)}</b> <span class="badge ${k.verdict_tone}">Simulated by AI</span></span>
        <span class="row" style="gap:8px"><button class="btn sm" type="button" id="at-dl">Download report</button><button class="btn sm ghost" type="button" id="at-new">Test another ad</button></span></div>
      <div class="kpis">${kpi('Visual impact', n0(k.visual_impact), 'out of 100')}${kpi(video ? '3 second hook' : '1 second eye-catch', n0(k.hook_score), 'out of 100')}
        ${kpi('Backlash risk', `<span class="${blCls}-t">${n0(bl)}</span>`, `<span class="badge ${TONE[k.risk_level]}">${esc(k.risk_level)}</span> out of 100, lower is safer`)}
        ${kpi('Purchase intent', n1(k.avg_purchase_intent) + ' / 10', 'average of 4 personas')}${kpi('Share intent', n1(k.avg_share_intent) + ' / 10', 'average of 4 personas')}</div>
      <div class="at-split"><div class="card at-ad"><div class="at-adbox">${st.file ? (video ? `<video src="${esc(st.url)}" controls muted playsinline class="at-prev"></video>` : `<img src="${esc(st.url)}" alt="The tested ad" class="at-prev">`) : r.thumbnail ? `<img src="${esc(r.thumbnail)}" alt="The tested ad" class="at-prev">` : ''}</div>
          <div class="small"><b>${esc(b.brand || 'Brand not given')}</b>${b.headline ? `<div class="muted">${esc(b.headline)}</div>` : ''}</div></div>
        <div><div class="at-tabs" role="tablist">${TABS.map(([id, l]) => `<button type="button" role="tab" data-tab="${id}" aria-selected="${st.tab === id}">${esc(l)}</button>`).join('')}</div><div id="at-body" class="card"></div></div></div>
      <div class="muted small" style="margin-top:10px">${r.caveats.map(esc).join(' ')}</div>`;
    $$('#at-out .at-tabs button').forEach((t) => { t.onclick = () => { st.tab = t.dataset.tab; $$('#at-out .at-tabs button').forEach((x) => x.setAttribute('aria-selected', String(x === t))); body(); }; });
    $('#at-dl').onclick = download; $('#at-new').onclick = () => { st.result = null; st.file = null; st.url = ''; paint(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
    body();
  }
  function body() {
    const r = st.result, el = $('#at-body'); if (!r || !el) return;
    ({ group, wall, visual, culture, fixes }[st.tab])(el, r);
  }
  function group(el, r) {
    el.innerHTML = `<div class="at-persons">${r.personas.map((p) => `<div class="at-person"><div class="row" style="justify-content:space-between;gap:8px"><b>${esc(p.name)}</b><span class="badge">${esc(p.reaction.comment_language)}</span></div>
        <div class="muted small">${esc(p.profile)}</div><p class="at-gut">${esc(p.reaction.gut_reaction)}</p><div class="at-bubble">${esc(p.reaction.comment)}</div>
        <div class="at-int"><span>Would buy</span>${meter(p.reaction.purchase_intent)}<b>${p.reaction.purchase_intent}</b></div><div class="at-int"><span>Would share</span>${meter(p.reaction.share_intent)}<b>${p.reaction.share_intent}</b></div>
        <div class="small"><span class="good-t">+</span> ${esc(p.reaction.likes || 'n/a')}</div><div class="small"><span class="bad-t">&minus;</span> ${esc(p.reaction.concerns || 'n/a')}</div></div>`).join('')}</div>`;
  }
  function wall(el, r) {
    const rc = r.risk.reaction_split, mine = r.personas.map((p) => ({ text: p.reaction.comment, language: p.reaction.comment_language, reaction: null, who: p.name }));
    const all = mine.concat(r.risk.crowd_comments.map((c) => ({ ...c, who: null }))), f = st.filter;
    const shown = all.filter((c) => f === 'All' || c.reaction === f);
    const seg = [['positive', 'Positive', 'good'], ['neutral', 'Neutral', 'neu'], ['troll', 'Troll', 'warn'], ['angry', 'Angry', 'bad']];
    el.innerHTML = `<div class="at-split-bar" role="img" aria-label="Predicted reactions">${seg.map(([k, l, c]) => `<i class="s-${c}" style="width:${rc[k]}%" title="${l} ${n0(rc[k])}%"></i>`).join('')}</div>
      <div class="row small" style="gap:14px;flex-wrap:wrap;margin:6px 0 10px">${seg.map(([k, l, c]) => `<span><i class="dot s-${c}"></i> ${EMOJI[l]} ${l} <b>${n0(rc[k])}%</b></span>`).join('')}</div>
      <div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:8px">${['All', 'Positive', 'Neutral', 'Troll', 'Angry'].map((x) => `<button type="button" class="chip-btn" data-f="${x}" aria-pressed="${f === x}">${x === 'All' ? 'All' : EMOJI[x] + ' ' + x}</button>`).join('')}</div>
      <div class="at-wall">${shown.map((c) => `<div class="at-cmt"><span class="at-av">${esc((c.who || '?').slice(0, 1))}</span><div><div class="small muted">${esc(c.who || 'Simulated viewer')} &middot; ${esc(c.language)}${c.reaction ? ' &middot; ' + EMOJI[c.reaction] : ''}</div><div>${esc(c.text)}</div></div></div>`).join('') || '<p class="muted small">No comments of this type.</p>'}</div>
      <div class="muted small" style="margin-top:8px">Comments are written by AI to look like a real comment section. They are not real people.</div>`;
    $$('.chip-btn', el).forEach((b) => { b.onclick = () => { st.filter = b.dataset.f; wall(el, r); }; });
  }
  function timeline(pts) {
    if (!pts || pts.length < 2) return '';
    const W = 600, H = 130, p = 22, x = (i) => p + (i * (W - 2 * p)) / (pts.length - 1), y = (a) => H - p - (a / 10) * (H - 2 * p);
    const d = pts.map((q, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(q.attention).toFixed(1)}`).join(' ');
    return `<svg viewBox="0 0 ${W} ${H}" class="at-tl" role="img" aria-label="Attention second by second"><line x1="${p}" y1="${y(5)}" x2="${W - p}" y2="${y(5)}" class="g"/><path d="${d}" class="ln"/>
      ${pts.map((q, i) => `<circle cx="${x(i)}" cy="${y(q.attention)}" r="3.5" class="${q.attention < 4 ? 'lo' : 'pt'}"><title>Second ${q.second}: ${n1(q.attention)}. ${esc(q.note)}</title></circle>`).join('')}
      <text x="${p}" y="${H - 4}" class="tx">${pts[0].second}s</text><text x="${W - p}" y="${H - 4}" class="tx" text-anchor="end">${pts[pts.length - 1].second}s</text></svg>`;
  }
  function visual(el, r) {
    const v = r.vision, rev = v.static || v.video, scores = rev.scores || [];
    el.innerHTML = `<p>${esc(rev.summary)}</p>
      ${v.video ? `<div class="row small" style="gap:18px;flex-wrap:wrap"><span><b>3 second hook</b> ${n1(v.video.hook_strength_3s)} / 10</span><span><b>Pacing</b> ${n1(v.video.pacing)} / 10</span></div><p class="muted small">${esc(v.video.emotion_arc)}</p>
        <h4>Attention second by second</h4>${timeline(v.video.timeline)}${(v.video.drop_off_risks || []).length ? `<h4>Where viewers may leave</h4><ul>${v.video.drop_off_risks.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}` : ''}
      ${v.static ? `<div class="small"><b>One second eye-catch</b> ${n1(v.static.one_second_eye_catch)} / 10${v.static.headline_read ? `<div class="muted">Headline as read from the image: <i>${esc(v.static.headline_read)}</i></div>` : ''}</div>` : ''}
      <div class="at-scores">${scores.map((s) => `<div class="at-sc"><div class="row" style="justify-content:space-between"><b>${esc(s.name)}</b><span>${n1(s.value)} / 10</span></div>${meter(s.value)}<div class="muted small">${esc(s.why)}</div></div>`).join('')}</div>`;
  }
  function culture(el, r) {
    const c = r.risk;
    el.innerHTML = `<div class="row" style="gap:10px;align-items:center"><span class="badge ${TONE[c.risk_level]}">${esc(c.risk_level)} risk</span><span class="small">Meme potential <b>${n1(c.meme_potential)} / 10</b></span></div>
      <p>${esc(c.risk_summary)}</p>${c.meme_note ? `<p class="muted small">${esc(c.meme_note)}</p>` : ''}
      ${c.flags.length ? `<div class="tbl-scroll"><table class="tbl"><thead><tr><th>Type</th><th>Where</th><th>Issue</th><th>Suggestion</th><th>Severity</th></tr></thead><tbody>${c.flags.map((f) => `<tr><td>${esc(f.category)}</td><td>${esc(f.where)}</td><td>${esc(f.issue)}</td><td>${esc(f.suggestion)}</td><td><span class="badge ${TONE[f.severity]}">${esc(f.severity)}</span></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">No specific language or cultural flags were raised.</p>'}`;
  }
  function fixes(el, r) {
    const rev = r.vision.static || r.vision.video, rank = { High: 0, Medium: 1, Low: 2 };
    const vis = (rev.fixes || []).slice().sort((a, b) => rank[a.priority] - rank[b.priority]);
    el.innerHTML = `<h4 style="margin-top:0">Layout and creative</h4>${vis.length ? `<ol class="at-fixes">${vis.map((f) => `<li><span class="badge ${f.priority === 'High' ? 'bad' : f.priority === 'Medium' ? 'warn' : ''}">${esc(f.priority)}</span> <b>${esc(f.problem)}</b><div>${esc(f.fix)}</div></li>`).join('')}</ol>` : '<p class="muted small">No layout fixes were suggested.</p>'}
      <h4>Words and cultural risk</h4>${r.risk.fixes.length ? `<ol class="at-fixes">${r.risk.fixes.map((f) => `<li>${esc(f)}</li>`).join('')}</ol>` : '<p class="muted small">No wording fixes were suggested.</p>'}`;
  }
  async function download() {
    try { const { blob, name } = await App.api.blob('/api/adtest/report', st.result); App.download(blob, name); } catch (e) { App.toast(e.message, 'error'); }
  }

  function paint() { form(); results(); }
  function boot() {
    root = $('#ws'); root.innerHTML = '<div id="at-form"></div><div id="at-out" style="margin-top:14px"></div>';
    App.loader.show('Initialising', 'Getting ready');
    App.shell.init('adtest').then(async () => {
      if (!App.clientId()) { App.loader.hide(0); App.shell.noClient(root); return; }
      try { st.status = await App.api.get('/api/adtest/status'); } catch (e) { st.status = { configured: false, limits: {} }; }
      paint(); App.loader.hide(0);
    });
  }
  boot();
})(window.App);
