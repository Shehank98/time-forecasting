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
    ax.fill_between([hx[-1]] + fx, [h["values"][-1]] + f["p10"], [h["values"][-1]] + f["p90"], color="#5b5ce6", alpha=0.18, label="P10 to P90")
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


def build_pdf(rep: Report) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=1.5 * cm, rightMargin=1.5 * cm, topMargin=1.5 * cm, bottomMargin=1.5 * cm, title=safe(rep.title), author="Media Radar")
    ss = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=ss["Title"], textColor=INDIGO, fontSize=24, alignment=0, spaceAfter=6)
    h2 = ParagraphStyle("h2", parent=ss["Heading2"], textColor=colors.HexColor("#1b1d36"), spaceBefore=10, spaceAfter=4)
    body = ParagraphStyle("b", parent=ss["BodyText"], fontSize=9, leading=12)
    small = ParagraphStyle("s", parent=body, fontSize=7.5, textColor=MUTED)
    el: list = [Paragraph(safe(rep.title), h1), Paragraph(safe(rep.card), h2), Spacer(1, 6)]
    cover = [["Date range", safe(rep.date_range or "n/a")], ["Generated", safe(rep.generated)], ["Data source file(s)", safe(", ".join(rep.source_files))], ["Filters applied", safe("; ".join(rep.filters))]]
    ct = RlTable([[Paragraph(f"<b>{a}</b>", body), Paragraph(b, body)] for a, b in cover], colWidths=[4 * cm, 13.5 * cm])
    ct.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.HexColor("#e5e7f2")), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    el += [ct]
    for n in rep.notes:
        el.append(Paragraph(f"Note: {safe(n)}", small))
    el += [Spacer(1, 14), Paragraph("KPI summary", h2)]
    tiles = [[Paragraph(f"<font size=7 color='#646A8A'>{safe(l.upper())}</font><br/><font size=13><b>{safe(fmt_val(v, f))}</b></font>", body) for (l, v, f) in rep.kpis[i:i + 3]] for i in range(0, len(rep.kpis), 3)]
    for row in tiles:
        row += [""] * (3 - len(row))
    kt = RlTable(tiles, colWidths=[5.8 * cm] * 3)
    kt.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.25, colors.HexColor("#e5e7f2")), ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#e5e7f2")), ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8f9fe")), ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
    el.append(kt)
    if rep.ai:
        el += [Paragraph("Executive summary (Gemini)", h2), Paragraph(safe(rep.ai["executive_summary"]["statement"]), body), Paragraph("Recommended actions", h2)]
        for a in rep.ai.get("recommended_actions", []):
            el.append(Paragraph(f"&bull; {safe(a['statement'])} <font color='#646A8A'>({safe(a['confidence'])} confidence)</font>", body))
        for c in rep.ai.get("data_caveats", [])[:4]:
            el.append(Paragraph(f"Caveat: {safe(c)}", small))
    el.append(PageBreak())
    by = {t.name: t for t in rep.tables}
    d = rep.dash
    charts: list[tuple[str, Image | None]] = []
    if rep.kind == "lmrb":
        charts = [("sov", chart_sov(rep)), ("adv", chart_bar(rep, d["by_advertiser"], "name", "spend", "Spend by advertiser (LKR)", True)),
                  ("heat", chart_heat(d["pricing"]["heatmap"], "Channel x daypart: median cost per second (LKR)"))]
    else:
        charts = [("top", chart_bar(rep, d["top_programmes"], "program", "avg_tvr", "Top programmes by average TVR", False, 10, "{:.2f}")),
                  ("heat", chart_heat(d["heat_daypart"], "Channel x daypart: average TVR", "{:.2f}"))]
    el.append(Paragraph("Charts", h2))
    for _, img in charts:
        if img is not None:
            el += [img, Spacer(1, 8)]
    for t in rep.tables:
        if t.name.startswith("FC chart") or t.name == "SOV weekly spend" or t.name == "Forecast values":
            continue
        tbl = _table(t, t.pdf_rows if not t.matrix else 12)
        if tbl is None:
            continue
        block: list = [Paragraph(safe(t.name), h2)]
        if t.note:
            block.append(Paragraph(safe(t.note), small))
        block += [Spacer(1, 3), tbl]
        if t.name == "Forecast summary" and rep.forecast:
            el.append(PageBreak())
            block.insert(1, Paragraph(f"Reliability badge per entity is based on history length and a backtest against a seasonal naive baseline. Model: {'TimesFM 2.5' if rep.forecast['backend'] == 'timesfm' else 'statistical fallback'}.", small))
        el.append(KeepTogether(block))
        if t.name == "Forecast summary" and rep.forecast:
            for r in rep.forecast["results"][:3]:
                el += [Spacer(1, 8), Paragraph(f"{safe(r['entity'])} - reliability <font color='{REL_COLORS[r['reliability']['level']]}'><b>{r['reliability']['level']}</b></font>", body), chart_forecast(r)]
            fv = by.get("Forecast values")
            if fv is not None:
                ft = _table(fv, 24)
                if ft:
                    el += [Paragraph("Forecast table (P10, P50, P90)", h2), ft]
    if rep.ai:
        el += [PageBreak(), Paragraph("AI insights (Gemini)", h2), Paragraph("Generated from aggregated numbers only. Check the evidence in the app before acting.", small)]
        for key, label in [("competitor_moves", "Competitor moves"), ("threats", "Threats"), ("opportunities", "Opportunities"), ("predicted_behaviour", "Predicted behaviour")]:
            if rep.ai.get(key):
                el.append(Paragraph(label, h2))
                el += [Paragraph(f"&bull; {safe(i['statement'])}", body) for i in rep.ai[key]]

    def footer(canvas, doc_):
        canvas.saveState(); canvas.setFont("Helvetica", 7); canvas.setFillColor(MUTED)
        canvas.drawString(1.5 * cm, 0.8 * cm, safe(f"{rep.card} | generated {rep.generated}")); canvas.drawRightString(A4[0] - 1.5 * cm, 0.8 * cm, f"Page {doc_.page}"); canvas.restoreState()
    doc.build(el, onFirstPage=footer, onLaterPages=footer)
    return buf.getvalue()
