"""Negotiation PDF: the Channel -> Brand -> Theme summary from the browser hub, laid out with ReportLab (A4 landscape)."""
from __future__ import annotations

import datetime as dt
import io
import logging
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table as RlTable, TableStyle

from .export_pdf import MUTED, _logo, safe

log = logging.getLogger(__name__)
PAGE = landscape(A4)
WIDTH = PAGE[0] - 3 * cm
LINE = colors.HexColor("#e5e7f2")
ZEBRA = colors.HexColor("#f4f5fb")
GOOD, WARN = colors.HexColor("#12a06a"), colors.HexColor("#d6364f")


def _n(v: Any, kind: str = "int") -> str:
    if v is None or v == "":
        return "n/a"
    try:
        x = float(v)
    except (TypeError, ValueError):
        return safe(v)
    if kind == "lkr":
        return f"LKR {x:,.0f}"
    if kind == "pct":
        return f"{x:.1f}%"
    if kind == "dec":
        return f"{x:.1f}"
    return f"{x:,.0f}"


def _dur(mix: list[dict] | None) -> str:
    mix = mix or []
    tot = sum(m.get("spots", 0) for m in mix) or 1
    return ", ".join(f"{m['band']} {m['spots'] / tot * 100:.0f}%" for m in sorted(mix, key=lambda m: -m.get("spots", 0))[:3])


class _Styles:
    def __init__(self, brand):
        ss = getSampleStyleSheet()
        self.h1 = ParagraphStyle("nh1", parent=ss["Title"], textColor=brand, fontSize=24, leading=28, alignment=0, spaceAfter=4)
        self.h2 = ParagraphStyle("nh2", parent=ss["Heading2"], keepWithNext=1, textColor=brand, fontSize=14, spaceBefore=10, spaceAfter=5)
        self.body = ParagraphStyle("nb", parent=ss["BodyText"], fontSize=8.5, leading=11.5)
        self.lead = ParagraphStyle("nl", parent=self.body, fontSize=11.5, leading=15, textColor=colors.HexColor("#1b1d36"))
        self.small = ParagraphStyle("ns", parent=self.body, fontSize=7, leading=9, textColor=MUTED)
        self.cell = ParagraphStyle("nc", fontSize=7.2, leading=9)
        self.cellb = ParagraphStyle("ncb", parent=self.cell, fontName="Helvetica-Bold")
        self.hdr = ParagraphStyle("nhd", parent=self.cell, textColor=colors.white, fontName="Helvetica-Bold")


def _table(rows: list[list[Any]], widths: list[float], s: _Styles, head, extra: list | None = None) -> RlTable:
    data = [[c if not isinstance(c, str) else Paragraph(safe(c), s.hdr if i == 0 else s.cell) for c in r] for i, r in enumerate(rows)]
    tot = sum(widths)
    t = RlTable(data, colWidths=[w / tot * WIDTH for w in widths], repeatRows=1)
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), head), ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, ZEBRA]),
                           ("LINEBELOW", (0, 0), (-1, -1), 0.25, LINE), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                           ("TOPPADDING", (0, 0), (-1, -1), 2.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5)] + (extra or [])))
    return t


def _heat(v: float | None, hi: float, base: colors.Color) -> colors.Color:
    if v is None or hi <= 0:
        return colors.white
    a = max(0.0, min(1.0, v / hi)) * 0.75
    return colors.Color(1 - (1 - base.red) * a, 1 - (1 - base.green) * a, 1 - (1 - base.blue) * a)


def build_negotiation_pdf(hub: dict, meta: dict, client: dict, branding: dict, logos: dict) -> bytes:
    brand = colors.HexColor(branding.get("primary_color") or "#4F46E5")
    accent = colors.HexColor(client.get("brand_color") or "#5B5CE6")
    agency = branding.get("agency_name") or "Media Radar"
    cname = client.get("name") or "Client"
    s = _Styles(brand)
    tot = hub.get("totals") or {}
    thr = hub.get("thresholds") or {}
    sel = hub.get("selection") or {}
    period = hub.get("period") or [None, None]
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=PAGE, leftMargin=1.5 * cm, rightMargin=1.5 * cm, topMargin=1.4 * cm, bottomMargin=1.3 * cm,
                            title="Negotiation report", author=safe(agency))
    el: list = []
    log.info("[negotiation pdf] %s channels, %s leverage points", len(hub.get("channels") or []), len(hub.get("leverage") or []))

    # ---------------- cover and headline numbers
    la, lc = _logo(logos.get("agency"), 1.4), _logo(logos.get("client"), 1.4)
    lt = RlTable([[la or Paragraph(f"<b>{safe(agency)}</b>", s.lead), lc or Paragraph(f"<b>{safe(cname)}</b>", s.lead)]], colWidths=[WIDTH / 2] * 2)
    lt.setStyle(TableStyle([("ALIGN", (1, 0), (1, 0), "RIGHT"), ("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
    band = RlTable([[""]], colWidths=[WIDTH], rowHeights=[0.2 * cm]); band.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), accent)]))
    pick = lambda xs: ", ".join(map(str, xs[:8])) + (f" and {len(xs) - 8} more" if len(xs) > 8 else "") if xs else "All"
    info = [["Period", f"{period[0] or 'n/a'} to {period[1] or 'n/a'}"], ["Channels", pick(sel.get("channels") or [])],
            ["Product group", sel.get("product_group") or "All"], ["Advertisers", pick(sel.get("advertisers") or [])], ["Themes", pick(sel.get("themes") or [])],
            ["Other filters", "; ".join(map(str, meta.get("filters") or [])) or "None"],
            ["Thresholds", f"Volume rebate at {_n(thr.get('rebate'), 'lkr')} per advertiser per channel; clutter penalty above {_n(thr.get('clutter'), 'dec')} ads per break"],
            ["Data", safe(meta.get("dataset") or "LMRB ad monitoring file")], ["Generated", dt.datetime.now().strftime("%d %b %Y %H:%M")]]
    it = RlTable([[Paragraph(f"<b>{a}</b>", s.body), Paragraph(safe(b), s.body)] for a, b in info], colWidths=[3.6 * cm, WIDTH - 3.6 * cm])
    it.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.25, LINE), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]))
    el += [lt, Spacer(1, 0.5 * cm), band, Spacer(1, 0.35 * cm), Paragraph("Deep Negotiation &amp; Brand Intelligence", s.h1),
           Paragraph(f"Channel, brand and theme summary prepared for <b>{safe(cname)}</b> by {safe(agency)}", s.lead), Spacer(1, 0.3 * cm), it, Spacer(1, 0.4 * cm)]
    tiles = [("Total spend", _n(tot.get("spend"), "lkr")), ("Spots", _n(tot.get("spots"))), ("Channels / brands / themes", f"{_n(tot.get('channels'))} / {_n(tot.get('advertisers'))} / {_n(tot.get('themes'))}"),
             ("Avg ads in break", _n(tot.get("avg_clutter"), "dec")), ("First in break", _n(tot.get("first_pct"), "pct")), ("Vulnerability index", _n(tot.get("vulnerability"), "dec") + " / 100"),
             ("Rebate value to ask", f"{_n(tot.get('rebate_low'), 'lkr')} to {_n(tot.get('rebate_high'), 'lkr')}" if tot.get("rebate_high") else "None at this threshold")]
    kt = RlTable([[Paragraph(f"<font size=6.5 color='#646A8A'>{safe(a.upper())}</font><br/><font size=11><b>{safe(b)}</b></font>", s.body) for a, b in tiles]], colWidths=[WIDTH / len(tiles)] * len(tiles))
    kt.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.25, LINE), ("INNERGRID", (0, 0), (-1, -1), 0.25, LINE), ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8f9fe")),
                            ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    el.append(kt)

    # ---------------- negotiation highlights
    lev = hub.get("leverage") or []
    el += [PageBreak(), Paragraph("Negotiation highlights", s.h2)]
    if not lev:
        el.append(Paragraph("No advertiser crosses the rebate threshold and no channel is above the clutter threshold for this selection.", s.body))
    reb = [x for x in lev if x.get("type") == "rebate"][:20]
    clu = [x for x in lev if x.get("type") == "clutter"][:20]
    for title, items, col in (("Volume rebate eligibility", reb, GOOD), ("Clutter penalty", clu, WARN)):
        if not items:
            continue
        rows = [[Paragraph(f"<font color='#{col.hexval()[2:]}'><b>{'REBATE' if col is GOOD else 'CLUTTER'}</b></font>", s.cell), Paragraph(safe(x.get("text", "")), s.cell)] for x in items]
        t = RlTable(rows, colWidths=[2.2 * cm, WIDTH - 2.2 * cm])
        t.setStyle(TableStyle([("LINEBEFORE", (0, 0), (0, -1), 2.5, col), ("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.white, ZEBRA]), ("LINEBELOW", (0, 0), (-1, -1), 0.25, LINE),
                               ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]))
        t.repeatRows = 0
        el += [Paragraph(f"<b>{title}</b>", ParagraphStyle('nk', parent=s.body, keepWithNext=1)), Spacer(1, 2), t, Spacer(1, 6)]

    # ---------------- channel summary
    chans = (hub.get("channels") or [])[:30]
    el += [PageBreak(), Paragraph("Level 1: channels", s.h2)]
    rows = [["Channel", "Spend", "Share", "Spots", "Avg dur", "Avg ads in break", "First in break", "Premium (first or last)", "Buried", "Vulnerability", "Spot lengths"]]
    for c in chans:
        rows.append([c.get("name", ""), _n(c.get("spend"), "lkr"), _n(c.get("share_pct"), "pct"), _n(c.get("spots")), _n(c.get("avg_dur"), "dec") + "s" if c.get("avg_dur") else "n/a",
                     _n(c.get("avg_clutter"), "dec"), _n(c.get("first_pct"), "pct"), _n(c.get("premium_pct"), "pct"), _n(c.get("buried_pct"), "pct"), _n(c.get("vulnerability"), "dec"), _dur(c.get("dur_mix"))])
    hot = [("TEXTCOLOR", (5, i), (5, i), WARN) for i, c in enumerate(chans, 1) if (c.get("avg_clutter") or 0) > (thr.get("clutter") or 35)]
    el.append(_table(rows, [3.2, 2.6, 1.4, 1.3, 1.3, 1.6, 1.5, 1.8, 1.3, 1.5, 3.6], s, brand, hot))

    # ---------------- Channel -> Brand -> Theme
    el += [Paragraph("Levels 2 and 3: brands and themes by channel", s.h2),
           Paragraph("Share of wallet = this brand's spend on the channel as a share of its total spend in the selection. Share of channel = its share of everyone's spend on the channel.", s.small), Spacer(1, 3)]
    rows = [["Channel / brand / theme", "Spend", "Share of wallet", "Share of channel", "Spots", "Avg ads in break", "First in break", "Vulnerability", "Running", "Spot lengths", "Flag"]]
    style: list = []
    for c in chans[:12]:
        rows.append([Paragraph(f"<b>{safe(c.get('name', ''))}</b>", s.cellb), _n(c.get("spend"), "lkr"), "", _n(c.get("share_pct"), "pct"), _n(c.get("spots")), _n(c.get("avg_clutter"), "dec"),
                     _n(c.get("first_pct"), "pct"), _n(c.get("vulnerability"), "dec"), f"{c.get('first_seen') or ''} to {c.get('last_seen') or ''}", _dur(c.get("dur_mix")),
                     "Clutter" if (c.get("avg_clutter") or 0) > (thr.get("clutter") or 35) else ""])
        style.append(("BACKGROUND", (0, len(rows) - 1), (-1, len(rows) - 1), colors.HexColor("#e9eafc")))
        for b in (c.get("brands") or [])[:8]:
            rows.append([Paragraph(f"&nbsp;&nbsp;&nbsp;{safe(b.get('name', ''))}", s.cellb), _n(b.get("spend"), "lkr"), _n(b.get("sow"), "pct"), _n(b.get("share_of_channel"), "pct"), _n(b.get("spots")),
                         _n(b.get("avg_clutter"), "dec"), _n(b.get("first_pct"), "pct"), _n(b.get("vulnerability"), "dec"), f"{b.get('days_run', 0)} days", _dur(b.get("dur_mix")), "Rebate" if b.get("rebate_eligible") else ""])
            if b.get("rebate_eligible"):
                style.append(("TEXTCOLOR", (10, len(rows) - 1), (10, len(rows) - 1), GOOD))
            for t in (b.get("themes") or [])[:4]:
                rows.append([Paragraph(f"&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<font color='#646A8A'>{safe(t.get('name', ''))}</font>", s.cell), _n(t.get("spend"), "lkr"), "", "", _n(t.get("spots")),
                             _n(t.get("avg_clutter"), "dec"), _n(t.get("first_pct"), "pct"), _n(t.get("vulnerability"), "dec"), f"{t.get('first_seen') or ''} to {t.get('last_seen') or ''}", _dur(t.get("dur_mix")), ""])
    el.append(_table(rows, [5.4, 2.4, 1.5, 1.5, 1.1, 1.4, 1.3, 1.3, 2.9, 3.0, 1.1], s, brand, style))
    if len(chans) > 12:
        el.append(Paragraph(f"Showing the top 12 of {len(chans)} channels, 8 brands per channel and 4 themes per brand. Narrow the filters for more detail.", s.small))

    # ---------------- Share of wallet matrix
    m = hub.get("matrix") or {}
    mr, mc = (m.get("rows") or [])[:15], (m.get("cols") or [])[:10]
    if mr and mc:
        el += [PageBreak(), Paragraph("Share of wallet matrix: channel x brand", s.h2), Paragraph("Each cell: spend, and in brackets the brand's share of wallet on that channel. Darker = bigger share.", s.small), Spacer(1, 3)]
        rows = [["Brand"] + list(mc) + ["Total in matrix"]]
        style = []
        for i, a in enumerate(mr):
            sp, sw = (m.get("spend") or [[]])[i][:len(mc)], (m.get("sow") or [[]])[i][:len(mc)]
            rows.append([a] + [f"{_n(v)}\n({_n(w, 'pct')})" if v else "-" for v, w in zip(sp, sw)] + [_n(sum(sp))])
            for j, w in enumerate(sw):
                style.append(("BACKGROUND", (j + 1, i + 1), (j + 1, i + 1), _heat(w, 100, brand)))
        el.append(_table(rows, [4] + [2] * len(mc) + [2.2], s, brand, style))

    # ---------------- Theme rotation and tactic shifts
    th = (hub.get("themes") or [])[:30]
    if th:
        el += [Paragraph("Theme performance and creative rotation", s.h2)]
        rows = [["Brand", "Theme", "Investment", "Spots", "First seen", "Last seen", "Days run", "Spot lengths", "First in break", "Status"]]
        for t in th:
            rows.append([t.get("advertiser", ""), t.get("name", ""), _n(t.get("spend"), "lkr"), _n(t.get("spots")), t.get("first_seen") or "", t.get("last_seen") or "", _n(t.get("days_run")),
                         _dur(t.get("dur_mix")), _n(t.get("first_pct"), "pct"), "On air" if t.get("active") else "Rested"])
        el.append(_table(rows, [3.4, 5.2, 2.4, 1.1, 1.8, 1.8, 1.2, 3.2, 1.4, 1.3], s, brand))
    sh = (hub.get("shifts") or [])[:20]
    if sh:
        rows = [["Brand", "Short spots (10s and below) first half", "Short spots second half", "Change", "Themes used", "Themes in last 30 days", "Creative tactic"]]
        for x in sh:
            rows.append([x.get("advertiser", ""), _n(x.get("short_early_pct"), "pct"), _n(x.get("short_late_pct"), "pct"),
                         "n/a" if x.get("change_pts") is None else f"{x['change_pts']:+.0f} pts", _n(x.get("themes")), _n(x.get("themes_last_30d")), x.get("tactic", "")])
        el += [Spacer(1, 6), Paragraph("<b>Are brands changing creative tactics?</b>", s.body), Spacer(1, 2), _table(rows, [3.6, 2.6, 2.2, 1.5, 1.4, 1.8, 5], s, brand)]

    # ---------------- Clutter by timeband
    cl = (hub.get("clutter") or [])[:30]
    if cl:
        el += [Paragraph("Clutter and position vulnerability by channel and timeband", s.h2)]
        rows = [["Channel", "Timeband", "Spots", "Spend", "Avg ads in break", "First in break", "Advisory"]]
        style = []
        for i, x in enumerate(cl, 1):
            rows.append([x.get("channel", ""), x.get("daypart", ""), _n(x.get("spots")), _n(x.get("spend"), "lkr"), _n(x.get("avg_clutter"), "dec"), _n(x.get("first_pct"), "pct"),
                         "Demand 3 free bonus spots or priority First-in-Break placement" if x.get("flag") else "Within normal clutter"])
            if x.get("flag"):
                style.append(("TEXTCOLOR", (4, i), (4, i), WARN))
        el.append(_table(rows, [3, 2.4, 1.2, 2.6, 1.6, 1.6, 6], s, brand, style))

    # ---------------- definitions
    d = hub.get("definitions") or {}
    if d:
        el += [Spacer(1, 8), Paragraph("How these numbers are worked out", s.h2)]
        el += [Paragraph(f"&bull;&nbsp; <b>{safe(k.replace('_', ' ').capitalize())}:</b> {safe(v)}", s.body) for k, v in d.items()]
        el.append(Paragraph("Rebate and bonus figures are negotiation starting points worked out from monitored rate-card spend, not confirmed station terms.", s.small))

    footer_txt = safe(f"{agency} | {cname} | Negotiation report | {branding.get('report_footer', '')}")

    def footer(canvas, doc_):
        canvas.saveState(); canvas.setFont("Helvetica", 7); canvas.setFillColor(MUTED)
        canvas.drawString(1.5 * cm, 0.7 * cm, footer_txt[:170]); canvas.drawRightString(PAGE[0] - 1.5 * cm, 0.7 * cm, f"Page {doc_.page}")
        canvas.setFillColor(accent); canvas.rect(0, PAGE[1] - 0.22 * cm, PAGE[0], 0.22 * cm, stroke=0, fill=1); canvas.restoreState()
    doc.build(el, onFirstPage=footer, onLaterPages=footer)
    return buf.getvalue()
