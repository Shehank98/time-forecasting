"""Pre-Launch Ad Test card: upload an ad, run the three engines as a background job, poll for progress, download the report.

The uploaded file is held in memory for the job and then dropped. Nothing is written to disk or the database.
"""
from __future__ import annotations

import asyncio
import logging
import threading
import time
import uuid
from typing import Any, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import HTMLResponse
from pydantic import ValidationError

from ..core import rate_limit, workspace
from ..services import adtest_llm as llm
from ..services import adtest_pipeline, adtest_report, persona_bank, vision_engine
from ..services.adtest_models import AdBrief, AdTestResult, PanelConfig
from ..services.gemini_client import GeminiError
from ..services.store import Workspace

router = APIRouter()
log = logging.getLogger(__name__)

JOBS: dict[str, dict[str, Any]] = {}
LOCK = threading.Lock()
KEEP_SECONDS = 3600
MAX_JOBS = 40
FIELD_MAX = 4000


def _slug(t: str) -> str:
    import re
    return (re.sub(r"[^A-Za-z0-9]+", "-", t).strip("-").lower() or "ad")[:60]


def _trim() -> None:
    now = time.time()
    for k in [k for k, j in JOBS.items() if now - j["created"] > KEEP_SECONDS]:
        JOBS.pop(k, None)
    while len(JOBS) > MAX_JOBS:
        JOBS.pop(min(JOBS, key=lambda k: JOBS[k]["created"]), None)


def _set(jid: str, **kw: Any) -> None:
    with LOCK:
        if jid in JOBS:
            JOBS[jid].update(kw)


def _work(jid: str, brief: AdBrief, data: bytes, filename: str, cfg: PanelConfig, key: str) -> None:
    def progress(p: float, msg: str) -> None:
        _set(jid, progress=p, message=msg)

    try:
        result = asyncio.run(adtest_pipeline.run(brief, data, filename, cfg, progress)).model_dump(mode="json")
        adtest_pipeline.cache_put(key, result)
        _set(jid, status="done", progress=1.0, message="Done", result=result)
    except (vision_engine.AdFileError, adtest_pipeline.PanelError) as exc:
        _set(jid, status="error", error=str(exc), code=422)
    except GeminiError as exc:
        _set(jid, status="error", error=str(exc), code=exc.status)
    except Exception:  # noqa: BLE001
        log.exception("[adtest] job %s failed", jid)
        _set(jid, status="error", error="The ad test hit a problem. Please try again.", code=500)


def _panel_cfg(panel_size: str, age_min: int, age_max: int, gender: str, region: str, runs: int = 3, quality: str = "standard", weighted: bool = True) -> PanelConfig:
    try:
        return PanelConfig(size=panel_size, age_min=age_min, age_max=age_max, gender=gender, region=region, runs=runs, quality=quality, weighted=weighted)
    except ValidationError as exc:
        raise HTTPException(422, "The audience settings are not valid.") from exc


@router.get("/api/adtest/status")
def status(ws: Workspace = Depends(workspace)) -> dict:
    est = {k: {t: {str(r): adtest_pipeline.estimate_tokens(t, n, r) for r in (1, 3)} for t in ("static", "video")} for k, n in persona_bank.PANEL_SIZES.items()}
    return {"configured": llm.configured(), "key_problem": llm.key_problem(), "model": llm.model_name(), "panel_model": llm.panel_model(), "best_model": llm.model_name(), "sizes": persona_bank.PANEL_SIZES, "estimates": est,
            "regions": persona_bank.REGIONS, "age_groups": persona_bank.AGE_GROUPS, "bank": len(persona_bank.BANK),
            "limits": {"image_mb": vision_engine.MAX_IMAGE_BYTES // 1048576, "video_mb": vision_engine.MAX_VIDEO_BYTES // 1048576,
                       "video_seconds": vision_engine.MAX_VIDEO_SECONDS}}


@router.get("/api/adtest/check")
async def check(ws: Workspace = Depends(workspace)) -> dict:
    """Is the Gemini key valid, and can it reach the models this card uses? No tokens are used."""
    rate_limit(ws.sid + ":adtest-check", 10)
    return await llm.check_connection()


@router.get("/api/adtest/panel")
def panel(panel_size: str = "quick", age_min: int = 0, age_max: int = 120, gender: str = "", region: str = "", ws: Workspace = Depends(workspace)) -> dict:
    """Who would be in the panel with these settings, for the preview before the run."""
    cfg = _panel_cfg(panel_size, age_min, age_max, gender, region)
    try:
        people = adtest_pipeline.choose_panel(cfg)
    except adtest_pipeline.PanelError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"count": len(people), "people": [{"id": p.id, "name": p.name, "age": p.age, "gender": p.gender, "place": p.place, "background": p.background,
                                              "job": p.job, "mindset": p.mindset, "age_group": p.age_group, "region": p.region} for p in people]}


@router.post("/api/adtest/run")
async def run(ad_type: Literal["video", "static"] = Form(...), brand: str = Form(""), product: str = Form(""), headline: str = Form(""),
              ad_copy: str = Form("", alias="copy"), audience: str = Form(""), objective: str = Form(""), market_notes: str = Form(""), panel_size: str = Form("quick"), age_min: int = Form(0), age_max: int = Form(120),
              gender: str = Form(""), region: str = Form(""), runs: int = Form(3), quality: str = Form("standard"), weighted: bool = Form(True),
              category: str = Form(""), goal: str = Form(""), file: UploadFile = File(...), ws: Workspace = Depends(workspace)) -> dict:
    rate_limit(ws.sid + ":adtest", 6)
    if not llm.configured():
        raise HTTPException(503, "Gemini is not configured on the server. Set GEMINI_API_KEY and restart.")
    try:
        brief = AdBrief(ad_type=ad_type, category=category[:60], goal=goal, brand=brand[:200], product=product[:200], headline=headline[:FIELD_MAX], ad_copy=ad_copy[:FIELD_MAX], audience=audience[:FIELD_MAX],
                        objective=objective[:FIELD_MAX], market_notes=market_notes[:FIELD_MAX])
    except ValidationError as exc:
        raise HTTPException(422, "The campaign goal is not valid.") from exc
    limit = vision_engine.MAX_VIDEO_BYTES if ad_type == "video" else vision_engine.MAX_IMAGE_BYTES
    data = bytearray()
    while chunk := await file.read(1 << 20):
        data += chunk
        if len(data) > limit:
            raise HTTPException(413, f"The file is larger than {limit // 1048576} MB.")
    try:
        vision_engine.check_upload(ad_type, file.filename or "", bytes(data))
    except vision_engine.AdFileError as exc:
        raise HTTPException(422, str(exc)) from exc
    cfg = _panel_cfg(panel_size, age_min, age_max, gender, region, runs, quality, weighted)
    try:
        adtest_pipeline.choose_panel(cfg)
    except adtest_pipeline.PanelError as exc:
        raise HTTPException(422, str(exc)) from exc
    key = adtest_pipeline.cache_key(brief, cfg, bytes(data))
    hit = adtest_pipeline.cache_get(key)
    jid = uuid.uuid4().hex
    if hit is not None:
        with LOCK:
            _trim()
            JOBS[jid] = {"owner": ws.user_id, "created": time.time(), "status": "done", "progress": 1.0, "message": "Done (saved result, no tokens used)", "result": hit, "error": None}
        log.info("[adtest] job %s served from the result cache", jid[:8])
        return {"job": jid}
    with LOCK:
        _trim()
        JOBS[jid] = {"owner": ws.user_id, "created": time.time(), "status": "running", "progress": 0.02, "message": "Starting", "result": None, "error": None}
    threading.Thread(target=_work, args=(jid, brief, bytes(data), file.filename or "ad", cfg, key), daemon=True, name=f"adtest-{jid[:6]}").start()
    log.info("[adtest] job %s started: user=%s type=%s file=%s size=%.1fMB", jid[:8], ws.user_id, ad_type, file.filename, len(data) / 1048576)
    return {"job": jid}


@router.get("/api/adtest/job/{jid}")
def job(jid: str, ws: Workspace = Depends(workspace)) -> dict:
    with LOCK:
        j = JOBS.get(jid)
        if j is None or j["owner"] != ws.user_id:
            raise HTTPException(404, "This test is no longer available. Run it again.")
        out = dict(j)
    out.pop("owner", None)
    out.pop("created", None)
    return out


@router.post("/api/adtest/report", response_class=HTMLResponse)
def report(result: dict, ws: Workspace = Depends(workspace)) -> HTMLResponse:
    try:
        r = AdTestResult.model_validate(result)
    except ValidationError as exc:
        raise HTTPException(422, "The result is incomplete. Run the test again.") from exc
    from ..services import repo
    client = (repo.get_client(ws.client_id) or {}).get("name", "")
    html = adtest_report.build_html(r, repo.get_branding(), client)
    return HTMLResponse(html, headers={"Content-Disposition": f'attachment; filename="{_slug(r.brief.brand or client or "ad")}-pre-launch-audit.html"'})
