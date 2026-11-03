"""Negotiation report: the browser sends the filtered Channel -> Brand -> Theme summary, the server lays it out as a PDF."""
from __future__ import annotations

import datetime as dt
import logging
import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from ..core import workspace
from ..services import export_executive, export_negotiation, export_press, export_spotlight, repo
from ..services.store import Workspace

log = logging.getLogger("app")
router = APIRouter()


class NegotiationReq(BaseModel):
    hub: dict[str, Any]
    meta: dict[str, Any] = Field(default_factory=dict)


@router.post("/api/negotiation/pdf")
def negotiation_pdf(req: NegotiationReq, ws: Workspace = Depends(workspace)) -> Response:
    hub = req.hub
    if hub.get("empty") or not hub.get("channels"):
        raise HTTPException(422, "No spots match the current selection, so there is nothing to put in the report.")
    client = repo.get_client(ws.client_id) or {"name": "client"}
    try:
        content = export_negotiation.build_negotiation_pdf(hub, req.meta, client, repo.get_branding(),
                                                           {"agency": repo.agency_logo(), "client": repo.client_logo(ws.client_id)})
    except Exception:
        log.exception("Negotiation PDF failed")
        raise HTTPException(500, "The negotiation report could not be built. Try a smaller selection.") from None
    name = re.sub(r"[^A-Za-z0-9]+", "_", client.get("name") or "client").strip("_")[:40] or "client"
    fname = f"{name}_negotiation_report_{dt.datetime.now().strftime('%Y%m%d_%H%M')}.pdf"
    rid = repo.save_report(ws.client_id, "lmrb", "pdf", fname, content, {"kind": "negotiation", "format": "pdf", "title": "Negotiation report",
                                                                        "dataset": str(req.meta.get("dataset") or "")[:200]}, ws.user_id)
    log.info("[negotiation pdf] built %s (%d bytes) for client %s", fname, len(content), ws.client_id)
    return Response(content, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{fname}"', "X-Report-Id": str(rid)})


class SpotlightReq(BaseModel):
    report: dict[str, Any]
    meta: dict[str, Any] = Field(default_factory=dict)


@router.post("/api/spotlight/pdf")
def spotlight_pdf(req: SpotlightReq, ws: Workspace = Depends(workspace)) -> Response:
    """Programme & sponsorship report: Channel -> Programme -> Advertiser for the chosen advertisers and dates."""
    rep = req.report
    if rep.get("empty") or not rep.get("channels"):
        raise HTTPException(422, "No spots match the chosen channels, programmes, advertisers and dates, so there is nothing to put in the report.")
    client = repo.get_client(ws.client_id) or {"name": "client"}
    try:
        content = export_spotlight.build_spotlight_pdf(rep, req.meta, client, repo.get_branding(),
                                                       {"agency": repo.agency_logo(), "client": repo.client_logo(ws.client_id)})
    except Exception:
        log.exception("Programme and sponsorship PDF failed")
        raise HTTPException(500, "The programme and sponsorship report could not be built. Try fewer programmes or a shorter date range.") from None
    name = re.sub(r"[^A-Za-z0-9]+", "_", client.get("name") or "client").strip("_")[:40] or "client"
    fname = f"{name}_programme_sponsorship_{dt.datetime.now().strftime('%Y%m%d_%H%M')}.pdf"
    rid = repo.save_report(ws.client_id, "lmrb", "pdf", fname, content, {"kind": "spotlight", "format": "pdf", "title": "Programme and sponsorship report",
                                                                        "dataset": str(req.meta.get("dataset") or "")[:200]}, ws.user_id)
    log.info("[spotlight pdf] built %s (%d bytes) for client %s", fname, len(content), ws.client_id)
    return Response(content, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{fname}"', "X-Report-Id": str(rid)})


class ExecutiveReq(BaseModel):
    summary: dict[str, Any]
    meta: dict[str, Any] = Field(default_factory=dict)


@router.post("/api/executive/pdf")
def executive_pdf(req: ExecutiveReq, ws: Workspace = Depends(workspace)) -> Response:
    """Executive negotiation summary: overall, channels, programmes and sponsorship, plus the drill-down details."""
    d = req.summary
    if d.get("empty") or not d.get("channels"):
        raise HTTPException(422, "No spots match the chosen advertisers, channels and dates, so there is nothing to put in the summary.")
    client = repo.get_client(ws.client_id) or {"name": "client"}
    try:
        content = export_executive.build_executive_pdf(d, req.meta, client, repo.get_branding(), {"agency": repo.agency_logo(), "client": repo.client_logo(ws.client_id)})
    except Exception:
        log.exception("Executive summary PDF failed")
        raise HTTPException(500, "The executive summary could not be built. Try fewer channels or a shorter date range.") from None
    name = re.sub(r"[^A-Za-z0-9]+", "_", client.get("name") or "client").strip("_")[:40] or "client"
    fname = f"{name}_executive_summary_{dt.datetime.now().strftime('%Y%m%d_%H%M')}.pdf"
    rid = repo.save_report(ws.client_id, "lmrb", "pdf", fname, content, {"kind": "executive", "format": "pdf", "title": "Executive negotiation summary",
                                                                        "dataset": str(req.meta.get("dataset") or "")[:200]}, ws.user_id)
    log.info("[executive pdf] built %s (%d bytes) for client %s", fname, len(content), ws.client_id)
    return Response(content, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{fname}"', "X-Report-Id": str(rid)})


class TenureReq(BaseModel):
    report: dict[str, Any]
    meta: dict[str, Any] = Field(default_factory=dict)


@router.post("/api/spotlight/tenure/pdf")
def tenure_pdf(req: TenureReq, ws: Workspace = Depends(workspace)) -> Response:
    """Sponsorship over time: who sponsored which programme, year by year, with the ads that ran."""
    rep = req.report
    if rep.get("empty") or not (rep.get("rows") or (rep.get("frequency") or {}).get("rows")):
        raise HTTPException(422, "No sponsorships match the chosen channel, programme and advertiser, so there is nothing to put in the report.")
    client = repo.get_client(ws.client_id) or {"name": "client"}
    try:
        content = export_spotlight.build_tenure_pdf(rep, req.meta, client, repo.get_branding(), {"agency": repo.agency_logo(), "client": repo.client_logo(ws.client_id)})
    except Exception:
        log.exception("Sponsorship over time PDF failed")
        raise HTTPException(500, "The sponsorship over time report could not be built. Try a single channel or programme.") from None
    name = re.sub(r"[^A-Za-z0-9]+", "_", client.get("name") or "client").strip("_")[:40] or "client"
    fname = f"{name}_sponsorship_over_time_{dt.datetime.now().strftime('%Y%m%d_%H%M')}.pdf"
    rid = repo.save_report(ws.client_id, "lmrb", "pdf", fname, content, {"kind": "tenure", "format": "pdf", "title": "Sponsorship over time",
                                                                        "dataset": str(req.meta.get("dataset") or "")[:200]}, ws.user_id)
    log.info("[tenure pdf] built %s (%d bytes) for client %s", fname, len(content), ws.client_id)
    return Response(content, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{fname}"', "X-Report-Id": str(rid)})


class PressReq(BaseModel):
    summary: dict[str, Any]
    contracts: dict[str, Any]
    meta: dict[str, Any] = Field(default_factory=dict)


@router.post("/api/press/pdf")
def press_pdf(req: PressReq, ws: Workspace = Depends(workspace)) -> Response:
    """Press spend and contracts (same paper, same size, same weekday, repeated), laid out from the browser's numbers."""
    if req.summary.get("empty") or not (req.summary.get("publications") or []):
        raise HTTPException(422, "No press ads match the chosen advertisers, papers and dates, so there is nothing to put in the report.")
    client = repo.get_client(ws.client_id) or {"name": "client"}
    try:
        content = export_press.build_press_pdf(req.summary, req.contracts, req.meta, client, repo.get_branding(), {"agency": repo.agency_logo(), "client": repo.client_logo(ws.client_id)})
    except Exception:
        log.exception("Press and contracts PDF failed")
        raise HTTPException(500, "The press and contracts report could not be built. Try fewer advertisers or a shorter period.") from None
    name = re.sub(r"[^A-Za-z0-9]+", "_", client.get("name") or "client").strip("_")[:40] or "client"
    fname = f"{name}_press_contracts_{dt.datetime.now().strftime('%Y%m%d_%H%M')}.pdf"
    rid = repo.save_report(ws.client_id, "lmrb", "pdf", fname, content, {"kind": "press", "format": "pdf", "title": "Press and contracts",
                                                                        "dataset": str(req.meta.get("dataset") or "")[:200]}, ws.user_id)
    log.info("[press pdf] built %s (%d bytes) for client %s", fname, len(content), ws.client_id)
    return Response(content, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{fname}"', "X-Report-Id": str(rid)})
