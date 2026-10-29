"""Forecast jobs, driver scenarios, pacing and saved forecasts per client."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..core import ForecastReq, dataset, forecast_frame, forecast_result, pacing_result, scenario_result, workspace
from ..services import repo, series as S
from ..services import forecast as fc
from ..services.store import Workspace
from ..services.util import jsonable

router = APIRouter()


@router.get("/api/model-status")
def model_status() -> dict:
    return fc.model.status()


@router.post("/api/forecast/entities")
def forecast_entities(req: ForecastReq, ws: Workspace = Depends(workspace)) -> dict:
    ds = dataset(ws, req.kind, req.dataset)
    try:
        df = forecast_frame(ws, req.kind, req.filters, req.options, req.dataset)
        cat = S.metric_catalog(req.kind, df, ds.meta)
        et = req.params.get("entity_type") or cat["entities"][0]
        ents = S.rank_entities(df, req.kind, et, 60, ds.meta, req.params.get("metric"))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return jsonable({"entities": ents, "catalog": cat, "min_points": {g: fc.min_points(g) for g in S.GRANULARITIES}, "model": fc.model.status(),
                     "default_granularity": ds.meta.get("granularity") if req.kind == "kpi" else None,
                     "date_max": str(df["date"].max().date()) if len(df) else None})


def _start(ws: Workspace, req: ForecastReq, fn) -> dict:
    dataset(ws, req.kind, req.dataset)
    jid = fc.jobs.start(lambda progress: fn(ws, req, progress), owner=ws.sid)
    return {"job_id": jid}


@router.post("/api/forecast/start")
def forecast_start(req: ForecastReq, ws: Workspace = Depends(workspace)) -> dict:
    if not req.params.get("metric"):
        raise HTTPException(422, "Choose a metric to forecast.")
    return _start(ws, req, forecast_result)


@router.post("/api/scenarios/start")
def scenarios_start(req: ForecastReq, ws: Workspace = Depends(workspace)) -> dict:
    p = req.params
    if not p.get("target") or not p.get("driver") or p["target"] == p["driver"]:
        raise HTTPException(422, "Choose a result metric (for example leads) and a different driver (for example spend).")
    mult = p.get("multipliers") or []
    if any(not isinstance(m, (int, float)) or m < 0 or m > 5 for m in mult):
        raise HTTPException(422, "Scenario multipliers must be between 0 and 5 (for example 0.8, 1, 1.2).")
    if len(mult) + len(p.get("budgets") or []) > 8:
        raise HTTPException(422, "Use at most 8 scenarios.")
    return _start(ws, req, scenario_result)


@router.get("/api/forecast/job/{jid}")
def forecast_job(jid: str, ws: Workspace = Depends(workspace)) -> dict:
    j = fc.jobs.get(jid, ws.sid)
    if j is None:
        raise HTTPException(404, "Forecast job not found. It may have expired.")
    return jsonable({k: j[k] for k in ("status", "progress", "message", "result", "error")})


@router.post("/api/pacing")
def pacing(req: ForecastReq, ws: Workspace = Depends(workspace)) -> dict:
    p = req.params
    for k in ("metric", "start", "end", "target"):
        if p.get(k) in (None, ""):
            raise HTTPException(422, f"Pacing needs {k}.")
    try:
        if float(p["target"]) <= 0:
            raise ValueError
    except (TypeError, ValueError):
        raise HTTPException(422, "Target must be a positive number.") from None
    return pacing_result(ws, req)


# ------------------------------------------------------------------ saved forecasts
class SaveReq(BaseModel):
    title: str
    ftype: str = "forecast"
    request: dict[str, Any]
    result: dict[str, Any]


@router.post("/api/saved-forecasts")
def save(req: SaveReq, ws: Workspace = Depends(workspace)) -> dict:
    if req.ftype not in ("forecast", "scenarios", "pacing"):
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
