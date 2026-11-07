/* Client Pitch Evaluator: Excel evaluation workbook in the agency's sheet format, with live formulas.
 *
 * One Summary sheet, one sheet per channel (header block, programme rows, sponsorship rows, totals, tax and ROI rows), and a Formulas sheet that holds
 * the settings every other sheet reads (30 sec base, SSCL, VAT) and the formula for each column. Change an input (TVR, spots, rate) and the sheet recalculates.
 *
 * spec: {client, title, month, channels: [{name, basket: [row], sponsorship: [row]}]}
 * row:  {desc, day, from, to, dur, tvr, spots, card, rate}    card and rate are per 30 seconds; dur is the average spot length in seconds
 */
(function (App) {
  const SET = { base: 'Formulas!$B$3', sscl: 'Formulas!$B$4', vat: 'Formulas!$B$5' };
  const COLS = ['DESCRIPTION', 'DAY', 'TIME BELT FROM', 'TIME BELT TO', 'DUR', 'TVR', 'GRP', 'NGRP', 'CPRP', 'NCPRP', 'RATE CARD RATE', 'NEGOTIATED RATE', 'NUMBER OF SPOTS', 'TOTAL VALUE', 'TOTAL COST'];
  const safeName = (n, used) => { let b = String(n || 'Channel').replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 28) || 'Channel', x = b, i = 2; while (used.has(x.toLowerCase())) x = b.slice(0, 26) + ' ' + i++; used.add(x.toLowerCase()); return x; };
  const q = (n) => `'${String(n).replace(/'/g, "''")}'`;

  function build(X, spec, settings) {
    const wb = X.utils.book_new(), E = X.utils.encode_cell, used = new Set(['summary', 'formulas']);
    const S = { base: 30, sscl: 0.025, vat: 0.18, ...(settings || {}) };
    const num = (v) => (Number.isFinite(+v) ? +v : 0), div = (a, b) => (b ? a / b : 0);
    const sheets = [];
    for (const ch of spec.channels) {
      const ws = {}, name = safeName(ch.name, used), put = (r, c, o) => { ws[E({ r: r - 1, c })] = o; };
      const txt = (r, c, v) => put(r, c, { t: 's', v: String(v) }), nm = (r, c, v, z, f) => put(r, c, { t: 'n', v: Number.isFinite(v) ? v : 0, ...(z ? { z } : {}), ...(f ? { f } : {}) });
      txt(1, 1, 'CLIENT :'); txt(1, 2, spec.client || ''); txt(2, 1, 'SUBJECT :'); txt(2, 2, spec.title || 'EVALUATION'); txt(3, 1, 'MEDIUM :'); txt(3, 2, 'TELEVISION'); txt(4, 1, 'CHANNEL :'); txt(4, 2, String(ch.name).toUpperCase()); txt(5, 1, 'PERIOD :'); txt(5, 2, spec.month || '');
      COLS.forEach((h, c) => txt(7, c, h));
      let r = 8; const blocks = { com: [], va: [] };
      const rowOut = (x, key) => {
        const dur = num(x.dur) || 30, tvr = num(x.tvr), spots = num(x.spots), card = num(x.card), rate = num(x.rate), grp = tvr * spots, ngrp = (grp * dur) / S.base, value = (card * spots * dur) / S.base, cost = (rate * spots * dur) / S.base;
        txt(r, 0, x.desc || ''); txt(r, 1, x.day || ''); txt(r, 2, x.from || ''); txt(r, 3, x.to || '');
        nm(r, 4, dur, '0.0'); nm(r, 5, tvr, '0.00'); nm(r, 6, grp, '#,##0.00', `F${r}*M${r}`); nm(r, 7, ngrp, '#,##0.00', `G${r}*E${r}/${SET.base}`);
        nm(r, 8, div(cost, grp), '#,##0', `IFERROR(O${r}/G${r},0)`); nm(r, 9, div(cost, ngrp), '#,##0', `IFERROR(O${r}/H${r},0)`); nm(r, 10, card, '#,##0'); nm(r, 11, rate, '#,##0'); nm(r, 12, spots, '#,##0');
        nm(r, 13, value, '#,##0', `K${r}*M${r}*E${r}/${SET.base}`); nm(r, 14, cost, '#,##0', `L${r}*M${r}*E${r}/${SET.base}`);
        blocks[key].push({ r, grp, ngrp, spots, value, cost }); r++;
      };
      if ((ch.sponsorship || []).length) { txt(r, 0, 'SPONSORSHIP BENEFITS'); r++; ch.sponsorship.forEach((x) => rowOut(x, 'va')); r++; }
      txt(r, 0, 'COMMERCIAL BENEFITS'); r++; (ch.basket || []).forEach((x) => rowOut(x, 'com')); r++;
      const sum = (b, k) => b.reduce((a, x) => a + x[k], 0), rng = (b, col) => (b.length ? `SUM(${col}${b[0].r}:${col}${b[b.length - 1].r})` : '0');
      const total = (label, b, refs) => {
        const row = r++, t = { r: row, grp: sum(b, 'grp'), ngrp: sum(b, 'ngrp'), spots: sum(b, 'spots'), value: sum(b, 'value'), cost: sum(b, 'cost') }; txt(row, 0, label);
        nm(row, 6, t.grp, '#,##0.00', refs ? refs('G') : rng(b, 'G')); nm(row, 7, t.ngrp, '#,##0.00', refs ? refs('H') : rng(b, 'H')); nm(row, 8, div(t.cost, t.grp), '#,##0', `IFERROR(O${row}/G${row},0)`); nm(row, 9, div(t.cost, t.ngrp), '#,##0', `IFERROR(O${row}/H${row},0)`);
        nm(row, 12, t.spots, '#,##0', refs ? refs('M') : rng(b, 'M')); nm(row, 13, t.value, '#,##0', refs ? refs('N') : rng(b, 'N')); nm(row, 14, t.cost, '#,##0', refs ? refs('O') : rng(b, 'O')); return t;
      };
      const com = total('COMMERCIAL VALUE', blocks.com), va = total('SPONSORSHIP VALUE', blocks.va);
      const all = total('ALL EXPOSURE VALUE', blocks.com.concat(blocks.va), (c) => `${c}${com.r}+${c}${va.r}`);
      const inv = r++; txt(inv, 0, 'ACTUAL INVESTMENT - 100% (WITHOUT TAXES)'); nm(inv, 14, all.cost, '#,##0', `O${all.r}`);
      const ss = r++; txt(ss, 0, 'SSCL'); nm(ss, 4, S.sscl, '0.0%', SET.sscl); const gross = div(all.cost, 1 - S.sscl); nm(ss, 14, gross * S.sscl, '#,##0', `O${inv}/(1-${SET.sscl})*${SET.sscl}`);
      const vt = r++; txt(vt, 0, 'VAT'); nm(vt, 4, S.vat, '0.0%', SET.vat); nm(vt, 14, gross * S.vat, '#,##0', `O${inv}/(1-${SET.sscl})*${SET.vat}`);
      const gt = r++; txt(gt, 0, 'GRAND TOTAL'); nm(gt, 14, gross + gross * S.vat, '#,##0', `O${inv}/(1-${SET.sscl})+O${vt}`);
      const cr = r++; txt(cr, 0, 'COMMERCIAL ROI %'); nm(cr, 14, div(com.value, com.cost), '0.00', `IFERROR(N${com.r}/O${com.r},0)`);
      const ar = r++; txt(ar, 0, 'ALL EXPOSURE ROI %'); nm(ar, 14, div(all.value, all.cost), '0.00', `IFERROR(N${all.r}/O${all.r},0)`);
      r++; txt(r, 0, '* Rates are per 30 seconds. TOTAL VALUE = rate card x spots x duration / 30. TOTAL COST = negotiated (or paid) rate x spots x duration / 30. ROI = value / cost. Change any white input cell and the sheet recalculates.');
      ws['!ref'] = `A1:O${r}`; ws['!cols'] = [{ wch: 34 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 7 }, { wch: 8 }, { wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 15 }, { wch: 15 }, { wch: 14 }, { wch: 15 }, { wch: 15 }];
      X.utils.book_append_sheet(wb, ws, name); sheets.push({ name, com, va, all, inv, cr, ar });
    }
    // Summary
    const ws = {}, put = (r, c, o) => { ws[E({ r: r - 1, c })] = o; }, H = ['Channel', 'Total Investment', 'Total Rate Card (all Expo)', 'Com Only', 'C ROI%', 'ROI%', 'Com Only GRPs', 'Com Only NGRPs', 'Com Only CPRP', 'Com Only N CPRP', 'Total GRPs', 'Total NGRPs', 'CPRP All Expo', 'NCPRP - 30 Sec Com Only', 'Total Number of Spots', 'Total Number of V/A', 'Commercial Cost', 'Sponsorship Cost'];
    put(1, 0, { t: 's', v: `${spec.title || 'EVALUATION'}  |  ${spec.client || ''}  |  ${spec.month || ''}` }); H.forEach((h, c) => put(3, c, { t: 's', v: h }));
    const N = (r, c, v, z, fx) => put(r, c, { t: 'n', v: Number.isFinite(v) ? v : 0, ...(z ? { z } : {}), ...(fx ? { f: fx } : {}) });
    let row = 4; const tot = { inv: 0, val: 0, com: 0, cg: 0, cn: 0, ag: 0, an: 0, sp: 0, vs: 0, cc: 0, vc: 0 };
    sheets.forEach((s) => {
      const R = q(s.name) + '!'; put(row, 0, { t: 's', v: s.name });
      N(row, 1, s.all.cost, '#,##0', `${R}O${s.inv}`); N(row, 2, s.all.value, '#,##0', `${R}N${s.all.r}`); N(row, 3, s.com.value, '#,##0', `${R}N${s.com.r}`); N(row, 4, div(s.com.value, s.com.cost), '0.00', `IFERROR(D${row}/Q${row},0)`); N(row, 5, div(s.all.value, s.all.cost), '0.00', `IFERROR(C${row}/B${row},0)`);
      N(row, 6, s.com.grp, '#,##0.0', `${R}G${s.com.r}`); N(row, 7, s.com.ngrp, '#,##0.0', `${R}H${s.com.r}`); N(row, 8, div(s.com.cost, s.com.grp), '#,##0', `IFERROR(Q${row}/G${row},0)`); N(row, 9, div(s.com.cost, s.com.ngrp), '#,##0', `IFERROR(Q${row}/H${row},0)`);
      N(row, 10, s.all.grp, '#,##0.0', `${R}G${s.all.r}`); N(row, 11, s.all.ngrp, '#,##0.0', `${R}H${s.all.r}`); N(row, 12, div(s.all.cost, s.all.grp), '#,##0', `IFERROR(B${row}/K${row},0)`); N(row, 13, div(s.com.cost, s.com.ngrp), '#,##0', `IFERROR(Q${row}/H${row},0)`);
      N(row, 14, s.all.spots, '#,##0', `${R}M${s.all.r}`); N(row, 15, s.va.spots, '#,##0', `${R}M${s.va.r}`); N(row, 16, s.com.cost, '#,##0', `${R}O${s.com.r}`); N(row, 17, s.va.cost, '#,##0', `${R}O${s.va.r}`);
      tot.inv += s.all.cost; tot.val += s.all.value; tot.com += s.com.value; tot.cg += s.com.grp; tot.cn += s.com.ngrp; tot.ag += s.all.grp; tot.an += s.all.ngrp; tot.sp += s.all.spots; tot.vs += s.va.spots; tot.cc += s.com.cost; tot.vc += s.va.cost; row++;
    });
    if (sheets.length) {
      const a = 4, b = row - 1, sm = (c) => `SUM(${c}${a}:${c}${b})`; put(row, 0, { t: 's', v: 'TV' });
      N(row, 1, tot.inv, '#,##0', sm('B')); N(row, 2, tot.val, '#,##0', sm('C')); N(row, 3, tot.com, '#,##0', sm('D')); N(row, 4, div(tot.com, tot.cc), '0.00', `IFERROR(D${row}/Q${row},0)`); N(row, 5, div(tot.val, tot.inv), '0.00', `IFERROR(C${row}/B${row},0)`);
      N(row, 6, tot.cg, '#,##0.0', sm('G')); N(row, 7, tot.cn, '#,##0.0', sm('H')); N(row, 8, div(tot.cc, tot.cg), '#,##0', `IFERROR(Q${row}/G${row},0)`); N(row, 9, div(tot.cc, tot.cn), '#,##0', `IFERROR(Q${row}/H${row},0)`);
      N(row, 10, tot.ag, '#,##0.0', sm('K')); N(row, 11, tot.an, '#,##0.0', sm('L')); N(row, 12, div(tot.inv, tot.ag), '#,##0', `IFERROR(B${row}/K${row},0)`); N(row, 13, div(tot.cc, tot.cn), '#,##0', `IFERROR(Q${row}/H${row},0)`);
      N(row, 14, tot.sp, '#,##0', sm('O')); N(row, 15, tot.vs, '#,##0', sm('P')); N(row, 16, tot.cc, '#,##0', sm('Q')); N(row, 17, tot.vc, '#,##0', sm('R')); row++;
    }
    put(row + 1, 0, { t: 's', v: 'Totals and ratios are formulas that read each channel sheet. ROI = rate card value / cost. Tax is not in the investment.' });
    ws['!ref'] = `A1:R${row + 1}`; ws['!cols'] = [{ wch: 18 }, ...H.slice(1).map(() => ({ wch: 16 }))];
    X.utils.book_append_sheet(wb, ws, 'Summary'); wb.SheetNames.unshift(wb.SheetNames.pop());
    // Formulas sheet: settings read by every channel sheet + the formula of each column
    const fs = [['Formulas and settings (change the values in column B; every sheet reads them)'], [], ['Setting', 'Value', 'Used for'], ['Base seconds', S.base, 'A 30 second spot is the unit. Every spot is turned into 30 second equivalents: spots x duration / base seconds'], ['SSCL rate', S.sscl, 'Tax rows (investment grossed up)'], ['VAT rate', S.vat, 'Tax rows'], [],
      ['Column', 'Formula (row 10 as an example)', 'In plain words'],
      ['GRP', 'F10*M10', 'TVR x number of spots'], ['NGRP', 'G10*E10/Formulas!B3', 'GRP turned into 30 second equivalents'], ['CPRP', 'IFERROR(O10/G10,0)', 'Total cost / GRP'], ['NCPRP', 'IFERROR(O10/H10,0)', 'Total cost / NGRP: the cost of one rating point on a 30 second basis'],
      ['TOTAL VALUE', 'K10*M10*E10/Formulas!B3', 'Rate card rate x spots x duration / 30'], ['TOTAL COST', 'L10*M10*E10/Formulas!B3', 'Negotiated (or paid) rate x spots x duration / 30'],
      ['COMMERCIAL ROI %', 'COMMERCIAL VALUE (col N) / COMMERCIAL VALUE (col O)', 'Rate card value of the commercial spots / what they cost'], ['ALL EXPOSURE ROI %', 'ALL EXPOSURE VALUE (col N) / ALL EXPOSURE VALUE (col O)', 'Rate card value of commercial + sponsorship items / what they cost'],
      ['SSCL / VAT', 'Investment / (1 - SSCL) x rate', 'Same method as the agency sheet: the investment is 100% without taxes'], ['TVR', 'typed', 'Average of the programme in the TVR sheet (all uploaded months)'], ['Rates', 'typed', 'Per 30 seconds. 10 or 15 second rates are multiplied up to 30 seconds']];
    // row 3 is the base seconds, 4 SSCL, 5 VAT: the channel sheets read Formulas!B3:B5
    const fix = X.utils.aoa_to_sheet([fs[0], ['Setting', 'Value', 'Used for'], fs[3], fs[4], fs[5], [], ...fs.slice(7)]); fix['!cols'] = [{ wch: 22 }, { wch: 54 }, { wch: 90 }]; fix.B3.z = '0'; fix.B4.z = '0.0%'; fix.B5.z = '0.0%';
    X.utils.book_append_sheet(wb, fix, 'Formulas');
    return wb;
  }
  App.pitchXlsx = { build };
})(window.App);
