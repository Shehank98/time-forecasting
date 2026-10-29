"""Competitor analysis on LMRB ad monitoring data.

All functions take pandas frames and return plain dicts of small aggregates
(JSON safe via util.jsonable). Nothing here ships raw rows to the browser.
"""
from __future__ import annotations

import logging
from typing import Any

import numpy as np
import pandas as pd

from . import normalise as nz
from .util import jsonable, pct_change, safe_div

log = logging.getLogger(__name__)

TOP_ADVERTISERS = 8
ALERT_CHANGE_PCT = 30.0
DISCOUNT_INDEX = 0.80
PREMIUM_INDEX = 1.25
MIN_SPOTS_PRICING = 3


# --------------------------------------------------------------- scope / windows
def competitor_set(df: pd.DataFrame, my_brand: str | None, competitors: list[str] | None) -> list[str]:
    """Advertisers in scope: my brand plus explicit competitors, else same product group."""
    if not my_brand:
        return sorted(df["advertiser"].unique().tolist())
    if competitors:
        return sorted(set(competitors) | {my_brand})
    groups = df.loc[df["advertiser"] == my_brand, "product_group"].unique()
    return sorted(df.loc[df["product_group"].isin(groups), "advertiser"].unique().tolist() or [my_brand])


def date_slice(df: pd.DataFrame, start: pd.Timestamp, end: pd.Timestamp) -> pd.DataFrame:
    return df[(df["date"] >= start) & (df["date"] <= end)]


def comparison_windows(scope: pd.DataFrame, start: pd.Timestamp, end: pd.Timestamp, force_weekly: bool = False) -> dict:
    """Pick current and previous windows.

    Normal mode: the equal-length period right before the filter window when
    data exists there. Otherwise (or when forced) compare the last 7 days with
    the 7 days before, shrinking the window for very short histories.
    """
    n_days = (end - start).days + 1
    if not force_weekly:
        prev_end = start - pd.Timedelta(days=1)
        prev_start = start - pd.Timedelta(days=n_days)
        if len(date_slice(scope, prev_start, prev_end)):
            return {"mode": "period", "cur": (start, end), "prev": (prev_start, prev_end)}
    w = 7 if (force_weekly or n_days >= 14) else n_days // 2
    if w < 1:
        return {"mode": "none", "cur": (start, end), "prev": None}
    return {"mode": "weekly" if w == 7 else "short",
            "cur": (end - pd.Timedelta(days=w - 1), end),
            "prev": (end - pd.Timedelta(days=2 * w - 1), end - pd.Timedelta(days=w))}


def _win_meta(w: dict) -> dict:
    return {"mode": w["mode"], "cur": [str(w["cur"][0].date()), str(w["cur"][1].date())],
            "prev": [str(w["prev"][0].date()), str(w["prev"][1].date())] if w["prev"] else None}


# --------------------------------------------------------------- building blocks
def kpi_block(df: pd.DataFrame) -> dict:
    spend = float(df["cost"].sum())
    spots = int(len(df))
    valid = df[df["dur"] > 0]
    return {
        "total_spend": spend, "spots": spots,
        "avg_cost_per_spot": safe_div(spend, spots),
        "avg_cost_per_second": safe_div(float(valid["cost"].sum()), float(valid["dur"].sum())),
        "active_creatives": int(df["creative_id"].nunique()),
        "active_channels": int(df["channel"].nunique()),
        "active_advertisers": int(df["advertiser"].nunique()),
    }


def breakdown(cur: pd.DataFrame, cmp_cur: pd.DataFrame, cmp_prev: pd.DataFrame | None, col: str, limit: int = 500) -> list[dict]:
    """Ranked table of spend and spots by a column with share and change vs previous period."""
    if cur.empty:
        return []
    g = cur.groupby(col).agg(spend=("cost", "sum"), spots=("cost", "size")).sort_values("spend", ascending=False)
    total = g["spend"].sum()
    total_spots = g["spots"].sum()
    cc = cmp_cur.groupby(col)["cost"].sum() if len(cmp_cur) else pd.Series(dtype=float)
    pp = cmp_prev.groupby(col)["cost"].sum() if cmp_prev is not None and len(cmp_prev) else pd.Series(dtype=float)
    rows = []
    for rank, (name, r) in enumerate(g.head(limit).iterrows(), 1):
        c, p = float(cc.get(name, 0.0)), float(pp.get(name, 0.0)) if cmp_prev is not None else None
        rows.append({"name": str(name), "rank": rank, "spend": float(r.spend), "spots": int(r.spots),
                     "share_pct": safe_div(r.spend, total) * 100 if total else None,
                     "spot_share_pct": safe_div(r.spots, total_spots) * 100 if total_spots else None,
                     "prev_spend": p, "change_pct": pct_change(c, p) if p is not None else None})
    return rows


def weekly_axis(df: pd.DataFrame) -> pd.DatetimeIndex:
    if df.empty:
        return pd.DatetimeIndex([])
    return pd.date_range(df["week_start"].min(), df["week_start"].max(), freq="7D")


def sov_weekly(df: pd.DataFrame, top_n: int = TOP_ADVERTISERS) -> dict:
    """Weekly spend and spots by advertiser (top N plus Others), zero filled."""
    if df.empty:
        return {"weeks": [], "advertisers": []}
    weeks = weekly_axis(df)
    order = df.groupby("advertiser")["cost"].sum().sort_values(ascending=False).index.tolist()
    top = order[:top_n]
    d = df.assign(adv=np.where(df["advertiser"].isin(top), df["advertiser"], "Others"))
    spend = d.pivot_table(index="week_start", columns="adv", values="cost", aggfunc="sum", fill_value=0).reindex(weeks, fill_value=0)
    spots = d.pivot_table(index="week_start", columns="adv", values="cost", aggfunc="size", fill_value=0).reindex(weeks, fill_value=0)
    names = top + (["Others"] if "Others" in spend.columns else [])
    return {"weeks": [str(w.date()) for w in weeks],
            "advertisers": [{"name": n, "spend": spend[n].tolist(), "spots": spots[n].tolist()} for n in names]}


def matrix(df: pd.DataFrame, rows: str, cols: str, value: str = "cost", agg: str = "sum", top_rows: int = 12, top_cols: int = 14,
           col_order: list[str] | None = None) -> dict:
    """Pivot into a heatmap friendly structure."""
    if df.empty:
        return {"rows": [], "cols": [], "values": []}
    rs = df.groupby(rows)["cost"].sum().sort_values(ascending=False).head(top_rows).index.tolist()
    cs = col_order or df.groupby(cols)["cost"].sum().sort_values(ascending=False).head(top_cols).index.tolist()
    sub = df[df[rows].isin(rs) & df[cols].isin(cs)]
    pv = sub.pivot_table(index=rows, columns=cols, values=value, aggfunc=agg).reindex(index=rs, columns=cs)
    return {"rows": rs, "cols": cs, "values": pv.values.tolist()}


def program_mix(df: pd.DataFrame, top_prog: int = 15, top_adv: int = 10) -> dict:
    if df.empty:
        return {"rows": [], "cols": [], "values": []}
    d = df.assign(chprog=df["channel"] + " / " + df["program"])
    return matrix(d, "advertiser", "chprog", top_rows=top_adv, top_cols=top_prog)


# --------------------------------------------------------------- flighting
def _runs(mask: np.ndarray) -> list[tuple[int, int]]:
    runs, start = [], None
    for i, v in enumerate(mask):
        if v and start is None:
            start = i
        if not v and start is not None:
            runs.append((start, i - 1))
            start = None
    if start is not None:
        runs.append((start, len(mask) - 1))
    return runs


def flight_stats(sub: pd.DataFrame, win_start: pd.Timestamp, win_end: pd.Timestamp) -> dict:
    """Flighting summary for one advertiser: span, gaps, bursts and pattern label."""
    days = pd.date_range(win_start, win_end, freq="D")
    spend = sub.groupby("date")["cost"].sum().reindex(days, fill_value=0.0)
    spots = sub.groupby("date")["cost"].size().reindex(days, fill_value=0)
    active = (spots > 0).to_numpy()
    first, last = sub["date"].min(), sub["date"].max()
    span = int((last - first).days + 1)
    active_days = int(active.sum())
    inside = active[(days >= first) & (days <= last)]
    gap_runs = [r for r in _runs(~inside) if r[1] - r[0] + 1 >= 2]
    longest_gap = max([r[1] - r[0] + 1 for r in gap_runs], default=0)
    wk = spend.groupby(days - pd.to_timedelta(days.dayofweek, unit="D")).sum()
    active_weeks = int((wk > 0).sum())
    cv = safe_div(float(wk.std(ddof=0)), float(wk.mean())) if wk.mean() > 0 else None
    thr = spend.mean() + spend.std(ddof=0)
    burst_mask = (spend.to_numpy() > thr) & (spend.std(ddof=0) > 0)
    merged = _runs(np.convolve(burst_mask.astype(int), [1, 1, 1], mode="same") > 0) if burst_mask.any() else []
    bursts = []
    for a, b in merged:
        seg = spend.iloc[a:b + 1]
        if (seg.to_numpy() > thr).any():
            bursts.append({"start": str(seg.index[0].date()), "end": str(seg.index[-1].date()), "days": int(len(seg)), "spend": float(seg.sum())})
    n_weeks = max(len(wk), 1)
    coverage = active_weeks / n_weeks
    if active_days <= 2:
        pattern = "One-off"
    elif n_weeks >= 2 and coverage >= 0.85 and (cv or 0) < 0.5 and longest_gap < 7:
        pattern = "Always-on"
    elif len(bursts) >= 2 or longest_gap >= 7 or (cv or 0) >= 0.8:
        pattern = "Pulsing"
    elif span < 0.6 * len(days):
        pattern = "Single flight"
    else:
        pattern = "Steady (uneven)"
    return {"first_date": str(first.date()), "last_date": str(last.date()), "span_days": span, "active_days": active_days,
            "active_ratio": active_days / max(len(days), 1), "active_weeks": active_weeks, "total_weeks": n_weeks,
            "longest_gap_days": longest_gap, "gaps": [{"start": str(days[a + (days.get_loc(first))].date()), "days": b - a + 1} for a, b in gap_runs[:5]],
            "bursts": sorted(bursts, key=lambda x: -x["spend"])[:5], "burst_count": len(bursts), "pattern": pattern,
            "weekly_cv": cv}


def flighting(cur: pd.DataFrame, start: pd.Timestamp, end: pd.Timestamp, top_n: int = 12) -> dict:
    if cur.empty:
        return {"advertisers": [], "calendar": {"dates": [], "rows": []}}
    order = cur.groupby("advertiser")["cost"].sum().sort_values(ascending=False).index.tolist()
    stats = []
    for a in order[:60]:
        s = flight_stats(cur[cur["advertiser"] == a], start, end)
        s["advertiser"] = a
        s["spend"] = float(cur.loc[cur["advertiser"] == a, "cost"].sum())
        s["spots"] = int((cur["advertiser"] == a).sum())
        stats.append(s)
    days = pd.date_range(start, end, freq="D")
    top = order[:top_n]
    cal = cur[cur["advertiser"].isin(top)].groupby(["advertiser", "date"]).size().unstack(fill_value=0).reindex(index=top, columns=days, fill_value=0)
    return {"advertisers": stats, "calendar": {"dates": [str(d.date()) for d in days], "rows": top, "values": cal.values.tolist()}}


# --------------------------------------------------------------- creatives
def creatives(df_all: pd.DataFrame, cur: pd.DataFrame, prev: pd.DataFrame | None, cmp_cur: pd.DataFrame, cmp_start: pd.Timestamp) -> list[dict]:
    """Creative tracker with NEW and DROPPED flags versus the previous window."""
    if cur.empty:
        return []
    agg = cur.groupby("creative_id").agg(
        advertiser=("advertiser", "first"), product=("product", "first"), theme=("theme", "first"),
        first_seen=("date", "min"), last_seen=("date", "max"), spots=("cost", "size"), spend=("cost", "sum"),
        channels=("channel", lambda s: sorted(s.unique())))
    first_ever = df_all.groupby("creative_id")["date"].min()
    cmp_ids = set(cmp_cur["creative_id"].unique())
    prev_ids = set(prev["creative_id"].unique()) if prev is not None and len(prev) else None
    rows = []
    for cid, r in agg.iterrows():
        status = "ACTIVE"
        if prev_ids is not None:
            if cid in cmp_ids and cid not in prev_ids:
                status = "NEW" if first_ever.get(cid, r.first_seen) >= cmp_start else "RETURNING"
            elif cid not in cmp_ids:
                status = "PAUSED"
        rows.append({"creative_id": cid, "advertiser": r.advertiser, "product": r["product"], "theme": r["theme"],
                     "first_seen": r.first_seen, "last_seen": r.last_seen, "spots": int(r.spots), "spend": float(r.spend),
                     "channels": r.channels, "channel_count": len(r.channels), "status": status})
    if prev is not None and len(prev):
        for cid in prev_ids - cmp_ids - set(agg.index):
            p = prev[prev["creative_id"] == cid]
            rows.append({"creative_id": cid, "advertiser": p["advertiser"].iloc[0], "product": p["product"].iloc[0], "theme": p["theme"].iloc[0],
                         "first_seen": p["date"].min(), "last_seen": p["date"].max(), "spots": 0, "spend": 0.0,
                         "channels": sorted(p["channel"].unique()), "channel_count": p["channel"].nunique(), "status": "DROPPED"})
    return sorted(rows, key=lambda x: (x["status"] != "NEW", x["status"] != "DROPPED", -x["spend"]))


# --------------------------------------------------------------- pricing
def pricing(cur: pd.DataFrame) -> dict:
    """Cost per second intelligence: cells vs channel x daypart median, discounts and outliers."""
    d = cur[cur["cps"].notna() & cur["dur"].gt(0)]
    if d.empty:
        return {"cells": [], "discount_flags": [], "outliers": [], "heatmap": {"rows": [], "cols": [], "values": []}, "outlier_counts": {}}
    med = d.groupby(["channel", "daypart"])["cps"].median().rename("median_cps")
    cells = d.groupby(["advertiser", "channel", "daypart"]).agg(spots=("cost", "size"), spend=("cost", "sum"), seconds=("dur", "sum")).reset_index()
    cells["cps"] = cells["spend"] / cells["seconds"]
    cells = cells.merge(med.reset_index(), on=["channel", "daypart"])
    cells["index_vs_median"] = cells["cps"] / cells["median_cps"]
    cells["flag"] = np.select(
        [(cells["index_vs_median"] < DISCOUNT_INDEX) & (cells["spots"] >= MIN_SPOTS_PRICING),
         (cells["index_vs_median"] > PREMIUM_INDEX) & (cells["spots"] >= MIN_SPOTS_PRICING)],
        ["Below median (possible discount)", "Above median (premium)"], default="")
    cells = cells.sort_values("spend", ascending=False)
    # Tukey outliers per channel x daypart
    grp = d.groupby(["channel", "daypart"])["cps"]
    q1, q3, n = grp.transform(lambda s: s.quantile(0.25)), grp.transform(lambda s: s.quantile(0.75)), grp.transform("size")
    iqr = q3 - q1
    out_mask = (n >= 8) & (iqr > 0) & ((d["cps"] < q1 - 1.5 * iqr) | (d["cps"] > q3 + 1.5 * iqr))
    outs = d[out_mask].copy()
    outs = outs.merge(med.reset_index(), on=["channel", "daypart"], how="left")
    heat = matrix(d.assign(cost2=d["cps"]), "channel", "daypart", value="cps", agg="median", top_rows=12, col_order=[x for x in nz.daypart_order() if x in set(d["daypart"])])
    return {"cells": cells.head(1000).to_dict("records"),
            "discount_flags": cells[cells["flag"].str.startswith("Below")].head(50).to_dict("records"),
            "outliers": outs.sort_values("cps")[["date", "advertiser", "channel", "daypart", "program", "dur", "cost", "cps", "median_cps"]].head(25).to_dict("records"),
            "outlier_counts": outs.groupby("advertiser").size().sort_values(ascending=False).to_dict(), "heatmap": heat}


# --------------------------------------------------------------- position
def position_strategy(cur: pd.DataFrame) -> list[dict]:
    d = cur[cur["position"] != "unknown"]
    if d.empty:
        return []
    tot_first, tot_last = int(d["is_first"].sum()), int(d["is_last"].sum())
    g = d.groupby("advertiser").agg(spots=("cost", "size"), first_n=("is_first", "sum"), last_n=("is_last", "sum"), spend=("cost", "sum"))
    rows = []
    for name, r in g.sort_values("spend", ascending=False).iterrows():
        rows.append({"advertiser": name, "spots": int(r.spots), "spend": float(r.spend), "first_n": int(r.first_n), "last_n": int(r.last_n),
                     "first_rate_pct": r.first_n / r.spots * 100, "last_rate_pct": r.last_n / r.spots * 100,
                     "share_of_first_pct": safe_div(r.first_n, tot_first) * 100 if tot_first else None,
                     "share_of_last_pct": safe_div(r.last_n, tot_last) * 100 if tot_last else None})
    return rows


# --------------------------------------------------------------- alerts
def alerts(scope_all: pd.DataFrame, end: pd.Timestamp, my_brand: str | None, price: dict | None = None) -> dict:
    """Rule based competitor movement alerts using last 7 days vs the 7 days before."""
    notes: list[str] = []
    if scope_all.empty:
        return {"items": [], "notes": ["No data in scope."], "window": None}
    w = comparison_windows(scope_all, end - pd.Timedelta(days=6), end, force_weekly=True)
    (c0, c1), (p0, p1) = w["cur"], w["prev"]
    cur, prev = date_slice(scope_all, c0, c1), date_slice(scope_all, p0, p1)
    data_min = scope_all["date"].min()
    if data_min > p0:
        notes.append(f"History starts {data_min.date()}, so week-on-week alerts only cover {max((c1 - data_min).days + 1, 0)} days.")
    if prev.empty:
        notes.append("No spots in the previous 7 days, so changes are shown as launches only.")
    items: list[dict] = []
    sc, sp = cur.groupby("advertiser")["cost"].sum(), prev.groupby("advertiser")["cost"].sum()
    total_cur = float(sc.sum()) or 1.0

    def add(sev: str, typ: str, adv: str, text: str, evidence: dict, mag: float = 0.0) -> None:
        items.append({"severity": sev, "type": typ, "advertiser": adv, "is_mine": adv == my_brand, "text": text, "evidence": evidence, "magnitude": mag})

    for adv in sorted(set(sc.index) | set(sp.index)):
        c, p = float(sc.get(adv, 0.0)), float(sp.get(adv, 0.0))
        cd = cur[cur["advertiser"] == adv].groupby(["channel", "daypart"])["cost"].sum()
        pd_ = prev[prev["advertiser"] == adv].groupby(["channel", "daypart"])["cost"].sum()
        delta = cd.subtract(pd_, fill_value=0.0)
        top_cell = (delta.abs().idxmax() if len(delta) else None)
        where = f" on {top_cell[0].title()} {top_cell[1].lower()}" if top_cell else ""
        ev = {"spend_last_7d": c, "spend_prev_7d": p}
        if p > 0 and c > 0:
            ch = pct_change(c, p)
            if ch is not None and ch >= ALERT_CHANGE_PCT and c >= 0.01 * total_cur:
                add("high" if ch >= 60 else "medium", "spend_up", adv, f"{adv} increased spend {ch:.0f}% week on week{where}.", {**ev, "change_pct": ch}, ch)
            elif ch is not None and ch <= -ALERT_CHANGE_PCT and p >= 0.01 * float(sp.sum() or 1):
                add("medium", "spend_down", adv, f"{adv} cut spend {abs(ch):.0f}% week on week{where}.", {**ev, "change_pct": ch}, abs(ch))
        elif p == 0 and c > 0 and not prev.empty:
            add("high", "returned", adv, f"{adv} is back on air after no activity in the previous 7 days.", ev, 100)
        elif c == 0 and p > 0:
            add("high", "stopped", adv, f"{adv} went off air this week (spent {p:,.0f} LKR the week before).", ev, 100)
        # channel starts and stops
        cch = set(cur.loc[cur["advertiser"] == adv, "channel"]); pch = set(prev.loc[prev["advertiser"] == adv, "channel"])
        if pch:
            for ch_name in sorted(pch - cch):
                if c > 0:
                    lost = float(prev[(prev["advertiser"] == adv) & (prev["channel"] == ch_name)]["cost"].sum())
                    add("medium", "channel_stop", adv, f"{adv} stopped {ch_name.title()} (was LKR {lost:,.0f} the week before).", {"channel": ch_name, "prev_spend": lost}, lost / max(p, 1) * 100)
            for ch_name in sorted(cch - pch):
                gain = float(cur[(cur["advertiser"] == adv) & (cur["channel"] == ch_name)]["cost"].sum())
                add("medium", "channel_start", adv, f"{adv} started on {ch_name.title()} (LKR {gain:,.0f} this week).", {"channel": ch_name, "spend": gain}, gain / max(c, 1) * 100)
    # creatives
    fe = scope_all.groupby("creative_id")["date"].min()
    cur_ids, prev_ids = set(cur["creative_id"]), set(prev["creative_id"])
    for cid in sorted(cur_ids - prev_ids):
        if fe[cid] > data_min and fe[cid] >= c0:
            r = cur[cur["creative_id"] == cid].iloc[0]
            add("medium", "new_creative", r["advertiser"], f"{r['advertiser']} launched a new creative: {r['theme']} ({r['product']}).",
                {"first_seen": str(fe[cid].date()), "spots": int((cur['creative_id'] == cid).sum())}, 50)
    for cid in sorted(prev_ids - cur_ids):
        r = prev[prev["creative_id"] == cid].iloc[0]
        add("low", "dropped_creative", r["advertiser"], f"{r['advertiser']} dropped creative {r['theme']} ({r['product']}) this week.",
            {"last_seen": str(prev[prev['creative_id'] == cid]['date'].max().date())}, 10)
    if price:
        for f in price.get("discount_flags", [])[:5]:
            add("low", "discount", f["advertiser"], f"{f['advertiser']} pays {(1 - f['index_vs_median']) * 100:.0f}% below the {f['channel'].title()} {f['daypart'].lower()} median cost per second (possible discount deal).",
                {"index_vs_median": f["index_vs_median"], "spots": f["spots"]}, (1 - f["index_vs_median"]) * 30)
    rank = {"high": 0, "medium": 1, "low": 2}
    items.sort(key=lambda x: (rank[x["severity"]], not x["is_mine"], -x["magnitude"]))
    return {"items": items[:60], "notes": notes, "window": {"cur": [str(c0.date()), str(c1.date())], "prev": [str(p0.date()), str(p1.date())]}}


# --------------------------------------------------------------- dashboard
def dashboard(df_nodate: pd.DataFrame, start: pd.Timestamp | None, end: pd.Timestamp | None,
              my_brand: str | None = None, competitors: list[str] | None = None) -> dict:
    """Everything the LMRB dashboard needs, as one JSON-safe dict."""
    if df_nodate.empty:
        return {"empty": True}
    start = start if start is not None and pd.notna(start) else df_nodate["date"].min()
    end = end if end is not None and pd.notna(end) else df_nodate["date"].max()
    brands = competitor_set(df_nodate, my_brand, competitors)
    scope_all = df_nodate[df_nodate["advertiser"].isin(brands)]
    cur = date_slice(scope_all, start, end)
    if cur.empty:
        return {"empty": True, "scope": brands}
    win = comparison_windows(scope_all, start, end)
    cmp_cur = cur if win["mode"] == "period" else date_slice(scope_all, *win["cur"])
    cmp_prev = date_slice(scope_all, *win["prev"]) if win["prev"] else None
    k = kpi_block(cur)
    mine = cur[cur["advertiser"] == my_brand] if my_brand else cur.iloc[0:0]
    k["sov_spend_pct"] = safe_div(float(mine["cost"].sum()), k["total_spend"]) * 100 if my_brand and k["total_spend"] else None
    k["sov_spots_pct"] = safe_div(len(mine), k["spots"]) * 100 if my_brand and k["spots"] else None
    by_adv = cur.groupby("advertiser")["cost"].sum().sort_values(ascending=False)
    k["my_rank"] = int(list(by_adv.index).index(my_brand) + 1) if my_brand and my_brand in by_adv.index else None
    if cmp_prev is not None and len(cmp_prev):
        k["spend_change_pct"] = pct_change(float(cmp_cur["cost"].sum()), float(cmp_prev["cost"].sum()))
        k["spots_change_pct"] = pct_change(float(len(cmp_cur)), float(len(cmp_prev)))
    price = pricing(cur)
    all_adv = df_nodate.groupby("advertiser")["cost"].sum().sort_values(ascending=False).index.tolist()
    out = {
        "empty": False, "scope": brands, "my_brand": my_brand, "window": {"start": str(start.date()), "end": str(end.date())},
        "comparison": _win_meta(win), "kpis": k,
        "advertiser_order": cur.groupby("advertiser")["cost"].sum().sort_values(ascending=False).index.tolist(),
        "all_advertiser_order": all_adv,
        "sov_weekly": sov_weekly(cur),
        "by_advertiser": breakdown(cur, cmp_cur, cmp_prev, "advertiser"),
        "by_product": breakdown(cur, cmp_cur, cmp_prev, "product"),
        "by_channel": breakdown(cur, cmp_cur, cmp_prev, "channel"),
        "by_daypart": _ordered(breakdown(cur, cmp_cur, cmp_prev, "daypart"), nz.daypart_order()),
        "by_language": breakdown(cur, cmp_cur, cmp_prev, "lng"),
        "by_product_group": breakdown(cur, cmp_cur, cmp_prev, "product_group"),
        "mix_channel": matrix(cur, "advertiser", "channel"),
        "mix_daypart": matrix(cur, "advertiser", "daypart", col_order=[d for d in nz.daypart_order() if d in set(cur["daypart"])]),
        "mix_program": program_mix(cur),
        "flighting": flighting(cur, start, end),
        "creatives": creatives(df_nodate, cur, date_slice(scope_all, *win["prev"]) if win["prev"] else None, cmp_cur, win["cur"][0]),
        "pricing": price, "position": position_strategy(cur),
        "alerts": alerts(scope_all, min(end, scope_all["date"].max()), my_brand, price),
    }
    return jsonable(out)


def _ordered(rows: list[dict], order: list[str]) -> list[dict]:
    idx = {n: i for i, n in enumerate(order)}
    return sorted(rows, key=lambda r: idx.get(r["name"], 99))


def head_to_head(df_nodate: pd.DataFrame, start: pd.Timestamp | None, end: pd.Timestamp | None, a: str, b: str) -> dict:
    """Side by side comparison of two advertisers on the same filtered data."""
    if df_nodate.empty:
        return {"empty": True}
    start = start if start is not None and pd.notna(start) else df_nodate["date"].min()
    end = end if end is not None and pd.notna(end) else df_nodate["date"].max()
    cur = date_slice(df_nodate, start, end)
    out: dict[str, Any] = {"empty": False, "a": a, "b": b, "window": {"start": str(start.date()), "end": str(end.date())}, "sides": {}}
    for name in (a, b):
        d = cur[cur["advertiser"] == name]
        if d.empty:
            out["sides"][name] = {"kpis": kpi_block(d), "empty": True}
            continue
        pos = position_strategy(d)
        out["sides"][name] = {
            "empty": False, "kpis": kpi_block(d),
            "flighting": flight_stats(d, start, end),
            "by_channel": breakdown(d, d, None, "channel"), "by_daypart": _ordered(breakdown(d, d, None, "daypart"), nz.daypart_order()),
            "by_language": breakdown(d, d, None, "lng"), "by_product": breakdown(d, d, None, "product"),
            "weekly": sov_weekly(d, 1)["advertisers"][0] if len(d) else None,
            "weeks": sov_weekly(d, 1)["weeks"],
            "position": pos[0] if pos else None,
            "prime_spend_pct": safe_div(float(d.loc[d["is_prime"], "cost"].sum()), float(d["cost"].sum())) * 100,
            "creatives": breakdown(d, d, None, "theme", limit=30),
        }
    sa, sb = out["sides"][a], out["sides"][b]
    lines = []
    if not sa.get("empty") and not sb.get("empty"):
        ka, kb = sa["kpis"], sb["kpis"]
        ratio = safe_div(ka["total_spend"], kb["total_spend"])
        if ratio:
            lines.append(f"{a} spent {ratio:.1f}x as much as {b}.")
        lines.append(f"Average cost per second: {a} LKR {ka['avg_cost_per_second'] or 0:,.0f} vs {b} LKR {kb['avg_cost_per_second'] or 0:,.0f}.")
        lines.append(f"Prime share of spend: {a} {sa['prime_spend_pct']:.0f}% vs {b} {sb['prime_spend_pct']:.0f}%.")
        lines.append(f"Flighting: {a} is {sa['flighting']['pattern'].lower()}, {b} is {sb['flighting']['pattern'].lower()}.")
    out["highlights"] = lines
    return jsonable(out)
