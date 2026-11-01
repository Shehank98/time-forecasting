/* Prediction tabs: TVR & Audience Forecast and Market & Competitor Forecast.
 * The worker builds compact series from the sheets stored in this browser; The forecast engine forecasts them 60 days ahead
 * in one batch on the server; the horizon control only slices the outlook, so changing it is instant.
 */
(function (App) {
  const { esc, fmt, charts: C, $ } = App;
  const MR = window.MR;
  const HMAX = 60;
  const cache = new Map();
  App.predictEvidence = App.predictEvidence || {};
  const finite = (v) => v != null && Number.isFinite(v);
  const avg = (a) => { const v = (a || []).filter(finite); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null; };
  const total = (a) => (a || []).filter(finite).reduce((x, y) => x + y, 0);
  const pct = (a, b) => (finite(a) && finite(b) && b !== 0 ? ((a - b) / Math.abs(b)) * 100 : null);
  const f2 = (v) => fmt.num(v, 2), f1 = (v) => fmt.num(v, 1);
  const signed = (v, d = 0) => (v == null ? 'n/a' : `${v > 0 ? '+' : ''}${Number(v).toFixed(d)}%`);
  const short = (s, n = 34) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));
  const relCls = { High: 'good', Medium: 'warn', Low: 'bad' };
  let HIST = 56;   // history points drawn before the forecast (days or months)
  /** Month-view wording: swaps the day-based phrases used in titles, help and evidence. */
  const W = (M) => (t) => (M && typeof t === 'string' ? t.replace(/([Ll])ast 4 weeks/g, '$1ast 3 months').replace(/7-day average/g, '3-month average').replace(/\(per day\)/g, '(per month)').replace(/spots a day in/g, 'spots a month in')
    .replace(/9 in 10 days/g, '9 in 10 months').replace(/forecast day for/g, 'forecast month for').replace(/each forecast day/g, 'each forecast month').replace(/daily/gi, (m) => (m[0] === 'D' ? 'Monthly' : 'monthly')).replace(/weekly/g, 'monthly') : t);
  /** Notes about how much history a monthly forecast has. */
  function monthNote(pc) {
    const m = pc.months_of_history || 0;
    if (m < 12) return `<div class="banner bad"><span><b>Only about ${m} month${m === 1 ? '' : 's'} of history.</b> Monthly forecasts need at least 12 months (24 or more is best) to learn seasonality, so treat these numbers as rough. Append older periods to the sheet, or use the Days view.</span></div>`;
    if (m < 24) return `<div class="banner"><span>About ${m} months of history. Monthly forecasts work, but with 24 months or more the seasonal pattern is much more reliable.</span></div>`;
    return '';
  }

  /* ---------------- shared runner ---------------- */
  async function forecastBatch(kind, items, gran, onProgress) {
    if (!items.length) return null;
    return App.runJob('/api/forecast/run', { kind, series: items, params: { granularity: gran, horizon_days: gran === 'weekly' ? HMAX + 6 : gran === 'monthly' ? 360 : HMAX, covariates: true, entity_type: 'prediction', metric: 'prediction' } }, onProgress);
  }
  async function getPrediction(key, build, kind, onProgress) {
    if (cache.has(key)) return cache.get(key);
    const p = (async () => {
      onProgress(0.02, 'Building series from the data in this browser');
      const payload = await build();
      const n = payload.daily.length + payload.weekly.length;
      if (!n) return { payload, results: [], res: null };
      onProgress(0.08, `Analysing ${n} series`);
      const [d, w] = await Promise.all([forecastBatch(kind, payload.daily, payload.gran || 'daily', (p2, m) => onProgress(0.08 + 0.9 * p2, m)), forecastBatch(kind, payload.weekly, 'weekly', () => {})]);
      for (const r of [d, w]) if (r && !r.ok) throw new Error(r.message || 'The forecast could not run.');
      const results = [].concat(d ? d.results : [], w ? w.results : []);
      App.shell.refreshModel();
      return { payload, results, res: d || w };
    })();
    cache.set(key, p);
    p.catch(() => cache.delete(key));
    if (cache.size > 12) cache.delete(cache.keys().next().value);
    return p;
  }
  /** Rows {name, now, next, chg} for a group of share series (values are percentages). */
  function shareRows(results, H, NOW, sorter = 'next') {
    return results.map((r) => ({ name: r.entity, now: MR.recentMean(r, NOW), next: avg(slice(r, H).p50) })).filter((x) => finite(x.next) && finite(x.now))
      .map((x) => ({ ...x, chg: x.next - x.now })).sort((a, b) => b[sorter] - a[sorter]);
  }
  /** Horizontal grouped bars: share now (grey) vs forecast (colour). The change in points is written in each label, so no hover is needed. */
  function shareBars(id, rows, { nowLabel, nextLabel, color = C.PALETTE[0], title = (n) => n, max = 10 } = {}) {
    const r = rows.slice(0, max);
    return C.make(id, { type: 'bar', data: { labels: r.map((x) => `${short(title(x.name), 30)}  (${x.chg >= 0 ? '+' : ''}${x.chg.toFixed(1)} pts)`), datasets: [
      { label: nowLabel, data: r.map((x) => x.now), backgroundColor: 'rgba(142,154,200,.45)', borderRadius: 4, barThickness: 11 },
      { label: nextLabel, data: r.map((x) => x.next), backgroundColor: r.map((x) => (x.chg >= 0 ? (C.css('--good') || '#22f5a6') + 'cc' : (C.css('--bad') || '#ff5d7a') + 'cc')), borderRadius: 4, barThickness: 11 }] },
      options: { indexAxis: 'y', plugins: { legend: { position: 'bottom', labels: { generateLabels: () => [
          { text: nowLabel, fontColor: C.css('--text'), fillStyle: 'rgba(142,154,200,.6)', strokeStyle: 'transparent', lineWidth: 0 }, { text: nextLabel + ' (green = gaining, red = losing)', fontColor: C.css('--text'), fillStyle: (C.css('--good') || '#22f5a6'), strokeStyle: 'transparent', lineWidth: 0 }] } },
          tooltip: { callbacks: { title: (it) => title(r[it[0].dataIndex].name), label: (c) => `${c.dataset.label}: ${fmt.num(c.parsed.x, 1)}%` } } },
        scales: { x: { beginAtZero: true, ticks: { callback: (v) => v + '%' } }, y: { grid: { display: false }, ticks: { font: { size: 11 } } } } } });
  }
  /** Trailing moving average, used only to draw very noisy daily lines; all numbers in text use the raw values. */
  const smooth = (a, k) => a.map((_, i) => { const w = a.slice(Math.max(0, i - k + 1), i + 1).filter(finite); return w.length ? w.reduce((x, y) => x + y, 0) / w.length : null; });

  /** Explains how to tell actual numbers from forecast numbers. Shown at the top of both prediction tabs. */
  const forecastKey = (M) => `<div class="fc-key" role="note"><div class="fc-key-t"><span class="fc-pill">Forecast</span> How to read this page <button class="btn sm ghost" type="button" data-intro style="margin-left:auto">Watch the intro film</button></div>
    <div class="fc-key-row"><span><i class="k-actual"></i>Solid line: <b>actual</b>, recorded data</span><span><i class="k-fc"></i>Dashed line: <b>forecast</b>, the most likely path</span><span><i class="k-band"></i>Shaded band: the <b>range</b> between the low case and the high case</span><span><i class="k-zone"></i>Hatched area and cards marked <b>FORECAST</b>: numbers that have not happened yet</span></div>
    <div class="fc-key-row" style="margin-top:8px"><span><b>Most likely</b>: the best single guess</span><span><b>Low case</b>: a safe floor. The real number should be at least this about 9 times in 10, so use it for guarantees</span><span><b>High case</b>: the upside. The real number should be at or below this about 9 times in 10</span></div>
    <div class="fc-key-note">Every number marked FORECAST is an estimate of the next ${M ? 'months' : 'days'} based on your own history. It is not recorded data and it can be wrong.</div></div>`;

  /** Centre-of-screen loader; returns the progress callback. Call App.loader.hide() when done. */
  function scanning(p, title) {
    p.innerHTML = '';
    App.loader.show(title, 'Preparing');
    App.loader.progress(0.03);
    return (p2, m) => App.loader.progress(Math.max(0.03, p2), m);
  }
  const group = (results, g) => results.filter((r) => r.group === g);
  const one = (results, g) => group(results, g)[0] || null;
  const slice = (r, H) => MR.sliceForecast(r, H);
  const unitFmt = (u) => ({ currency: fmt.lkrc, percent: (v) => fmt.pct(v, 1), rating: f2 }[u] || fmt.compact);
  function needData(p, sheet) {
    p.innerHTML = App.emptyState(`Load the ${sheet} to unlock this prediction`, 'Use the data sources panel above. Files are read once and stay in this browser.');
  }
  function headCard(title, sub, r, extra = '') {
    const rel = r && r.reliability;
    return `<div class="card glow" style="margin-bottom:16px"><div class="card-head" style="margin:0"><div><div class="eyebrow"><span class="fc-pill">Forecast</span> Estimates of what is likely, not recorded data</div><h2 style="margin-top:4px">${esc(title)}</h2><div class="sub">${esc(sub)}</div></div>
      <div class="row">${extra}${rel ? `<span class="badge ${relCls[rel.level]}" title="${esc(rel.reasons.join(' '))}">Reliability: ${rel.level}</span>` : ''}<button class="btn sm" type="button" data-rerun>Re-run</button></div></div></div>`;
  }
  const kpiTile = (label, value, sub, help, cls = '') => `<div class="kpi fc ${cls}"><span class="fc-pill tile">Forecast</span><div class="k-lbl">${esc(label)} ${help || ''}</div><div class="k-val">${value}</div>${sub ? `<div class="k-sub">${sub}</div>` : ''}</div>`;

  /* ---------------- chart plugins ---------------- */
  const nowLine = C.nowLine;
  const zonePlugin = { id: 'zone', beforeDatasetsDraw(chart, a, o) {
    if (!o || o.x == null || o.y == null) return;
    const { ctx, chartArea: ar, scales: { x, y } } = chart;
    const x0 = Math.max(ar.left, x.getPixelForValue(o.x)), y0 = Math.min(ar.bottom, y.getPixelForValue(o.y));
    ctx.save(); ctx.fillStyle = 'rgba(34,245,166,.09)'; ctx.strokeStyle = 'rgba(34,245,166,.55)'; ctx.setLineDash([5, 4]);
    ctx.fillRect(x0, y0, ar.right - x0, ar.bottom - y0); ctx.strokeRect(x0, y0, ar.right - x0, ar.bottom - y0);
    ctx.setLineDash([]); ctx.fillStyle = C.css('--good') || '#22f5a6'; ctx.font = '700 11px ' + (C.css('--display') || 'sans-serif'); ctx.fillText('OPTIMAL BUYING ZONE', x0 + 8, ar.bottom - 10); ctx.restore(); } };

  /** History (solid) + forecast most likely (dashed) + low case-high case ribbon. */
  function fan(id, r, H, { color = C.PALETTE[0], histDays = HIST, vf = f2, afterBody, lowLabel = 'Low case' } = {}) {
    const f = slice(r, H), hd = r.history.dates.slice(-histDays), hv = r.history.values.slice(-histDays), nh = hd.length;
    const labels = hd.concat(f.dates), pad = (a) => Array(nh - 1).fill(null).concat([hv[nh - 1]], a);
    const ch = C.make(id, { type: 'line', data: { labels, datasets: [
      { label: 'High case', data: pad(f.p90), borderColor: 'transparent', backgroundColor: color + '2e', fill: '+1', pointRadius: 0 },
      { label: lowLabel, data: pad(f.p10), borderColor: color + '88', borderWidth: 1, borderDash: [2, 3], fill: false, pointRadius: 0 },
      { label: 'Most likely forecast', data: pad(f.p50), borderColor: color, borderDash: [7, 5], borderWidth: 2.5, pointRadius: 0, tension: 0.3 },
      { label: 'Actual', data: hv.concat(Array(f.dates.length).fill(null)), borderColor: C.css('--text') || '#e8eeff', borderWidth: 2, pointRadius: 0, tension: 0.25 }] },
      options: { interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom', labels: { filter: (i) => i.text !== 'High case' } }, nowLine: { index: nh - 1 },
        tooltip: { callbacks: { title: C.fcTitle(nh), label: (c) => (c.parsed.y == null ? null : `${c.dataset.label}: ${vf(c.parsed.y)}`), afterBody: afterBody ? (items) => afterBody(items[0].dataIndex - nh) : undefined } } },
        scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } }, y: { beginAtZero: false, ticks: { callback: (v) => vf(v) } } } },
      plugins: [nowLine] });
    return { ch, f, nh };
  }

  /* ================================================================ TVR & Audience */
  async function tvrTab(p, ctx) {
    if (!ctx.has('tv')) return needData(p, 'TVR sheet');
    const filters = ctx.filtersFor('tv');
    const M = ctx.mode() === 'monthly', NM = ctx.months(), H = M ? NM * 30 : ctx.horizon();
    const key = 'tv|' + (M ? 'm' : 'd') + '|' + ctx.status.tv.sig + '|' + JSON.stringify(filters);
    const prog = cache.has(key) ? null : scanning(p, 'Forecasting audience behaviour');
    let pr;
    try { pr = await getPrediction(key, () => App.data.predictTvr({ filters, mode: M ? 'monthly' : 'daily' }), 'tv', prog || (() => {})); }
    catch (e) { p.innerHTML = App.emptyState('The TVR prediction could not run', e.message) + '<div style="text-align:center"><button class="btn" data-rerun>Try again</button></div>'; wireRerun(p, key, () => tvrTab(p, ctx)); return; }
    finally { if (prog) App.loader.hide(250); }
    if (!p.isConnected) return;
    const R = pr.results, pc = pr.payload.ctx;
    const w = W(M), SPAN = M ? `${NM} month${NM === 1 ? '' : 's'}` : `${H} days`, NOW = M ? 3 : 28, NP = M ? NM : H, NB = M ? 6 : 28, BACK = M ? 24 : 28;
    HIST = M ? 24 : 56;
    const evid = (id, items) => C.evidence(id, (items || []).map((x) => (typeof x === 'string' ? w(x) : x && x.text ? { ...x, text: w(x.text) } : x)), "Planner's Evidence (forecast)", { note: 'These figures are forecasts: estimates of what is likely, not recorded data.' });
    const tot = one(R, 'tvr_total');
    if (!tot) { p.innerHTML = App.emptyState('Not enough TVR history to forecast', (pr.payload.notes || [])[0] || 'Widen the filters.'); return; }
    const reach = one(R, 'reach_total'), cats = group(R, 'cat_share'), hours = group(R, 'hour_share'), chans = group(R, 'channel_tvr'), progs = group(R, 'program_tvr');
    const fT = slice(tot, H), recentT = MR.recentMean(tot, NOW);
    const pTVR = avg(fT.p50), gTVR = avg(fT.p10), upTVR = avg(fT.p90);
    const catRows = cats.map((r) => { const f = slice(r, H); return { name: r.entity, now: MR.recentMean(r, NOW), next: avg(f.p50) }; }).map((x) => ({ ...x, shift: finite(x.next) && finite(x.now) ? x.next - x.now : null }));
    const growing = catRows.filter((x) => finite(x.shift)).sort((a, b) => b.shift - a.shift);
    const spotsPerDay = Math.max(1, +App.store.get('spots-per-day', 5));
    const fR = reach ? slice(reach, H) : null;
    p.innerHTML = w(`${headCard('TVR & Audience Forecast', `Next ${SPAN} from ${pc.date_max}, ${fmt.num(pc.rows)} airings in scope. History ${tot.n_points} ${M ? 'months' : 'days'}.`, tot,
        `<label class="row small" title="Used for the guaranteed GRP tooltip">Spots per day <input type="number" min="1" max="200" value="${spotsPerDay}" id="spd" style="width:72px"></label>`)}
      ${forecastKey(M)}${M ? monthNote(pc) : ''}${(pr.payload.notes || []).filter((n) => !/interpolation/.test(n)).map((n) => `<div class="banner info"><span>${esc(n)}</span></div>`).join('')}
      <div class="kpis">
        ${kpiTile('Projected average TVR', f2(pTVR), `${signed(pct(pTVR, recentT), 1)} vs last 4 weeks (${f2(recentT)})`, App.help('Mean of the daily most likely forecast of the average programme TVR over the horizon.', 'The audience level to plan on for an average airing.'))}
        ${kpiTile('Guaranteed minimum TVR (low case)', f2(gTVR), `9 in 10 days should land above this. Upside high case ${f2(upTVR)}`, App.help('Mean of the daily low case estimate: the forecast engine expects actuals to fall below it only about 10% of the time.', 'A safe number for audience guarantees and GRP commitments.'))}
        ${kpiTile('Projected reach %', fR ? fmt.pct(avg(fR.p50), 1) : 'n/a', fR ? `Range ${fmt.pct(avg(fR.p10), 1)} to ${fmt.pct(avg(fR.p90), 1)}` : 'Reach % is not in the sheet', App.help('Mean of the daily most likely forecast of average Reach % per airing.', 'How much of the audience an average airing is expected to touch.'))}
        ${kpiTile('Top growing category', growing[0] ? esc(growing[0].name) : 'n/a', growing[0] ? `${growing[0].shift >= 0 ? '+' : ''}${f1(growing[0].shift)} pts of TVR share` : '', App.help('Each category\'s share of total TVR is forecast; the one gaining the most share points versus the last 4 weeks is shown.', 'Where audience attention is moving, for content and programme selection.'))}
      </div>
      <div style="margin-top:16px">${C.box('pt-fan', 'TVR fan chart: history and forecast range', 'Solid: actual daily average TVR. Dashed: forecast most likely. Band: low case to high case. Hover a forecast day for guaranteed GRPs and shortfall risk.', { xtall: true, ev: true,
        help: ['The forecast engine reads up to 1,024 days of the daily average TVR and outputs estimates for each future day, adjusted for weekday and Sri Lankan holiday and Poya day effects. Low case and high case bound the range it expects 8 days in 10.', 'A defensible audience plan: most likely for the expected delivery, low case for guarantees. The tooltip converts it to GRPs for your spots per day and shows the shortfall risk if you sell on most likely.'] })}</div>
      <div class="grid g2" style="margin-top:16px">
        ${C.box('pt-heat', M ? 'Daypart by month heatmap' : 'Daypart and day-of-week heatmap', `Forecast ${pc.heat_metric === 'share' ? 'TVR share %' : 'average TVR'} by start hour and ${M ? 'month' : 'weekday'}, next ${SPAN}`, { html: '', ev: true,
          help: [M ? 'One series per start hour is forecast month by month; each row is a forecast month and each column a start hour.' : 'One series per start hour is forecast; each forecast day is placed in its weekday column and averaged. Weekdays missing from a short horizon stay empty.', 'The strongest hour and day combinations to book, and weak belts to avoid or buy cheaply.'] })}
        ${C.box('pt-chshare', 'Channel audience share', `Each channel's share of all TVR: ${'last 4 weeks'} vs next ${SPAN}`, { tall: true, ev: true,
          help: ['Each channel\'s share of total TVR is forecast month by month (or day by day). Bars compare the forecast share with the recent share; the change in share points is written beside each channel.', 'Which stations are winning or losing audience share, so you can move weight before rate cards change.'] })}
      </div>
      <div class="grid g2" style="margin-top:16px">
        ${C.box('pt-risk', 'Programme risk map', 'Recurring programme slots: expected TVR against how wide the range is. Low and to the right is the safest bet.', { ev: true,
          help: ['Each recurring programme slot (same programme, channel, weekday and start) is forecast weekly. X is the expected TVR, Y the width of its forecast range. Low and to the right is a safe bet.', 'Separate dependable programmes for guarantees from volatile ones to buy only at a discount.'] })}
        ${C.box('pt-chdp', 'Channel by daypart: forecast TVR', `Average TVR each channel is expected to deliver in each daypart, next ${SPAN}`, { html: '', ev: true,
          help: ['Each channel and daypart pair is forecast separately and averaged over the horizon. Brighter cells mean higher expected ratings.', 'Where to buy: the strongest channel and daypart combinations, and weak spots to avoid or buy cheaply.'] })}
      </div>
      <div class="grid g2" style="margin-top:16px">
        ${C.box('pt-cat', 'Category audience share', `Each genre's share of all TVR: last 4 weeks vs next ${SPAN}`, { tall: true, ev: true,
          help: ['Each category\'s share of total TVR is forecast separately. Bars compare the forecast share with the recent share; the change in share points is written beside each category.', 'Which genres are gaining or losing audience, to steer programme and sponsorship choices.'] })}
        ${fR ? `${C.box('pt-reach', 'Reach % outlook', 'Average Reach % per airing: actual and forecast range', { ev: true, help: ['The same the forecast engine fan forecast applied to the daily average Reach %.', 'Expected breadth of audience per airing, useful for reach-led campaigns.'] })}` : ''}
      </div>`);
    wireRerun(p, key, () => tvrTab(p, ctx));
    markForecast(p, { R, H, M });
    p.querySelectorAll('[data-intro]').forEach((b) => { b.onclick = () => App.loadIntro().then(() => App.intro.open(true)); });
    const spd = $('#spd', p); spd.onchange = () => { App.store.set('spots-per-day', Math.max(1, +spd.value || 1)); tvrTab(p, ctx); };
    const ev = {};

    // 1. fan chart with guaranteed GRP tooltip
    fan('pt-fan', tot, H, { lowLabel: 'Low case (safe floor)', afterBody: (k) => {
      if (k < 0 || k >= fT.dates.length) return [];
      const g = fT.p10[k] * spotsPerDay, e = fT.p50[k] * spotsPerDay, risk = fT.p50[k] > 0 ? ((fT.p50[k] - fT.p10[k]) / fT.p50[k]) * 100 : 0;
      return ['', `Guaranteed GRPs (${spotsPerDay} spots, low case): ${f1(g)}`, `Expected GRPs (most likely): ${f1(e)}`, `Shortfall risk if sold on most likely: up to ${risk.toFixed(0)}%`];
    } });
    const riskPct = pTVR > 0 ? ((pTVR - gTVR) / pTVR) * 100 : null;
    ev.fan = [
      `Average TVR is expected at ${f2(pTVR)} over the next ${SPAN} (low-case floor ${f2(gTVR)}, high-case upside ${f2(upTVR)}), ${signed(pct(pTVR, recentT), 1)} versus the last 4 weeks.`,
      `For ${spotsPerDay} spots a day that is about ${f1(gTVR * spotsPerDay)} guaranteed GRPs a day (low case) and ${f1(pTVR * spotsPerDay)} expected (most likely).`,
      tot.reliability ? `Forecast reliability is ${tot.reliability.level}${tot.backtest && tot.backtest.model.smape != null ? `; in the last ${tot.backtest.holdout} ${M ? 'months' : 'days'} the model was off by ${f1(tot.backtest.model.smape)}% on average` : ''}.` : null,
      { rec: true, text: riskPct != null && riskPct > 30 ? `The range is wide (up to ${riskPct.toFixed(0)}% below most likely on weak days). Sell audience guarantees on the low case value, or spread spots across more programmes.` : `The range is tight. Guarantees can be set close to most likely with a small buffer (about ${(riskPct || 0).toFixed(0)}%).` },
    ];
    (tot.peaks && tot.peaks.peaks || []).slice(0, 2).forEach((pk) => { if (pk.date <= fT.dates[fT.dates.length - 1]) ev.fan.push({ rec: true, text: `Audience peak expected around ${pk.date}; have spots live by ${pk.launch_by}.` }); });
    evid('pt-fan', ev.fan);

    // 2. heatmap day x hour
    const hm = M ? MR.monthHourMatrix(hours, NM) : MR.dowHourMatrix(hours, H);
    const isShare = pc.heat_metric === 'share';
    $('#pt-heat').innerHTML = hm.cols.length ? C.heat(hm, { fmt: isShare ? (v) => fmt.num(v, 1) : f2, caption: M ? 'Forecast by month and hour' : 'Forecast by weekday and hour' }) : App.emptyState('No start times in the sheet', 'The Start column is needed for this view.');
    const cells = []; hm.values.forEach((row, i) => row.forEach((v, j) => { if (finite(v)) cells.push({ d: hm.rows[i], h: hm.cols[j], v }); }));
    cells.sort((a, b) => b.v - a.v);
    const hl = (c) => `${c.d} ${c.h}`;   // weekday or month, plus hour
    ev.heat = cells.length ? [
      `Strongest forecast slots: ${cells.slice(0, 3).map((c) => `${hl(c)} (${isShare ? fmt.num(c.v, 1) + '%' : f2(c.v)})`).join(', ')}.`,
      `Weakest: ${cells.slice(-3).reverse().map((c) => `${hl(c)} (${isShare ? fmt.num(c.v, 1) + '%' : f2(c.v)})`).join(', ')}.`,
      { rec: true, text: `Prioritise ${cells.slice(0, 2).map(hl).join(' and ')} for reach-critical spots; buy the weakest belts only for frequency at low cost.` },
      !M && H < 7 ? 'The horizon is under a week, so some weekdays are empty. Pick 7 days or more to fill the grid.' : null,
    ] : [];
    evid('pt-heat', ev.heat);

    // 3. category audience share (bars)
    {
      const rows = shareRows(cats, H, NOW);
      if (rows.length) {
        shareBars('pt-cat', rows, { nowLabel: w('Last 4 weeks'), nextLabel: `Next ${SPAN}` });
        const up = rows.slice().sort((a, b) => b.chg - a.chg), dn = up.slice().reverse();
        ev.cat = [
          up[0] && up[0].chg > 0 ? `${up[0].name} gains the most: ${fmt.num(up[0].now, 1)}% to ${fmt.num(up[0].next, 1)}% of all TVR (${signed(up[0].chg, 1).replace('%', '')} pts).` : 'No category gains share.',
          dn[0] && dn[0].chg < 0 ? `${dn[0].name} loses the most: ${fmt.num(dn[0].now, 1)}% to ${fmt.num(dn[0].next, 1)}% (${signed(dn[0].chg, 1).replace('%', '')} pts).` : null,
          { rec: true, text: up[0] && up[0].chg > 0.3 ? `Lean into ${up[0].name} programmes for the next ${SPAN}; review spend in ${dn[0] && dn[0].chg < 0 ? dn[0].name : 'declining genres'}.` : 'Genre shares are stable; keep the current genre mix.' },
        ];
      } else ev.cat = ['Not enough category history to forecast shares.'];
      evid('pt-cat', ev.cat);
    }

    // 5. programme risk map
    const pts = progs.map((r) => { const f = slice(r, H); const m = avg(f.p50); return { name: r.entity, x: m, y: m > 0 ? (avg(f.p90) - avg(f.p10)) / m * 100 : null }; }).filter((q) => finite(q.x) && finite(q.y));
    if (pts.length) {
      const mx = MR.pmedian(pts.map((q) => q.x)), my = MR.pmedian(pts.map((q) => q.y));
      C.make('pt-risk', { type: 'scatter', data: { datasets: [{ label: 'Programme slots', data: pts, pointRadius: 7, pointHoverRadius: 10,
        backgroundColor: pts.map((q) => (q.x >= mx && q.y <= my ? (C.css('--good') || '#22f5a6') : q.y > my * 1.3 ? (C.css('--bad') || '#ff5d7a') : C.PALETTE[1])) }] },
        options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => { const q = pts[c.dataIndex]; return [short(q.name, 60), `Forecast TVR ${f2(q.x)}, range width ${q.y.toFixed(0)}%`]; } } } },
          scales: { x: { title: { display: true, text: 'Expected TVR (most likely)' } }, y: { title: { display: true, text: 'How wide the range is (% of the most likely value)' }, ticks: { callback: (v) => v + '%' } } } } });
      const safe = pts.filter((q) => q.x >= mx && q.y <= my).sort((a, b) => b.x - a.x), risky = pts.filter((q) => q.y > my * 1.3).sort((a, b) => b.y - a.y);
      const nm = (q) => q.name.split(' | ').slice(0, 3).join(', ');
      ev.risk = [
        safe.length ? `Safe bets (high TVR, tight range): ${safe.slice(0, 3).map(nm).join('; ')}.` : 'No slot is both above median TVR and below median uncertainty.',
        risky.length ? `Volatile: ${risky.slice(0, 2).map(nm).join('; ')}.` : null,
        { rec: true, text: safe.length ? `Anchor guaranteed packages on ${nm(safe[0])}; buy volatile slots only with make-goods or at a discount.` : 'Keep guarantees conservative across all slots.' },
      ];
    } else ev.risk = [M ? 'Not enough recurring programme history (a slot needs several months of airings).' : 'Not enough recurring programme history (a slot needs several weeks of airings).'];
    evid('pt-risk', ev.risk);

    // 5b. channel audience share + channel x daypart heatmap
    {
      const rows = shareRows(group(R, 'channel_share'), H, NOW);
      if (rows.length) {
        shareBars('pt-chshare', rows, { nowLabel: w('Last 4 weeks'), nextLabel: `Next ${SPAN}`, title: fmt.title });
        const up = rows.slice().sort((a, b) => b.chg - a.chg), dn = up.slice().reverse(), lead = rows[0];
        ev.chshare = [
          `${fmt.title(lead.name)} is expected to hold the biggest audience share: ${fmt.num(lead.next, 1)}% of all TVR (now ${fmt.num(lead.now, 1)}%).`,
          up[0] && up[0].chg > 0.2 ? `Gaining share: ${up.filter((x) => x.chg > 0.2).slice(0, 3).map((x) => `${fmt.title(x.name)} (${signed(x.chg, 1).replace('%', '')} pts)`).join(', ')}.` : 'No channel is gaining share by more than 0.2 points.',
          dn[0] && dn[0].chg < -0.2 ? `Losing share: ${dn.filter((x) => x.chg < -0.2).slice(0, 3).map((x) => `${fmt.title(x.name)} (${signed(x.chg, 1).replace('%', '')} pts)`).join(', ')}.` : null,
          { rec: true, text: up[0] && up[0].chg > 0.2 ? `Negotiate volume on ${fmt.title(up[0].name)} now, before its rate card reflects the extra audience. Ask for make-goods on ${dn[0] && dn[0].chg < -0.2 ? fmt.title(dn[0].name) : 'weaker channels'}.` : 'Channel shares are steady; keep channel weights as they are.' },
        ];
      } else ev.chshare = ['Not enough channel history to forecast shares.'];
      evid('pt-chshare', ev.chshare);

      const cd = group(R, 'chan_daypart').map((r) => { const [ch, dp] = r.entity.split(' | '); return { ch, dp, v: avg(slice(r, H).p50), now: MR.recentMean(r, NOW) }; }).filter((x) => finite(x.v));
      if (cd.length) {
        const chs = [...new Set(cd.map((x) => x.ch))], order = MR.daypartOrder ? MR.daypartOrder() : [], dps = [...new Set(cd.map((x) => x.dp))].sort((a, b) => order.indexOf(a) - order.indexOf(b));
        const mat = { rows: chs.map(fmt.title), cols: dps, values: chs.map((c) => dps.map((d) => { const x = cd.find((q) => q.ch === c && q.dp === d); return x ? x.v : null; })) };
        $('#pt-chdp').innerHTML = C.heat(mat, { fmt: f2, caption: 'Forecast TVR by channel and daypart' });
        const sorted = cd.slice().sort((a, b) => b.v - a.v), rising = cd.filter((x) => finite(x.now) && x.now > 0).map((x) => ({ ...x, chg: pct(x.v, x.now) })).filter((x) => finite(x.chg)).sort((a, b) => b.chg - a.chg);
        ev.chdp = [
          `Strongest: ${sorted.slice(0, 3).map((x) => `${fmt.title(x.ch)} ${x.dp} (${f2(x.v)})`).join(', ')}.`,
          `Weakest: ${sorted.slice(-2).reverse().map((x) => `${fmt.title(x.ch)} ${x.dp} (${f2(x.v)})`).join(', ')}.`,
          rising[0] && rising[0].chg > 3 ? `Fastest rising: ${fmt.title(rising[0].ch)} ${rising[0].dp} (${signed(rising[0].chg, 0)} vs the last 4 weeks).` : null,
          { rec: true, text: `Book ${fmt.title(sorted[0].ch)} ${sorted[0].dp} for reach-critical spots; use ${fmt.title(sorted[sorted.length - 1].ch)} ${sorted[sorted.length - 1].dp} only for cheap frequency.` },
        ];
      } else { $('#pt-chdp').innerHTML = App.emptyState('Not enough start times', 'Channel and Start columns are needed for this view.'); ev.chdp = []; }
      evid('pt-chdp', ev.chdp);
    }

    // 6. reach
    if (fR) {
      fan('pt-reach', reach, H, { color: C.PALETTE[1], vf: (v) => fmt.pct(v, 2) });
      ev.reach = [`Average reach per airing is expected at ${fmt.pct(avg(fR.p50), 1)} (low case ${fmt.pct(avg(fR.p10), 1)}), ${signed(pct(avg(fR.p50), MR.recentMean(reach, NOW)), 1)} versus the last 4 weeks.`];
      evid('pt-reach', ev.reach);
    }
    App.predictEvidence.tv = { title: 'TVR & Audience Forecast', horizon: H, span: SPAN, lines: flatten(ev).map(w),
      kpis: [['Projected average TVR', f2(pTVR)], ['Guaranteed minimum TVR (low case)', f2(gTVR)], ['Projected reach %', fR ? fmt.pct(avg(fR.p50), 1) : 'n/a'], ['Top growing category', growing[0] ? growing[0].name : 'n/a']],
      result: subset(pr.res, R, ['tvr_total', 'channel_tvr', 'reach_total']) };
  }

  /* ================================================================ Market & Competitor */
  async function marketTab(p, ctx) {
    if (!ctx.has('lmrb')) return needData(p, 'LMRB sheet');
    const filters = ctx.filtersFor('lmrb'), persp = ctx.persp(), M = ctx.mode() === 'monthly', NM = ctx.months(), H = M ? NM * 30 : ctx.horizon();
    const pg = App.store.get('mk-group:' + App.clientId(), '');
    const opts = { product_group: pg || null, my_brand: persp.my_brand || null, tv_data_set: persp.tv_data_set || null, mode: M ? 'monthly' : 'daily' };
    const key = 'lm|' + ctx.status.lmrb.sig + '|' + (ctx.status.tv ? ctx.status.tv.sig : '') + '|' + JSON.stringify(filters) + JSON.stringify(opts);
    const prog = cache.has(key) ? null : scanning(p, 'Forecasting competitor moves');
    let pr;
    try { pr = await getPrediction(key, () => App.data.predictMarket({ filters, options: opts }), 'lmrb', prog || (() => {})); }
    catch (e) { p.innerHTML = App.emptyState('The market prediction could not run', e.message) + '<div style="text-align:center"><button class="btn" data-rerun>Try again</button></div>'; wireRerun(p, key, () => marketTab(p, ctx)); return; }
    finally { if (prog) App.loader.hide(250); }
    if (!p.isConnected) return;
    const R = pr.results, pc = pr.payload.ctx;
    const w = W(M), SPAN = M ? `${NM} month${NM === 1 ? '' : 's'}` : `${H} days`, NOW = M ? 3 : 28, NP = M ? NM : H, NB = M ? 6 : 28, BACK = M ? 24 : 28;
    HIST = M ? 24 : 56;
    const evid = (id, items) => C.evidence(id, (items || []).map((x) => (typeof x === 'string' ? w(x) : x && x.text ? { ...x, text: w(x.text) } : x)), "Planner's Evidence (forecast)", { note: 'These figures are forecasts: estimates of what is likely, not recorded data.' });
    if (!R.length) { p.innerHTML = App.emptyState('Not enough LMRB history to forecast', (pr.payload.notes || [])[0] || 'Widen the filters.'); return; }
    const comp = group(R, 'comp_spend'), sov = group(R, 'sov'), spots = one(R, 'spots_total'), dps = group(R, 'daypart_spend'), cps = one(R, 'cps_total');
    const clut = group(R, 'clutter'), pos = group(R, 'posinbrk'), rate = group(R, 'slot_rating'), costs = group(R, 'slot_cost');
    const my = pc.my_brand;
    C.register(comp.map((r) => r.entity));
    // competitor spend totals and bursts
    const compRows = comp.map((r) => { const f = slice(r, H); const prev = r.history.values.slice(-NP); return { r, name: r.entity, next: total(f.p50), lo: total(f.p10), hi: total(f.p90), prev: total(prev), bursts: MR.bursts(r.history.values.slice(-NB), f.p50, M ? { win: 3 } : undefined) }; });
    const rivals = compRows.filter((x) => x.name !== my);
    const rivalNext = total(rivals.map((x) => x.next)), rivalPrev = total(rivals.map((x) => x.prev));
    const fS = spots ? slice(spots, H) : null;
    const clutRows = clut.map((r) => { const f = slice(r, H), ps = pos.find((q) => q.entity === r.entity); return { name: r.entity, next: avg(f.p50), hist: MR.recentMean(r, NOW), pos: ps ? avg(slice(ps, H).p50) : pc.pos_recent[r.entity] }; })
      .map((x) => ({ ...x, rising: finite(x.next) && finite(x.hist) && x.next > x.hist * 1.1 })).filter((x) => finite(x.next));
    const worst = clutRows.slice().sort((a, b) => b.next - a.next)[0];
    const bubble = rate.map((r) => { const c = costs.find((q) => q.entity === r.entity); if (!c) return null; return { name: r.entity, channel: r.entity.split(' / ')[0], x: avg(slice(r, H).p50), y: avg(slice(c, H).p50), clutter: pc.slot_clutter[r.entity], spots: pc.slot_spots[r.entity] }; }).filter((q) => q && finite(q.x) && finite(q.y));
    const zone = bubble.length ? MR.buyingZone(bubble) : null;
    const groupSel = `<label class="row small">Product group <select id="mk-group" style="max-width:220px">${pc.product_groups.map((g) => `<option ${g === pc.product_group ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select></label>
      <label class="row small">My brand <select id="mk-brand" style="max-width:220px"><option value="">None</option>${pc.advertisers.map((a) => `<option ${a === persp.my_brand ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></label>`;
    p.innerHTML = w(`${headCard('Market & Competitor Forecast', `${pc.product_group}: next ${SPAN} from ${pc.date_max}, ${fmt.num(pc.group_rows)} spots in the group.`, spots, groupSel)}
      ${forecastKey(M)}${M ? monthNote(pc) : ''}${(pr.payload.notes || []).filter((n) => !/interpolation/.test(n)).map((n) => `<div class="banner info"><span>${esc(n)}</span></div>`).join('')}
      <div class="kpis">
        ${kpiTile('Predicted competitor spend', fmt.lkrc(rivalNext), `${signed(pct(rivalNext, rivalPrev), 0)} vs the previous ${SPAN}. Range ${fmt.lkrc(total(rivals.map((x) => x.lo)))} to ${fmt.lkrc(total(rivals.map((x) => x.hi)))}`, App.help('Sum of the daily most likely spend forecasts for the top competitors in the product group (your brand excluded).', 'How much pressure to expect from rivals, for budget defence.'))}
        ${kpiTile('Predicted spot volume', fS ? fmt.num(total(fS.p50)) : 'n/a', fS ? `About ${fmt.num(avg(fS.p50), 0)} spots a day in ${esc(pc.product_group)}` : '', App.help('Most likely forecast of daily spot counts for the whole product group, summed over the horizon.', 'Category clutter in the period: more spots means each one works harder to stand out.'))}
        ${kpiTile('High-clutter alert', worst ? `${fmt.num(worst.next, 1)} ads/break` : 'n/a', worst ? `${esc(short(worst.name, 40))}${worst.rising ? ' (rising)' : ''}` : 'AdsinBrk not available', App.help('Average AdsinBrk is forecast for the programmes this group buys; the highest expected break length is flagged.', 'Breaks to avoid, or to buy only in first position.'), worst && worst.rising ? 'alert-kpi' : '')}
        ${kpiTile('Best estimated CPRP slot', zone && zone.best ? fmt.lkrc(zone.best.cprp) : 'n/a', zone && zone.best ? esc(short(zone.best.name, 42)) : 'Load the TVR sheet to rate slots', App.help('Cost per rating point = forecast average spot cost divided by forecast spot rating (matched programme TVR), for the most-used slots.', 'The cheapest rating points to buy next, inside the optimal buying zone where possible.'))}
      </div>
      <div style="margin-top:16px">${C.box('pm-spend', 'Competitor spend and next move', `${M ? 'Spend' : '7-day average of daily spend'} per advertiser in ${pc.product_group}. Solid: actual. Dashed: forecast most likely. Triangles: predicted campaign bursts.`, { xtall: true, ev: true,
        help: ['Each advertiser\'s daily spend is forecast with the forecast engine. A forecast day more than 25% above that advertiser\'s trailing 7-day average is flagged as a Predicted Competitor Campaign Burst.', 'Early warning of rival launches and bursts, so you can defend share of voice or book inventory before prices rise.'] })}</div>
      <div class="grid g2" style="margin-top:16px">
        ${C.box('pm-clutter', 'Break clutter and position', 'Bars: forecast average ads per break (red = rising). Line: average position in break.', { tall: true, ev: true,
          help: ['AdsinBrk and PosinBrk are averaged per programme per day and forecast. Clutter is flagged as rising when the forecast is at least 10% above the last 4 weeks.', 'Where your spot will be buried in long breaks, and where to insist on position 1 to 2.'] })}
        ${C.box('pm-bubble', 'CPRP efficiency', 'X: forecast spot rating. Y: forecast cost per spot. Bubble size: break clutter. Colour: channel.', { tall: true, ev: true,
          help: ['For the most-used programme slots, the matched TVR (spot rating) and the average spot cost are each forecast. The shaded quadrant (rating at or above the median, cost at or below the median) is the Optimal Buying Zone.', 'Slots that deliver more rating points for less money: the shortlist for your next buy.'] })}
      </div>
      <div class="grid g2" style="margin-top:16px">
        ${C.box('pm-sov', 'Share of voice: now vs forecast', `Share of ${pc.product_group} spend by advertiser: last 4 weeks vs next ${SPAN}`, { tall: true, ev: true,
          help: ['Each advertiser\'s share of group spend is forecast. Bars compare the forecast share with the recent share; the change in share points is written beside each name.', 'Whether your share of voice is about to be squeezed, and by whom.'] })}
        ${C.box('pm-dp', 'Daypart spend shift', `Average daily group spend by daypart: last 4 weeks vs next ${SPAN}`, { tall: true, ev: true,
          help: ['Group spend per daypart is forecast and its daily average compared with the last 4 weeks.', 'Where competitor money is moving across the day, to find quieter, cheaper dayparts.'] })}
      </div>
      <div class="grid g2" style="margin-top:16px">
        ${C.box('pm-chmix', 'Where competitors will spend: channel mix', `Share of ${pc.product_group} spend by channel: last 4 weeks vs next ${SPAN}`, { tall: true, ev: true,
          help: ['Each channel\'s share of the group\'s spend is forecast. Bars compare the forecast share with the recent share; the change in points is written beside each channel.', 'Which channels competitors are moving money to, so you can claim inventory early or avoid a crowded channel.'] })}
        ${C.box('pm-advch', 'Competitor by channel: forecast spend', `Total ${pc.product_group} spend each advertiser is expected to put on each channel, next ${SPAN}`, { html: '', ev: true,
          help: ['Each advertiser and channel pair is forecast separately and summed over the horizon. Brighter cells mean more money.', 'Who plans to dominate which channel, and the white space where nobody is spending.'] })}
      </div>
      ${pc.has_grp ? `<div class="grid g2" style="margin-top:16px">
        ${C.box('pm-sog', 'Share of audience delivered: now vs forecast', `Share of GRPs (rating points) by advertiser: last 4 weeks vs next ${SPAN}`, { tall: true, ev: true,
          help: ['Each spot is matched to the programme airing at that time and given its rating. Each advertiser\'s share of all rating points is forecast and compared with the recent share.', 'Share of audience is a truer share of voice than share of spend: it shows who is actually reaching viewers.'] })}
        ${C.box('pm-cprp', 'Cost per rating point outlook', 'Average cost to buy one rating point in the group: actual and forecast range', { tall: true, ev: true,
          help: ['Spend divided by rating points delivered is forecast as a fan with low case to high case.', 'Whether audience is getting more or less expensive, to time bookings and negotiate rates.'] })}
      </div>` : ''}
      ${cps ? `<div style="margin-top:16px">${C.box('pm-cps', 'Cost inflation outlook', 'Average cost per second in the group: actual and forecast range', { ev: true,
        help: ['Total spend divided by total seconds per day, forecast as a fan with low case to high case.', 'Whether media costs are drifting up, to time bookings and negotiate rates.'] })}</div>` : ''}`);
    wireRerun(p, key, () => marketTab(p, ctx));
    markForecast(p, { R, H, M });
    p.querySelectorAll('[data-intro]').forEach((b) => { b.onclick = () => App.loadIntro().then(() => App.intro.open(true)); });
    $('#mk-group', p).onchange = (e) => { App.store.set('mk-group:' + App.clientId(), e.target.value); marketTab(p, ctx); };
    $('#mk-brand', p).onchange = (e) => { ctx.setPersp({ my_brand: e.target.value }); marketTab(p, ctx); };
    const ev = {};

    // 1. competitor spend multi-line with bursts
    if (comp.length) {
      const back = M ? 24 : 42, hd = comp[0].history.dates.slice(-back), fd = slice(comp[0], H).dates, labels = hd.concat(fd), nh = hd.length;
      const ds = [];
      compRows.forEach((x) => {
        const col = C.colorFor(x.name), f = slice(x.r, H), hv0 = x.r.history.values.slice(-back);
        const all = M ? hv0.concat(f.p50) : smooth(hv0.concat(f.p50), 7), hv = all.slice(0, nh), fS = all.slice(nh); x.fs = fS;
        ds.push({ label: x.name, data: hv.concat(Array(fd.length).fill(null)), borderColor: col, backgroundColor: col, borderWidth: x.name === my ? 3 : 2, pointRadius: 0, tension: 0.25 });
        ds.push({ label: x.name + ' (forecast)', data: Array(nh - 1).fill(null).concat([hv[nh - 1]], fS), borderColor: col, borderDash: [6, 5], borderWidth: 2, pointRadius: 0, tension: 0.3 });
      });
      const bursts = []; compRows.forEach((x) => x.bursts.forEach((b) => bursts.push({ ...b, name: x.name, date: slice(x.r, H).dates[b.index] })));
      const marks = labels.map(() => null), info = {};
      bursts.forEach((b) => { const i = nh + b.index; const sv = ((compRows.find((q) => q.name === b.name) || {}).fs || [])[b.index]; const yv = finite(sv) ? sv : b.value; if (marks[i] == null || yv > marks[i]) { marks[i] = yv; info[i] = b; } });
      if (bursts.length) ds.push({ label: 'Predicted Competitor Campaign Burst', data: marks, showLine: false, pointStyle: 'triangle', pointRadius: 9, pointHoverRadius: 11, borderColor: C.css('--warn') || '#ffb547', backgroundColor: C.css('--warn') || '#ffb547' });
      C.make('pm-spend', { type: 'line', data: { labels, datasets: ds }, plugins: [nowLine],
        options: { interaction: { mode: 'index', intersect: false }, plugins: { nowLine: { index: nh - 1 }, legend: { position: 'bottom', labels: { filter: (i) => !/\(forecast\)$/.test(i.text) } },
          tooltip: { filter: (i) => i.parsed.y != null && !(i.dataIndex === nh - 1 && /\(forecast\)$/.test(i.dataset.label)), callbacks: { title: C.fcTitle(nh), label: (c) => (c.dataset.label.startsWith('Predicted') ? `Burst: ${info[c.dataIndex].name} ${signed(info[c.dataIndex].lift_pct, 0)} vs 7-day average` : `${c.dataset.label}: ${fmt.lkrc(c.parsed.y)}`) } } },
          scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } }, y: { beginAtZero: true, ticks: { callback: (v) => fmt.compact(v) } } } } });
      const top = rivals.slice().sort((a, b) => b.next - a.next)[0];
      const riser = rivals.map((x) => ({ ...x, chg: pct(x.next, x.prev) })).filter((x) => finite(x.chg)).sort((a, b) => b.chg - a.chg)[0];
      const firstBurst = bursts.sort((a, b) => a.index - b.index)[0];
      ev.spend = [
        top ? `${top.name} is expected to spend the most: ${fmt.lkrc(top.next)} in the next ${SPAN}.` : null,
        riser && riser.chg > 10 ? `${riser.name} is accelerating: ${signed(riser.chg, 0)} versus the previous ${SPAN}.` : 'No competitor is accelerating by more than 10%.',
        bursts.length ? `Predicted Competitor Campaign Bursts: ${bursts.slice(0, 4).map((b) => `${b.name} on ${b.date} (${signed(b.lift_pct, 0)})`).join('; ')}.` : 'No campaign bursts are predicted in this horizon.',
        my ? (() => { const m = compRows.find((x) => x.name === my); return m ? `${my} is forecast at ${fmt.lkrc(m.next)} (${signed(pct(m.next, m.prev), 0)} vs previous ${SPAN}).` : null; })() : null,
        { rec: true, text: firstBurst ? `Lock inventory and lift weight in the days before ${firstBurst.date} to defend share against ${firstBurst.name}.` : (riser && riser.chg > 10 ? `Watch ${riser.name}: plan a response flight if the trend continues.` : 'Competitive pressure is steady; keep the current flighting.') },
      ];
    } else ev.spend = ['No competitor spend history in this product group.'];
    evid('pm-spend', ev.spend);

    // 2. clutter combo
    if (clutRows.length) {
      const rows = clutRows.slice().sort((a, b) => b.next - a.next);
      C.make('pm-clutter', { data: { labels: rows.map((x) => `${short(x.name, 24)} (${fmt.num(x.next, 1)})`), datasets: [
        { type: 'bar', label: 'Forecast ads in break', data: rows.map((x) => x.next), backgroundColor: rows.map((x) => (x.rising ? (C.css('--bad') || '#ff5d7a') + 'cc' : C.PALETTE[0] + 'aa')), borderRadius: 5, maxBarThickness: 26, yAxisID: 'y' },
        { type: 'bar', label: w('Last 4 weeks'), data: rows.map((x) => x.hist), backgroundColor: 'rgba(142,154,200,.28)', borderRadius: 5, maxBarThickness: 26, yAxisID: 'y' },
        { type: 'line', label: 'Average position in break', data: rows.map((x) => x.pos), borderColor: C.PALETTE[2], backgroundColor: C.PALETTE[2], pointRadius: 4, tension: 0.3, yAxisID: 'y2' }] },
        options: { interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { title: (it) => rows[it[0].dataIndex].name, label: (c) => `${c.dataset.label}: ${fmt.num(c.parsed.y, 1)}` } } },
          scales: { x: { grid: { display: false }, ticks: { maxRotation: 50, minRotation: 30, font: { size: 10 } } }, y: { beginAtZero: true, title: { display: true, text: 'Ads per break' } }, y2: { position: 'right', beginAtZero: true, grid: { display: false }, title: { display: true, text: 'Position' } } } } });
      const rising = rows.filter((x) => x.rising);
      ev.clutter = [
        `Most cluttered: ${rows.slice(0, 2).map((x) => `${x.name} (${fmt.num(x.next, 1)} ads per break)`).join('; ')}.`,
        rising.length ? `Clutter rising in ${rising.slice(0, 3).map((x) => `${x.name} (${fmt.num(x.hist, 1)} to ${fmt.num(x.next, 1)})`).join('; ')}.` : 'No programme shows rising clutter.',
        { rec: true, text: rising.length ? `In ${rising.slice(0, 2).map((x) => x.name).join(' and ')}, buy PosinBrk 1 to 2 (first in break) or move weight to less cluttered programmes.` : `Clutter is stable. Request PosinBrk 1 to 2 in ${rows[0].name}, the longest breaks.` },
      ];
    } else ev.clutter = ['AdsinBrk is not available in this sheet.'];
    evid('pm-clutter', ev.clutter);

    // 3. CPRP bubble
    if (zone && zone.points.length) {
      const chans = [...new Set(zone.points.map((q) => q.channel))];
      const cl = zone.points.map((q) => q.clutter).filter(finite), cmin = Math.min(...cl, 0), cmax = Math.max(...cl, 1);
      const rad = (v) => (finite(v) ? 6 + 16 * ((v - cmin) / (cmax - cmin || 1)) : 8);
      C.make('pm-bubble', { type: 'bubble', data: { datasets: chans.map((ch) => ({ label: fmt.title(ch), data: zone.points.filter((q) => q.channel === ch).map((q) => ({ x: q.x, y: q.y, r: rad(q.clutter), q })),
        backgroundColor: C.PALETTE[chans.indexOf(ch) % C.PALETTE.length] + '99', borderColor: C.PALETTE[chans.indexOf(ch) % C.PALETTE.length], borderWidth: 1.5 })) }, plugins: [zonePlugin],
        options: { plugins: { zone: { x: zone.x_median, y: zone.y_median }, legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c) => { const q = c.raw.q; return [short(q.name, 60), `Rating ${f2(q.x)}, cost ${fmt.lkrc(q.y)} per spot`, `CPRP ${fmt.lkrc(q.cprp)}, clutter ${finite(q.clutter) ? fmt.num(q.clutter, 1) : 'n/a'} ads/break${q.optimal ? ', optimal zone' : ''}`]; } } } },
          scales: { x: { title: { display: true, text: 'Forecast spot rating (TVR)' } }, y: { title: { display: true, text: 'Forecast cost per spot (LKR)' }, ticks: { callback: (v) => fmt.compact(v) } } } } });
      const opt = zone.points.filter((q) => q.optimal && q.cprp != null).sort((a, b) => a.cprp - b.cprp);
      const dear = zone.points.filter((q) => q.cprp != null).sort((a, b) => b.cprp - a.cprp)[0];
      ev.bubble = [
        opt.length ? `In the Optimal Buying Zone: ${opt.slice(0, 3).map((q) => `${q.name} (CPRP ${fmt.lkrc(q.cprp)})`).join('; ')}.` : 'No slot is both above-median rating and below-median cost right now.',
        dear ? `Most expensive rating points: ${dear.name} (CPRP ${fmt.lkrc(dear.cprp)}).` : null,
        { rec: true, text: zone.best ? `Shift weight toward ${zone.best.name}: about ${fmt.lkrc(zone.best.cprp)} per rating point${finite(zone.best.clutter) && zone.best.clutter > 6 ? ', but ask for first position because breaks are long' : ''}.` : 'Load more TVR history to rate slots.' },
      ];
    } else ev.bubble = [pc.has_grp ? 'Too few matched slots to compare.' : 'Load the TVR sheet as well: spot ratings come from matching each spot to the programme airing at that time.'];
    evid('pm-bubble', ev.bubble);

    // 4. share of voice (bars)
    {
      const rows = shareRows(sov, H, NOW);
      if (rows.length) {
        shareBars('pm-sov', rows, { nowLabel: w('Last 4 weeks'), nextLabel: `Next ${SPAN}` });
        const me = rows.find((x) => x.name === my), lead = rows[0], up = rows.slice().sort((a, b) => b.chg - a.chg)[0];
        ev.sov = [
          `${lead.name} is expected to lead with ${fmt.num(lead.next, 1)}% share of voice.`,
          up.chg > 0.5 ? `${up.name} gains the most (${signed(up.chg, 1).replace('%', '')} pts to ${fmt.num(up.next, 1)}%).` : null,
          me ? `${my}: ${fmt.num(me.now, 1)}% now, ${fmt.num(me.next, 1)}% forecast.` : 'Pick your brand above to track your own share of voice.',
          { rec: true, text: me && me.chg < -1 ? `Your share is set to slip by ${fmt.num(-me.chg, 1)} points; add weight or concentrate it in fewer periods to hold presence.` : 'Share of voice is holding; maintain the plan.' },
        ];
      } else ev.sov = ['No share of voice history.'];
      evid('pm-sov', ev.sov);
    }

    // 5. daypart spend shift
    if (dps.length) {
      const rows = dps.map((r) => ({ name: r.entity, now: MR.recentMean(r, NOW), next: avg(slice(r, H).p50) })).filter((x) => finite(x.now) || finite(x.next));
      const order = MR.daypartOrder ? MR.daypartOrder() : [];
      rows.sort((a, b) => (order.indexOf(a.name) - order.indexOf(b.name)));
      C.make('pm-dp', { type: 'bar', data: { labels: rows.map((x) => x.name), datasets: [
        { label: w('Last 4 weeks (per day)'), data: rows.map((x) => x.now), backgroundColor: 'rgba(142,154,200,.45)', borderRadius: 5, maxBarThickness: 30 },
        { label: w(`Next ${SPAN} (per day)`), data: rows.map((x) => x.next), backgroundColor: C.PALETTE[1] + 'cc', borderRadius: 5, maxBarThickness: 30 }] },
        options: { plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt.lkrc(c.parsed.y)}` } } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { callback: (v) => fmt.compact(v) } } } } });
      const ch = rows.map((x) => ({ ...x, chg: pct(x.next, x.now) })).filter((x) => finite(x.chg)).sort((a, b) => b.chg - a.chg);
      ev.dp = [
        ch[0] && ch[0].chg > 5 ? `Competitor money is moving into ${ch[0].name} (${signed(ch[0].chg, 0)}).` : 'No daypart gains more than 5%.',
        ch.length && ch[ch.length - 1].chg < -5 ? `${ch[ch.length - 1].name} is cooling (${signed(ch[ch.length - 1].chg, 0)}).` : null,
        { rec: true, text: ch.length && ch[ch.length - 1].chg < -5 ? `Look for value in ${ch[ch.length - 1].name}, where competition is easing.`
          : ch[0] && ch[0].chg > 5 ? `Expect more clutter and firmer rates in ${ch[0].name}; book it early or test adjacent dayparts.` : 'Daypart mix is stable.' },
      ];
    } else ev.dp = ['No daypart history.'];
    evid('pm-dp', ev.dp);

    // 5b. channel mix, competitor x channel, audience share, CPRP outlook
    {
      const rows = shareRows(group(R, 'chan_mix'), H, NOW);
      if (rows.length) {
        shareBars('pm-chmix', rows, { nowLabel: w('Last 4 weeks'), nextLabel: `Next ${SPAN}`, title: fmt.title });
        const up = rows.slice().sort((a, b) => b.chg - a.chg), dn = up.slice().reverse();
        ev.chmix = [
          `Most competitor money will go to ${fmt.title(rows[0].name)}: ${fmt.num(rows[0].next, 1)}% of ${pc.product_group} spend.`,
          up[0].chg > 0.5 ? `Channel gaining spend share: ${up.filter((x) => x.chg > 0.5).slice(0, 3).map((x) => `${fmt.title(x.name)} (${signed(x.chg, 1).replace('%', '')} pts)`).join(', ')}.` : 'No channel gains more than half a point of spend share.',
          dn[0].chg < -0.5 ? `Channel losing spend share: ${dn.filter((x) => x.chg < -0.5).slice(0, 3).map((x) => `${fmt.title(x.name)} (${signed(x.chg, 1).replace('%', '')} pts)`).join(', ')}.` : null,
          { rec: true, text: dn[0].chg < -0.5 ? `${fmt.title(dn[0].name)} is getting less crowded; ask for better rates or premium positions there.` : 'Channel mix is stable; no urgent move needed.' },
        ];
      } else ev.chmix = ['No channel history for this product group.'];
      evid('pm-chmix', ev.chmix);

      const ac = group(R, 'adv_channel').map((r) => { const [a, c] = r.entity.split(' | '); return { a, c, v: total(slice(r, H).p50) }; });
      if (ac.length) {
        const ads = [...new Set(ac.map((x) => x.a))], chs = [...new Set(ac.map((x) => x.c))];
        const mat = { rows: ads, cols: chs.map(fmt.title), values: ads.map((a) => chs.map((c) => { const x = ac.find((q) => q.a === a && q.c === c); return x ? x.v : null; })) };
        $('#pm-advch').innerHTML = C.heat(mat, { fmt: fmt.compact, caption: 'Forecast spend by advertiser and channel' });
        const best = ac.slice().sort((x, y) => y.v - x.v)[0], mine = my ? ac.filter((x) => x.a === my) : [];
        const colTot = chs.map((c) => ({ c, v: ac.filter((x) => x.c === c).reduce((s2, x) => s2 + x.v, 0) })).sort((x, y) => x.v - y.v);
        ev.advch = [
          `Biggest planned commitment: ${best.a} on ${fmt.title(best.c)} (${fmt.lkrc(best.v)}).`,
          mine.length ? `${my} is forecast to put most on ${fmt.title(mine.sort((x, y) => y.v - x.v)[0].c)} (${fmt.lkrc(mine[0].v)}).` : 'Pick your brand above to see where you stand against each rival.',
          { rec: true, text: `${fmt.title(colTot[0].c)} has the least competitor money planned (${fmt.lkrc(colTot[0].v)} across the top advertisers): the best place to stand out, if its audience fits.` },
        ];
      } else { $('#pm-advch').innerHTML = App.emptyState('Not enough channel history', 'This view needs advertisers with spots on several channels.'); ev.advch = []; }
      evid('pm-advch', ev.advch);

      const sg = group(R, 'sog'), srows = shareRows(sg, H, NOW);
      if (pc.has_grp && srows.length && $('#pm-sog')) {
        shareBars('pm-sog', srows, { nowLabel: w('Last 4 weeks'), nextLabel: `Next ${SPAN}` });
        const me2 = srows.find((x) => x.name === my);
        ev.sog = [
          `${srows[0].name} is expected to deliver the biggest audience share: ${fmt.num(srows[0].next, 1)}% of rating points.`,
          me2 ? `${my}: ${fmt.num(me2.now, 1)}% of rating points now, ${fmt.num(me2.next, 1)}% forecast.` : 'Pick your brand above to track your own share of audience.',
          { rec: true, text: me2 && me2.chg < -1 ? `Your audience share is set to fall ${fmt.num(-me2.chg, 1)} points. Buy higher-rated slots, not just more spots.` : 'Audience share is holding up.' },
        ];
        evid('pm-sog', ev.sog);
      }
      const cp = one(R, 'cprp_total');
      if (pc.has_grp && cp && $('#pm-cprp')) {
        const f = slice(cp, H);
        fan('pm-cprp', cp, H, { color: C.PALETTE[2], vf: (v) => 'LKR ' + fmt.num(v, 0) });
        const chg = pct(avg(f.p50), MR.recentMean(cp, NOW));
        ev.cprp = [`Cost per rating point is expected at LKR ${fmt.num(avg(f.p50), 0)} (${signed(chg, 1)} vs the last 4 weeks; range LKR ${fmt.num(avg(f.p10), 0)} to ${fmt.num(avg(f.p90), 0)}).`,
          { rec: true, text: chg != null && chg > 5 ? 'Audience is getting more expensive: book early and lock rates.' : chg != null && chg < -5 ? 'Rating points are getting cheaper: delay buying where you can, and push for lower rates.' : 'Rating-point cost is stable.' }];
        evid('pm-cprp', ev.cprp);
      }
    }

    // 6. cost inflation
    if (cps) {
      const f = slice(cps, H);
      fan('pm-cps', cps, H, { color: C.PALETTE[4], vf: (v) => 'LKR ' + fmt.num(v, 0) });
      const chg = pct(avg(f.p50), MR.recentMean(cps, NOW));
      ev.cps = [`Average cost per second is expected at LKR ${fmt.num(avg(f.p50), 0)} (${signed(chg, 1)} vs the last 4 weeks).`,
        { rec: true, text: chg != null && chg > 5 ? 'Costs are drifting up: confirm bookings early and lock rates for the flight.' : 'No cost inflation expected; there is room to negotiate.' }];
      evid('pm-cps', ev.cps);
    }
    App.predictEvidence.lmrb = { title: 'Market & Competitor Forecast', horizon: H, product_group: pc.product_group, lines: flatten(ev),
      kpis: [['Predicted competitor spend', fmt.lkrc(rivalNext)], ['Predicted spot volume', fS ? fmt.num(total(fS.p50)) : 'n/a'], ['High-clutter alert', worst ? `${worst.name}: ${fmt.num(worst.next, 1)} ads/break` : 'n/a'], ['Best estimated CPRP slot', zone && zone.best ? `${zone.best.name}: ${fmt.lkrc(zone.best.cprp)}` : 'n/a']],
      result: subset(pr.res, R, ['comp_spend', 'spots_total']) };
  }

  /* ---------------- utils ---------------- */
  function flatten(ev) { return Object.values(ev).flat().filter(Boolean).map((x) => (typeof x === 'string' ? x : (x.rec ? 'Recommendation: ' : '') + x.text)); }
  function subset(res, results, groups) {
    if (!res) return null;
    const rs = results.filter((r) => groups.includes(r.group)).slice(0, 12);
    return rs.length ? { ...res, results: rs } : null;
  }
  /** Which forecast groups stand behind each chart. */
  const NUMS = { 'pt-fan': ['tvr_total'], 'pt-reach': ['reach_total'], 'pt-chshare': ['channel_share'], 'pt-chdp': ['chan_daypart'], 'pt-cat': ['cat_share'], 'pt-heat': ['hour_share'], 'pt-risk': ['program_tvr'],
    'pm-spend': ['comp_spend'], 'pm-sov': ['sov'], 'pm-dp': ['daypart_spend'], 'pm-cps': ['cps_total'], 'pm-chmix': ['chan_mix'], 'pm-advch': ['adv_channel'], 'pm-sog': ['sog'], 'pm-cprp': ['cprp_total'],
    'pm-clutter': ['clutter', 'posinbrk'], 'pm-bubble': ['slot_rating', 'slot_cost'] };
  const valFmt = (u) => ({ currency: (v) => fmt.num(v, 0), percent: (v) => fmt.num(v, 2), rating: (v) => fmt.num(v, 3) }[u] || ((v) => fmt.num(v, 2)));
  /** Modal with the exact numbers behind a chart: actual history, forecast low case/most likely/high case, and how well the model did on recent periods. */
  function numbersModal(title, results, H, M) {
    if (!results.length) { App.toast('No numbers for this chart yet.', 'info'); return; }
    const pick = results.length > 1 ? `<div class="field" style="max-width:420px;margin-bottom:12px"><label for="nm-sel">Series</label><select id="nm-sel">${results.map((r, i) => `<option value="${i}">${esc(r.entity)}</option>`).join('')}</select></div>` : '';
    const m = App.modal(`Numbers behind: ${title}`, `<div class="banner info"><span>Rows marked <b>FORECAST</b> have not happened yet. They are estimates: most likely is the most likely value, low case a low case and high case a high case. Rows marked actual are recorded data.</span></div>${pick}<div id="nm-acc"></div><div id="nm-tbl"></div>`);
    const draw = (i) => {
      const r = results[i], f = slice(r, H), vf = valFmt(r.unit), keep = M ? 24 : 30;
      const hist = r.history.dates.slice(-keep).map((d, k) => { const j = r.history.dates.length - Math.min(keep, r.history.dates.length) + k; return { period: d, kind: 'actual', p10: null, p50: r.history.values[j], p90: null }; });
      const fc = f.dates.map((d, k) => ({ period: d, kind: 'FORECAST', p10: f.p10[k], p50: f.p50[k], p90: f.p90[k] }));
      const bt = r.backtest, rel = r.reliability;
      $('#nm-acc', m).innerHTML = `<div class="card" style="margin-bottom:12px"><h3>How much can I trust this?</h3><div class="small" style="margin-top:8px">
        Reliability: <span class="badge ${relCls[rel.level]}">${rel.level}</span> ${esc(rel.reasons.join(' '))}
        ${bt && bt.model ? `<div style="margin-top:6px">Accuracy check: the engine was tested on the last ${bt.holdout} ${r.granularity === 'monthly' ? 'months' : r.granularity === 'weekly' ? 'weeks' : 'days'} of recorded data, which it had not seen. It was off by <b>${bt.model.smape == null ? 'n/a' : fmt.num(bt.model.smape, 1) + '%'}</b> on average (a simple repeat-last-pattern guess was off by ${bt.baseline.smape == null ? 'n/a' : fmt.num(bt.baseline.smape, 1) + '%'}), and ${bt.model.coverage == null ? 'n/a' : fmt.num(bt.model.coverage, 0) + '%'} of actual values fell inside the low case to high case range (about 80% is ideal).</div>` : '<div style="margin-top:6px">There is not enough history for an accuracy test on this series.</div>'}</div></div>`;
      const box = $('#nm-tbl', m);
      App.tables.create(box, { csv: 'numbers_' + title.replace(/\W+/g, '_').toLowerCase() + '_' + r.entity.replace(/\W+/g, '_').toLowerCase(), search: false, pageSize: 40, defaultSort: { key: 'period', desc: false },
        rows: hist.concat(fc), columns: [{ key: 'period', label: r.granularity === 'monthly' ? 'Month' : r.granularity === 'weekly' ? 'Week starting' : 'Date' },
          { key: 'kind', label: 'Type', html: (v) => (v === 'FORECAST' ? '<span class="fc-pill" style="margin:0">Forecast</span>' : '<span class="badge">actual</span>') },
          { key: 'p10', label: 'Low case', num: true, fmt: (v) => (v == null ? '' : vf(v)) }, { key: 'p50', label: 'Value / Most likely', num: true, fmt: (v) => (v == null ? '' : vf(v)) }, { key: 'p90', label: 'High case (high case)', num: true, fmt: (v) => (v == null ? '' : vf(v)) }] });
    };
    const sel = $('#nm-sel', m); if (sel) sel.onchange = () => draw(+sel.value);
    draw(0);
  }
  /** Puts a FORECAST pill and a Numbers button on every chart card; charts that also show history say so. */
  const MIXED = ['pt-fan', 'pt-reach', 'pm-spend', 'pm-cps', 'pm-cprp'];
  function markForecast(p, nums) {
    p.querySelectorAll('.card').forEach((c) => {
      const h = c.querySelector('.card-head h3'); if (!h || h.querySelector('.fc-pill')) return;
      const id = (c.querySelector('canvas, [id^="pt-"], [id^="pm-"]') || {}).id || '';
      h.insertAdjacentHTML('afterbegin', `<span class="fc-pill">${MIXED.includes(id) ? 'Actual + forecast' : 'Forecast'}</span>`);
      c.classList.add('fc');
      if (nums && NUMS[id]) {
        const row = c.querySelector('.card-head .row');
        if (row) { row.insertAdjacentHTML('afterbegin', '<button class="btn sm" type="button" data-nums>Numbers</button>');
          row.querySelector('[data-nums]').onclick = () => numbersModal(h.textContent.replace(/Actual \+ forecast|Forecast|\?/g, '').trim(), nums.R.filter((r) => NUMS[id].includes(r.group)), nums.H, nums.M); }
      }
    });
  }
  function wireRerun(p, key, again) {
    p.querySelectorAll('[data-rerun]').forEach((b) => { b.onclick = () => { cache.delete(key); again(); }; });
  }
  const fail = (p) => (e) => { console.error(e); p.innerHTML = App.emptyState('This prediction could not be drawn', e.message); };
  document.addEventListener('datachange', () => cache.clear());

  App.predictTabs = {
    tvr: { id: 'p-tvr', label: 'TVR & Audience Forecast', predict: true, render: (p, ctx) => tvrTab(p, ctx) },
    market: { id: 'p-market', label: 'Market & Competitor Forecast', predict: true, render: (p, ctx) => marketTab(p, ctx) },
  };
})(window.App);
