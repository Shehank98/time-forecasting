"""Sign in, users, clients, agency branding and the editable configuration files."""
from __future__ import annotations

import json
import os
from typing import Any

import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel

from ..core import COOKIE, admin_user, current_user, rate_limit
from ..services import auth, normalise, repo
from ..services import forecast as fc

router = APIRouter()


class LoginReq(BaseModel):
    email: str
    password: str


class PasswordReq(BaseModel):
    current: str
    new: str


class ClientReq(BaseModel):
    name: str | None = None
    industry: str | None = None
    brand_color: str | None = None
    notes: str | None = None
    archived: bool | None = None


class UserReq(BaseModel):
    email: str | None = None
    name: str | None = None
    role: str | None = None
    password: str | None = None
    active: bool | None = None
    client_ids: list[int] | None = None


def _bad(exc: ValueError) -> HTTPException:
    return HTTPException(422, str(exc))


# ------------------------------------------------------------------ auth
@router.post("/api/auth/login")
def login(req: LoginReq, request: Request, response: Response) -> dict:
    ip = request.client.host if request.client else "?"
    key = f"{ip}|{req.email.strip().lower()}"
    if auth.throttled(key):
        raise HTTPException(429, "Too many attempts. Wait a few minutes and try again.")
    res = auth.login(req.email, req.password)
    if res is None:
        auth.record_failure(key)
        raise HTTPException(401, "Email or password is incorrect.")
    token, user = res
    secure = request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"
    response.set_cookie(COOKIE, token, httponly=True, samesite="lax", secure=secure, max_age=auth.SESSION_DAYS * 86400)
    return {"ok": True, "user": user.__dict__}


@router.post("/api/auth/logout")
def logout(request: Request, response: Response) -> dict:
    auth.logout(request.cookies.get(COOKIE))
    response.delete_cookie(COOKIE)
    return {"ok": True}


@router.get("/api/auth/me")
def me(user: auth.User = Depends(current_user)) -> dict:
    b = repo.get_branding()
    return {"user": {**user.__dict__, "is_admin": user.is_admin}, "clients": repo.list_clients(user),
            "branding": {k: b[k] for k in ("agency_name", "primary_color", "has_logo")}}


@router.post("/api/auth/password")
def change_password(req: PasswordReq, request: Request, user: auth.User = Depends(current_user)) -> dict:
    rate_limit(f"pw{user.id}", 5)
    if auth.login(user.email, req.current) is None:
        raise HTTPException(403, "Your current password is incorrect.")
    try:
        auth.set_password(user.id, req.new)
    except ValueError as exc:
        raise _bad(exc) from exc
    return {"ok": True, "message": "Password changed. Please sign in again."}


# ------------------------------------------------------------------ clients
@router.get("/api/clients")
def clients(all: bool = False, user: auth.User = Depends(current_user)) -> list[dict]:
    return repo.list_clients(user, include_archived=all and user.is_admin)


@router.post("/api/clients")
def create_client(req: ClientReq, user: auth.User = Depends(admin_user)) -> dict:
    try:
        cid = repo.create_client(req.name or "", req.industry or "", req.brand_color or "#5B5CE6", req.notes or "")
    except ValueError as exc:
        raise _bad(exc) from exc
    return repo.get_client(cid) or {}


@router.put("/api/clients/{cid}")
def update_client(cid: int, req: ClientReq, user: auth.User = Depends(admin_user)) -> dict:
    if not repo.get_client(cid):
        raise HTTPException(404, "Client not found.")
    try:
        repo.update_client(cid, **req.model_dump())
    except ValueError as exc:
        raise _bad(exc) from exc
    return repo.get_client(cid) or {}


@router.delete("/api/clients/{cid}")
def delete_client(cid: int, confirm: str = "", user: auth.User = Depends(admin_user)) -> dict:
    c = repo.get_client(cid)
    if not c:
        raise HTTPException(404, "Client not found.")
    if confirm != c["name"]:
        raise HTTPException(422, "Type the client name exactly to confirm deletion.")
    repo.delete_client(cid)
    fc.cache.clear()
    return {"deleted": True}


@router.post("/api/clients/{cid}/logo")
def client_logo_upload(cid: int, file: UploadFile = File(...), user: auth.User = Depends(admin_user)) -> dict:
    if not repo.get_client(cid):
        raise HTTPException(404, "Client not found.")
    try:
        repo.set_client_logo(cid, file.file.read(repo.MAX_LOGO_BYTES + 1), file.content_type or "")
    except ValueError as exc:
        raise _bad(exc) from exc
    return {"ok": True}


@router.get("/api/clients/{cid}/logo")
def client_logo(cid: int, user: auth.User = Depends(current_user)) -> Response:
    if not auth.can_access(user, cid):
        raise HTTPException(403, "You do not have access to this client.")
    logo = repo.client_logo(cid)
    if not logo:
        raise HTTPException(404, "No logo.")
    return Response(logo[0], media_type=logo[1], headers={"Cache-Control": "private, max-age=300"})


# ------------------------------------------------------------------ users
@router.get("/api/users")
def users(user: auth.User = Depends(admin_user)) -> list[dict]:
    return repo.list_users()


@router.post("/api/users")
def create_user(req: UserReq, user: auth.User = Depends(admin_user)) -> dict:
    try:
        uid = auth.create_user(req.email or "", req.password or "", req.name or "", req.role or "planner")
        if req.client_ids is not None:
            repo.update_user(uid, client_ids=req.client_ids)
    except ValueError as exc:
        raise _bad(exc) from exc
    return {"id": uid}


@router.put("/api/users/{uid}")
def update_user(uid: int, req: UserReq, user: auth.User = Depends(admin_user)) -> dict:
    if uid == user.id and (req.role == "planner" or req.active is False) and repo.count_admins() <= 1:
        raise HTTPException(422, "You are the only admin. Make someone else an admin first.")
    try:
        repo.update_user(uid, req.name, req.role, req.active, req.client_ids)
        if req.password:
            auth.set_password(uid, req.password)
    except ValueError as exc:
        raise _bad(exc) from exc
    return {"ok": True}


# ------------------------------------------------------------------ agency branding
@router.get("/api/branding")
def branding(user: auth.User = Depends(current_user)) -> dict:
    return repo.get_branding()


@router.put("/api/branding")
def set_branding(body: dict[str, Any], user: auth.User = Depends(admin_user)) -> dict:
    try:
        repo.set_branding(body)
    except ValueError as exc:
        raise _bad(exc) from exc
    return repo.get_branding()


@router.post("/api/branding/logo")
def set_agency_logo(file: UploadFile = File(...), user: auth.User = Depends(admin_user)) -> dict:
    try:
        repo.set_agency_logo(file.file.read(repo.MAX_LOGO_BYTES + 1), file.content_type or "")
    except ValueError as exc:
        raise _bad(exc) from exc
    return {"ok": True}


@router.get("/api/branding/logo")
def agency_logo() -> Response:
    """Public so the sign-in page can show the agency logo."""
    logo = repo.agency_logo()
    if not logo:
        raise HTTPException(404, "No logo.")
    return Response(logo[0], media_type=logo[1], headers={"Cache-Control": "public, max-age=300"})


@router.get("/api/branding/public")
def public_branding() -> dict:
    b = repo.get_branding()
    setup = auth.SETUP_PROBLEM if auth.SETUP_PROBLEM and not auth.has_users() else None
    return {"agency_name": b["agency_name"], "has_logo": b["has_logo"], "primary_color": b["primary_color"], "setup_problem": setup}


# ------------------------------------------------------------------ editable JSON config
EDITABLE = {"channel_aliases": "channel_aliases.json", "holidays": "holidays_lk.json", "dayparts": "dayparts.json"}


@router.get("/api/config/{name}")
def get_config(name: str, user: auth.User = Depends(current_user)) -> dict:
    if name not in EDITABLE:
        raise HTTPException(404, "Unknown config")
    return normalise.load_config(EDITABLE[name])


def validate_config(name: str, body: dict) -> None:
    """Reject malformed config so one bad edit cannot break uploads for everyone."""
    def num(v: Any) -> bool:
        return isinstance(v, (int, float)) and not isinstance(v, bool)
    if not isinstance(body, dict):
        raise ValueError("Config must be a JSON object.")
    if name == "channel_aliases":
        for k, v in body.items():
            if not k.startswith("_") and not (isinstance(v, list) and all(isinstance(x, str) for x in v)):
                raise ValueError(f"'{k}' must map to a list of alias strings.")
    elif name == "holidays":
        for e in body.get("events", []):
            if not isinstance(e, dict) or pd.isna(pd.to_datetime(e.get("date"), errors="coerce")) or not isinstance(e.get("name", ""), str):
                raise ValueError(f"Bad event: {e}")
        for sh in body.get("school_holidays", []):
            if not isinstance(sh, dict) or pd.isna(pd.to_datetime(sh.get("start"), errors="coerce")) or pd.isna(pd.to_datetime(sh.get("end"), errors="coerce")):
                raise ValueError(f"Bad school holiday: {sh}")
    elif name == "dayparts":
        dps = body.get("dayparts")
        if not isinstance(dps, list) or not dps or not all(isinstance(d, dict) and isinstance(d.get("name"), str) and num(d.get("start")) and num(d.get("end")) and 0 <= d["start"] <= 24 and 0 <= d["end"] <= 24 for d in dps):
            raise ValueError("dayparts must be a non-empty list of {name, start, end} with hours 0 to 24.")
        if not isinstance(body.get("duration_bands", []), list) or not all(isinstance(m, int) and m >= 1 for m in body.get("min_points", {}).values()):
            raise ValueError("duration_bands must be a list and min_points must be positive integers.")
        tb = body.get("timebelt_minutes", 30)
        if not isinstance(tb, int) or tb not in (15, 30, 60):
            raise ValueError("timebelt_minutes must be 15, 30 or 60.")


@router.put("/api/config/{name}")
def put_config(name: str, body: dict, user: auth.User = Depends(admin_user)) -> dict:
    """Replace a config file. Changes apply to the next upload and forecast."""
    if name not in EDITABLE:
        raise HTTPException(404, "Unknown config")
    try:
        validate_config(name, body)
        text = json.dumps(body, indent=2, ensure_ascii=False)
    except (TypeError, ValueError) as exc:
        raise HTTPException(422, f"Invalid config: {exc}") from exc
    (normalise.CONFIG_DIR / EDITABLE[name]).write_text(text, encoding="utf-8")
    normalise._cache.clear()
    fc.cache.clear()
    return {"saved": True}
