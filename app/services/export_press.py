"""Press and contracts PDF: press spend plus the list of contracts (same paper, same size, same weekday, repeated)."""
from __future__ import annotations

import datetime as dt
import io
import logging
from typing import Any

from reportlab.lib import colors
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table as RlTable, TableStyle
from reportlab.lib.units import cm

from .export_negotiation import LINE, PAGE, WIDTH, _n, _Styles, _table
from .export_pdf import _logo, safe

log = logging.getLogger(__name__)


def _t(s: Any) -> str:
    return " ".join(w if (len(w) <= 3 and w.isupper()) else w.capitalize() for w in str(s or "").split())


def _d(iso: Any) -> str:
    try:
        return dt.date.fromisoformat(str(iso)[:10]).strftime("%d %b %Y")
    except ValueError:
        return "n/a"


def _size(c: dict) -> str:
    f = lambda v: f"{v:g}"  # noqa: E731
    return f"{f(c.get('cm') or 0)} cm x {f(c.get('col') or 0)} col"


def _list(label: str, names: list, limit: int = 6) -> str:
    names = [str(n) for n in names or []]
    if not names:
        return f"{label}: all"
    return f"{label}: " + ", ".join(names[:limit]) + (f" and {len(names) - limit} more" if len(names) > limit else "")


def build_press_pdf(summary: dict, contracts: dict, meta: dict, client: dict, branding: dict, logos: dict) -> bytes:
    brand = colors.HexColor(branding.get("primary_color") or "#4F46E5")
    accent = colors.HexColor(client.get("brand_color") or "#5B5CE6")
    agency = branding.get("agency_name") or "Media Radar"
    cname = client.get("name") or "Client"
    s = _Styles(brand)
    t, ct = summary.get("totals") or {}, contracts.get("totals") or {}
    rows = contracts.get("contracts") or []
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=PAGE, leftMargin=1.5 * cm, rightMargin=1.5 * cm, topMargin=1.4 * cm, bottomMargin=1.3 * cm, title="Press and contracts", author=safe(agency))
    log.info("[press pdf] %d contracts, %d publications", len(rows), len(summary.get("publications") or []))

    la, lc = _logo(logos.get("agency"), 1.4), _logo(logos.get("client"), 1.4)
    lt = RlTable([[la or Paragraph(f"<b>{safe(agency)}</b>", s.lead), lc or Paragraph(f"<b>{safe(cname)}</b>", s.lead)]], colWidths=[WIDTH / 2] * 2)
    lt.setStyle(TableStyle([("ALIGN", (1, 0), (1, 0), "RIGHT"), ("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
    band = RlTable([[""]], colWidths=[WIDTH], rowHeights=[0.2 * cm])
    band.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), accent)]))
    per = summary.get("period") or [None, None]
    info = [["Period", f"{_d(meta.get('date_from') or per[0])} to {_d(meta.get('date_to') or per[1])}"], ["Selection", "; ".join([_list("Advertisers", meta.get("advertisers")), _list("Publications", meta.get("publications"))])],
            ["Data", safe(meta.get("dataset") or "Press sheet")], ["Generated", dt.datetime.now().strftime("%d %b %Y %H:%M")]]
    it = RlTable([[Paragraph(f"<b>{a}</b>", s.body), Paragraph(safe(b), s.body)] for a, b in info], colWidths=[3.6 * cm, WIDTH - 3.6 * cm])
    it.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.25, LINE), ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]))
    tiles = [("Press spend", _n(t.get("spend"), "lkr")), ("Insertions", f"{_n(t.get('insertions'))} in {_n(t.get('publications'))} publications"), ("Space bought", f"{_n(t.get('area'))} col-cm"),
             ("Contracts", f"{_n(ct.get('contracts'))} ({_n(ct.get('active'))} active)"), ("Spend on contracts", f"{_n(ct.get('contract_spend'), 'lkr')} ({_n(ct.get('contract_share_pct'), 'pct')})"),
             ("Ad hoc ads", f"{_n(ct.get('adhoc_spend'), 'lkr')}, {_n(ct.get('adhoc_insertions'))} insertions")]
    kt = RlTable([[Paragraph(f"<font size=6.5 color='#646A8A'>{safe(a.upper())}</font><br/><font size=9.5><b>{safe(b)}</b></font>", s.body) for a, b in tiles]], colWidths=[WIDTH / len(tiles)] * len(tiles))
    kt.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.25, LINE), ("INNERGRID", (0, 0), (-1, -1), 0.25, LINE), ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8f9fe")),
                            ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    el: list = [lt, Spacer(1, 0.4 * cm), band, Spacer(1, 0.3 * cm), Paragraph("Press &amp; Contracts", s.h1), Paragraph(f"Prepared for <b>{safe(cname)}</b> by {safe(agency)}", s.lead),
                Spacer(1, 0.25 * cm), it, Spacer(1, 0.3 * cm), kt, Spacer(1, 0.2 * cm)]

    # 1. contracts
    el += [Paragraph("1. Contracts", s.h2), Paragraph(safe(contracts.get("rule") or "") + " A weekly contract may miss one week and still count. Status is Active when the last insertion is within three weeks of the end of the press data "
                                                         f"({_d(contracts.get('data_end'))}).", s.small), Spacer(1, 3)]
    if rows:
        head = ["Advertiser", "Product", "Publication", "Size", "Runs on", "Times", "First", "Last", "Missed", "Avg cost (LKR)", "Total cost (LKR)", "Status"]
        body = [head] + [[safe(c["advertiser"]), safe(c["product"]), _t(c["publication"]), _size(c), c["weekday"], _n(c["times"]), _d(c["first"]), _d(c["last"]), _n(c["missed"]), _n(c["avg_cost"]), _n(c["total_cost"]), c["status"]] for c in rows]
        n = len(body)
        body.append(["Total", "", "", "", "", _n(sum(c["times"] for c in rows)), "", "", "", "", _n(sum(c["total_cost"] for c in rows)), ""])
        body = [[Paragraph(f"<b>{safe(x)}</b>", s.cell) if (i == n and isinstance(x, str) and x) else x for x in r] for i, r in enumerate(body)]
        tot = [("FONTNAME", (0, n), (-1, n), "Helvetica-Bold"), ("LINEABOVE", (0, n), (-1, n), 1, colors.HexColor("#1b1d36")), ("BACKGROUND", (0, n), (-1, n), colors.HexColor("#e1e3fb"))]
        el.append(_table(body, [2.5, 2.1, 2.1, 1.7, 1.4, 1.0, 1.5, 1.5, 1.1, 1.6, 1.8, 1.0], s, brand, tot + [("ALIGN", (c, 1), (c, -1), "RIGHT") for c in (5, 8, 9, 10)]))
        if contracts.get("n_contracts", len(rows)) > len(rows):
            el.append(Paragraph(f"Showing the {len(rows)} biggest of {_n(contracts.get('n_contracts'))} contracts.", s.small))
    else:
        el.append(Paragraph(f"No advertiser repeats {contracts.get('min_times', 4)} or more times at the same size on the same weekday in this selection.", s.body))

    # 2. by advertiser
    by = contracts.get("by_advertiser") or []
    if by:
        el += [Paragraph("2. Contracts by advertiser", s.h2), Spacer(1, 2)]
        el.append(_table([["Advertiser", "Contracts", "Still active", "Contract spend (LKR)"]] + [[safe(a["advertiser"]), _n(a["contracts"]), _n(a["active"]), _n(a["spend"])] for a in by[:30]],
                         [5, 1.5, 1.5, 2.5], s, brand, [("ALIGN", (1, 1), (-1, -1), "RIGHT")]))

    # 3. publications and advertisers
    el += [PageBreak(), Paragraph("3. Press spend by publication", s.h2), Spacer(1, 2)]
    def rank(rs, label):
        tot_s = sum(r["spend"] for r in rs) or 1
        return _table([[label, "Insertions", "Col-cm", "Spend (LKR)", "Share", "LKR per col-cm"]] + [[_t(r["name"]) if label == "Publication" else safe(r["name"]), _n(r["insertions"]), _n(r["area"]), _n(r["spend"]), _n(r["spend"] / tot_s * 100, "pct"), _n(r.get("rate"))] for r in rs],
                      [5, 1.4, 1.5, 2.2, 1.2, 1.8], s, brand, [("ALIGN", (1, 1), (-1, -1), "RIGHT")])
    el.append(rank(summary.get("publications") or [], "Publication"))
    el += [Paragraph("4. Press spend by advertiser", s.h2), Spacer(1, 2), rank(summary.get("advertisers") or [], "Advertiser")]
    mo = summary.get("months") or []
    if mo:
        el += [Paragraph("5. Press spend by month", s.h2), Spacer(1, 2), _table([["Month", "Insertions", "Spend (LKR)"]] + [[m["month"], _n(m["insertions"]), _n(m["spend"])] for m in mo], [2, 1.5, 2.5], s, brand, [("ALIGN", (1, 1), (-1, -1), "RIGHT")])]

    # 6. dates of the biggest contracts
    if rows:
        el += [PageBreak(), Paragraph("6. Dates of the biggest contracts", s.h2), Paragraph("Every insertion date and its cost (LKR), for the 25 contracts with the highest spend.", s.small), Spacer(1, 3)]
        for c in rows[:25]:
            ds = ", ".join(f"{_d(x['date'])} ({x['cost']:,.0f})" for x in c.get("dates") or [])
            more = c["insertions"] - len(c.get("dates") or [])
            el.append(Paragraph(f"<b>{safe(c['advertiser'])}</b> · {safe(c['product'])} · {safe(_t(c['publication']))} · {_size(c)} · {c['weekday']}", s.cellb))
            el.append(Paragraph(safe(ds) + (f" and {more} more" if more > 0 else ""), s.small))
            el.append(Spacer(1, 4))

    def page(canvas, d_):
        canvas.saveState()
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(colors.HexColor("#646A8A"))
        canvas.drawString(1.5 * cm, 0.7 * cm, f"{safe(agency)} · Press & Contracts · {safe(cname)}")
        canvas.drawRightString(PAGE[0] - 1.5 * cm, 0.7 * cm, f"Page {d_.page}")
        canvas.restoreState()
    doc.build(el, onFirstPage=page, onLaterPages=page)
    return buf.getvalue()
