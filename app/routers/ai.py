"""Gemini insights and chat over aggregated numbers only."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field

from ..core import DashReq, ForecastReq, build_dashboard, data_version, forecast_result, rate_limit, workspace
from ..services import gemini_client as gem
from ..services import forecast as fc
from ..services import repo
from ..services.store import Workspace
from ..services.util import jsonable

router = APIRouter()
_insight_cache: dict[str, dict] = {}


class AiReq(DashReq):
    kind: str
    forecast: dict[str, Any] | None = None      # forecast params the user last ran (served from cache)
    question: str = ""
    history: list[dict[str, Any]] = Field(default_factory=list)
    refresh: bool = False


def ai_facts(ws: Workspace, req: AiReq) -> tuple[gem.Facts, dict | None, dict, dict]:
    """Aggregates only (never raw rows): dashboard KPIs and movers, plus the cached forecast when requested."""
    built = build_dashboard(ws, req.kind, req.filters, req.options, req.dataset)
    fcres = None
    if req.forecast:
        fcres = forecast_result(ws, ForecastReq(kind=req.kind, dataset=req.dataset, filters=req.filters, options=req.options, params=req.forecast))
    client = repo.get_client(ws.client_id) or {}
    built["meta"]["client"] = client.get("name")
    return gem.build_facts(req.kind, built["data"], fcres, built["meta"]), fcres, built["data"], built["meta"]


@router.post("/api/insights")
def insights(req: AiReq, ws: Workspace = Depends(workspace)) -> dict:
    rate_limit(ws.sid)
    facts, fcres, dash, meta = ai_facts(ws, req)
    if dash.get("empty"):
        raise HTTPException(422, "No rows match the current filters, so there is nothing to analyse.")
    key = fc.ResultCache.key(data_version(ws, req.kind, req.dataset), req.kind, req.filters, req.options, {"ai": req.forecast, "m": gem.service.model_name, "c": ws.client_id})
    if not req.refresh and key in _insight_cache:
        return {**_insight_cache[key], "cached": True}
    try:
        out = gem.service.insights(facts, req.kind, gem.standing_caveats(fcres, dash, meta))
    except gem.GeminiError as exc:
        raise HTTPException(exc.status, str(exc)) from exc
    res = jsonable({"insights": out, "model": gem.service.model_name, "fact_count": len(facts.items), "cached": False})
    _insight_cache[key] = res
    if len(_insight_cache) > 100:
        _insight_cache.pop(next(iter(_insight_cache)))
    return res


@router.post("/api/chat")
def chat(req: AiReq, ws: Workspace = Depends(workspace)) -> dict:
    if not req.question.strip():
        raise HTTPException(422, "Type a question first.")
    rate_limit(ws.sid)
    facts, _, dash, _ = ai_facts(ws, req)
    if dash.get("empty"):
        raise HTTPException(422, "No rows match the current filters, so there is nothing to ask about.")
    try:
        return jsonable(gem.service.chat(facts, req.question, req.history))
    except gem.GeminiError as exc:
        raise HTTPException(exc.status, str(exc)) from exc


@router.get("/api/ai-status")
def ai_status() -> dict:
    return {"configured": gem.service.configured(), "model": gem.service.model_name}
