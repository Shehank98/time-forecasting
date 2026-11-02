"""Executive Negotiation Summary PDF: summary tables (overall, channels, programmes and sponsorship) plus the drill-down
breakdown for the top channels and programmes. Built from the browser summary (A4 landscape, ReportLab)."""
from __future__ import annotations

import datetime as dt
import io
import logging
from typing import Any

from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm
from reportlab.platypus import CondPageBreak, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table as RlTable, TableStyle

from .export_negotiation import LINE, PAGE, WIDTH, _n, _Styles, _table
from .export_pdf import MUTED, _logo, safe

log = logging.getLogger(__name__)
FREQ = colors.HexColor("#c27a06")
HFR, EXCL, SPNL = "High-Frequency Reminders", "Exclusive Sponsorship / Value-Add", "Sponsorship / Value-Add"


def _t(s: Any) -> str:
    return str(s or "").title()


def _pick(xs: list, n: int = 8) -> str:
    return (", ".join(map(str, xs[:n])) + (f" and {len(xs) - n} more" if len(xs) > n else "")) if xs else "All"

LABEL_COLOR = {"High-Frequency Reminders": "#c27a06", "Exclusive Sponsorship / Value-Add": "#4F46E5", "Sponsorship / Value-Add": "#0b8fb8", "Regular": "#646A8A"}
PLACE = lambda p: f"{p.get('first', 0):,} first, {p.get('middle', 0):,} middle, {p.get('last', 0):,} last"  # noqa: E731


def _durs(sp: dict | None) -> str:
    sp = sp or {}
    return ", ".join(f"{k} {sp[k]:,}" for k in ("5s", "10s", "15s", "20s", "30s", "30s+") if sp.get(k)) or "n/a"


def _class_table(rows: list[dict], s: _Styles, brand, with_programme: bool = True) -> RlTable:
    """Classified ads: class, advertiser and theme, spots, days present, daily average, durations and placements in the break."""
    head = (["Channel / programme"] if with_programme else []) + ["Classification", "Advertiser: theme", "Spots", "Days present", "Daily avg", "Durations", "Placements in break", "Spend"]
    data = [head]
    style = []
    for r in rows:
        cls = " + ".join(f"<font color='{LABEL_COLOR.get(t, '#646A8A')}'><b>{safe(t)}</b></font>" for t in r.get("types") or [])
        data.append(([f"{_t(r.get('channel'))}: {_t(r.get('program'))}"] if with_programme else []) + [Paragraph(cls, s.cell), f"{r['advertiser']}: {r['theme']} ({r.get('item', '')})", _n(r.get("spots")),
                    f"{_n(r.get('days'))} of {_n(r.get('airings'))}", _n(r.get("daily_avg"), "dec"), _durs(r.get("dur_split")), PLACE(r.get("placement") or {}), _n(r.get("spend"))])
        if r.get("frequency"):
            col = 5 if with_programme else 4
            style.append(("TEXTCOLOR", (col, len(data) - 1), (col, len(data) - 1), FREQ))
    w = ([3.0] if with_programme else []) + [3.6, 4.4, 1.2, 1.7, 1.2, 3.0, 3.8, 1.8]
    return _table(data, w, s, brand, style)



def _split_rows(rows: list[dict], label: str) -> list[list[str]]:
    return [[label, "Spots", "Spend (LKR)", "Share of spend"]] + [[str(r.get("name")), _n(r.get("spots")), _n(r.get("spend")), _n(r.get("spend_share"), "pct")] for r in rows]


def _detail_block(d: dict, title: str, s: _Styles, brand, title_has_programme: bool = False) -> list:
    """Commercial details, ratings and volume, sponsorship details for one channel or programme."""
    c, v, sp = d.get("commercial") or {}, d.get("volume") or {}, d.get("sponsorship") or {}
    rt = v.get("ratings")
    out: list = [CondPageBreak(6 * cm), Paragraph(f"<b>{safe(title)}</b> <font size=7 color='#646A8A'>{safe(v.get('first_seen') or '')} to {safe(v.get('last_seen') or '')}</font>",
                                                  ParagraphStyle("dh", parent=s.body, textColor=brand, fontSize=10.5, spaceBefore=8, spaceAfter=3, keepWithNext=1))]
    kv = [["Commercial spots", _n(c.get("spots")), "Total spots", _n(v.get("spots")), "Sponsorship items", _n(sp.get("items"))],
          ["Commercial spend", _n(c.get("spend"), "lkr"), "Spots per day", _n(v.get("spots_per_day"), "dec"), "Billboards / logos and tags", f"{_n(sp.get('billboards'))} / {_n(sp.get('logos'))}"],
          ["Special placements", _n(c.get("special_spots")), "Avg ads in break", _n(v.get("avg_clutter"), "dec"), "Sponsorship spend", _n(sp.get("spend"), "lkr")],
          ["GRPs", _n(rt.get("grps"), "dec") if rt else "TVR sheet not loaded", "First in break", _n(v.get("fib_pct"), "pct"), "Busiest day",
           f"{v['peak_day']['date']} ({v['peak_day']['spots']})" if v.get("peak_day") else "n/a"],
          ["CPRP", _n(rt.get("cprp"), "lkr") if rt and rt.get("cprp") else "n/a", "Avg spot rating", _n(rt.get("avg_spot_rating"), "dec") if rt and rt.get("avg_spot_rating") is not None else "n/a", "Active days", _n(v.get("active_days"))]]
    kt = RlTable([[Paragraph(f"<font color='#646A8A'>{safe(a)}</font>", s.cell), Paragraph(f"<b>{safe(b)}</b>", s.cell), Paragraph(f"<font color='#646A8A'>{safe(c2)}</font>", s.cell),
                   Paragraph(f"<b>{safe(d2)}</b>", s.cell), Paragraph(f"<font color='#646A8A'>{safe(e)}</font>", s.cell), Paragraph(f"<b>{safe(f)}</b>", s.cell)] for a, b, c2, d2, e, f in kv],
                 colWidths=[w / 18 * WIDTH for w in (2.6, 3.4, 2.4, 3.2, 3.0, 3.4)])
    kt.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.25, LINE), ("INNERGRID", (0, 0), (-1, -1), 0.25, LINE), ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8f9fe")),
                            ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]))
    out.append(kt)
    k = d.get("classification") or {}
    out.append(Paragraph(f"<b>High-frequency spots vs logo, intro and outro sponsorships:</b> {_n(k.get('exclusive_ads'))} exclusive ad(s) ({_n(k.get('exclusive_spots'))} spots), "
                         f"{_n(k.get('sponsorship_ads'))} other sponsorship ad(s) ({_n(k.get('sponsorship_spots'))} spots), {_n(k.get('frequency_ads'))} high-frequency ad(s) ({_n(k.get('frequency_spots'))} spots).", s.small))
    cls = d.get("classified") or []
    if cls:
        out += [Spacer(1, 2), _class_table(cls[:14], s, brand, with_programme=title_has_programme is False)]
    dur = [["Length", "Commercial spots", "Spend", "Share"]] + [[r["name"], _n(r["spots"]), _n(r["spend"]), _n(r.get("spot_share"), "pct")] for r in c.get("by_duration") or []]
    from reportlab.platypus import Table as T2
    if len(dur) > 1:
        t = T2([[Paragraph(safe(x), s.hdr if i == 0 else s.cell) for x in r] for i, r in enumerate(dur)], colWidths=[WIDTH * 0.1, WIDTH * 0.12, WIDTH * 0.14, WIDTH * 0.08], repeatRows=1, hAlign="LEFT")
        t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), brand), ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f4f5fb")]), ("LINEBELOW", (0, 0), (-1, -1), 0.25, LINE),
                               ("TOPPADDING", (0, 0), (-1, -1), 1.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5), ("ALIGN", (1, 1), (-1, -1), "RIGHT")]))
        out += [Spacer(1, 4), t]
    return out


def build_executive_pdf(d: dict, meta: dict, client: dict, branding: dict, logos: dict) -> bytes:
    brand = colors.HexColor(branding.get("primary_color") or "#4F46E5")
    accent = colors.HexColor(client.get("brand_color") or "#5B5CE6")
    agency = branding.get("agency_name") or "Media Radar"
    cname = client.get("name") or "Client"
    s = _Styles(brand)
    o = d.get("overall") or {}
    sel = d.get("selection") or {}
    rng = d.get("range") or d.get("period") or [None, None]
    rule = d.get("rule") or {}
    rt = o.get("ratings")
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=PAGE, leftMargin=1.5 * cm, rightMargin=1.5 * cm, topMargin=1.4 * cm, bottomMargin=1.3 * cm, title="Executive negotiation summary", author=safe(agency))
    el: list = []
    log.info("[executive pdf] %s channels, %s programmes, %s detail blocks", len(d.get("channels") or []), len(d.get("programmes") or []),
             len(d.get("channel_details") or []) + len(d.get("programme_details") or []))

    # ---------------- cover + section 1
    la, lc = _logo(logos.get("agency"), 1.4), _logo(logos.get("client"), 1.4)
    lt = RlTable([[la or Paragraph(f"<b>{safe(agency)}</b>", s.lead), lc or Paragraph(f"<b>{safe(cname)}</b>", s.lead)]], colWidths=[WIDTH / 2] * 2)
    lt.setStyle(TableStyle([("ALIGN", (1, 0), (1, 0), "RIGHT"), ("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
    band = RlTable([[""]], colWidths=[WIDTH], rowHeights=[0.2 * cm]); band.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), accent)]))
    info = [["Date range", f"{rng[0] or 'n/a'} to {rng[1] or 'n/a'}"], ["Advertisers", _pick(sel.get("advertisers") or [])], ["Channels", _pick([_t(x) for x in sel.get("channels") or []])],
            ["Other filters", "; ".join(map(str, meta.get("filters") or [])) or "None"], ["Data", safe(meta.get("dataset") or "LMRB ad monitoring file")], ["Generated", dt.datetime.now().strftime("%d %b %Y %H:%M")]]
    it = RlTable([[Paragraph(f"<b>{a}</b>", s.body), Paragraph(safe(b), s.body)] for a, b in info], colWidths=[3.6 * cm, WIDTH - 3.6 * cm])
    it.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.25, LINE), ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]))
    el += [lt, Spacer(1, 0.4 * cm), band, Spacer(1, 0.3 * cm), Paragraph("Executive Negotiation Summary", s.h1),
           Paragraph(f"Prepared for <b>{safe(cname)}</b> by {safe(agency)}", s.lead), Spacer(1, 0.25 * cm), it, Spacer(1, 0.3 * cm)]
    tiles = [("Active brands", f"{_n(o.get('brands'))} ({_n(o.get('products'))} products)"), ("Total monitored spend", _n(o.get("spend"), "lkr")),
             ("Commercial only", f"{_n(o.get('commercial_spend'), 'lkr')} ({_n(o.get('commercial_share'), 'pct')})"), ("Value addition / sponsorship", f"{_n(o.get('value_add_spend'), 'lkr')} ({_n(o.get('value_add_share'), 'pct')})"),
             ("Spots", f"{_n(o.get('commercial_spots'))} commercial, {_n(o.get('value_add_items'))} sponsorship items"), ("Programmes", f"{_n(o.get('programmes'))} ({_n(d.get('sponsored_programmes'))} sponsored)"),
             ("Exclusive sponsorships", f"{_n(o.get('exclusive_ads'))} ads, {_n(o.get('exclusive_spots'))} spots"), ("High-frequency reminders", f"{_n(o.get('frequency_ads'))} ads, {_n(o.get('frequency_spots'))} spots")] + ([("GRPs / CPRP", f"{_n(rt.get('grps'), 'dec')} / {_n(rt.get('cprp'), 'lkr')}")] if rt else [])
    kt = RlTable([[Paragraph(f"<font size=6.5 color='#646A8A'>{safe(a.upper())}</font><br/><font size=9.5><b>{safe(b)}</b></font>", s.body) for a, b in tiles]], colWidths=[WIDTH / len(tiles)] * len(tiles))
    kt.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.25, LINE), ("INNERGRID", (0, 0), (-1, -1), 0.25, LINE), ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8f9fe")),
                            ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    el += [Paragraph("1. Overall campaign summary", s.h2), kt, Spacer(1, 6)]
    q = WIDTH / 4 - 0.15 * cm

    def split_tbl(rows, label):
        t = RlTable([[Paragraph(safe(x), s.hdr if i == 0 else s.cell) for x in r] for i, r in enumerate(_split_rows(rows, label))], colWidths=[q * x for x in (0.34, 0.18, 0.28, 0.2)])
        t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), brand), ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f4f5fb")]), ("LINEBELOW", (0, 0), (-1, -1), 0.25, LINE),
                               ("TOPPADDING", (0, 0), (-1, -1), 1.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5)]))
        return t
    g = RlTable([[split_tbl(d.get("durations") or [], "Length"), split_tbl(d.get("languages") or [], "Language"), split_tbl(d.get("media") or [], "Medium"), split_tbl((d.get("brands") or [])[:8], "Top brands")]],
                colWidths=[WIDTH / 4] * 4)
    g.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 6)]))
    el += [g, Paragraph("Commercial = regular and special spots. Value-add = sponsorship items (billboards, logos, tags, time checks). Medium is worked out from the channel name. "
                        f"High-Frequency Reminders = the same ad averaged more than {rule.get('min_daily', 10)} spots a day in a programme, or {rule.get('max_dur', 10)} seconds or shorter at {rule.get('min_daily', 10)}+ a day. "
                        f"Exclusive Sponsorship / Value-Add = a logo, intro, outro, billboard, tag or time-check item on at least {rule.get('consistent_share', 50):.0f}% of the programme's airing days.", s.small)]

    # ---------------- section 2: channels
    el += [PageBreak(), Paragraph("2. TV channel-wise breakdown", s.h2), Paragraph("Ranked by total monitored spend, highest first. Share of wallet = the channel's share of all monitored spend in this selection.", s.small), Spacer(1, 3)]
    has_r = bool(d.get("has_ratings"))
    chs = d.get("channels") or []
    head = ["#", "Channel", "Medium", "Commercial spend", "Value-add spend", "Total monitored", "Commercial spots", "Sponsorship items", "Total spots", "Share of wallet", "Spots per day", "First in break"] + (["GRPs"] if has_r else [])
    rows = [head] + [[str(c["rank"]), _t(c["channel"]), c.get("medium", ""), _n(c.get("commercial_spend")), _n(c.get("value_add_spend")), _n(c.get("spend")), _n(c.get("commercial_spots")), _n(c.get("value_add_items")),
                      _n(c.get("spots")), _n(c.get("sow_pct"), "pct"), _n(c.get("spots_per_day"), "dec"), _n(c.get("fib_pct"), "pct")] + ([_n((c.get("ratings") or {}).get("grps"), "dec")] if has_r else [])
                     for c in chs]
    sm = lambda k: sum((c.get(k) or 0) for c in chs)  # noqa: E731
    rows.append(["", "Total", "", _n(sm("commercial_spend")), _n(sm("value_add_spend")), _n(sm("spend")), _n(sm("commercial_spots")), _n(sm("value_add_items")), _n(sm("spots")), "100.0%", "", ""]
                + ([_n(sum(((c.get("ratings") or {}).get("grps") or 0) for c in chs), "dec")] if has_r else []))
    last = len(rows) - 1
    tot_style = [("FONTNAME", (0, last), (-1, last), "Helvetica-Bold"), ("LINEABOVE", (0, last), (-1, last), 1, colors.HexColor("#1b1d36")), ("BACKGROUND", (0, last), (-1, last), colors.HexColor("#e1e3fb"))]
    num_cols = list(range(3, 12 + (1 if has_r else 0)))
    el.append(_table([[Paragraph(f"<b>{safe(x)}</b>", s.cell) if (i == last and isinstance(x, str) and x) else x for x in r] for i, r in enumerate(rows)],
                     [0.6, 3, 1.2, 2.4, 2.4, 2.4, 1.6, 1.6, 1.5, 1.5, 1.4, 1.4] + ([1.3] if has_r else []), s, brand, tot_style + [("ALIGN", (c, 1), (c, -1), "RIGHT") for c in num_cols]))

    # ---------------- section 3: programmes
    el += [Spacer(1, 8), CondPageBreak(5 * cm), Paragraph("3. Programmes &amp; sponsorship intelligence", s.h2),
           Paragraph(f"{d.get('n_programmes', 0)} programmes, {d.get('sponsored_programmes', 0)} with sponsorship. Programmes with an exclusive sponsorship come first. "
                     f"Classification: {EXCL} = a logo, intro, outro or similar item on at least {rule.get('consistent_share', 50):.0f}% of airing days; {HFR} = more than {rule.get('min_daily', 10)} spots a day, "
                     f"or {rule.get('max_dur', 10)}s or shorter at {rule.get('min_daily', 10)}+ a day.", s.small), Spacer(1, 3)]
    rows = [["Channel", "Programme", "Classification", "Sponsors (spots)", "Sponsorship items", "High-frequency spots", "Commercial spots", "Total spots", "Airing days", "Spots per airing"]]
    style = []
    pgs = (d.get("programmes") or [])[:60]
    for r in pgs:
        cl = [x for x in (EXCL if r.get("exclusive_ads") else (SPNL if r.get("sponsored") else None), HFR if r.get("frequency_ads") else None) if x] or ["Spots only"]
        rows.append([_t(r["channel"]), _t(r["program"]), " + ".join(cl),
                     ", ".join(f"{x['advertiser']} ({x['items']:,})" for x in (r.get("sponsors") or [])[:3]) + (f" +{len(r['sponsors']) - 3} more" if len(r.get("sponsors") or []) > 3 else ""),
                     _n(r.get("value_add_items")), _n(r.get("frequency_spots")), _n(r.get("commercial_spots")), _n(r.get("spots")), _n(r.get("airing_days")), _n(r.get("spots_per_airing"), "dec")])
        if r.get("exclusive_ads"):
            style.append(("TEXTCOLOR", (2, len(rows) - 1), (2, len(rows) - 1), brand))
        if r.get("frequency_spots"):
            style.append(("TEXTCOLOR", (5, len(rows) - 1), (5, len(rows) - 1), FREQ))
    smp = lambda k: sum((r.get(k) or 0) for r in pgs)  # noqa: E731
    rows.append(["Total", "", "", "", _n(smp("value_add_items")), _n(smp("frequency_spots")), _n(smp("commercial_spots")), _n(smp("spots")), "", ""])
    lp = len(rows) - 1
    style += [("FONTNAME", (0, lp), (-1, lp), "Helvetica-Bold"), ("LINEABOVE", (0, lp), (-1, lp), 1, colors.HexColor("#1b1d36")), ("BACKGROUND", (0, lp), (-1, lp), colors.HexColor("#e1e3fb"))] + [("ALIGN", (c, 1), (c, -1), "RIGHT") for c in range(4, 10)]
    el.append(_table(rows, [2.2, 3.0, 3.6, 4.6, 1.5, 1.6, 1.5, 1.2, 1.2, 1.4], s, brand, style))
    if (d.get("n_programmes") or 0) > 60:
        el.append(Paragraph(f"Showing 60 of {d['n_programmes']} programmes.", s.small))
    cl_all = d.get("classified") or []
    if cl_all:
        el += [PageBreak(), Paragraph("Classified ads: exclusive sponsorships and high-frequency reminders", s.h2),
               Paragraph(f"Every sponsorship item and high-frequency ad, by programme ({_n(d.get('n_classified'))} in total, the top {len(cl_all[:60])} shown). Exclusive sponsorships first.", s.small), Spacer(1, 3),
               _class_table(cl_all[:60], s, brand, with_programme=True)]

    # ---------------- drill-down details
    cds, pds = d.get("channel_details") or [], d.get("programme_details") or []
    if cds:
        el += [PageBreak(), Paragraph("Detailed breakdown: channels", s.h2), Paragraph("For each channel: volume and ratings, commercial duration split, and the high-frequency and sponsorship ads behind it.", s.small)]
        for x in cds:
            el += _detail_block(x, _t(x["channel"]), s, brand)
    if pds:
        el += [PageBreak(), Paragraph("Detailed breakdown: programmes", s.h2), Paragraph("The top programmes of section 3, sponsored programmes first.", s.small)]
        for x in pds:
            el += _detail_block(x, f"{_t(x['program'])} on {_t(x['channel'])}", s, brand, title_has_programme=True)
    el += [Spacer(1, 8), Paragraph("Spend is monitored rate-card spend, not invoiced cost. Ratings come from the TVR sheet matched to each spot's channel and 30-minute timeband, when a TVR sheet is loaded.", s.small)]

    footer_txt = safe(f"{agency} | {cname} | Executive negotiation summary | {branding.get('report_footer', '')}")

    def footer(canvas, doc_):
        canvas.saveState(); canvas.setFont("Helvetica", 7); canvas.setFillColor(MUTED)
        canvas.drawString(1.5 * cm, 0.7 * cm, footer_txt[:170]); canvas.drawRightString(PAGE[0] - 1.5 * cm, 0.7 * cm, f"Page {doc_.page}")
        canvas.setFillColor(accent); canvas.rect(0, PAGE[1] - 0.22 * cm, PAGE[0], 0.22 * cm, stroke=0, fill=1); canvas.restoreState()
    doc.build(el, onFirstPage=footer, onLaterPages=footer)
    return buf.getvalue()
