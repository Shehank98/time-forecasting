"""Client KPI analytics: totals, cost-per-result ratios, segment mix, driver effects and seasonality."""
from __future__ import annotations

import logging

import numpy as np
import pandas as pd

from . import series as S
from .util import jsonable, pct_change, safe_div

log = logging.getLogger(__name__)


def _metric_value(df: pd.DataFrame, m) -> float | None:
    if df.empty:
        return None
    if m.agg in ("sum", "count"):
        return float(df[m.col].sum()) if m.col else float(len(df))
    if m.agg == "mean":
        return float(df[m.col].mean())
    if m.agg == "ratio":
        d = df[df[m.den] > 0]
        return safe_div(float(d[m.num].sum()), float(d[m.den].sum())) * m.scale if len(d) and d[m.den].sum() else None
    return None


def _prev_window(nodate: pd.DataFrame, start: pd.Timestamp, end: pd.Timestamp) -> pd.DataFrame:
    n = (end - start).days + 1
    return nodate[(nodate["date"] >= start - pd.Timedelta(days=n)) & (nodate["date"] < start)]


def driver_effects(df: pd.DataFrame, metrics: dict, gran: str) -> list[dict]:
    """Simple linear response of each KPI to each driver at the dataset's granularity."""
    drivers = [k for k, m in metrics.items() if m.agg == "sum" and m.unit == "currency"]
    kpis = [k for k, m in metrics.items() if m.agg == "sum" and m.unit != "currency"]
    if not drivers or not kpis or df.empty:
        return []
    per = S.period_column(df, gran)
    g = df.groupby(per)[drivers + kpis].sum()
    out = []
    for d in drivers:
        for k in kpis:
            x, y = g[d].to_numpy(float), g[k].to_numpy(float)
            if len(x) < 6 or np.std(x) == 0 or np.std(y) == 0:
                continue
            b = np.polyfit(x, y, 1)
            r = float(np.corrcoef(x, y)[0, 1])
            unit = 100000.0 if np.mean(x) > 100000 else 1000.0
            out.append({"driver": metrics[d].label, "kpi": metrics[k].label, "slope": float(b[0]), "per_unit": unit, "kpi_per_unit": float(b[0] * unit),
                        "correlation": r, "r2": r * r, "periods": int(len(x)),
                        "text": f"Each extra {unit:,.0f} of {metrics[d].label} has gone with about {b[0] * unit:,.1f} more {metrics[k].label} per {gran[:-2] if gran != 'daily' else 'day'} (correlation {r:.2f})."})
    return sorted(out, key=lambda r: -abs(r["correlation"]))[:8]


def seasonality(df: pd.DataFrame, metric, gran: str) -> dict:
    out: dict = {}
    if df.empty or not metric or not metric.col:
        return out
    daily = df.groupby("date")[metric.col].sum() if metric.agg == "sum" else df.groupby("date")[metric.col].mean()
    if gran == "daily" and daily.index.nunique() >= 14:
        dow = daily.groupby(daily.index.dayofweek).mean()
        if dow.mean():
            out["day_of_week"] = {"labels": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], "index": [float(dow.get(i, np.nan) / dow.mean() * 100) for i in range(7)]}
    span = (daily.index.max() - daily.index.min()).days
    if span >= 330:
        mon = daily.groupby(daily.index.month).mean()
        if mon.mean():
            out["month"] = {"labels": [pd.Timestamp(2000, i, 1).strftime("%b") for i in mon.index], "index": [float(v / mon.mean() * 100) for v in mon]}
    return out


def dashboard(df: pd.DataFrame, meta: dict, nodate: pd.DataFrame, start=None, end=None) -> dict:
    if df.empty:
        return {"empty": True}
    metrics = S.kpi_metrics(meta)
    gran = meta.get("granularity", "daily")
    start = start if start is not None else df["date"].min()
    end = end if end is not None else df["date"].max()
    prev = _prev_window(nodate, start, end)
    kpis = []
    for k, m in metrics.items():
        cur_v, prev_v = _metric_value(df, m), _metric_value(prev, m) if len(prev) else None
        kpis.append({"key": k, "label": m.label, "unit": m.unit, "agg": m.agg, "value": cur_v, "prev": prev_v, "change_pct": pct_change(cur_v, prev_v) if prev_v is not None else None})
    # trend at the dataset granularity (weekly when daily data spans more than 6 months)
    tg = "weekly" if gran == "daily" and (df["date"].max() - df["date"].min()).days > 180 else gran
    per = S.period_column(df, tg)
    idx = S.axis(df, tg)
    trend = {"granularity": tg, "dates": [str(d.date()) for d in idx], "series": []}
    for k, m in metrics.items():
        if m.agg == "ratio":
            num, den = df.groupby(per)[m.num].sum().reindex(idx), df[df[m.den] > 0].groupby(per[df[m.den] > 0])[m.den].sum().reindex(idx)
            vals = (num / den.replace(0, np.nan) * m.scale)
        elif m.agg == "mean":
            vals = df.groupby(per)[m.col].mean().reindex(idx)
        else:
            vals = df.groupby(per)[m.col].sum().reindex(idx).fillna(0)
        trend["series"].append({"key": k, "label": m.label, "unit": m.unit, "values": vals.tolist()})
    segs = []
    if df["segment"].nunique() > 1:
        first_sum = next((k for k, m in metrics.items() if m.agg == "sum"), None)
        for s, g in df.groupby("segment"):
            row = {"segment": s, "rows": int(len(g))}
            for k, m in metrics.items():
                row[k] = _metric_value(g, m)
            segs.append(row)
        if first_sum:
            tot = sum((r[first_sum] or 0) for r in segs) or 1
            for r in segs:
                r["share_pct"] = (r[first_sum] or 0) / tot * 100
            segs.sort(key=lambda r: -(r[first_sum] or 0))
    main_kpi = next((m for m in metrics.values() if m.agg == "sum" and m.unit != "currency"), next(iter(metrics.values()), None))
    out = {"empty": False, "granularity": gran, "window": {"start": str(start.date()), "end": str(end.date())}, "kpis": kpis, "trend": trend,
           "segments": segs, "metrics": [{"key": k, "label": m.label, "unit": m.unit, "agg": m.agg} for k, m in metrics.items()],
           "driver_effects": driver_effects(df, metrics, gran if gran != "daily" else "weekly"),
           "seasonality": seasonality(df, main_kpi, gran), "seasonality_metric": main_kpi.label if main_kpi else None,
           "drivers": [k for k, m in metrics.items() if m.agg == "sum" and m.unit == "currency"],
           "targets": [k for k, m in metrics.items() if m.agg == "sum" and m.unit != "currency"]}
    return jsonable(out)
