"""Programme & Sponsorship PDF: Channel -> Programme -> Advertiser, built from the browser summary (A4 landscape, ReportLab)."""
from __future__ import annotations

import datetime as dt
import io
import logging
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from reportlab.lib import colors  # noqa: E402
from reportlab.lib.styles import ParagraphStyle  # noqa: E402
from reportlab.lib.units import cm  # noqa: E402
from reportlab.platypus import Image, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table as RlTable, TableStyle  # noqa: E402

from .export_negotiation import GOOD, LINE, PAGE, WARN, WIDTH, ZEBRA, _n, _Styles, _table
from .export_pdf import MUTED, _logo, safe

log = logging.getLogger(__name__)
DURS = ["5s", "10s", "15s", "20s", "30s", "30s+"]
ROLE_COLOR = {"Sponsorship": "#4F46E5", "Frequency": "#c27a06", "Regular Spot": "#646A8A"}
BAND_WORD = {"good": "Good", "fair": "Fair", "poor": "Poor"}
HEALTH_COLOR = {"good": GOOD, "fair": colors.HexColor("#c27a06"), "poor": WARN}


def _title(s: Any) -> str:
    return str(s or "").title()


def _durs(split: dict | None) -> str:
    split = split or {}
    return ", ".join(f"{k} {split[k]:,}" for k in DURS if split.get(k)) or "n/a"


def _pick(xs: list, n: int = 10) -> str:
    if not xs:
        return "All"
    return ", ".join(map(_title, xs[:n])) + (f" and {len(xs) - n} more" if len(xs) > n else "")


def _chart(advs: list[dict]) -> Image | None:
    top = [a for a in advs[:12] if a.get("spend")]
    if not top:
        return None
    names = [a["advertiser"][:28] for a in top][::-1]
    sp = [a.get("sponsor_spend", 0) / 1e6 for a in top][::-1]
    spec = [a.get("special_spend", 0) / 1e6 for a in top][::-1]
    reg = [a.get("regular_spend", 0) / 1e6 for a in top][::-1]
    fig, ax = plt.subplots(figsize=(11, 0.42 * len(top) + 1.2))
    ax.barh(names, sp, color="#f08a24", label="Sponsorship items")
    ax.barh(names, spec, left=sp, color="#d6457f", label="Special placements")
    ax.barh(names, reg, left=[a + b for a, b in zip(sp, spec)], color="#5b5ce6", label="Regular spots")
    ax.set_xlabel("LKR millions"); ax.legend(loc="lower right", frameon=False, fontsize=8)
    for s_ in ("top", "right"):
        ax.spines[s_].set_visible(False)
    ax.grid(axis="x", alpha=0.25); ax.tick_params(labelsize=8)
    buf = io.BytesIO(); fig.savefig(buf, format="png", dpi=150, bbox_inches="tight", facecolor="white"); plt.close(fig); buf.seek(0)
    img = Image(buf); r = img.imageHeight / img.imageWidth
    img.drawWidth, img.drawHeight = WIDTH, WIDTH * r
    return img


def build_spotlight_pdf(rep: dict, meta: dict, client: dict, branding: dict, logos: dict) -> bytes:
    brand = colors.HexColor(branding.get("primary_color") or "#4F46E5")
    accent = colors.HexColor(client.get("brand_color") or "#5B5CE6")
    agency = branding.get("agency_name") or "Media Radar"
    cname = client.get("name") or "Client"
    s = _Styles(brand)
    t = rep.get("totals") or {}
    sel = rep.get("selection") or {}
    rng = rep.get("range") or rep.get("period") or [None, None]
    per = rep.get("period") or [None, None]
    thr = rep.get("clutter_threshold") or 35
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=PAGE, leftMargin=1.5 * cm, rightMargin=1.5 * cm, topMargin=1.4 * cm, bottomMargin=1.3 * cm,
                            title="Programme and sponsorship report", author=safe(agency))
    el: list = []
    log.info("[spotlight pdf] %s channels, %s programmes, %s advertisers", t.get("channels"), t.get("programmes_shown"), t.get("advertisers"))

    # ---------------- cover
    la, lc = _logo(logos.get("agency"), 1.4), _logo(logos.get("client"), 1.4)
    lt = RlTable([[la or Paragraph(f"<b>{safe(agency)}</b>", s.lead), lc or Paragraph(f"<b>{safe(cname)}</b>", s.lead)]], colWidths=[WIDTH / 2] * 2)
    lt.setStyle(TableStyle([("ALIGN", (1, 0), (1, 0), "RIGHT"), ("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
    band = RlTable([[""]], colWidths=[WIDTH], rowHeights=[0.2 * cm]); band.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), accent)]))
    info = [["Date range", f"{rng[0] or 'n/a'} to {rng[1] or 'n/a'}" + (f" (spots found {per[0]} to {per[1]})" if per[0] and (per[0], per[1]) != (rng[0], rng[1]) else "")],
            ["Channels", _pick(sel.get("channels") or [])], ["Programmes", _pick(sel.get("programs") or [])], ["Advertisers", _pick(sel.get("advertisers") or [])],
            ["Other filters", "; ".join(map(str, meta.get("filters") or [])) or "None"], ["Data", safe(meta.get("dataset") or "LMRB ad monitoring file")],
            ["Generated", dt.datetime.now().strftime("%d %b %Y %H:%M")]]
    it = RlTable([[Paragraph(f"<b>{a}</b>", s.body), Paragraph(safe(b), s.body)] for a, b in info], colWidths=[3.6 * cm, WIDTH - 3.6 * cm])
    it.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.25, LINE), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]))
    el += [lt, Spacer(1, 0.5 * cm), band, Spacer(1, 0.35 * cm), Paragraph("Programme &amp; Sponsorship Report", s.h1),
           Paragraph(f"Channel, programme and advertiser summary prepared for <b>{safe(cname)}</b> by {safe(agency)}", s.lead), Spacer(1, 0.3 * cm), it, Spacer(1, 0.4 * cm)]
    tiles = [("Total spend", _n(t.get("spend"), "lkr")), ("Spots", _n(t.get("spots"))), ("Sponsorship investment", _n(t.get("sponsor_spend"), "lkr")),
             ("Sponsorship items", f"{_n(t.get('sponsor_items'))} ({_n(t.get('billboard_items'))} billboards)"), ("Channels / programmes / advertisers", f"{_n(t.get('channels'))} / {_n(t.get('programmes'))} / {_n(t.get('advertisers'))}"),
             ("First in break", _n(t.get("fib_pct"), "pct")), ("Avg ads in break", _n(t.get("avg_clutter"), "dec"))]
    kt = RlTable([[Paragraph(f"<font size=6.5 color='#646A8A'>{safe(a.upper())}</font><br/><font size=11><b>{safe(b)}</b></font>", s.body) for a, b in tiles]], colWidths=[WIDTH / len(tiles)] * len(tiles))
    kt.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.25, LINE), ("INNERGRID", (0, 0), (-1, -1), 0.25, LINE), ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8f9fe")),
                            ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    el.append(kt)


    # ---------------- sponsorships and frequency buys: advertiser, channel, theme, programmes, ad count, daily average
    sl = rep.get("sponsorships") or []
    rule = rep.get("rule") or {}
    if sl:
        el += [PageBreak(), Paragraph("Sponsorships and frequency buys", s.h2),
               Paragraph(f"One row per advertiser, channel and theme (the same ad). Sponsorship = a sponsorship theme (billboard, logo, tag, time check). Frequency = {rule.get('max_dur', 10)} seconds or shorter "
                         f"and {rule.get('min_daily', 10)} or more ads per day on air. Daily average = ads per day the theme was on air.", s.small), Spacer(1, 3)]
        rows = [["Advertiser", "Channel", "Theme", "Type", "Sponsorship programmes", "Ad count", "Days on air", "Daily average", "Length", "Ran"]]
        style = []
        for r in sl[:150]:
            progs = "; ".join(f"{_title(x['program'])} ({x['spots']:,})" for x in (r.get("programmes") or [])[:5]) + (f"; +{len(r['programmes']) - 5} more" if len(r.get("programmes") or []) > 5 else "")
            types = " + ".join(r.get("types") or [])
            rows.append([r["advertiser"], _title(r["channel"]), f"{r['theme']} ({r.get('item', '')})", types, progs, _n(r.get("spots")), _n(r.get("days")), _n(r.get("daily_avg"), "dec"),
                         f"{r['length']:.0f}s" if r.get("length") else "n/a", f"{r.get('first_seen', '')} to {r.get('last_seen', '')}"])
            if r.get("frequency"):
                style.append(("TEXTCOLOR", (7, len(rows) - 1), (7, len(rows) - 1), colors.HexColor("#c27a06")))
                style.append(("FONTNAME", (7, len(rows) - 1), (7, len(rows) - 1), "Helvetica-Bold"))
        el.append(_table(rows, [3.4, 2.0, 4.0, 2.2, 5.2, 1.4, 1.4, 1.5, 1.1, 2.8], s, brand, style))
        if len(sl) > 150:
            el.append(Paragraph(f"Showing 150 of {len(sl)} rows. Narrow the channels or advertisers for the rest.", s.small))

    # ---------------- sponsorship highlights per programme
    briefs = [b for b in (rep.get("briefs") or []) if b.get("points")]
    if briefs:
        el += [PageBreak(), Paragraph("Sponsorship highlights", s.h2), Paragraph("Talking points for the biggest programmes in this selection, worked out from the numbers in this report.", s.small), Spacer(1, 4)]
        for b in briefs:
            el.append(Paragraph(f"<b>{safe(_title(b['channel']))} &rsaquo; {safe(_title(b['program']))}</b>", ParagraphStyle("bh", parent=s.body, textColor=brand, spaceBefore=6, keepWithNext=1)))
            el += [Paragraph(f"&bull;&nbsp; {safe(x)}", s.body) for x in b["points"]]

    # ---------------- Channel -> Programme -> Advertiser
    el += [PageBreak(), Paragraph("Channel &rsaquo; Programme &rsaquo; Advertiser", s.h2),
           Paragraph("Role: Sponsorship = the advertiser has sponsorship items (billboards, logos, tags, time checks) in the programme; Regular Spot = commercial spots only. "
                     "SoV = share of all money in the programme. Health 0 to 100 = low clutter (40) + first or last in break (35) + price vs the programme's going rate (25): Good 65+, Fair 40 to 64, Poor below 40.", s.small), Spacer(1, 3)]
    head = ["Channel / programme / advertiser", "Role", "Sponsorship LKR", "Items", "Regular LKR", "Total LKR", "Spots", "Per day", "SoV", "Spot lengths", "Ads in break", "First in break", "Health"]
    rows: list = [head]
    style: list = []
    for c in rep.get("channels") or []:
        rows.append([Paragraph(f"<b>{safe(_title(c['channel']))}</b>", s.cellb), "", _n(c.get("sponsor_spend")), "", "", _n(c.get("spend")), _n(c.get("spots")), "", "", "", "", "", ""])
        style.append(("BACKGROUND", (0, len(rows) - 1), (-1, len(rows) - 1), colors.HexColor("#e1e3fb")))
        for p in c.get("programmes") or []:
            sp = p.get("selected") or {}
            note = f"{p.get('airing_days', 0)} airing days" + (f", sponsors: {', '.join(p['sponsors'][:4])}" + (" and more" if len(p["sponsors"]) > 4 else "") if p.get("sponsors") else "")
            rows.append([Paragraph(f"&nbsp;&nbsp;<b>{safe(_title(p['program']))}</b><br/>&nbsp;&nbsp;<font size=6.5 color='#646A8A'>{safe(note)}</font>", s.cell), "", _n(sp.get("sponsor_spend")), _n(sp.get("sponsor_items")),
                         _n(sp.get("regular_spend")), _n(sp.get("spend")), _n(sp.get("spots")), "", "", "", _n(p.get("avg_clutter"), "dec"), _n(p.get("fib_pct"), "pct"), ""])
            style.append(("BACKGROUND", (0, len(rows) - 1), (-1, len(rows) - 1), colors.HexColor("#f1f2fc")))
            for a in (p.get("advertisers") or [])[:15]:
                h = a.get("health") or {}
                rc = ROLE_COLOR.get(a.get("role"), "#646A8A")
                rows.append([Paragraph(f"&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{safe(a['advertiser'])}<br/>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<font size=6.5 color='#646A8A'>{safe(', '.join(a.get('products') or []))}</font>", s.cell),
                             Paragraph(f"<font color='{rc}'><b>{safe(a.get('role', ''))}</b></font>", s.cell), _n(a.get("sponsor_spend")), _n(a.get("sponsor_items")), _n(a.get("regular_spend")),
                             _n(a.get("spend")), _n(a.get("spots")), _n(a.get("per_day"), "dec"), _n(a.get("sov_spend"), "pct"), _durs(a.get("dur_split")),
                             _n(a.get("avg_clutter"), "dec"), _n(a.get("fib_pct"), "pct"), f"{h.get('score', '')} {BAND_WORD.get(h.get('band'), '')}".strip()])
                if h.get("band"):
                    style.append(("TEXTCOLOR", (12, len(rows) - 1), (12, len(rows) - 1), HEALTH_COLOR[h["band"]]))
                if (a.get("avg_clutter") or 0) > thr:
                    style.append(("TEXTCOLOR", (10, len(rows) - 1), (10, len(rows) - 1), WARN))
            if len(p.get("advertisers") or []) > 15:
                rows.append([Paragraph(f"&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<i>and {len(p['advertisers']) - 15} more advertisers</i>", s.small)] + [""] * 12)
    el.append(_table(rows, [4.9, 1.9, 2.0, 1.0, 2.0, 2.0, 1.1, 1.2, 1.3, 3.0, 1.3, 1.3, 1.4], s, brand, style))
    if (t.get("programmes") or 0) > (t.get("programmes_shown") or 0):
        el.append(Paragraph(f"Showing the {t['programmes_shown']} biggest of {t['programmes']} programmes. Narrow the channels, programmes or dates for the rest.", s.small))

    # ---------------- advertiser summary
    advs = rep.get("advertisers") or []
    if advs:
        el += [PageBreak(), Paragraph("Advertisers", s.h2)]
        img = _chart(advs)
        if img:
            el += [img, Spacer(1, 6)]
        rows = [["Advertiser", "Programmes", "With sponsorship", "Regular spots only", "Sponsorship LKR", "Regular LKR", "Total LKR", "Share", "Spots", "First in break"]]
        for a in advs[:30]:
            rows.append([a["advertiser"], _n(a.get("programmes")), _n(a.get("sponsored")), _n(a.get("regular")), _n(a.get("sponsor_spend")),
                         _n(a.get("regular_spend")), _n(a.get("spend")), _n(a.get("share_pct"), "pct"), _n(a.get("spots")), _n(a.get("fib_pct"), "pct")])
        el.append(_table(rows, [4.6, 1.5, 1.8, 1.8, 2.4, 2.4, 2.4, 1.3, 1.3, 1.5], s, brand))

    # ---------------- month by month
    m = rep.get("monthly") or {}
    months, mrows = (m.get("months") or []), (m.get("rows") or [])
    if months and mrows:
        months_shown = months[-12:]
        off = len(months) - len(months_shown)
        el += [Paragraph("Month by month", s.h2), Paragraph("Spend in LKR thousands, with spots in brackets." + (f" Last 12 of {len(months)} months shown." if off else ""), s.small), Spacer(1, 3)]
        rows = [["Advertiser"] + months_shown + ["Total"]]
        for r in mrows:
            vals = r["values"][off:]
            rows.append([r["advertiser"]] + [f"{v['spend'] / 1000:,.0f}\n({v['spots']:,})" if v["spots"] else "-" for v in vals] + [f"{sum(v['spend'] for v in vals) / 1000:,.0f}"])
        el.append(_table(rows, [4] + [1.6] * len(months_shown) + [1.8], s, brand))

    # ---------------- peak episodes
    peaks = [(c["channel"], p["program"], k, p.get("usual_spots_per_airing")) for c in rep.get("channels") or [] for p in c.get("programmes") or [] for k in p.get("peaks") or []]
    if peaks:
        el += [Paragraph("Peak episodes", s.h2), Paragraph("Airing days with at least 1.5 times the usual spots (and at least 3 more): likely finales, eviction nights or specials.", s.small), Spacer(1, 3)]
        rows = [["Channel", "Programme", "Date", "Spots that day", "Usual spots per airing"]]
        for ch, pg, k, usual in sorted(peaks, key=lambda x: -x[2]["spots"])[:25]:
            rows.append([_title(ch), _title(pg), k["date"], _n(k["spots"]), _n(usual, "dec")])
        el.append(_table(rows, [3, 6, 2.4, 2, 2.4], s, brand))

    el += [Spacer(1, 8), Paragraph("Sponsorship items are found from the theme: billboards (-BB, Intro, Extro, Com Break, Next Card) and logo items (LLogo, Tag, Time Check, DJ, -Tr). "
                                   "A special placement is a 60 second or longer spot at 3 times or more the programme's median spot cost. Spend is monitored rate-card spend, not invoiced cost.", s.small)]
    footer_txt = safe(f"{agency} | {cname} | Programme and sponsorship report | {branding.get('report_footer', '')}")

    def footer(canvas, doc_):
        canvas.saveState(); canvas.setFont("Helvetica", 7); canvas.setFillColor(MUTED)
        canvas.drawString(1.5 * cm, 0.7 * cm, footer_txt[:170]); canvas.drawRightString(PAGE[0] - 1.5 * cm, 0.7 * cm, f"Page {doc_.page}")
        canvas.setFillColor(accent); canvas.rect(0, PAGE[1] - 0.22 * cm, PAGE[0], 0.22 * cm, stroke=0, fill=1); canvas.restoreState()
    doc.build(el, onFirstPage=footer, onLaterPages=footer)
    return buf.getvalue()
