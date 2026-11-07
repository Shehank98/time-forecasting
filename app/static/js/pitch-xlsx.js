/* Client Pitch Evaluator: Excel evaluation workbook in the agency's own sheet format, with live formulas.
 *
 * Summary sheet (Channel, Total Investment, Total Rate Card (all Expo), Com Only, C ROI%, ROI%, GRPs, NGRPs, CPRPs, spots, V/A, exposures, Discount %, Bonus %),
 * a table of the CPRPs of every channel under it, one sheet per channel, and a Formulas sheet that holds the settings every sheet reads.
 *
 * Channel sheet columns (as in the agency sheets): C DESCRIPTION | D DAY | E-F TIME BELT | G DUR | H NUMBER OF SPOTS | I TVR | J GRP | K NGRP | L CPRP | M NCPRP |
 *   N RATE CARD RATE | O NEGOTIATED RATE | P TOTAL VALUE | Q TOTAL COST.   Rates are per spot at the row's duration (30 sec rate / 30 x DUR).
 * spec: {client, title, note, month, channels: [{name, basket: [row], sponsorship: [row]}]}
 * row:  {desc, day, from, to, dur, tvr, spots, card, rate}    card and rate are per 30 seconds; dur is the spot length in seconds; from/to are 'HH:MM'
 */
(function (App) {
  const SET = { base: 'Formulas!$B$3', sscl: 'Formulas!$B$4', vat: 'Formulas!$B$5' };
  const ACC0 = '_(* #,##0_);_(* \\(#,##0\\);_(* "-"??_);_(@_)', ACC2 = '_(* #,##0.00_);_(* \\(#,##0.00\\);_(* "-"??_);_(@_)';      // Excel "Comma Style"
  const NUM2 = '#,##0.00', TVR = '0.00', INT = '0', PCT = '0%', HM = 'h:mm';                                                         // "Number" format for GRPs and TVR
  const HEAD = ['DESCRIPTION', 'DAY', 'TIME BELT', '', 'DUR', 'NUMBER OF SPOTS', 'TVR', 'GRP', 'NGRP', 'CPRP', 'NCPRP', 'RATE CARD RATE', 'NEGOTIATED RATE', 'TOTAL VALUE', 'TOTAL COST'];
  const safeName = (n, used) => { const b = String(n || 'Channel').replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 28) || 'Channel'; let x = b, i = 2; while (used.has(x.toLowerCase())) x = b.slice(0, 26) + ' ' + i++; used.add(x.toLowerCase()); return x; };
  const q = (n) => `'${String(n).replace(/'/g, "''")}'`;
  const secOf = (hm) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(hm || '')); return m ? (+m[1] * 3600 + +m[2] * 60) / 86400 : null; };
  const div = (a, b) => (b ? a / b : 0);

  function build(X, spec, settings) {
    const wb = X.utils.book_new(), E = X.utils.encode_cell, used = new Set(['summary', 'formulas']);
    const S = { base: 30, sscl: 0.025, vat: 0.18, ...(settings || {}) };
    const sheets = [];
    for (const ch of spec.channels) {
      const ws = {}, name = safeName(ch.name, used), at = (r, c) => E({ r: r - 1, c: c - 1 });                       // 1-based row and column
      const txt = (r, c, v) => { ws[at(r, c)] = { t: 's', v: String(v) }; }, nm = (r, c, v, z, f) => { ws[at(r, c)] = { t: 'n', v: Number.isFinite(v) ? v : 0, ...(z ? { z } : {}), ...(f ? { f } : {}) }; };
      txt(2, 3, 'CLIENT :'); txt(2, 4, String(spec.client || '').toUpperCase()); txt(3, 3, 'SUBJECT :'); txt(3, 4, spec.title || 'EVALUATION'); txt(4, 3, 'MEDIUM :'); txt(4, 4, 'TELEVISION');
      txt(5, 3, 'CHANNEL :'); txt(5, 4, String(ch.name).toUpperCase()); txt(6, 3, 'SPONSORSHIP :'); txt(6, 4, [spec.note, spec.month].filter(Boolean).join(' | '));
      HEAD.forEach((h, i) => { if (h) txt(8, 3 + i, h); });
      ws['!merges'] = [{ s: { r: 7, c: 4 }, e: { r: 7, c: 5 } }];
      let r = 9; const blocks = { com: [], va: [] };
      const rowOut = (x, key) => {
        const dur = Number(x.dur) || 30, tvr = Number(x.tvr) || 0, spots = Number(x.spots) || 0, card30 = Number(x.card) || 0, rate30 = Number(x.rate) || 0;
        const card = (card30 / S.base) * dur, rate = (rate30 / S.base) * dur, grp = tvr * spots, ngrp = (tvr / S.base) * dur * spots;
        txt(r, 3, x.desc || ''); txt(r, 4, x.day || '');
        [secOf(x.from), secOf(x.to)].forEach((v, i) => { if (v != null) nm(r, 5 + i, v, HM); });
        nm(r, 7, dur, INT); nm(r, 8, spots, INT); nm(r, 9, tvr, TVR);
        nm(r, 10, grp, NUM2, `I${r}*H${r}`); nm(r, 11, ngrp, NUM2, `(I${r}/${SET.base}*G${r})*H${r}`);
        nm(r, 12, div(rate, tvr), ACC2, `IFERROR(O${r}/I${r},0)`); nm(r, 13, div(rate, (tvr / S.base) * dur), ACC2, `IFERROR(O${r}/(I${r}/${SET.base}*G${r}),0)`);
        nm(r, 14, card, ACC0, `(${card30}/${SET.base})*G${r}`); nm(r, 15, rate, ACC0, `(${rate30}/${SET.base})*G${r}`);
        nm(r, 16, card * spots, ACC0, `N${r}*H${r}`); nm(r, 17, rate * spots, ACC0, `O${r}*H${r}`);
        blocks[key].push({ r, grp, ngrp, spots, value: card * spots, cost: rate * spots }); r++;
      };
      if ((ch.sponsorship || []).length) { txt(r, 3, 'SPONSORSHIP BENEFITS'); r++; ch.sponsorship.forEach((x) => rowOut(x, 'va')); r++; }
      txt(r, 3, 'COMMERCIAL BENEFITS'); r++; (ch.basket || []).forEach((x) => rowOut(x, 'com')); r++;
      const sum = (b, k) => b.reduce((a, x) => a + x[k], 0), rng = (b, col) => (b.length ? `SUM(${col}${b[0].r}:${col}${b[b.length - 1].r})` : '0');
      const total = (label, b, refs) => {
        const row = r++, t = { r: row, grp: sum(b, 'grp'), ngrp: sum(b, 'ngrp'), spots: sum(b, 'spots'), value: sum(b, 'value'), cost: sum(b, 'cost') }; txt(row, 3, label);
        const f = (c) => (refs ? refs(c) : rng(b, c));
        nm(row, 8, t.spots, INT, f('H')); nm(row, 10, t.grp, NUM2, f('J')); nm(row, 11, t.ngrp, NUM2, f('K'));
        nm(row, 12, div(t.cost, t.grp), ACC2, `IFERROR(Q${row}/J${row},0)`); nm(row, 13, div(t.cost, t.ngrp), ACC2, `IFERROR(Q${row}/K${row},0)`);
        nm(row, 16, t.value, ACC0, f('P')); nm(row, 17, t.cost, ACC0, f('Q')); return t;
      };
      const com = total('COMMERCIAL VALUE', blocks.com), va = total('SPONSORSHIP VALUE', blocks.va);
      const all = total('ALL EXPOSURE VALUE', blocks.com.concat(blocks.va), (c) => `${c}${com.r}+${c}${va.r}`);
      const inv = r++; txt(inv, 3, 'ACTUAL INVESTMENT - 100% (WITHOUT TAXES)'); nm(inv, 16, all.cost, ACC0, `Q${all.r}`);
      const gross = div(all.cost, 1 - S.sscl);
      const ss = r++; txt(ss, 3, 'SSCL'); nm(ss, 16, gross * S.sscl, ACC0, `P${inv}/(1-${SET.sscl})*${SET.sscl}`);
      const vt = r++; txt(vt, 3, 'VAT'); nm(vt, 16, gross * S.vat, ACC0, `P${inv}/(1-${SET.sscl})*${SET.vat}`);
      const gt = r++; txt(gt, 3, 'GRAND TOTAL'); nm(gt, 16, gross + gross * S.vat, ACC0, `P${inv}/(1-${SET.sscl})+P${vt}`);
      const cr = r++; txt(cr, 3, 'COMMERCIAL ROI %'); nm(cr, 16, div(com.value, com.cost), PCT, `IFERROR(P${com.r}/Q${com.r},0)`);
      const ar = r++; txt(ar, 3, 'ALL EXPOSURE ROI %'); nm(ar, 16, div(all.value, all.cost), PCT, `IFERROR(P${all.r}/Q${all.r},0)`);
      r++; txt(r++, 3, '*Rate card rate = the 30 second rate card rate / 30 x DUR, for one spot. Negotiated rate = our (or the agency\'s paid) 30 second rate / 30 x DUR.');
      txt(r, 3, '*TOTAL VALUE = rate card rate x spots. TOTAL COST = negotiated rate x spots. ROI = TOTAL VALUE / TOTAL COST. Change any rate, TVR, DUR or number of spots and the sheet recalculates.');
      ws['!ref'] = `A1:Q${r}`;
      ws['!cols'] = [{ wch: 4 }, { wch: 4 }, { wch: 40 }, { wch: 14 }, { wch: 7 }, { wch: 7 }, { wch: 6 }, { wch: 11 }, { wch: 9 }, { wch: 11 }, { wch: 11 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }];
      X.utils.book_append_sheet(wb, ws, name); sheets.push({ name, com, va, all, inv, cr, ar });
    }

    // Summary: the agency's summary table, then the CPRP of every channel
    const ws = {}, at = (r, c) => E({ r: r - 1, c: c - 1 });
    const T = (r, c, v) => { ws[at(r, c)] = { t: 's', v: String(v) }; }, N = (r, c, v, z, fx) => { ws[at(r, c)] = { t: 'n', v: Number.isFinite(v) ? v : 0, ...(z ? { z } : {}), ...(fx ? { f: fx } : {}) }; };
    const H = ['Channel', 'Total Investment', 'Total Rate Card (all Expo)', 'Com Only', 'C ROI%', 'ROI%', 'Com Only GRPs', 'Com Only NGRPs', 'Com Only CPRP', 'Com Only N CPRP', 'Total GRPs', 'Total NGRPs', 'CPRP All Expo', 'NCPRP - 30 Sec All Expo', 'Total Number of Spots ', 'Total Number of V/A', 'Total Exposures '];
    H.forEach((h, i) => T(2, 1 + i, h)); T(2, 19, 'Discount %'); T(2, 20, 'Bonus %'); T(2, 22, 'Commercial Cost'); T(2, 23, 'Sponsorship Cost');
    T(1, 1, `${spec.title || 'EVALUATION'}  |  ${spec.client || ''}  |  ${spec.month || ''}`);
    let row = 3; const tot = { inv: 0, val: 0, com: 0, cg: 0, cn: 0, ag: 0, an: 0, sp: 0, vs: 0, cc: 0, vc: 0, vav: 0 };
    sheets.forEach((s) => {
      const R = q(s.name) + '!'; ws[at(row, 1)] = { t: 's', v: s.name.toUpperCase(), f: `${R}D5` };
      N(row, 2, s.all.cost, ACC0, `${R}P${s.inv}`); N(row, 3, s.all.value, ACC0, `${R}P${s.all.r}`); N(row, 4, s.com.value, ACC0, `${R}P${s.com.r}`);
      N(row, 5, div(s.com.value, s.com.cost), PCT, `IFERROR(D${row}/V${row},0)`); N(row, 6, div(s.all.value, s.all.cost), PCT, `IFERROR(C${row}/B${row},0)`);
      N(row, 7, s.com.grp, NUM2, `${R}J${s.com.r}`); N(row, 8, s.com.ngrp, NUM2, `${R}K${s.com.r}`); N(row, 9, div(s.com.cost, s.com.grp), ACC2, `${R}L${s.com.r}`); N(row, 10, div(s.com.cost, s.com.ngrp), ACC2, `${R}M${s.com.r}`);
      N(row, 11, s.all.grp, NUM2, `${R}J${s.all.r}`); N(row, 12, s.all.ngrp, NUM2, `${R}K${s.all.r}`); N(row, 13, div(s.all.cost, s.all.grp), ACC2, `${R}L${s.all.r}`); N(row, 14, div(s.all.cost, s.all.ngrp), ACC2, `${R}M${s.all.r}`);
      N(row, 15, s.com.spots, INT, `${R}H${s.com.r}`); N(row, 16, s.va.spots, INT, `${R}H${s.va.r}`); N(row, 17, s.com.spots + s.va.spots, INT, `SUM(O${row}:P${row})`);
      N(row, 19, 1 - div(s.com.cost, s.com.value), PCT, `IFERROR(1-V${row}/D${row},0)`); N(row, 20, div(s.va.value, s.com.value), PCT, `IFERROR(${R}P${s.va.r}/D${row},0)`);
      N(row, 22, s.com.cost, ACC0, `${R}Q${s.com.r}`); N(row, 23, s.va.cost, ACC0, `${R}Q${s.va.r}`);
      tot.inv += s.all.cost; tot.val += s.all.value; tot.com += s.com.value; tot.cg += s.com.grp; tot.cn += s.com.ngrp; tot.ag += s.all.grp; tot.an += s.all.ngrp; tot.sp += s.com.spots; tot.vs += s.va.spots; tot.cc += s.com.cost; tot.vc += s.va.cost; tot.vav += s.va.value; row++;
    });
    const first = 3, last = row - 1, sm = (c) => `SUM(${c}${first}:${c}${last})`, tvRow = row;
    if (sheets.length) {
      T(row, 1, 'TV ');
      N(row, 2, tot.inv, ACC0, sm('B')); N(row, 3, tot.val, ACC0, sm('C')); N(row, 4, tot.com, ACC0, sm('D')); N(row, 5, div(tot.com, tot.cc), PCT, `IFERROR(D${row}/V${row},0)`); N(row, 6, div(tot.val, tot.inv), PCT, `IFERROR(C${row}/B${row},0)`);
      N(row, 7, tot.cg, NUM2, sm('G')); N(row, 8, tot.cn, NUM2, sm('H')); N(row, 9, div(tot.cc, tot.cg), ACC2, `IFERROR(V${row}/G${row},0)`); N(row, 10, div(tot.cc, tot.cn), ACC2, `IFERROR(V${row}/H${row},0)`);
      N(row, 11, tot.ag, NUM2, sm('K')); N(row, 12, tot.an, NUM2, sm('L')); N(row, 13, div(tot.inv, tot.ag), ACC2, `IFERROR(B${row}/K${row},0)`); N(row, 14, div(tot.inv, tot.an), ACC2, `IFERROR(B${row}/L${row},0)`);
      N(row, 15, tot.sp, ACC0, sm('O')); N(row, 16, tot.vs, ACC0, sm('P')); N(row, 17, tot.sp + tot.vs, ACC0, sm('Q'));
      N(row, 19, 1 - div(tot.cc, tot.com), PCT, `IFERROR(1-V${row}/D${row},0)`); N(row, 20, div(tot.vav, tot.com), PCT, `IFERROR(SUMPRODUCT(T${first}:T${last},D${first}:D${last})/D${row},0)`);
      N(row, 22, tot.cc, ACC0, sm('V')); N(row, 23, tot.vc, ACC0, sm('W'));
      row += 2; T(row, 1, 'Total Budget'); N(row, 2, tot.inv, ACC0, `B${tvRow}`); N(row, 3, tot.val, ACC0, `C${tvRow}`); N(row, 4, tot.com, ACC0, `D${tvRow}`); N(row, 5, div(tot.com, tot.cc), PCT, `E${tvRow}`); N(row, 6, div(tot.val, tot.inv), PCT, `F${tvRow}`);
      // CPRP of every channel, under the summary
      row += 3; T(row, 1, 'CPRP BY CHANNEL (cost per rating point, LKR)'); row++;
      ['Channel', 'Com Only CPRP', 'Com Only NCPRP (30 sec)', 'All Exposure CPRP', 'All Exposure NCPRP (30 sec)', 'Com Only GRPs', 'All Exposure GRPs'].forEach((h, i) => T(row, 1 + i, h)); row++;
      const cp0 = row;
      for (let k = first; k <= last + 1; k++, row++) {
        const isTot = k === last + 1, src = isTot ? tvRow : k, val = isTot ? { n: 'TV ', c: tot.cc, g: tot.cg, ng: tot.cn, ac: tot.inv, ag: tot.ag, an: tot.an } : (() => { const s = sheets[k - first]; return { n: s.name.toUpperCase(), c: s.com.cost, g: s.com.grp, ng: s.com.ngrp, ac: s.all.cost, ag: s.all.grp, an: s.all.ngrp }; })();
        ws[at(row, 1)] = { t: 's', v: val.n, f: `A${src}` }; N(row, 2, div(val.c, val.g), ACC2, `I${src}`); N(row, 3, div(val.c, val.ng), ACC2, `J${src}`); N(row, 4, div(val.ac, val.ag), ACC2, `M${src}`); N(row, 5, div(val.ac, val.an), ACC2, `N${src}`); N(row, 6, val.g, NUM2, `G${src}`); N(row, 7, val.ag, NUM2, `K${src}`);
      }
      void cp0;
    }
    T(row + 2, 1, 'CPRP = cost / GRPs. NCPRP = cost / NGRPs (every spot turned into 30 second equivalents). Com Only = commercial spots; All Exposure adds the sponsorship items. ROI = rate card value / cost. Tax is not in the investment.');
    ws['!ref'] = `A1:W${row + 2}`; ws['!cols'] = [{ wch: 22 }, ...H.slice(1).map((h) => ({ wch: Math.max(20, h.length + 3) })), { wch: 3 }, { wch: 12 }, { wch: 12 }, { wch: 3 }, { wch: 18 }, { wch: 18 }];
    X.utils.book_append_sheet(wb, ws, 'Summary'); wb.SheetNames.unshift(wb.SheetNames.pop());

    // Formulas sheet: settings read by every channel sheet + the formula of each column
    const fs = [['Formulas and settings (change the values in column B; every sheet reads them)'], ['Setting', 'Value', 'Used for'],
      ['Base seconds', S.base, 'A 30 second spot is the unit. Rates are per 30 seconds; a spot of another length is priced at rate / base seconds x DUR'], ['SSCL rate', S.sscl, 'Tax rows (the investment is 100% without taxes and is grossed up)'], ['VAT rate', S.vat, 'Tax rows'], [],
      ['Column', 'Formula (row 12 as an example)', 'In plain words'],
      ['GRP', 'I12*H12', 'TVR x number of spots'], ['NGRP', '(I12/Formulas!B3*G12)*H12', 'GRP turned into 30 second equivalents: TVR / 30 x DUR x spots'], ['CPRP', 'IFERROR(O12/I12,0)', 'Negotiated rate of one spot / TVR = cost per rating point'],
      ['NCPRP', 'IFERROR(O12/(I12/Formulas!B3*G12),0)', 'Negotiated rate of one spot / (TVR / 30 x DUR): cost per rating point on a 30 second basis'], ['RATE CARD RATE', '(30 sec rate / Formulas!B3) * G12', 'Rate card rate of one spot of this length'], ['NEGOTIATED RATE', '(30 sec rate / Formulas!B3) * G12', 'Negotiated (or paid) rate of one spot of this length'],
      ['TOTAL VALUE', 'N12*H12', 'Rate card rate x spots'], ['TOTAL COST', 'O12*H12', 'Negotiated rate x spots'], ['COMMERCIAL VALUE / ALL EXPOSURE VALUE', 'SUM of the rows', 'Commercial rows only / commercial + sponsorship rows; CPRP = total cost / total GRP'],
      ['COMMERCIAL ROI %', 'COMMERCIAL VALUE (col P) / COMMERCIAL VALUE (col Q)', 'Rate card value of the commercial spots / what they cost'], ['ALL EXPOSURE ROI %', 'ALL EXPOSURE VALUE (col P) / ALL EXPOSURE VALUE (col Q)', 'Rate card value of commercial + sponsorship items / what they cost'],
      ['SSCL / VAT', 'Investment / (1 - SSCL) x rate', 'The investment is 100% without taxes, grossed up for SSCL; VAT is on the grossed-up amount'], ['Discount % (Summary)', '1 - commercial cost / commercial rate card value', 'How far below the rate card the commercial spots were bought'],
      ['Bonus % (Summary)', 'sponsorship rate card value / commercial rate card value', 'Extra exposure from the sponsorship items on top of the commercial spots'], ['TVR', 'typed', 'Average of the programme in the TVR sheet (all uploaded months)']];
    const fx = X.utils.aoa_to_sheet(fs); fx['!cols'] = [{ wch: 34 }, { wch: 56 }, { wch: 96 }]; fx.B3.z = '0'; fx.B4.z = '0.0%'; fx.B5.z = '0.0%';
    X.utils.book_append_sheet(wb, fx, 'Formulas');
    return wb;
  }
  App.pitchXlsx = { build };
})(window.App);
