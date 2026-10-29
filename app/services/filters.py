"""Server-side filtering shared by dashboards, tables, forecasts and exports."""
from __future__ import annotations

import logging
from typing import Any

import pandas as pd

from . import normalise as nz

log = logging.getLogger(__name__)

# filter key -> dataframe column, for simple multi-select filters
TV_MULTI = {"channel": "channel", "category": "category", "day": "day",
            "daypart": "daypart", "data_set": "data_set"}
LMRB_MULTI = {"product_group": "product_group", "advertiser": "advertiser", "product": "product",
              "channel": "channel", "program": "program", "language": "lng",
              "duration_band": "dur_band", "daypart": "daypart", "ad_position": "position"}
KPI_MULTI = {"segment": "segment"}
MULTI = {"tv": TV_MULTI, "lmrb": LMRB_MULTI, "kpi": KPI_MULTI}


def _as_list(v: Any) -> list[str]:
    if v is None:
        return []
    if isinstance(v, (list, tuple, set)):
        return [str(x) for x in v if str(x) != ""]
    return [str(v)] if str(v) != "" else []


def _num(v: Any) -> float | None:
    try:
        if v is None or v == "":
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


def apply_filters(df: pd.DataFrame, kind: str, filters: dict | None, skip_date: bool = False) -> pd.DataFrame:
    """Return the filtered frame. Unknown keys are ignored, never raise."""
    f = filters or {}
    if df.empty:
        return df
    mask = pd.Series(True, index=df.index)
    if not skip_date:
        d0, d1 = pd.to_datetime(f.get("date_from"), errors="coerce"), pd.to_datetime(f.get("date_to"), errors="coerce")
        if pd.notna(d0):
            mask &= df["date"] >= d0
        if pd.notna(d1):
            mask &= df["date"] <= d1
    for key, col in MULTI[kind].items():
        vals = _as_list(f.get(key))
        if vals and col in df.columns:
            mask &= df[col].astype(str).isin(vals)
    if kind == "tv":
        q = str(f.get("program_search") or "").strip().upper()
        if q:
            mask &= df["program"].str.contains(q, regex=False, na=False)
        lo, hi = _num(f.get("tvr_min")), _num(f.get("tvr_max"))
        if lo is not None:
            mask &= df["tvr"] >= lo
        if hi is not None:
            mask &= df["tvr"] <= hi
    elif kind == "lmrb":
        lo, hi = _num(f.get("cost_min")), _num(f.get("cost_max"))
        if lo is not None:
            mask &= df["cost"] >= lo
        if hi is not None:
            mask &= df["cost"] <= hi
    return df[mask]


def describe_filters(kind: str, filters: dict | None) -> list[dict]:
    """Human readable list of active filters, for chips and report covers."""
    f = filters or {}
    out: list[dict] = []
    if f.get("date_from") or f.get("date_to"):
        out.append({"key": "date", "label": "Dates", "value": f"{f.get('date_from') or '...'} to {f.get('date_to') or '...'}"})
    for key in MULTI[kind]:
        vals = _as_list(f.get(key))
        if vals:
            out.append({"key": key, "label": key.replace("_", " ").title(), "value": ", ".join(vals[:4]) + (f" +{len(vals) - 4}" if len(vals) > 4 else "")})
    if kind == "tv":
        if f.get("program_search"):
            out.append({"key": "program_search", "label": "Programme", "value": str(f["program_search"])})
        if _num(f.get("tvr_min")) is not None or _num(f.get("tvr_max")) is not None:
            out.append({"key": "tvr", "label": "TVR", "value": f"{f.get('tvr_min') or '0'} to {f.get('tvr_max') or 'max'}"})
    elif kind == "lmrb" and _num(f.get("cost_min")) is not None or _num(f.get("cost_max")) is not None:
        out.append({"key": "cost", "label": "Cost", "value": f"{f.get('cost_min') or '0'} to {f.get('cost_max') or 'max'}"})
    return out


def filter_options(df: pd.DataFrame, kind: str, program_limit: int = 400) -> dict:
    """Distinct values for the filter controls."""
    if df.empty:
        return {}
    out: dict[str, Any] = {"date_min": df["date"].min().strftime("%Y-%m-%d"), "date_max": df["date"].max().strftime("%Y-%m-%d")}
    order_dp = nz.daypart_order()
    for key, col in MULTI[kind].items():
        if col not in df.columns:
            continue
        if kind == "lmrb" and key in ("advertiser",):
            vals = df.groupby(col)["cost"].sum().sort_values(ascending=False).index.tolist()
        elif key == "program" and kind == "lmrb":
            vals = df[col].value_counts().head(program_limit).index.tolist()
        elif key == "daypart":
            present = set(df[col].dropna().unique())
            vals = [d for d in order_dp if d in present] + sorted(present - set(order_dp))
        elif key == "day":
            vals = [d for d in ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] if d in set(df[col])]
        elif key == "duration_band":
            present = set(df[col].dropna().unique())
            vals = [d for d in nz.duration_band_order() if d in present]
        elif key == "ad_position":
            vals = ["first", "middle", "last"]
        else:
            vals = sorted(df[col].dropna().astype(str).unique().tolist())
        out[key] = [str(v) for v in vals]
    if kind == "tv":
        out["tvr_range"] = [float(df["tvr"].min()), float(df["tvr"].max())]
        out["data_set_list"] = sorted(df["data_set"].dropna().astype(str).unique().tolist())
    elif kind == "lmrb":
        out["cost_range"] = [float(df["cost"].min()), float(df["cost"].max())]
        pg = df.groupby("advertiser")["product_group"].agg(lambda s: sorted(set(s))).to_dict()
        out["advertiser_groups"] = pg
    return out
