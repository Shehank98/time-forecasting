"""TV programme (TVR sheet) analytics. Returns small JSON-safe aggregates."""
from __future__ import annotations

import logging

import numpy as np
import pandas as pd

from . import normalise as nz
from .util import jsonable, safe_div

log = logging.getLogger(__name__)

DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def _heat(df: pd.DataFrame, rows: str, cols: str, col_order: list[str] | None = None, value: str = "tvr", top_rows: int = 15) -> dict:
    if df.empty:
        return {"rows": [], "cols": [], "values": []}
    rs = df.groupby(rows)[value].mean().sort_values(ascending=False).head(top_rows).index.tolist()
    cs = [c for c in (col_order or sorted(df[cols].dropna().unique())) if c in set(df[cols])]
    pv = df.pivot_table(index=rows, columns=cols, values=value, aggfunc="mean").reindex(index=rs, columns=cs)
    return {"rows": rs, "cols": cs, "values": pv.values.tolist()}


def _group(df: pd.DataFrame, keys: list[str]) -> pd.DataFrame:
    g = df.groupby(keys).agg(airings=("tvr", "size"), avg_tvr=("tvr", "mean"), max_tvr=("tvr", "max"), avg_reach=("reach", "mean"),
                            total_reach=("reach", "sum"), avg_reach_pct=("reach_pct", "mean"), avg_share=("tvr_share", "mean"),
                            avg_duration=("duration", "mean")).reset_index()
    return g


def _timebelt_heat(df: pd.DataFrame) -> dict:
    from .series import timebelt_labels
    d = df.assign(timebelt=timebelt_labels(df["start_sec"])).dropna(subset=["timebelt"])
    if d.empty:
        return {"rows": [], "cols": [], "values": []}
    belts = sorted(d["timebelt"].unique())
    pv = d.pivot_table(index="timebelt", columns="day", values="tvr", aggfunc="mean").reindex(index=belts, columns=[x for x in DAY_ORDER if x in set(d["day"])])
    return {"rows": belts, "cols": list(pv.columns), "values": pv.values.tolist()}


def consistency(df: pd.DataFrame, min_airings: int = 2) -> list[dict]:
    """Mean, std dev and coefficient of variation of TVR per recurring programme slot."""
    g = df.groupby("program_key")["tvr"].agg(["count", "mean", "std", "min", "max"])
    g = g[g["count"] >= min_airings]
    rows = []
    for key, r in g.iterrows():
        cv = safe_div(r["std"], r["mean"])
        label = "Very reliable" if cv is not None and cv < 0.15 else "Reliable" if cv is not None and cv < 0.30 else "Variable" if cv is not None and cv < 0.50 else "Volatile"
        prog, ch, day, start = (key.split(" | ") + ["", "", "", ""])[:4]
        rows.append({"program": prog, "channel": ch, "day": day, "start": start, "airings": int(r["count"]), "mean_tvr": float(r["mean"]),
                     "std_tvr": float(r["std"]), "cv": cv, "min_tvr": float(r["min"]), "max_tvr": float(r["max"]), "reliability": label})
    return sorted(rows, key=lambda x: (x["cv"] is None, x["cv"]))[:500]


def opportunity(tv: pd.DataFrame, lmrb: pd.DataFrame | None) -> dict | None:
    """High TVR slots with low competitor ad load. None when LMRB is not loaded or no channels overlap."""
    if lmrb is None or lmrb.empty or tv.empty:
        return None
    common = set(tv["channel"]) & set(lmrb["channel"])
    if not common:
        return None
    t = tv[tv["channel"].isin(common)]
    tv_cell = t.groupby(["channel", "day", "daypart"]).agg(avg_tvr=("tvr", "mean"), airings=("tvr", "size")).reset_index()
    l = lmrb[lmrb["channel"].isin(common)]
    days = l.groupby(["channel", "day", "daypart"])["date"].nunique().rename("days")
    spots = l.groupby(["channel", "day", "daypart"]).agg(spots=("cost", "size"), spend=("cost", "sum"))
    load = spots.join(days).reset_index()
    load["ad_load_per_day"] = load["spots"] / load["days"].clip(lower=1)
    load["spend_per_day"] = load["spend"] / load["days"].clip(lower=1)
    m = tv_cell.merge(load, on=["channel", "day", "daypart"], how="left")
    m["ad_load_per_day"] = m["ad_load_per_day"].fillna(0.0)
    m["spend_per_day"] = m["spend_per_day"].fillna(0.0)
    m["tvr_pctile"] = m["avg_tvr"].rank(pct=True)
    m["load_pctile"] = m["ad_load_per_day"].rank(pct=True)
    m["score"] = m["tvr_pctile"] - m["load_pctile"]
    cand = m[(m["tvr_pctile"] >= 0.5) & (m["load_pctile"] <= 0.5)].sort_values("score", ascending=False)
    return {"rows": cand.head(30).to_dict("records"), "channels": sorted(common),
            "note": "Ad load counts monitored LMRB spots per day in the same channel, weekday and daypart."}


def dashboard(df: pd.DataFrame, lmrb: pd.DataFrame | None = None) -> dict:
    """All TV workspace aggregates for the (already filtered) frame."""
    if df.empty:
        return {"empty": True}
    by_prog = _group(df, ["program", "channel"]).sort_values("avg_tvr", ascending=False)
    by_chan = _group(df, ["channel"]).sort_values("avg_tvr", ascending=False)
    by_cat = _group(df, ["category"]).sort_values("avg_tvr", ascending=False)
    eff = by_prog.assign(tvr_per_min=by_prog["avg_tvr"] / by_prog["avg_duration"].replace(0, np.nan),
                         reach_per_min=by_prog["avg_reach"] / by_prog["avg_duration"].replace(0, np.nan)).sort_values("tvr_per_min", ascending=False)
    top_cats = by_cat.head(6)["category"].tolist()
    weeks = pd.date_range(df["week_start"].min(), df["week_start"].max(), freq="7D")
    trend = df[df["category"].isin(top_cats)].pivot_table(index="week_start", columns="category", values="tvr", aggfunc="mean").reindex(weeks)
    daily = df.groupby("date")["tvr"].mean()
    dpo = [d for d in nz.daypart_order()]
    top = by_prog.iloc[0]
    topc = by_chan.iloc[0]
    out = {
        "empty": False,
        "kpis": {"programmes": int(df["program"].nunique()), "channels": int(df["channel"].nunique()), "airings": int(len(df)),
                 "avg_tvr": float(df["tvr"].mean()), "total_reach": float(df["reach"].sum()),
                 "top_programme": {"name": top["program"], "channel": top["channel"], "avg_tvr": float(top["avg_tvr"])},
                 "top_channel": {"name": topc["channel"], "avg_tvr": float(topc["avg_tvr"])}},
        "top_programmes": by_prog.head(300).to_dict("records"),
        "by_channel": by_chan.to_dict("records"),
        "by_category": by_cat.to_dict("records"),
        "heat_category": _heat(df, "channel", "category"),
        "heat_daypart": _heat(df, "channel", "daypart", dpo),
        "heat_day": _heat(df, "channel", "day", DAY_ORDER),
        "heat_timebelt": _timebelt_heat(df),
        "category_trend": {"weeks": [str(w.date()) for w in weeks], "series": [{"name": c, "values": trend[c].tolist()} for c in trend.columns]},
        "daily_tvr": {"dates": [str(d.date()) for d in daily.index], "values": daily.tolist()},
        "efficiency": eff.head(300).to_dict("records"),
        "consistency": consistency(df),
        "opportunity": opportunity(df, lmrb),
    }
    return jsonable(out)
