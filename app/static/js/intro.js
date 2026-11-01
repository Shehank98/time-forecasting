/* Full-screen animated intro film: how Media Radar works, how to read a forecast and what each card finds.
 * Plays by itself after sign-in; Back and Next sit inside the screen; Space pauses; Esc or Skip closes it.
 * "Don't show again" turns it off per user; "Watch intro" in the sidebar replays it.
 */
(function (App) {
  const { esc } = App;
  const CHART_ACTUAL = 'M10 150 C40 130 60 160 90 120 S140 90 170 105 S215 70 240 80';
  const CHART_FC = 'M240 80 C262 70 280 92 300 78 S338 50 360 62 S390 40 410 48';
  const BAND = 'M240 80 C262 56 280 70 300 52 S338 22 360 32 S390 6 410 14 L410 96 C390 92 370 100 360 100 S300 112 300 112 S262 108 240 80 Z';
  const ic = (d) => `<svg viewBox="0 0 24 24"><path d="${d}"/></svg>`;

  /* ---------- animated sample dashboards (dummy data, drawn with the current theme) ---------- */
  const tile = (label, val, dec, pre = '', suf = '') => `<div class="dm-k"><span class="fc-pill tile">Forecast</span><small>${label}</small><b data-count="${val}" data-dec="${dec}" data-pre="${pre}" data-suf="${suf}">${pre}0${suf}</b></div>`;
  const bars = (rows) => rows.map(([n, a, b, d, up], i) => `<div class="dm-bar" style="--i:${i}"><em>${n}</em><span class="tr"><i class="was" style="--w:${a}%"></i><i class="now ${up ? 'up' : 'dn'}" style="--w:${b}%"></i></span><u class="${up ? 'up' : 'dn'}">${d}</u></div>`).join('');
  const heat = (vals) => vals.map((v, i) => `<i style="--i:${i};--v:${v}">${v >= .7 ? '5.2' : v >= .45 ? '3.4' : '1.6'}</i>`).join('');

  const tvrDemo = () => `<div class="demo">
    <div class="dm-kpis">${tile('Projected average TVR', 3.26, 2)}${tile('Guaranteed minimum', 3.04, 2)}${tile('Projected reach', 4.3, 1, '', '%')}</div>
    <div class="dm-grid">
      <div class="dm-card p1 wide"><h4>Where TVR is going <em>actual + forecast</em></h4>
        <svg viewBox="0 0 430 190"><rect x="240" y="0" width="190" height="190" class="zone"/><text x="246" y="186" class="fct">FORECAST: estimated, not recorded</text>
          <path d="${BAND}" class="band"/><path d="${CHART_ACTUAL}" class="line actual"/><path d="${CHART_FC}" class="line fc"/>
          <g class="tag t3"><circle cx="410" cy="14" r="4"/><text x="402" y="10" text-anchor="end">High case</text></g><g class="tag t2"><circle cx="410" cy="48" r="4"/><text x="402" y="44" text-anchor="end">Most likely</text></g><g class="tag t1"><circle cx="410" cy="96" r="4"/><text x="402" y="116" text-anchor="end">Safe floor</text></g></svg></div>
      <div class="dm-card p2"><h4>Channel audience share <em>now vs next</em></h4>${bars([['Derana', 42, 46, '+0.8', 1], ['Sirasa', 38, 35, '-0.6', 0], ['Hiru', 22, 24, '+0.3', 1], ['Swarnavahini', 14, 12, '-0.2', 0]])}</div>
      <div class="dm-card p3"><h4>Best channel and daypart <em>expected TVR</em></h4><div class="dm-heat">${heat([.2, .35, .5, .9, .3, .4, .75, .95, .15, .3, .45, .6, .1, .2, .4, .5])}</div><div class="dm-axes"><span>Morning</span><span>Afternoon</span><span>Early prime</span><span>Prime</span></div></div>
    </div>
    <div class="dm-chips"><span style="--d:3s">${ic('M3 17l5-6 4 4 8-10')} Safe minimum you can guarantee</span><span style="--d:8s">${ic('M4 20V10M10 20V4M16 20v-7')} Who gains audience share</span><span style="--d:13s">${ic('M3 3h7v7H3zM14 3h7v7h-7z')} Where to buy</span></div></div>`;

  const marketDemo = () => `<div class="demo">
    <div class="dm-kpis">${tile('Predicted competitor spend', 1.5, 1, 'LKR ', 'B')}${tile('Cheapest rating point', 34.1, 1, 'LKR ', 'K')}${tile('Predicted spot volume', 13536, 0)}</div>
    <div class="dm-grid">
      <div class="dm-card p1 wide"><h4>What competitors will do next <em>spend per advertiser</em></h4>
        <svg viewBox="0 0 430 190"><rect x="240" y="0" width="190" height="190" class="zone"/><text x="246" y="186" class="fct">FORECAST: estimated, not recorded</text>
          <path d="M10 120 C50 100 80 130 120 110 S190 90 240 100" class="line l1"/><path d="M10 140 C50 135 90 120 130 135 S200 140 240 128" class="line l2"/><path d="M10 100 C40 90 90 105 140 90 S200 70 240 82" class="line l3"/>
          <path d="M240 100 C270 90 290 40 320 52 S380 90 420 80" class="line fc l1d"/><path d="M240 128 C280 126 310 120 350 124 S400 118 420 120" class="line fc l2d"/><path d="M240 82 C280 80 300 84 340 78 S400 72 420 70" class="line fc l3d"/>
          <g class="burst"><path d="M320 40 l9 -16 l9 16 z"/><text x="262" y="20">Predicted burst +60%</text></g></svg></div>
      <div class="dm-card p2"><h4>Where money is moving <em>channel mix</em></h4>${bars([['Shakthi', 18, 24, '+0.6', 1], ['ITN', 12, 16, '+1.1', 1], ['Hiru', 25, 20, '-0.9', 0], ['Derana', 22, 21, '-0.4', 0]])}</div>
      <div class="dm-card p3"><h4>Cheapest rating points <em>optimal buying zone</em></h4><svg viewBox="0 0 260 150" class="bub"><rect x="130" y="70" width="120" height="70" class="zn"/><text x="138" y="132" class="znt">OPTIMAL BUYING ZONE</text><circle cx="60" cy="40" r="14" class="b1"/><circle cx="190" cy="108" r="17" class="b2"/><circle cx="105" cy="95" r="10" class="b3"/></svg></div>
    </div>
    <div class="dm-chips"><span style="--d:3s">${ic('M3 17l5-6 4 4 8-10')} Rival spend and campaign bursts</span><span style="--d:8s">${ic('M4 6h16M4 12h10M4 18h6')} Channels getting crowded</span><span style="--d:13s">${ic('M12 2l2.4 6.9H22l-6 4.5 2.3 7.1L12 16l-6.3 4.5L8 13.4 2 8.9h7.6z')} The best-value airtime</span></div></div>`;

  const SCENES = [
    { id: 'welcome', ms: 9000, tag: 'Welcome', title: 'See tomorrow’s TV <span class="grad-text">before it happens</span>',
      text: 'Media Radar turns your ratings and ad monitoring sheets into clear predictions: which audiences will grow, what your competitors will do next, and where the best-value airtime will be. This short film shows you how it works.',
      art: () => `<div class="ar-radar"><svg viewBox="0 0 320 320"><circle cx="160" cy="160" r="150" class="ring"/><circle cx="160" cy="160" r="110" class="ring"/><circle cx="160" cy="160" r="70" class="ring"/><circle cx="160" cy="160" r="30" class="ring"/>
        <g class="sweep"><path d="M160 160 L310 160 A150 150 0 0 0 266 54 Z" fill="url(#iv-sw)"/></g><defs><linearGradient id="iv-sw" x1="0" x2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity="0"/><stop offset="1" stop-color="var(--accent)" stop-opacity=".6"/></linearGradient></defs>
        <circle cx="230" cy="100" r="6" class="blip"/><circle cx="96" cy="210" r="5" class="blip b2"/><circle cx="200" cy="236" r="5" class="blip b3"/><circle cx="110" cy="92" r="4" class="blip b4"/></svg></div>` },
    { id: 'private', ms: 11000, tag: 'Step 1 · Your data', title: 'Upload once. Your raw sheets <span class="grad-text">stay in your browser</span>',
      text: 'Drop your TVR sheet or your LMRB ad monitoring sheet into the page. Files of 500 MB or more are fine. They are read and stored inside your own browser, so the big file never travels over the internet. Only compact daily totals are sent, to make the forecast and to add to the agency history vault, so later forecasts can use more history.',
      art: () => `<div class="ar-flow"><div class="fl-file"><svg viewBox="0 0 24 24"><path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h8M9 17h8"/></svg><b>Your sheet</b><small>500 MB</small></div>
        <div class="fl-arrow"><i></i><i></i><i></i></div><div class="fl-vault"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="12" cy="12" r="3.5"/><path d="M12 8.5V12l2 1.5"/></svg><b>Your browser</b><small>stored here only</small></div>
        <div class="fl-arrow thin"><i></i></div><div class="fl-cloud"><svg viewBox="0 0 24 24"><path d="M7 18a4 4 0 010-8 5 5 0 019.6-1A4.5 4.5 0 0117 18z"/></svg><b>Forecast engine</b><small>a few KB of numbers</small></div></div>` },
    { id: 'cards', ms: 9000, tag: 'Step 2 · Pick a card', title: 'Two prediction cards, <span class="grad-text">one for each question</span>',
      text: 'Choose TVR Audience Behaviour Prediction to see how audiences will move. Choose Market Prediction to see what competitors will spend and where the airtime is cheapest. Each card has its own sheet, filters and charts.',
      art: () => `<div class="ar-cards"><div class="mc c1">${ic('M2 12a10 10 0 0120 0M6 12a6 6 0 0112 0M12 12l5-5')}<b>TVR Audience<br>Behaviour Prediction</b><small>Where the audience is going</small></div>
        <div class="mc c2">${ic('M3 20h18M5 16l4-5 4 3 6-8M15 6h4v4')}<b>Market<br>Prediction</b><small>What competitors will do next</small></div></div>` },
    { id: 'read', ms: 12000, tag: 'Step 3 · Read a forecast', title: 'Real numbers and <span class="grad-text">forecast numbers</span> look different',
      text: 'A solid line is what really happened. A dashed line, a hatched area and anything marked FORECAST is an estimate of the future. Nothing is invented: every forecast comes from your own history, and every forecast shows how wrong it could be.',
      art: () => `<div class="ar-chart"><svg viewBox="0 0 430 190"><rect x="240" y="0" width="190" height="190" class="zone"/><text x="250" y="16" class="fct">FORECAST: estimated, not recorded</text>
        <path d="${CHART_ACTUAL}" class="line actual"/><path d="${CHART_FC}" class="line fc"/><text x="14" y="180" class="lbl">Solid line = what happened</text><text x="244" y="180" class="lbl f">Dashed = what is likely next</text></svg></div>` },
    { id: 'range', ms: 15000, tag: 'Step 3 · Read a forecast', title: 'Every forecast comes with a <span class="grad-text">low, likely and high</span> case',
      text: 'No one can know the future exactly, so you always get three numbers. The most likely number is the best single guess. The low case is a safe floor: the real result should be at least this high about 9 times in 10, so use it for guarantees. The high case is the upside: the real result should be at or below it about 9 times in 10.',
      art: () => `<div class="ar-chart"><svg viewBox="0 0 430 190"><rect x="240" y="0" width="190" height="190" class="zone"/>
        <path d="${BAND}" class="band"/><path d="${CHART_ACTUAL}" class="line actual still"/><path d="${CHART_FC}" class="line fc still"/>
        <g class="tag t3"><circle cx="410" cy="14" r="4"/><text x="404" y="10" text-anchor="end">High case</text></g><g class="tag t2"><circle cx="410" cy="48" r="4"/><text x="404" y="44" text-anchor="end">Most likely</text></g><g class="tag t1"><circle cx="410" cy="96" r="4"/><text x="404" y="112" text-anchor="end">Low case (safe floor)</text></g></svg></div>`,
      note: 'In reports and tables you may also see these written as P90, P50 and P10. They mean the same thing: high case, most likely, low case.' },
    { id: 'tvr', ms: 22000, demo: true, tag: 'TVR card', title: 'TVR card: <span class="grad-text">where the audience is going</span>',
      list: [['Projected TVR and a safe minimum you can guarantee', 'M2 12a10 10 0 0120 0M6 12a6 6 0 0112 0M12 12l5-5'], ['Which channels will gain or lose audience share', 'M4 20V10M10 20V4M16 20v-7'], ['The best channel and daypart combinations to buy', 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z'], ['Growing genres and safe-bet programmes', 'M12 3a9 9 0 109 9h-9z']], art: tvrDemo },
    { id: 'market', ms: 22000, demo: true, tag: 'Market card', title: 'Market card: <span class="grad-text">what competitors will do next</span>',
      list: [['How much rivals will spend, and when they will burst', 'M3 17l5-6 4 4 8-10'], ['Which channels competitors are moving money to', 'M4 6h16M4 12h10M4 18h6'], ['Your share of voice and share of audience', 'M12 3a9 9 0 109 9h-9z'], ['Cluttered breaks, and the cheapest rating points', 'M12 2l2.4 6.9H22l-6 4.5 2.3 7.1L12 16l-6.3 4.5L8 13.4 2 8.9h7.6z']], art: marketDemo },
    { id: 'when', ms: 12000, tag: 'How far ahead', title: 'Look <span class="grad-text">months ahead</span>, or days for quick plans',
      text: 'Use Months for budgets and strategy: 3, 6 or 12 months ahead. This is the clearest picture. Use Days for the next few weeks. For monthly forecasts the system needs at least 12 months of history in your sheet, and 24 months or more is best, because it learns your seasons such as Avurudu, Vesak and December.',
      art: () => `<div class="ar-months">${['3', '6', '12'].map((m, i) => `<div class="mo m${i}"><b>${m}</b><small>months</small></div>`).join('')}<div class="mo-days"><b>1&ndash;60</b><small>days</small></div></div>` },
    { id: 'check', ms: 14000, tag: 'Check everything', title: 'You can always <span class="grad-text">see why</span> a number is what it is',
      list: [['The <b>?</b> icon on every chart explains how it is predicted and what you get from it', 'M9 9a3 3 0 115 2c-1 .8-2 1.2-2 3M12 17h.01'], ['The Planner’s Evidence box under a chart says it in plain words and ends with a recommendation', 'M9 11l3 3 8-8M20 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11'], ['The <b>Numbers</b> button shows the exact figures, how accurate the engine was on recent months, and a CSV download', 'M4 6h16M4 12h16M4 18h16'], ['Purple <b>FORECAST</b> badges mark every number that has not happened yet', 'M12 8v5M12 16h.01M3 12a9 9 0 1018 0 9 9 0 10-18 0']] },
    { id: 'go', ms: 0, tag: 'You are ready', title: 'Pick a card and <span class="grad-text">start predicting</span>',
      text: 'Upload your sheet once, choose how far ahead you want to look, and open a chart. You can replay this film at any time with the Watch intro button.',
      art: () => `<div class="ar-go"><div class="pulse-ring"></div><div class="pulse-ring r2"></div><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></div>` },
  ];

  let el = null, idx = 0, timer = null, paused = false, started = 0, remaining = 0, uid = 'x', counters = [];
  const key = () => 'intro:skip:' + uid;
  const skipped = () => { try { return localStorage.getItem(key()) === '1'; } catch (e) { return false; } };

  function sceneHtml(s) {
    const body = s.list ? `<ul class="iv-list">${s.list.map(([t, d], i) => `<li style="--i:${i}"><span class="li-ic"><svg viewBox="0 0 24 24"><path d="${d}"/></svg></span><span>${t.includes('<') ? t : esc(t)}</span></li>`).join('')}</ul>`
      : `<p class="iv-text">${esc(s.text)}</p>${s.note ? `<p class="iv-note">${esc(s.note)}</p>` : ''}`;
    return `<section class="iv-scene ${s.demo ? 'demo-scene' : ''}" data-id="${s.id}" aria-hidden="true"><div class="iv-copy"><div class="iv-tag">${esc(s.tag)}</div><h2>${s.title}</h2>${body}</div>${s.art ? `<div class="iv-art">${s.art()}</div>` : ''}</section>`;
  }
  function countUp(scene) {
    counters.forEach(cancelAnimationFrame); counters = [];
    scene.querySelectorAll('[data-count]').forEach((n) => {
      const to = +n.dataset.count, dec = +n.dataset.dec, pre = n.dataset.pre || '', suf = n.dataset.suf || '', t0 = performance.now(), dur = 1800;
      const fmt = (v) => pre + v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + suf;
      const step = (t) => { const k = Math.min(1, (t - t0 - 600) / dur), e = k <= 0 ? 0 : 1 - Math.pow(1 - k, 3); n.textContent = fmt(to * e); if (k < 1) counters.push(requestAnimationFrame(step)); };
      counters.push(requestAnimationFrame(step));
    });
  }
  function show(i) {
    idx = Math.max(0, Math.min(SCENES.length - 1, i));
    el.querySelectorAll('.iv-scene').forEach((n, k) => { const on = k === idx; if (on) { n.classList.remove('on'); void n.offsetWidth; } n.classList.toggle('on', on); n.setAttribute('aria-hidden', String(!on)); });
    el.querySelectorAll('.iv-dot').forEach((d, k) => { d.classList.toggle('on', k === idx); d.classList.toggle('done', k < idx); });
    const last = idx === SCENES.length - 1;
    el.querySelector('#iv-prev').hidden = idx === 0;
    const nx = el.querySelector('#iv-next'); nx.querySelector('.lbl').textContent = last ? 'Start predicting' : 'Next';
    nx.style.setProperty('--ms', SCENES[idx].ms + 'ms'); nx.classList.toggle('timed', !last && SCENES[idx].ms > 0);
    nx.classList.remove('run'); void nx.offsetWidth; nx.classList.add('run');
    el.querySelector('.iv-count').textContent = `${idx + 1} / ${SCENES.length}`;
    countUp(el.querySelectorAll('.iv-scene')[idx]);
    remaining = SCENES[idx].ms; schedule();
  }
  function schedule() {
    clearTimeout(timer);
    if (paused || !remaining || idx >= SCENES.length - 1) return;
    started = performance.now();
    timer = setTimeout(() => { if (el && !paused) show(idx + 1); }, remaining);
  }
  function togglePause() {
    paused = !paused; el.classList.toggle('paused', paused);
    if (paused) { clearTimeout(timer); remaining = Math.max(0, remaining - (performance.now() - started)); } else schedule();
  }
  function goFull() { try { if (el && !document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().catch(() => {}); } catch (e) { /* needs a user click */ } }
  function close() {
    if (!el) return;
    clearTimeout(timer); counters.forEach(cancelAnimationFrame);
    if (el.querySelector('#iv-skip').checked) { try { localStorage.setItem(key(), '1'); } catch (e) { /* ignore */ } }
    document.removeEventListener('keydown', onKey, true); document.body.classList.remove('intro-open');
    try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) { /* ignore */ }
    const n = el; el = null; n.classList.remove('in'); setTimeout(() => n.remove(), 260);
  }
  function onKey(e) {
    if (!el) return;
    if (e.key === 'Escape') { close(); e.stopPropagation(); }
    else if (e.key === 'ArrowRight') { goFull(); show(idx + 1); } else if (e.key === 'ArrowLeft') show(idx - 1);
    else if (e.key === ' ' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON') { e.preventDefault(); togglePause(); }
  }
  function open(force) {
    if (el) return;
    try { uid = (App.shell.me && App.shell.me.user.id) || 'x'; } catch (e) { uid = 'x'; }
    if (!force && skipped()) return;
    idx = 0; paused = false;
    el = document.createElement('div'); el.className = 'iv'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Introduction to Media Radar');
    el.innerHTML = `<div class="iv-bg" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="iv-top"><div class="iv-brand"><span class="brand-mark"><svg class="ico" viewBox="0 0 24 24"><path d="M3 17l5-6 4 4 8-10"/><path d="M15 5h5v5"/></svg></span>Media Radar</div><div class="iv-count"></div>
        <div class="iv-right"><label class="iv-chk"><input type="checkbox" id="iv-skip"> Don’t show this again</label><button class="btn sm" id="iv-close" type="button">Skip intro</button></div></div>
      <div class="iv-stage">${SCENES.map(sceneHtml).join('')}</div>
      <div class="iv-dots" role="tablist" aria-label="Scenes">${SCENES.map((s, i) => `<button class="iv-dot" type="button" data-i="${i}" aria-label="Scene ${i + 1}: ${esc(s.id)}"></button>`).join('')}</div>
      <button class="iv-nav iv-prev" id="iv-prev" type="button"><span aria-hidden="true">&larr;</span> Back</button>
      <button class="iv-nav iv-next" id="iv-next" type="button"><span class="lbl">Next</span> <span aria-hidden="true">&rarr;</span></button>`;
    document.body.appendChild(el); document.body.classList.add('intro-open');
    requestAnimationFrame(() => el && el.classList.add('in'));
    el.querySelector('#iv-close').onclick = close;
    el.querySelector('#iv-prev').onclick = () => { goFull(); show(idx - 1); };
    el.querySelector('#iv-next').onclick = () => { goFull(); if (idx >= SCENES.length - 1) close(); else show(idx + 1); };
    el.querySelectorAll('.iv-dot').forEach((d) => { d.onclick = () => { goFull(); show(+d.dataset.i); }; });
    el.addEventListener('click', goFull, { once: true });
    document.addEventListener('keydown', onKey, true);
    goFull(); show(0); el.querySelector('#iv-next').focus();
  }
  App.intro = { open, skipped, scenes: SCENES.length };
})(window.App);
