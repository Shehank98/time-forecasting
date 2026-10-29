"""Turn filtered frames into regularly spaced series ready for forecasting.

A small metric registry describes how each metric aggregates (sum, count, mean,
ratio or share) and whether a missing period means zero (no ad = 0 spend) or
unknown (no airing = gap to interpolate). The same code serves the TV, LMRB and
client KPI workspaces at daily, weekly or monthly granularity.
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from typing import Literal

import numpy as np
import pandas as pd

from . import normalise as nz

log = logging.getLogger(__name__)

Agg = Literal["sum", "count", "mean", "ratio", "share"]
GRANULARITIES = ("daily", "weekly", "monthly")
STEP = {"daily": "D", "weekly": "7D", "monthly": "MS"}
DAYS_PER = {"daily": 1, "weekly": 7, "monthly": 30.4}


@dataclass(frozen=True)
class MetricDef:
    key: str
    label: str
    agg: Agg
    col: str | None = None            # sum / mean / share column
    num: str | None = None            # ratio numerator
    den: str | None = None            # ratio denominator
    zero_fill: bool = True            # missing period means 0 (True) or unknown (False)
    unit: str = "number"              # number | currency | percent | rating
    scale: float = 1.0                # multiplier applied to ratios (e.g. 1000 for CPM)
    nonneg: bool = True

    @property
    def additive(self) -> bool:
        return self.agg in ("sum", "count")


@dataclass
class SeriesSpec:
    entity: str
    dates: pd.DatetimeIndex
    values: np.ndarray
    metric: str
    gran: str
    n_active: int
    n_observed: int
    mdef: MetricDef | None = None
    notes: list[str] = field(default_factory=list)


# ------------------------------------------------------------------ catalogs
def lmrb_metrics(df: pd.DataFrame | None = None) -> dict[str, MetricDef]:
    m = {
        "spend": MetricDef("spend", "Spend (LKR)", "sum", col="cost", unit="currency"),
        "spots": MetricDef("spots", "Spot count", "count"),
        "sov": MetricDef("sov", "Share of voice, spend (%)", "share", col="cost", unit="percent"),
        "cps": MetricDef("cps", "Cost per second (LKR)", "ratio", num="cost", den="dur", zero_fill=False, unit="currency"),
    }
    if df is not None and "grp" in df.columns and df["grp"].notna().any():
        m["grp"] = MetricDef("grp", "GRPs delivered", "sum", col="grp", unit="rating")
        m["cprp"] = MetricDef("cprp", "Cost per GRP, CPRP (LKR)", "ratio", num="cost_matched", den="grp", zero_fill=False, unit="currency")
        m["sog"] = MetricDef("sog", "Share of GRPs (%)", "share", col="grp", unit="percent")
    return m


TV_METRICS = {
    "tvr": MetricDef("tvr", "Average TVR", "mean", col="tvr", zero_fill=False, unit="rating"),
    "reach": MetricDef("reach", "Average reach per airing", "mean", col="reach", zero_fill=False),
    "share": MetricDef("share", "Average TVR share (%)", "mean", col="tvr_share", zero_fill=False, unit="percent"),
}

LMRB_ENTITIES = {"advertiser": "advertiser", "product_group": "product_group", "channel": "channel", "daypart": "daypart", "total": None}
TV_ENTITIES = {"channel": "channel", "category": "category", "daypart": "daypart", "timebelt": "timebelt", "program": "program_key", "total": None}
KPI_ENTITIES = {"segment": "segment", "total": None}


def kpi_metrics(meta: dict | None) -> dict[str, MetricDef]:
    """Metrics defined by the column mapping of a client KPI dataset, plus derived ratios."""
    out: dict[str, MetricDef] = {}
    if not meta:
        return out
    for m in meta.get("metrics", []):
        agg: Agg = "mean" if m.get("agg") == "mean" else "sum"
        out[m["key"]] = MetricDef(m["key"], m["label"], agg, col=m["key"], zero_fill=bool(m.get("zero_fill", agg == "sum")), unit=m.get("unit", "number"))
    for r in meta.get("ratios", []):
        if r["num"] in out and r["den"] in out:
            out[r["key"]] = MetricDef(r["key"], r["label"], "ratio", num=r["num"], den=r["den"], zero_fill=False, unit=r.get("unit", "currency"), scale=float(r.get("scale", 1.0)))
    return out


def catalog(kind: str, df: pd.DataFrame | None = None, meta: dict | None = None) -> tuple[dict[str, MetricDef], dict[str, str | None]]:
    if kind == "lmrb":
        return lmrb_metrics(df), LMRB_ENTITIES
    if kind == "tv":
        return TV_METRICS, TV_ENTITIES
    ents = dict(KPI_ENTITIES)
    if df is not None and ("segment" not in df.columns or df["segment"].nunique() <= 1):
        ents.pop("segment", None)
    return kpi_metrics(meta), ents


def metric_catalog(kind: str, df: pd.DataFrame | None = None, meta: dict | None = None) -> dict:
    metrics, ents = catalog(kind, df, meta)
    return {"metrics": {k: v.label for k, v in metrics.items()}, "units": {k: v.unit for k, v in metrics.items()},
            "entities": list(ents), "granularities": list(GRANULARITIES)}


# ------------------------------------------------------------------ helpers
def timebelt_labels(start_sec: pd.Series, minutes: int | None = None) -> pd.Series:
    """Floor programme start times into time-belts, e.g. '20:00-20:30'."""
    minutes = minutes or int(nz.load_config("dayparts.json").get("timebelt_minutes", 30))
    step = minutes * 60
    s = (start_sec // step) * step

    def lab(v: float) -> str | None:
        if pd.isna(v):
            return None
        a, b = int(v), int(v) + step
        return f"{a // 3600 % 24:02d}:{a % 3600 // 60:02d}-{b // 3600 % 24:02d}:{b % 3600 // 60:02d}"
    cache = {u: lab(u) for u in s.dropna().unique()}
    return s.map(cache)


def with_entity_columns(df: pd.DataFrame, kind: str) -> pd.DataFrame:
    if kind == "tv" and "timebelt" not in df.columns and "start_sec" in df.columns:
        return df.assign(timebelt=timebelt_labels(df["start_sec"]))
    return df


def period_column(df: pd.DataFrame, gran: str) -> pd.Series:
    if gran == "daily":
        return df["date"]
    if gran == "weekly":
        return df["date"] - pd.to_timedelta(df["date"].dt.dayofweek, unit="D")
    return df["date"].dt.to_period("M").dt.to_timestamp()


def axis(df: pd.DataFrame, gran: str) -> pd.DatetimeIndex:
    per = period_column(df, gran)
    return pd.date_range(per.min(), per.max(), freq=STEP[gran])


def _volume(df: pd.DataFrame, kind: str, metrics: dict[str, MetricDef], metric: str | None) -> pd.Series:
    if kind == "lmrb":
        return df["cost"]
    if kind == "kpi" and metric and metric in metrics:
        m = metrics[metric]
        c = m.col or m.den
        if c in df.columns:
            return df[c].fillna(0).abs()
    return pd.Series(1.0, index=df.index)


def rank_entities(df: pd.DataFrame, kind: str, entity_type: str, limit: int = 60, meta: dict | None = None, metric: str | None = None) -> list[dict]:
    """Candidate entities ranked by volume, for the entity picker."""
    metrics, ents = catalog(kind, df, meta)
    if entity_type not in ents:
        raise ValueError(f"Unknown entity type: {entity_type}")
    df = with_entity_columns(df, kind)
    col = ents[entity_type]
    vol = _volume(df, kind, metrics, metric)
    if col is None:
        return [{"name": "All", "volume": float(vol.sum()), "rows": int(len(df))}]
    g = vol.groupby(df[col].astype(str)).agg(["sum", "size"]).sort_values("sum", ascending=False)
    return [{"name": str(k), "volume": float(r["sum"]), "rows": int(r["size"])} for k, r in g.head(limit).iterrows()]


def _pivot(d: pd.DataFrame, per: str, m: MetricDef, idx: pd.DatetimeIndex) -> pd.DataFrame:
    if m.agg == "sum":
        pv = d.pivot_table(index=per, columns="_ent", values=m.col, aggfunc="sum")
    elif m.agg == "count":
        pv = d.pivot_table(index=per, columns="_ent", values=d.columns[0], aggfunc="size")
    elif m.agg == "mean":
        pv = d.pivot_table(index=per, columns="_ent", values=m.col, aggfunc="mean")
    elif m.agg == "share":
        raw = d.pivot_table(index=per, columns="_ent", values=m.col, aggfunc="sum").reindex(idx).fillna(0.0)
        tot = raw.sum(axis=1).replace(0, np.nan)
        return raw.div(tot, axis=0).fillna(0.0) * 100.0
    else:  # ratio over rows where the denominator is positive
        dd = d[d[m.den] > 0]
        s = dd.pivot_table(index=per, columns="_ent", values=m.num, aggfunc="sum")
        t = dd.pivot_table(index=per, columns="_ent", values=m.den, aggfunc="sum")
        pv = s / t * m.scale
    return pv.reindex(idx)


def build_series(df: pd.DataFrame, kind: str, entity_type: str, metric: str, gran: str, entities: list[str] | None = None,
                 history_days: int | None = None, max_entities: int = 8, meta: dict | None = None) -> tuple[list[SeriesSpec], list[str]]:
    """Build one regularly spaced series per entity. Returns (series, notes)."""
    metrics, ents = catalog(kind, df, meta)
    if metric not in metrics:
        raise ValueError(f"Unknown metric: {metric}")
    if entity_type not in ents:
        raise ValueError(f"Unknown entity type: {entity_type}")
    if gran not in GRANULARITIES:
        raise ValueError("granularity must be daily, weekly or monthly")
    m = metrics[metric]
    notes: list[str] = []
    if entity_type == "program" and gran == "daily":
        gran = "weekly"
        notes.append("Programmes recur weekly, so the series was built weekly.")
    if df.empty:
        return [], ["No rows match the current filters."]
    df = with_entity_columns(df, kind)
    if history_days:
        df = df[df["date"] >= df["date"].max() - pd.Timedelta(days=int(history_days) - 1)]
    for c in (m.col, m.num, m.den):
        if c and c not in df.columns:
            return [], [f"Column for {m.label} is not available in this data."]
    idx = axis(df, gran)
    ecol = ents[entity_type]
    d = df.assign(_ent=df[ecol].astype(str) if ecol else "All", _per=period_column(df, gran))
    if not entities:
        entities = [r["name"] for r in rank_entities(df, kind, entity_type, max_entities, meta, metric)]
    present = set(d["_ent"])
    wanted = [e for e in entities if e in present]
    if not wanted:
        return [], ["None of the selected entities have rows in the filtered data."]
    pv = _pivot(d, "_per", m, idx)
    if m.additive and gran in ("weekly", "monthly") and len(idx) >= 4:
        dmin, dmax = df["date"].min(), df["date"].max()
        first_partial = dmin.dayofweek != 0 if gran == "weekly" else dmin.day != 1
        last_partial = dmax.dayofweek != 6 if gran == "weekly" else dmax != dmax + pd.offsets.MonthEnd(0)
        if first_partial:
            pv = pv.iloc[1:]; notes.append(f"Dropped the first partial {gran[:-2] if gran != 'daily' else 'day'} so totals are comparable.")
        if last_partial:
            pv = pv.iloc[:-1]; notes.append(f"Dropped the last partial {gran[:-2]} so totals are comparable.")
    out: list[SeriesSpec] = []
    for e in wanted:
        if e not in pv.columns:
            s = pd.Series(np.nan, index=pv.index)
        else:
            s = pv[e]
        n_obs = int(s.notna().sum())
        if m.zero_fill:
            s = s.fillna(0.0)
        else:
            if n_obs == 0:
                continue
            s = s.interpolate(limit_direction="both")
        vals = s.to_numpy(dtype=float)
        out.append(SeriesSpec(entity=e, dates=pd.DatetimeIndex(pv.index), values=vals, metric=metric, gran=gran, mdef=m,
                              n_active=int((vals != 0).sum()), n_observed=len(vals) if m.zero_fill else n_obs))
    if not m.zero_fill:
        notes.append("Periods with no data were filled by linear interpolation because they are missing, not zero.")
    return out, notes


# ------------------------------------------------------------------ calendar covariates
def calendar_events() -> tuple[list[tuple[pd.Timestamp, str]], list[tuple[pd.Timestamp, pd.Timestamp, str]]]:
    cfg = nz.load_config("holidays_lk.json")
    ev = [(pd.Timestamp(e["date"]), e.get("type", "public")) for e in cfg.get("events", [])]
    sch = [(pd.Timestamp(s["start"]), pd.Timestamp(s["end"]), "school_holiday") for s in cfg.get("school_holidays", [])]
    return ev, sch


def period_end(d0: pd.Timestamp, gran: str) -> pd.Timestamp:
    if gran == "daily":
        return d0
    if gran == "weekly":
        return d0 + pd.Timedelta(days=6)
    return d0 + pd.offsets.MonthEnd(0)


def calendar_features(dates: pd.DatetimeIndex, gran: str) -> dict[str, np.ndarray]:
    """Event features aligned to dates. Weekly and monthly series count event days in the period."""
    ev, sch = calendar_events()
    feats: dict[str, np.ndarray] = {}
    types = sorted({t for _, t in ev} | {t for _, _, t in sch})
    for t in types:
        arr = np.zeros(len(dates))
        for i, d0 in enumerate(dates):
            d1 = period_end(d0, gran)
            if t == "school_holiday":
                arr[i] = sum(max(0, (min(b, d1) - max(a, d0)).days + 1) for a, b, _ in sch)
            else:
                arr[i] = sum(1 for ed, et in ev if et == t and d0 <= ed <= d1)
        feats[f"is_{t}"] = arr
    return feats


def future_dates(last: pd.Timestamp, n: int, gran: str) -> pd.DatetimeIndex:
    return pd.date_range(last, periods=n + 1, freq=STEP[gran])[1:]


def horizon_points(horizon_days: int, gran: str) -> int:
    return max(1, int(math.ceil(horizon_days / DAYS_PER[gran])))


def season_length(gran: str, n: int) -> int:
    """Seasonal period used by the baseline and the fallback model."""
    m = {"daily": 7, "weekly": 52, "monthly": 12}[gran]
    return m if n >= 2 * m else 1
