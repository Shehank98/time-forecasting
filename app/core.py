"""Shared request models, dependencies and computations used by the routers."""
from __future__ import annotations

import logging
import os
import threading
import time
from typing import Any

import pandas as pd
from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel, Field

from .services import analytics_lmrb, analytics_tv, auth, filters as flt, forecast as fc, joins
from .services.store import Dataset, Workspace

log = logging.getLogger("app")

KINDS = ("tv", "lmrb", "kpi")
MAX_UPLOAD_MB = int(os.environ.get("MAX_UPLOAD_MB", "25"))
COOKIE = "auth"


# ------------------------------------------------------------------ request models
class DashReq(BaseModel):
    dataset: str = ""                       # KPI dataset name (empty for tv and lmrb)
    filters: dict[str, Any] = Field(default_factory=dict)
    options: dict[str, Any] = Field(default_factory=dict)


class TableReq(DashReq):
    page: int = 1
    page_size: int = 25
    sort: str | None = None
    desc: bool = True
    search: str = ""


class ForecastReq(DashReq):
    kind: str
    params: dict[str, Any] = Field(default_factory=dict)


# ------------------------------------------------------------------ auth dependencies
def current_user(request: Request) -> auth.User:
    user = auth.user_for_token(request.cookies.get(COOKIE))
    if user is None:
        raise HTTPException(401, "Please sign in.")
    return user


def admin_user(user: auth.User = Depends(current_user)) -> auth.User:
    if not user.is_admin:
        raise HTTPException(403, "Only admins can do this.")
    return user


def workspace(request: Request, user: auth.User = Depends(current_user)) -> Workspace:
    """The client the request works on, from the X-Client-Id header, after an access check."""
    raw = request.headers.get("x-client-id") or request.query_params.get("client")
    try:
        cid = int(raw)
    except (TypeError, ValueError):
        raise HTTPException(409, "Select a client first.") from None
    if not auth.can_access(user, cid):
        raise HTTPException(403, "You do not have access to this client.")
    from .services import repo
    c = repo.get_client(cid)
    if not c or c["archived"]:
        raise HTTPException(404, "Client not found or archived.")
    return Workspace(cid, user.id, user.is_admin)


# ------------------------------------------------------------------ datasets
def key_for(kind: str, name: str = "") -> str:
    if kind not in KINDS:
        raise HTTPException(404, "Unknown workspace")
    if kind == "kpi":
        if not name.strip():
            raise HTTPException(422, "Choose a KPI dataset.")
        return f"kpi:{name.strip()}"
    return kind


def dataset(ws: Workspace, kind: str, name: str = "") -> Dataset:
    ds = ws.data.get(key_for(kind, name))
    if ds is None or ds.df.empty:
        raise HTTPException(409, "No data loaded for this workspace yet. Please upload a file first.")
    return ds


def bounds(f: dict) -> tuple[pd.Timestamp | None, pd.Timestamp | None]:
    a, b = pd.to_datetime(f.get("date_from"), errors="coerce"), pd.to_datetime(f.get("date_to"), errors="coerce")
    return (a if pd.notna(a) else None), (b if pd.notna(b) else None)


def lmrb_frame(ws: Workspace, options: dict | None = None) -> pd.DataFrame:
    """LMRB rows, enriched with GRPs (matched programme TVR) when TV data is loaded for the same client."""
    ds = dataset(ws, "lmrb")
    tv = ws.data.get("tv")
    if tv is None:
        return ds.df
    return joins.with_grps(ds, tv, (options or {}).get("tv_data_set") or None)


def base_frame(ws: Workspace, kind: str, name: str = "", options: dict | None = None) -> pd.DataFrame:
    if kind == "lmrb":
        return lmrb_frame(ws, options)
    return dataset(ws, kind, name).df


def build_dashboard(ws: Workspace, kind: str, filters: dict, options: dict, name: str = "") -> dict:
    """Shared by the dashboard endpoint, insights and exports so numbers always agree."""
    from .services import analytics_kpi
    ds = dataset(ws, kind, name)
    df = base_frame(ws, kind, name, options)
    filtered = flt.apply_filters(df, kind, filters)
    meta = {"total_rows": int(len(df)), "filtered_rows": int(len(filtered)), "chips": flt.describe_filters(kind, filters),
            "has_lmrb": "lmrb" in ws.data, "has_tv": "tv" in ws.data}
    if kind == "tv":
        lm = ws.data.get("lmrb")
        data = analytics_tv.dashboard(filtered, lm.df if lm is not None else None)
    elif kind == "lmrb":
        nodate = flt.apply_filters(df, kind, filters, skip_date=True)
        start, end = bounds(filters)
        data = analytics_lmrb.dashboard(nodate, start, end, options.get("my_brand") or None, options.get("competitors") or None)
    else:
        data = analytics_kpi.dashboard(filtered, ds.meta, flt.apply_filters(df, kind, filters, skip_date=True), *bounds(filters))
    return {"meta": meta, "data": data}


# ------------------------------------------------------------------ forecasting helpers
def forecast_frame(ws: Workspace, kind: str, filters: dict, options: dict, name: str = "") -> pd.DataFrame:
    """Filtered frame used for forecasting. LMRB respects the selected competitor set."""
    df = base_frame(ws, kind, name, options)
    out = flt.apply_filters(df, kind, filters)
    if kind == "lmrb" and options.get("my_brand"):
        base = flt.apply_filters(df, kind, filters, skip_date=True)
        out = out[out["advertiser"].isin(analytics_lmrb.competitor_set(base, options["my_brand"], options.get("competitors") or None))]
    return out


def data_version(ws: Workspace, kind: str, name: str = "") -> str:
    v = dataset(ws, kind, name).version
    if kind == "lmrb" and "tv" in ws.data:
        v += "+" + ws.data["tv"].version
    return v


def forecast_result(ws: Workspace, req: ForecastReq, progress: Any = None) -> dict:
    """Compute (or fetch from cache) a forecast. Shared by the API, AI insights and the reports."""
    ds = dataset(ws, req.kind, req.dataset)
    key = fc.cache.key(data_version(ws, req.kind, req.dataset), req.kind, req.filters, req.options, {**req.params, "_t": "forecast"})
    hit = fc.cache.get(key)
    if hit is not None:
        return {**hit, "cached": True}
    res = fc.run(forecast_frame(ws, req.kind, req.filters, req.options, req.dataset), req.kind, req.params, progress, ds.meta)
    res["cached"] = False
    if res.get("ok"):
        fc.cache.put(key, res)
    return res


def scenario_result(ws: Workspace, req: ForecastReq, progress: Any = None) -> dict:
    ds = dataset(ws, req.kind, req.dataset)
    key = fc.cache.key(data_version(ws, req.kind, req.dataset), req.kind, req.filters, req.options, {**req.params, "_t": "scenarios"})
    hit = fc.cache.get(key)
    if hit is not None:
        return {**hit, "cached": True}
    res = fc.run_scenarios(forecast_frame(ws, req.kind, req.filters, req.options, req.dataset), req.kind, req.params, ds.meta, progress)
    if res.get("ok"):
        fc.cache.put(key, res)
    return res


def pacing_result(ws: Workspace, req: ForecastReq) -> dict:
    ds = dataset(ws, req.kind, req.dataset)
    return fc.pacing(forecast_frame(ws, req.kind, {k: v for k, v in req.filters.items() if k not in ("date_from", "date_to")}, req.options, req.dataset),
                     req.kind, req.params, ds.meta)


# ------------------------------------------------------------------ rate limiting
_hits: dict[str, list[float]] = {}
_hlock = threading.Lock()


def rate_limit(key: str, per_minute: int = 12) -> None:
    with _hlock:
        now = time.time()
        hits = [t for t in _hits.get(key, []) if now - t < 60]
        if len(hits) >= per_minute:
            raise HTTPException(429, "Too many requests. Please wait a minute.")
        hits.append(now)
        _hits[key] = hits


def csv_safe(df: pd.DataFrame) -> pd.DataFrame:
    """Neutralise spreadsheet formula injection: text cells starting with = + - @ get a leading apostrophe."""
    out = df.copy()
    for c in out.columns:
        if out[c].dtype == object or str(out[c].dtype).startswith("str"):
            out[c] = out[c].map(lambda v: "'" + v if isinstance(v, str) and v[:1] in ("=", "+", "-", "@", "\t", "\r") else v)
    return out
