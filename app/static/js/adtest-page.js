/* Pre-Launch Ad Test: one form, then an animated simulation, a scorecard, the ad beside a crowd of up to 100 Sri Lankan personas, a streaming comment wall,
 * visual and cultural analysis, and fixes. The ad goes to the server only for the test (held in memory, never stored). Results stay on this page. */
(function (App) {
  const { esc, fmt, $, $$ } = App;
  const n1 = (v) => (v == null || !Number.isFinite(v) ? 'n/a' : fmt.num(v, 1));
  const n0 = (v) => (v == null || !Number.isFinite(v) ? 'n/a' : fmt.num(v, 0));
  const REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const TABS = [['crowd', 'Crowd map'], ['wall', 'Comment wall'], ['people', 'People'], ['visual', 'Visual and attention'], ['culture', 'Language and culture'], ['fixes', 'Fixes']];
  const EMOJI = { Positive: '❤️', Neutral: '😐', Troll: '😂', Angry: '😡' };
  const MOOD_CLS = { Positive: 'good', Neutral: 'neu', Troll: 'warn', Angry: 'bad' };
  const TONE = { Low: 'good', Medium: 'warn', High: 'bad', Critical: 'bad' };
  const STEPS = ['Reading the ad', 'Consumers react', 'Culture check', 'Scorecard'];
  const TIPS = ['Reading the headline the way a tired commuter would', 'Checking the Sinhala for double meanings', 'Asking a Galle shop owner what he thinks', 'Looking for anything that could become a meme',
    'Asking a Kandy grandmother if it is respectful', 'Checking colours and logo size at one glance', 'Counting how many people would share it', 'Listening to the Jaffna and Batticaloa view'];
  let root, tipTimer = null, litTimer = null;
  let st = { type: 'static', file: null, url: '', status: null, result: null, tab: 'crowd', running: false, filter: 'All', form: {}, panel: { size: 'quick', age_min: '', age_max: '', gender: '', region: '' },
    preview: [], seg: { kind: 'age', label: null }, ppl: { mood: 'All', q: '', page: 1 } };

  const kpi = (label, value, sub, cls = '') => `<div class="kpi ${cls}"><div class="k-lbl">${esc(label)}</div><div class="k-val">${value}</div>${sub ? `<div class="k-sub">${sub}</div>` : ''}</div>`;
  const meter = (v, top = 10) => `<span class="at-meter" role="img" aria-label="${n1(v)} out of ${top}"><i style="--w:${Math.max(0, Math.min(100, (v / top) * 100))}%"></i></span>`;
  const countUp = (el, to, dec = 0, suffix = '', dur = 900) => {
    if (!el) return; const fin = to.toFixed(dec) + suffix; if (REDUCED || !Number.isFinite(to)) { el.textContent = fin; return; }
    const t0 = performance.now(); const step = (t) => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = (to * e).toFixed(dec) + suffix; if (k < 1) requestAnimationFrame(step); else el.textContent = fin; }; requestAnimationFrame(step);
  };
  const tok = (n) => (n >= 1000 ? fmt.num(n / 1000, n >= 10000 ? 0 : 1) + 'k' : String(n));
  const sizeInfo = (k) => { const e = ((st.status || {}).estimates || {})[k]; return e ? e[st.type] : null; };
  const stop = () => { clearInterval(tipTimer); clearInterval(litTimer); tipTimer = litTimer = null; };

  // ------------------------------------------------------------------ the form
  const SIZES = [['quick', 'Quick', 'Balanced mix, the core four plus others. Best for a first look.'], ['standard', 'Standard', 'Every age, region and mindset covered properly.'],
    ['full', 'Full 100', 'The whole bank. Use it for a final check before launch.']];
  function form() {
    const f = st.form, video = st.type === 'video', lim = (st.status || {}).limits || {}, p = st.panel, S = st.status || {};
    const accept = video ? '.mp4,.mov,.webm,.m4v' : '.jpg,.jpeg,.png,.webp';
    const field = (id, label, ph, rows) => `<div class="field"><label for="at-${id}">${label}</label>${rows ? `<textarea id="at-${id}" rows="${rows}" maxlength="4000" placeholder="${esc(ph)}">${esc(f[id] || '')}</textarea>` : `<input id="at-${id}" maxlength="200" placeholder="${esc(ph)}" value="${esc(f[id] || '')}">`}</div>`;
    const preview = st.file ? (video ? `<video src="${esc(st.url)}" controls muted playsinline class="at-prev"></video>` : `<img src="${esc(st.url)}" alt="The ad you chose" class="at-prev">`) : '';
    const sizeBtn = (k, label, tip) => { const e = sizeInfo(k), n = (S.sizes || {})[k] || ''; return `<button type="button" class="at-size" data-size="${k}" aria-pressed="${p.size === k}" title="${esc(tip)}"><b>${label}</b><span>${n} people</span><small>${e ? `about ${tok(e.total)} tokens, ${e.calls} calls` : ''}</small></button>`; };
    const sel = (id, label, opts, val) => `<div class="field"><label for="at-${id}">${label}</label><select id="at-${id}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`;
    const ages = [['', 'Any']].concat([16, 18, 25, 35, 45, 55, 65].map((a) => [a, String(a)]));
    $('#at-form').innerHTML = `<div class="card"><div class="row" style="gap:12px;flex-wrap:wrap;align-items:center"><div class="seg" role="group" aria-label="Ad type">
        <button type="button" data-t="video" aria-pressed="${video}">Video commercial</button><button type="button" data-t="static" aria-pressed="${!video}">Static image or press ad</button></div>
        <span class="muted small">${video ? `TVC, TikTok or Reel. MP4 up to ${lim.video_mb || 80} MB and ${lim.video_seconds || 180} seconds. Audio is not analysed: paste the voice-over in the script box.` : `Facebook or Instagram image, carousel slide or newspaper artwork. JPG, PNG or WebP up to ${lim.image_mb || 15} MB.`}</span></div>
      <div class="at-grid"><div><label class="at-drop" id="at-drop" tabindex="0"><input type="file" id="at-file" accept="${accept}" hidden>${preview || `<span class="at-hint"><span class="at-ring"></span><b>Choose the ${video ? 'video' : 'image'}</b><br><span class="muted small">or drop it here</span></span>`}</label>
          ${st.file ? `<div class="muted small" style="margin-top:6px">${esc(st.file.name)} (${st.file.size < 1048576 ? fmt.num(st.file.size / 1024, 0) + ' KB' : fmt.num(st.file.size / 1048576, 1) + ' MB'}) <button class="btn sm ghost" type="button" id="at-clear">Remove</button></div>` : ''}</div>
        <div class="at-fields"><div class="at-two">${field('brand', 'Brand', 'e.g. Sampath Bank')}${field('product', 'Product or offer', 'e.g. Personal loan')}</div>
          ${field('headline', 'Headline on the ad', 'The main line, in the language used on the ad', 0)}
          ${field('copy', video ? 'Script and voice-over' : 'Body copy and call to action', video ? 'What is said and sung, in order' : 'All other text on the ad', 3)}
          <details class="g-det"><summary>More context (optional)</summary><div class="at-two" style="margin-top:8px">${field('audience', 'Target audience', 'Who is it for?', 2)}${field('objective', 'Campaign objective', 'e.g. app downloads, awareness', 2)}</div>${field('market_notes', 'Anything else', 'Season, competitor ads, sensitivities to watch', 2)}</details></div></div>
      <div class="at-panelbox"><div class="row" style="justify-content:space-between;gap:10px;flex-wrap:wrap"><b>Who should react?</b><span class="muted small">${S.bank || 100} Sri Lankan personas: ages 16 to 75, towns, villages, estates, the North and East, many mindsets</span></div>
        <div class="at-sizes">${SIZES.map(([k, l, t]) => sizeBtn(k, l, t)).join('')}</div>
        <details class="g-det" ${p.gender || p.region || p.age_min || p.age_max ? 'open' : ''}><summary>Choose a specific audience (optional)</summary><div class="at-four" style="margin-top:8px">${sel('age_min', 'Age from', ages, p.age_min)}${sel('age_max', 'Age to', [['', 'Any']].concat([24, 34, 44, 54, 64, 75].map((a) => [a, String(a)])), p.age_max)}
          ${sel('gender', 'Gender', [['', 'Everyone'], ['F', 'Women'], ['M', 'Men']], p.gender)}${sel('region', 'Where', [['', 'Anywhere']].concat((S.regions || []).map((r) => [r, r])), p.region)}</div></details>
        <div class="at-crowd" id="at-crowd" aria-label="The people who will react"></div><div class="muted small" id="at-crowdnote"></div></div>
      <div class="row" style="margin-top:12px;gap:12px;flex-wrap:wrap;align-items:center"><button class="btn primary" type="button" id="at-run" ${st.file && !st.running && S.configured ? '' : 'disabled'}>Run pre-launch simulation</button>
        <span class="muted small">${S.configured === false ? 'The Gemini key is not set on the server, so tests cannot run.' : 'The ad and text are sent to Gemini for the test. They are not stored on our server. The same ad and settings run again for free.'}</span></div></div>`;
    $$('#at-form .seg button').forEach((b) => { b.onclick = () => { readForm(); st.type = b.dataset.t; st.file = null; st.url = ''; st.result = null; paint(); }; });
    $$('#at-form .at-size').forEach((b) => { b.onclick = () => { readForm(); st.panel.size = b.dataset.size; form(); loadPreview(); }; });
    ['age_min', 'age_max', 'gender', 'region'].forEach((k) => { const el = $('#at-' + k); if (el) el.onchange = () => { st.panel[k] = el.value; loadPreview(); }; });
    const input = $('#at-file'), drop = $('#at-drop');
    input.onchange = () => pick(input.files[0]);
    drop.onclick = (e) => { if (!e.target.closest('video')) input.click(); };
    drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } };
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); }; drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); pick(e.dataTransfer.files[0]); };
    const clr = $('#at-clear'); if (clr) clr.onclick = () => { readForm(); st.file = null; st.url = ''; form(); drawCrowd(); };
    $('#at-run').onclick = run; drawCrowd();
  }
  function readForm() { ['brand', 'product', 'headline', 'copy', 'audience', 'objective', 'market_notes'].forEach((k) => { const el = $('#at-' + k); if (el) st.form[k] = el.value; }); }
  async function loadPreview() {
    const p = st.panel, q = new URLSearchParams({ panel_size: p.size, gender: p.gender || '', region: p.region || '' });
    if (p.age_min !== '') q.set('age_min', p.age_min); if (p.age_max !== '') q.set('age_max', p.age_max);
    try { const d = await App.api.get('/api/adtest/panel?' + q); st.preview = d.people; st.previewErr = ''; } catch (e) { st.preview = []; st.previewErr = e.message; }
    drawCrowd();
  }
  const AG = { '16 to 24': 0, '25 to 34': 1, '35 to 44': 2, '45 to 54': 3, '55 and over': 4 };
  function drawCrowd() {
    const el = $('#at-crowd'), note = $('#at-crowdnote'); if (!el) return;
    el.innerHTML = st.preview.map((q, i) => `<i class="dotp ag${AG[q.age_group] ?? 0}" style="--d:${Math.min(i, 60) * 14}ms" title="${esc(`${q.name}, ${q.age}. ${q.place}. ${q.job}. ${q.mindset}`)}"></i>`).join('');
    const ps = st.preview; if (note) note.innerHTML = st.previewErr ? `<span class="bad-t">${esc(st.previewErr)}</span>` : ps.length ? `${ps.length} people: ${[...new Set(ps.map((q) => q.region))].length} kinds of place, ${[...new Set(ps.map((q) => q.mindset))].length} mindsets, ages ${Math.min(...ps.map((q) => q.age))} to ${Math.max(...ps.map((q) => q.age))}. Colour shows the age group.` : '';
    const run = $('#at-run'); if (run) run.disabled = !(st.file && !st.running && (st.status || {}).configured && ps.length >= 4);
  }
  function pick(file) {
    if (!file) return;
    const video = st.type === 'video', lim = (st.status || {}).limits || {}, mb = file.size / 1048576;
    if (video ? !/\.(mp4|mov|webm|m4v)$/i.test(file.name) : !/\.(jpe?g|png|webp)$/i.test(file.name)) { App.toast(`Choose a ${video ? 'video (MP4)' : 'JPG, PNG or WebP image'}.`, 'error'); return; }
    if (mb > (video ? lim.video_mb || 80 : lim.image_mb || 15)) { App.toast(`That file is ${fmt.num(mb, 0)} MB, over the limit.`, 'error'); return; }
    readForm(); if (st.url) URL.revokeObjectURL(st.url);
    st.file = file; st.url = URL.createObjectURL(file); st.result = null; paint();
  }

  // ------------------------------------------------------------------ running: the simulation stage
  async function run() {
    readForm();
    const fd = new FormData(); fd.append('ad_type', st.type); fd.append('file', st.file); fd.append('panel_size', st.panel.size);
    ['age_min', 'age_max', 'gender', 'region'].forEach((k) => { if (st.panel[k] !== '' && st.panel[k] != null) fd.append(k, st.panel[k]); });
    Object.entries(st.form).forEach(([k, v]) => fd.append(k, v || ''));
    st.running = true; st.result = null; paint(); stage(0.01, 'Uploading the ad');
    try {
      const { job } = await App.api.form('/api/adtest/run', fd, (p) => stage(p * 0.04, 'Uploading the ad'));
      for (;;) {
        await new Promise((r) => setTimeout(r, 1000));
        const j = await App.api.get('/api/adtest/job/' + job);
        if (j.status === 'running') { stage(j.progress, j.message); continue; }
        if (j.status === 'error') throw new Error(j.error || 'The test failed.');
        st.result = j.result; st.tab = 'crowd'; st.filter = 'All'; st.seg = { kind: 'age', label: null }; st.ppl = { mood: 'All', q: '', page: 1 }; break;
      }
    } catch (e) { App.toast(e.message, 'error'); st.result = null; }
    stop(); st.running = false; paint();
    if (st.result) { const el = $('#at-out'); if (el) el.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' }); }
  }
  let lit = 0, target = 0, stageBuilt = false;
  function stage(p, msg) {
    const out = $('#at-out'); if (!out) return;
    const total = st.preview.length || 12, step = p < 0.28 ? 0 : p < 0.7 ? 1 : p < 0.93 ? 2 : 3;
    const m = /^(\d+) of (\d+) consumers/.exec(msg || '');
    target = m ? Math.round((+m[1] / +m[2]) * total) : step >= 2 ? total : step === 1 ? Math.max(target, Math.round(total * 0.1)) : 0;
    if (!stageBuilt || !$('#at-stage')) {
      stageBuilt = true; lit = 0;
      const est = sizeInfo(st.panel.size);
      out.innerHTML = `<div class="card at-stage" id="at-stage"><div class="at-stage-grid"><div class="at-scanbox">${st.file ? (st.type === 'video' ? `<video src="${esc(st.url)}" muted playsinline autoplay loop class="at-prev"></video>` : `<img src="${esc(st.url)}" alt="" class="at-prev">`) : ''}<i class="at-scan"></i></div>
        <div><div class="at-steps">${STEPS.map((s, i) => `<div class="at-step" data-i="${i}"><i>${i + 1}</i><span>${s}</span></div>`).join('')}</div>
          <div class="row" style="justify-content:space-between;margin-top:10px"><b id="at-msg"></b><span class="muted small" id="at-pct"></span></div><div class="progress"><i id="at-bar"></i></div>
          <div class="at-tip" id="at-tip">${TIPS[0]}</div>
          <div class="at-crowd lit" id="at-litcrowd">${(st.preview.length ? st.preview : Array.from({ length: 12 })).map((q, i) => `<i class="dotp ${q ? 'ag' + (AG[q.age_group] ?? 0) : 'ag1'}" data-i="${i}" title="${q ? esc(q.name + ', ' + q.age) : ''}"></i>`).join('')}</div>
          <div class="muted small" style="margin-top:6px">${est ? `Estimated cost: about ${tok(est.total)} tokens in ${est.calls} calls.` : ''} Leave this page open.</div></div></div></div>`;
      let k = 0; tipTimer = setInterval(() => { k = (k + 1) % TIPS.length; const t = $('#at-tip'); if (t) { t.classList.remove('swap'); void t.offsetWidth; t.textContent = TIPS[k]; t.classList.add('swap'); } }, 2400);
      litTimer = setInterval(() => { const dots = $$('#at-litcrowd .dotp'); if (lit < Math.min(target, dots.length)) { lit++; dots[lit - 1].classList.add('on'); } }, 70);
    }
    $$('#at-stage .at-step').forEach((s) => { const i = +s.dataset.i; s.classList.toggle('done', i < step); s.classList.toggle('now', i === step); });
    const bar = $('#at-bar'), msgEl = $('#at-msg'), pct = $('#at-pct'); if (bar) bar.style.width = Math.round(p * 100) + '%'; if (msgEl) msgEl.textContent = msg || 'Working'; if (pct) pct.textContent = Math.round(p * 100) + '%';
  }

  // ------------------------------------------------------------------ results
  function results() {
    const out = $('#at-out'), r = st.result; stageBuilt = false; if (!r) { if (!st.running) out.innerHTML = ''; return; }
    const k = r.scorecard, b = r.brief, bl = k.backlash_risk, blCls = bl >= 65 ? 'bad' : bl >= 35 ? 'warn' : 'good', u = r.usage || {}, video = b.ad_type === 'video';
    const spent = u.cached ? 'Saved result: no new tokens used.' : `Tokens used: ${tok(u.input_tokens || 0)} in, ${tok(u.output_tokens || 0)} out, ${u.calls || 0} calls.`;
    out.innerHTML = `<div class="banner info at-verdict ${k.verdict_tone} at-pop"><span><b>${esc(k.verdict)}</b> <span class="badge ${k.verdict_tone}">Simulated by AI</span> <span class="muted small">${esc(spent)}</span></span>
        <span class="row" style="gap:8px"><button class="btn sm" type="button" id="at-dl">Download report</button><button class="btn sm ghost" type="button" id="at-new">Test another ad</button></span></div>
      <div class="kpis at-stagger">${kpi('Visual impact', '<span data-n="' + k.visual_impact + '">0</span>', 'out of 100')}${kpi(video ? '3 second hook' : '1 second eye-catch', '<span data-n="' + k.hook_score + '">0</span>', 'out of 100')}
        ${kpi('Backlash risk', `<span class="${blCls}-t" data-n="${bl}">0</span>`, `<span class="badge ${TONE[k.risk_level]}">${esc(k.risk_level)}</span> lower is safer`)}
        ${kpi('Would buy', `<span data-n="${k.avg_purchase_intent}" data-d="1">0</span> / 10`, `average of ${r.panel ? r.panel.size : r.personas.length} people`)}${kpi('Would share', `<span data-n="${k.avg_share_intent}" data-d="1">0</span> / 10`, 'average of the panel')}</div>
      <div class="at-split"><div class="card at-ad at-pop"><div class="at-adbox">${st.file ? (video ? `<video src="${esc(st.url)}" controls muted playsinline class="at-prev"></video>` : `<img src="${esc(st.url)}" alt="The tested ad" class="at-prev">`) : r.thumbnail ? `<img src="${esc(r.thumbnail)}" alt="The tested ad" class="at-prev">` : ''}</div>
          <div class="small"><b>${esc(b.brand || 'Brand not given')}</b>${b.headline ? `<div class="muted">${esc(b.headline)}</div>` : ''}</div></div>
        <div><div class="at-tabs" role="tablist">${TABS.map(([id, l]) => `<button type="button" role="tab" data-tab="${id}" aria-selected="${st.tab === id}">${esc(l)}</button>`).join('')}</div><div id="at-body" class="card"></div></div></div>
      <div class="muted small" style="margin-top:10px">${r.caveats.map(esc).join(' ')}</div>`;
    $$('#at-out [data-n]').forEach((el) => countUp(el, +el.dataset.n, +(el.dataset.d || 0)));
    $$('#at-out .at-tabs button').forEach((t) => { t.onclick = () => { st.tab = t.dataset.tab; $$('#at-out .at-tabs button').forEach((x) => x.setAttribute('aria-selected', String(x === t))); body(); }; });
    $('#at-dl').onclick = download; $('#at-new').onclick = () => { st.result = null; st.file = null; st.url = ''; paint(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
    body();
  }
  function body() {
    const r = st.result, el = $('#at-body'); if (!r || !el) return;
    el.classList.remove('at-fade'); void el.offsetWidth; el.classList.add('at-fade');
    ({ crowd, wall, people, visual, culture, fixes }[st.tab])(el, r);
  }
  const segKinds = [['age', 'Age'], ['region', 'Where'], ['gender', 'Gender'], ['mindset', 'Mindset'], ['background', 'Background']];
  const segOf = (p, kind) => (kind === 'age' ? p.age_group : kind === 'region' ? p.region : kind === 'gender' ? (p.gender === 'F' ? 'Women' : 'Men') : kind === 'mindset' ? p.mindset : p.background);
  function crowd(el, r) {
    const pn = r.panel, P = r.personas, sg = st.seg, segs = pn ? pn.segments.filter((s) => s.kind === sg.kind).sort((a, b) => b.purchase - a.purchase) : [];
    const seg = [['positive', 'Positive', 'good'], ['neutral', 'Neutral', 'neu'], ['troll', 'Mocking', 'warn'], ['angry', 'Angry', 'bad']];
    el.innerHTML = `<div class="at-split-bar grow" role="img" aria-label="Mood of the panel">${seg.map(([kk, l, c]) => `<i class="s-${c}" style="--w:${pn ? pn[kk] : 0}%" title="${l} ${n0(pn ? pn[kk] : 0)}%"></i>`).join('')}</div>
      <div class="row small" style="gap:14px;flex-wrap:wrap;margin:6px 0 10px">${seg.map(([kk, l, c]) => `<span><i class="dot s-${c}"></i> ${l} <b>${n0(pn ? pn[kk] : 0)}%</b></span>`).join('')}</div>
      <div class="at-crowd map" id="at-map">${P.map((p, i) => { const dim = sg.label && segOf(p, sg.kind) !== sg.label; return `<i class="dotp m-${MOOD_CLS[p.reaction.mood]} ${dim ? 'dim' : ''}" data-id="${p.persona_id}" style="--d:${Math.min(i, 80) * 16}ms" title="${esc(`${p.name}, ${p.age}, ${p.place}: ${p.reaction.mood}. Would buy ${p.reaction.purchase_intent}/10`)}"></i>`; }).join('')}</div>
      <div class="muted small" style="margin:6px 0 10px">Each dot is one person. Green is positive, grey neutral, amber mocking, red angry. Press a bar below to light up that group.</div>
      <div class="at-chips">${segKinds.map(([kk, l]) => `<button type="button" class="chip-btn" data-k="${kk}" aria-pressed="${sg.kind === kk}">${l}</button>`).join('')}</div>
      <div class="at-segs">${segs.map((s, i) => `<button type="button" class="at-seg ${sg.label === s.label ? 'on' : ''}" data-l="${esc(s.label)}" style="--d:${i * 60}ms"><span class="n">${esc(s.label)} <small class="muted">${s.n}</small></span>
          <span class="b">${meter(s.purchase)}<b>${n1(s.purchase)}</b></span><span class="m"><i class="s-good" style="--w:${s.positive}%"></i><i class="s-bad" style="--w:${s.negative}%"></i></span></button>`).join('')}</div>
      <div class="muted small" style="margin-top:4px">Bars: would buy out of 10. Small bar: share who liked it (green) and who mocked or got angry (red).</div>
      ${pn && pn.concerns.length ? `<h4>Most common worries</h4><div class="at-worries">${pn.concerns.map((c) => `<span class="badge warn">${esc(c.text)} <b>${c.count}</b></span>`).join('')}</div>` : ''}
      ${pn ? `<div class="row" style="gap:18px;flex-wrap:wrap;margin-top:12px"><div><span class="muted small">Warmest reaction</span>${pn.most_positive.map((id) => personaChip(r, id)).join('')}</div><div><span class="muted small">Coolest reaction</span>${pn.most_negative.map((id) => personaChip(r, id)).join('')}</div></div>` : ''}`;
    $$('.chip-btn', el).forEach((b) => { b.onclick = () => { st.seg = { kind: b.dataset.k, label: null }; crowd(el, r); }; });
    $$('.at-seg', el).forEach((b) => { b.onclick = () => { st.seg.label = st.seg.label === b.dataset.l ? null : b.dataset.l; crowd(el, r); }; });
    $$('.at-chipP', el).forEach((b) => { b.onclick = () => { st.tab = 'people'; st.ppl.q = b.dataset.name; st.ppl.mood = 'All'; $$('#at-out .at-tabs button').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.tab === 'people'))); body(); }; });
    $$('#at-map .dotp', el).forEach((d) => { d.onclick = () => { const p = r.personas.find((x) => x.persona_id === d.dataset.id); if (p) { st.tab = 'people'; st.ppl.q = p.name; st.ppl.mood = 'All'; $$('#at-out .at-tabs button').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.tab === 'people'))); body(); } }; });
  }
  const personaChip = (r, id) => { const p = r.personas.find((x) => x.persona_id === id); return p ? `<button type="button" class="at-chipP" data-name="${esc(p.name)}">${EMOJI[p.reaction.mood]} ${esc(p.name)}, ${p.age}</button>` : ''; };
  function wall(el, r) {
    const rc = r.risk.reaction_split, f = st.filter;
    const mine = r.personas.map((p) => ({ text: p.reaction.comment, language: p.reaction.comment_language, reaction: p.reaction.mood, who: `${p.name}, ${p.age}`, where: p.place }));
    const all = mine.concat(r.risk.crowd_comments.map((c) => ({ ...c, who: null, where: '' }))).sort((a, b) => (a.who ? 0 : 1) - (b.who ? 0 : 1) || 0);
    const shown = all.filter((c) => f === 'All' || c.reaction === f), cap = 60;
    const seg = [['positive', 'Positive', 'good'], ['neutral', 'Neutral', 'neu'], ['troll', 'Troll', 'warn'], ['angry', 'Angry', 'bad']];
    el.innerHTML = `<div class="at-split-bar grow" role="img" aria-label="Predicted reactions">${seg.map(([kk, l, c]) => `<i class="s-${c}" style="--w:${rc[kk]}%" title="${l} ${n0(rc[kk])}%"></i>`).join('')}</div>
      <div class="row small" style="gap:14px;flex-wrap:wrap;margin:6px 0 10px"><span class="at-live"><i></i> Live comment wall</span>${seg.map(([kk, l, c]) => `<span><i class="dot s-${c}"></i> ${EMOJI[l]} ${l} <b>${n0(rc[kk])}%</b></span>`).join('')}</div>
      <div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:8px">${['All', 'Positive', 'Neutral', 'Troll', 'Angry'].map((x) => `<button type="button" class="chip-btn" data-f="${x}" aria-pressed="${f === x}">${x === 'All' ? 'All' : EMOJI[x] + ' ' + x}</button>`).join('')}</div>
      <div class="at-wall">${shown.slice(0, cap).map((c, i) => `<div class="at-cmt" style="--d:${Math.min(i, 24) * 110}ms"><span class="at-av m-${MOOD_CLS[c.reaction] || 'neu'}">${esc((c.who || 'S').slice(0, 1))}</span><div><div class="small muted">${esc(c.who || 'Simulated viewer')}${c.where ? ' &middot; ' + esc(c.where) : ''} &middot; ${esc(c.language)} &middot; ${EMOJI[c.reaction] || ''}</div><div>${esc(c.text)}</div></div></div>`).join('') || '<p class="muted small">No comments of this type.</p>'}</div>
      <div class="muted small" style="margin-top:8px">${shown.length > cap ? `Showing ${cap} of ${shown.length}. ` : ''}Comments are written by AI to look like a real comment section. They are not real people.</div>`;
    $$('.chip-btn', el).forEach((b) => { b.onclick = () => { st.filter = b.dataset.f; wall(el, r); }; });
  }
  function people(el, r) {
    const s = st.ppl, q = s.q.toLowerCase(), per = 12;
    let list = r.personas.filter((p) => (s.mood === 'All' || p.reaction.mood === s.mood) && (!q || `${p.name} ${p.place} ${p.job || ''} ${p.mindset} ${p.background} ${p.reaction.comment}`.toLowerCase().includes(q)));
    const pages = Math.max(1, Math.ceil(list.length / per)); s.page = Math.min(s.page, pages); list = list.slice((s.page - 1) * per, s.page * per);
    el.innerHTML = `<div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:10px"><input type="search" id="pp-q" placeholder="Search name, town, mindset or comment" value="${esc(s.q)}" style="max-width:300px">${['All', 'Positive', 'Neutral', 'Troll', 'Angry'].map((x) => `<button type="button" class="chip-btn" data-m="${x}" aria-pressed="${s.mood === x}">${x === 'All' ? 'All' : EMOJI[x] + ' ' + x}</button>`).join('')}</div>
      <div class="at-persons">${list.map((p, i) => `<div class="at-person" style="--d:${i * 50}ms"><div class="row" style="justify-content:space-between;gap:8px"><b>${esc(p.name)}, ${p.age}</b><span class="badge ${MOOD_CLS[p.reaction.mood] === 'neu' ? '' : MOOD_CLS[p.reaction.mood]}">${EMOJI[p.reaction.mood]} ${esc(p.reaction.mood)}</span></div>
        <div class="muted small">${esc(p.place)} &middot; ${esc(p.background)} &middot; ${esc(p.mindset)}</div><p class="at-gut">${esc(p.reaction.gut_reaction)}</p><div class="at-bubble">${esc(p.reaction.comment)} <span class="badge">${esc(p.reaction.comment_language)}</span></div>
        <div class="at-int"><span>Would buy</span>${meter(p.reaction.purchase_intent)}<b>${p.reaction.purchase_intent}</b></div><div class="at-int"><span>Would share</span>${meter(p.reaction.share_intent)}<b>${p.reaction.share_intent}</b></div>
        ${p.reaction.concern ? `<div class="small"><span class="bad-t">&minus;</span> ${esc(p.reaction.concern)}</div>` : ''}</div>`).join('') || '<p class="muted small">Nobody matches.</p>'}</div>
      <div class="row" style="justify-content:space-between;margin-top:10px"><span class="muted small">Page ${s.page} of ${pages}</span><span class="row" style="gap:6px"><button class="btn sm" type="button" id="pp-prev" ${s.page <= 1 ? 'disabled' : ''}>Previous</button><button class="btn sm" type="button" id="pp-next" ${s.page >= pages ? 'disabled' : ''}>Next</button></span></div>`;
    const qEl = $('#pp-q', el); qEl.oninput = App.debounce ? App.debounce(() => { s.q = qEl.value; s.page = 1; people(el, r); const e2 = $('#pp-q', el); e2.focus(); e2.setSelectionRange(e2.value.length, e2.value.length); }, 250) : null;
    $$('.chip-btn', el).forEach((b) => { b.onclick = () => { s.mood = b.dataset.m; s.page = 1; people(el, r); }; });
    $('#pp-prev', el).onclick = () => { s.page--; people(el, r); }; $('#pp-next', el).onclick = () => { s.page++; people(el, r); };
  }
  function timeline(pts) {
    if (!pts || pts.length < 2) return '';
    const W = 600, H = 130, p = 22, x = (i) => p + (i * (W - 2 * p)) / (pts.length - 1), y = (a) => H - p - (a / 10) * (H - 2 * p);
    const d = pts.map((q, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(q.attention).toFixed(1)}`).join(' ');
    return `<svg viewBox="0 0 ${W} ${H}" class="at-tl" role="img" aria-label="Attention second by second"><line x1="${p}" y1="${y(5)}" x2="${W - p}" y2="${y(5)}" class="g"/><path d="${d}" class="ln" pathLength="1"/>
      ${pts.map((q, i) => `<circle cx="${x(i)}" cy="${y(q.attention)}" r="3.5" class="${q.attention < 4 ? 'lo' : 'pt'}" style="--d:${i * 40}ms"><title>Second ${q.second}: ${n1(q.attention)}. ${esc(q.note)}</title></circle>`).join('')}
      <text x="${p}" y="${H - 4}" class="tx">${pts[0].second}s</text><text x="${W - p}" y="${H - 4}" class="tx" text-anchor="end">${pts[pts.length - 1].second}s</text></svg>`;
  }
  function visual(el, r) {
    const v = r.vision, rev = v.static || v.video, scores = rev.scores || [];
    el.innerHTML = `<p>${esc(rev.summary)}</p>
      ${v.video ? `<div class="row small" style="gap:18px;flex-wrap:wrap"><span><b>3 second hook</b> ${n1(v.video.hook_strength_3s)} / 10</span><span><b>Pacing</b> ${n1(v.video.pacing)} / 10</span></div><p class="muted small">${esc(v.video.emotion_arc)}</p>
        <h4>Attention second by second</h4>${timeline(v.video.timeline)}${(v.video.drop_off_risks || []).length ? `<h4>Where viewers may leave</h4><ul>${v.video.drop_off_risks.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}` : ''}
      ${v.static ? `<div class="small"><b>One second eye-catch</b> ${n1(v.static.one_second_eye_catch)} / 10${v.static.headline_read ? `<div class="muted">Headline as read from the image: <i>${esc(v.static.headline_read)}</i></div>` : ''}</div>` : ''}
      <div class="at-scores">${scores.map((s, i) => `<div class="at-sc" style="--d:${i * 70}ms"><div class="row" style="justify-content:space-between"><b>${esc(s.name)}</b><span>${n1(s.value)} / 10</span></div>${meter(s.value)}<div class="muted small">${esc(s.why)}</div></div>`).join('')}</div>`;
  }
  function culture(el, r) {
    const c = r.risk, ang = Math.min(180, (c.meme_potential / 10) * 180);
    el.innerHTML = `<div class="at-gauge-row"><svg viewBox="0 0 120 70" class="at-gauge" role="img" aria-label="Meme potential ${n1(c.meme_potential)} out of 10"><path d="M10 60 A50 50 0 0 1 110 60" class="bg" pathLength="100"/><path d="M10 60 A50 50 0 0 1 110 60" class="fg" pathLength="100" style="--v:${ang / 1.8}"/><text x="60" y="58" text-anchor="middle" class="t">${n1(c.meme_potential)}</text></svg>
        <div><span class="badge ${TONE[c.risk_level]}">${esc(c.risk_level)} risk</span> <span class="small">Meme potential out of 10</span><p style="margin:6px 0 0">${esc(c.risk_summary)}</p>${c.meme_note ? `<p class="muted small" style="margin:4px 0 0">${esc(c.meme_note)}</p>` : ''}</div></div>
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
      try { st.status = await App.api.get('/api/adtest/status'); } catch (e) { st.status = { configured: false, limits: {}, sizes: {}, estimates: {}, regions: [] }; }
      paint(); loadPreview(); App.loader.hide(0);
    });
  }
  boot();
})(window.App);
