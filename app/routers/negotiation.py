"""Negotiation report: the browser sends the filtered Channel -> Brand -> Theme summary, the server lays it out as a PDF."""
from __future__ import annotations

import datetime as dt
import logging
import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from ..core import workspace
from ..services import export_negotiation, repo
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
