/* Forecast studio: Forecast engine forecasts, driver scenarios (ROI planning) and pacing, with save-to-client. */
(function (App) {
  const { esc, fmt, charts: C, tables: T, $, $$ } = App;
  const relCls = { High: 'good', Medium: 'warn', Low: 'bad' };
  App.lastForecast = App.lastForecast || {}; App.lastScenarios = App.lastScenarios || {}; App.lastPacing = App.lastPacing || {};
  const unitFmt = (u) => ({ currency: (v) => fmt.lkrc(v), percent: (v) => fmt.pct(v, 1), rating: (v) => fmt.num(v, 2) }[u] || fmt.compact);
  const ENT_LABEL = { advertiser: 'Advertiser', product_group: 'Product group', channel: 'Channel', daypart: 'Daypart', timebelt: 'Time-belt', program: 'Recurring programme', category: 'Category', segment: 'Segment', total: 'Total' };
  const mode = (k) => App.store.get('fc-mode:' + k, 'forecast');

  function banner(model) {
    const el = document.getElementById('forecast-banner'); if (!el) return;
    el.innerHTML = model && model.backend === 'fallback'
      ? `<div class="banner bad" role="alert"><span><b>Fallback model in use.</b> The main forecast model could not be loaded. Forecasts use seasonal naive plus exponential smoothing. Treat them with extra care.</span></div>` : '';
  }
  async function saveToClient(ctx, ftype, params, result) {
    const title = window.prompt('Name this saved ' + ftype + ' (for example "Q4 leads forecast, base case"):', '');
    if (title === null) return;
    try { await App.api.post('/api/saved-forecasts', { title: title || ftype, ftype, request: { kind: ctx.kind, dataset: ctx.dataset(), filters: ctx.filters(), options: ctx.options(), params }, result }); App.toast('Saved to the client. Find it under Client overview.', 'ok'); }
    catch (e) { App.toast(e.message, 'error'); }
  }

  /* ================================================================ forecast view */
  const cpPlugin = { id: 'cp', afterDatasetsDraw(chart, a, opts) {
    if (!opts || !opts.lines) return;
    const { ctx, chartArea: ar, scales: { x } } = chart; ctx.save(); ctx.setLineDash([4, 4]); ctx.strokeStyle = C.css('--bad') || '#d6364f'; ctx.lineWidth = 1;
    opts.lines.forEach((l) => { const px = x.getPixelForValue(l.index); if (px >= ar.left && px <= ar.right) { ctx.beginPath(); ctx.moveTo(px, ar.top); ctx.lineTo(px, ar.bottom); ctx.stroke(); } }); ctx.restore(); } };

  function drawChart(id, r) {
    const hd = r.history.dates, fd = r.forecast.dates, labels = hd.concat(fd), nh = hd.length;
    const pad = (arr, off) => Array(off).fill(null).concat(arr);
    const last = r.history.values[nh - 1];
    const p10 = pad(r.forecast.p10, nh), p90 = pad(r.forecast.p90, nh), p50 = pad(r.forecast.p50, nh);
    p10[nh - 1] = p50[nh - 1] = p90[nh - 1] = last;
    const col = C.PALETTE[0], vf = unitFmt(r.unit);
    const ds = [
      { label: 'P90', data: p90, borderColor: 'transparent', backgroundColor: col + '30', fill: '+1', pointRadius: 0, order: 5 },
      { label: 'P10', data: p10, borderColor: 'transparent', backgroundColor: col + '30', fill: false, pointRadius: 0, order: 5 },
      { label: 'Forecast (P50)', data: p50, borderColor: col, borderDash: [6, 4], pointRadius: 0, order: 2 },
      { label: 'Actual', data: r.history.values.concat(Array(fd.length).fill(null)), borderColor: C.css('--text') || '#222', backgroundColor: C.css('--text') || '#222', pointRadius: nh > 60 ? 0 : 2, order: 1 },
    ];
    if (r.backtest) {
      const arr = Array(labels.length).fill(null), lo = arr.slice(), hi = arr.slice();
      r.backtest.dates.forEach((d, k) => { const i = labels.indexOf(d); if (i >= 0) { arr[i] = r.backtest.pred[k]; lo[i] = r.backtest.p10[k]; hi[i] = r.backtest.p90[k]; } });
      ds.push({ label: 'Expected band (monitoring)', data: hi, borderColor: 'transparent', backgroundColor: C.PALETTE[2] + '28', fill: '+1', pointRadius: 0, order: 6 });
      ds.push({ label: 'lo', data: lo, borderColor: 'transparent', fill: false, pointRadius: 0, order: 6 });
      ds.push({ label: 'Backtest forecast', data: arr, borderColor: C.PALETTE[2], pointRadius: 3, borderDash: [2, 3], order: 3 });
    }
    const marks = Array(labels.length).fill(null);
    r.anomalies.forEach((a) => { const i = labels.indexOf(a.date); if (i >= 0) marks[i] = a.value; });
    (r.band_breaches || []).forEach((b) => { const i = labels.indexOf(b.date); if (i >= 0) marks[i] = b.actual; });
    if (marks.some((v) => v != null)) ds.push({ label: 'Alert', data: marks, showLine: false, pointStyle: 'triangle', pointRadius: 7, borderColor: C.css('--bad') || 'red', backgroundColor: C.css('--bad') || 'red', order: 0 });
    const ch = C.line({ id, labels, datasets: ds, valueFmt: vf });
    if (ch) {
      ch.options.plugins.cp = { lines: r.change_points.map((c) => ({ index: labels.indexOf(c.date) })).filter((l) => l.index >= 0) };
      const hide = ['P10', 'P90', 'lo'];
      ch.options.plugins.legend.labels.filter = (i) => !hide.includes(i.text);
      ch.options.plugins.tooltip.filter = (i) => !hide.includes(i.dataset.label);
      ch.options.plugins.nowLine = { index: nh - 1 }; ch.config.plugins = [cpPlugin, C.nowLine]; ch.update();
    }
  }

  function entityView(box, res, r) {
    const rel = r.reliability, o = r.outlook, vf = unitFmt(r.unit), add = o.additive;
    const m = r.backtest ? r.backtest.model : null, b = r.backtest ? r.backtest.baseline : null;
    const blk = o.block === 'month' ? 'month' : 'week';
    box.innerHTML = `
      <div class="row" style="margin-bottom:12px"><h3>${esc(r.entity)}: ${esc(r.metric_label)}</h3><span class="badge ${relCls[rel.level]}" title="${esc(rel.reasons.join(' '))}">Forecast reliability: ${rel.level}</span>
        <span class="badge info">${r.n_points} ${r.granularity} points</span><span class="badge ${res.backend === 'timesfm' ? 'good' : 'warn'}">${res.backend === 'timesfm' ? 'Forecast engine' : 'Fallback model'}</span></div>
      <ul class="muted small" style="margin:0 0 12px;padding-left:18px">${rel.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}${r.warnings.map((x) => `<li><b>Warning:</b> ${esc(x)}</li>`).join('')}</ul>
      ${C.box('c-fc', 'Actuals and forecast', 'Solid line: actual data. Dashed line and hatched area: forecast. Blue band: likely range (P10 to P90). Orange band: the range expected for the most recent periods. Red triangles: alerts. Dashed red lines: level shifts.', { tall: true, pill: 'Actual + forecast' })}
      <div class="grid g2" style="margin-top:16px">
        <div class="card"><h3>Outlook</h3><div class="stack" style="gap:8px;margin-top:10px">
          <div>Trend: <span class="badge ${o.trend === 'rising' ? 'good' : o.trend === 'falling' ? 'bad' : 'info'}">${esc(o.trend)}</span> ${o.trend_change_pct != null ? fmt.delta(o.trend_change_pct) + ' vs recent' : ''}</div>
          ${add ? `<div>Expected next ${o.n_weeks} ${blk}${o.n_weeks === 1 ? '' : 's'}: <b>${vf(o.expected_next_4w)}</b> <span class="muted small">(indicative range ${vf(o.expected_next_4w_p10)} to ${vf(o.expected_next_4w_p90)})</span></div>
          <div>Active ${blk}s: <b>${o.active_weeks}</b> of ${o.n_weeks}, quiet: <b>${o.inactive_weeks}</b></div>
          <div>Burst ${blk}s: ${o.burst_windows.length ? o.burst_windows.map((w) => `<span class="badge warn">${esc(w)}</span>`).join(' ') : '<span class="muted">none expected</span>'}</div>` : `<div>Average next ${o.n_weeks} ${blk}s: <b>${vf(o.avg_next_4w)}</b></div>`}
          ${o.n_weeks < (blk === 'month' ? 3 : 4) ? '<div class="muted small">The horizon is short, so the outlook covers fewer periods.</div>' : ''}</div></div>
        <div class="card"><h3>Demand peaks and launch timing</h3><div class="small" style="margin-top:10px">${r.peaks.peaks.length ? r.peaks.peaks.map((p) => `<div style="margin-bottom:6px">Peak around <b>${esc(p.date)}</b>: ${vf(p.expected)} ${p.vs_history_pct != null ? `(${fmt.delta(p.vs_history_pct)} vs the historical average)` : ''}. Be live by <b>${esc(p.launch_by)}</b>.</div>`).join('')
          : '<div class="muted">No clear peak above normal in this horizon.</div>'}
          ${r.peaks.season_peak ? `<div class="muted" style="margin-top:6px">Seasonal high month in history: ${new Date(2000, r.peaks.season_peak.month - 1, 1).toLocaleString('en', { month: 'long' })} (index ${fmt.num(r.peaks.season_peak.index_vs_avg)}).</div>` : ''}</div></div>
        <div class="card"><h3>Backtest (last ${r.backtest ? r.backtest.holdout : 0} points)</h3>${m ? `<table class="tbl" style="margin-top:8px"><thead><tr><th>Metric</th><th class="num">Forecast</th><th class="num">${esc(b.name)}</th></tr></thead><tbody>
          <tr><td>sMAPE</td><td class="num">${m.smape == null ? 'n/a' : fmt.num(m.smape, 1) + '%'}</td><td class="num">${b.smape == null ? 'n/a' : fmt.num(b.smape, 1) + '%'}</td></tr>
          <tr><td>MAE</td><td class="num">${fmt.compact(m.mae)}</td><td class="num">${fmt.compact(b.mae)}</td></tr>
          <tr><td>MASE</td><td class="num">${m.mase == null ? 'n/a' : fmt.num(m.mase, 2)}</td><td class="num">${b.mase == null ? 'n/a' : fmt.num(b.mase, 2)}</td></tr>
          <tr><td>Inside P10 to P90</td><td class="num">${m.coverage == null ? 'n/a' : fmt.num(m.coverage, 0) + '%'}</td><td class="num muted">target about 80%</td></tr></tbody></table>
          <div class="muted small" style="margin-top:6px">${m.mae <= b.mae ? 'The forecast beat the baseline on MAE.' : 'The baseline was at least as accurate on MAE.'}</div>` : '<div class="muted" style="margin-top:8px">History is too short for a backtest.</div>'}</div>
        <div class="card"><h3>Monitoring alerts</h3><div class="small" style="margin-top:8px">${(r.band_breaches || []).length ? r.band_breaches.map((x) => `<div style="margin-bottom:4px"><span class="badge ${x.severity === 'high' ? 'bad' : 'warn'}">${x.direction}</span> ${esc(x.text)} (actual ${vf(x.actual)}, expected ${vf(x.p10)} to ${vf(x.p90)})</div>`).join('')
          : '<div class="muted">Recent actuals stayed inside the expected band.</div>'}
          ${r.change_points.length ? r.change_points.map((c) => `<div>Level shift on <b>${esc(c.date)}</b>: ${vf(c.before)} to ${vf(c.after)} ${c.change_pct != null ? fmt.delta(c.change_pct) : ''}</div>`).join('') : ''}
          ${r.anomalies.length ? `<div style="margin-top:6px">${r.anomalies.length} unusual point${r.anomalies.length === 1 ? '' : 's'} in history: ${r.anomalies.slice(0, 4).map((a) => `${esc(a.date)} (${a.direction})`).join(', ')}${r.anomalies.length > 4 ? ', ...' : ''}</div>` : ''}</div></div></div>
      <div class="card" style="margin-top:16px"><h3>Forecast values</h3><div id="fc-table"></div></div>`;
    drawChart('c-fc', r);
    T.create(box.querySelector('#fc-table'), { csv: 'forecast_' + r.entity.replace(/\W+/g, '_'), pageSize: 14, defaultSort: { key: 'date', desc: false },
      rows: r.forecast.dates.map((d, i) => ({ date: d, p10: r.forecast.p10[i], p50: r.forecast.p50[i], p90: r.forecast.p90[i] })),
      columns: [{ key: 'date', label: r.granularity === 'daily' ? 'Date' : r.granularity === 'weekly' ? 'Week starting' : 'Month' }, { key: 'p10', label: 'P10', num: true, fmt: (v) => fmt.num(v, 2) }, { key: 'p50', label: 'P50', num: true, fmt: (v) => fmt.num(v, 2) }, { key: 'p90', label: 'P90', num: true, fmt: (v) => fmt.num(v, 2) }] });
  }

  function forecastResults(root, res, ctx, params, savedNote) {
    banner(res.model);
    const rs = res.results, et = res.params.entity_type;
    const rising = rs.filter((r) => r.outlook.trend === 'rising').sort((a, b) => b.outlook.trend_change_pct - a.outlook.trend_change_pct);
    const falling = rs.filter((r) => r.outlook.trend === 'falling').sort((a, b) => a.outlook.trend_change_pct - b.outlook.trend_change_pct);
    const nm = { timebelt: 'time-belts', channel: 'channels', category: 'categories', daypart: 'dayparts', advertiser: 'competitors', segment: 'segments', product_group: 'product groups', program: 'programmes' }[et] || 'entities';
    const li = (r) => `<li><b>${esc(r.entity)}</b> ${fmt.delta(r.outlook.trend_change_pct)} <span class="badge ${relCls[r.reliability.level]}">${r.reliability.level}</span></li>`;
    const breaches = rs.reduce((a, r) => a + (r.band_breaches || []).length, 0);
    root.innerHTML = `${savedNote ? `<div class="banner info"><span>${esc(savedNote)}</span></div>` : ''}${(res.notes || []).map((n) => `<div class="banner info"><span>${esc(n)}</span></div>`).join('')}
      ${res.covariate_note ? `<div class="banner info"><span>${esc(res.covariate_note)}</span></div>` : ''}
      ${res.covariates_used && res.covariates_used.length ? `<div class="banner info"><span>Calendar covariates used: ${esc(res.covariates_used.join(', '))}.</span></div>` : ''}
      ${rs.length > 1 ? `<div class="grid g2" style="margin-bottom:16px"><div class="card"><h3>Emerging ${nm}</h3><ul class="small" style="margin:8px 0 0;padding-left:18px">${rising.slice(0, 6).map(li).join('') || '<li class="muted">None rising more than 10%.</li>'}</ul></div>
        <div class="card"><h3>Declining ${nm}</h3><ul class="small" style="margin:8px 0 0;padding-left:18px">${falling.slice(0, 6).map(li).join('') || '<li class="muted">None falling more than 10%.</li>'}</ul></div></div>` : ''}
      <div class="card" style="margin-bottom:16px"><div class="card-head"><div><h3>Outlook summary</h3><div class="sub">${rs.length} ${nm} forecast in one batched call${breaches ? `, ${breaches} monitoring alert${breaches === 1 ? '' : 's'}` : ''}${res.cached ? ', served from cache' : ''}.</div></div>
        <div class="row"><button class="btn sm" id="fc-save" type="button">Save to client</button></div></div><div id="fc-sum"></div></div>
      <div class="row" style="margin-bottom:12px"><label class="lbl" for="fc-ent">Entity</label><select id="fc-ent" style="max-width:340px">${rs.map((r, i) => `<option value="${i}">${esc(r.entity)} (${r.reliability.level})</option>`).join('')}</select></div><div id="fc-detail"></div>`;
    const addv = rs[0].outlook.additive, vf = unitFmt(rs[0].unit);
    T.create(root.querySelector('#fc-sum'), { csv: 'forecast_outlook', search: rs.length > 10, pageSize: 12, defaultSort: { key: 'chg', desc: true },
      rows: rs.map((r) => ({ entity: r.entity, rel: r.reliability.level, trend: r.outlook.trend, chg: r.outlook.trend_change_pct, exp: addv ? r.outlook.expected_next_4w : r.outlook.avg_next_4w,
        act: addv ? `${r.outlook.active_weeks} active / ${r.outlook.inactive_weeks} quiet` : '', peak: r.peaks.peaks.length ? r.peaks.peaks[0].date : '', alerts: (r.band_breaches || []).length })),
      columns: [{ key: 'entity', label: ENT_LABEL[et] || 'Entity', html: (v) => `<span class="swatch" style="background:${C.colorFor(v)}"></span>${esc(v)}` }, { key: 'rel', label: 'Reliability', html: (v) => `<span class="badge ${relCls[v]}">${v}</span>` },
        { key: 'trend', label: 'Trend', fmt: fmt.title }, { key: 'chg', label: 'Change vs recent', num: true, html: (v) => fmt.delta(v) }, { key: 'exp', label: addv ? 'Expected next 4 weeks' : 'Average next 4 weeks', num: true, fmt: (v) => vf(v) },
        { key: 'act', label: 'Activity' }, { key: 'peak', label: 'Next peak' }, { key: 'alerts', label: 'Alerts', num: true }] });
    const sel = root.querySelector('#fc-ent'); const show = () => entityView(root.querySelector('#fc-detail'), res, rs[+sel.value]); sel.onchange = show; show();
    root.querySelector('#fc-save').onclick = () => saveToClient(ctx, 'forecast', params, res);
  }

  /* ================================================================ scenarios view */
  function scenarioResults(root, res, ctx, params) {
    const s = res.scenarios, vfD = fmt.lkrc, vfK = (v) => fmt.num(v, 0), ratioLabel = params.ratio_label || 'Cost per result';
    const base = s.find((x) => x.scenario === 'Current pace');
    const hist = res.historical_ratio;
    let rec = null;
    if (base) {
      const ok = s.filter((x) => x.driver_total > base.driver_total && x.marginal_ratio != null && hist != null && x.marginal_ratio <= hist * 1.5);
      rec = ok.length ? ok.sort((a, b) => b.driver_total - a.driver_total)[0] : null;
    }
    root.innerHTML = `${res.warnings.map((w) => `<div class="banner"><span>${esc(w)}</span></div>`).join('')}
      <div class="banner info"><span>${res.method === 'timesfm_xreg' ? 'Forecast engine with the driver as a covariate (XReg).' : 'Linear driver model with seasonal smoothing (calendar and driver covariates were not available).'}
        ${res.driver_effect ? ` In history, each extra unit of the driver went with ${fmt.num(res.driver_effect.slope, 4)} more results (fit R2 ${fmt.num(res.driver_effect.r2, 2)}).` : ''}
        ${hist != null ? ` Historical ${esc(ratioLabel)}: <b>${fmt.lkr(hist)}</b>.` : ''}</span></div>
      ${rec ? `<div class="banner" style="background:var(--good-soft);border-color:var(--good)"><span><b>Suggested plan: ${esc(rec.scenario)}.</b> Expected ${vfK(rec.kpi_p50)} results for ${vfD(rec.driver_total)}, with each extra result costing about ${fmt.lkr(rec.marginal_ratio)} (within 1.5x the historical average).</span></div>` : ''}
      <div class="card"><div class="card-head"><div><h3>Scenario comparison</h3><div class="sub">Next ${res.params.horizon_points} ${esc(res.params.granularity)} periods. Ranges are P10 to P90.</div></div><button class="btn sm" id="sc-save" type="button">Save to client</button></div><div id="sc-table"></div></div>
      <div class="grid g2" style="margin-top:16px">${C.box('c-sc', 'Expected results by scenario', 'All values are forecasts. Bars: P50. Whiskers in the tooltip: P10 to P90.', { pill: 'Forecast' })}${C.box('c-sc2', 'Results over the horizon', 'Forecast P50 per period', { pill: 'Forecast' })}</div>`;
    T.create(root.querySelector('#sc-table'), { csv: 'scenarios', search: false, rows: s.map((x) => ({ ...x })), columns: [
      { key: 'scenario', label: 'Scenario' }, { key: 'driver_total', label: 'Planned ' + (params.driver_label || 'driver'), num: true, fmt: vfD },
      { key: 'kpi_p50', label: 'Expected results (P50)', num: true, fmt: vfK }, { key: 'kpi_p10', label: 'P10', num: true, fmt: vfK }, { key: 'kpi_p90', label: 'P90', num: true, fmt: vfK },
      { key: 'ratio_p50', label: ratioLabel + ' (P50)', num: true, fmt: (v) => fmt.lkr(v) }, { key: 'ratio_best', label: 'Best case', num: true, fmt: (v) => fmt.lkr(v) }, { key: 'ratio_worst', label: 'Worst case', num: true, fmt: (v) => fmt.lkr(v) },
      { key: 'incremental_kpi', label: 'Extra results vs current', num: true, fmt: (v) => (v == null ? '' : fmt.num(v, 0)) }, { key: 'marginal_ratio', label: 'Cost per extra result', num: true, fmt: (v) => (v == null ? '' : fmt.lkr(v)) }] });
    C.bar({ id: 'c-sc', labels: s.map((x) => x.scenario), valueFmt: vfK, datasets: [{ label: 'Expected results', data: s.map((x) => x.kpi_p50), backgroundColor: s.map((x, i) => C.PALETTE[i % 12]) }] });
    C.line({ id: 'c-sc2', labels: s[0].series.dates, valueFmt: vfK, datasets: s.map((x, i) => ({ label: x.scenario, data: x.series.p50, borderColor: C.PALETTE[i % 12], backgroundColor: C.PALETTE[i % 12] })) });
    const bc = Chart.getChart('c-sc'); if (bc) { bc.options.plugins.tooltip.callbacks.afterLabel = (c) => `Range ${vfK(s[c.dataIndex].kpi_p10)} to ${vfK(s[c.dataIndex].kpi_p90)}`; bc.update(); }
    root.querySelector('#sc-save').onclick = () => saveToClient(ctx, 'scenarios', params, res);
  }

  /* ================================================================ pacing view */
  function pacingResults(root, res, ctx, params) {
    const vf = unitFmt(params.unit || 'number');
    const cls = { 'On track': 'good', 'Under pacing': 'bad', 'Over pacing': 'warn' }[res.status];
    root.innerHTML = `<div class="kpis">
        <div class="kpi fc"><span class="fc-pill tile">Forecast</span><div class="k-lbl">Status</div><div class="k-val"><span class="badge ${cls}" style="font-size:15px">${esc(res.status)}</span></div><div class="k-sub">${res.target_reached_in_band ? 'Target is inside the P10 to P90 range' : 'Target is outside the likely range'}</div></div>
        <div class="kpi"><div class="k-lbl">Actual to date</div><div class="k-val">${vf(res.actual_to_date)}</div><div class="k-sub">${fmt.pct(res.pct_of_target, 0)} of target, ${fmt.pct(res.time_elapsed_pct, 0)} of time gone</div></div>
        <div class="kpi fc"><span class="fc-pill tile">Forecast</span><div class="k-lbl">Projected end total (P50)</div><div class="k-val">${vf(res.projected_p50)}</div><div class="k-sub">Range ${vf(res.projected_p10)} to ${vf(res.projected_p90)}</div></div>
        <div class="kpi fc"><span class="fc-pill tile">Forecast</span><div class="k-lbl">Versus target</div><div class="k-val">${fmt.delta(res.projected_vs_target_pct)}</div><div class="k-sub">Target ${vf(res.target)}</div></div>
        <div class="kpi"><div class="k-lbl">Needed per day</div><div class="k-val">${res.required_per_day == null ? 'n/a' : res.required_per_day <= 0 ? 'Target reached' : vf(res.required_per_day)}</div><div class="k-sub">Recent run rate ${vf(res.recent_run_rate)} per day, ${res.remaining_days} days left</div></div></div>
      ${res.notes.map((n) => `<div class="banner info" style="margin-top:12px"><span>${esc(n)}</span></div>`).join('')}
      <div style="margin-top:16px">${C.box('c-pace', `Cumulative ${esc(res.metric_label)} against target`, `${esc(res.entity)}, flight ${esc(res.start)} to ${esc(res.end)}. Band: P10 to P90 projection.`, { tall: true, pill: 'Actual + forecast', extra: '<button class="btn sm" id="pc-save" type="button">Save to client</button>' })}</div>`;
    const labels = res.cumulative.dates.concat(res.projection.dates), n = res.cumulative.dates.length;
    const pad = (a) => Array(n - 1).fill(null).concat([res.cumulative.values[n - 1]], a);
    C.line({ id: 'c-pace', labels, valueFmt: vf, datasets: [
      { label: 'P90', data: pad(res.projection.p90), borderColor: 'transparent', backgroundColor: C.PALETTE[0] + '30', fill: '+1', pointRadius: 0 },
      { label: 'P10', data: pad(res.projection.p10), borderColor: 'transparent', fill: false, pointRadius: 0 },
      { label: 'Projection (P50)', data: pad(res.projection.p50), borderColor: C.PALETTE[0], borderDash: [6, 4], pointRadius: 0 },
      { label: 'Actual to date', data: res.cumulative.values.concat(Array(res.projection.dates.length).fill(null)), borderColor: C.css('--text'), pointRadius: 0 },
      { label: 'Target', data: labels.map(() => res.target), borderColor: C.css('--bad'), borderDash: [3, 3], pointRadius: 0 }] });
    const ch = Chart.getChart('c-pace'); if (ch) { ch.options.plugins.legend.labels.filter = (i) => !['P10', 'P90'].includes(i.text); ch.options.plugins.nowLine = { index: n - 1 }; ch.config.plugins = [C.nowLine]; ch.update(); }
    root.querySelector('#pc-save').onclick = () => saveToClient(ctx, 'pacing', params, res);
  }

  /* ================================================================ tab */
  async function tab(p, ctx) {
    const kind = ctx.kind, fk = ctx.fkey(), s0 = App.store.get('fc:' + fk, {});
    const info = await Promise.all([App.data.entities(ctx.body()), App.api.get('/api/forecast/limits'), App.api.get('/api/model-status')])
      .then(([e, lim, model]) => ({ catalog: e.catalog, date_max: e.date_max, default_granularity: e.default_granularity, min_points: lim.min_points, model }))
      .catch((e) => { p.innerHTML = App.emptyState('Forecasting is not available', e.message); return null; });
    if (!info) return;
    banner(info.model);
    const cat = info.catalog, metrics = cat.metrics, units = cat.units, ents = cat.entities;
    const kpiMeta = ctx.state.meta || {};
    const drivers = kind === 'kpi' ? (kpiMeta.metrics || []).filter((m) => m.agg === 'sum' && (m.role === 'driver' || m.unit === 'currency')).map((m) => m.key) : (metrics.grp ? ['spend'] : []);
    const targets = kind === 'kpi' ? (kpiMeta.metrics || []).filter((m) => m.agg === 'sum' && m.role !== 'driver' && m.unit !== 'currency').map((m) => m.key) : (metrics.grp ? ['grp', 'spots'] : []);
    const additive = Object.keys(metrics).filter((k) => kind === 'kpi' ? (kpiMeta.metrics || []).some((m) => m.key === k && m.agg === 'sum') : ['spend', 'spots', 'grp'].includes(k));
    const modes = [['forecast', 'Forecast']].concat(drivers.length && targets.length ? [['scenarios', 'Spend scenarios']] : []).concat(kind !== 'tv' && additive.length ? [['pacing', 'Pacing']] : []);
    let cur = modes.find((m) => m[0] === mode(fk)) ? mode(fk) : 'forecast';
    const defGran = info.default_granularity || s0.granularity || 'weekly';
    const opt = (o, sel) => Object.entries(o).map(([k, l]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(l)}</option>`).join('');
    const entOpts = (sel, list) => (list || ents).map((e) => `<option value="${e}" ${e === sel ? 'selected' : ''}>${esc(ENT_LABEL[e] || e)}</option>`).join('');
    const horizons = { daily: [7, 14, 28, 56, 91], weekly: [28, 56, 91, 182], monthly: [91, 182, 365] };
    p.innerHTML = `<div class="card"><div class="card-head"><div><h3>Forecast studio</h3><div class="sub">The Media Radar forecast engine. Series are built in this browser from the filtered data; only those series are sent. ${kind === 'lmrb' ? 'Competitor set applies.' : ''}</div></div>
        <div class="seg" id="fm-seg">${modes.map(([k, l]) => `<button type="button" data-m="${k}" aria-pressed="${k === cur}">${l}</button>`).join('')}</div></div>
      <div id="fm-form"></div>
      <div id="f-prog" hidden style="margin-top:12px"><div class="progress"><i></i></div><div class="muted small" id="f-msg" style="margin-top:6px"></div></div></div>
      <div id="f-out" style="margin-top:16px"></div>`;
    const form = $('#fm-form', p), out = $('#f-out', p), prog = $('#f-prog', p), msg = $('#f-msg', p);

    const series = (extra) => App.data.series(ctx.body(extra));
    const onJob = (p2, m) => App.loader.progress(p2 ? Math.max(0.05, p2) : null, m || '');
    const run = async (btn, starter, onDone) => {
      btn.disabled = true; App.loader.show('Running forecast', 'Building series in this browser'); App.loader.progress(null); out.innerHTML = '';
      try {
        const res = await starter();
        if (!res.ok) { out.innerHTML = App.emptyState('Nothing to forecast', res.message); return; }
        onDone(res); App.shell.refreshModel();
      } catch (e) { out.innerHTML = App.emptyState('Forecast failed', e.message); App.toast(e.message, 'error', 8000); }
      finally { btn.disabled = false; App.loader.hide(250); }
    };

    async function entityPicker(box, et, metric, multi, sel) {
      box.innerHTML = '';
      if (et === 'total') { box.innerHTML = '<label>Entities</label><div class="muted small" style="padding:8px 0">Whole filtered data</div>'; return { get: () => [] }; }
      const r = await App.data.entities(ctx.body({ entity_type: et, metric })).catch(() => ({ entities: [] }));
      const names = r.entities.map((e) => e.name);
      if (multi) {
        const st = { entities: [] };
        const w = App.filters.multi({ key: 'entities', label: `${ENT_LABEL[et] || 'Entities'} (blank = top ${et === 'timebelt' ? 24 : 8})` }, names, st, () => {});
        box.appendChild(w); return { get: () => st.entities };
      }
      box.innerHTML = `<label for="pk-ent">${esc(ENT_LABEL[et] || 'Entity')}</label><select id="pk-ent">${names.map((n) => `<option ${n === sel ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>`;
      return { get: () => [box.querySelector('select').value] };
    }

    function forecastForm() {
      const st = { metric: metrics[s0.metric] ? s0.metric : Object.keys(metrics)[0], et: ents.includes(s0.entity_type) ? s0.entity_type : (kind === 'tv' ? 'timebelt' : ents[0]), gran: s0.granularity || defGran };
      form.innerHTML = `<div class="filter-grid">
        <div class="field"><label for="f-metric">Target metric</label><select id="f-metric">${opt(metrics, st.metric)}</select></div>
        <div class="field"><label for="f-ent">Forecast by</label><select id="f-ent">${entOpts(st.et)}</select></div>
        <div class="field" id="f-pick"></div>
        <div class="field"><label for="f-gran">Granularity</label><select id="f-gran">${['daily', 'weekly', 'monthly'].map((g) => `<option ${g === st.gran ? 'selected' : ''} value="${g}">${fmt.title(g)}</option>`).join('')}</select></div>
        <div class="field"><label for="f-hor">Horizon</label><select id="f-hor"></select></div>
        <div class="field"><label for="f-hist">History window</label><select id="f-hist">${[[0, 'All history'], [90, 'Last 90 days'], [180, 'Last 180 days'], [365, 'Last year'], [730, 'Last 2 years']].map(([v, l]) => `<option value="${v}" ${v === +(s0.history_days || 0) ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="field"><label for="f-hold">Monitoring window</label><select id="f-hold">${[[0, 'Auto'], [3, 'Last 3 periods'], [7, 'Last 7 periods'], [14, 'Last 14 periods']].map(([v, l]) => `<option value="${v}" ${v === +(s0.holdout || 0) ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="field"><label>Covariates</label><label class="row small"><input type="checkbox" id="f-cov" ${s0.covariates !== false ? 'checked' : ''}> Weekday and Sri Lankan event calendar</label></div></div>
        <div class="row" style="margin-top:14px"><button class="btn primary" id="f-run" type="button">Run forecast</button><span class="muted small">Minimum history: ${info.min_points.daily} daily, ${info.min_points.weekly} weekly or ${info.min_points.monthly} monthly points. Thinner series still run and are marked Low.</span></div>`;
      const hor = () => { const g = $('#f-gran', form).value; const want = +(s0.horizon_days || 28); $('#f-hor', form).innerHTML = horizons[g].map((h) => `<option value="${h}" ${h === want ? 'selected' : ''}>${h} days${h >= 91 ? ` (${Math.round(h / 30.4)} months)` : ''}</option>`).join(''); };
      hor(); $('#f-gran', form).onchange = hor;
      let picker;
      const repick = async () => { picker = await entityPicker($('#f-pick', form), $('#f-ent', form).value, $('#f-metric', form).value, true); };
      $('#f-ent', form).onchange = repick; repick();
      $('#f-run', form).onclick = (e) => {
        const et = $('#f-ent', form).value;
        const params = { metric: $('#f-metric', form).value, entity_type: et, granularity: $('#f-gran', form).value, horizon_days: +$('#f-hor', form).value, history_days: +$('#f-hist', form).value || null,
          holdout: +$('#f-hold', form).value || null, covariates: $('#f-cov', form).checked, entities: picker ? picker.get() : [], max_entities: et === 'timebelt' ? 24 : 8 };
        App.store.set('fc:' + fk, { ...params, entities: undefined });
        run(e.currentTarget, async () => {
          const s = await series({ entity_type: et, metric: params.metric, granularity: params.granularity, entities: params.entities, history_days: params.history_days, max_entities: params.max_entities });
          if (!s.series.length) return { ok: false, message: s.notes[0] || 'No series could be built.' };
          App.loader.progress(null, `Forecasting ${s.series.length} series`);
          const res = await App.runJob('/api/forecast/run', { kind, series: s.series, params: { ...params, granularity: s.granularity } }, onJob);
          if (res.ok) res.notes = s.notes.concat(res.notes || []);
          return res;
        }, (res) => { App.lastForecast[fk] = { params, result: res }; forecastResults(out, res, ctx, params); });
      };
      if (App.lastForecast[fk]) forecastResults(out, App.lastForecast[fk].result, ctx, App.lastForecast[fk].params);
    }

    function scenarioForm() {
      const ss = App.store.get('sc:' + fk, {});
      const tOpts = Object.fromEntries(targets.map((k) => [k, metrics[k]])), dOpts = Object.fromEntries(drivers.map((k) => [k, metrics[k]]));
      const ratios = (kpiMeta.ratios || []);
      const scEnts = kind === 'lmrb' ? ['advertiser', 'total'] : ents;
      form.innerHTML = `<p class="muted small" style="margin-top:0">What happens to results if the client spends more or less? The forecast engine forecasts the result with the planned spend as a covariate, then derives the cost per result.</p>
        <div class="filter-grid">
        <div class="field"><label for="s-target">Result to forecast</label><select id="s-target">${opt(tOpts, ss.target)}</select></div>
        <div class="field"><label for="s-driver">Driver (planned)</label><select id="s-driver">${opt(dOpts, ss.driver)}</select></div>
        <div class="field"><label for="s-et">For</label><select id="s-et">${entOpts(ss.entity_type || scEnts[0], scEnts)}</select></div>
        <div class="field" id="s-pick"></div>
        <div class="field"><label for="s-gran">Granularity</label><select id="s-gran">${['daily', 'weekly', 'monthly'].map((g) => `<option ${g === (ss.granularity || defGran) ? 'selected' : ''} value="${g}">${fmt.title(g)}</option>`).join('')}</select></div>
        <div class="field"><label for="s-hor">Planning horizon</label><select id="s-hor">${[28, 56, 91, 182].map((h) => `<option value="${h}" ${h === +(ss.horizon_days || 28) ? 'selected' : ''}>${h} days</option>`).join('')}</select></div>
        <div class="field"><label for="s-mult">Spend changes (%)</label><input type="text" id="s-mult" value="${esc(ss.mult || '-20, 0, 20, 50')}" placeholder="-20, 0, 20, 50"></div>
        <div class="field"><label for="s-bud">Or fixed budgets for the horizon (LKR)</label><input type="text" id="s-bud" value="${esc(ss.bud || '')}" placeholder="5000000, 7500000"></div></div>
        <div class="row" style="margin-top:14px"><button class="btn primary" id="s-run" type="button">Run scenarios</button></div>`;
      let picker;
      const repick = async () => { const et = $('#s-et', form).value; picker = await entityPicker($('#s-pick', form), et, $('#s-driver', form).value, false, ss.entity); };
      $('#s-et', form).onchange = repick; repick();
      $('#s-run', form).onclick = (e) => {
        const nums = (v) => v.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean).map(Number).filter((x) => !Number.isNaN(x));
        const target = $('#s-target', form).value, driver = $('#s-driver', form).value, et = $('#s-et', form).value;
        const ratio = ratios.find((r) => r.num === driver && r.den === target);
        const params = { target, driver, entity_type: et, entity: et === 'total' ? null : (picker ? picker.get()[0] : null), granularity: $('#s-gran', form).value, horizon_days: +$('#s-hor', form).value,
          multipliers: nums($('#s-mult', form).value).map((x) => 1 + x / 100), budgets: nums($('#s-bud', form).value), driver_label: metrics[driver],
          ratio_label: ratio ? ratio.label : (target === 'grp' ? 'CPRP' : `Cost per ${metrics[target]}`), ratio_scale: ratio ? ratio.scale : 1 };
        if (!params.multipliers.length && !params.budgets.length) { App.toast('Enter at least one spend change or budget.', 'error'); return; }
        App.store.set('sc:' + fk, { ...params, mult: $('#s-mult', form).value, bud: $('#s-bud', form).value });
        run(e.currentTarget, async () => {
          const one = { entity_type: et, entities: params.entity ? [params.entity] : null, granularity: params.granularity, max_entities: 1 };
          const [t, d] = await Promise.all([series({ ...one, metric: target }), series({ ...one, metric: driver })]);
          if (!t.series.length || !d.series.length) return { ok: false, message: (t.notes.concat(d.notes))[0] || 'Target or driver series could not be built.' };
          return App.runJob('/api/scenarios/run', { kind, target: t.series[0], driver: d.series[0], params: { ...params, granularity: t.granularity } }, onJob);
        }, (res) => { App.lastScenarios[fk] = { params, result: res }; scenarioResults(out, res, ctx, params); });
      };
      if (App.lastScenarios[fk]) scenarioResults(out, App.lastScenarios[fk].result, ctx, App.lastScenarios[fk].params);
    }

    function pacingForm() {
      const ps = App.store.get('pc:' + fk, {});
      const aOpts = Object.fromEntries(additive.map((k) => [k, metrics[k]]));
      const today = info.date_max || new Date().toISOString().slice(0, 10);
      const d0 = ps.start || today.slice(0, 8) + '01';
      const end = ps.end || new Date(new Date(today).getFullYear(), new Date(today).getMonth() + 1, 0).toISOString().slice(0, 10);
      const pEnts = kind === 'lmrb' ? ['advertiser', 'total'] : ents;
      form.innerHTML = `<p class="muted small" style="margin-top:0">Will the flight hit its target? Actual to date plus the forecast for the remaining days, with a P10 to P90 range.</p>
        <div class="filter-grid">
        <div class="field"><label for="p-metric">Metric</label><select id="p-metric">${opt(aOpts, ps.metric)}</select></div>
        <div class="field"><label for="p-et">For</label><select id="p-et">${entOpts(ps.entity_type || pEnts[0], pEnts)}</select></div>
        <div class="field" id="p-pick"></div>
        <div class="field"><label for="p-start">Flight start</label><input type="date" id="p-start" value="${esc(d0)}"></div>
        <div class="field"><label for="p-end">Flight end</label><input type="date" id="p-end" value="${esc(end)}"></div>
        <div class="field"><label for="p-target">Target for the flight</label><input type="number" id="p-target" min="0" step="any" value="${esc(ps.target || '')}" placeholder="Budget, leads or GRPs"></div>
        <div class="field"><label for="p-tol">Tolerance (%)</label><input type="number" id="p-tol" min="0" max="50" value="${esc(ps.tolerance_pct || 5)}"></div></div>
        <div class="row" style="margin-top:14px"><button class="btn primary" id="p-run" type="button">Check pacing</button></div>`;
      let picker;
      const repick = async () => { picker = await entityPicker($('#p-pick', form), $('#p-et', form).value, $('#p-metric', form).value, false, ps.entity); };
      $('#p-et', form).onchange = repick; repick();
      $('#p-run', form).onclick = async (e) => {
        const et = $('#p-et', form).value, metric = $('#p-metric', form).value;
        const params = { metric, entity_type: et, entity: et === 'total' ? null : (picker ? picker.get()[0] : null), start: $('#p-start', form).value, end: $('#p-end', form).value,
          target: +$('#p-target', form).value, tolerance_pct: +$('#p-tol', form).value || 5, unit: units[metric] };
        if (!params.target) { App.toast('Enter the target for the flight.', 'error'); return; }
        App.store.set('pc:' + fk, params);
        const btn = e.currentTarget; btn.disabled = true; out.innerHTML = ''; App.loader.show('Checking pacing', 'Projecting the rest of the flight');
        try {
          const s = await series({ entity_type: et, metric, granularity: 'daily', entities: params.entity ? [params.entity] : null, max_entities: 1 });
          const res = s.series.length ? await App.api.post('/api/pacing/run', { kind, series: s.series[0], params }) : { ok: false, message: s.notes[0] || 'No data for pacing.' };
          if (!res.ok) { out.innerHTML = App.emptyState('Pacing could not be checked', res.message); } else { App.lastPacing[fk] = { params, result: res }; pacingResults(out, res, ctx, params); } }
        catch (err) { out.innerHTML = App.emptyState('Pacing failed', err.message); }
        btn.disabled = false; App.loader.hide(250);
      };
      if (App.lastPacing[fk]) pacingResults(out, App.lastPacing[fk].result, ctx, App.lastPacing[fk].params);
    }

    const draw = () => { out.innerHTML = ''; ({ forecast: forecastForm, scenarios: scenarioForm, pacing: pacingForm })[cur](); };
    $$('#fm-seg button', p).forEach((b) => { b.onclick = () => { cur = b.dataset.m; App.store.set('fc-mode:' + fk, cur); $$('#fm-seg button', p).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); draw(); }; });
    draw();

    // open a saved forecast from the client overview (?saved=ID)
    const sid = new URLSearchParams(location.search).get('saved');
    if (sid && !p.dataset.savedShown) {
      p.dataset.savedShown = '1';
      try {
        const f = await App.api.get('/api/saved-forecasts/' + sid);
        const prm = f.request.params || {};
        const note = `Saved ${f.ftype} "${f.title}" from ${String(f.created_at).slice(0, 16).replace('T', ' ')}. It shows the data as it was then.`;
        if (f.ftype === 'forecast') { App.lastForecast[fk] = { params: prm, result: f.result }; forecastResults(out, f.result, ctx, prm, note); }
        else if (f.ftype === 'scenarios') { App.lastScenarios[fk] = { params: prm, result: f.result }; scenarioResults(out, f.result, ctx, prm); out.insertAdjacentHTML('afterbegin', `<div class="banner info"><span>${esc(note)}</span></div>`); }
        else { App.lastPacing[fk] = { params: prm, result: f.result }; pacingResults(out, f.result, ctx, prm); out.insertAdjacentHTML('afterbegin', `<div class="banner info"><span>${esc(note)}</span></div>`); }
      } catch (e) { App.toast('Could not open the saved forecast: ' + e.message, 'error'); }
    }
  }
  App.forecast = { tab };
})(window.App);
