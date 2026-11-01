"""PDF report: reportlab layout with matplotlib charts rendered to images."""
from __future__ import annotations

import io
import logging
import re
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from reportlab.lib import colors  # noqa: E402
from reportlab.lib.pagesizes import A4  # noqa: E402
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet  # noqa: E402
from reportlab.lib.units import cm  # noqa: E402
from reportlab.platypus import Image, KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table as RlTable, TableStyle  # noqa: E402

from .report_data import Report, Table

log = logging.getLogger(__name__)

INDIGO = colors.HexColor("#4F46E5")
MUTED = colors.HexColor("#646A8A")
PALETTE = ["#5b5ce6", "#12a6a0", "#f08a24", "#d6457f", "#3b9ae1", "#8b5cf6", "#c9a30a", "#3ea65a", "#e5484d", "#0b8fb8", "#a16207", "#6b7280"]
REL_COLORS = {"High": "#12a06a", "Medium": "#c27a06", "Low": "#d6364f"}


def safe(s: Any) -> str:
    """Helvetica is Latin-1 only. Replace anything else so text never renders as boxes."""
    t = str(s).replace("\u2014", "-").replace("\u2013", "-").replace("\u2019", "'")
    t = t.encode("latin-1", "replace").decode("latin-1")
    return re.sub(r"[<>&]", lambda m: {"<": "&lt;", ">": "&gt;", "&": "&amp;"}[m.group()], t)


def fmt_val(v: Any, f: str | None) -> str:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return ""
    if isinstance(v, (int, float, np.number)):
        if f == "lkr":
            return f"LKR {v:,.0f}"
        if f == "pct":
            return f"{v * 100:.1f}%"
        if f == "int":
            return f"{v:,.0f}"
        if f == "dec1":
            return f"{v:,.1f}"
        return f"{v:,.2f}" if isinstance(v, float) and abs(v) < 100000 else f"{v:,.0f}"
    return str(v)


def _img(fig, width_cm: float = 17.5) -> Image:
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=150, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    buf.seek(0)
    w, h = fig.get_size_inches()
    img = Image(buf)
    ratio = img.imageHeight / img.imageWidth
    img.drawWidth, img.drawHeight = width_cm * cm, width_cm * cm * ratio
    return img


def _style_ax(ax) -> None:
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    ax.grid(axis="y", alpha=0.25)


def _colors(rep: Report, names: list[str]) -> list[str]:
    order = {n: i for i, n in enumerate(rep.advertiser_order)}
    out = []
    for n in names:
        out.append("#9aa0b8" if n == "Others" else PALETTE[order.get(n, len(order) + names.index(n)) % len(PALETTE)])
    return out


def chart_sov(rep: Report) -> Image | None:
    s = rep.dash.get("sov_weekly")
    if not s or not s["weeks"]:
        return None
    names = [a["name"] for a in s["advertisers"]]
    data = np.array([a["spend"] for a in s["advertisers"]], dtype=float)
    tot = data.sum(axis=0); tot[tot == 0] = np.nan
    share = np.nan_to_num(data / tot * 100)
    fig, ax = plt.subplots(figsize=(8, 3.2))
    ax.stackplot(range(len(s["weeks"])), share, labels=names, colors=_colors(rep, names), alpha=0.9)
    ax.set_xticks(range(0, len(s["weeks"]), max(1, len(s["weeks"]) // 8))); ax.set_xticklabels([s["weeks"][i][5:] for i in range(0, len(s["weeks"]), max(1, len(s["weeks"]) // 8))], fontsize=7)
    ax.set_ylim(0, 100); ax.set_ylabel("Share of spend (%)", fontsize=8); ax.set_title("Share of voice over time (weekly)", fontsize=10, loc="left")
    ax.legend(fontsize=6, ncol=4, loc="upper center", bbox_to_anchor=(0.5, -0.12), frameon=False); _style_ax(ax)
    return _img(fig)


def chart_bar(rep: Report, rows: list[dict], label: str, value: str, title: str, color_by_adv: bool = False, limit: int = 10, fmt: str = "{:,.0f}") -> Image | None:
    rows = rows[:limit]
    if not rows:
        return None
    names = [str(r[label]) for r in rows][::-1]
    vals = [r[value] for r in rows][::-1]
    fig, ax = plt.subplots(figsize=(8, max(2.2, 0.38 * len(rows) + 0.8)))
    ax.barh(names, vals, color=_colors(rep, names) if color_by_adv else PALETTE[0])
    ax.set_title(title, fontsize=10, loc="left"); ax.tick_params(labelsize=7); ax.grid(axis="x", alpha=0.25)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    from matplotlib.ticker import FuncFormatter
    ax.xaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{v / 1e6:.1f}M" if abs(v) >= 1e6 else f"{v:,.0f}" if abs(v) >= 100 else f"{v:g}"))
    for i, v in enumerate(vals):
        ax.text(v, i, " " + fmt.format(v), va="center", fontsize=6.5)
    return _img(fig)


def chart_heat(m: dict, title: str, fmt: str = "{:,.0f}") -> Image | None:
    if not m or not m.get("rows"):
        return None
    vals = np.array([[np.nan if v is None else v for v in r] for r in m["values"]], dtype=float)
    fig, ax = plt.subplots(figsize=(8, max(2.0, 0.5 * len(m["rows"]) + 1.0)))
    im = ax.imshow(vals, cmap="Purples", aspect="auto")
    ax.set_xticks(range(len(m["cols"]))); ax.set_xticklabels(m["cols"], fontsize=7, rotation=30, ha="right"); ax.set_yticks(range(len(m["rows"]))); ax.set_yticklabels(m["rows"], fontsize=7)
    lo, hi = (np.nanmin(vals), np.nanmax(vals)) if np.isfinite(vals).any() else (0, 1)
    for i in range(vals.shape[0]):
        for j in range(vals.shape[1]):
            if not np.isnan(vals[i, j]):
                ax.text(j, i, fmt.format(vals[i, j]), ha="center", va="center", fontsize=6.5, color="white" if (vals[i, j] - lo) / ((hi - lo) or 1) > 0.55 else "#1b1d36")
    ax.set_title(title, fontsize=10, loc="left")
    return _img(fig)


def chart_forecast(r: dict) -> Image:
    h, f = r["history"], r["forecast"]
    keep = min(len(h["dates"]), 60)
    hx = list(range(keep)); fx = list(range(keep, keep + len(f["dates"])))
    fig, ax = plt.subplots(figsize=(8, 3.2))
    ax.plot(hx, h["values"][-keep:], color="#1b1d36", lw=1.6, label="History")
    ax.fill_between([hx[-1]] + fx, [h["values"][-1]] + f["p10"], [h["values"][-1]] + f["p90"], color="#5b5ce6", alpha=0.18, label="Low case to high case")
    ax.plot([hx[-1]] + fx, [h["values"][-1]] + f["p50"], color="#5b5ce6", ls="--", lw=1.6, label="Forecast (P50)")
    bt = r.get("backtest")
    if bt:
        pos = [keep - len(bt["dates"]) + i for i in range(len(bt["dates"]))]
        ax.plot(pos, bt["pred"], color="#f08a24", ls=":", marker="o", ms=3, lw=1.2, label="Backtest")
    for a in r.get("anomalies", []):
        if a["date"] in h["dates"][-keep:]:
            i = h["dates"][-keep:].index(a["date"]); ax.plot(i, a["value"], marker="^", color="#d6364f", ms=6)
    labels = h["dates"][-keep:] + f["dates"]
    ticks = list(range(0, len(labels), max(1, len(labels) // 8)))
    ax.set_xticks(ticks); ax.set_xticklabels([labels[i][5:] for i in ticks], fontsize=7)
    ax.set_title(f"{r['entity']}: history and forecast", fontsize=10, loc="left"); ax.legend(fontsize=7, frameon=False, ncol=4); _style_ax(ax); ax.tick_params(labelsize=7)
    return _img(fig)


def _table(t: Table, max_rows: int, width: float = 17.5 * cm) -> RlTable | None:
    if t.df.empty:
        return None
    df = t.df.head(max_rows)
    cols = [str(c) for c in df.columns]
    n = len(cols)
    fs = 7.5 if n <= 6 else 6.5 if n <= 9 else 5.5
    cell = ParagraphStyle("c", fontSize=fs, leading=fs + 2, wordWrap="CJK" if False else "LTR")
    hdr = ParagraphStyle("h", parent=cell, textColor=colors.white, fontName="Helvetica-Bold")
    data = [[Paragraph(safe(c), hdr) for c in cols]]
    for row in df.itertuples(index=False):
        data.append([Paragraph(safe(fmt_val(v, t.fmt.get(cols[j]) or ("dec2" if t.matrix else None))), cell) for j, v in enumerate(row)])
    long_text = {"Alert", "Statement", "Why", "Creative", "Channels"}
    weights = [3.0 if c in long_text else 1.4 if j == 0 else 1.0 for j, c in enumerate(cols)]
    tot = sum(weights)
    tbl = RlTable(data, colWidths=[width * w / tot for w in weights], repeatRows=1)
    st = [("BACKGROUND", (0, 0), (-1, 0), INDIGO), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f4f5fb")]),
          ("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.HexColor("#e5e7f2")), ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]
    if "Reliability" in cols:
        j = cols.index("Reliability")
        for i, v in enumerate(df["Reliability"], 1):
            if v in REL_COLORS:
                st.append(("TEXTCOLOR", (j, i), (j, i), colors.HexColor(REL_COLORS[v])))
    tbl.setStyle(TableStyle(st))
    return tbl


def chart_lines(title: str, labels: list[str], series: list[tuple[str, list, str, str]], ylabel: str = "", target: float | None = None,
                band: tuple[list, list] | None = None, band_from: int = 0) -> Image:
    """Generic line chart: series = [(label, values, colour, style)]."""
    fig, ax = plt.subplots(figsize=(8, 3.2))
    x = list(range(len(labels)))
    if band:
        ax.fill_between(x[band_from:band_from + len(band[0])], band[0], band[1], color="#5b5ce6", alpha=0.18, label="Low case to high case")
    for lab, vals, col, ls in series:
        xs = [i for i, v in zip(x, vals) if v is not None]
        ys = [v for v in vals if v is not None]
        ax.plot(xs, ys, color=col, ls=ls, lw=1.8, label=lab)
    if target is not None:
        ax.axhline(target, color="#d6364f", ls=":", lw=1.2, label="Target")
    ticks = list(range(0, len(labels), max(1, len(labels) // 8)))
    ax.set_xticks(ticks); ax.set_xticklabels([labels[i][5:] if len(labels[i]) >= 10 else labels[i] for i in ticks], fontsize=7)
    ax.set_title(title, fontsize=10, loc="left"); ax.set_ylabel(ylabel, fontsize=8); ax.legend(fontsize=7, frameon=False, ncol=4); _style_ax(ax); ax.tick_params(labelsize=7)
    return _img(fig)


def chart_scenarios(sc: dict) -> Image:
    rows = sc["scenarios"]
    fig, ax = plt.subplots(figsize=(8, 3.0))
    names = [r["scenario"] for r in rows]
    p50 = [r["kpi_p50"] for r in rows]
    err = [[r["kpi_p50"] - r["kpi_p10"] for r in rows], [r["kpi_p90"] - r["kpi_p50"] for r in rows]]
    ax.bar(names, p50, color=PALETTE[:len(rows)], yerr=err, capsize=4, ecolor="#646a8a")
    for i, r in enumerate(rows):
        if r.get("ratio_p50"):
            ax.text(i, r["kpi_p90"], f"\n{sc['params'].get('ratio_label', 'Cost per result')}\nLKR {r['ratio_p50']:,.0f}", ha="center", va="bottom", fontsize=6.5)
    ax.set_title("Expected results by budget scenario (most likely; whiskers show low to high case)", fontsize=10, loc="left"); _style_ax(ax); ax.tick_params(labelsize=7)
    ax.margins(y=0.3)
    return _img(fig)


def chart_pacing(pc: dict) -> Image:
    cum, pr = pc["cumulative"], pc["projection"]
    labels = cum["dates"] + pr["dates"]
    n = len(cum["dates"])
    lastv = cum["values"][-1] if cum["values"] else 0
    pad = lambda arr: [None] * (n - 1) + [lastv] + list(arr)
    return chart_lines(f"{pc['metric_label']}: cumulative actual and projection", labels,
                       [("Actual", list(cum["values"]) + [None] * len(pr["dates"]), "#1b1d36", "-"), ("Projection (P50)", pad(pr["p50"]), "#5b5ce6", "--")],
                       target=pc["target"], band=([lastv] + list(pr["p10"]), [lastv] + list(pr["p90"])) if pr["dates"] else None, band_from=n - 1)


def chart_kpi_trend(dash: dict) -> Image | None:
    tr = dash.get("trend")
    if not tr or not tr["dates"]:
        return None
    main = primary_series(dash)
    return chart_lines(f"{main['label']} trend ({tr['granularity']})", tr["dates"], [(main["label"], main["values"], PALETTE[0], "-")])


def primary_series(dash: dict) -> dict:
    """The main result metric (first summed, non-currency KPI) for trend charts."""
    tr = dash["trend"]
    keys = set(dash.get("targets") or [])
    return next((s for s in tr["series"] if s["key"] in keys), None) or next((s for s in tr["series"] if s["unit"] != "currency"), tr["series"][0])


def _logo(data: tuple[bytes, str] | None, h_cm: float = 1.6) -> Image | None:
    if not data:
        return None
    try:
        img = Image(io.BytesIO(data[0]))
        r = img.imageWidth / img.imageHeight
        img.drawHeight, img.drawWidth = h_cm * cm, min(h_cm * cm * r, 6 * cm)
        return img
    except Exception:  # noqa: BLE001 - a bad logo must not break the report
        return None


PDF_TABLES = {
    "lmrb": ["Spend by advertiser", "Spend by channel", "Spend by daypart", "Flighting", "Creatives", "Pricing heatmap", "Position strategy", "Alerts"],
    "tv": ["Top programmes", "Channels", "Categories", "Consistency", "Slot opportunity"],
    "kpi": ["Segments", "Driver effects"],
}


def build_pdf(rep: Report) -> bytes:
    from .narrative import METHODOLOGY, story
    brand = colors.HexColor(rep.branding.get("primary_color") or "#4F46E5")
    accent = colors.HexColor(rep.client.get("brand_color") or "#5B5CE6")
    agency = rep.branding.get("agency_name") or "Media Radar"
    client = rep.client.get("name") or "Client"
    st = story(rep)
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=1.5 * cm, rightMargin=1.5 * cm, topMargin=1.6 * cm, bottomMargin=1.5 * cm, title=safe(rep.title), author=safe(agency))
    ss = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=ss["Title"], textColor=brand, fontSize=26, leading=30, alignment=0, spaceAfter=6)
    h2 = ParagraphStyle("h2", parent=ss["Heading2"], textColor=brand, fontSize=15, spaceBefore=12, spaceAfter=6)
    h3 = ParagraphStyle("h3", parent=ss["Heading3"], textColor=colors.HexColor("#1b1d36"), fontSize=11, spaceBefore=8, spaceAfter=3)
    body = ParagraphStyle("b", parent=ss["BodyText"], fontSize=9, leading=12.5)
    lead = ParagraphStyle("lead", parent=body, fontSize=12, leading=16, textColor=colors.HexColor("#1b1d36"))
    small = ParagraphStyle("s", parent=body, fontSize=7.5, leading=10, textColor=MUTED)
    bullet = lambda t: Paragraph(f"&bull;&nbsp; {safe(t)}", body)
    el: list = []

    # ---------------- cover
    la, lc = _logo(rep.logos.get("agency")), _logo(rep.logos.get("client"))
    lt = RlTable([[la or Paragraph(f"<b>{safe(agency)}</b>", lead), lc or Paragraph(f"<b>{safe(client)}</b>", lead)]], colWidths=[9 * cm, 9 * cm])
    lt.setStyle(TableStyle([("ALIGN", (1, 0), (1, 0), "RIGHT"), ("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
    band = RlTable([[""]], colWidths=[18 * cm], rowHeights=[0.25 * cm]); band.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), accent)]))
    el += [lt, Spacer(1, 3.2 * cm), band, Spacer(1, 0.6 * cm), Paragraph(safe(rep.title), h1),
           Paragraph(f"Prepared for <b>{safe(client)}</b> by {safe(agency)}", lead), Spacer(1, 0.4 * cm), Paragraph(safe(rep.card), body), Spacer(1, 1.2 * cm)]
    cover = [["Period", rep.date_range or "n/a"], ["Generated", rep.generated], ["Data sources", ", ".join(rep.source_files[-4:]) + (" and earlier files" if len(rep.source_files) > 4 else "")],
             ["Filters", "; ".join(rep.filters)], ["Forecast model", "Media Radar forecast engine" if not rep.forecast or rep.forecast.get("backend") == "timesfm" else "Statistical fallback (main forecast model unavailable)"]]
    ct = RlTable([[Paragraph(f"<b>{a}</b>", body), Paragraph(safe(b), body)] for a, b in cover], colWidths=[3.6 * cm, 14.4 * cm])
    ct.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.HexColor("#e5e7f2")), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    el += [ct] + [Paragraph(f"Note: {safe(n)}", small) for n in rep.notes] + [PageBreak()]

    # ---------------- executive summary
    el += [Paragraph("Executive summary", h2), Paragraph(safe(st["headline"]), lead), Spacer(1, 6),
           Paragraph("Written by Gemini from the numbers in this report." if st["source"] == "gemini" else "Automated summary built from the numbers in this report.", small), Spacer(1, 8)]
    tiles = [[Paragraph(f"<font size=7 color='#646A8A'>{safe(l.upper())}</font><br/><font size=13><b>{safe(fmt_val(v, f))}</b></font>", body) for (l, v, f) in rep.kpis[i:i + 3]] for i in range(0, min(len(rep.kpis), 9), 3)]
    for row in tiles:
        row += [""] * (3 - len(row))
    if tiles:
        kt = RlTable(tiles, colWidths=[6 * cm] * 3)
        kt.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.25, colors.HexColor("#e5e7f2")), ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#e5e7f2")),
                                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8f9fe")), ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
        el.append(kt)
    for title, items in (("Key findings", st["findings"]), ("Recommended actions", st["actions"]), ("Opportunities", st.get("opportunities", [])),
                         ("Threats", st.get("threats", [])), ("Watch-outs", st["watch"])):
        if items:
            el += [Paragraph(title, h3)] + [bullet(i) for i in items]
    el.append(PageBreak())

    by = {t.name: t for t in rep.tables}
    # ---------------- forecast
    if rep.forecast:
        fc = rep.forecast
        p = fc["params"]
        el += [Paragraph("Forecast outlook", h2),
               Paragraph(safe(f"{fc['results'][0].get('metric_label', p.get('metric'))} by {p.get('entity_type')}, {p.get('granularity')} data, {p.get('horizon_days')}-day horizon. "
                              "Shaded bands show the range from the low case to the high case."), body)]
        t = by.get("Forecast summary")
        if t is not None and len(t.df):
            cols = [c for c in ("Entity", "Reliability", "Trend", "Change vs recent", "Expected next weeks", "Burst windows", "sMAPE") if c in t.df.columns]
            el += [Spacer(1, 4), _table(Table(t.name, t.df[cols], t.fmt), 12)]
        for r in fc["results"][:4]:
            el += [Spacer(1, 8), Paragraph(f"{safe(r['entity'])}: reliability <font color='{REL_COLORS[r['reliability']['level']]}'><b>{r['reliability']['level']}</b></font>", h3), chart_forecast(r)]
            pk = (r.get("peaks") or {}).get("peaks") or []
            extra = [f"Demand peak expected around {pk[0]['date']}; be live by {pk[0]['launch_by']}." ] if pk else []
            extra += [b["text"] for b in (r.get("band_breaches") or [])[:2]]
            el += [Paragraph(safe(x), small) for x in extra]
        el.append(PageBreak())
    # ---------------- scenarios
    if rep.scenarios:
        sc = rep.scenarios
        el += [Paragraph("Budget scenarios", h2), Paragraph(safe(f"What {sc['params'].get('driver_label', 'spend')} buys over the next {sc['params'].get('horizon_points')} {sc['params'].get('granularity')} periods. "
                                                               f"Method: {'Forecast engine with spend as a covariate' if sc['method'] == 'timesfm_xreg' else 'linear driver model with seasonal smoothing'}."), body),
               chart_scenarios(sc)]
        rows = [["Scenario", "Planned spend", "Results P50", "P10 to P90", sc["params"].get("ratio_label", "Cost per result"), "Cost per extra result"]]
        for r in sc["scenarios"]:
            rows.append([r["scenario"], f"LKR {r['driver_total']:,.0f}", f"{r['kpi_p50']:,.0f}", f"{r['kpi_p10']:,.0f} to {r['kpi_p90']:,.0f}",
                         f"LKR {r['ratio_p50']:,.0f}" if r.get("ratio_p50") else "n/a", f"LKR {r['marginal_ratio']:,.0f}" if r.get("marginal_ratio") else ""])
        el.append(_simple_table(rows, brand))
        el += [Paragraph(safe(w), small) for w in sc.get("warnings", [])[:3]]
    # ---------------- pacing
    if rep.pacing:
        pc = rep.pacing
        el += [Paragraph("Pacing", h2), Paragraph(safe(f"{pc['metric_label']} for {pc['entity']}, flight {pc['start']} to {pc['end']}. Status: {pc['status']}. "
                                                    f"Projected end total {pc['projected_p50']:,.0f} (range {pc['projected_p10']:,.0f} to {pc['projected_p90']:,.0f}) against a target of {pc['target']:,.0f}."), body),
               chart_pacing(pc)]
    for sv in rep.saved:
        res = sv["result"]
        el += [Paragraph(f"Saved {safe(sv['ftype'])}: {safe(sv['title'])}", h2), Paragraph(f"Saved on {safe(str(sv['created_at'])[:16].replace('T', ' '))}. Shows the data as it was then.", small)]
        if sv["ftype"] == "forecast" and res.get("results"):
            el.append(chart_forecast(res["results"][0]))
        elif sv["ftype"] == "scenarios" and res.get("scenarios"):
            el.append(chart_scenarios(res))
        elif sv["ftype"] == "pacing" and res.get("cumulative"):
            el.append(chart_pacing(res))
    if rep.scenarios or rep.pacing or rep.saved:
        el.append(PageBreak())

    # ---------------- workspace insights
    d = rep.dash
    el.append(Paragraph({"lmrb": "Competitive landscape", "tv": "Audience and programming", "kpi": "Client performance"}[rep.kind], h2))
    charts: list[Image | None] = []
    if rep.kind == "lmrb":
        charts = [chart_sov(rep), chart_bar(rep, d["by_advertiser"], "name", "spend", "Spend by advertiser (LKR)", True)]
        if d.get("grp"):
            charts += [chart_bar(rep, d["grp"]["by_advertiser"], "name", "grps", "GRPs by advertiser", True, 10, "{:,.1f}"),
                       chart_heat(d["grp"]["cprp_heatmap"], "CPRP by channel and daypart (LKR)")]
        charts.append(chart_heat(d["pricing"]["heatmap"], "Median cost per second by channel and daypart (LKR)"))
    elif rep.kind == "tv":
        charts = [chart_bar(rep, d["top_programmes"], "program", "avg_tvr", "Top programmes by average TVR", False, 10, "{:.2f}"),
                  chart_heat(d["heat_daypart"], "Average TVR by channel and daypart", "{:.2f}"), chart_heat(d.get("heat_timebelt"), "Average TVR by time-belt and day", "{:.2f}")]
    else:
        charts = [chart_kpi_trend(d)]
        if d.get("segments"):
            first = next((m for m in d["metrics"] if m["agg"] == "sum"), None)
            if first:
                charts.append(chart_bar(rep, [{"segment": r["segment"], "v": r[first["key"]] or 0} for r in d["segments"]], "segment", "v", f"{first['label']} by segment", False))
    for img in charts:
        if img is not None:
            el += [img, Spacer(1, 6)]
    for name in PDF_TABLES[rep.kind]:
        t = by.get(name)
        if t is None:
            continue
        tbl = _table(t, t.pdf_rows if not t.matrix else 12)
        if tbl is None:
            continue
        block: list = [Paragraph(safe(t.name), h3)] + ([Paragraph(safe(t.note), small)] if t.note else []) + [Spacer(1, 3), tbl]
        el.append(KeepTogether(block))

    # ---------------- appendix
    el += [PageBreak(), Paragraph("Appendix: methodology and reliability", h2)] + [bullet(m) for m in METHODOLOGY]
    if rep.forecast:
        rows = [["Entity", "Reliability", "History", "sMAPE", "MASE", "Inside band", "Baseline sMAPE"]]
        for r in rep.forecast["results"]:
            bt = r.get("backtest") or {}
            m, b = bt.get("model", {}), bt.get("baseline", {})
            rows.append([r["entity"], r["reliability"]["level"], f"{r['n_points']} {r['granularity']}", "n/a" if m.get("smape") is None else f"{m['smape']:.0f}%",
                         "n/a" if m.get("mase") is None else f"{m['mase']:.2f}", "n/a" if m.get("coverage") is None else f"{m['coverage']:.0f}%", "n/a" if b.get("smape") is None else f"{b['smape']:.0f}%"])
        el += [Paragraph("Backtest results", h3), _simple_table(rows, brand)]
    el += [Paragraph("Data and filters", h3), bullet("Sources: " + ", ".join(rep.source_files)), bullet("Filters: " + "; ".join(rep.filters))]
    if rep.ai:
        el.append(bullet("The executive summary was drafted by Gemini from aggregated numbers only and reviewed against the tables in this report."))
    el += [Spacer(1, 8), Paragraph(safe(rep.branding.get("disclaimer", "")), small)]
    footer_txt = safe(f"{agency} | {client} | {rep.branding.get('report_footer', '')}")

    def footer(canvas, doc_):
        canvas.saveState(); canvas.setFont("Helvetica", 7); canvas.setFillColor(MUTED)
        canvas.drawString(1.5 * cm, 0.8 * cm, footer_txt[:150]); canvas.drawRightString(A4[0] - 1.5 * cm, 0.8 * cm, f"Page {doc_.page}")
        canvas.setFillColor(accent); canvas.rect(0, A4[1] - 0.25 * cm, A4[0], 0.25 * cm, stroke=0, fill=1); canvas.restoreState()
    doc.build(el, onFirstPage=footer, onLaterPages=footer)
    return buf.getvalue()


def _simple_table(rows: list[list[str]], head: colors.Color) -> RlTable:
    cell = ParagraphStyle("c", fontSize=7.5, leading=9.5)
    hdr = ParagraphStyle("h", parent=cell, textColor=colors.white, fontName="Helvetica-Bold")
    data = [[Paragraph(safe(c), hdr if i == 0 else cell) for c in r] for i, r in enumerate(rows)]
    t = RlTable(data, colWidths=[18 * cm / len(rows[0])] * len(rows[0]), repeatRows=1)
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), head), ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f4f5fb")]),
                           ("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.HexColor("#e5e7f2")), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    return t
