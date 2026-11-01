"""Turns dashboard aggregates, forecasts and AI text into report sections shared by Excel and PDF."""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd

CARD_NAMES = {"tv": "TVR Audience Behaviour Prediction", "lmrb": "Market Prediction", "kpi": "Client KPI Forecast"}


@dataclass
class Table:
    name: str                       # sheet name (max 31 chars) and section heading
    df: pd.DataFrame
    fmt: dict[str, str] = field(default_factory=dict)   # column -> lkr | int | pct | dec1 | dec2 | text
    note: str = ""
    charts: list[dict] = field(default_factory=list)    # native Excel chart specs bound to this table
    matrix: bool = False                                # heatmap style: first column is the row label
    pdf_rows: int = 15


@dataclass
class Report:
    kind: str
    title: str
    card: str
    filters: list[str]
    date_range: str
    generated: str
    source_files: list[str]
    kpis: list[tuple[str, Any, str]]
    tables: list[Table]
    forecast: dict | None
    ai: dict | None
    notes: list[str]
    dash: dict
    advertiser_order: list[str] = field(default_factory=list)
    client: dict = field(default_factory=dict)
    branding: dict = field(default_factory=dict)
    scenarios: dict | None = None
    pacing: dict | None = None
    saved: list[dict] = field(default_factory=list)
    dataset_meta: dict = field(default_factory=dict)
    dataset_name: str = ""
    logos: dict = field(default_factory=dict)
    evidence: list[str] = field(default_factory=list)   # Planner's Evidence statements from the forecast tabs       # {"agency": (bytes, type), "client": (bytes, type)}


def _df(rows: list[dict], cols: dict[str, str]) -> pd.DataFrame:
    """Select and rename columns, tolerating empty input."""
    if not rows:
        return pd.DataFrame(columns=list(cols.values()))
    d = pd.DataFrame(rows)
    d = d[[c for c in cols if c in d.columns]].rename(columns=cols)
    return d


def _frac(d: pd.DataFrame, cols: list[str]) -> pd.DataFrame:
    for c in cols:
        if c in d.columns:
            d[c] = d[c] / 100.0
    return d


def _matrix(m: dict, corner: str) -> pd.DataFrame:
    if not m or not m.get("rows"):
        return pd.DataFrame(columns=[corner])
    d = pd.DataFrame(m["values"], columns=[str(c) for c in m["cols"]])
    d.insert(0, corner, m["rows"])
    return d


def _ranked(rows: list[dict], label: str) -> tuple[pd.DataFrame, dict]:
    d = _df(rows, {"rank": "Rank", "name": label, "spend": "Spend (LKR)", "share_pct": "Spend share", "spots": "Spots", "spot_share_pct": "Spot share", "change_pct": "Change vs previous"})
    d = _frac(d, ["Spend share", "Spot share", "Change vs previous"])
    return d, {"Rank": "int", "Spend (LKR)": "lkr", "Spend share": "pct", "Spots": "int", "Spot share": "pct", "Change vs previous": "pct"}


def build_lmrb_tables(dash: dict) -> tuple[list[tuple[str, Any, str]], list[Table]]:
    k = dash["kpis"]
    kpis = [("Total spend", k["total_spend"], "lkr"), ("Spots", k["spots"], "int"), ("Average cost per spot", k["avg_cost_per_spot"], "lkr"),
            ("Average cost per second", k["avg_cost_per_second"], "lkr"), ("Active creatives", k["active_creatives"], "int"), ("Active channels", k["active_channels"], "int"),
            ("Active advertisers", k["active_advertisers"], "int")]
    if k.get("sov_spend_pct") is not None:
        kpis += [("Share of voice (spend)", k["sov_spend_pct"] / 100, "pct"), ("Share of voice (spots)", k["sov_spots_pct"] / 100, "pct")]
    if k.get("spend_change_pct") is not None:
        kpis.append(("Spend change vs previous", k["spend_change_pct"] / 100, "pct"))
    T: list[Table] = []
    for key, label, sheet in [("by_advertiser", "Advertiser", "Spend by advertiser"), ("by_product", "Product", "Spend by product"), ("by_channel", "Channel", "Spend by channel"),
                              ("by_daypart", "Daypart", "Spend by daypart"), ("by_language", "Language", "Spend by language")]:
        d, f = _ranked(dash[key], label)
        charts = []
        if key == "by_advertiser":
            charts = [{"type": "bar", "cat": label, "vals": ["Spend (LKR)"], "title": "Spend by advertiser", "horizontal": True}]
        elif key == "by_channel":
            charts = [{"type": "pie", "cat": label, "vals": ["Spend (LKR)"], "title": "Spend share by channel"}]
        elif key == "by_daypart":
            charts = [{"type": "bar", "cat": label, "vals": ["Spend (LKR)"], "title": "Spend by daypart"}]
        T.append(Table(sheet, d, f, note=f"Change compares {dash['comparison']['cur'][0]} to {dash['comparison']['cur'][1]} with the previous window." if dash["comparison"].get("prev") else "No earlier data for comparison.", charts=charts))
    sw = dash["sov_weekly"]
    if sw["weeks"]:
        spend = pd.DataFrame({"Week starting": sw["weeks"], **{a["name"]: a["spend"] for a in sw["advertisers"]}})
        share = spend.copy()
        tot = spend.drop(columns="Week starting").sum(axis=1).replace(0, np.nan)
        for a in sw["advertisers"]:
            share[a["name"]] = (spend[a["name"]] / tot).fillna(0.0)
        names = [a["name"] for a in sw["advertisers"]]
        T.append(Table("SOV weekly", share, {n: "pct" for n in names}, note="Weekly share of voice by spend. Weeks with no spend show 0%.",
                       charts=[{"type": "area", "cat": "Week starting", "vals": names, "title": "Share of voice over time", "stacked_pct": True}]))
        T.append(Table("SOV weekly spend", spend, {n: "lkr" for n in names}))
    T.append(Table("Channel mix", _matrix(dash["mix_channel"], "Advertiser"), {}, "Spend (LKR) by advertiser and channel.", matrix=True))
    T.append(Table("Daypart mix", _matrix(dash["mix_daypart"], "Advertiser"), {}, "Spend (LKR) by advertiser and daypart.", matrix=True))
    T.append(Table("Programme mix", _matrix(dash["mix_program"], "Advertiser"), {}, "Spend (LKR) by advertiser and channel / programme.", matrix=True, pdf_rows=10))
    fl = _df(dash["flighting"]["advertisers"], {"advertiser": "Advertiser", "pattern": "Pattern", "first_date": "Flight start", "last_date": "Flight end", "active_days": "Active days",
                                                 "active_ratio": "Coverage", "longest_gap_days": "Longest gap (days)", "burst_count": "Bursts", "spend": "Spend (LKR)", "spots": "Spots"})
    T.append(Table("Flighting", fl, {"Active days": "int", "Coverage": "pct", "Longest gap (days)": "int", "Bursts": "int", "Spend (LKR)": "lkr", "Spots": "int"}))
    cr = pd.DataFrame(dash["creatives"])
    if len(cr):
        cr["channels"] = cr["channels"].map(lambda v: ", ".join(v))
    T.append(Table("Creatives", _df(cr.to_dict("records") if len(cr) else [], {"status": "Status", "advertiser": "Advertiser", "product": "Product", "theme": "Creative", "first_seen": "First seen", "last_seen": "Last seen",
                                                                               "spots": "Spots", "spend": "Spend (LKR)", "channels": "Channels"}), {"Spots": "int", "Spend (LKR)": "lkr"}, "NEW and DROPPED compare the latest window with the previous one."))
    pr = _df(dash["pricing"]["cells"], {"advertiser": "Advertiser", "channel": "Channel", "daypart": "Daypart", "spots": "Spots", "spend": "Spend (LKR)", "cps": "Cost per second", "median_cps": "Channel median CPS", "index_vs_median": "Index vs median", "flag": "Flag"})
    T.append(Table("Pricing", pr, {"Spots": "int", "Spend (LKR)": "lkr", "Cost per second": "lkr", "Channel median CPS": "lkr", "Index vs median": "pct"}, "Commercial spots only. Index is the advertiser cost per second divided by the median for the same channel and daypart."))
    sp = (dash["pricing"].get("split") or {})
    if sp and (sp.get("sponsorship") or {}).get("spots"):
        T.append(Table("Spend split", _df(sp.get("by_advertiser", []), {"advertiser": "Advertiser", "commercial_spend": "Commercial spend (LKR)", "sponsorship_spend": "Sponsorship spend (LKR)", "sponsorship_pct": "Sponsorship share",
                                                                      "commercial_spots": "Commercial spots", "sponsorship_spots": "Sponsorship items"}),
                       {"Commercial spend (LKR)": "lkr", "Sponsorship spend (LKR)": "lkr", "Commercial spots": "int", "Sponsorship items": "int", "Sponsorship share": "pct"}, "Sponsorship items are the themes -BB, Com Break, DJ, -Extro, -Intro, -LLogo, Next Card, Tag, Time Check and -Tr."))
        sc = (dash["pricing"].get("sponsorship") or {}).get("cells") or []
        T.append(Table("Pricing (sponsorship)", _df(sc, {"advertiser": "Advertiser", "channel": "Channel", "daypart": "Daypart", "spots": "Spots", "spend": "Spend (LKR)", "cps": "Cost per second", "median_cps": "Channel median CPS", "index_vs_median": "Index vs median", "flag": "Flag"}),
                       {"Spots": "int", "Spend (LKR)": "lkr", "Cost per second": "lkr", "Channel median CPS": "lkr", "Index vs median": "pct"}, "Sponsorship items only, compared with the median sponsorship price on the same channel and daypart."))
    T.append(Table("Pricing heatmap", _matrix(dash["pricing"]["heatmap"], "Channel"), {}, "Median cost per second (LKR) by channel and daypart.", matrix=True))
    ps = _df(dash["position"], {"advertiser": "Advertiser", "spots": "Spots", "first_n": "First in break", "last_n": "Last in break", "first_rate_pct": "First rate", "last_rate_pct": "Last rate", "share_of_first_pct": "Share of all firsts", "share_of_last_pct": "Share of all lasts"})
    ps = _frac(ps, ["First rate", "Last rate", "Share of all firsts", "Share of all lasts"])
    T.append(Table("Position strategy", ps, {"Spots": "int", "First in break": "int", "Last in break": "int", "First rate": "pct", "Last rate": "pct", "Share of all firsts": "pct", "Share of all lasts": "pct"}))
    al = pd.DataFrame([{"Severity": a["severity"].title(), "Advertiser": a["advertiser"], "Alert": a["text"]} for a in dash["alerts"]["items"]], columns=["Severity", "Advertiser", "Alert"])
    T.append(Table("Alerts", al, {}, "; ".join(dash["alerts"].get("notes", [])), pdf_rows=12))
    return kpis, T


def build_tv_tables(dash: dict) -> tuple[list[tuple[str, Any, str]], list[Table]]:
    k = dash["kpis"]
    kpis = [("Programmes", k["programmes"], "int"), ("Channels", k["channels"], "int"), ("Airings", k["airings"], "int"), ("Average TVR", k["avg_tvr"], "dec2"), ("Total reach", k["total_reach"], "int"),
            ("Top programme", f"{k['top_programme']['name']} ({k['top_programme']['channel']})", "text"), ("Top channel", k["top_channel"]["name"], "text")]
    top = _df(dash["top_programmes"], {"program": "Programme", "channel": "Channel", "airings": "Airings", "avg_tvr": "Avg TVR", "max_tvr": "Max TVR", "avg_reach": "Avg reach", "total_reach": "Total reach", "avg_reach_pct": "Avg reach %", "avg_share": "Avg share %"})
    f_top = {"Airings": "int", "Avg TVR": "dec2", "Max TVR": "dec2", "Avg reach": "int", "Total reach": "int", "Avg reach %": "dec2", "Avg share %": "dec2"}
    T = [Table("Top programmes", top, f_top, charts=[{"type": "bar", "cat": "Programme", "vals": ["Avg TVR"], "title": "Top programmes by average TVR", "horizontal": True, "limit": 10}])]
    ch = _df(dash["by_channel"], {"channel": "Channel", "airings": "Airings", "avg_tvr": "Avg TVR", "total_reach": "Total reach", "avg_share": "Avg share %"})
    T.append(Table("Channels", ch, {"Airings": "int", "Avg TVR": "dec2", "Total reach": "int", "Avg share %": "dec2"}, charts=[{"type": "bar", "cat": "Channel", "vals": ["Avg TVR"], "title": "Average TVR by channel"}]))
    cat = _df(dash["by_category"], {"category": "Category", "airings": "Airings", "avg_tvr": "Avg TVR", "total_reach": "Total reach", "avg_share": "Avg share %"})
    T.append(Table("Categories", cat, {"Airings": "int", "Avg TVR": "dec2", "Total reach": "int", "Avg share %": "dec2"}, charts=[{"type": "bar", "cat": "Category", "vals": ["Avg TVR"], "title": "Category performance", "horizontal": True, "limit": 12}]))
    ct = dash["category_trend"]
    if ct["weeks"]:
        T.append(Table("Category trend", pd.DataFrame({"Week starting": ct["weeks"], **{s["name"]: s["values"] for s in ct["series"]}}), {s["name"]: "dec2" for s in ct["series"]},
                       charts=[{"type": "line", "cat": "Week starting", "vals": [s["name"] for s in ct["series"]], "title": "Category trend (average TVR)"}]))
    T.append(Table("Heat channel x category", _matrix(dash["heat_category"], "Channel"), {}, "Average TVR.", matrix=True))
    T.append(Table("Heat channel x daypart", _matrix(dash["heat_daypart"], "Channel"), {}, "Average TVR.", matrix=True))
    T.append(Table("Heat channel x day", _matrix(dash["heat_day"], "Channel"), {}, "Average TVR.", matrix=True))
    ef = _df(dash["efficiency"], {"program": "Programme", "channel": "Channel", "airings": "Airings", "avg_duration": "Avg minutes", "avg_tvr": "Avg TVR", "tvr_per_min": "TVR per minute", "reach_per_min": "Reach per minute", "avg_share": "Avg share %"})
    T.append(Table("Efficiency", ef, {"Airings": "int", "Avg minutes": "int", "Avg TVR": "dec2", "TVR per minute": "dec2", "Reach per minute": "int", "Avg share %": "dec2"}))
    co = _df(dash["consistency"], {"program": "Programme", "channel": "Channel", "day": "Day", "start": "Start", "airings": "Airings", "mean_tvr": "Mean TVR", "std_tvr": "Std dev", "cv": "CV", "reliability": "Reliability"})
    T.append(Table("Consistency", co, {"Airings": "int", "Mean TVR": "dec2", "Std dev": "dec2", "CV": "dec2"}, "CV is standard deviation divided by mean. Lower means more predictable."))
    if dash.get("opportunity"):
        op = _df(dash["opportunity"]["rows"], {"channel": "Channel", "day": "Day", "daypart": "Daypart", "avg_tvr": "Avg TVR", "ad_load_per_day": "Ad spots per day", "spend_per_day": "Competitor spend per day", "score": "Opportunity score"})
        T.append(Table("Slot opportunity", op, {"Avg TVR": "dec2", "Ad spots per day": "dec1", "Competitor spend per day": "lkr", "Opportunity score": "dec2"}, dash["opportunity"]["note"]))
    return kpis, T


def build_kpi_tables(dash: dict) -> tuple[list[tuple[str, Any, str]], list[Table]]:
    unit_fmt = {"currency": "lkr", "percent": "dec2", "rating": "dec2", "number": "int"}
    kpis = []
    for k in dash["kpis"]:
        f = unit_fmt.get(k["unit"], "dec2") if k["agg"] != "mean" else "dec2"
        kpis.append((k["label"], k["value"], f if k["agg"] != "ratio" else "lkr"))
    T: list[Table] = []
    tr = dash["trend"]
    if tr["dates"]:
        d = pd.DataFrame({"Period": tr["dates"], **{s["label"]: s["values"] for s in tr["series"]}})
        tk = set(dash.get("targets") or [])
        sums = [s["label"] for s in tr["series"] if s["key"] in tk][:1] or [s["label"] for s in tr["series"] if s["unit"] != "currency"][:1]
        T.append(Table("KPI trend", d, {s["label"]: unit_fmt.get(s["unit"], "dec2") for s in tr["series"]}, f"{tr['granularity'].title()} totals or averages.",
                       charts=[{"type": "line", "cat": "Period", "vals": sums or [tr["series"][0]["label"]], "title": "KPI trend"}]))
    if dash.get("segments"):
        labels = {m["key"]: m["label"] for m in dash["metrics"]}
        seg = pd.DataFrame(dash["segments"]).rename(columns={"segment": "Segment", "rows": "Rows", "share_pct": "Share", **labels})
        if "Share" in seg:
            seg["Share"] = seg["Share"] / 100
        T.append(Table("Segments", seg, {"Rows": "int", "Share": "pct", **{m["label"]: unit_fmt.get(m["unit"], "dec2") for m in dash["metrics"]}}))
    if dash.get("driver_effects"):
        T.append(Table("Driver effects", pd.DataFrame([{"Driver": e["driver"], "KPI": e["kpi"], "Per unit of driver": e["per_unit"], "KPI per unit": e["kpi_per_unit"],
                                                        "Correlation": e["correlation"], "Periods": e["periods"]} for e in dash["driver_effects"]]),
                       {"Per unit of driver": "int", "KPI per unit": "dec2", "Correlation": "dec2", "Periods": "int"}, "Historical association, not proof of cause."))
    return kpis, T


def forecast_tables(fc: dict) -> list[Table]:
    """Summary, long form forecast values and chart data for the top entities."""
    out: list[Table] = []
    rs = fc["results"]
    add = bool(rs[0]["outlook"].get("additive"))
    summ = []
    for r in rs:
        bt, o = r["backtest"], r["outlook"]
        summ.append({"Entity": r["entity"], "Reliability": r["reliability"]["level"], "History points": r["n_points"], "Trend": o["trend"].title(),
                     "Change vs recent": (o["trend_change_pct"] or 0) / 100 if o["trend_change_pct"] is not None else None,
                     "Expected next weeks": o["expected_next_4w"] if add else o["avg_next_4w"], "Active weeks": o.get("active_weeks"), "Inactive weeks": o.get("inactive_weeks"),
                     "Burst windows": ", ".join(o.get("burst_windows") or []),
                     "sMAPE": (bt["model"]["smape"] / 100) if bt and bt["model"]["smape"] is not None else None, "MAE": bt["model"]["mae"] if bt else None,
                     "MASE": bt["model"]["mase"] if bt else None, "Baseline sMAPE": (bt["baseline"]["smape"] / 100) if bt and bt["baseline"]["smape"] is not None else None, "Why": "; ".join(r["reliability"]["reasons"])})
    out.append(Table("Forecast summary", pd.DataFrame(summ), {"History points": "int", "Change vs recent": "pct", "Expected next weeks": "lkr" if rs[0].get("unit") == "currency" else ("int" if add else "dec2"), "Active weeks": "int", "Inactive weeks": "int", "sMAPE": "pct", "MAE": "dec2", "MASE": "dec2", "Baseline sMAPE": "pct"},
                     f"Model: {'Forecast engine' if fc['backend'] == 'timesfm' else 'statistical fallback (main forecast model unavailable)'}. Metric: {rs[0]['metric']}, granularity {rs[0]['granularity']}. Reliability uses history length and a backtest against a seasonal naive baseline."))
    vals = []
    for r in rs:
        for i, d in enumerate(r["forecast"]["dates"]):
            vals.append({"Entity": r["entity"], "Date": d, "P10": r["forecast"]["p10"][i], "P50": r["forecast"]["p50"][i], "P90": r["forecast"]["p90"][i], "Reliability": r["reliability"]["level"]})
    out.append(Table("Forecast values", pd.DataFrame(vals), {"P10": "dec2", "P50": "dec2", "P90": "dec2"}, "P10 is the low case (a safe floor), P50 the most likely value and P90 the high case (the upside). Values marked forecast have not happened yet."))
    for n, r in enumerate(rs[:3]):
        h, f = r["history"], r["forecast"]
        keep = min(len(h["dates"]), 60)
        rows = [{"Date": d, "History": v, "P10": None, "P50": None, "P90": None} for d, v in zip(h["dates"][-keep:], h["values"][-keep:])]
        rows[-1].update(P10=h["values"][-1], P50=h["values"][-1], P90=h["values"][-1])
        rows += [{"Date": d, "History": None, "P10": a, "P50": b, "P90": c} for d, a, b, c in zip(f["dates"], f["p10"], f["p50"], f["p90"])]
        name = f"FC chart {n + 1}"
        out.append(Table(name, pd.DataFrame(rows), {"History": "dec2", "P10": "dec2", "P50": "dec2", "P90": "dec2"}, f"{r['entity']} ({r['reliability']['level']} reliability)",
                         charts=[{"type": "line", "cat": "Date", "vals": ["History", "P10", "P50", "P90"], "title": f"{r['entity']}: history and forecast", "forecast_bands": True}]))
    return out


def ai_table(ai: dict) -> list[Table]:
    rows = [{"Section": "Executive summary", "Statement": ai["executive_summary"]["statement"], "Confidence": ai["executive_summary"]["confidence"]}]
    for key, label in [("competitor_moves", "Competitor move"), ("threats", "Threat"), ("opportunities", "Opportunity"), ("predicted_behaviour", "Predicted behaviour"), ("recommended_actions", "Recommended action")]:
        rows += [{"Section": label, "Statement": i["statement"], "Confidence": i["confidence"]} for i in ai.get(key, [])]
    rows += [{"Section": "Data caveat", "Statement": c, "Confidence": ""} for c in ai.get("data_caveats", [])]
    return [Table("AI insights", pd.DataFrame(rows), {}, "Generated by Gemini from aggregated numbers only. Treat as decision support and check the evidence in the app.")]


def build(kind: str, dash: dict, meta: dict, files: list[str], forecast: dict | None, ai: dict | None, filters_text: list[str], adv_order: list[str] | None = None,
          client: dict | None = None, branding: dict | None = None, scenarios: dict | None = None, pacing: dict | None = None, saved: list[dict] | None = None,
          dataset_meta: dict | None = None, dataset_name: str = "", title: str = "", logos: dict | None = None) -> Report:
    kpis, tables = {"lmrb": build_lmrb_tables, "tv": build_tv_tables, "kpi": build_kpi_tables}[kind](dash)
    notes: list[str] = []
    if forecast and forecast.get("ok"):
        tables += forecast_tables(forecast)
    if ai:
        tables += ai_table(ai)
    win = dash.get("window")
    dr = f"{win['start']} to {win['end']}" if win else ""
    return Report(kind=kind, title=title or f"{CARD_NAMES[kind]} report", card=CARD_NAMES[kind] + (f": {dataset_name}" if dataset_name else ""), filters=filters_text or ["None"],
                  date_range=dr, generated=dt.datetime.now().strftime("%Y-%m-%d %H:%M"), source_files=files, kpis=kpis, tables=tables,
                  forecast=forecast if forecast and forecast.get("ok") else None, ai=ai, notes=notes, dash=dash, advertiser_order=adv_order or dash.get("all_advertiser_order", []),
                  client=client or {}, branding=branding or {}, logos=logos or {}, scenarios=scenarios, pacing=pacing, saved=saved or [], dataset_meta=dataset_meta or {}, dataset_name=dataset_name)
