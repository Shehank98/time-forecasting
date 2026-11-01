"""Agency history vault and brand memory."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..core import admin_user, workspace
from ..services import lora, vault
from ..services.store import Workspace

router = APIRouter()


class IngestIn(BaseModel):
    kind: str
    rows: list[dict[str, Any]] = Field(default_factory=list)
    source: str = ""


class TrainIn(BaseModel):
    product_group: str | None = None
    global_too: bool = True


class ClearIn(BaseModel):
    kind: str
    product_group: str | None = None


@router.post("/api/vault/ingest")
def vault_ingest(req: IngestIn, ws: Workspace = Depends(workspace)) -> dict:
    """Compact daily totals from an upload. Overlapping uploads replace cells, they never double count."""
    try:
        return vault.ingest(req.kind, req.rows, user_id=ws.user_id, source=req.source)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("/api/vault/status")
def vault_status(product_group: str | None = None, ws: Workspace = Depends(workspace)) -> dict:
    return {**vault.coverage(product_group), "adapters": lora.status(product_group)}


@router.post("/api/vault/train")
def vault_train(req: TrainIn, user=Depends(admin_user)) -> dict:
    return lora.start(req.product_group, req.global_too)


@router.post("/api/vault/clear")
def vault_clear(req: ClearIn, user=Depends(admin_user)) -> dict:
    if req.kind not in ("lmrb", "tv"):
        raise HTTPException(422, "kind must be lmrb or tv")
    return {"removed_files": vault.clear(req.kind, req.product_group)}
