"""Client reports (Excel, PDF, PowerPoint): build, stream, keep a copy per client and re-download."""
from __future__ import annotations

import datetime as dt
import logging
import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response

from ..core import DashReq, ForecastReq, build_dashboard, dataset, forecast_result, pacing_result, scenario_result, workspace
from ..services import export_excel, export_pdf, gemini_client as gem, repo, report_data
from ..services.store import Workspace
from ..services.util import jsonable

log = logging.getLogger("app")
router = APIRouter()

MEDIA = {"xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "pdf": "application/pdf",
         "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation"}


class ExportReq(DashReq):
    kind: str
    format: str = "xlsx"
    include_ai: bool = False
    forecast: dict[str, Any] | None = None     # forecast params to include (served from cache when already run)
    scenarios: dict[str, Any] | None = None    # scenario params to include
    pacing: dict[str, Any] | None = None       # pacing params to include
    saved_ids: list[int] | None = None         # saved forecasts to add to the report
    ai: dict[str, Any] | None = None           # insights already generated in the browser
    title: str = ""


def _safe_name(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "_", s).strip("_")[:40] or "client"


def build_report(ws: Workspace, req: ExportReq) -> tuple[report_data.Report, list[str]]:
    ds = dataset(ws, req.kind, req.dataset)
    built = build_dashboard(ws, req.kind, req.filters, req.options, req.dataset)
    if built["data"].get("empty"):
        raise HTTPException(422, "No rows match the current filters, so there is nothing to export.")
    notes: list[str] = []
    freq = lambda p: ForecastReq(kind=req.kind, dataset=req.dataset, filters=req.filters, options=req.options, params=p)
    fcres = scen = pace = None
    if req.forecast:
        try:
            fcres = forecast_result(ws, freq(req.forecast))
            if not fcres.get("ok"):
                notes.append("Forecast not included: " + str(fcres.get("message", "no result"))); fcres = None
        except Exception as exc:  # noqa: BLE001
            log.exception("Forecast for report failed"); notes.append(f"Forecast not included: {exc}")
    if req.scenarios:
        try:
            scen = scenario_result(ws, freq(req.scenarios))
            if not scen.get("ok"):
                notes.append("Scenarios not included: " + str(scen.get("message"))); scen = None
        except Exception as exc:  # noqa: BLE001
            log.exception("Scenarios for report failed"); notes.append(f"Scenarios not included: {exc}")
    if req.pacing:
        try:
            pace = pacing_result(ws, freq(req.pacing))
            if not pace.get("ok"):
                notes.append("Pacing not included: " + str(pace.get("message"))); pace = None
        except Exception as exc:  # noqa: BLE001
            log.exception("Pacing for report failed"); notes.append(f"Pacing not included: {exc}")
    saved = [f for f in (repo.get_forecast(ws.client_id, i) for i in (req.saved_ids or [])[:6]) if f]
    ai = None
    if req.include_ai:
        ai = req.ai
        if ai is None:
            try:
                facts = gem.build_facts(req.kind, built["data"], fcres, built["meta"])
                ai = jsonable(gem.service.insights(facts, req.kind, gem.standing_caveats(fcres, built["data"], built["meta"])))
            except gem.GeminiError as exc:
                notes.append(f"Gemini summary not included ({exc}). A rule-based summary was written instead.")
    chips = [f"{c['label']}: {c['value']}" for c in built["meta"]["chips"]]
    rep = report_data.build(req.kind, built["data"], built["meta"], ds.files, fcres, ai, chips, client=repo.get_client(ws.client_id),
                            branding=repo.get_branding(), scenarios=scen, pacing=pace, saved=saved, dataset_meta=ds.meta, dataset_name=req.dataset,
                            title=req.title)
    rep.notes += notes
    return rep, notes


@router.post("/api/export")
def export(req: ExportReq, ws: Workspace = Depends(workspace)) -> Response:
    """Build the report, keep a copy for the client, and stream it."""
    if req.format not in MEDIA:
        raise HTTPException(422, "Format must be xlsx, pdf or pptx.")
    rep, _ = build_report(ws, req)
    try:
        if req.format == "xlsx":
            content = export_excel.workbook_bytes(rep)
        elif req.format == "pdf":
            content = export_pdf.build_pdf(rep)
        else:
            from ..services import export_pptx
            content = export_pptx.build_pptx(rep)
    except Exception:
        log.exception("Export failed")
        raise HTTPException(500, "The report could not be built. Please try again with fewer filters.") from None
    client = repo.get_client(ws.client_id) or {"name": "client"}
    fname = f"{_safe_name(client['name'])}_{req.kind}_report_{dt.datetime.now().strftime('%Y%m%d_%H%M')}.{req.format}"
    rid = repo.save_report(ws.client_id, req.kind, req.format, fname, content, req.model_dump(exclude={"ai"}), ws.user_id)
    return Response(content, media_type=MEDIA[req.format], headers={"Content-Disposition": f'attachment; filename="{fname}"', "X-Report-Id": str(rid)})


@router.get("/api/reports")
def reports(ws: Workspace = Depends(workspace)) -> list[dict]:
    return jsonable(repo.list_reports(ws.client_id))


@router.get("/api/reports/{rid}/download")
def download(rid: int, ws: Workspace = Depends(workspace)) -> Response:
    r = repo.get_report(ws.client_id, rid)
    if not r:
        raise HTTPException(404, "Report not found.")
    return Response(r["content"], media_type=MEDIA.get(r["format"], "application/octet-stream"), headers={"Content-Disposition": f'attachment; filename="{r["filename"]}"'})


@router.delete("/api/reports/{rid}")
def delete(rid: int, ws: Workspace = Depends(workspace)) -> dict:
    repo.delete_report(ws.client_id, rid)
    return {"deleted": True}
