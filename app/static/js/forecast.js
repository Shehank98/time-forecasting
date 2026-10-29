/* Forecast tab: controls, progress, chart with P10/P50/P90 band, backtest overlay, outlook and tables. */
(function (App) {
  const { esc, fmt, charts: C, tables: T } = App;
  const relCls = { High: 'good', Medium: 'warn', Low: 'bad' };
  const METRIC_FMT = { spend: fmt.compact, spots: (v) => fmt.num(v, 0), sov: (v) => fmt.pct(v, 1), cps: fmt.compact, tvr: (v) => fmt.num(v, 2), reach: fmt.compact };
  const saved = (k) => App.store.get('fc:' + k, {});
  App.lastForecast = App.lastForecast || {};

  function banner(model) {
    const el = document.getElementById('forecast-banner'); if (!el) return;
    el.innerHTML = model && model.backend === 'fallback'
      ? `<div class="banner bad" role="alert"><span><b>Fallback model in use.</b> TimesFM could not be loaded (${esc(model.error || 'unknown reason')}). Forecasts use seasonal naive plus exponential smoothing and should be treated with extra care.</span></div>` : '';
  }

  const cpPlugin = { id: 'cp', afterDatasetsDraw(chart, a, opts) {
    if (!opts || !opts.lines) return;
    const { ctx, chartArea: ar, scales: { x } } = chart; ctx.save(); ctx.setLineDash([4, 4]); ctx.strokeStyle = C.css('--bad') || '#d6364f'; ctx.lineWidth = 1;
    opts.lines.forEach((l) => { const px = x.getPixelForValue(l.index); if (px >= ar.left && px <= ar.right) { ctx.beginPath(); ctx.moveTo(px, ar.top); ctx.lineTo(px, ar.bottom); ctx.stroke(); } }); ctx.restore(); } };

  function drawChart(r) {
    const hd = r.history.dates, fd = r.forecast.dates, labels = hd.concat(fd), nh = hd.length;
    const pad = (arr, off) => Array(off).fill(null).concat(arr);
    const hist = r.history.values.concat(Array(fd.length).fill(null));
    const last = r.history.values[nh - 1];
    const p10 = pad(r.forecast.p10, nh), p90 = pad(r.forecast.p90, nh), p50 = pad(r.forecast.p50, nh);
    p10[nh - 1] = p50[nh - 1] = p90[nh - 1] = last;
    const col = C.PALETTE[0], vf = METRIC_FMT[r.metric] || fmt.compact;
    const ds = [
      { label: 'P90', data: p90, borderColor: 'transparent', backgroundColor: col + '30', fill: '+1', pointRadius: 0, order: 5 },
      { label: 'P10', data: p10, borderColor: 'transparent', backgroundColor: col + '30', fill: false, pointRadius: 0, order: 5 },
      { label: 'Forecast (P50)', data: p50, borderColor: col, borderDash: [6, 4], pointRadius: 0, order: 2 },
      { label: 'History', data: hist, borderColor: C.css('--text') || '#222', backgroundColor: C.css('--text') || '#222', pointRadius: nh > 60 ? 0 : 2, order: 1 },
    ];
    if (r.backtest) {
      const pos = r.backtest.dates.map((d) => labels.indexOf(d)); const arr = Array(labels.length).fill(null); pos.forEach((i, k) => { arr[i] = r.backtest.pred[k]; });
      ds.push({ label: 'Backtest forecast', data: arr, borderColor: C.PALETTE[2], pointRadius: 3, borderDash: [2, 3], order: 3 });
    }
    if (r.anomalies.length) {
      const arr = Array(labels.length).fill(null); r.anomalies.forEach((a) => { const i = labels.indexOf(a.date); if (i >= 0) arr[i] = a.value; });
      ds.push({ label: 'Anomaly', data: arr, showLine: false, pointStyle: 'triangle', pointRadius: 7, borderColor: C.css('--bad') || 'red', backgroundColor: C.css('--bad') || 'red', order: 0 });
    }
    const ch = C.line({ id: 'c-fc', labels, datasets: ds, valueFmt: vf });
    if (ch) {
      ch.options.plugins.cp = { lines: r.change_points.map((c) => ({ index: labels.indexOf(c.date) })).filter((l) => l.index >= 0) };
      ch.options.plugins.legend.labels.filter = (i) => !['P10', 'P90'].includes(i.text);
      ch.options.plugins.tooltip.filter = (i) => !['P10', 'P90'].includes(i.dataset.label);
      ch.config.plugins = [cpPlugin]; ch.update();
    }
  }

  function entityView(box, res, r) {
    const rel = r.reliability, o = r.outlook, vf = METRIC_FMT[r.metric] || fmt.compact, add = r.metric === 'spend' || r.metric === 'spots';
    const m = r.backtest ? r.backtest.model : null, b = r.backtest ? r.backtest.baseline : null;
    box.innerHTML = `
      <div class="row" style="margin-bottom:12px"><h3>${esc(r.entity)}</h3><span class="badge ${relCls[rel.level]}" title="${esc(rel.reasons.join(' '))}">Forecast reliability: ${rel.level}</span>
        <span class="badge info">${r.n_points} ${r.granularity} points</span><span class="badge ${res.backend === 'timesfm' ? 'good' : 'warn'}">${res.backend === 'timesfm' ? 'TimesFM 2.0' : 'Fallback model'}</span></div>
      <ul class="muted small" style="margin:0 0 12px;padding-left:18px">${rel.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}${r.warnings.map((x) => `<li><b>Warning:</b> ${esc(x)}</li>`).join('')}</ul>
      ${C.box('c-fc', `${esc(r.entity)}: history and forecast`, 'Shaded band is P10 to P90. Triangles are anomalies, dashed red lines are change points.', { tall: true })}
      <div class="grid g3" style="margin-top:16px">
        <div class="card"><h3>Competitor outlook</h3><div class="stack" style="gap:8px;margin-top:10px">
          <div>Trend: <span class="badge ${o.trend === 'rising' ? 'good' : o.trend === 'falling' ? 'bad' : 'info'}">${esc(o.trend)}</span> ${o.trend_change_pct != null ? fmt.delta(o.trend_change_pct) : ''}</div>
          ${add ? `<div>Expected next ${o.n_weeks} week${o.n_weeks === 1 ? '' : 's'}: <b>${fmt.compact(o.expected_next_4w)}</b> <span class="muted small">(indicative range ${fmt.compact(o.expected_next_4w_p10)} to ${fmt.compact(o.expected_next_4w_p90)})</span></div>
          <div>Predicted active weeks: <b>${o.active_weeks}</b> of ${o.n_weeks}, inactive: <b>${o.inactive_weeks}</b></div>
          <div>Expected burst windows: ${o.burst_windows.length ? o.burst_windows.map((w) => `<span class="badge warn">week of ${esc(w)}</span>`).join(' ') : '<span class="muted">none expected</span>'}</div>` : `<div>Average next ${o.n_weeks} weeks: <b>${vf(o.avg_next_4w)}</b></div>`}
          ${o.n_weeks < 4 ? '<div class="muted small">Horizon is shorter than 4 weeks, so the outlook covers fewer weeks.</div>' : ''}</div></div>
        <div class="card"><h3>Backtest (last ${r.backtest ? r.backtest.holdout : 0} points)</h3>${m ? `<table class="tbl" style="margin-top:8px"><thead><tr><th>Metric</th><th class="num">Model</th><th class="num">${esc(b.name)}</th></tr></thead><tbody>
          <tr><td>sMAPE</td><td class="num">${m.smape == null ? 'n/a' : fmt.num(m.smape, 1) + '%'}</td><td class="num">${b.smape == null ? 'n/a' : fmt.num(b.smape, 1) + '%'}</td></tr>
          <tr><td>MAE</td><td class="num">${fmt.compact(m.mae)}</td><td class="num">${fmt.compact(b.mae)}</td></tr>
          <tr><td>MASE</td><td class="num">${m.mase == null ? 'n/a' : fmt.num(m.mase, 2)}</td><td class="num">${b.mase == null ? 'n/a' : fmt.num(b.mase, 2)}</td></tr></tbody></table>
          <div class="muted small" style="margin-top:6px">${m.mae <= b.mae ? 'The model beat the baseline on MAE.' : 'The baseline was at least as accurate on MAE.'}</div>` : '<div class="muted" style="margin-top:8px">History is too short for a backtest.</div>'}</div>
        <div class="card"><h3>Change points and anomalies</h3><div class="small" style="margin-top:8px">${r.change_points.length ? r.change_points.map((c) => `<div>Level shift on <b>${esc(c.date)}</b>: ${vf(c.before)} to ${vf(c.after)} ${c.change_pct != null ? fmt.delta(c.change_pct) : ''}</div>`).join('') : '<div class="muted">No level shifts detected.</div>'}
          ${r.anomalies.length ? `<div style="margin-top:8px">${r.anomalies.length} anomal${r.anomalies.length === 1 ? 'y' : 'ies'}: ${r.anomalies.slice(0, 5).map((a) => `${esc(a.date)} (${a.direction})`).join(', ')}${r.anomalies.length > 5 ? ', ...' : ''}</div>` : '<div class="muted" style="margin-top:8px">No anomalies detected.</div>'}</div></div></div>
      <div class="card" style="margin-top:16px"><h3>Forecast values</h3><div id="fc-table"></div></div>`;
    drawChart(r);
    T.create(box.querySelector('#fc-table'), { csv: 'forecast_' + r.entity.replace(/\W+/g, '_'), pageSize: 14, defaultSort: { key: 'date', desc: false },
      rows: r.forecast.dates.map((d, i) => ({ date: d, p10: r.forecast.p10[i], p50: r.forecast.p50[i], p90: r.forecast.p90[i] })),
      columns: [{ key: 'date', label: r.granularity === 'weekly' ? 'Week starting' : 'Date' }, { key: 'p10', label: 'P10', num: true, fmt: (v) => fmt.num(v, 2) }, { key: 'p50', label: 'P50', num: true, fmt: (v) => fmt.num(v, 2) }, { key: 'p90', label: 'P90', num: true, fmt: (v) => fmt.num(v, 2) }] });
  }

  function results(root, res) {
    banner(res.model);
    const rs = res.results;
    root.innerHTML = `${(res.notes || []).map((n) => `<div class="banner info"><span>${esc(n)}</span></div>`).join('')}
      ${res.covariate_note ? `<div class="banner info"><span>${esc(res.covariate_note)}</span></div>` : ''}
      ${res.covariates_used && res.covariates_used.length ? `<div class="banner info"><span>Covariates used: ${esc(res.covariates_used.join(', '))}.</span></div>` : ''}
      ${res.cached ? '<div class="muted small" style="margin-bottom:8px">Loaded from cache for these filters and settings.</div>' : ''}
      <div class="card" style="margin-bottom:16px"><div class="card-head"><div><h3>Competitor outlook summary</h3><div class="sub">All forecast entities side by side</div></div></div><div id="fc-sum"></div></div>
      <div class="row" style="margin-bottom:12px"><label class="lbl" for="fc-ent">Entity</label><select id="fc-ent" style="max-width:320px">${rs.map((r, i) => `<option value="${i}">${esc(r.entity)} (${r.reliability.level})</option>`).join('')}</select></div><div id="fc-detail"></div>`;
    const addv = rs[0].metric === 'spend' || rs[0].metric === 'spots';
    T.create(root.querySelector('#fc-sum'), { csv: 'forecast_outlook', search: false, pageSize: 12, rows: rs.map((r) => ({ entity: r.entity, rel: r.reliability.level, trend: r.outlook.trend, chg: r.outlook.trend_change_pct, exp: addv ? r.outlook.expected_next_4w : r.outlook.avg_next_4w,
      act: addv ? `${r.outlook.active_weeks} active / ${r.outlook.inactive_weeks} inactive` : '', burst: (r.outlook.burst_windows || []).join('; ') })),
      columns: [{ key: 'entity', label: 'Entity', html: (v) => `<span class="swatch" style="background:${C.colorFor(v)}"></span>${esc(v)}` }, { key: 'rel', label: 'Reliability', html: (v) => `<span class="badge ${relCls[v]}">${v}</span>` },
        { key: 'trend', label: 'Trend', fmt: fmt.title }, { key: 'chg', label: 'Change vs recent', num: true, html: (v) => fmt.delta(v) }, { key: 'exp', label: addv ? 'Expected next weeks' : 'Average next weeks', num: true, fmt: (v) => fmt.num(v, addv ? 0 : 2) },
        { key: 'act', label: 'Weeks' }, { key: 'burst', label: 'Burst windows' }] });
    const sel = root.querySelector('#fc-ent'); const show = () => entityView(root.querySelector('#fc-detail'), res, rs[+sel.value]); sel.onchange = show; show();
  }

  async function tab(p, ctx) {
    const kind = ctx.kind, s0 = saved(kind);
    const lm = kind === 'lmrb';
    const metrics = lm ? { spend: 'Spend (LKR)', spots: 'Spot count', sov: 'Share of voice, spend (%)', cps: 'Cost per second (LKR)' } : { tvr: 'Average TVR', reach: 'Average reach per airing' };
    const ents = lm ? ['advertiser', 'product_group', 'channel', 'total'] : ['channel', 'category', 'daypart', 'program', 'total'];
    const st = { metric: s0.metric && metrics[s0.metric] ? s0.metric : Object.keys(metrics)[0], entity_type: ents.includes(s0.entity_type) ? s0.entity_type : ents[0], granularity: s0.granularity || 'weekly', horizon_days: s0.horizon_days || 28, history_days: s0.history_days || 0, covariates: s0.covariates !== false, entities: [] };
    p.innerHTML = `<div class="card"><div class="card-head"><div><h3>Forecast with TimesFM 2.0</h3><div class="sub">All selected entities are forecast in a single batched call. Filters apply.</div></div></div>
      <div class="filter-grid">
        <div class="field"><label for="f-metric">Target metric</label><select id="f-metric">${Object.entries(metrics).map(([k, l]) => `<option value="${k}" ${k === st.metric ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="field"><label for="f-ent">Entity</label><select id="f-ent">${ents.map((e) => `<option ${e === st.entity_type ? 'selected' : ''} value="${e}">${fmt.title(e.replace('_', ' '))}</option>`).join('')}</select></div>
        <div class="field" id="f-pick"></div>
        <div class="field"><label for="f-gran">Granularity</label><select id="f-gran"><option value="weekly" ${st.granularity === 'weekly' ? 'selected' : ''}>Weekly</option><option value="daily" ${st.granularity === 'daily' ? 'selected' : ''}>Daily</option></select></div>
        <div class="field"><label for="f-hor">Horizon</label><select id="f-hor">${[7, 14, 28, 56].map((h) => `<option value="${h}" ${h === +st.horizon_days ? 'selected' : ''}>${h} days</option>`).join('')}</select></div>
        <div class="field"><label for="f-hist">History window</label><select id="f-hist">${[[0, 'All history'], [30, 'Last 30 days'], [60, 'Last 60 days'], [90, 'Last 90 days'], [180, 'Last 180 days'], [365, 'Last 365 days']].map(([v, l]) => `<option value="${v}" ${v === +st.history_days ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="field"><label>Covariates</label><label class="row small"><input type="checkbox" id="f-cov" ${st.covariates ? 'checked' : ''}> Weekday and event calendar</label></div></div>
      <div class="row" style="margin-top:14px"><button class="btn primary" id="f-run" type="button">Run forecast</button><span class="muted small" id="f-min"></span></div>
      <div id="f-prog" hidden style="margin-top:12px"><div class="progress"><i></i></div><div class="muted small" id="f-msg" style="margin-top:6px"></div></div></div>
      <div id="f-out" style="margin-top:16px"></div>`;
    const q = (id) => p.querySelector(id);
    const info = await App.api.post('/api/forecast/entities', { kind, filters: ctx.filters(), options: ctx.options(), params: { entity_type: st.entity_type } }).catch(() => null);
    if (info) { banner(info.model); q('#f-min').textContent = `Minimum history: ${info.min_points.daily} daily or ${info.min_points.weekly} weekly points. Thinner series still run but are marked Low.`; }
    const pick = async () => {
      const r = await App.api.post('/api/forecast/entities', { kind, filters: ctx.filters(), options: ctx.options(), params: { entity_type: st.entity_type } }).catch(() => ({ entities: [] }));
      const box = q('#f-pick'); st.entities = [];
      if (st.entity_type === 'total') { box.innerHTML = '<label>Entities</label><div class="muted small" style="padding:8px 0">Whole filtered data</div>'; return; }
      box.innerHTML = ''; const w = App.filters.multi({ key: 'entities', label: 'Entities (blank = top 8)' }, r.entities.map((e) => e.name), st, () => {}); box.replaceWith(w); w.id = 'f-pick';
    };
    q('#f-ent').onchange = (e) => { st.entity_type = e.target.value; pick(); };
    await pick();
    q('#f-run').onclick = async () => {
      const params = { metric: q('#f-metric').value, entity_type: q('#f-ent').value, granularity: q('#f-gran').value, horizon_days: +q('#f-hor').value, history_days: +q('#f-hist').value || null, covariates: q('#f-cov').checked, entities: st.entities, max_entities: 8 };
      App.store.set('fc:' + kind, { ...params, entities: undefined });
      const btn = q('#f-run'), prog = q('#f-prog'), bar = prog.querySelector('i'), out = q('#f-out');
      btn.disabled = true; prog.hidden = false; prog.firstElementChild.classList.add('indet'); bar.style.width = ''; q('#f-msg').textContent = 'Starting'; out.innerHTML = App.skeleton(2);
      try {
        const { job_id } = await App.api.post('/api/forecast/start', { kind, filters: ctx.filters(), options: ctx.options(), params });
        let j; do { await new Promise((r) => setTimeout(r, 600)); j = await App.api.get('/api/forecast/job/' + job_id); q('#f-msg').textContent = j.message || ''; if (j.progress) { prog.firstElementChild.classList.remove('indet'); bar.style.width = Math.round(j.progress * 100) + '%'; } } while (j.status === 'running');
        if (j.status === 'error') throw new Error(j.error);
        if (!j.result.ok) { out.innerHTML = App.emptyState('Nothing to forecast', j.result.message); return; }
        App.lastForecast[kind] = { params, result: j.result }; results(out, j.result); App.shell.refreshModel();
      } catch (e) { out.innerHTML = App.emptyState('Forecast failed', e.message); App.toast(e.message, 'error', 8000); }
      finally { btn.disabled = false; prog.hidden = true; }
    };
    if (App.lastForecast[kind]) results(q('#f-out'), App.lastForecast[kind].result);
  }
  App.forecast = { tab };
})(window.App);
