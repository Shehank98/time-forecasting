"""Client Pitch Evaluator report: the comparison of what the current agency bought against our plan, as PDF and Word."""
from __future__ import annotations

import datetime as dt
import io
import logging
from typing import Any

from reportlab.lib import colors
from reportlab.lib.units import cm
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table as RlTable, TableStyle

from .export_negotiation import LINE, PAGE, WIDTH, _n, _Styles, _table
from .export_pdf import _logo, safe

log = logging.getLogger(__name__)


def _t(s: Any) -> str:
    return " ".join(w if (len(w) <= 3 and w.isupper()) else w.capitalize() for w in str(s or "").split())


def _x(v: Any) -> str:
    return "n/a" if v is None else f"{float(v):.2f}x"


def _chg(a: Any, b: Any) -> str:
    try:
        return f"{(float(b) / float(a) - 1) * 100:+.1f}%" if a and b is not None else "n/a"
    except (TypeError, ValueError, ZeroDivisionError):
        return "n/a"


def comparison_rows(d: dict) -> list[list[str]]:
    cur, plan = (d.get("comparison") or {}).get("current") or {}, (d.get("comparison") or {}).get("plan") or {}
    spec = [("Total spend (LKR)", "spend", "spend", "int"), ("Total spots (30 sec equivalent)", "eq30", "eq30", "dec"), ("Total GRPs (30 sec)", "ngrp", "ngrp", "dec"), ("Average 30 sec rate (LKR)", "avg30", "avg30", "int"),
            ("Average CPRP (LKR)", "cprp", "cprp", "int"), ("Average prime time TVR", "pt_tvr", "pt_tvr", "2"), ("Average non prime TVR", "npt_tvr", "npt_tvr", "2"), ("Prime time share of spend", "pt_spend_share", "pt_spend_share", "pct"),
            ("Prime time share of spots", "pt_spot_share", "pt_spot_share", "pct"), ("ROI at rate card", "roi", "roi", "x")]

    def f(v: Any, k: str) -> str:
        if v is None:
            return "n/a"
        return {"int": _n(v), "dec": _n(v, "dec"), "pct": _n(v, "pct"), "x": _x(v), "2": f"{float(v):.2f}"}[k]
    return [[lab, f(cur.get(a), k), f(plan.get(b), k), _chg(cur.get(a), plan.get(b))] for lab, a, b, k in spec]


def build_pitch_pdf(d: dict, client: dict, branding: dict, logos: dict) -> bytes:
    brand = colors.HexColor(branding.get("primary_color") or "#4F46E5")
    accent = colors.HexColor(client.get("brand_color") or "#5B5CE6")
    agency = branding.get("agency_name") or "Media Radar"
    meta = d.get("meta") or {}
    cname = meta.get("client") or client.get("name") or "Client"
    s = _Styles(brand)
    cmp_, cur, plan = d.get("comparison") or {}, d.get("current") or {}, d.get("plan") or {}
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=PAGE, leftMargin=1.5 * cm, rightMargin=1.5 * cm, topMargin=1.4 * cm, bottomMargin=1.3 * cm, title="Client pitch evaluation", author=safe(agency))
    log.info("[pitch pdf] %d current rows, %d plan rows", len(cur.get("rows") or []), len(plan.get("rows") or []))
    la, lc = _logo(logos.get("agency"), 1.4), _logo(logos.get("client"), 1.4)
    lt = RlTable([[la or Paragraph(f"<b>{safe(agency)}</b>", s.lead), lc or Paragraph(f"<b>{safe(cname)}</b>", s.lead)]], colWidths=[WIDTH / 2] * 2)
    lt.setStyle(TableStyle([("ALIGN", (1, 0), (1, 0), "RIGHT"), ("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
    band = RlTable([[""]], colWidths=[WIDTH], rowHeights=[0.2 * cm])
    band.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), accent)]))
    ctot = cmp_.get("current") or {}
    info = [["Month", safe(d.get("month") or "all months")], ["Channels compared", safe(", ".join(_t(c) for c in ctot.get("channels") or []) or "none")], ["Compared with", "Programme basket (commercial spots)" if cmp_.get("basis") != "all" else "All exposure (commercial + sponsorship items)"],
            ["Generated", dt.datetime.now().strftime("%d %b %Y %H:%M")]]
    it = RlTable([[Paragraph(f"<b>{a}</b>", s.body), Paragraph(safe(b), s.body)] for a, b in info], colWidths=[3.8 * cm, WIDTH - 3.8 * cm])
    it.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.25, LINE), ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]))
    big = ParagraphStyle_big(s)
    el: list = [lt, Spacer(1, 0.4 * cm), band, Spacer(1, 0.3 * cm), Paragraph("Client Pitch Evaluation", s.h1), Paragraph(f"Prepared for <b>{safe(cname)}</b> by {safe(agency)}", s.lead), Spacer(1, 0.25 * cm), it, Spacer(1, 0.4 * cm),
                Paragraph(safe(cmp_.get("sentence") or ""), big), Spacer(1, 0.3 * cm)]
    ptot = cmp_.get("plan") or {}
    tiles = [("Spend", f"{_n(ctot.get('spend'), 'lkr')}"), ("GRPs now", _n(ctot.get("ngrp"), "dec")), ("GRPs, our plan", _n(ptot.get("ngrp"), "dec")), ("CPRP now", _n(ctot.get("cprp"), "lkr")), ("CPRP, our plan", _n(ptot.get("cprp"), "lkr")),
             ("ROI now", _x(ctot.get("roi"))), ("ROI, our plan", _x(ptot.get("roi")))]
    kt = RlTable([[Paragraph(f"<font size=6.5 color='#646A8A'>{safe(a.upper())}</font><br/><font size=9.5><b>{safe(b)}</b></font>", s.body) for a, b in tiles]], colWidths=[WIDTH / len(tiles)] * len(tiles))
    kt.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.25, LINE), ("INNERGRID", (0, 0), (-1, -1), 0.25, LINE), ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8f9fe")), ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
    el += [kt, Paragraph("1. Current agency vs our plan", s.h2), _table([["Measure", "Current agency", "Our plan", "Change"]] + comparison_rows(d), [4, 2, 2, 1.4], s, brand, [("ALIGN", (1, 1), (-1, -1), "RIGHT")]),
           Paragraph("GRPs and rates are on a 30 second basis (a 15 sec spot counts as half). CPRP = cost of a 30 sec spot / programme TVR. ROI = value at rate card / spend. Tax is not included. Our plan buys the same budget per channel at our negotiated rates, cheapest rating points first.", s.small)]

    ch = cur.get("channels") or []
    if ch:
        el += [Paragraph("2. Current evaluation by channel", s.h2), Spacer(1, 2)]
        rows = [["Channel", "Commercial only spend", "All exposure spend", "Rate card value (com)", "Rate card value (all)", "ROI com only", "ROI all exposure", "Spend with a rate"]] + \
               [[_t(c["channel"]), _n(c["com_spend"]), _n(c["spend"]), _n(c["com_value"]), _n(c["all_value"]), _x(c.get("com_roi")), _x(c.get("all_roi")), _n(c.get("rated_pct"), "pct")] for c in ch]
        el.append(_table(rows, [2.4, 2, 2, 2, 2, 1.2, 1.4, 1.4], s, brand, [("ALIGN", (1, 1), (-1, -1), "RIGHT")]))
    if plan.get("rows"):
        el += [PageBreak(), Paragraph("3. Our recommended basket", s.h2), Paragraph("Same budget per channel as the current agency. Programmes are bought lowest CPRP first, at our negotiated 30 sec rates.", s.small), Spacer(1, 3)]
        rows = [["Programme (TVR name)", "Channel", "Starts", "Daypart", "TVR", "Our 30 sec rate", "CPRP", "Spots", "Spend (LKR)", "GRPs"]] + \
               [[_t(r["program"]), _t(r["channel"]), r.get("start") or "", r.get("daypart") or "", f"{r['tvr']:.2f}", _n(r["neg30"]), _n(r["cprp"]), _n(r["spots"]), _n(r["spend"]), _n(r["grp"], "dec")] for r in plan["rows"][:45]]
        el.append(_table(rows, [3.4, 1.6, 1, 1.4, 0.9, 1.6, 1.3, 0.9, 1.7, 1.1], s, brand, [("ALIGN", (4, 1), (-1, -1), "RIGHT")]))
        if len(plan["rows"]) > 45:
            el.append(Paragraph(f"Showing 45 of {len(plan['rows'])} programmes. The Excel file has them all.", s.small))
    if cur.get("rows"):
        el += [PageBreak(), Paragraph("4. What the current agency bought (programme basket)", s.h2), Spacer(1, 3)]
        rows = [["Programme (TVR name)", "Channel", "Starts", "Daypart", "Spots", "Cost (LKR)", "Avg 30 sec rate", "TVR", "GRPs (30 sec)", "CPRP"]] + \
               [[_t(r["program"]), _t(r["channel"]), r.get("start") or "", r.get("daypart") or "", _n(r["spots"]), _n(r["cost"]), _n(r["avg30"]), f"{r['tvr']:.2f}", _n(r["ngrp"], "dec"), _n(r["cprp"])] for r in cur["rows"][:35]]
        el.append(_table(rows, [3.4, 1.6, 1, 1.4, 0.9, 1.6, 1.5, 0.9, 1.3, 1.2], s, brand, [("ALIGN", (4, 1), (-1, -1), "RIGHT")]))
    if cur.get("sponsorship"):
        el += [Paragraph("Sponsorship items (shown apart from the basket)", s.h2), Spacer(1, 2)]
        rows = [["Channel", "Programme (TVR name)", "Item", "Spots", "Spend (LKR)", "TVR delivered", "GRPs"]] + [[_t(r["channel"]), _t(r["program"]), safe(r["theme"]), _n(r["spots"]), _n(r["spend"]), f"{r['tvr']:.2f}", _n(r["grp"], "dec")] for r in cur["sponsorship"][:15]]
        el.append(_table(rows, [1.6, 3.2, 2.6, 0.9, 1.6, 1.2, 1.1], s, brand, [("ALIGN", (3, 1), (-1, -1), "RIGHT")]))
    w = d.get("warnings") or {}
    notes = []
    if w.get("unmatched_programmes"):
        notes.append(f"{w['unmatched_programmes']} LMRB programmes (LKR {_n(w.get('unmatched_spend'))}) could not be matched to a TVR programme and are left out of the TVR numbers.")
    if w.get("missing_rate_programmes"):
        notes.append(f"{w['missing_rate_programmes']} programmes bought (LKR {_n(w.get('missing_rate_spend'))}) have no rate card rate, so ROI leaves them out.")
    if w.get("zero_tvr_rows"):
        notes.append(f"{w['zero_tvr_rows']} TVR rows have a TVR of zero and count as zero.")
    if w.get("skipped_channels"):
        notes.append("Channels not in the TVR sheet were skipped: " + ", ".join(_t(c["channel"]) for c in w["skipped_channels"][:8]) + ".")
    if notes:
        el += [Paragraph("Notes on the data", s.h2)] + [Paragraph("- " + safe(n), s.body) for n in notes]

    def page(canvas, d_):
        canvas.saveState()
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(colors.HexColor("#646A8A"))
        canvas.drawString(1.5 * cm, 0.7 * cm, f"{safe(agency)} - Client pitch evaluation - {safe(cname)}")
        canvas.drawRightString(PAGE[0] - 1.5 * cm, 0.7 * cm, f"Page {d_.page}")
        canvas.restoreState()
    doc.build(el, onFirstPage=page, onLaterPages=page)
    return buf.getvalue()


def ParagraphStyle_big(s: _Styles):  # noqa: N802
    from reportlab.lib.styles import ParagraphStyle
    return ParagraphStyle("pitchbig", parent=s.lead, fontSize=17, leading=22, textColor=s.h1.textColor)


def build_pitch_docx(d: dict, client: dict, branding: dict) -> bytes:
    from docx import Document
    from docx.shared import Pt
    meta = d.get("meta") or {}
    cname = meta.get("client") or client.get("name") or "Client"
    agency = branding.get("agency_name") or "Media Radar"
    doc = Document()
    doc.styles["Normal"].font.name = "Calibri"
    doc.styles["Normal"].font.size = Pt(10)
    doc.add_heading("Client Pitch Evaluation", 0)
    doc.add_paragraph(f"Prepared for {cname} by {agency}. Month: {d.get('month') or 'all months'}. Generated {dt.datetime.now().strftime('%d %b %Y %H:%M')}.")
    p = doc.add_paragraph()
    r = p.add_run((d.get("comparison") or {}).get("sentence") or "")
    r.bold = True
    r.font.size = Pt(14)

    def table(head: list[str], rows: list[list[str]]):
        t = doc.add_table(rows=1, cols=len(head))
        t.style = "Light Grid Accent 1"
        for i, h in enumerate(head):
            t.rows[0].cells[i].text = h
        for row in rows:
            cells = t.add_row().cells
            for i, v in enumerate(row):
                cells[i].text = str(v)
    doc.add_heading("Current agency vs our plan", 1)
    table(["Measure", "Current agency", "Our plan", "Change"], comparison_rows(d))
    doc.add_paragraph("GRPs and rates are on a 30 second basis. CPRP = cost of a 30 sec spot / programme TVR. ROI = value at rate card / spend. Tax is not included.")
    ch = (d.get("current") or {}).get("channels") or []
    if ch:
        doc.add_heading("Current evaluation by channel", 1)
        table(["Channel", "Commercial only spend", "All exposure spend", "ROI com only", "ROI all exposure"], [[_t(c["channel"]), _n(c["com_spend"]), _n(c["spend"]), _x(c.get("com_roi")), _x(c.get("all_roi"))] for c in ch])
    rows = (d.get("plan") or {}).get("rows") or []
    if rows:
        doc.add_heading("Our recommended basket", 1)
        table(["Programme", "Channel", "TVR", "Our 30 sec rate", "CPRP", "Spots", "Spend", "GRPs"], [[_t(r["program"]), _t(r["channel"]), f"{r['tvr']:.2f}", _n(r["neg30"]), _n(r["cprp"]), _n(r["spots"]), _n(r["spend"]), _n(r["grp"], "dec")] for r in rows[:40]])
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()
