"""Forecast jobs, driver scenarios and pacing on series sent by the browser, plus saved forecasts per client.

Raw data never reaches the server: the browser aggregates its locally stored sheets into
compact, regularly spaced series and sends only those.
"""
from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..core import workspace
from ..services import repo, series as S
from ..services import forecast as fc
from ..services import sl_media_calendar as CAL
from ..services.store import Workspace
from ..services.util import jsonable

router = APIRouter()


class SeriesIn(BaseModel):
    entity: str = "All"
    group: str = ""
    metric: str = "value"
    label: str = ""
    unit: str = "number"
    agg: str = "mean"
    zero_fill: bool | None = None
    dates: list[str]
    values: list[float | None]


class ForecastIn(BaseModel):
    kind: str = ""
    series: list[SeriesIn]
    params: dict[str, Any] = Field(default_factory=dict)


class ScenarioIn(BaseModel):
    kind: str = ""
    target: SeriesIn
    driver: SeriesIn
    params: dict[str, Any] = Field(default_factory=dict)


class PacingIn(BaseModel):
    kind: str = ""
    series: SeriesIn
    params: dict[str, Any] = Field(default_factory=dict)


@router.get("/api/model-status")
def model_status() -> dict:
    return fc.model.status()


class PinsIn(BaseModel):
    start: str
    end: str
    major_events: list[dict[str, Any]] = Field(default_factory=list)


@router.post("/api/calendar/pins")
def calendar_pins(req: PinsIn, ws: Workspace = Depends(workspace)) -> dict:
    """Event markers (Poya, salary window, festivals, user-flagged events) for a chart timeline."""
    try:
        a, b = pd.Timestamp(req.start), pd.Timestamp(req.end)
    except ValueError as exc:
        raise HTTPException(422, "Dates must look like 2026-11-01.") from exc
    if b < a or (b - a).days > 2200:
        raise HTTPException(422, "Choose a range of up to 6 years.")
    return {"pins": CAL.pins(str(a.date()), str(b.date()), req.major_events[:20])}


@router.get("/api/forecast/limits")
def limits() -> dict:
    return {"max_series": fc.MAX_SERIES, "max_points": fc.MAX_POINTS, "max_horizon": fc.MAX_HORIZON,
            "min_points": {g: fc.min_points(g) for g in S.GRANULARITIES}}


def _specs(items: list[SeriesIn], gran: str) -> tuple[list[S.SeriesSpec], list[str]]:
    try:
        return fc.specs_from_payload([i.model_dump() for i in items], gran)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/api/forecast/run")
def forecast_run(req: ForecastIn, ws: Workspace = Depends(workspace)) -> dict:
    """Start a batched TimesFM job. Results come back with each series' group so the browser can split them by chart."""
    p = dict(req.params)
    gran = p.get("granularity", "daily")
    h = int(p.get("horizon_days", 14) or 14)
    if not 1 <= h <= 400:
        raise HTTPException(422, "Horizon must be between 1 and 400 days.")
    specs, notes = _specs(req.series, gran)
    key = fc.cache.key("payload", req.kind, {}, {}, {**p, "_s": [(s.entity, s.group, s.metric, s.dates[0], s.dates[-1], len(s.dates), hash(tuple(s.values))) for s in req.series]})

    def work(progress):
        hit = fc.cache.get(key)
        if hit is not None:
            return {**hit, "cached": True}
        res = fc.run_specs(specs, notes, req.kind, {**p, "granularity": gran, "horizon_days": h}, progress)
        res["cached"] = False
        if res.get("ok"):
            fc.cache.put(key, res)
        return res
    return {"job_id": fc.jobs.start(work, owner=ws.sid)}


def _aligned(a: SeriesIn, b: SeriesIn) -> tuple[pd.DatetimeIndex, np.ndarray, np.ndarray]:
    sa = pd.Series([np.nan if v is None else v for v in a.values], index=pd.to_datetime(a.dates))
    sb = pd.Series([np.nan if v is None else v for v in b.values], index=pd.to_datetime(b.dates))
    common = sa.index.intersection(sb.index)
    return common, sa.reindex(common).fillna(0).to_numpy(float), sb.reindex(common).fillna(0).to_numpy(float)


@router.post("/api/scenarios/run")
def scenarios_run(req: ScenarioIn, ws: Workspace = Depends(workspace)) -> dict:
    p = dict(req.params)
    mult = p.get("multipliers") or []
    if any(not isinstance(m, (int, float)) or m < 0 or m > 5 for m in mult):
        raise HTTPException(422, "Scenario multipliers must be between 0 and 5 (for example 0.8, 1, 1.2).")
    if len(mult) + len(p.get("budgets") or []) > 8:
        raise HTTPException(422, "Use at most 8 scenarios.")
    if len(req.target.dates) > fc.MAX_POINTS:
        raise HTTPException(422, "Too many points.")
    dates, y, x = _aligned(req.target, req.driver)
    if len(dates) < 3:
        raise HTTPException(422, "The result and driver series do not overlap enough.")
    p.setdefault("driver_label", req.driver.label or "driver")
    return {"job_id": fc.jobs.start(lambda progress: fc.scenarios_core(dates, y, x, p, [], progress), owner=ws.sid)}


@router.get("/api/forecast/job/{jid}")
def forecast_job(jid: str, ws: Workspace = Depends(workspace)) -> dict:
    j = fc.jobs.get(jid, ws.sid)
    if j is None:
        raise HTTPException(404, "Forecast job not found. It may have expired.")
    return jsonable({k: j[k] for k in ("status", "progress", "message", "result", "error")})


@router.post("/api/pacing/run")
def pacing_run(req: PacingIn, ws: Workspace = Depends(workspace)) -> dict:
    p = req.params
    for k in ("start", "end", "target"):
        if p.get(k) in (None, ""):
            raise HTTPException(422, f"Pacing needs {k}.")
    try:
        if float(p["target"]) <= 0:
            raise ValueError
    except (TypeError, ValueError):
        raise HTTPException(422, "Target must be a positive number.") from None
    specs, notes = _specs([req.series], "daily")
    if not specs:
        return {"ok": False, "message": notes[0] if notes else "No data for pacing."}
    sp = specs[0]
    if p.get("entity"):
        sp.entity = str(p["entity"])[:160]
    return fc.pacing_core(sp, p, notes)


# ------------------------------------------------------------------ saved forecasts
class SaveReq(BaseModel):
    title: str
    ftype: str = "forecast"
    request: dict[str, Any]
    result: dict[str, Any]


@router.post("/api/saved-forecasts")
def save(req: SaveReq, ws: Workspace = Depends(workspace)) -> dict:
    if req.ftype not in ("forecast", "scenarios", "pacing", "outlook"):
        raise HTTPException(422, "Unknown forecast type.")
    kind = str(req.request.get("kind", ""))
    fid = repo.save_forecast(ws.client_id, kind, str(req.request.get("dataset", "")), req.ftype, req.title.strip() or "Forecast", req.request, req.result, ws.user_id)
    return {"id": fid}


@router.get("/api/saved-forecasts")
def saved(ws: Workspace = Depends(workspace)) -> list[dict]:
    return jsonable(repo.list_forecasts(ws.client_id))


@router.get("/api/saved-forecasts/{fid}")
def saved_one(fid: int, ws: Workspace = Depends(workspace)) -> dict:
    f = repo.get_forecast(ws.client_id, fid)
    if not f:
        raise HTTPException(404, "Saved forecast not found.")
    return f


@router.delete("/api/saved-forecasts/{fid}")
def saved_delete(fid: int, ws: Workspace = Depends(workspace)) -> dict:
    repo.delete_forecast(ws.client_id, fid)
    return {"deleted": True}


@router.get("/api/workspace/summary")
def summary(ws: Workspace = Depends(workspace)) -> dict:
    """Client overview: saved forecasts and reports. Datasets live in each user's browser."""
    return jsonable({"client": repo.get_client(ws.client_id), "forecasts": repo.list_forecasts(ws.client_id), "reports": repo.list_reports(ws.client_id)})
