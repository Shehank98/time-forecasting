"""Excel report with native tables, number formats, frozen panes and native openpyxl charts."""
from __future__ import annotations

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


def build_workbook(rep: Report) -> Workbook:
    wb = Workbook()
    ws = wb.active; ws.title = "Cover"
    ws["A1"] = rep.title; ws["A1"].font = Font(bold=True, size=20, color="4F46E5")
    info = [("Card", rep.card), ("Date range", rep.date_range or "n/a"), ("Generated", rep.generated), ("Data source file(s)", ", ".join(rep.source_files))]
    for i, (k, v) in enumerate(info, 3):
        ws.cell(row=i, column=1, value=k).font = Font(bold=True); _put(ws, i, 2, v)
    r = 3 + len(info) + 1
    ws.cell(row=r, column=1, value="Filters applied").font = Font(bold=True)
    for j, f in enumerate(rep.filters):
        _put(ws, r + j, 2, f)
    n_notes = 0
    if rep.notes:
        ws.cell(row=r + len(rep.filters) + 1, column=1, value="Notes").font = Font(bold=True, color="C27A06")
        for j, n in enumerate(rep.notes):
            _put(ws, r + len(rep.filters) + 1 + j, 2, n)
        n_notes = len(rep.notes) + 1
    ws.cell(row=r + len(rep.filters) + 1 + n_notes, column=1, value="Contents").font = Font(bold=True)
    ws.column_dimensions["A"].width = 24; ws.column_dimensions["B"].width = 90
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
    t = XlTable(displayName="tbl_kpis", ref=f"A3:B{3 + len(rep.kpis)}"); t.tableStyleInfo = TableStyleInfo(name="TableStyleMedium2", showRowStripes=True); k.add_table(t)
    k.freeze_panes = "A4"; _autowidth(k)
    for n, tb in enumerate(rep.tables, 1):
        _sheet_for_table(wb, tb, n)
    names = [s for s in wb.sheetnames if s != "Cover"]
    for j, nm in enumerate(names):
        c = ws.cell(row=r + len(rep.filters) + 2 + n_notes + j, column=2, value=nm)
        c.hyperlink = f"#'{nm}'!A1"; c.font = Font(color="4F46E5", underline="single")
    return wb
