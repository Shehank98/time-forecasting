/* Deep Negotiation & Brand Intelligence tab (LMRB): Channel -> Brand -> Theme drill-down, share of wallet matrix,
 * theme rotation, clutter and position vulnerability, negotiation leverage and the Negotiation PDF. */
(function (App) {
  const { esc, fmt, charts: C, tables: T } = App;
  const KEY = 'neg:lmrb';
  const kpi = (l, v, s) => `<div class="kpi"><div class="k-lbl">${esc(l)}</div><div class="k-val">${v}</div>${s ? `<div class="k-sub">${s}</div>` : ''}</div>`;
  const pct = (v) => (v == null ? 'n/a' : fmt.num(v, v < 10 ? 1 : 0) + '%');
  const dec = (v) => (v == null ? 'n/a' : fmt.num(v, 1));
  const durMix = (m) => { const t = (m || []).reduce((s, x) => s + x.spots, 0) || 1; return (m || []).slice().sort((a, b) => b.spots - a.spots).slice(0, 3).map((x) => `${x.band} ${fmt.num(x.spots / t * 100, 0)}%`).join(', '); };
  const alpha = (c, a) => (/^#[0-9a-f]{6}$/i.test(c) ? c + Math.round(a * 255).toString(16).padStart(2, '0') : /^hsl\(/.test(c) ? c.replace(')', ` / ${a})`) : c);
  const load = () => { try { return App.store.get(KEY, null) || {}; } catch (e) { return {}; } };
  let st = Object.assign({ channels: [], advertisers: [], themes: [], product_group: '', rebate_threshold: 10000000, clutter_threshold: 35, matrix: 'sow' }, load());
  const save = () => { try { App.store.set(KEY, st); } catch (e) { /* storage blocked */ } };
  let last = null;

  const opts = () => ({ channels: st.channels, advertisers: st.advertisers, themes: st.themes, product_group: st.product_group || null,
    rebate_threshold: +st.rebate_threshold || 10000000, clutter_threshold: +st.clutter_threshold || 35 });

  function tab(p, ctx) {
    p.innerHTML = `<div class="card neg-head"><div class="card-head"><div><h3>Deep Negotiation &amp; Brand Intelligence</h3>
        <div class="sub">Drill from channel to brand to theme, see who owns each station's money, and the leverage to take into the next rate negotiation.</div></div>
        <button class="btn primary" type="button" id="neg-pdf">Download Negotiation PDF Report</button></div>
      <div class="neg-ctl" id="neg-ctl"></div></div><div id="neg-out" style="margin-top:16px">${App.skeleton(3)}</div>`;
    p.querySelector('#neg-pdf').onclick = () => pdf(p, ctx);
    run(p, ctx);
  }

  /** Builds the controls once, then only re-mounts a multi-select whose option list changed, so an open dropdown stays open while you pick. */
  function controls(p, ctx, d) {
    const el = p.querySelector('#neg-ctl'); if (!el) return false;
    const o = d.options || {};
    let dropped = false;   // picks that no longer exist in the narrowed lists
    ['channels', 'advertisers', 'themes'].forEach((k) => { const ok = new Set(o[k] || []), keep = (st[k] || []).filter((x) => ok.has(x)); if (keep.length !== (st[k] || []).length) dropped = true; st[k] = keep; });
    const again = el._again || (el._again = App.debounce(() => { save(); run(p, ctx); }, 250));
    if (!el.dataset.built) {
      el.dataset.built = '1';
      el.innerHTML = `<div class="neg-grid"><div data-ms="channels"></div>
        <div class="field"><label for="neg-pg">Product group</label><select id="neg-pg"></select></div>
        <div data-ms="advertisers"></div><div data-ms="themes"></div>
        <div class="field"><label for="neg-rb">Volume rebate threshold (LKR per brand per channel)</label><input id="neg-rb" type="number" min="0" step="500000" value="${esc(st.rebate_threshold)}"></div>
        <div class="field"><label for="neg-cl">Clutter threshold (ads in break)</label><input id="neg-cl" type="number" min="1" step="1" value="${esc(st.clutter_threshold)}"></div></div>`;
      el.querySelector('#neg-pg').onchange = (e) => { st.product_group = e.target.value; again(); };
      el.querySelector('#neg-rb').onchange = (e) => { st.rebate_threshold = Math.max(0, +e.target.value || 0); again(); };
      el.querySelector('#neg-cl').onchange = (e) => { st.clutter_threshold = Math.max(1, +e.target.value || 35); again(); };
      el._sig = {};
    }
    const pg = el.querySelector('#neg-pg'), pgSig = JSON.stringify(o.product_groups || []);
    if (el._sig.pg !== pgSig) { el._sig.pg = pgSig; pg.innerHTML = `<option value="">All</option>${(o.product_groups || []).map((g) => `<option value="${esc(g)}">${esc(g)}</option>`).join('')}`; }
    pg.value = st.product_group || '';
    const mount = (k, label) => {
      const sig = JSON.stringify(o[k] || []) + '|' + JSON.stringify(st[k] || []);
      const cur = el.querySelector(`[data-ms="${k}"]`); if (el._sig[k] === sig || (cur && cur.querySelector('.ms-pop'))) return;
      el._sig[k] = sig;
      const m = App.filters.multi({ key: k, label }, o[k] || [], st, again); m.dataset.ms = k; cur.replaceWith(m);
    };
    mount('channels', 'Level 1: channel'); mount('advertisers', 'Level 2: advertiser / brand'); mount('themes', 'Level 3: theme');
    return dropped;
  }

  async function run(p, ctx) {
    const out = p.querySelector('#neg-out'); if (!out) return;
    out.innerHTML = App.skeleton(3);
    let d;
    try { d = await App.data.negotiation({ filters: ctx.filters(), options: opts() }); } catch (e) { out.innerHTML = App.emptyState('The negotiation view could not be built', e.message); return; }
    if (!out.isConnected) return;
    last = d; if (controls(p, ctx, d)) { save(); run(p, ctx); return; }
    if (d.empty) { out.innerHTML = App.emptyState('No spots match this selection', 'Clear a channel, brand or theme pick, or widen the page filters.'); return; }
    draw(out, d);
  }

  function lever(l) {
    const rb = l.type === 'rebate';
    return `<div class="neg-lev ${rb ? 'good' : 'bad'}"><span class="badge ${rb ? 'good' : 'bad'}">${rb ? 'Volume rebate' : 'Clutter penalty'}</span>
      <div><b>${esc(l.channel)}${l.daypart ? ' · ' + esc(l.daypart) : ''}${l.advertiser ? ' · ' + esc(l.advertiser) : ''}</b><div class="small">${esc(l.text)}</div></div>
      <div class="neg-lev-v">${rb ? `${fmt.compact(l.est_low)} to ${fmt.compact(l.est_high)}<small>value to ask</small>` : `${dec(l.avg_clutter)}<small>ads per break</small>`}</div></div>`;
  }

  function tree(d) {
    const thr = d.thresholds.clutter;
    const head = '<tr><th>Channel / brand / theme</th><th class="num">Spend (LKR)</th><th class="num">Share of wallet</th><th class="num">Share of channel</th><th class="num">Spots</th><th class="num">Avg ads in break</th><th class="num">First in break</th><th class="num">Vulnerability</th><th>Running</th><th>Spot lengths</th><th>Flag</th></tr>';
    const row = (lvl, key, parent, name, x, cells, flag, kids) => `<tr class="neg-l${lvl}" data-key="${esc(key)}" ${parent ? `data-parent="${esc(parent)}" hidden` : ''}>
      <td>${kids ? `<button type="button" class="neg-tog" aria-expanded="false" aria-label="Show ${esc(name)}">&#9656;</button>` : '<span class="neg-tog-sp"></span>'}${lvl === 2 ? `<span class="swatch" style="background:${C.colorFor(name)}"></span>` : ''}${esc(name)}</td>
      <td class="num">${fmt.num(x.spend)}</td>${cells}<td class="num">${fmt.num(x.spots)}</td><td class="num ${x.avg_clutter > thr ? 'neg-hot' : ''}">${dec(x.avg_clutter)}</td>
      <td class="num">${pct(x.first_pct)}</td><td class="num">${dec(x.vulnerability)}</td><td class="small neg-nw">${x.first_seen || ''}<br>to ${x.last_seen || ''}<br><span class="muted">${x.days_run} days</span></td><td class="small">${esc(durMix(x.dur_mix))}</td><td>${flag}</td></tr>`;
    const body = d.channels.map((c) => {
      const ck = 'c|' + c.name;
      return row(1, ck, '', fmt.title(c.name), c, `<td class="num muted">-</td><td class="num">${pct(c.share_pct)}<div class="muted small">of selection</div></td>`, c.avg_clutter > thr ? '<span class="badge bad">Clutter</span>' : '', c.brands.length)
        + c.brands.map((b) => { const bk = ck + '|' + b.name; return row(2, bk, ck, b.name, b, `<td class="num">${pct(b.sow)}</td><td class="num">${pct(b.share_of_channel)}</td>`, b.rebate_eligible ? '<span class="badge good">Rebate</span>' : '', b.themes.length)
          + b.themes.map((t) => row(3, bk + '|' + t.name, bk, t.name, t, '<td></td><td></td>', '', 0)).join(''); }).join('');
    }).join('');
    return `<div class="tbl-scroll"><table class="tbl neg-tree"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
  }
  function wireTree(root) {
    const tb = root.querySelector('.neg-tree tbody'); if (!tb) return;
    const hide = (key) => tb.querySelectorAll(`tr[data-parent="${CSS.escape(key)}"]`).forEach((r) => { r.hidden = true; const b = r.querySelector('.neg-tog'); if (b) { b.setAttribute('aria-expanded', 'false'); b.innerHTML = '&#9656;'; } hide(r.dataset.key); });
    tb.onclick = (e) => {
      const b = e.target.closest('.neg-tog'); if (!b) return;
      const tr = b.closest('tr'), open = b.getAttribute('aria-expanded') !== 'true';
      b.setAttribute('aria-expanded', String(open)); b.innerHTML = open ? '&#9662;' : '&#9656;';
      if (open) tb.querySelectorAll(`tr[data-parent="${CSS.escape(tr.dataset.key)}"]`).forEach((r) => { r.hidden = false; }); else hide(tr.dataset.key);
    };
    root.querySelector('#neg-expand').onclick = () => tb.querySelectorAll('tr.neg-l1 .neg-tog').forEach((b) => { if (b.getAttribute('aria-expanded') !== 'true') b.click(); });
    root.querySelector('#neg-collapse').onclick = () => tb.querySelectorAll('tr.neg-l1').forEach((r) => { const b = r.querySelector('.neg-tog'); if (b && b.getAttribute('aria-expanded') === 'true') b.click(); });
  }

  function matrixHtml(d) {
    const m = d.matrix, mode = st.matrix;
    const vals = mode === 'spend' ? m.spend : mode === 'soc' ? m.share_of_channel : m.sow;
    return C.heat({ rows: m.rows, cols: m.cols.map(fmt.title), values: vals.map((r) => r.map((v) => (v ? v : null))) }, { fmt: mode === 'spend' ? fmt.compact : (v) => fmt.num(v, 0) + '%' });
  }

  function draw(out, d) {
    const t = d.totals, thr = d.thresholds;
    const rebates = d.leverage.filter((l) => l.type === 'rebate'), clut = d.leverage.filter((l) => l.type === 'clutter');
    const top = [...rebates.slice(0, clut.length ? 8 : 14), ...clut.slice(0, 6)], rest = d.leverage.filter((l) => !top.includes(l));   // both kinds always visible
    out.innerHTML = `<div class="kpis">
        ${kpi('Spend in selection', `<span title="${fmt.lkr(t.spend)}">${fmt.lkrc(t.spend)}</span>`, `${d.period[0]} to ${d.period[1]}`)}
        ${kpi('Spots', fmt.num(t.spots), `${t.channels} channels, ${t.advertisers} brands, ${t.themes} themes`)}
        ${kpi('Avg ads in break', dec(t.avg_clutter), t.avg_clutter > thr.clutter ? 'Above the clutter threshold' : `Threshold ${thr.clutter}`)}
        ${kpi('First in break', pct(t.first_pct), `Premium (first or last) ${pct(t.premium_pct)}`)}
        ${kpi('Vulnerability index', dec(t.vulnerability) + '<small> / 100</small>', `${pct(t.buried_pct)} of spots buried mid-break in a full pod`)}
        ${kpi('Rebate value to ask', t.rebate_high ? `${fmt.compact(t.rebate_low)} to ${fmt.compact(t.rebate_high)}` : 'None', `${rebates.length} brand and channel pairs at ${fmt.compact(thr.rebate)}+`)}
      </div>
      <div class="card" style="margin-top:16px"><div class="card-head"><div><h3>Negotiation leverage ${App.help('Volume rebate: one brand spent the threshold or more on one channel, so a retroactive 10 to 15% volume discount can be asked for. Clutter penalty: the channel or timeband averages more ads per break than the clutter threshold, so ask for 3 free bonus spots or priority first-in-break placement.', 'Take these points into the next station meeting. Change the two thresholds above to match your deal terms.')}</h3>
        <div class="sub">${rebates.length} volume rebate and ${clut.length} clutter points for this selection.</div></div></div>
        <div class="neg-levs">${top.map(lever).join('') || App.emptyState('No leverage at these thresholds', 'Lower the rebate threshold or the clutter threshold to see more.')}</div>
        ${rest.length ? `<details style="margin-top:8px"><summary class="small" style="cursor:pointer">${rest.length} more</summary><div class="neg-levs">${rest.map(lever).join('')}</div></details>` : ''}</div>
      <div class="card" style="margin-top:16px"><div class="card-head"><div><h3>Channel &rarr; Brand &rarr; Theme</h3><div class="sub">Click &#9656; to open a channel, then a brand. Share of wallet = the brand's spend on this channel as a share of its total. Share of channel = its share of everyone's spend on this channel.</div></div>
        <div class="row"><button class="btn sm ghost" type="button" id="neg-expand">Open all</button><button class="btn sm ghost" type="button" id="neg-collapse">Close all</button></div></div>${tree(d)}</div>
      <div style="margin-top:16px">${C.box('neg-sow', 'Share of wallet matrix: brand x channel', 'Top 15 brands and 12 channels. Click a cell.', { html: matrixHtml(d),
        extra: `<div class="seg" id="neg-mseg"><button type="button" data-m="sow" aria-pressed="${st.matrix === 'sow'}">Share of wallet</button><button type="button" data-m="soc" aria-pressed="${st.matrix === 'soc'}">Share of channel</button><button type="button" data-m="spend" aria-pressed="${st.matrix === 'spend'}">Spend</button></div>`,
        help: ['Share of wallet: each row adds up to 100% across all channels (only the top 12 are shown). Share of channel: each column is the share of that channel\'s money. Spend is in LKR.', 'Find the stations that depend on a brand (high share of channel) and the brands that depend on a station (high share of wallet).'] })}</div>
      <div class="grid g2" style="margin-top:16px">
        ${C.box('neg-vuln', 'Clutter and position vulnerability', 'Each bubble is a brand on a channel. Size = spend. Right and low = buried in busy breaks.', { tall: true,
          help: ['x = average ads in break, y = share of spots placed first in break. Bubble size follows spend. The dashed line is the clutter threshold. The vulnerability index (0 to 100) rises when a spot sits deep in the middle of a full break.', 'Brands right of the line and near the bottom are paying for spots that get lost: ask for first-in-break or bonus spots.'] })}
        ${C.box('neg-rot', 'Theme rotation tracker', 'How long each theme ran. Top 20 themes by investment. Click a bar.', { tall: true,
          help: ['Each bar runs from the first to the last day the theme was seen. Brighter bars are still on air (seen in the last 14 days).', 'See when a rival rotates creative, and how long a theme is kept before it is rested.'] })}</div>
      <div class="grid g2" style="margin-top:16px"><div class="card"><h3>Are brands changing creative tactics?</h3><div class="sub muted small">Share of spots at 10 seconds or less in the first and second half of each brand's run.</div><div id="neg-shift"></div></div>
        <div class="card"><h3>Clutter by channel and timeband</h3><div class="sub muted small">Flagged above ${thr.clutter} ads per break.</div><div id="neg-clut"></div></div></div>
      <div class="card" style="margin-top:16px"><h3>Theme performance</h3><div id="neg-themes"></div></div>
      <div class="muted small" style="margin-top:10px">${Object.values(d.definitions).map(esc).join(' ')} Rebate and bonus figures are starting points worked out from monitored spend, not confirmed station terms.</div>`;
    wireTree(out);
    out.querySelectorAll('#neg-mseg button').forEach((b) => { b.onclick = () => { st.matrix = b.dataset.m; save(); out.querySelectorAll('#neg-mseg button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); out.querySelector('#neg-sow').innerHTML = matrixHtml(d); }; });
    vulnChart(d); rotChart(d);
    T.create(out.querySelector('#neg-shift'), { csv: 'creative_tactics', pageSize: 8, rows: d.shifts, empty: 'Needs brands with 10 or more spots.', columns: [
      { key: 'advertiser', label: 'Brand' }, { key: 'short_early_pct', label: 'Short spots, first half', num: true, fmt: pct }, { key: 'short_late_pct', label: 'Second half', num: true, fmt: pct },
      { key: 'change_pts', label: 'Change', num: true, html: (v) => (v == null ? 'n/a' : `<span class="${v >= 15 ? 'neg-hot' : ''}">${v > 0 ? '+' : ''}${fmt.num(v, 0)} pts</span>`) },
      { key: 'themes_last_30d', label: 'Themes, last 30 days', num: true }, { key: 'tactic', label: 'Tactic' }] });
    T.create(out.querySelector('#neg-clut'), { csv: 'clutter_by_timeband', pageSize: 8, rows: d.clutter, columns: [
      { key: 'channel', label: 'Channel', fmt: fmt.title }, { key: 'daypart', label: 'Timeband' }, { key: 'spots', label: 'Spots', num: true },
      { key: 'avg_clutter', label: 'Avg ads in break', num: true, html: (v) => `<span class="${v > thr.clutter ? 'neg-hot' : ''}">${dec(v)}</span>` }, { key: 'first_pct', label: 'First in break', num: true, fmt: pct },
      { key: 'flag', label: 'Advisory', html: (v) => (v ? '<span class="badge bad">Ask for 3 bonus spots or first in break</span>' : '') }] });
    T.create(out.querySelector('#neg-themes'), { csv: 'theme_performance', defaultSort: { key: 'spend', desc: true }, rows: d.themes.map((x) => ({ ...x, lengths: durMix(x.dur_mix) })), columns: [
      { key: 'advertiser', label: 'Brand' }, { key: 'name', label: 'Theme' }, { key: 'spend', label: 'Investment (LKR)', num: true, fmt: (v) => fmt.num(v) }, { key: 'spots', label: 'Spots', num: true },
      { key: 'first_seen', label: 'First seen' }, { key: 'last_seen', label: 'Last seen' }, { key: 'days_run', label: 'Days run', num: true }, { key: 'lengths', label: 'Spot lengths' },
      { key: 'first_pct', label: 'First in break', num: true, fmt: pct }, { key: 'active', label: 'Status', html: (v) => (v ? '<span class="badge good">On air</span>' : '<span class="badge">Rested</span>') }] });
  }

  function vulnChart(d) {
    const pts = []; d.channels.forEach((c) => c.brands.forEach((b) => { if (b.avg_clutter != null && b.first_pct != null) pts.push({ c, b }); }));
    const mx = Math.max(1, ...pts.map((x) => x.b.spend)), thr = d.thresholds.clutter, bad = C.css('--bad') || '#ff5d7a';
    const line = { id: 'negThr', afterDatasetsDraw(ch) { const { ctx, chartArea: a, scales: { x } } = ch, px = x.getPixelForValue(thr); if (!(px >= a.left && px <= a.right)) return;
      ctx.save(); ctx.strokeStyle = bad; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = bad; ctx.font = '600 11px sans-serif'; ctx.fillText(`Clutter threshold ${thr}`, Math.min(px + 4, a.right - 120), a.top + 12); ctx.restore(); } };
    C.make('neg-vuln', { type: 'bubble', plugins: [line], detailOnly: true,
      data: { datasets: [{ label: 'Brand on channel', data: pts.map(({ c, b }) => ({ x: b.avg_clutter, y: b.first_pct, r: 4 + 16 * Math.sqrt(b.spend / mx) })),
        backgroundColor: pts.map(({ b }) => alpha(C.colorFor(b.name), 0.67)), borderColor: pts.map(({ b }) => C.colorFor(b.name)) }] },
      options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: (k) => { const { c, b } = pts[k.dataIndex]; return `${b.name} on ${fmt.title(c.name)}: ${dec(b.avg_clutter)} ads per break, ${pct(b.first_pct)} first, index ${dec(b.vulnerability)}`; } } } },
        scales: { x: { title: { display: true, text: 'Average ads in break' }, suggestedMax: Math.max(thr + 5, ...pts.map((x) => x.b.avg_clutter + 2)) }, y: { title: { display: true, text: 'First in break %' }, beginAtZero: true, suggestedMax: 30 } } },
      detail: (i) => { const { c, b } = pts[i]; return `<div class="dt-kpis"><div class="dt-k"><span>Brand</span><b>${esc(b.name)}</b></div><div class="dt-k"><span>Channel</span><b>${esc(fmt.title(c.name))}</b></div><div class="dt-k"><span>Spend</span><b>${fmt.num(b.spend)}</b></div><div class="dt-k"><span>Avg ads in break</span><b>${dec(b.avg_clutter)}</b></div><div class="dt-k"><span>First in break</span><b>${pct(b.first_pct)}</b></div><div class="dt-k"><span>Buried mid-break</span><b>${pct(b.buried_pct)}</b></div><div class="dt-k"><span>Vulnerability index</span><b>${dec(b.vulnerability)}</b></div></div>
        <p class="small">${b.avg_clutter > thr ? 'Above the clutter threshold: ask for 3 free bonus spots or priority first-in-break placement.' : 'Clutter is within the threshold on this channel.'}</p>`; } });
  }

  function rotChart(d) {
    const th = d.themes.slice(0, 20), day = (s) => Date.parse(s + 'T00:00:00Z') / 864e5, iso = (n) => new Date(n * 864e5).toISOString().slice(0, 10);
    C.make('neg-rot', { type: 'bar', detailOnly: true,
      data: { labels: th.map((x) => { const a = x.advertiser.length > 18 ? x.advertiser.slice(0, 17) + '.' : x.advertiser, t = x.name.length > 26 ? x.name.slice(0, 25) + '.' : x.name; return `${a}: ${t}`; }), datasets: [{ label: 'On air', data: th.map((x) => [day(x.first_seen), day(x.last_seen) + 1]),
        backgroundColor: th.map((x) => alpha(C.colorFor(x.advertiser), x.active ? 0.93 : 0.4)), borderRadius: 4, borderSkipped: false }] },
      options: { indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (k) => { const x = th[k.dataIndex]; return `${x.first_seen} to ${x.last_seen} (${x.days_run} days), ${fmt.compact(x.spend)} LKR, ${fmt.num(x.spots)} spots`; } } } },
        scales: { x: { min: day(d.period[0]), max: day(d.period[1]) + 1, ticks: { callback: (v) => iso(v).slice(5), maxTicksLimit: 8 } }, y: { ticks: { font: { size: 10 } } } } },
      detail: (i) => { const x = th[i]; return `<div class="dt-kpis"><div class="dt-k"><span>Brand</span><b>${esc(x.advertiser)}</b></div><div class="dt-k"><span>Investment</span><b>${fmt.num(x.spend)}</b></div><div class="dt-k"><span>Spots</span><b>${fmt.num(x.spots)}</b></div><div class="dt-k"><span>Ran</span><b>${x.first_seen} to ${x.last_seen}</b></div><div class="dt-k"><span>Days</span><b>${x.days_run}</b></div><div class="dt-k"><span>Spot lengths</span><b>${esc(durMix(x.dur_mix))}</b></div><div class="dt-k"><span>Status</span><b>${x.active ? 'On air' : 'Rested'}</b></div></div>`; } });
  }

  async function pdf(p, ctx) {
    const b = p.querySelector('#neg-pdf');
    if (!last || last.empty) { App.toast('Nothing to export: no spots match the selection.', 'error'); return; }
    b.disabled = true; const txt = b.textContent; b.textContent = 'Building PDF...';
    try {
      const chips = ((ctx.meta && ctx.meta.chips) || []).map((c) => `${c.label}: ${c.value}`);
      const ds = (ctx.body && ctx.body().dataset) || '';
      const r = await App.api.blob('/api/negotiation/pdf', { hub: last, meta: { dataset: ds, filters: chips } });
      App.download(r.blob, r.name); App.toast('Negotiation report downloaded. A copy is kept under Reports.', 'ok');
    } catch (e) { App.toast('The PDF could not be built: ' + e.message, 'error'); } finally { b.disabled = false; b.textContent = txt; }
  }

  App.negotiation = { tab };
})(window.App);
