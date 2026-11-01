"""Gemini insights and chat over the dashboard summary the browser computed (never raw rows)."""
from __future__ import annotations

import hashlib
import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..core import rate_limit, workspace
from ..services import gemini_client as gem
from ..services import repo
from ..services.store import Workspace
from ..services.util import jsonable

router = APIRouter()
_insight_cache: dict[str, dict] = {}
KINDS = ("tv", "lmrb", "kpi")


class AiReq(BaseModel):
    kind: str
    dash: dict[str, Any]
    meta: dict[str, Any] = Field(default_factory=dict)
    forecast: dict[str, Any] | None = None       # a forecast result the browser already received
    evidence: list[str] = Field(default_factory=list)
    question: str = ""
    history: list[dict[str, Any]] = Field(default_factory=list)
    refresh: bool = False


def ai_facts(ws: Workspace, req: AiReq) -> gem.Facts:
    if req.kind not in KINDS:
        raise HTTPException(422, "Unknown workspace.")
    if req.dash.get("empty"):
        raise HTTPException(422, "No rows match the current filters, so there is nothing to analyse.")
    meta = dict(req.meta)
    meta["client"] = (repo.get_client(ws.client_id) or {}).get("name")
    try:
        f = gem.build_facts(req.kind, req.dash, req.forecast, meta)
    except (KeyError, TypeError, ValueError, IndexError) as exc:
        raise HTTPException(422, f"The dashboard summary is incomplete ({type(exc).__name__}). Reload the page and try again.") from exc
    for e in req.evidence[:12]:
        f.add("Planner evidence", str(e)[:400], "evidence")
    return f


@router.post("/api/insights")
def insights(req: AiReq, ws: Workspace = Depends(workspace)) -> dict:
    rate_limit(ws.sid)
    facts = ai_facts(ws, req)
    key = hashlib.sha1((facts.prompt() + gem.service.model_name + str(ws.client_id)).encode()).hexdigest()
    if not req.refresh and key in _insight_cache:
        return {**_insight_cache[key], "cached": True}
    try:
        out = gem.service.insights(facts, req.kind, gem.standing_caveats(req.forecast, req.dash, req.meta))
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
    facts = ai_facts(ws, req)
    try:
        return jsonable(gem.service.chat(facts, req.question, req.history))
    except gem.GeminiError as exc:
        raise HTTPException(exc.status, str(exc)) from exc


@router.get("/api/ai-status")
def ai_status() -> dict:
    return {"configured": gem.service.configured(), "model": gem.service.model_name}
