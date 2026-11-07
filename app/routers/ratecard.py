"""Agency TV rate card: everyone signed in can read it, admins import and delete versions."""
from __future__ import annotations

import datetime as dt
import logging

from fastapi import APIRouter, Depends, HTTPException, Request

from ..services import auth, ratecard
from ..core import admin_user, current_user


log = logging.getLogger("app")
router = APIRouter()


@router.get("/api/ratecards/summary")
def summary(user: auth.User = Depends(current_user)) -> dict:
    """Every channel with its versions (effective dates), newest first."""
    return {"channels": ratecard.versions()}


@router.get("/api/ratecards/current")
def current(as_of: str | None = None, user: auth.User = Depends(current_user)) -> dict:
    """The newest version of every channel: one entry per programme with rack rate, negotiated rate, days and time."""
    if as_of:
        try:
            dt.date.fromisoformat(as_of)
        except ValueError:
            raise HTTPException(422, "as_of must be a date like 2026-09-01.") from None
    return ratecard.current(as_of)


@router.post("/api/ratecards/import")
async def import_workbook(request: Request, filename: str = "rate card.xlsx", effective: str | None = None, user: auth.User = Depends(admin_user)) -> dict:
    """Body = the .xlsx file. The same channel and effective date is replaced; a newer date adds a version. `effective` is used for tabs that give no date."""
    if effective:
        try:
            dt.date.fromisoformat(effective)
        except ValueError:
            raise HTTPException(422, "effective must be a date like 2026-09-01.") from None
    content = await request.body()
    if len(content) < 100 or content[:2] != b"PK":
        raise HTTPException(422, "Please upload an Excel workbook (.xlsx).")
    try:
        parsed = ratecard.parse_workbook(content, effective)
    except ratecard.RateCardError as e:
        raise HTTPException(422, str(e)) from None
    done = ratecard.store(parsed, filename, user.id)
    return {"imported": done, "warnings": parsed["warnings"] + [w for d in done for w in d["warnings"]], "rows": sum(d["rows"] for d in done)}


@router.delete("/api/ratecards")
def delete_version(channel: str, effective_from: str, user: auth.User = Depends(admin_user)) -> dict:
    n = ratecard.delete_version(channel, effective_from)
    if not n:
        raise HTTPException(404, "That version was not found.")
    return {"deleted": n}
