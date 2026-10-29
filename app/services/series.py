"""Turn filtered frames into zero-filled, regularly spaced time series ready for forecasting."""
from __future__ import annotations

import json
import logging
import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from . import normalise as nz

log = logging.getLogger(__name__)

LMRB_ENTITIES = {"advertiser": "advertiser", "product_group": "product_group", "channel": "channel", "total": None}
LMRB_METRICS = {"spend": "Spend (LKR)", "spots": "Spot count", "sov": "Share of voice, spend (%)", "cps": "Cost per second (LKR)"}
TV_ENTITIES = {"channel": "channel", "category": "category", "daypart": "daypart", "program": "program_key", "total": None}
TV_METRICS = {"tvr": "Average TVR", "reach": "Average reach per airing"}
ADDITIVE = {"spend", "spots"}          # no activity means zero
SHARE = {"sov"}                         # no activity means zero share
NONNEG = {"spend", "spots", "sov", "cps", "tvr", "reach"}
FREQ_FLAG = {"daily": 0, "weekly": 1, "monthly": 1}   # TimesFM frequency indicator


@dataclass
class SeriesSpec:
    entity: str
    dates: pd.DatetimeIndex
    values: np.ndarray
    metric: str
    gran: str
    n_active: int
    n_observed: int
    notes: list[str] = field(default_factory=list)


def metric_catalog(kind: str) -> dict:
    return {"metrics": LMRB_METRICS if kind == "lmrb" else TV_METRICS,
            "entities": [k for k in (LMRB_ENTITIES if kind == "lmrb" else TV_ENTITIES)]}


def _entity_col(kind: str, entity_type: str) -> str | None:
    table = LMRB_ENTITIES if kind == "lmrb" else TV_ENTITIES
    if entity_type not in table:
        raise ValueError(f"Unknown entity type: {entity_type}")
    return table[entity_type]


def rank_entities(df: pd.DataFrame, kind: str, entity_type: str, limit: int = 60) -> list[dict]:
    """Candidate entities ranked by volume, for the entity picker."""
    col = _entity_col(kind, entity_type)
    if col is None:
        return [{"name": "All", "volume": float(df["cost"].sum() if kind == "lmrb" else len(df))}]
    if kind == "lmrb":
        g = df.groupby(col)["cost"].agg(["sum", "size"]).sort_values("sum", ascending=False)
        return [{"name": str(k), "volume": float(r["sum"]), "rows": int(r["size"])} for k, r in g.head(limit).iterrows()]
    g = df.groupby(col).agg(rows=("tvr", "size"), v=("tvr", "mean")).sort_values("rows", ascending=False)
    return [{"name": str(k), "volume": float(r["v"]), "rows": int(r["rows"])} for k, r in g.head(limit).iterrows()]


def _axis(df: pd.DataFrame, gran: str) -> tuple[pd.DatetimeIndex, str]:
    col = "date" if gran == "daily" else "week_start"
    freq = "D" if gran == "daily" else "7D"
    return pd.date_range(df[col].min(), df[col].max(), freq=freq), col


def build_series(df: pd.DataFrame, kind: str, entity_type: str, metric: str, gran: str,
                 entities: list[str] | None = None, history_days: int | None = None, max_entities: int = 8) -> tuple[list[SeriesSpec], list[str]]:
    """Build one regularly spaced series per entity. Returns (series, notes)."""
    metrics = LMRB_METRICS if kind == "lmrb" else TV_METRICS
    if metric not in metrics:
        raise ValueError(f"Unknown metric: {metric}")
    if gran not in ("daily", "weekly"):
        raise ValueError("granularity must be daily or weekly")
    notes: list[str] = []
    ecol = _entity_col(kind, entity_type)
    if entity_type == "program" and gran == "daily":
        gran = "weekly"
        notes.append("Programmes recur weekly, so the series was built weekly.")
    if df.empty:
        return [], ["No rows match the current filters."]
    if history_days:
        df = df[df["date"] >= df["date"].max() - pd.Timedelta(days=int(history_days) - 1)]
    idx, per = _axis(df, gran)
    d = df.assign(_ent=df[ecol].astype(str) if ecol else "All")
    # choose entities
    if not entities:
        ranked = rank_entities(d.assign(**({ecol: d["_ent"]} if ecol else {})), kind, entity_type, max_entities) if ecol else [{"name": "All"}]
        entities = [r["name"] for r in ranked]
    wanted = [e for e in entities if e in set(d["_ent"])]
    if not wanted:
        return [], ["None of the selected entities have rows in the filtered data."]
    # per-metric pivot over all entities (needed for share of voice)
    if metric == "spend":
        pv = d.pivot_table(index=per, columns="_ent", values="cost", aggfunc="sum")
    elif metric == "spots":
        pv = d.pivot_table(index=per, columns="_ent", values="cost", aggfunc="size")
    elif metric == "sov":
        raw = d.pivot_table(index=per, columns="_ent", values="cost", aggfunc="sum").reindex(idx).fillna(0.0)
        tot = raw.sum(axis=1).replace(0, np.nan)
        pv = raw.div(tot, axis=0).fillna(0.0) * 100.0
    elif metric == "cps":
        dd = d[d["dur"] > 0]
        s, t = dd.pivot_table(index=per, columns="_ent", values="cost", aggfunc="sum"), dd.pivot_table(index=per, columns="_ent", values="dur", aggfunc="sum")
        pv = s / t
    elif metric == "tvr":
        pv = d.pivot_table(index=per, columns="_ent", values="tvr", aggfunc="mean")
    else:
        pv = d.pivot_table(index=per, columns="_ent", values="reach", aggfunc="mean")
    pv = pv.reindex(idx)
    zero_fill = metric in ADDITIVE or metric in SHARE
    if metric in ADDITIVE and gran == "weekly" and len(idx) >= 6:
        dmin, dmax = df["date"].min(), df["date"].max()
        if dmin.dayofweek != 0:
            pv = pv.iloc[1:]; notes.append("Dropped the first partial week so totals are comparable.")
        if dmax.dayofweek != 6:
            pv = pv.iloc[:-1]; notes.append("Dropped the last partial week so totals are comparable.")
    out: list[SeriesSpec] = []
    for e in wanted:
        s = pv[e]
        n_obs = int(s.notna().sum())
        if zero_fill:
            s = s.fillna(0.0)
        else:
            s = s.interpolate(limit_direction="both")
            if s.isna().all():
                continue
        vals = s.to_numpy(dtype=float)
        out.append(SeriesSpec(entity=e, dates=pv.index, values=vals, metric=metric, gran=gran,
                              n_active=int((vals != 0).sum()), n_observed=n_obs if not zero_fill else len(vals)))
    if not zero_fill:
        notes.append("Periods with no airings or ads were filled by linear interpolation because they are missing, not zero.")
    return out, notes


# ------------------------------------------------------------------ calendar covariates
def calendar_events() -> tuple[list[tuple[pd.Timestamp, str]], list[tuple[pd.Timestamp, pd.Timestamp, str]]]:
    cfg = nz.load_config("holidays_lk.json")
    ev = [(pd.Timestamp(e["date"]), e.get("type", "public")) for e in cfg.get("events", [])]
    sch = [(pd.Timestamp(s["start"]), pd.Timestamp(s["end"]), "school_holiday") for s in cfg.get("school_holidays", [])]
    return ev, sch


def calendar_features(dates: pd.DatetimeIndex, gran: str) -> dict[str, np.ndarray]:
    """Event features aligned to dates. Weekly series use the count of event days in the week."""
    ev, sch = calendar_events()
    span = 1 if gran == "daily" else 7
    feats: dict[str, np.ndarray] = {}
    types = sorted({t for _, t in ev} | {t for _, _, t in sch})
    for t in types:
        arr = np.zeros(len(dates))
        for i, d0 in enumerate(dates):
            d1 = d0 + pd.Timedelta(days=span - 1)
            if t == "school_holiday":
                arr[i] = sum(max(0, (min(b, d1) - max(a, d0)).days + 1) for a, b, _ in sch)
            else:
                arr[i] = sum(1 for ed, et in ev if et == t and d0 <= ed <= d1)
        feats[f"is_{t}"] = arr
    return feats


def future_dates(last: pd.Timestamp, n: int, gran: str) -> pd.DatetimeIndex:
    step = pd.Timedelta(days=1 if gran == "daily" else 7)
    return pd.DatetimeIndex([last + step * (i + 1) for i in range(n)])


def horizon_points(horizon_days: int, gran: str) -> int:
    return int(horizon_days) if gran == "daily" else int(math.ceil(horizon_days / 7))
