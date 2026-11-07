/* Client Pitch Evaluator: time bands. Pure functions (worker, page and tests).
 *
 * A channel splits its commercial money into bands and each band has a share of it:
 *   pt     Prime time / Non prime time               (by the prime time window)
 *   pt_wk  Prime time / Non prime weekday / Non prime weekend
 *   abc    Prime A / Prime B / Non prime              (by the channel's own programme list: day, time, programme; Hiru works like this)
 * cfg (per channel, kept by the page): { preset, shares: {bandId: percent}, strict: bool, bonus: {bandId: bool}, list: [{cat, name, days, start, end}], list_date }
 */
(function (root) {
  const MR = root.MR = root.MR || {};
  const DAYN = { mon: 0, monday: 0, tue: 1, tues: 1, tuesday: 1, wed: 2, wednesday: 2, thu: 3, thur: 3, thurs: 3, thursday: 3, fri: 4, friday: 4, sat: 5, saturday: 5, sun: 6, sunday: 6 };
  const PRESETS = {
    pt: { name: 'Prime time and non prime time', bands: [{ id: 'PT', name: 'Prime time', prime: true, bonus: true }, { id: 'NPT', name: 'Non prime time', prime: false, bonus: true }] },
    pt_wk: { name: 'Prime time, non prime weekday and non prime weekend', bands: [{ id: 'PT', name: 'Prime time', prime: true, bonus: true }, { id: 'NPT_WD', name: 'Non prime weekday', prime: false, bonus: true }, { id: 'NPT_WE', name: 'Non prime weekend', prime: false, bonus: true }] },
    abc: { name: 'Prime A, Prime B and non prime (programme list)', bands: [{ id: 'A', name: 'Prime A', prime: true, bonus: false }, { id: 'B', name: 'Prime B', prime: true, bonus: false }, { id: 'NP', name: 'Non prime', prime: false, bonus: true }] },
  };

  /** The bands of a channel's configuration, with the bonus rule of each. */
  function bandSet(cfg) {
    const p = PRESETS[(cfg && cfg.preset) || 'pt'] || PRESETS.pt;
    return p.bands.map((b) => ({ ...b, bonus: cfg && cfg.bonus && cfg.bonus[b.id] !== undefined ? !!cfg.bonus[b.id] : b.bonus }));
  }
  /** Share of each band as a fraction of the commercial money (null when the channel has no shares). */
  function shares(cfg) {
    if (!cfg || !cfg.shares) return null;
    const out = {}; let any = false;
    for (const b of bandSet(cfg)) { const v = +cfg.shares[b.id]; if (Number.isFinite(v) && v >= 0 && cfg.shares[b.id] !== '' && cfg.shares[b.id] != null) { out[b.id] = v / 100; any = true; } }
    return any ? out : null;
  }

  function parseDays(txt) {
    const t = String(txt || '').toLowerCase().replace(/&|,|\band\b/g, ' ').replace(/\s+/g, ' ').trim(), out = new Set();
    if (/daily|every day|all days/.test(t)) return [0, 1, 2, 3, 4, 5, 6];
    const names = t.match(/[a-z]+/g) || [], toks = names.filter((x) => x in DAYN || x === 'to');
    for (let i = 0; i < toks.length; i++) {
      if (toks[i] === 'to') continue;
      if (toks[i + 1] === 'to' && toks[i + 2] in DAYN) { for (let d = DAYN[toks[i]]; d <= DAYN[toks[i + 2]]; d++) out.add(d); i += 2; } else out.add(DAYN[toks[i]]);
    }
    const dash = t.match(/\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\s*-\s*(mon|tue|wed|thu|fri|sat|sun)[a-z]*/);
    if (!out.size && dash) for (let d = DAYN[dash[1]]; d <= DAYN[dash[2]]; d++) out.add(d);
    return [...out].sort();
  }
  /** "11.55 am", "6:30 pm", "12:30 am", "18:00" -> minutes after midnight. */
  function parseTime(txt) {
    const m = String(txt || '').toLowerCase().match(/(\d{1,2})\s*[.:]\s*(\d{2})\s*(am|pm)?/); if (!m) return null;
    let h = +m[1]; const mi = +m[2]; if (m[3] === 'pm' && h < 12) h += 12; if (m[3] === 'am' && h === 12) h = 0;
    return h * 60 + mi;
  }
  /** Paste from Excel or a typed list: category, programme, days, start, end (tab, comma or semicolon). Category A, B or NP. */
  function parseList(text) {
    const rows = [], bad = [];
    String(text || '').split(/\r?\n/).forEach((line, i) => {
      if (!line.trim()) return; const c = line.split(/\t|;|,(?=\s*[A-Za-z0-9])/).map((x) => x.trim()); if (c.length < 4) { bad.push(`line ${i + 1}: needs category, programme, days, start`); return; }
      const cat = /^a$|prime a/i.test(c[0]) ? 'A' : /^b$|prime b/i.test(c[0]) ? 'B' : /^n|non/i.test(c[0]) ? 'NP' : null; if (!cat) { bad.push(`line ${i + 1}: category must be A, B or NP`); return; }
      rows.push({ cat, name: c[1], days: c[2], start: c[3], end: c[4] || '' });
    });
    return { rows, bad };
  }
  const prepList = (() => { const memo = new Map(); return (list) => { const k = JSON.stringify(list || []); let v = memo.get(k); if (!v) { v = (list || []).map((r) => ({ ...r, dset: new Set(parseDays(r.days)), s: parseTime(r.start), p: MR.pitchPrep ? MR.pitchPrep(r.name) : null })); if (memo.size > 50) memo.clear(); memo.set(k, v); } return v; }; })();

  /** The band of a TVR programme entry (e: {program, start (seconds), days[7], pt}). Returns {id, name, prime, listed}. */
  function classify(e, cfg) {
    const set = bandSet(cfg), by = (id) => set.find((b) => b.id === id) || set[set.length - 1], preset = (cfg && cfg.preset) || 'pt';
    if (preset === 'pt') { const b = by(e.pt ? 'PT' : 'NPT'); return { id: b.id, name: b.name, prime: b.prime, listed: true }; }
    const mx = Math.max(1, ...e.days), dom = e.days.map((c, i) => (c >= mx * 0.25 ? i : -1)).filter((i) => i >= 0);
    if (preset === 'pt_wk') { const b = by(e.pt ? 'PT' : dom.length && dom.every((i) => i >= 5) ? 'NPT_WE' : 'NPT_WD'); return { id: b.id, name: b.name, prime: b.prime, listed: true }; }
    // abc: the best programme of the channel's list: same programme (name), a shared day, near the start time
    const list = prepList(cfg && cfg.list), st = e.start >= 0 ? e.start / 60 : null, P = MR.pitchPrep ? MR.pitchPrep(e.program) : null; let best = null, bs = 0;
    if (P) for (const r of list) {
      if (!r.p || !dom.some((i) => r.dset.has(i))) continue;
      const nm = MR.pitchNameScorePrepared(P, r.p) * 100, dt = st != null && r.s != null ? Math.abs(st - r.s) : 0, sc = nm - Math.min(30, dt * 0.7) + (P.repeat === r.p.repeat ? 5 : 0);
      if (((nm >= 60 && dt <= 90) || (nm >= 40 && dt <= 10)) && sc > bs) { bs = sc; best = r; }      // a weaker name is fine when the time is the same
    }
    const b = by(best ? best.cat : 'NP'); return { id: b.id, name: b.name, prime: b.prime, listed: !!best };
  }

  /** What the Hiru categorisation effective 23.10.2026 says (Prime A, Prime B, Non prime). */
  const HIRU = (() => {
    const A = 'A', B = 'B', N = 'NP', rows = [];
    const add = (cat, days, list) => list.forEach(([name, s, e]) => rows.push({ cat, name, days, start: s, end: e }));
    add(A, 'Monday to Friday', [['11.55 News', '11:55', '12:30'], ['Hadata Hathakmai', '18:00', '18:30'], ['Siri', '18:30', '18:55'], ['6.55 News', '18:55', '19:30'], ['Akurata Yana Welawe', '19:30', '20:00'], ['Paata Kurullo', '20:00', '20:30'], ['Ron Soya', '20:30', '21:00'], ['Aththamai Man Oyata Adarei', '21:00', '21:25'], ['Marambari', '21:25', '21:55'], ['9.55 News', '21:55', '22:30']]);
    add(A, 'Saturday & Sunday', [['11.55 News', '11:55', '12:30'], ['6.55 News', '18:55', '19:30'], ['9.55 News', '21:55', '22:30'], ['Sonu Mandara', '18:00', '18:55'], ['Oba Enna Awith Yanna', '21:00', '21:55']]);
    add(A, 'Saturday', [['Hiru Star - Season 05', '19:30', '21:00']]); add(A, 'Sunday', [['Hiru Star - Season 05', '19:30', '21:00']]);
    add(B, 'Monday to Friday', [['Paththarey Wistharey', '06:30', '07:30'], ['Meka Puduma Lokayak', '07:30', '08:00'], ['Tharu Walalla', '08:00', '08:30'], ['Hot Wheels - Season 01', '16:00', '16:30'], ['Rathu Chuti', '16:30', '17:00'], ['Robin Hood - Season 4', '17:00', '17:30'], ['Jungle Book 4', '17:30', '18:00']]);
    add(B, 'Saturday & Sunday', [['Paththarey Wistharey', '06:30', '07:30'], ['Meka Puduma Lokayak', '07:30', '08:00']]);
    add(B, 'Saturday', [['Saturday Family Movie', '08:00', '10:00'], ['Hiru top 10', '12:30', '13:30'], ['Hiru Tele Cinema Siththama', '10:00', '11:30']]);
    add(B, 'Sunday', [['Anyone Can Cook', '08:00', '09:00'], ['Agara Dagara', '09:00', '10:00'], ['Hodatama wadi with Duleeka & Rashi', '10:00', '11:00'], ['Podi Waddo', '11:00', '11:55'], ['Copy Chat', '22:30', '01:00']]);
    add(N, 'Monday to Friday', [['Telefilm', '09:00', '10:00'], ['Akurata Yana Welawe - RPT', '10:00', '10:30'], ['Paata Kurullo - RPT', '10:30', '11:00'], ['Ron Soya - RPT', '11:00', '11:30'], ['Aththamai Man Oyata Adarei - RPT', '11:30', '11:55']]);
    add(N, 'Monday to Thursday', [['Afternoon Movies', '12:30', '16:00']]);
    add(N, 'Monday', [['Salakuna', '22:30', '00:30']]); add(N, 'Tuesday', [['Sewanali 02', '22:30', '23:30'], ['Mega Blast Count Down', '23:30', '00:30']]); add(N, 'Wednesday', [['Muragala', '22:30', '00:30']]); add(N, 'Thursday', [['Balaya', '22:30', '00:30']]);
    add(N, 'Friday', [['Copy Chat/R', '12:30', '16:00'], ['House Full / Jaana / Sanuhare', '22:30', '00:30']]);
    add(N, 'Saturday', [['Art Cafe', '11:30', '11:55'], ['Hiru Star - Recap', '13:30', '14:45'], ['Saturday Afternoon Telecinema Siththama', '14:45', '18:00'], ['Saturday Night Blockbuster', '22:30', '00:30']]);
    add(N, 'Sunday', [['Hiru Star - Recap', '12:30', '14:00'], ['Sunday Afternoon Movies', '14:00', '18:00']]);
    return { effective: '2026-10-23', issued: '2026-10-02', rows, shares: { A: 20, B: 40, NP: 40 }, bonus: { A: false, B: false, NP: true }, note: 'No benefit spots on Prime A (only the allocated percentage). No bonus spots on Prime A and Prime B: all bonus spots on Non prime.' };
  })();

  Object.assign(MR, { pitchBands: { PRESETS, bandSet, shares, classify, parseList, parseDays, parseTime, HIRU } });
})(typeof self !== 'undefined' ? self : globalThis);
