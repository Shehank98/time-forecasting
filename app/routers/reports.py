"""Client reports (Excel, PDF, PowerPoint): build, stream, keep a copy per client and re-download."""
from __future__ import annotations

import datetime as dt
import logging
import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response

from pydantic import BaseModel, Field

from ..core import workspace
from ..services import export_excel, export_pdf, gemini_client as gem, repo, report_data
from ..services.store import Workspace
from ..services.util import jsonable

log = logging.getLogger("app")
router = APIRouter()

MEDIA = {"xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "pdf": "application/pdf",
         "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation"}


class ExportReq(BaseModel):
    """Everything comes from the browser: the dashboard summary and results it already received from the server."""
    kind: str
    format: str = "xlsx"
    dataset: str = ""
    dash: dict[str, Any]
    meta: dict[str, Any] = Field(default_factory=dict)
    files: list[str] = Field(default_factory=list)
    include_ai: bool = False
    forecast: dict[str, Any] | None = None      # forecast result
    scenarios: dict[str, Any] | None = None     # scenario result
    pacing: dict[str, Any] | None = None        # pacing result
    evidence: list[str] = Field(default_factory=list)   # Planner's Evidence boxes
    saved_ids: list[int] | None = None
    ai: dict[str, Any] | None = None
    title: str = ""


def _safe_name(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "_", s).strip("_")[:40] or "client"


def _ok(x: dict | None) -> dict | None:
    """A usable result: it must say ok, and a forecast must contain at least one series."""
    if not isinstance(x, dict) or not x.get("ok"):
        return None
    if "results" in x and not x["results"]:
        return None
    return x


def build_report(ws: Workspace, req: ExportReq) -> tuple[report_data.Report, list[str]]:
    if req.kind not in ("tv", "lmrb", "kpi"):
        raise HTTPException(422, "Unknown workspace.")
    if req.dash.get("empty"):
        raise HTTPException(422, "No rows match the current filters, so there is nothing to export.")
    notes: list[str] = []
    fcres, scen, pace = _ok(req.forecast), _ok(req.scenarios), _ok(req.pacing)
    saved = [f for f in (repo.get_forecast(ws.client_id, i) for i in (req.saved_ids or [])[:6]) if f]
    meta = dict(req.meta)
    ai = None
    if req.include_ai:
        ai = req.ai
        if ai is None:
            try:
                facts = gem.build_facts(req.kind, req.dash, fcres, meta)
                for e in req.evidence[:12]:
                    facts.add("Planner evidence", str(e)[:400], "evidence")
                ai = jsonable(gem.service.insights(facts, req.kind, gem.standing_caveats(fcres, req.dash, meta)))
            except gem.GeminiError as exc:
                notes.append(f"Gemini summary not included ({exc}). A rule-based summary was written instead.")
            except (KeyError, TypeError, ValueError, IndexError):
                notes.append("Gemini summary not included because the summary was incomplete.")
            except Exception:  # noqa: BLE001 - an AI problem must never stop the report
                log.exception("AI summary failed while building a report")
                notes.append("Gemini summary not included because the AI service had a problem. A rule-based summary was written instead.")
    chips = [f"{c.get('label')}: {c.get('value')}" for c in meta.get("chips", []) if isinstance(c, dict)]
    try:
        rep = report_data.build(req.kind, req.dash, meta, [str(f)[:200] for f in req.files][:50] or ["Browser upload"], fcres, ai, chips,
                                client=repo.get_client(ws.client_id), branding=repo.get_branding(), scenarios=scen, pacing=pace, saved=saved,
                                dataset_meta=meta.get("dataset_meta") or {}, dataset_name=req.dataset, title=req.title,
                                logos={"agency": repo.agency_logo(), "client": repo.client_logo(ws.client_id)})
    except (KeyError, TypeError, ValueError, IndexError) as exc:
        log.warning("Report summary incomplete: %r", exc)
        raise HTTPException(422, "The dashboard summary is incomplete. Reload the page and try again.") from exc
    rep.evidence = [str(e)[:500] for e in req.evidence[:20]]
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
    rid = repo.save_report(ws.client_id, req.kind, req.format, fname, content, {"kind": req.kind, "format": req.format, "title": req.title, "dataset": req.dataset}, ws.user_id)
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
