/* Pre-Launch Ad Test: one form, then an animated simulation, a scorecard, the ad beside a crowd of up to 100 Sri Lankan personas, a streaming comment wall,
 * visual and cultural analysis, and fixes. The ad goes to the server only for the test (held in memory, never stored). Results stay on this page. */
(function (App) {
  const { esc, fmt, $, $$ } = App;
  const n1 = (v) => (v == null || !Number.isFinite(v) ? 'n/a' : fmt.num(v, 1));
  const n0 = (v) => (v == null || !Number.isFinite(v) ? 'n/a' : fmt.num(v, 0));
  const REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const TABS = [['crowd', 'Crowd map'], ['wall', 'Comment wall'], ['people', 'People'], ['visual', 'Visual and attention'], ['bench', 'Benchmarks'], ['culture', 'Language and culture'], ['actions', 'Actions']];
  const CATEGORIES = ['FMCG and food', 'Banking and finance', 'Insurance', 'Telecom', 'Retail and e-commerce', 'Automotive', 'Real estate', 'Education', 'Health and pharma', 'Travel and hospitality', 'Fashion and beauty', 'Government and NGO', 'Other'];
  const GOALS = [['awareness', 'Awareness: be seen and remembered'], ['consideration', 'Consideration: make people interested'], ['conversion', 'Conversion: drive sales'], ['leads', 'Lead generation: get enquiries'], ['installs', 'App installs']];
  // mood markers: a coloured dot next to the word (no emojis)
  const EMOJI = { Positive: '<i class="mdot m-good"></i>', Neutral: '<i class="mdot m-neu"></i>', Troll: '<i class="mdot m-warn"></i>', Angry: '<i class="mdot m-bad"></i>' };
  const MOOD_CLS = { Positive: 'good', Neutral: 'neu', Troll: 'warn', Angry: 'bad' };
  const TONE = { Low: 'good', Medium: 'warn', High: 'bad', Critical: 'bad' };
  const STEPS = ['Reading the ad', 'Consumers react', 'Culture check', 'Scorecard'];
  const TIPS = ['Reading the headline the way a tired commuter would', 'Checking the Sinhala for double meanings', 'Asking a Galle shop owner what he thinks', 'Looking for anything that could become a meme',
    'Asking a Kandy grandmother if it is respectful', 'Checking colours and logo size at one glance', 'Counting how many people would share it', 'Listening to the Jaffna and Batticaloa view'];
  let root, tipTimer = null, litTimer = null;
  let st = { type: 'static', file: null, url: '', status: null, result: null, tab: 'crowd', running: false, filter: 'All', form: {}, panel: { size: 'quick', age_min: '', age_max: '', gender: '', region: '' },
    cfg: { category: '', goal: 'consideration', runs: 3, quality: 'standard', weighted: true }, map: 'ad', preview: [], seg: { kind: 'age', label: null }, ppl: { mood: 'All', q: '', page: 1 } };

  const kpi = (label, value, sub, cls = '') => `<div class="kpi ${cls}"><div class="k-lbl">${esc(label)}</div><div class="k-val">${value}</div>${sub ? `<div class="k-sub">${sub}</div>` : ''}</div>`;
  const meter = (v, top = 10) => `<span class="at-meter" role="img" aria-label="${n1(v)} out of ${top}"><i style="--w:${Math.max(0, Math.min(100, (v / top) * 100))}%"></i></span>`;
  const countUp = (el, to, dec = 0, suffix = '', dur = 900) => {
    if (!el) return; const fin = to.toFixed(dec) + suffix; if (REDUCED || !Number.isFinite(to)) { el.textContent = fin; return; }
    const t0 = performance.now(); const step = (t) => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = (to * e).toFixed(dec) + suffix; if (k < 1) requestAnimationFrame(step); else el.textContent = fin; }; requestAnimationFrame(step);
  };
  const tok = (n) => (n >= 1000 ? fmt.num(n / 1000, n >= 10000 ? 0 : 1) + 'k' : String(n));
  const sizeInfo = (k) => { const e = ((st.status || {}).estimates || {})[k]; return e && e[st.type] ? e[st.type][String(st.cfg.runs >= 3 ? 3 : 1)] : null; };
  const stop = () => { clearInterval(tipTimer); clearInterval(litTimer); tipTimer = litTimer = null; };

  // ------------------------------------------------------------------ the form
  const SIZES = [['quick', 'Quick', 'A small panel that already mirrors the country. Best for a first look.'], ['standard', 'Standard', 'Every age, region and mindset covered properly.'],
    ['full', 'Full 100', 'A hundred people chosen to match Sri Lanka by gender, ethnic group, age and region.'], ['complete', 'Complete 200', 'The whole bank of 200. The most stable reading, for a final check before launch.']];
  function form() {
    const f = st.form, video = st.type === 'video', lim = (st.status || {}).limits || {}, p = st.panel, S = st.status || {};
    const accept = video ? '.mp4,.mov,.webm,.m4v' : '.jpg,.jpeg,.png,.webp';
    const sel = (id, label, opts, val) => `<div class="field"><label for="at-${id}">${label}</label><select id="at-${id}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`;
    const field = (id, label, ph, rows) => `<div class="field"><label for="at-${id}">${label}</label>${rows ? `<textarea id="at-${id}" rows="${rows}" maxlength="4000" placeholder="${esc(ph)}">${esc(f[id] || '')}</textarea>` : `<input id="at-${id}" maxlength="200" placeholder="${esc(ph)}" value="${esc(f[id] || '')}">`}</div>`;
    const preview = st.file ? (video ? `<video src="${esc(st.url)}" controls muted playsinline class="at-prev"></video>` : `<img src="${esc(st.url)}" alt="The ad you chose" class="at-prev">`) : '';
    const sizeBtn = (k, label, tip) => { const e = sizeInfo(k), n = (S.sizes || {})[k] || ''; return `<button type="button" class="at-size" data-size="${k}" aria-pressed="${p.size === k}" title="${esc(tip)}"><b>${label}</b><span>${n} people</span><small>${e ? `about ${tok(e.total)} tokens, ${e.calls} calls` : ''}</small></button>`; };
    const ages = [['', 'Any']].concat([16, 18, 25, 35, 45, 55, 65].map((a) => [a, String(a)]));
    $('#at-form').innerHTML = `<div class="card"><div class="row" style="gap:12px;flex-wrap:wrap;align-items:center"><div class="seg" role="group" aria-label="Ad type">
        <button type="button" data-t="video" aria-pressed="${video}">Video commercial</button><button type="button" data-t="static" aria-pressed="${!video}">Static image or press ad</button></div>
        <span class="muted small">${video ? `TVC, TikTok or Reel. MP4 up to ${lim.video_mb || 80} MB and ${lim.video_seconds || 180} seconds. Audio is not analysed: paste the voice-over in the script box.` : `Facebook or Instagram image, carousel slide or newspaper artwork. JPG, PNG or WebP up to ${lim.image_mb || 15} MB.`}</span></div>
      <div class="at-grid"><div><label class="at-drop" id="at-drop" tabindex="0"><input type="file" id="at-file" accept="${accept}" hidden>${preview || `<span class="at-hint"><span class="at-ring"></span><b>Choose the ${video ? 'video' : 'image'}</b><br><span class="muted small">or drop it here</span></span>`}</label>
          ${st.file ? `<div class="muted small" style="margin-top:6px">${esc(st.file.name)} (${st.file.size < 1048576 ? fmt.num(st.file.size / 1024, 0) + ' KB' : fmt.num(st.file.size / 1048576, 1) + ' MB'}) <button class="btn sm ghost" type="button" id="at-clear">Remove</button></div>` : ''}</div>
        <div class="at-fields"><div class="at-two">${field('brand', 'Brand', 'e.g. Sampath Bank')}${field('product', 'Product or offer', 'e.g. Personal loan')}</div>
          <div class="at-two">${sel('category', 'Brand category', [['', 'Choose']].concat(CATEGORIES.map((c) => [c, c])), st.cfg.category)}${sel('goal', 'Campaign goal', GOALS, st.cfg.goal)}</div>
          ${field('headline', 'Headline on the ad', 'The main line, in the language used on the ad', 0)}
          ${field('copy', video ? 'Script and voice-over' : 'Body copy and call to action', video ? 'What is said and sung, in order' : 'All other text on the ad', 3)}
          <details class="g-det"><summary>More context (optional)</summary><div class="at-two" style="margin-top:8px">${field('audience', 'Target audience', 'Who is it for?', 2)}${field('objective', 'Campaign objective', 'e.g. app downloads, awareness', 2)}</div>${field('market_notes', 'Anything else', 'Season, competitor ads, sensitivities to watch', 2)}</details></div></div>
      <div class="at-panelbox"><div class="row" style="justify-content:space-between;gap:10px;flex-wrap:wrap"><b>Who should react?</b><span class="muted small">${S.bank || 100} Sri Lankan personas: ages 16 to 75, towns, villages, estates, the North and East, many mindsets</span></div>
        <div class="at-sizes">${SIZES.map(([k, l, t]) => sizeBtn(k, l, t)).join('')}</div>
        <div class="at-opts"><div><span class="muted small">Reliability</span><div class="seg" id="at-runs" role="group" aria-label="Runs"><button type="button" data-r="1" aria-pressed="${st.cfg.runs < 3}" title="One pass of the panel. Fastest and cheapest, no margin of error.">Fast, 1 run</button><button type="button" data-r="3" aria-pressed="${st.cfg.runs >= 3}" title="The whole panel answers 3 times (Monte Carlo). Gives margins of error. About 2 to 3 times the panel cost.">Reliable, 3 runs</button></div></div>
          <div><span class="muted small">Model quality</span><div class="seg" id="at-qual" role="group" aria-label="Model quality"><button type="button" data-q="standard" aria-pressed="${st.cfg.quality === 'standard'}" title="Gemini 2.5 Pro reads the ad; a cheaper model runs the panel and the culture check.">Standard</button><button type="button" data-q="best" aria-pressed="${st.cfg.quality === 'best'}" title="Gemini 2.5 Pro for every step. Costs more.">Best, Pro everywhere</button></div></div>
          <label class="row small at-wt" title="Weights each persona so the panel matches Sri Lankan adults by gender, ethnic group, age and region (census shares). Switch off to count every persona the same."><input type="checkbox" id="at-weighted" ${st.cfg.weighted ? 'checked' : ''}> Weight to the Sri Lankan population</label></div>
        <details class="g-det" ${p.gender || p.region || p.age_min || p.age_max ? 'open' : ''}><summary>Choose a specific audience (optional)</summary><div class="at-four" style="margin-top:8px">${sel('age_min', 'Age from', ages, p.age_min)}${sel('age_max', 'Age to', [['', 'Any']].concat([24, 34, 44, 54, 64, 75].map((a) => [a, String(a)])), p.age_max)}
          ${sel('gender', 'Gender', [['', 'Everyone'], ['F', 'Women'], ['M', 'Men']], p.gender)}${sel('region', 'Where', [['', 'Anywhere']].concat((S.regions || []).map((r) => [r, r])), p.region)}</div></details>
        <div class="at-crowd" id="at-crowd" aria-label="The people who will react"></div><div class="muted small" id="at-crowdnote"></div></div>
      <div class="row" style="margin-top:12px;gap:12px;flex-wrap:wrap;align-items:center"><button class="btn primary" type="button" id="at-run" ${st.file && !st.running && S.configured ? '' : 'disabled'}>Run pre-launch simulation</button>
        <span class="muted small">${S.configured === false ? 'The Gemini key is not set on the server, so tests cannot run.' : 'The ad and text are sent to Gemini for the test. They are not stored on our server. The same ad and settings run again for free.'}</span>
        <button class="btn sm ghost" type="button" id="at-check">Check the Gemini connection</button></div>
      ${S.key_problem ? `<div class="banner warn" style="margin-top:10px"><span>${esc(S.key_problem)}</span></div>` : ''}<div id="at-checkout"></div></div>`;
    $$('#at-form .seg button').forEach((b) => { b.onclick = () => { readForm(); st.type = b.dataset.t; st.file = null; st.url = ''; st.result = null; paint(); }; });
    $$('#at-form .at-size').forEach((b) => { b.onclick = () => { readForm(); st.panel.size = b.dataset.size; form(); loadPreview(); }; });
    ['age_min', 'age_max', 'gender', 'region'].forEach((k) => { const el = $('#at-' + k); if (el) el.onchange = () => { st.panel[k] = el.value; loadPreview(); }; });
    ['category', 'goal'].forEach((k) => { const el = $('#at-' + k); if (el) el.onchange = () => { st.cfg[k] = el.value; }; });
    $$('#at-runs button').forEach((b) => { b.onclick = () => { readForm(); st.cfg.runs = +b.dataset.r; form(); }; });
    $$('#at-qual button').forEach((b) => { b.onclick = () => { readForm(); st.cfg.quality = b.dataset.q; form(); }; });
    { const wt = $('#at-weighted'); if (wt) wt.onchange = () => { st.cfg.weighted = wt.checked; }; }
    const input = $('#at-file'), drop = $('#at-drop');
    input.onchange = () => pick(input.files[0]);
    drop.onclick = (e) => { if (!e.target.closest('video')) input.click(); };
    drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } };
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); }; drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); pick(e.dataTransfer.files[0]); };
    const clr = $('#at-clear'); if (clr) clr.onclick = () => { readForm(); st.file = null; st.url = ''; form(); drawCrowd(); };
    $('#at-run').onclick = run; drawCrowd();
    $('#at-check').onclick = async (e) => {
      const btn = e.currentTarget, box = $('#at-checkout'); btn.disabled = true; btn.textContent = 'Checking...';
      try {
        const c = await App.api.get('/api/adtest/check');
        box.innerHTML = `<div class="banner ${c.ok ? 'good' : 'bad'}" style="margin-top:10px"><span>${c.ok ? '<b>Gemini is connected.</b> ' : (c.models || []).some((m) => m.ok) ? '<b>Gemini is connected, with a limit.</b> ' : '<b>Gemini is not reachable with this setup.</b> '}${c.key_problem ? esc(c.key_problem) + ' ' : ''}${(c.models || []).map((m) => `${esc(m.model)}: ${m.ok ? 'ready' : esc(m.error)}`).join(' &middot; ')}${c.backend ? ` <span class="muted small">(endpoint: ${esc(c.backend)})</span>` : ''}${c.hint ? `<br>${esc(c.hint)}` : ''}</span></div>`;
      } catch (x) { box.innerHTML = `<div class="banner bad" style="margin-top:10px"><span>${esc(x.message)}</span></div>`; }
      btn.disabled = false; btn.textContent = 'Check the Gemini connection';
    };
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
    const fd = new FormData(); fd.append('ad_type', st.type); fd.append('file', st.file); fd.append('panel_size', st.panel.size); fd.append('runs', st.cfg.runs); fd.append('weighted', st.cfg.weighted ? 'true' : 'false'); fd.append('quality', st.cfg.quality); fd.append('category', st.cfg.category || ''); fd.append('goal', st.cfg.goal || '');
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
        st.result = j.result; st.map = 'ad'; st.tab = 'crowd'; st.filter = 'All'; st.seg = { kind: 'age', label: null }; st.ppl = { mood: 'All', q: '', page: 1 }; break;
      }
    } catch (e) { App.toast(e.message, 'error'); st.result = null; }
    stop(); st.running = false; paint();
    if (st.result) { const el = $('#at-out'); if (el) el.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' }); }
  }
  let lit = 0, target = 0, stageBuilt = false;
  function stage(p, msg) {
    const out = $('#at-out'); if (!out) return;
    const total = st.preview.length || 12, step = p < 0.28 ? 0 : p < 0.7 ? 1 : p < 0.93 ? 2 : 3;
    const m = /^(\d+) of (\d+) reactions/.exec(msg || '');
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
  const pm = (v, m, d = 1) => `${v.toFixed(d)}${m != null ? ` <small class="pmx">&plusmn; ${m.toFixed(d)}</small>` : ''}`;
  function hero(r) {
    const v = r.viability; if (!v) return '';
    const tone = v.label === 'Launch' ? 'good' : v.label === 'Launch after fixes' ? 'good' : v.label === 'Rework' ? 'warn' : 'bad';
    const w = v.weights || {}, parts = v.parts || {}, names = { visual: 'Visual impact', hook: r.brief.ad_type === 'video' ? '3 second hook' : '1 second eye-catch', purchase: 'Purchase intent', share: 'Share intent', safety: 'Safety (100 minus backlash)' };
    return `<div class="card at-hero at-pop"><div class="at-herogrid"><div class="at-score"><div class="lbl">Pre-launch viability</div><div class="num"><span data-n="${v.score}" data-d="0">0</span>${v.margin != null ? `<small class="pmx"> &plusmn; ${n1(v.margin)}</small>` : ''}<small>/100</small></div>
        <span class="badge ${tone}">${esc(v.label)}</span></div>
      <div class="at-rangebox"><div class="at-range" role="img" aria-label="Score ${n0(v.score)} out of 100${v.low != null ? `, 95 percent range ${n0(v.low)} to ${n0(v.high)}` : ''}"><i class="band" style="--l:${v.low != null ? v.low : v.score}%;--w:${v.low != null ? Math.max(0.8, v.high - v.low) : 0.8}%"></i><i class="pin" style="--l:${v.score}%"></i></div>
        <div class="row small muted" style="justify-content:space-between"><span>0</span><span>45 rework</span><span>60 after fixes</span><span>75 launch</span><span>100</span></div>
        <div class="small" style="margin-top:6px">${v.margin != null ? `95% range <b>${n0(v.low)} to ${n0(v.high)}</b>, from ${v.runs} repeated runs of the simulated audience.` : 'One run: no margin of error. Choose "Reliable, 3 runs" for one.'} Goal: <b>${esc(v.goal)}</b>.</div>
        <details class="g-det"><summary>How the score is built</summary><div class="tbl-scroll"><table class="tbl"><thead><tr><th>Ingredient</th><th class="num">Value</th><th class="num">Weight</th><th class="num">Points</th></tr></thead><tbody>${['visual', 'hook', 'purchase', 'share', 'safety'].map((k) => `<tr><td>${esc(names[k])}</td><td class="num">${n0(parts[k])}</td><td class="num">${n0((w[k] || 0) * 100)}%</td><td class="num">${n1((parts[k] || 0) * (w[k] || 0))}</td></tr>`).join('')}</tbody></table></div>
          <div class="muted small">Weights change with the campaign goal and can be edited in the benchmarks file. The margin shows how much the simulated audience varied between runs; it does not include error in the image analysis.</div></details></div></div></div>`;
  }
  function adPanel(r) {
    const v = r.vision, ref = r.brief.ad_type === 'video' ? r.thumbnail : (st.url || r.thumbnail), mode = st.map;
    const raw = st.file ? (r.brief.ad_type === 'video' ? `<video src="${esc(st.url)}" controls muted playsinline class="at-prev"></video>` : `<img src="${esc(st.url)}" alt="The tested ad" class="at-prev">`) : (r.thumbnail ? `<img src="${esc(r.thumbnail)}" alt="The tested ad" class="at-prev">` : '');
    const COL = { hook: 'var(--warn)', logo: 'var(--accent)', cta: 'var(--good)', headline: 'var(--accent-2)', price: 'var(--accent-3, #ff4fd8)', product: 'var(--accent)', face: 'var(--warn)', other: 'var(--muted)' };
    const zones = (v.zones || []).map((z, i) => { const [y0, x0, y1, x1] = z.box; return `<g class="zn" style="--d:${i * 160}ms"><rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="none" stroke="${COL[z.kind] || COL.other}" stroke-width="2.5" vector-effect="non-scaling-stroke"/><text x="${x0 + 0.008}" y="${Math.max(0.03, y0 - 0.008)}" class="zt" fill="${COL[z.kind] || COL.other}">${z.order ? z.order + ' ' : ''}${esc(z.kind)}</text></g>`; }).join('');
    const heat = (v.zones || []).filter((z) => z.order >= 1 && z.order <= 3).map((z) => { const [y0, x0, y1, x1] = z.box, o = [0, 0.75, 0.5, 0.35][z.order]; return `<ellipse cx="${(x0 + x1) / 2}" cy="${(y0 + y1) / 2}" rx="${(x1 - x0) * 0.75}" ry="${(y1 - y0) * 0.75}" fill="url(#hg)" opacity="${o}" class="hb"/>`; }).join('');
    const g = v.prior_grid || [], n = g.length || 1;
    const prior = g.map((row, ri) => row.map((p, ci) => `<rect x="${ci / n}" y="${ri / n}" width="${1 / n}" height="${1 / n}" fill="${p < 0.2 ? 'var(--bad)' : p < 0.4 ? 'var(--warn)' : 'var(--good)'}" opacity="${0.12 + (p < 0.2 ? 0.3 : p < 0.4 ? 0.12 : 0.05)}"/>`).join('')).join('');
    const svg = (inner) => `<svg class="at-ov" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true"><defs><radialGradient id="hg"><stop offset="0" stop-color="#ff3c28" stop-opacity="1"/><stop offset="1" stop-color="#ff3c28" stop-opacity="0"/></radialGradient></defs>${inner}</svg>`;
    const view = mode === 'ad' ? raw : `<div class="at-ovwrap"><img src="${esc(ref)}" alt="The ad with attention zones" class="at-prev">${svg(mode === 'blind' ? prior + zones : heat + zones)}</div>`;
    return `<div class="card at-ad at-pop"><div class="seg at-mapseg" role="group" aria-label="View"><button type="button" data-m="ad" aria-pressed="${mode === 'ad'}">Ad</button><button type="button" data-m="map" aria-pressed="${mode === 'map'}" title="Where the eye lands, and the key zones">Attention</button><button type="button" data-m="blind" aria-pressed="${mode === 'blind'}" title="Red: low-attention blind spots. Green: strong areas">Blind spots</button></div>
      <div class="at-adbox">${view}</div>${mode === 'map' ? '<div class="muted small">Red glow is the eye path (1, 2, 3). Boxes are the key zones.</div>' : mode === 'blind' ? '<div class="muted small">Red squares are where people rarely look. Keep logos and offers out of them.</div>' : ''}
      <div class="small"><b>${esc(r.brief.brand || 'Brand not given')}</b>${r.brief.headline ? `<div class="muted">${esc(r.brief.headline)}</div>` : ''}</div></div>`;
  }
  function results() {
    const out = $('#at-out'), r = st.result; stageBuilt = false; if (!r) { if (!st.running) out.innerHTML = ''; return; }
    const k = r.scorecard, b = r.brief, bl = k.backlash_risk, blCls = bl >= 65 ? 'bad' : bl >= 35 ? 'warn' : 'good', u = r.usage || {}, video = b.ad_type === 'video', pn = r.panel;
    const spent = u.cached ? 'Saved result: no new tokens used.' : `Tokens used: ${tok(u.input_tokens || 0)} in, ${tok(u.output_tokens || 0)} out, ${u.calls || 0} calls.`;
    const buyIv = pn && pn.purchase_ci && pn.purchase_ci.margin != null ? pn.purchase_ci.margin : null, shIv = pn && pn.share_ci && pn.share_ci.margin != null ? pn.share_ci.margin : null;
    out.innerHTML = `<div class="banner info at-verdict ${k.verdict_tone} at-pop"><span><b>${esc(k.verdict)}</b> <span class="badge ${k.verdict_tone}">Simulated by AI</span> <span class="muted small">${esc(spent)}</span></span>
        <span class="row" style="gap:8px"><button class="btn sm" type="button" id="at-dl">Download client report</button><button class="btn sm ghost" type="button" id="at-new">Test another ad</button></span></div>
      ${hero(r)}
      <div class="kpis at-stagger" style="margin-top:12px">${kpi('Visual impact', '<span data-n="' + k.visual_impact + '">0</span>', 'out of 100')}${kpi(video ? '3 second hook' : '1 second eye-catch', '<span data-n="' + k.hook_score + '">0</span>', 'out of 100')}
        ${kpi('Backlash risk', `<span class="${blCls}-t" data-n="${bl}">0</span>`, `<span class="badge ${TONE[k.risk_level]}">${esc(k.risk_level)}</span> lower is safer`)}
        ${kpi('Would buy', `<span data-n="${k.avg_purchase_intent}" data-d="1">0</span>${buyIv != null ? ` <small class="pmx">&plusmn; ${buyIv.toFixed(1)}</small>` : ''} / 10`, `average of ${pn ? pn.size : r.personas.length} people${buyIv != null ? ', 95% margin' : ''}`)}${kpi('Would share', `<span data-n="${k.avg_share_intent}" data-d="1">0</span>${shIv != null ? ` <small class="pmx">&plusmn; ${shIv.toFixed(1)}</small>` : ''} / 10`, pn && pn.resonance ? `emotional pull ${n1(pn.resonance)} / 10` : 'average of the panel')}</div>
      <div class="at-split">${adPanel(r)}
        <div><div class="at-tabs" role="tablist">${TABS.map(([id, l]) => `<button type="button" role="tab" data-tab="${id}" aria-selected="${st.tab === id}">${esc(l)}</button>`).join('')}</div><div id="at-body" class="card"></div></div></div>
      <div class="muted small" style="margin-top:10px">${r.caveats.map(esc).join(' ')}</div>`;
    $$('#at-out [data-n]').forEach((el) => countUp(el, +el.dataset.n, +(el.dataset.d || 0)));
    $$('#at-out .at-tabs button').forEach((t) => { t.onclick = () => { st.tab = t.dataset.tab; $$('#at-out .at-tabs button').forEach((x) => x.setAttribute('aria-selected', String(x === t))); body(); }; });
    $$('#at-out .at-mapseg button').forEach((m) => { m.onclick = () => { st.map = m.dataset.m; const host = $('#at-out .at-ad'); host.outerHTML = adPanel(r); results2(r); }; });
    $('#at-dl').onclick = download; $('#at-new').onclick = () => { st.result = null; st.file = null; st.url = ''; paint(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
    body();
  }
  function results2(r) { $$('#at-out .at-mapseg button').forEach((m) => { m.onclick = () => { st.map = m.dataset.m; const host = $('#at-out .at-ad'); host.outerHTML = adPanel(r); results2(r); }; }); }
  function body() {
    const r = st.result, el = $('#at-body'); if (!r || !el) return;
    el.classList.remove('at-fade'); void el.offsetWidth; el.classList.add('at-fade');
    ({ crowd, wall, people, visual, bench, culture, actions }[st.tab])(el, r);
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
      ${pn ? `<p class="small muted" style="margin:10px 0 0">${pn.weighted ? `Weighted to Sri Lankan adults by gender, ethnic group, age and region. The weighted panel is worth about ${n0(pn.effective_n)} people (unweighted would buy ${n1(pn.purchase_raw)} / 10).` : 'Not weighted: every persona counts the same.'}</p>` : ''}
      ${pn && pn.purchase_ci && pn.purchase_ci.margin != null ? `<p class="small" style="margin:10px 0 0"><b>Would buy ${pm(pn.purchase, pn.purchase_ci.margin)} / 10</b> and <b>would share ${pm(pn.share, pn.share_ci ? pn.share_ci.margin : null)} / 10</b>, with a 95% margin of error from ${pn.runs} repeated runs (the runs averaged ${pn.run_means.map((x) => x.toFixed(1)).join(', ')}).</p>` : ''}
      ${pn && pn.emotions && pn.emotions.length ? `<h4>Emotional resonance <small class="muted">pull ${n1(pn.resonance)} / 10</small></h4><div class="at-emos">${pn.emotions.map((e, i) => `<div class="at-emo" style="--d:${i * 60}ms"><span>${esc(e.emotion)}</span>${meter(e.percent, 100)}<b>${n0(e.percent)}%</b></div>`).join('')}</div>` : ''}
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
        <div class="at-int"><span>Would buy</span>${meter(p.purchase_mean)}<b>${n1(p.purchase_mean)}</b></div><div class="at-int"><span>Would share</span>${meter(p.share_mean)}<b>${n1(p.share_mean)}</b></div>
        ${p.runs > 1 ? `<div class="muted small">${p.runs} runs, spread &plusmn;${n1(p.purchase_sd)}. Feels: ${esc(p.emotion || 'n/a')}.</div>` : `<div class="muted small">Feels: ${esc(p.emotion || 'n/a')}.</div>`}
        ${p.reaction.concern ? `<div class="small"><span class="bad-t">&minus;</span> ${esc(p.reaction.concern)}</div>` : ''}</div>`).join('') || '<p class="muted small">Nobody matches.</p>'}</div>
      <div class="row" style="justify-content:space-between;margin-top:10px"><span class="muted small">Page ${s.page} of ${pages}</span><span class="row" style="gap:6px"><button class="btn sm" type="button" id="pp-prev" ${s.page <= 1 ? 'disabled' : ''}>Previous</button><button class="btn sm" type="button" id="pp-next" ${s.page >= pages ? 'disabled' : ''}>Next</button></span></div>`;
    const qEl = $('#pp-q', el); qEl.oninput = App.debounce ? App.debounce(() => { s.q = qEl.value; s.page = 1; people(el, r); const e2 = $('#pp-q', el); e2.focus(); e2.setSelectionRange(e2.value.length, e2.value.length); }, 250) : null;
    $$('.chip-btn', el).forEach((b) => { b.onclick = () => { s.mood = b.dataset.m; s.page = 1; people(el, r); }; });
    $('#pp-prev', el).onclick = () => { s.page--; people(el, r); }; $('#pp-next', el).onclick = () => { s.page++; people(el, r); };
  }
  function timeline(pts, stim, drops) {
    if (!pts || pts.length < 2) return '';
    const W = 600, H = 140, p = 22, x = (i) => p + (i * (W - 2 * p)) / (pts.length - 1), y = (a) => H - p - (a / 10) * (H - 2 * p);
    const d = pts.map((q, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(q.attention).toFixed(1)}`).join(' ');
    const sd = (stim || []).length >= 2 ? stim.slice(0, pts.length).map((q, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(q).toFixed(1)}`).join(' ') : '';
    return `<svg viewBox="0 0 ${W} ${H}" class="at-tl" role="img" aria-label="Attention second by second"><line x1="${p}" y1="${y(5)}" x2="${W - p}" y2="${y(5)}" class="g"/>${sd ? `<path d="${sd}" class="st"/>` : ''}<path d="${d}" class="ln" pathLength="1"/>
      ${pts.map((q, i) => `${(drops || []).includes(q.second) ? `<line x1="${x(i)}" y1="${p - 8}" x2="${x(i)}" y2="${H - p}" class="dr"/>` : ''}<circle cx="${x(i)}" cy="${y(q.attention)}" r="3.5" class="${q.attention < 4 ? 'lo' : 'pt'}" style="--d:${i * 40}ms"><title>Second ${q.second}: attention ${n1(q.attention)}${stim && stim[i] != null ? `, visual change ${n1(stim[i])}` : ''}. ${esc(q.note)}</title></circle>`).join('')}
      <text x="${p}" y="${H - 4}" class="tx">${pts[0].second}s</text><text x="${W - p}" y="${H - 4}" class="tx" text-anchor="end">${pts[pts.length - 1].second}s</text></svg>
      <div class="row small muted" style="gap:14px"><span><i class="lg ln"></i> predicted attention</span><span><i class="lg st"></i> measured visual change</span><span><i class="lg dr"></i> likely drop-off</span></div>`;
  }
  function visual(el, r) {
    const v = r.vision, rev = v.static || v.video, scores = rev.scores || [];
    const place = (v.placements || []).map((p, i) => `<div class="at-pl ${p.verdict.toLowerCase()}" style="--d:${i * 80}ms"><div class="row" style="justify-content:space-between"><b>${esc(p.label)}</b><span class="badge ${p.verdict === 'Strong' ? 'good' : p.verdict === 'Weak' ? 'bad' : 'warn'}">${esc(p.verdict)}</span></div><div class="small">${esc(p.advice)}</div><div class="muted small">${n1(p.area_pct)}% of the frame, ${n0(p.attention_prior * 100)}% of usual attention</div></div>`).join('');
    el.innerHTML = `<p>${esc(rev.summary)}</p>${rev.first_glance ? `<p class="small"><b>What the eye sees first:</b> ${esc(rev.first_glance)}</p>` : ''}
      <div class="at-two2"><div class="at-sc"><div class="row" style="justify-content:space-between"><b>Readability</b><span>${n0(rev.readability)} / 100</span></div>${meter(rev.readability, 100)}</div><div class="at-sc"><div class="row" style="justify-content:space-between"><b>Layout cleanliness</b><span>${n0(rev.cleanliness)} / 100</span></div>${meter(rev.cleanliness, 100)}</div></div>
      ${place ? `<h4>Where things sit, and whether the eye will find them</h4><div class="at-pls">${place}</div><div class="muted small">Press Attention or Blind spots beside the ad to see this on the picture. The verdicts use a rule-of-thumb model of where people look (centre first, then top left), not eye tracking.</div>` : ''}
      ${v.video ? `<div class="row small" style="gap:18px;flex-wrap:wrap;margin-top:10px"><span><b>3 second hook</b> ${n1(v.video.hook_strength_3s)} / 10</span><span><b>Pacing</b> ${n1(v.video.pacing)} / 10</span></div><p class="muted small">${esc(v.video.emotion_arc)}</p>
        <h4>Attention second by second</h4>${timeline(v.video.timeline, v.stimulation, v.drop_offs)}${(v.drop_offs || []).length ? `<p class="small"><b>Likely drop-off seconds:</b> ${v.drop_offs.join(', ')}.</p>` : ''}${(v.video.drop_off_risks || []).length ? `<ul>${v.video.drop_off_risks.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}` : ''}
      ${v.static ? `<div class="small" style="margin-top:8px"><b>One second eye-catch</b> ${n1(v.static.one_second_eye_catch)} / 10${v.static.headline_read ? `<div class="muted">Headline as read from the image: <i>${esc(v.static.headline_read)}</i></div>` : ''}</div>` : ''}
      <div class="at-scores">${scores.map((s, i) => `<div class="at-sc" style="--d:${i * 70}ms"><div class="row" style="justify-content:space-between"><b>${esc(s.name)}</b><span>${n1(s.value)} / 10</span></div>${meter(s.value)}<div class="muted small">${esc(s.why)}</div></div>`).join('')}</div>`;
  }
  function bench(el, r) {
    const bs = r.benchmarks || [];
    el.innerHTML = `<p class="small muted" style="margin-top:0">${esc(r.benchmark_note || '')}</p><div class="at-bench">${bs.map((b, i) => {
      const hi = b.higher_is_better, v = Math.max(0, Math.min(100, b.value));
      return `<div class="at-bm" style="--d:${i * 70}ms"><div class="row" style="justify-content:space-between;gap:8px"><b>${esc(b.label)}</b><span class="badge ${b.verdict === 'Strong' ? 'good' : b.verdict === 'Typical' ? 'warn' : 'bad'}">${esc(b.verdict)}</span></div>
        <div class="at-bar"><i class="typ" style="left:${b.typical_low}%;width:${b.typical_high - b.typical_low}%"></i><i class="pin" style="left:${v}%"></i></div>
        <div class="row small muted" style="justify-content:space-between"><span>This ad <b>${n0(b.value)}</b></span><span>typical ${n0(b.typical_low)} to ${n0(b.typical_high)}${hi ? '' : ' (lower is better)'}</span></div><div class="muted small">${esc(b.reference)}</div></div>`; }).join('') || '<p class="muted small">No benchmarks.</p>'}</div>`;
  }
  function culture(el, r) {
    const c = r.risk, ang = Math.min(180, (c.meme_potential / 10) * 180);
    el.innerHTML = `<div class="at-gauge-row"><svg viewBox="0 0 120 70" class="at-gauge" role="img" aria-label="Meme potential ${n1(c.meme_potential)} out of 10"><path d="M10 60 A50 50 0 0 1 110 60" class="bg" pathLength="100"/><path d="M10 60 A50 50 0 0 1 110 60" class="fg" pathLength="100" style="--v:${ang / 1.8}"/><text x="60" y="58" text-anchor="middle" class="t">${n1(c.meme_potential)}</text></svg>
        <div><span class="badge ${TONE[c.risk_level]}">${esc(c.risk_level)} risk</span> <span class="small">Meme potential out of 10</span><p style="margin:6px 0 0">${esc(c.risk_summary)}</p>${c.meme_note ? `<p class="muted small" style="margin:4px 0 0">${esc(c.meme_note)}</p>` : ''}</div></div>
      ${c.flags.length ? `<div class="tbl-scroll"><table class="tbl"><thead><tr><th>Type</th><th>Where</th><th>Issue</th><th>Suggestion</th><th>Severity</th></tr></thead><tbody>${c.flags.map((f) => `<tr><td>${esc(f.category)}</td><td>${esc(f.where)}</td><td>${esc(f.issue)}</td><td>${esc(f.suggestion)}</td><td><span class="badge ${TONE[f.severity]}">${esc(f.severity)}</span></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">No specific language or cultural flags were raised.</p>'}`;
  }
  function actions(el, r) {
    const recs = r.recommendations || [], grp = { High: 'Do before launch', Medium: 'Should fix', Low: 'Nice to have' };
    el.innerHTML = ['High', 'Medium', 'Low'].map((p) => { const rs = recs.filter((x) => x.priority === p); return rs.length ? `<h4 ${p === 'High' ? 'style="margin-top:0"' : ''}><span class="badge ${p === 'High' ? 'bad' : p === 'Medium' ? 'warn' : ''}">${esc(p)}</span> ${grp[p]}</h4><ol class="at-fixes">${rs.map((x, i) => `<li style="--d:${i * 60}ms"><span class="muted small">${esc(x.area)}</span><div>${esc(x.action)}</div>${x.why ? `<div class="muted small">${esc(x.why)}</div>` : ''}</li>`).join('')}</ol>` : ''; }).join('') || '<p class="muted small">No actions were raised.</p>';
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
