"""Join LMRB spots to TVR programmes to estimate GRPs and Cost per Rating Point (CPRP).

Each spot is matched to the programme airing on the same channel and date whose
Start <= spot time < End. The spot rating is approximated by that programme's average
TVR for the chosen target audience (Data Set). This is the standard planning
approximation when minute-by-minute ratings are not available.
"""
from __future__ import annotations

import logging
import threading
from collections import OrderedDict

import numpy as np
import pandas as pd

from .ingest import to_seconds

log = logging.getLogger(__name__)

_cache: OrderedDict[tuple, tuple[pd.DataFrame, dict]] = OrderedDict()
_lock = threading.Lock()


def pick_data_set(tv: pd.DataFrame, wanted: str | None) -> str | None:
    sets = tv["data_set"].dropna().astype(str)
    if wanted and wanted in set(sets):
        return wanted
    return sets.value_counts().index[0] if len(sets) else None


def _tv_windows(tv: pd.DataFrame) -> pd.DataFrame:
    start = tv["start_sec"]
    end = to_seconds(tv["end"]) if "end" in tv.columns else pd.Series(np.nan, index=tv.index)
    end = end.fillna(start + tv["duration"].fillna(30) * 60)
    end = np.where(end <= start, end + 86400, end)          # programmes that cross midnight
    return tv.assign(end_sec=end)


def match_spots(lm: pd.DataFrame, tv: pd.DataFrame, data_set: str | None = None) -> tuple[pd.DataFrame, dict]:
    """Return LMRB rows with grp, matched_program and cost_matched columns, plus match statistics."""
    ds_name = pick_data_set(tv, data_set)
    t = tv[tv["data_set"].astype(str) == ds_name] if ds_name else tv
    t = _tv_windows(t[t["start_sec"].notna()])
    out = lm.copy()
    out["grp"] = np.nan
    out["matched_program"] = None
    if t.empty or lm.empty:
        out["cost_matched"] = 0.0
        return out, {"data_set": ds_name, "matched_spots": 0, "match_rate_pct": 0.0, "spots": int(len(lm))}
    key = lambda d: d["channel"].astype(str) + "|" + d["date"].dt.strftime("%Y-%m-%d")
    left = out.assign(_k=key(out), _row=np.arange(len(out)))
    left = left[left["start_sec"].notna()].sort_values("start_sec")
    right = t.assign(_k=key(t))[["_k", "start_sec", "end_sec", "tvr", "program"]].rename(columns={"start_sec": "p_start", "program": "p_program"}).sort_values("p_start")
    m = pd.merge_asof(left[["_row", "_k", "start_sec"]], right, left_on="start_sec", right_on="p_start", by="_k", direction="backward")
    ok = m["p_start"].notna() & (m["start_sec"] < m["end_sec"])
    hits = m[ok]
    out.iloc[hits["_row"].to_numpy(), out.columns.get_loc("grp")] = hits["tvr"].to_numpy()
    out.iloc[hits["_row"].to_numpy(), out.columns.get_loc("matched_program")] = hits["p_program"].to_numpy()
    out["cost_matched"] = np.where(out["grp"] > 0, out["cost"], 0.0)
    channels_tv = set(t["channel"])
    stats = {"data_set": ds_name, "data_sets": sorted(tv["data_set"].dropna().astype(str).unique().tolist()), "spots": int(len(lm)),
             "matched_spots": int(ok.sum()), "match_rate_pct": float(ok.sum() / len(lm) * 100) if len(lm) else 0.0,
             "spots_on_rated_channels_pct": float(lm["channel"].isin(channels_tv).mean() * 100) if len(lm) else 0.0,
             "tv_date_range": [str(tv["date"].min().date()), str(tv["date"].max().date())]}
    return out, stats


def with_grps(lmrb_ds, tv_ds, data_set: str | None = None) -> pd.DataFrame:
    """Cached join keyed by both dataset versions and the chosen audience."""
    key = (lmrb_ds.version, tv_ds.version, data_set or "")
    with _lock:
        if key in _cache:
            _cache.move_to_end(key)
            df, stats = _cache[key]
            df.attrs["grp_stats"] = stats
            return df
    df, stats = match_spots(lmrb_ds.df, tv_ds.df, data_set)
    df.attrs["grp_stats"] = stats
    with _lock:
        _cache[key] = (df, stats)
        while len(_cache) > 6:
            _cache.popitem(last=False)
    log.info("Matched %s of %s spots to programmes (%.0f%%)", stats["matched_spots"], stats["spots"], stats["match_rate_pct"])
    return df


def grp_summary(df: pd.DataFrame, by: str) -> list[dict]:
    """GRPs, CPRP and share of GRPs by a column, using matched spots only."""
    d = df[df["grp"] > 0]
    if d.empty:
        return []
    g = d.groupby(by).agg(grps=("grp", "sum"), cost=("cost", "sum"), spots=("cost", "size")).sort_values("grps", ascending=False)
    tot = g["grps"].sum()
    return [{"name": str(k), "grps": float(r.grps), "cost": float(r.cost), "spots": int(r.spots), "cprp": float(r.cost / r.grps) if r.grps > 0 else None,
             "grp_share_pct": float(r.grps / tot * 100) if tot else None, "avg_spot_rating": float(r.grps / r.spots)} for k, r in g.iterrows()]
