/* Animated intro film: how Media Radar works, what you can find, and how to read a forecast.
 * Plays after sign-in until the planner ticks "Don't show again"; replay any time from "Watch intro".
 * No time limit: scenes advance with Next (or on a timer you can pause); arrows and Esc work.
 */
(function (App) {
  const { esc } = App;
  const CHART_ACTUAL = 'M10 150 C40 130 60 160 90 120 S140 90 170 105 S215 70 240 80';
  const CHART_FC = 'M240 80 C262 70 280 92 300 78 S338 50 360 62 S390 40 410 48';
  const BAND = 'M240 80 C262 56 280 70 300 52 S338 22 360 32 S390 6 410 14 L410 96 C390 92 370 100 360 100 S300 112 300 112 S262 108 240 80 Z';

  const SCENES = [
    { id: 'welcome', tag: 'Welcome', title: 'See tomorrow’s TV <span class="grad-text">before it happens</span>',
      text: 'Media Radar turns your ratings and ad monitoring sheets into clear predictions: which audiences will grow, what your competitors will do next, and where the best-value airtime will be. This short film shows you how it works. Take as long as you like.',
      art: () => `<div class="ar-radar"><svg viewBox="0 0 320 320"><circle cx="160" cy="160" r="150" class="ring"/><circle cx="160" cy="160" r="110" class="ring"/><circle cx="160" cy="160" r="70" class="ring"/><circle cx="160" cy="160" r="30" class="ring"/>
        <g class="sweep"><path d="M160 160 L310 160 A150 150 0 0 0 266 54 Z" fill="url(#iv-sw)"/></g><defs><linearGradient id="iv-sw" x1="0" x2="1"><stop offset="0" stop-color="#3de0ff" stop-opacity="0"/><stop offset="1" stop-color="#3de0ff" stop-opacity=".6"/></linearGradient></defs>
        <circle cx="230" cy="100" r="6" fill="#3de0ff" class="blip"/><circle cx="96" cy="210" r="5" fill="#ff4fd8" class="blip b2"/><circle cx="200" cy="236" r="5" fill="#8b5cf6" class="blip b3"/><circle cx="110" cy="92" r="4" fill="#22f5a6" class="blip b4"/></svg></div>` },
    { id: 'private', tag: 'Step 1 · Your data', title: 'Upload once. Your sheets <span class="grad-text">stay in your browser</span>',
      text: 'Drop your TVR sheet or your LMRB ad monitoring sheet into the page. Files of 500 MB or more are fine. They are read and stored inside your own browser, so the big file never travels over the internet. Only a few kilobytes of summary numbers are sent to make the forecast.',
      art: () => `<div class="ar-flow"><div class="fl-file"><svg viewBox="0 0 24 24"><path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h8M9 17h8"/></svg><b>Your sheet</b><small>500 MB</small></div>
        <div class="fl-arrow"><i></i><i></i><i></i></div><div class="fl-vault"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="12" cy="12" r="3.5"/><path d="M12 8.5V12l2 1.5"/></svg><b>Your browser</b><small>stored here only</small></div>
        <div class="fl-arrow thin"><i></i></div><div class="fl-cloud"><svg viewBox="0 0 24 24"><path d="M7 18a4 4 0 010-8 5 5 0 019.6-1A4.5 4.5 0 0117 18z"/></svg><b>Forecast engine</b><small>a few KB of numbers</small></div></div>` },
    { id: 'cards', tag: 'Step 2 · Pick a card', title: 'Two prediction cards, <span class="grad-text">one for each question</span>',
      text: 'Choose TVR Audience Behaviour Prediction to see how audiences will move. Choose Market Prediction to see what competitors will spend and where the airtime is cheapest. Each card has its own sheet, filters and charts.',
      art: () => `<div class="ar-cards"><div class="mc c1"><svg viewBox="0 0 24 24"><path d="M2 12a10 10 0 0120 0"/><path d="M6 12a6 6 0 0112 0"/><path d="M12 12l5-5"/><circle cx="12" cy="12" r="1.6"/></svg><b>TVR Audience<br>Behaviour Prediction</b><small>Which audiences will grow</small></div>
        <div class="mc c2"><svg viewBox="0 0 24 24"><path d="M3 20h18"/><path d="M5 16l4-5 4 3 6-8"/><path d="M15 6h4v4"/></svg><b>Market<br>Prediction</b><small>What competitors will do</small></div></div>` },
    { id: 'read', tag: 'Step 3 · Read a forecast', title: 'Real numbers and <span class="grad-text">forecast numbers</span> look different',
      text: 'A solid line is what really happened. A dashed line, a hatched area and anything marked FORECAST is an estimate of the future. Nothing is invented: every forecast comes from your own history, and every forecast shows how wrong it could be.',
      art: () => `<div class="ar-chart"><svg viewBox="0 0 430 190"><rect x="240" y="0" width="190" height="190" class="zone"/><text x="250" y="16" class="fct">FORECAST: estimated, not recorded</text>
        <path d="${CHART_ACTUAL}" class="line actual"/><path d="${CHART_FC}" class="line fc"/><text x="14" y="180" class="lbl">Solid line = what happened</text><text x="244" y="180" class="lbl f">Dashed = what is likely next</text></svg></div>` },
    { id: 'range', tag: 'Step 3 · Read a forecast', title: 'Every forecast comes with a <span class="grad-text">low, likely and high</span> case',
      text: 'No one can know the future exactly, so you always get three numbers. The most likely number is the best single guess. The low case is a safe floor: the real result should be at least this high about 9 times in 10, so use it for guarantees. The high case is the upside: the real result should be at or below it about 9 times in 10.',
      art: () => `<div class="ar-chart"><svg viewBox="0 0 430 190"><rect x="240" y="0" width="190" height="190" class="zone"/>
        <path d="${BAND}" class="band"/><path d="${CHART_ACTUAL}" class="line actual still"/><path d="${CHART_FC}" class="line fc still"/>
        <g class="tag t3"><circle cx="410" cy="14" r="4"/><text x="404" y="10" text-anchor="end">High case</text></g><g class="tag t2"><circle cx="410" cy="48" r="4"/><text x="404" y="44" text-anchor="end">Most likely</text></g><g class="tag t1"><circle cx="410" cy="96" r="4"/><text x="404" y="112" text-anchor="end">Low case (safe floor)</text></g></svg></div>`,
      note: 'In reports and tables you may also see these written as P90, P50 and P10. They mean the same thing: high case, most likely, low case.' },
    { id: 'tvr', tag: 'What you can find', title: 'TVR card: <span class="grad-text">where the audience is going</span>',
      list: [['Projected average TVR and the safe minimum you can guarantee', 'M2 12a10 10 0 0120 0M6 12a6 6 0 0112 0M12 12l5-5'], ['Which channels will gain or lose audience share', 'M4 20V10M10 20V4M16 20v-7M22 20H2'], ['The best channel and daypart combinations to buy', 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z'], ['Which genres are growing, and which programmes are a safe bet', 'M12 3a9 9 0 109 9h-9z'], ['Reach per airing and how many rating points your spots will deliver', 'M3 12h4l2-6 4 12 2-6h6']] },
    { id: 'market', tag: 'What you can find', title: 'Market card: <span class="grad-text">what competitors will do next</span>',
      list: [['How much your rivals are likely to spend, and when they will burst', 'M3 17l5-6 4 4 8-10'], ['Which channels competitors are moving money to', 'M4 6h16M4 12h10M4 18h6'], ['Your share of voice and share of audience, now and next', 'M12 3a9 9 0 109 9h-9z'], ['Which breaks are getting cluttered, and where to ask for first position', 'M5 6h14M5 12h14M5 18h14'], ['The cheapest rating points to buy (the Optimal Buying Zone)', 'M12 2l2.4 6.9H22l-6 4.5 2.3 7.1L12 16l-6.3 4.5L8 13.4 2 8.9h7.6z']] },
    { id: 'when', tag: 'How far ahead', title: 'Look <span class="grad-text">months ahead</span>, or days for quick plans',
      text: 'Use Months for budgets and strategy: 3, 6 or 12 months ahead. This is the clearest picture. Use Days for the next few weeks. For monthly forecasts the system needs at least 12 months of history in your sheet, and 24 months or more is best, because it learns your seasons such as Avurudu, Vesak and December.',
      art: () => `<div class="ar-months">${['3', '6', '12'].map((m, i) => `<div class="mo m${i}"><b>${m}</b><small>months</small></div>`).join('')}<div class="mo-days"><b>1&ndash;60</b><small>days</small></div></div>` },
    { id: 'check', tag: 'Check everything', title: 'You can always <span class="grad-text">see why</span> a number is what it is',
      list: [['The <b>?</b> icon on every chart explains how it is predicted and what you get from it', 'M9 9a3 3 0 115 2c-1 .8-2 1.2-2 3M12 17h.01'], ['The Planner’s Evidence box under a chart says it in plain words and ends with a recommendation', 'M9 11l3 3 8-8M20 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11'], ['The <b>Numbers</b> button shows the exact figures, how accurate the engine was on recent months, and a CSV download', 'M4 6h16M4 12h16M4 18h16'], ['Purple <b>FORECAST</b> badges mark every number that has not happened yet', 'M12 8v5M12 16h.01M3 12a9 9 0 1018 0 9 9 0 10-18 0']] },
    { id: 'go', tag: 'You are ready', title: 'Pick a card and <span class="grad-text">start predicting</span>',
      text: 'Upload your sheet once, choose how far ahead you want to look, and open a chart. You can replay this film at any time with the Watch intro button.',
      art: () => `<div class="ar-go"><div class="pulse-ring"></div><div class="pulse-ring r2"></div><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></div>` },
  ];

  let el = null, idx = 0, timer = null, auto = true, uid = 'x';
  const key = () => 'intro:skip:' + uid;
  const skipped = () => { try { return localStorage.getItem(key()) === '1'; } catch (e) { return false; } };

  function sceneHtml(s) {
    const body = s.list ? `<ul class="iv-list">${s.list.map(([t, d], i) => `<li style="--i:${i}"><span class="li-ic"><svg viewBox="0 0 24 24"><path d="${d}"/></svg></span><span>${t.includes('<') ? t : esc(t)}</span></li>`).join('')}</ul>`
      : `<p class="iv-text">${esc(s.text)}</p>${s.note ? `<p class="iv-note">${esc(s.note)}</p>` : ''}`;
    return `<section class="iv-scene" data-id="${s.id}" aria-hidden="true"><div class="iv-copy"><div class="iv-tag">${esc(s.tag)}</div><h2>${s.title}</h2>${body}</div>${s.art ? `<div class="iv-art">${s.art()}</div>` : ''}</section>`;
  }
  function show(i) {
    idx = Math.max(0, Math.min(SCENES.length - 1, i));
    el.querySelectorAll('.iv-scene').forEach((n, k) => { const on = k === idx; if (on) { n.classList.remove('on'); void n.offsetWidth; } n.classList.toggle('on', on); n.setAttribute('aria-hidden', String(!on)); });
    el.querySelectorAll('.iv-dot').forEach((d, k) => { d.classList.toggle('on', k === idx); d.classList.toggle('done', k < idx); });
    el.querySelector('#iv-prev').disabled = idx === 0;
    const last = idx === SCENES.length - 1;
    el.querySelector('#iv-next').innerHTML = last ? 'Start predicting' : 'Next <span aria-hidden="true">&rarr;</span>';
    el.querySelector('.iv-count').textContent = `${idx + 1} of ${SCENES.length}`;
    schedule();
  }
  function schedule() {
    clearTimeout(timer);
    if (!auto || idx >= SCENES.length - 1) return;
    const words = (SCENES[idx].text || (SCENES[idx].list || []).map((x) => x[0]).join(' ')).split(/\s+/).length;
    timer = setTimeout(() => { if (auto && el) show(idx + 1); }, Math.max(9000, words * 450));   // slow enough to read; pause any time
  }
  function setAuto(on) {
    auto = on; const b = el.querySelector('#iv-auto');
    b.setAttribute('aria-pressed', String(on)); b.innerHTML = on ? '<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg> Pause' : '<svg viewBox="0 0 24 24"><path d="M7 5l12 7-12 7z"/></svg> Auto-play';
    el.classList.toggle('paused', !on); schedule();
  }
  function close() {
    if (!el) return;
    clearTimeout(timer);
    if (el.querySelector('#iv-skip').checked) { try { localStorage.setItem(key(), '1'); } catch (e) { /* ignore */ } }
    document.removeEventListener('keydown', onKey); document.body.classList.remove('intro-open');
    const n = el; el = null; n.classList.remove('in'); setTimeout(() => n.remove(), 260);
  }
  function onKey(e) {
    if (!el) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') { setAuto(false); show(idx + 1); } else if (e.key === 'ArrowLeft') { setAuto(false); show(idx - 1); }
  }
  function open(force) {
    if (el) return;
    try { uid = (App.shell.me && App.shell.me.user.id) || 'x'; } catch (e) { uid = 'x'; }
    if (!force && skipped()) return;
    idx = 0; auto = true;
    el = document.createElement('div'); el.className = 'iv'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Introduction to Media Radar');
    el.innerHTML = `<div class="iv-bg" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="iv-top"><div class="iv-brand"><span class="brand-mark"><svg class="ico" viewBox="0 0 24 24"><path d="M3 17l5-6 4 4 8-10"/><path d="M15 5h5v5"/></svg></span>Media Radar</div><div class="iv-count"></div><button class="btn sm ghost" id="iv-close" type="button">Skip intro</button></div>
      <div class="iv-stage">${SCENES.map(sceneHtml).join('')}</div>
      <div class="iv-bar"><div class="iv-dots" role="tablist" aria-label="Scenes">${SCENES.map((s, i) => `<button class="iv-dot" type="button" data-i="${i}" aria-label="Scene ${i + 1}: ${esc(s.id)}"></button>`).join('')}</div>
        <div class="iv-ctl"><label class="iv-chk"><input type="checkbox" id="iv-skip"> Don’t show this again</label><button class="btn sm" id="iv-auto" type="button" aria-pressed="true"></button><button class="btn" id="iv-prev" type="button">&larr; Back</button><button class="btn primary" id="iv-next" type="button"></button></div></div>`;
    document.body.appendChild(el); document.body.classList.add('intro-open');
    requestAnimationFrame(() => el && el.classList.add('in'));
    el.querySelector('#iv-close').onclick = close;
    el.querySelector('#iv-prev').onclick = () => { setAuto(false); show(idx - 1); };
    el.querySelector('#iv-next').onclick = () => { if (idx >= SCENES.length - 1) close(); else { setAuto(false); show(idx + 1); } };
    el.querySelector('#iv-auto').onclick = () => setAuto(!auto);
    el.querySelectorAll('.iv-dot').forEach((d) => { d.onclick = () => { setAuto(false); show(+d.dataset.i); }; });
    el.addEventListener('mouseenter', () => clearTimeout(timer)); el.addEventListener('mouseleave', schedule);
    document.addEventListener('keydown', onKey);
    setAuto(true); show(0); el.querySelector('#iv-next').focus();
  }
  App.intro = { open, skipped, scenes: SCENES.length };
})(window.App);
