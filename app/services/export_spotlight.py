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
from reportlab.platypus import CondPageBreak, Image, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table as RlTable, TableStyle  # noqa: E402

from .export_negotiation import GOOD, LINE, PAGE, WARN, WIDTH, ZEBRA, _n, _Styles, _table
from .export_pdf import MUTED, _logo, safe

log = logging.getLogger(__name__)
DURS = ["5s", "10s", "15s", "20s", "30s", "30s+"]
ROLE_COLOR = {"Sponsorship": "#4F46E5", "Frequency": "#c27a06", "Regular Spot": "#646A8A"}
BAND_WORD = {"good": "Good", "fair": "Fair", "poor": "Poor"}
HEALTH_COLOR = {"good": GOOD, "fair": colors.HexColor("#c27a06"), "poor": WARN}


def _d(iso: Any) -> str:
    """2025-03-04 -> 4 Mar 2025 (n/a when empty)."""
    try:
        d = dt.date.fromisoformat(str(iso)[:10])
        return f"{d.day} {d:%b %Y}"
    except (TypeError, ValueError):
        return "n/a"


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


# ---------------------------------------------------------------- Sponsorship over time (multi-year) PDF
STATUS_COLOR = {"all": "#12a06a", "started": "#0b8fb8", "stopped": "#c27a06", "some": "#c27a06", "single": "#4F46E5", "occasional": "#646A8A", "none": "#646A8A"}


def _month_chart(months: list[dict], periods: list[dict]) -> Image | None:
    if not months:
        return None
    labels = [f"{m['label'][:3]} {m['label'][-2:]}" for m in months]       # Nov 24
    sp = [m["sponsorship_ads"] for m in months]
    ot = [m["other_ads"] for m in months]
    fig, ax = plt.subplots(figsize=(11, 2.4))
    x = list(range(len(months)))
    ax.bar(x, sp, color="#5b5ce6", label="Sponsorship ads")
    ax.bar(x, ot, bottom=sp, color="#b8bdd8", label="Other ads")
    # year boundaries
    for i in range(1, len(months)):
        if months[i]["period"] != months[i - 1]["period"]:
            ax.axvline(i - 0.5, color="#d6457f", linestyle="--", linewidth=1)
    for p in periods:
        idxs = [i for i, m in enumerate(months) if m["period"] == p["index"]]
        if idxs:
            ax.text((idxs[0] + idxs[-1]) / 2, ax.get_ylim()[1] * 0.98, p["label"], ha="center", va="top", fontsize=8, color="#d6457f", fontweight="bold")
    step = max(1, -(-len(labels) // 12))
    ax.set_xticks(x[::step]); ax.set_xticklabels(labels[::step], fontsize=7, rotation=0)
    ax.set_ylabel("Ads per month", fontsize=8); ax.tick_params(axis="y", labelsize=7); ax.legend(frameon=False, fontsize=7, loc="upper right", bbox_to_anchor=(1, 0.88))
    for s_ in ("top", "right"):
        ax.spines[s_].set_visible(False)
    ax.grid(axis="y", alpha=0.25)
    buf = io.BytesIO(); fig.savefig(buf, format="png", dpi=150, bbox_inches="tight", facecolor="white"); plt.close(fig); buf.seek(0)
    img = Image(buf); r = img.imageHeight / img.imageWidth
    img.drawWidth, img.drawHeight = WIDTH, WIDTH * r
    return img


def build_tenure_pdf(rep: dict, meta: dict, client: dict, branding: dict, logos: dict) -> bytes:
    brand = colors.HexColor(branding.get("primary_color") or "#4F46E5")
    accent = colors.HexColor(client.get("brand_color") or "#5B5CE6")
    agency = branding.get("agency_name") or "Media Radar"
    cname = client.get("name") or "Client"
    s = _Styles(brand)
    periods = rep.get("periods") or []
    rows = rep.get("rows") or []
    sel = rep.get("selection") or {}
    tot = rep.get("totals") or {}
    bounds = rep.get("bounds") or [None, None]
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=PAGE, leftMargin=1.5 * cm, rightMargin=1.5 * cm, topMargin=1.4 * cm, bottomMargin=1.3 * cm, title="Sponsorship over time", author=safe(agency))
    el: list = []
    log.info("[tenure pdf] %s rows, %s periods", len(rows), len(periods))

    la, lc = _logo(logos.get("agency"), 1.4), _logo(logos.get("client"), 1.4)
    lt = RlTable([[la or Paragraph(f"<b>{safe(agency)}</b>", s.lead), lc or Paragraph(f"<b>{safe(cname)}</b>", s.lead)]], colWidths=[WIDTH / 2] * 2)
    lt.setStyle(TableStyle([("ALIGN", (1, 0), (1, 0), "RIGHT"), ("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
    band = RlTable([[""]], colWidths=[WIDTH], rowHeights=[0.2 * cm]); band.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), accent)]))
    info = [["Uploaded data", f"{bounds[0] or 'n/a'} to {bounds[1] or 'n/a'} ({rep.get('data_months', 0)} months)"],
            ["Year periods", ("Calendar years: " if rep.get("mode") == "calendar" else "12-month years from the first month of the data: ") + "; ".join(f"{p['label']} ({p['range']})" for p in periods)],
            ["Channel", _title(sel.get("channel")) if sel.get("channel") else "All"], ["Programme", _title(sel.get("program")) if sel.get("program") else "All"], ["Advertiser", sel.get("advertiser") or "All"],
            ["Shows", "Sponsorships only" if sel.get("show") != "all" else "All advertisers in the programme"], ["Generated", dt.datetime.now().strftime("%d %b %Y %H:%M")]]
    it = RlTable([[Paragraph(f"<b>{a}</b>", s.body), Paragraph(safe(b), s.body)] for a, b in info], colWidths=[3.6 * cm, WIDTH - 3.6 * cm])
    it.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.25, LINE), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]))
    el += [lt, Spacer(1, 0.4 * cm), band, Spacer(1, 0.3 * cm), Paragraph("Sponsorship over time", s.h1),
           Paragraph(f"Who sponsored which programme, and for how long, in the data uploaded for <b>{safe(cname)}</b> by {safe(agency)}", s.lead), Spacer(1, 0.25 * cm), it, Spacer(1, 0.3 * cm)]
    tiles = [("Advertiser and programme pairs", _n(tot.get("rows"))), ("Sponsored in every year", _n(tot.get("all_years"))), ("Advertisers", _n(tot.get("advertisers"))),
             ("Programmes", _n(tot.get("programmes"))), ("Sponsorship ads", _n(tot.get("sponsorship_ads"))), ("All ads in these programmes", _n(tot.get("total_ads"))), ("Frequency ads", _n(((rep.get("frequency") or {}).get("totals") or {}).get("ads")))]
    kt = RlTable([[Paragraph(f"<font size=6.5 color='#646A8A'>{safe(a.upper())}</font><br/><font size=11><b>{safe(b)}</b></font>", s.body) for a, b in tiles]], colWidths=[WIDTH / len(tiles)] * len(tiles))
    kt.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.25, LINE), ("INNERGRID", (0, 0), (-1, -1), 0.25, LINE), ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8f9fe")),
                            ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    el.append(kt)

    # ---------------- overview: who sponsored what, each year with its start and end
    el += [PageBreak(), Paragraph("Who sponsored what, year by year", s.h2),
           Paragraph("One row per advertiser and programme. Each year column shows when the sponsorship started and ended in that year and the ads they ran in the programme that year. "
                     "The ad themes are the sponsorship items (and other ads) behind it.", s.small), Spacer(1, 3)]
    head = ["Advertiser", "Channel", "Programme", "Status", "Ad themes"] + [f"{p['label']}: started to ended (ads)" for p in periods] + ["Total ads", "Sponsorship ads", "Spend LKR"]
    cell = s.cell
    data = [head]
    for r in rows[:60]:
        rc = STATUS_COLOR.get(r.get("status_code"), "#646A8A")
        themes = [t for t in (r.get("themes") or []) if t.get("sponsorship")][:3] or (r.get("themes") or [])[:2]
        th_txt = "<br/>".join(f"{safe(t['theme'])} <font color='#646A8A'>({safe(t.get('item', ''))}, {t['spots']:,})</font>" for t in themes) or "n/a"
        yr = []
        for x in r.get("periods") or []:
            if x.get("sponsored"):
                tag = "" if x.get("consistent") else " <font color='#c27a06'>occasional</font>"
                yr.append(Paragraph(f"{_d(x.get('sponsored_start'))}<br/>to {_d(x.get('sponsored_end'))}{tag}<br/><b>{x['total_ads']:,} ads</b>", cell))
            else:
                yr.append(Paragraph(f"<font color='#646A8A'>{'Not on air' if not x.get('aired') else 'No sponsorship'}</font><br/><b>{x['total_ads']:,} ads</b>", cell))
        data.append([Paragraph(f"<b>{safe(r['advertiser'])}</b>", cell), _title(r["channel"]), _title(r["program"]), Paragraph(f"<font color='{rc}'><b>{safe(r.get('status', ''))}</b></font>", cell),
                     Paragraph(th_txt, cell)] + yr + [_n(r.get("total_ads")), _n(r.get("sponsorship_ads")), _n(r.get("spend"))])
    style = []
    if len(data) > 1:
        n = len(data) - 1
        sm = lambda f: sum(f(r) for r in rows[:60])  # noqa: E731
        data.append(["Total", "", "", "", ""] + [_n(sum((r["periods"][i]["total_ads"] if i < len(r.get("periods") or []) else 0) for r in rows[:60])) for i in range(len(periods))]
                    + [_n(sm(lambda r: r.get("total_ads") or 0)), _n(sm(lambda r: r.get("sponsorship_ads") or 0)), _n(sm(lambda r: r.get("spend") or 0))])
        style += [("FONTNAME", (0, n + 1), (-1, n + 1), "Helvetica-Bold"), ("LINEABOVE", (0, n + 1), (-1, n + 1), 1, colors.HexColor("#1b1d36")), ("BACKGROUND", (0, n + 1), (-1, n + 1), colors.HexColor("#e1e3fb"))]
    style += [("ALIGN", (c, 1), (c, -1), "RIGHT") for c in range(5 + len(periods), len(head))] + [("VALIGN", (0, 0), (-1, -1), "TOP")]
    el.append(_table(data, [2.8, 1.6, 2.4, 2.8, 4.6] + [3.2] * len(periods) + [1.3, 1.5, 2.1], s, brand, style))
    if len(rows) > 60:
        el.append(Paragraph(f"Showing 60 of {len(rows)} rows. Pick a channel or advertiser for the rest.", s.small))

    # ---------------- frequency sponsorships: Tag, Com Break, Time Check and frequent short spots, by channel
    fr = rep.get("frequency") or {}
    frows = fr.get("rows") or []
    frule = fr.get("rule") or {}
    if frows:
        el += [PageBreak(), Paragraph("Frequency sponsorships by channel", s.h2),
               Paragraph(f"Tag, Com Break and Time Check items, and any ad of {frule.get('max_dur', 10)} seconds or less running {frule.get('min_daily', 10)} or more times a day on the channel. "
                         "These are bought on the channel, not in a programme, so they are not counted in the programme sponsorships above. Each year column shows the ads that year and when they started and ended.", s.small), Spacer(1, 3)]
        head = ["Advertiser", "Channel", "Tag", "Com Break", "Time Check", f"Short spots ({frule.get('max_dur', 10)}s, {frule.get('min_daily', 10)}+ a day)", "Total ads"] + [f"{p['label']}" for p in periods] + ["Days on air", "Daily average", "Value LKR"]
        data = [head]
        for r in frows[:60]:
            data.append([Paragraph(f"<b>{safe(r['advertiser'])}</b>", s.cell), _title(r["channel"]), _n(r.get("tag")), _n(r.get("com_break")), _n(r.get("time_check")), _n(r.get("short_spots")), _n(r.get("ads"))]
                        + [Paragraph(f"<b>{x['ads']:,}</b>" + (f"<br/><font size=6.5 color='#646A8A'>{_d(x.get('start'))} to {_d(x.get('end'))}</font>" if x.get("start") else ""), s.cell) for x in r.get("periods") or []]
                        + [_n(r.get("days")), _n(r.get("daily_avg"), "dec"), _n(r.get("value"))])
        n = len(data) - 1
        fs = lambda k: sum((r.get(k) or 0) for r in frows[:60])  # noqa: E731
        data.append(["Total", "", _n(fs("tag")), _n(fs("com_break")), _n(fs("time_check")), _n(fs("short_spots")), _n(fs("ads"))] + [_n(sum((r["periods"][i]["ads"] if i < len(r.get("periods") or []) else 0) for r in frows[:60])) for i in range(len(periods))] + ["", "", _n(fs("value"))])
        fst = [("FONTNAME", (0, n + 1), (-1, n + 1), "Helvetica-Bold"), ("LINEABOVE", (0, n + 1), (-1, n + 1), 1, colors.HexColor("#1b1d36")), ("BACKGROUND", (0, n + 1), (-1, n + 1), colors.HexColor("#e1e3fb"))]
        fst += [("ALIGN", (c, 1), (c, -1), "RIGHT") for c in range(2, len(head))] + [("VALIGN", (0, 0), (-1, -1), "TOP")]
        el.append(_table(data, [3.0, 1.8, 1.2, 1.5, 1.5, 2.6, 1.5] + [2.8] * len(periods) + [1.5, 1.5, 2.2], s, brand, fst))

    # ---------------- one section per row (the first 8)
    for r in rows[:8]:
        if not (r.get("periods")):
            continue
        rc = STATUS_COLOR.get(r.get("status_code"), "#646A8A")
        el += [PageBreak(), Paragraph(f"{safe(r['advertiser'])} &rsaquo; {safe(_title(r['program']))} on {safe(_title(r['channel']))}", s.h2),
               Paragraph(f"<font color='{rc}'><b>{safe(r.get('status', ''))}</b></font>", s.lead), Spacer(1, 2), Paragraph(safe(r.get("headline", "")), s.body), Spacer(1, 4)]
        if r.get("gaps"):
            el.append(Paragraph("Pauses in sponsorship: " + "; ".join(f"{g['from']} to {g['to']} ({g['months']} month{'s' if g['months'] != 1 else ''})" for g in r["gaps"]), s.small))
        # what kind of buy is it: a steady monthly value, and prime vs non-prime time
        notes = []
        pat = r.get("pattern")
        if pat:
            notes.append(("#12a06a" if (pat.get("steady") or pat.get("steady_each_year")) else "#c27a06", pat.get("text", "")))
        pr = r.get("prime") or {}
        sp = pr.get("sponsorship") or {}
        if (sp.get("prime_ads") or 0) + (sp.get("other_ads") or 0):
            notes.append(("#4F46E5", f"Sponsorship time: {_n(sp.get('prime_ads'))} ads in prime time (LKR {_n(sp.get('prime_value'))}) and {_n(sp.get('other_ads'))} ads in non-prime time (LKR {_n(sp.get('other_value'))}), "
                                     f"{_n(pr.get('prime_share_pct'), 'pct')} in prime time: {pr.get('time_mix') or 'n/a'}."))
        for col, txt in notes:
            el.append(Paragraph(f"<font color='{col}'><b>&bull;</b></font>&nbsp; {safe(txt)}", s.body))
        el.append(Spacer(1, 4))
        # year by year with start and end
        rows_y = [["Year period", "Sponsorship started", "Sponsorship ended", "Programme airing days", "Days sponsored", "Sponsorship ads", "Sponsorship value LKR", "Commercial-only ads", "Commercial-only value LKR", "Total ads", "Sponsored?"]]
        sty = []
        for x in r["periods"]:
            rows_y.append([Paragraph(f"<b>{safe(x['label'])}</b><br/><font size=6.5 color='#646A8A'>{safe(x['range'])}</font>", s.cell), _d(x.get("sponsored_start")), _d(x.get("sponsored_end")), _n(x.get("airing_days")), _n(x.get("days_sponsored")),
                           _n(x.get("sponsorship_ads")), _n(x.get("sponsorship_spend")), _n(x.get("other_ads")), _n(x.get("commercial_spend")), _n(x.get("total_ads")),
                           "Yes" if x.get("consistent") else ("Occasional" if x.get("sponsored") else ("Not on air" if not x.get("aired") else "No"))])
            if x.get("consistent"):
                sty.append(("TEXTCOLOR", (10, len(rows_y) - 1), (10, len(rows_y) - 1), GOOD))
        n = len(rows_y) - 1
        rows_y.append(["Whole period", _d(r.get("sponsored_first")), _d(r.get("sponsored_last")), _n(r.get("airing_days")), _n(r.get("days_sponsored")), _n(r.get("sponsorship_ads")), _n(r.get("sponsorship_spend")),
                       _n(r.get("other_ads")), _n((r.get("spend") or 0) - (r.get("sponsorship_spend") or 0)), _n(r.get("total_ads")), ""])
        sty += [("FONTNAME", (0, n + 1), (-1, n + 1), "Helvetica-Bold"), ("LINEABOVE", (0, n + 1), (-1, n + 1), 1, colors.HexColor("#1b1d36")), ("BACKGROUND", (0, n + 1), (-1, n + 1), colors.HexColor("#e1e3fb"))]
        sty += [("ALIGN", (c, 1), (c, -1), "RIGHT") for c in range(3, 10)]
        el += [_table(rows_y, [2.6, 2.1, 2.1, 1.7, 1.6, 2.1, 2.4, 2.1, 2.4, 1.3, 1.7], s, brand, sty), Spacer(1, 6)]
        # what ads ran
        th = r.get("themes") or []
        if th:
            head_t = ["What ads ran (theme)", "Type"] + [f"{p['label']} ads" for p in periods] + ["Total ads", "In prime time", "Other times", "First seen", "Last seen"]
            data_t = [head_t]
            sty_t = []
            for t in th[:12]:
                data_t.append([t["theme"], ("Sponsorship: " if t.get("sponsorship") else "") + t.get("item", "")] + [_n(v) for v in t.get("per_period") or []]
                               + [_n(t.get("spots")), _n(t.get("prime_ads")), _n(t.get("other_time_ads")), _d(t.get("first_seen")), _d(t.get("last_seen"))])
                if t.get("sponsorship"):
                    sty_t.append(("TEXTCOLOR", (1, len(data_t) - 1), (1, len(data_t) - 1), brand))
            sty_t += [("ALIGN", (c, 1), (c, -1), "RIGHT") for c in range(2, 5 + len(periods))]
            el += [Paragraph("<b>What ads ran</b>", ParagraphStyle("wa", parent=s.body, keepWithNext=1)), Spacer(1, 2), _table(data_t, [5.2, 2.8] + [1.5] * len(periods) + [1.4, 1.5, 1.5, 2.0, 2.0], s, brand, sty_t), Spacer(1, 6)]
        # month by month: sponsorship (value-add) vs commercial only, count and value
        ms = r.get("months") or []
        img = _month_chart(ms, periods)
        if img:
            el += [CondPageBreak(7 * cm), Paragraph("<b>Ads per month</b>", ParagraphStyle("am", parent=s.body, keepWithNext=1)), img]
        if ms:
            el += [CondPageBreak(5 * cm), Paragraph("<b>Month by month in this programme</b>", ParagraphStyle("mm", parent=s.body, keepWithNext=1)),
                   Paragraph("Sponsorship = value-add items (billboard, logo, intro, outro, tag, time check). Commercial only = ordinary paid spots. A sponsorship value that stays about the same every month points to a fixed package.", s.small), Spacer(1, 2)]
            hm = ["Month", "Year period", "Sponsorship ads", "Sponsorship value LKR", "Sponsorship ads in prime time", "Sponsorship ads other times", "Commercial-only ads", "Commercial-only value LKR", "Total ads", "Note"]
            data_m = [hm]
            sty_m = []
            first_sp = next((i for i, m in enumerate(ms) if m["sponsorship_ads"] > 0), None)
            last_sp = max((i for i, m in enumerate(ms) if m["sponsorship_ads"] > 0), default=None)
            for i, m in enumerate(ms):
                note = "No sponsorship" if (first_sp is not None and first_sp < i < last_sp and m["sponsorship_ads"] == 0) else ""
                data_m.append([m["label"], (periods[m["period"]]["label"] if m["period"] < len(periods) else ""), _n(m["sponsorship_ads"]), _n(m["sponsorship_value"]), _n(m.get("sponsorship_prime_ads")), _n(m.get("sponsorship_other_time_ads")),
                               _n(m["other_ads"]), _n(m["commercial_value"]), _n(m["sponsorship_ads"] + m["other_ads"]), note])
                if note:
                    sty_m.append(("TEXTCOLOR", (9, len(data_m) - 1), (9, len(data_m) - 1), colors.HexColor("#c27a06")))
            tot = lambda k: sum((m.get(k) or 0) for m in ms)  # noqa: E731
            data_m.append(["Total", "", _n(tot("sponsorship_ads")), _n(tot("sponsorship_value")), _n(tot("sponsorship_prime_ads")), _n(tot("sponsorship_other_time_ads")), _n(tot("other_ads")), _n(tot("commercial_value")),
                           _n(tot("sponsorship_ads") + tot("other_ads")), ""])
            lm_ = len(data_m) - 1
            sty_m += [("FONTNAME", (0, lm_), (-1, lm_), "Helvetica-Bold"), ("LINEABOVE", (0, lm_), (-1, lm_), 1, colors.HexColor("#1b1d36")), ("BACKGROUND", (0, lm_), (-1, lm_), colors.HexColor("#e1e3fb"))]
            sty_m += [("ALIGN", (c, 1), (c, -1), "RIGHT") for c in range(2, 9)]
            el.append(_table(data_m, [2.0, 1.8, 1.9, 2.8, 2.4, 2.4, 2.3, 2.8, 1.4, 2.4], s, brand, sty_m))

    for r in frows[:8]:
        el += [PageBreak(), Paragraph(f"Frequency: {safe(r['advertiser'])} on {safe(_title(r['channel']))}", s.h2), Paragraph(safe(r.get("headline", "")), s.body), Spacer(1, 4)]
        ms = r.get("months") or []
        if ms:
            hm = ["Month", "Year period", "Tag", "Com Break", "Time Check", f"Short spots ({frule.get('max_dur', 10)}s, {frule.get('min_daily', 10)}+ a day)", "Total frequency ads", "Value LKR"]
            dm = [hm] + [[m["label"], periods[m["period"]]["label"] if m["period"] < len(periods) else "", _n(m["tag"]), _n(m["com_break"]), _n(m["time_check"]), _n(m["short_spots"]), _n(m["total"]), _n(m["value"])] for m in ms]
            t = lambda k: sum((m.get(k) or 0) for m in ms)  # noqa: E731
            dm.append(["Total", "", _n(t("tag")), _n(t("com_break")), _n(t("time_check")), _n(t("short_spots")), _n(t("total")), _n(t("value"))])
            lm_ = len(dm) - 1
            sty = [("FONTNAME", (0, lm_), (-1, lm_), "Helvetica-Bold"), ("LINEABOVE", (0, lm_), (-1, lm_), 1, colors.HexColor("#1b1d36")), ("BACKGROUND", (0, lm_), (-1, lm_), colors.HexColor("#e1e3fb"))]
            sty += [("ALIGN", (c, 1), (c, -1), "RIGHT") for c in range(2, 8)]
            el += [Paragraph("<b>Month by month on this channel</b>", ParagraphStyle("fm", parent=s.body, keepWithNext=1)), Spacer(1, 2), _table(dm, [2.2, 2.0, 1.6, 1.8, 1.8, 3.2, 2.4, 2.6], s, brand, sty), Spacer(1, 6)]
        th = r.get("themes") or []
        if th:
            dt_ = [["What ads ran (theme)", "Type", "Ads", "Days on air", "Daily average", "Length", "First seen", "Last seen", "Value LKR"]]
            dt_ += [[x["theme"], x["type"], _n(x["ads"]), _n(x["days"]), _n(x["daily_avg"], "dec"), f"{x['length']:.0f}s" if x.get("length") else "n/a", _d(x.get("first_seen")), _d(x.get("last_seen")), _n(x.get("value"))] for x in th]
            el += [Paragraph("<b>What ads ran</b>", ParagraphStyle("fw", parent=s.body, keepWithNext=1)), Spacer(1, 2),
                   _table(dt_, [5.0, 2.2, 1.4, 1.6, 1.6, 1.3, 2.2, 2.2, 2.2], s, brand, [("ALIGN", (c, 1), (c, -1), "RIGHT") for c in (2, 3, 4, 5, 8)])]
    el += [Spacer(1, 8), Paragraph("Programme sponsorship = -BB, -Intro, -Extro, -LLogo, Next Card, DJ and -Tr items. A year counts as sponsored when they were on at least half of the programme's airing days that year; fewer is shown as occasional. Tag, Com Break, Time Check and frequent short spots are frequency sponsorships, shown in their own section. "
                                   "Airing days are days the programme aired with any advertiser. Spend is monitored rate-card spend, not invoiced cost.", s.small)]
    footer_txt = safe(f"{agency} | {cname} | Sponsorship over time | {branding.get('report_footer', '')}")

    def footer(canvas, doc_):
        canvas.saveState(); canvas.setFont("Helvetica", 7); canvas.setFillColor(MUTED)
        canvas.drawString(1.5 * cm, 0.7 * cm, footer_txt[:170]); canvas.drawRightString(PAGE[0] - 1.5 * cm, 0.7 * cm, f"Page {doc_.page}")
        canvas.setFillColor(accent); canvas.rect(0, PAGE[1] - 0.22 * cm, PAGE[0], 0.22 * cm, stroke=0, fill=1); canvas.restoreState()
    doc.build(el, onFirstPage=footer, onLaterPages=footer)
    return buf.getvalue()
