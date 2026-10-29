"""Excel report with native tables, number formats, frozen panes and native openpyxl charts."""
from __future__ import annotations

import io
import logging
import re
from typing import Any

import pandas as pd
from openpyxl import Workbook
from openpyxl.chart import AreaChart, BarChart, LineChart, PieChart, Reference
from openpyxl.chart.label import DataLabelList
from openpyxl.formatting.rule import ColorScaleRule
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.table import Table as XlTable, TableStyleInfo

from .report_data import Report, Table

log = logging.getLogger(__name__)

HEADER_FILL = PatternFill("solid", fgColor="4F46E5")
HEADER_FONT = Font(bold=True, color="FFFFFF")
NUMFMT = {"lkr": '"LKR" #,##0', "int": "#,##0", "pct": "0.0%", "dec1": "#,##0.0", "dec2": "#,##0.00", "text": "@"}
PALETTE = ["5B5CE6", "12A6A0", "F08A24", "D6457F", "3B9AE1", "8B5CF6", "C9A30A", "3EA65A", "E5484D", "0B8FB8", "A16207", "6B7280"]
BAD_SHEET = re.compile(r"[\[\]\:\*\?\/\\]")


def _sheet_name(wb: Workbook, name: str) -> str:
    base = BAD_SHEET.sub(" ", name)[:31].strip() or "Sheet"
    n, out = 1, base
    while out in wb.sheetnames:
        n += 1
        out = f"{base[:28]} {n}"
    return out


def _autowidth(ws, max_width: int = 60) -> None:
    widths: dict[int, int] = {}
    for row in ws.iter_rows():
        for c in row:
            if c.value is None:
                continue
            v = c.value
            ln = len(f"{v:,.2f}") if isinstance(v, float) else len(str(v))
            widths[c.column] = max(widths.get(c.column, 8), min(ln + 2, max_width))
    for col, w in widths.items():
        ws.column_dimensions[get_column_letter(col)].width = w


def _put(ws, row: int, col: int, value: Any):
    """Write a cell. Text from uploaded files that looks like a formula is stored as plain text, never executed."""
    cell = ws.cell(row=row, column=col, value=_clean(value))
    if cell.data_type == "f":
        cell.data_type = "s"
    return cell


def _clean(v: Any) -> Any:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    if hasattr(v, "item"):
        return v.item()
    return v


def _write_df(ws, df: pd.DataFrame, header_row: int, fmt: dict[str, str], as_table: bool, table_id: int, default_fmt: str | None = None) -> int:
    """Write the frame and return the last row. Creates a native Excel table when asked."""
    cols = [str(c) for c in df.columns]
    for j, c in enumerate(cols, 1):
        cell = _put(ws, header_row, j, c)
        cell.fill, cell.font = HEADER_FILL, HEADER_FONT
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    for i, row in enumerate(df.itertuples(index=False), header_row + 1):
        for j, v in enumerate(row, 1):
            cell = _put(ws, i, j, v)
            f = fmt.get(cols[j - 1]) or default_fmt
            if f and isinstance(cell.value, (int, float)):
                cell.number_format = NUMFMT[f]
    last = header_row + len(df)
    if as_table and len(df):
        t = XlTable(displayName=f"tbl_{table_id}", ref=f"A{header_row}:{get_column_letter(len(cols))}{last}")
        t.tableStyleInfo = TableStyleInfo(name="TableStyleMedium2", showRowStripes=True)
        ws.add_table(t)
    elif not as_table:
        ws.auto_filter.ref = f"A{header_row}:{get_column_letter(len(cols))}{last}"
    return last


def _add_chart(ws, spec: dict, df: pd.DataFrame, header_row: int, last: int) -> None:
    cols = [str(c) for c in df.columns]
    cat_i = cols.index(spec["cat"]) + 1
    n_last = min(last, header_row + spec["limit"]) if spec.get("limit") else last
    kind = spec["type"]
    if kind == "bar":
        ch = BarChart(); ch.type = "bar" if spec.get("horizontal") else "col"
    elif kind == "pie":
        ch = PieChart(); ch.dataLabels = DataLabelList(); ch.dataLabels.showPercent = True
    elif kind == "area":
        ch = AreaChart(); ch.grouping = "percentStacked" if spec.get("stacked_pct") else "standard"
    else:
        ch = LineChart()
    ch.title = spec["title"]; ch.height, ch.width = 9, 18
    for k, name in enumerate(spec["vals"]):
        ci = cols.index(name) + 1
        ch.add_data(Reference(ws, min_col=ci, min_row=header_row, max_row=n_last), titles_from_data=True)
    ch.set_categories(Reference(ws, min_col=cat_i, min_row=header_row + 1, max_row=n_last))
    if kind != "pie":
        for k, s in enumerate(ch.series):
            color = PALETTE[k % len(PALETTE)]
            if spec.get("forecast_bands"):
                color = {"History": "1B1D36", "P10": "9A9CF6", "P50": "5B5CE6", "P90": "9A9CF6"}.get(spec["vals"][k], color)
                s.graphicalProperties.line.solidFill = color
                s.graphicalProperties.line.width = 22000 if spec["vals"][k] in ("History", "P50") else 12000
                if spec["vals"][k] == "P50":
                    s.graphicalProperties.line.dashStyle = "dash"
                s.smooth = False
            elif kind == "line":
                s.graphicalProperties.line.solidFill = color; s.smooth = False
            else:
                s.graphicalProperties.solidFill = color
        if kind == "bar" and len(spec["vals"]) == 1:
            ch.legend = None
    anchor = f"{get_column_letter(len(cols) + 2)}{header_row}"
    ws.add_chart(ch, anchor)


def _sheet_for_table(wb: Workbook, t: Table, idx: int) -> None:
    ws = wb.create_sheet(_sheet_name(wb, t.name))
    ws["A1"] = t.name; ws["A1"].font = Font(bold=True, size=14)
    ws["A2"] = t.note; ws["A2"].font = Font(italic=True, color="646A8A")
    header_row = 4
    if t.df.empty:
        ws["A4"] = "No data for the current filters."
        return
    default = None
    if t.matrix:
        default = "dec2" if t.name.lower().startswith("heat") else "int"
    last = _write_df(ws, t.df, header_row, t.fmt, as_table=not t.matrix, table_id=idx, default_fmt=default)
    if t.matrix and last > header_row and len(t.df.columns) > 1:
        rng = f"B{header_row + 1}:{get_column_letter(len(t.df.columns))}{last}"
        ws.conditional_formatting.add(rng, ColorScaleRule(start_type="min", start_color="EEF0FF", end_type="max", end_color="5B5CE6"))
    ws.freeze_panes = ws.cell(row=header_row + 1, column=2 if t.matrix else 1)
    for spec in t.charts:
        try:
            _add_chart(ws, spec, t.df, header_row, last)
        except Exception as exc:  # noqa: BLE001 - a chart problem must not lose the data
            log.warning("Chart skipped on %s: %s", t.name, exc)
    _autowidth(ws)
    if t.name == "AI insights":
        ws.column_dimensions["B"].width = 110
        for row in ws.iter_rows(min_row=header_row + 1, min_col=2, max_col=2):
            for c in row:
                c.alignment = Alignment(wrap_text=True, vertical="top")
    if t.name == "Forecast summary":
        ws.column_dimensions[get_column_letter(len(t.df.columns))].width = 80


def _logo_image(logo: tuple[bytes, str] | None, height_px: int = 60):
    if not logo:
        return None
    try:
        from openpyxl.drawing.image import Image as XlImage
        img = XlImage(io.BytesIO(logo[0]))
        ratio = img.width / img.height if img.height else 1
        img.height, img.width = height_px, int(height_px * ratio)
        return img
    except Exception:  # noqa: BLE001 - logos are optional
        return None


def _cover(wb: Workbook, rep: Report, brand: str) -> tuple[Any, int]:
    from .narrative import story
    ws = wb.active; ws.title = "Cover"
    agency, client = rep.branding.get("agency_name") or "Media Radar", rep.client.get("name") or "Client"
    for logo, cell in ((rep.logos.get("agency"), "A1"), (rep.logos.get("client"), "D1")):
        img = _logo_image(logo)
        if img:
            ws.add_image(img, cell)
    ws.row_dimensions[1].height = 50
    ws["A4"] = rep.title; ws["A4"].font = Font(bold=True, size=22, color=brand)
    ws["A5"] = f"Prepared for {client} by {agency}"; ws["A5"].font = Font(size=13, color=brand)
    info = [("Workspace", rep.card), ("Period", rep.date_range or "n/a"), ("Generated", rep.generated), ("Data sources", ", ".join(rep.source_files)),
            ("Filters", "; ".join(rep.filters)), ("Forecast model", "Google TimesFM 2.5" if not rep.forecast or rep.forecast.get("backend") == "timesfm" else "Statistical fallback")]
    r = 7
    for k, v in info:
        ws.cell(row=r, column=1, value=k).font = Font(bold=True); _put(ws, r, 2, v); r += 1
    for n in rep.notes:
        ws.cell(row=r, column=1, value="Note").font = Font(bold=True, color="C27A06"); _put(ws, r, 2, n); r += 1
    st = story(rep)
    r += 1
    ws.cell(row=r, column=1, value="Executive summary").font = Font(bold=True, size=13, color=brand); r += 1
    _put(ws, r, 2, st["headline"]).alignment = Alignment(wrap_text=True, vertical="top"); ws.row_dimensions[r].height = 45; r += 1
    for title, items in (("Key findings", st["findings"]), ("Recommended actions", st["actions"]), ("Watch-outs", st["watch"])):
        if not items:
            continue
        ws.cell(row=r, column=1, value=title).font = Font(bold=True); r_first = r
        for it in items:
            _put(ws, r, 2, "- " + it).alignment = Alignment(wrap_text=True, vertical="top"); ws.row_dimensions[r].height = 30; r += 1
    ws.cell(row=r + 1, column=1, value="Source of summary").font = Font(bold=True)
    _put(ws, r + 1, 2, "Gemini, from the numbers in this workbook" if st["source"] == "gemini" else "Automated, from the numbers in this workbook")
    ws.column_dimensions["A"].width = 22; ws.column_dimensions["B"].width = 110
    return ws, r + 3


def _scenarios_sheet(wb: Workbook, sc: dict) -> None:
    """Scenario table with live formulas and a custom budget the planner can type."""
    ws = wb.create_sheet("Scenarios")
    ratio = sc["params"].get("ratio_label", "Cost per result")
    ws["A1"] = "Budget scenarios"; ws["A1"].font = Font(bold=True, size=14)
    ws["A2"] = (f"Next {sc['params'].get('horizon_points')} {sc['params'].get('granularity')} periods. Method: "
                f"{'TimesFM 2.5 with spend as a covariate' if sc.get('method') == 'timesfm_xreg' else 'linear driver model with seasonal smoothing'}. Blue cells are inputs.")
    ws["A2"].font = Font(italic=True, color="646A8A")
    head = ["Scenario", "Planned spend (LKR)", "Results P10", "Results P50", "Results P90", f"{ratio} (P50)", "Best case", "Worst case"]
    for j, h in enumerate(head, 1):
        c = ws.cell(row=4, column=j, value=h); c.fill, c.font = HEADER_FILL, HEADER_FONT; c.alignment = Alignment(wrap_text=True)
    rows = sc["scenarios"]
    for i, r in enumerate(rows, 5):
        _put(ws, i, 1, r["scenario"])
        ws.cell(row=i, column=2, value=r["driver_total"]).number_format = NUMFMT["lkr"]
        for j, k in ((3, "kpi_p10"), (4, "kpi_p50"), (5, "kpi_p90")):
            ws.cell(row=i, column=j, value=r[k]).number_format = NUMFMT["int"]
        scale = float(sc["params"].get("ratio_scale", 1) or 1)
        for j, col in ((6, "D"), (7, "E"), (8, "C")):
            c = ws.cell(row=i, column=j, value=f"=IF({col}{i}>0,B{i}/{col}{i}*{scale},\"\")"); c.number_format = NUMFMT["lkr"]
    last = 4 + len(rows)
    cr = last + 2
    ws.cell(row=cr, column=1, value="Custom budget").font = Font(bold=True)
    base = next((r for r in rows if r["scenario"] == "Current pace"), rows[0])
    inp = ws.cell(row=cr, column=2, value=round(base["driver_total"] * 1.1)); inp.number_format = NUMFMT["lkr"]; inp.font = Font(color="1F4FD8", bold=True)
    inp.fill = PatternFill("solid", fgColor="EAF0FF")
    ws.cell(row=cr, column=4, value=f"=FORECAST(B{cr},D5:D{last},B5:B{last})").number_format = NUMFMT["int"]
    ws.cell(row=cr, column=6, value=f"=IF(D{cr}>0,B{cr}/D{cr}*{float(sc['params'].get('ratio_scale', 1) or 1)},\"\")").number_format = NUMFMT["lkr"]
    ws.cell(row=cr + 1, column=1, value="Type any budget in the blue cell. Results are interpolated linearly between the modelled scenarios, so stay inside their spend range.").font = Font(italic=True, color="646A8A")
    ch = BarChart(); ch.type = "col"; ch.title = "Expected results by scenario (P50)"; ch.height, ch.width = 8, 16
    ch.add_data(Reference(ws, min_col=4, min_row=4, max_row=last), titles_from_data=True); ch.set_categories(Reference(ws, min_col=1, min_row=5, max_row=last)); ch.legend = None
    ws.add_chart(ch, "J4")
    ws.freeze_panes = "A5"; _autowidth(ws); ws.column_dimensions["A"].width = 18


def _pacing_sheet(wb: Workbook, pc: dict) -> None:
    """Day-by-day tracker: plan, actual (editable), forecast band, cumulative and variance formulas."""
    ws = wb.create_sheet("Pacing tracker")
    ws["A1"] = f"Pacing tracker: {pc['metric_label']} ({pc['entity']})"; ws["A1"].font = Font(bold=True, size=14)
    ws["A2"] = "Blue cells are inputs. Type new actuals into column C as days complete; cumulative, expected and variance columns update."; ws["A2"].font = Font(italic=True, color="646A8A")
    for r, (k, v, f) in enumerate((("Target", pc["target"], "int"), ("Flight start", pc["start"], None), ("Flight end", pc["end"], None), ("Status at export", pc["status"], None)), 3):
        ws.cell(row=r, column=1, value=k).font = Font(bold=True)
        c = _put(ws, r, 2, v)
        if f:
            c.number_format = NUMFMT[f]
        if k == "Target":
            c.font = Font(color="1F4FD8", bold=True); c.fill = PatternFill("solid", fgColor="EAF0FF")
    head = ["Date", "Daily plan", "Actual", "Forecast P10", "Forecast P50", "Forecast P90", "Cumulative actual", "Cumulative plan", "Cumulative expected", "Expected vs plan"]
    hr = 8
    for j, h in enumerate(head, 1):
        c = ws.cell(row=hr, column=j, value=h); c.fill, c.font = HEADER_FILL, HEADER_FONT; c.alignment = Alignment(wrap_text=True)
    act = dict(zip(pc["cumulative"]["dates"], _diffs(pc["cumulative"]["values"])))
    pr = pc["projection"]
    fp = {d: (pr["p10"][i] - (pr["p10"][i - 1] if i else pc["actual_to_date"]), pr["p50"][i] - (pr["p50"][i - 1] if i else pc["actual_to_date"]),
              pr["p90"][i] - (pr["p90"][i - 1] if i else pc["actual_to_date"])) for i, d in enumerate(pr["dates"])}
    days = pd.date_range(pc["start"], pc["end"], freq="D")
    n = len(days)
    for i, d in enumerate(days):
        r = hr + 1 + i
        ds = str(d.date())
        ws.cell(row=r, column=1, value=ds)
        ws.cell(row=r, column=2, value=f"=$B$3/{n}").number_format = NUMFMT["int"]
        if ds in act:
            c = ws.cell(row=r, column=3, value=act[ds]); c.number_format = NUMFMT["int"]
        ws.cell(row=r, column=3).font = Font(color="1F4FD8"); ws.cell(row=r, column=3).fill = PatternFill("solid", fgColor="EAF0FF")
        if ds in fp:
            for j, v in enumerate(fp[ds], 4):
                ws.cell(row=r, column=j, value=max(0.0, v)).number_format = NUMFMT["int"]
        ws.cell(row=r, column=7, value=f"=SUM($C${hr + 1}:C{r})").number_format = NUMFMT["int"]
        ws.cell(row=r, column=8, value=f"=SUM($B${hr + 1}:B{r})").number_format = NUMFMT["int"]
        ws.cell(row=r, column=9, value=f"=SUMPRODUCT(($C${hr + 1}:C{r}<>\"\")*$C${hr + 1}:C{r})+SUMPRODUCT(($C${hr + 1}:C{r}=\"\")*$E${hr + 1}:E{r})").number_format = NUMFMT["int"]
        ws.cell(row=r, column=10, value=f"=IF(H{r}>0,I{r}/H{r}-1,\"\")").number_format = NUMFMT["pct"]
    last = hr + n
    from openpyxl.formatting.rule import CellIsRule
    ws.conditional_formatting.add(f"J{hr + 1}:J{last}", CellIsRule(operator="lessThan", formula=["-0.05"], font=Font(color="D6364F", bold=True)))
    ws.conditional_formatting.add(f"J{hr + 1}:J{last}", CellIsRule(operator="greaterThan", formula=["0.05"], font=Font(color="C27A06", bold=True)))
    ch = LineChart(); ch.title = "Cumulative expected vs plan"; ch.height, ch.width = 8, 18
    ch.add_data(Reference(ws, min_col=8, min_row=hr, max_row=last), titles_from_data=True)
    ch.add_data(Reference(ws, min_col=9, min_row=hr, max_row=last), titles_from_data=True)
    ch.set_categories(Reference(ws, min_col=1, min_row=hr + 1, max_row=last))
    ws.add_chart(ch, "L8")
    ws.freeze_panes = ws.cell(row=hr + 1, column=2); _autowidth(ws)


def _diffs(cum: list[float]) -> list[float]:
    out, prev = [], 0.0
    for v in cum:
        out.append(float(v) - prev); prev = float(v)
    return out


def _methodology_sheet(wb: Workbook, rep: Report) -> None:
    from .narrative import METHODOLOGY
    ws = wb.create_sheet("Methodology")
    ws["A1"] = "Methodology and reliability"; ws["A1"].font = Font(bold=True, size=14)
    for i, m in enumerate(METHODOLOGY, 3):
        _put(ws, i, 1, "- " + m).alignment = Alignment(wrap_text=True, vertical="top"); ws.row_dimensions[i].height = 32
    r = 4 + len(METHODOLOGY)
    _put(ws, r, 1, rep.branding.get("disclaimer", "")).font = Font(italic=True, color="646A8A")
    ws.column_dimensions["A"].width = 140


def build_workbook(rep: Report) -> Workbook:
    global HEADER_FILL
    brand = (rep.branding.get("primary_color") or "#4F46E5").lstrip("#").upper()
    HEADER_FILL = PatternFill("solid", fgColor=brand)
    wb = Workbook()
    ws, r = _cover(wb, rep, brand)
    k = wb.create_sheet("KPIs")
    k["A1"] = "KPI summary"; k["A1"].font = Font(bold=True, size=14)
    for j, h in enumerate(["Metric", "Value"], 1):
        c = k.cell(row=3, column=j, value=h); c.fill, c.font = HEADER_FILL, HEADER_FONT
    for i, (label, val, f) in enumerate(rep.kpis, 4):
        _put(k, i, 1, label)
        c = _put(k, i, 2, val)
        if isinstance(c.value, (int, float)):
            c.number_format = NUMFMT[f]
        c.alignment = Alignment(horizontal="right")
    if rep.kpis:
        t = XlTable(displayName="tbl_kpis", ref=f"A3:B{3 + len(rep.kpis)}"); t.tableStyleInfo = TableStyleInfo(name="TableStyleMedium2", showRowStripes=True); k.add_table(t)
    k.freeze_panes = "A4"; _autowidth(k)
    if rep.scenarios:
        _scenarios_sheet(wb, rep.scenarios)
    if rep.pacing:
        _pacing_sheet(wb, rep.pacing)
    for n, tb in enumerate(rep.tables, 1):
        _sheet_for_table(wb, tb, n)
    _methodology_sheet(wb, rep)
    ws.cell(row=r, column=1, value="Contents").font = Font(bold=True)
    for j, nm in enumerate([s for s in wb.sheetnames if s != "Cover"]):
        c = ws.cell(row=r + j, column=2, value=nm)
        c.hyperlink = f"#'{nm}'!A1"; c.font = Font(color=brand, underline="single")
    return wb


def workbook_bytes(rep: Report) -> bytes:
    buf = io.BytesIO()
    build_workbook(rep).save(buf)
    return buf.getvalue()
