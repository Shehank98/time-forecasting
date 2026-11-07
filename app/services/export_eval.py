"""Client Pitch Evaluator: the evaluation workbook in the agency's sheet format (styled, with live formulas).

One Summary sheet, one sheet per channel and a Formulas sheet that holds the settings every sheet reads.
Channel sheet columns (C to R): DESCRIPTION | DAY | TIME BELT (E-F) | DUR | NUMBER OF SPOTS | TVR | GRP | NGRP | CPRP | NCPRP | RATE CARD RATE | NEGOTIATED RATE | TOTAL VALUE | TOTAL COST | BAND.
Rates are per spot at the row's duration: the 30 second rate / 30 x DUR, written as a formula.

spec: {client, title, note, month, prime: [startFraction, endFraction], channels: [{name, deal: {investment, commercial_pct, prime_pct, bonus_pct, est_discount_pct}, basket: [row], sponsorship: [row], bonus: [row]}]}
row:  {desc, day, from, to, dur, tvr, spots, card, rate, band}   card and rate are per 30 seconds; from and to are 'HH:MM'
"""
from __future__ import annotations

import datetime as dt
import io
import re
from typing import Any

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter as L
from openpyxl.worksheet.properties import PageSetupProperties
from openpyxl.worksheet.worksheet import Worksheet

BASE, SSCL, VAT = "Formulas!$B$3", "Formulas!$B$4", "Formulas!$B$5"
ACC0 = '_(* #,##0_);_(* \\(#,##0\\);_(* "-"??_);_(@_)'                    # Excel "Comma Style"
ACC2 = '_(* #,##0.00_);_(* \\(#,##0.00\\);_(* "-"??_);_(@_)'
NUM2, TVR, INT, PCT, HM = "#,##0.00", "0.00", "0", "0%", "h:mm"
BLACK, GREY, LIGHT, EDGE, INPUT = "000000", "7F7F7F", "F2F2F2", "BFBFBF", "FFF2CC"
HEAD = ["DESCRIPTION", "DAY", "TIME BELT", "", "DUR", "NUMBER OF SPOTS", "TVR", "GRP", "NGRP", "CPRP", "NCPRP", "RATE CARD RATE", "NEGOTIATED RATE", "TOTAL VALUE", "TOTAL COST", "BAND"]
WIDTHS = {"A": 2, "B": 2, "C": 42, "D": 13, "E": 8, "F": 8, "G": 7, "H": 11, "I": 8, "J": 12, "K": 12, "L": 14, "M": 14, "N": 16, "O": 16, "P": 17, "Q": 17, "R": 7, "S": 3, "T": 46, "U": 2, "V": 11, "W": 17, "X": 17}
_thin = Side(style="thin", color=EDGE)
_BOX = Border(left=_thin, right=_thin, top=_thin, bottom=_thin)


def _font(bold=False, white=False, size=10, italic=False, underline=False, color=None) -> Font:
    return Font(name="Calibri", size=size, bold=bold, italic=italic, underline="single" if underline else None, color="FFFFFF" if white else (color or "000000"))


def _fill(hex_: str) -> PatternFill:
    return PatternFill("solid", start_color=hex_, end_color=hex_)


def _put(ws: Worksheet, r: int, c: int, v: Any = None, fmt: str | None = None, bold=False, white=False, fill: str | None = None, h: str | None = None, box=True, size=10, italic=False,
         underline=False, wrap=False, color=None, top: str | None = None):
    cell = ws.cell(r, c)
    if v is not None:
        cell.value = v
    cell.font = _font(bold, white, size, italic, underline, color)
    if fmt:
        cell.number_format = fmt
    if fill:
        cell.fill = _fill(fill)
    cell.alignment = Alignment(horizontal=h, vertical="center", wrap_text=wrap)
    if box:
        cell.border = _BOX
    if top:
        cell.border = Border(left=_thin, right=_thin, bottom=_thin, top=Side(style=top, color="000000"))
    return cell


def _bar(ws: Worksheet, r: int, c0: int, c1: int, fill: str, text: str | None = None, fmt_col: int | None = None, fmt_val: Any = None, fmt: str | None = None, size=10):
    """A full width coloured bar with white bold text (section bars, ROI bars)."""
    for c in range(c0, c1 + 1):
        _put(ws, r, c, None, fill=fill, white=True, bold=True, box=False, size=size)
    if text:
        ws.cell(r, c0).value = text
    if fmt_col is not None:
        cell = _put(ws, r, fmt_col, fmt_val, fmt=fmt, fill=fill, white=True, bold=True, box=False, h="right", size=size)
        cell.number_format = fmt or "General"


def _safe_name(name: str, used: set[str]) -> str:
    base = re.sub(r"[\\/?*\[\]:]", " ", str(name or "Channel")).strip()[:28] or "Channel"
    x, i = base, 2
    while x.lower() in used:
        x = f"{base[:26]} {i}"
        i += 1
    used.add(x.lower())
    return x


def _q(name: str) -> str:
    return "'" + name.replace("'", "''") + "'"


def _time(v: Any) -> dt.time | None:
    m = re.match(r"^(\d{1,2}):(\d{2})", str(v or ""))
    return dt.time(int(m.group(1)) % 24, int(m.group(2))) if m else None


def _num(v: Any, default: float = 0.0) -> float:
    try:
        x = float(v)
        return x if x == x else default
    except (TypeError, ValueError):
        return default


def _f(x: float) -> str:
    return f"{x:.10g}"


def _channel_sheet(wb: Workbook, spec: dict, ch: dict, used: set[str]) -> dict:
    name = _safe_name(ch.get("name"), used)
    ws = wb.create_sheet(name)
    ws.sheet_view.showGridLines = False
    ws.sheet_properties.tabColor = BLACK
    for col, w in WIDTHS.items():
        ws.column_dimensions[col].width = w
    prime = spec.get("prime") or [19 / 24, 22.5 / 24]
    for i, (lab, val) in enumerate([("CLIENT :", str(spec.get("client") or "").upper()), ("SUBJECT :", spec.get("title") or "EVALUATION"), ("MEDIUM :", "TELEVISION"), ("CHANNEL :", str(ch.get("name") or "").upper()),
                                    ("SPONSORSHIP :", " | ".join(x for x in [spec.get("note"), spec.get("month")] if x))]):
        _put(ws, 2 + i, 3, lab, bold=True, box=False, size=11)
        _put(ws, 2 + i, 4, val, bold=True, box=False, size=11)
    ws.row_dimensions[8].height = 34
    for i, h in enumerate(HEAD):
        _put(ws, 8, 3 + i, h or None, bold=True, white=True, fill=BLACK, h="center", wrap=True)
    ws.merge_cells("E8:F8")
    r = 9
    blocks: dict[str, list[dict]] = {"com": [], "va": [], "bonus": []}

    def row_out(x: dict, key: str, band: str = "") -> None:
        nonlocal r
        dur, tvr, spots = _num(x.get("dur"), 30) or 30, _num(x.get("tvr")), _num(x.get("spots"))
        card30, rate30 = _num(x.get("card")), _num(x.get("rate"))
        _put(ws, r, 3, x.get("desc") or "", h="left")
        _put(ws, r, 4, x.get("day") or "", h="center")
        for i, k in enumerate(("from", "to")):
            t = _time(x.get(k))
            _put(ws, r, 5 + i, t, fmt=HM, h="center")
        _put(ws, r, 7, dur, fmt=INT, h="center")
        _put(ws, r, 8, spots, fmt=INT, h="center")
        _put(ws, r, 9, tvr, fmt=TVR, h="center")
        _put(ws, r, 10, f"=I{r}*H{r}", fmt=NUM2, h="right")
        _put(ws, r, 11, f"=(I{r}/{BASE}*G{r})*H{r}", fmt=NUM2, h="right")
        _put(ws, r, 12, f"=IFERROR(O{r}/I{r},0)", fmt=ACC2)
        _put(ws, r, 13, f"=IFERROR(O{r}/(I{r}/{BASE}*G{r}),0)", fmt=ACC2)
        _put(ws, r, 14, f"=({_f(card30)}/{BASE})*G{r}", fmt=ACC0)
        _put(ws, r, 15, f"=({_f(rate30)}/{BASE})*G{r}", fmt=ACC0)
        _put(ws, r, 16, f"=N{r}*H{r}", fmt=ACC0)
        _put(ws, r, 17, f"=O{r}*H{r}", fmt=ACC0)
        _put(ws, r, 18, band or None, h="center")
        blocks[key].append({"r": r})
        r += 1

    def sub(text: str) -> None:
        nonlocal r
        for c in range(3, 19):
            _put(ws, r, c, None)
        ws.cell(r, 3).value = text
        ws.cell(r, 3).font = _font(bold=True, underline=True)
        r += 1

    if ch.get("sponsorship"):
        _bar(ws, r, 3, 18, GREY, "SPONSORSHIP BENEFITS")
        r += 1
        for x in ch["sponsorship"]:
            row_out(x, "va")
        r += 1
    _bar(ws, r, 3, 18, GREY, "COMMERCIAL BENEFITS")
    r += 1
    rows = list(ch.get("basket") or [])

    def band_of(x: dict) -> str:
        if x.get("band"):
            return str(x["band"])
        t = _time(x.get("from"))
        if t is None:
            return ""
        f = (t.hour * 60 + t.minute) / 1440
        return "PT" if prime[0] <= f < prime[1] else "NPT"
    key = lambda x: (_time(x.get("from")) or dt.time(23, 59), str(x.get("desc") or ""))        # noqa: E731
    if any(x.get("group") for x in rows):                              # the channel's own bands (Prime A, Prime B, Non prime, weekday, weekend ...)
        order: dict[str, float] = {}
        for x in rows:
            order.setdefault(str(x.get("group") or "OTHER"), _num(x.get("gorder"), 99))
        for label in sorted(order, key=lambda g: (order[g], g)):
            group = sorted([x for x in rows if str(x.get("group") or "OTHER") == label], key=key)
            sub(label.upper())
            for x in group:
                row_out(x, "com", band_of(x))
    else:
        pt, npt = sorted([x for x in rows if band_of(x) == "PT"], key=key), sorted([x for x in rows if band_of(x) != "PT"], key=key)
        for label, group, b in (("PRIME TIME", pt, "PT"), ("NON PRIME TIME", npt, "NPT")):
            if group:
                sub(label)
                for x in group:
                    row_out(x, "com", band_of(x) or b)
    r += 1
    if ch.get("bonus"):
        _bar(ws, r, 3, 18, GREY, "BONUS COMMERCIALS")
        r += 1
        for x in sorted(ch["bonus"], key=key):
            row_out(x, "bonus", band_of(x))
        r += 1

    def rng(rows_: list[dict], col: str) -> str:
        return f"SUM({col}{rows_[0]['r']}:{col}{rows_[-1]['r']})" if rows_ else "0"

    def total(label: str, rows_: list[dict] | None, refs=None) -> dict:
        nonlocal r
        row = r
        r += 1
        for c in range(3, 19):
            _put(ws, row, c, None, fill=LIGHT, bold=True, top="thin")
        ws.cell(row, 3).value = label
        f = (lambda col: "=" + refs(col)) if refs else (lambda col: "=" + rng(rows_ or [], col))
        _put(ws, row, 8, f("H"), fmt=INT, fill=LIGHT, bold=True, h="center", top="thin")
        _put(ws, row, 10, f("J"), fmt=NUM2, fill=LIGHT, bold=True, h="right", top="thin")
        _put(ws, row, 11, f("K"), fmt=NUM2, fill=LIGHT, bold=True, h="right", top="thin")
        _put(ws, row, 12, f"=IFERROR(Q{row}/J{row},0)", fmt=ACC2, fill=LIGHT, bold=True, top="thin")
        _put(ws, row, 13, f"=IFERROR(Q{row}/K{row},0)", fmt=ACC2, fill=LIGHT, bold=True, top="thin")
        _put(ws, row, 16, f("P"), fmt=ACC0, fill=LIGHT, bold=True, top="thin")
        _put(ws, row, 17, f("Q"), fmt=ACC0, fill=LIGHT, bold=True, top="thin")
        return {"r": row}

    com, va, bo = total("COMMERCIAL VALUE", blocks["com"]), total("SPONSORSHIP VALUE", blocks["va"]), total("BONUS VALUE", blocks["bonus"])
    al = total("ALL EXPOSURE VALUE", None, lambda c: f"{c}{com['r']}+{c}{va['r']}+{c}{bo['r']}")
    inv = r
    r += 1
    for lab, fm, fmt in (("ACTUAL INVESTMENT - 100% (WITHOUT TAXES)", f"=Q{al['r']}", ACC0), ("SSCL", f"=P{inv}/(1-{SSCL})*{SSCL}", ACC0), ("VAT", f"=P{inv}/(1-{SSCL})*{VAT}", ACC0)):
        row = inv if lab.startswith("ACTUAL") else r
        if row != inv:
            r += 1
        for c in range(3, 19):
            _put(ws, row, c, None)
        _put(ws, row, 3, lab, bold=True, box=False)
        _put(ws, row, 16, fm, fmt=fmt, bold=True, box=False)
    vt = r - 1
    gt = r
    r += 1
    _put(ws, gt, 3, "GRAND TOTAL", bold=True, fill=LIGHT, top="thin")
    for c in range(4, 19):
        _put(ws, gt, c, None, fill=LIGHT, top="thin")
    _put(ws, gt, 16, f"=P{inv}/(1-{SSCL})+P{vt}", fmt=ACC0, bold=True, fill=LIGHT, top="thin")
    _bar(ws, r, 3, 17, BLACK, "COMMERCIAL ROI %", 16, f"=IFERROR(P{com['r']}/Q{com['r']},0)", PCT)
    r += 1
    _bar(ws, r, 3, 17, BLACK, "ALL EXPOSURE ROI %", 16, f"=IFERROR(P{al['r']}/Q{al['r']},0)", PCT)
    r += 1
    last0 = r - 1
    # the deal: investment, the share of it that buys commercial spots, the prime / non prime split, and what the spots add up to against each
    deal = None
    d = ch.get("deal") or {}
    if _num(d.get("investment")) > 0:
        inv0, cp = _num(d["investment"]), (_num(d.get("commercial_pct"), 100) or 100) / 100
        pp = _num(d.get("prime_pct")) / 100 if _num(d.get("prime_pct")) > 0 else None
        r0 = 10
        for c in (20, 22, 23):
            _put(ws, r0, c, None, bold=True, white=True, fill=BLACK, h="center")
        _put(ws, r0, 20, "DEAL / COMMERCIAL BUDGET", bold=True, white=True, fill=BLACK, h="left")
        _put(ws, r0, 22, "Share", bold=True, white=True, fill=BLACK, h="center")
        _put(ws, r0, 23, "Budget", bold=True, white=True, fill=BLACK, h="center")
        _put(ws, r0 + 1, 20, "Investment (contract)", bold=True)
        _put(ws, r0 + 1, 22, None)
        _put(ws, r0 + 1, 23, inv0, fmt=ACC0, fill=INPUT, bold=True)
        _put(ws, r0 + 2, 20, "Commercial benefits (share of the investment)")
        _put(ws, r0 + 2, 22, cp, fmt=PCT, fill=INPUT, h="center")
        _put(ws, r0 + 2, 23, f"=W{r0 + 1}*V{r0 + 2}", fmt=ACC0)
        _put(ws, r0 + 3, 20, "Sponsorship / frequency items (the rest)")
        _put(ws, r0 + 3, 22, f"=1-V{r0 + 2}", fmt=PCT, h="center")
        _put(ws, r0 + 3, 23, f"=W{r0 + 1}-W{r0 + 2}", fmt=ACC0)
        k = r0 + 4
        bp = _num(d.get("bonus_pct")) / 100 if _num(d.get("bonus_pct")) > 0 else None
        bonus_row = None
        if pp is not None:
            _put(ws, k, 20, "Prime time (of the commercial benefits)")
            _put(ws, k, 22, pp, fmt=PCT, fill=INPUT, h="center")
            _put(ws, k, 23, f"=W{r0 + 2}*V{k}", fmt=ACC0)
            _put(ws, k + 1, 20, "Non prime time")
            _put(ws, k + 1, 22, f"=1-V{k}", fmt=PCT, h="center")
            _put(ws, k + 1, 23, f"=W{r0 + 2}-W{k}", fmt=ACC0)
            k += 2
        if bp is not None:
            bonus_row = k
            _put(ws, k, 20, "Bonus commercials (share of the commercial rate card value)")
            _put(ws, k, 22, bp, fmt=PCT, fill=INPUT, h="center")
            _put(ws, k, 23, f"=V{k}*P{com['r']}", fmt=ACC0)
            k += 1
        k += 1
        for c, t in ((20, "PLANNED AGAINST BUDGET"), (22, "Budget"), (23, "Planned"), (24, "Balance")):
            _put(ws, k, c, t, bold=True, white=True, fill=BLACK, h="left" if c == 20 else "center")
        k += 1

        def line(label: str, bud: str, planned: str) -> None:
            nonlocal k
            _put(ws, k, 20, label)
            _put(ws, k, 22, bud, fmt=ACC0)
            _put(ws, k, 23, planned, fmt=ACC0)
            _put(ws, k, 24, f"=V{k}-W{k}", fmt=ACC0)
            k += 1
        line("Commercial benefits", f"=W{r0 + 2}", f"=Q{com['r']}")
        if pp is not None:
            line("Prime time", f"=W{r0 + 4}", f'=SUMIF($R$9:$R${last0},"PT",$Q$9:$Q${last0})')
            line("Non prime time", f"=W{r0 + 5}", f'=SUMIF($R$9:$R${last0},"NPT",$Q$9:$Q${last0})')
        line("Sponsorship / frequency items", f"=W{r0 + 3}", f"=Q{va['r']}")
        if bonus_row is not None:
            line("Bonus commercials (value at rate card)", f"=W{bonus_row}", f"=P{bo['r']}")
        _put(ws, k, 20, "Discount vs rate card (commercial)", bold=True)
        _put(ws, k, 22, None)
        _put(ws, k, 23, f"=IFERROR(1-W{r0 + 2}/P{com['r']},0)", fmt=PCT, bold=True)
        deal = {"inv_row": r0 + 1, "com_pct": r0 + 2, "disc": k}
        if _num(d.get("est_discount_pct")) > 0:                       # the discount typed as an estimate is a check on the one the investment gives
            _put(ws, k + 1, 20, "Estimated discount (typed)")
            _put(ws, k + 1, 22, None)
            _put(ws, k + 1, 23, _num(d["est_discount_pct"]) / 100, fmt=PCT, fill=INPUT)
            _put(ws, k + 2, 20, "Difference: estimate minus real (points)")
            _put(ws, k + 2, 22, None)
            _put(ws, k + 2, 23, f"=W{k + 1}-W{k}", fmt=PCT)
            k += 2
        r = max(r, k + 1)
    r += 1
    for t in ("*Rate card rate = the 30 second rate card rate / 30 x DUR, for one spot. Negotiated rate = our (or the agency's paid) 30 second rate / 30 x DUR.",
              "*TOTAL VALUE = rate card rate x spots. TOTAL COST = negotiated rate x spots. ROI = TOTAL VALUE / TOTAL COST. Change any rate, TVR, DUR or number of spots and the sheet recalculates."):
        _put(ws, r, 3, t, italic=True, box=False, size=9, color="595959")
        r += 1
    ws.freeze_panes = "D9"
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr = PageSetupProperties(fitToPage=True)
    ws.print_title_rows = "8:8"
    ws.print_area = f"A1:R{last0 + 4}"
    return {"name": name, "com": com["r"], "va": va["r"], "bonus": bo["r"], "all": al["r"], "inv": inv, "deal": deal, "label": str(ch.get("name") or "").upper()}


def _summary(ws: Worksheet, spec: dict, sheets: list[dict]) -> None:
    ws.sheet_view.showGridLines = False
    ws.sheet_properties.tabColor = BLACK
    heads = ["Channel", "Total Investment", "Total Rate Card (all Expo)", "Com Only", "C ROI%", "ROI%", "Com Only GRPs", "Com Only NGRPs", "Com Only CPRP", "Com Only N CPRP", "Total GRPs", "Total NGRPs", "CPRP All Expo",
             "NCPRP - 30 Sec All Expo", "Total Number of Spots ", "Total Number of V/A", "Total Exposures "]
    ws.column_dimensions["A"].width = 26
    for i in range(2, 18):
        ws.column_dimensions[L(i)].width = max(18, len(heads[i - 1]) + 3)
    for col, w in (("R", 3), ("S", 12), ("T", 12), ("U", 3), ("V", 18), ("W", 18), ("X", 3), ("Y", 18), ("Z", 18), ("AA", 20), ("AB", 3), ("AC", 14), ("AD", 20)):
        ws.column_dimensions[col].width = w
    ws.merge_cells("A1:Q1")
    ws.row_dimensions[1].height = 28
    _put(ws, 1, 1, f"EVALUATION SUMMARY  |  {spec.get('title') or ''}  |  {spec.get('client') or ''}  |  {spec.get('month') or ''}", bold=True, white=True, fill=BLACK, size=13, box=False, h="left")
    ws.row_dimensions[2].height = 44
    for i, h in enumerate(heads):
        _put(ws, 2, 1 + i, h, bold=True, white=True, fill=BLACK, h="center", wrap=True)
    for c, h in ((19, "Discount %"), (20, "Bonus %"), (22, "Commercial Cost"), (23, "Sponsorship Cost"), (25, "Actual Investment"), (26, "Commercial % of Investment"), (27, "Discount vs Rate Card (Com)"), (29, "Bonus Spots"), (30, "Bonus Rate Card Value")):
        _put(ws, 2, c, h, bold=True, white=True, fill=BLACK, h="center", wrap=True)
    row = 3
    first = row
    for i, s in enumerate(sheets):
        R = _q(s["name"]) + "!"
        band = LIGHT if i % 2 else None
        cells = [(1, f"={R}D5", None, "left"), (2, f"={R}P{s['inv']}", ACC0, None), (3, f"={R}P{s['all']}", ACC0, None), (4, f"={R}P{s['com']}", ACC0, None), (5, f"=IFERROR(D{row}/V{row},0)", PCT, "center"),
                 (6, f"=IFERROR(C{row}/B{row},0)", PCT, "center"), (7, f"={R}J{s['com']}", NUM2, None), (8, f"={R}K{s['com']}", NUM2, None), (9, f"={R}L{s['com']}", ACC2, None), (10, f"={R}M{s['com']}", ACC2, None),
                 (11, f"={R}J{s['all']}", NUM2, None), (12, f"={R}K{s['all']}", NUM2, None), (13, f"={R}L{s['all']}", ACC2, None), (14, f"={R}M{s['all']}", ACC2, None), (15, f"={R}H{s['com']}", INT, "center"),
                 (16, f"={R}H{s['va']}", INT, "center"), (17, f"=SUM(O{row}:P{row})+AC{row}", INT, "center"), (19, f"=IFERROR(1-V{row}/D{row},0)", PCT, "center"), (20, f"=IFERROR(({R}P{s['va']}+{R}P{s['bonus']})/D{row},0)", PCT, "center"), (29, f"={R}H{s['bonus']}", INT, "center"), (30, f"={R}P{s['bonus']}", ACC0, None),
                 (22, f"={R}Q{s['com']}", ACC0, None), (23, f"={R}Q{s['va']}", ACC0, None)]
        for c, v, fmt, h in cells:
            _put(ws, row, c, v, fmt=fmt, fill=band, h=h, bold=(c == 1))
        if s["deal"]:
            d = s["deal"]
            _put(ws, row, 25, f"={R}W{d['inv_row']}", fmt=ACC0, fill=band)
            _put(ws, row, 26, f"={R}V{d['com_pct']}", fmt=PCT, fill=band, h="center")
            _put(ws, row, 27, f"={R}W{d['disc']}", fmt=PCT, fill=band, h="center")
        row += 1
    last = row - 1
    tv = row
    if sheets:
        sm = lambda col: f"=SUM({col}{first}:{col}{last})"          # noqa: E731
        tot = [(1, "TV ", None), (2, sm("B"), ACC0), (3, sm("C"), ACC0), (4, sm("D"), ACC0), (5, f"=IFERROR(D{tv}/V{tv},0)", PCT), (6, f"=IFERROR(C{tv}/B{tv},0)", PCT), (7, sm("G"), NUM2), (8, sm("H"), NUM2),
               (9, f"=IFERROR(V{tv}/G{tv},0)", ACC2), (10, f"=IFERROR(V{tv}/H{tv},0)", ACC2), (11, sm("K"), NUM2), (12, sm("L"), NUM2), (13, f"=IFERROR(B{tv}/K{tv},0)", ACC2), (14, f"=IFERROR(B{tv}/L{tv},0)", ACC2),
               (15, sm("O"), INT), (16, sm("P"), INT), (17, sm("Q"), INT), (19, f"=IFERROR(1-V{tv}/D{tv},0)", PCT), (20, f"=IFERROR(SUMPRODUCT(T{first}:T{last},D{first}:D{last})/D{tv},0)", PCT), (22, sm("V"), ACC0), (23, sm("W"), ACC0), (29, sm("AC"), INT), (30, sm("AD"), ACC0)]
        for c, v, fmt in tot:
            _put(ws, tv, c, v, fmt=fmt, bold=True, fill=LIGHT, top="medium", h="center" if c in (5, 6, 15, 16, 17, 19, 20, 29) else None)
        row = tv + 2
        _put(ws, row, 1, "Total Budget", bold=True, fill=LIGHT)
        for c, col, fmt in ((2, "B", ACC0), (3, "C", ACC0), (4, "D", ACC0), (5, "E", PCT), (6, "F", PCT)):
            _put(ws, row, c, f"={col}{tv}", fmt=fmt, bold=True, fill=LIGHT, h="center" if c > 4 else None)
        # the CPRP of every channel, under the summary
        row += 3
        ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=7)
        _put(ws, row, 1, "CPRP BY CHANNEL (cost per rating point, LKR)", bold=True, white=True, fill=BLACK, size=11, box=False, h="left")
        row += 1
        ws.row_dimensions[row].height = 32
        for i, h in enumerate(["Channel", "Com Only CPRP", "Com Only NCPRP (30 sec)", "All Exposure CPRP", "All Exposure NCPRP (30 sec)", "Com Only GRPs", "All Exposure GRPs"]):
            _put(ws, row, 1 + i, h, bold=True, white=True, fill=GREY, h="center", wrap=True)
        row += 1
        for i, src in enumerate(list(range(first, last + 1)) + [tv]):
            band = LIGHT if i % 2 and src != tv else (LIGHT if src == tv else None)
            for c, v, fmt in ((1, f"=A{src}", None), (2, f"=I{src}", ACC2), (3, f"=J{src}", ACC2), (4, f"=M{src}", ACC2), (5, f"=N{src}", ACC2), (6, f"=G{src}", NUM2), (7, f"=K{src}", NUM2)):
                _put(ws, row, c, v, fmt=fmt, fill=band, bold=(c == 1 or src == tv), top="medium" if src == tv else None)
            row += 1
    _put(ws, row + 1, 1, "CPRP = cost / GRPs. NCPRP = cost / NGRPs (every spot turned into 30 second equivalents). Com Only = commercial spots; All Exposure adds the sponsorship items. ROI = rate card value / cost. Tax is not in the investment.",
         italic=True, box=False, size=9, color="595959")
    ws.freeze_panes = "B3"
    ws.print_area = f"A1:Q{row + 2}"
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr = PageSetupProperties(fitToPage=True)


def _formulas(wb: Workbook, S: dict) -> None:
    ws = wb.create_sheet("Formulas")
    ws.sheet_view.showGridLines = False
    for col, w in (("A", 36), ("B", 60), ("C", 100)):
        ws.column_dimensions[col].width = w
    ws.merge_cells("A1:C1")
    _put(ws, 1, 1, "Formulas and settings (change the yellow values in column B; every sheet reads them)", bold=True, white=True, fill=BLACK, size=12, box=False, h="left")
    for i, h in enumerate(("Setting", "Value", "Used for")):
        _put(ws, 2, 1 + i, h, bold=True, white=True, fill=GREY)
    settings = [("Base seconds", S["base"], "0", "A 30 second spot is the unit. Rates are per 30 seconds; a spot of another length is priced at rate / base seconds x DUR"),
                ("SSCL rate", S["sscl"], "0.0%", "Tax rows (the investment is 100% without taxes and is grossed up)"), ("VAT rate", S["vat"], "0.0%", "Tax rows")]
    for i, (a, b, fmt, c) in enumerate(settings):                  # the channel sheets read B3, B4 and B5
        _put(ws, 3 + i, 1, a, bold=True)
        _put(ws, 3 + i, 2, b, fmt=fmt, fill=INPUT, h="left", bold=True)
        _put(ws, 3 + i, 3, c)
    r = 7
    for i, h in enumerate(("Column", "Formula (row 12 as an example)", "In plain words")):
        _put(ws, r, 1 + i, h, bold=True, white=True, fill=GREY)
    items = [("GRP", "I12*H12", "TVR x number of spots"), ("NGRP", "(I12/Formulas!B3*G12)*H12", "GRP turned into 30 second equivalents: TVR / 30 x DUR x spots"), ("CPRP", "IFERROR(O12/I12,0)", "Negotiated rate of one spot / TVR = cost per rating point"),
             ("NCPRP", "IFERROR(O12/(I12/Formulas!B3*G12),0)", "Negotiated rate of one spot / (TVR / 30 x DUR): cost per rating point on a 30 second basis"), ("RATE CARD RATE", "(30 sec rate / Formulas!B3) * G12", "Rate card rate of one spot of this length"),
             ("NEGOTIATED RATE", "(30 sec rate / Formulas!B3) * G12", "Negotiated (or paid) rate of one spot of this length"), ("TOTAL VALUE", "N12*H12", "Rate card rate x spots"), ("TOTAL COST", "O12*H12", "Negotiated rate x spots"),
             ("COMMERCIAL VALUE / ALL EXPOSURE VALUE", "SUM of the rows", "Commercial rows only / commercial + sponsorship rows; CPRP = total cost / total GRP"),
             ("COMMERCIAL ROI %", "COMMERCIAL VALUE (col P) / COMMERCIAL VALUE (col Q)", "Rate card value of the commercial spots / what they cost"),
             ("ALL EXPOSURE ROI %", "ALL EXPOSURE VALUE (col P) / ALL EXPOSURE VALUE (col Q)", "Rate card value of commercial + sponsorship items / what they cost"),
             ("SSCL / VAT", "Investment / (1 - SSCL) x rate", "The investment is 100% without taxes, grossed up for SSCL; VAT is on the grossed-up amount"),
             ("DEAL / COMMERCIAL BUDGET (columns T to X)", "Investment x commercial share; prime share of that", "The contract: an investment, the share of it that buys commercial spots (100%, 90%, 80%), the rest for sponsorship / frequency items; each budget is compared with what the spots add up to"),
             ("Discount vs rate card (deal)", "1 - commercial budget / commercial rate card value", "What the contract really gave: the commercial part of the investment against the same spots at the rack rate"),
             ("Discount % (Summary)", "1 - commercial cost / commercial rate card value", "How far below the rate card the commercial spots were bought"),
             ("BONUS COMMERCIALS / BONUS VALUE", "rows at the rate card rate, negotiated rate 0", "Free extra programmes the channel gives. They count at rate card value in ALL EXPOSURE VALUE and ROI and cost nothing"), ("Bonus % (deal block)", "bonus % x commercial rate card value", "How much bonus value the channel gives; the planned bonus is compared with it"), ("Bonus % (Summary)", "(sponsorship + bonus rate card value) / commercial rate card value", "Extra exposure from sponsorship items and bonus programmes on top of the commercial spots"), ("TVR", "typed", "Average of the programme in the TVR sheet (all uploaded months)")]
    for i, (a, b, c) in enumerate(items):
        _put(ws, r + 1 + i, 1, a, bold=True, wrap=True)
        _put(ws, r + 1 + i, 2, b, wrap=True)
        _put(ws, r + 1 + i, 3, c, wrap=True)
    ws.freeze_panes = "A3"


def build_eval_xlsx(spec: dict, settings: dict | None = None) -> bytes:
    S = {"base": 30, "sscl": 0.025, "vat": 0.18, **(settings or {})}
    wb = Workbook()
    wb.remove(wb.active)
    summary = wb.create_sheet("Summary")
    used = {"summary", "formulas"}
    sheets = [_channel_sheet(wb, spec, ch, used) for ch in spec.get("channels") or []]
    _summary(summary, spec, sheets)
    _formulas(wb, S)
    wb.calculation.fullCalcOnLoad = True                  # Excel works every formula out when the file is opened
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
