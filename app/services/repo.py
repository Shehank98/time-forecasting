"""Data access for clients, users, datasets, saved forecasts, reports and agency branding."""
from __future__ import annotations

import json
from pathlib import Path
import logging
from typing import Any

from sqlalchemy import delete, func, insert, select, update

from . import db
from .auth import User

log = logging.getLogger(__name__)

MAX_LOGO_BYTES = 512 * 1024
LOGO_TYPES = {"image/png", "image/jpeg"}


def _iso(t: Any) -> str | None:
    return t.isoformat() if t is not None else None


# ---------------------------------------------------------------- clients
def list_clients(user: User, include_archived: bool = False) -> list[dict]:
    from .auth import client_ids_for
    ids = client_ids_for(user)
    q = select(db.clients.c.id, db.clients.c.name, db.clients.c.industry, db.clients.c.brand_color, db.clients.c.archived,
               (db.clients.c.logo.is_not(None)).label("has_logo")).order_by(db.clients.c.name)
    if not include_archived:
        q = q.where(db.clients.c.archived.is_(False))
    if ids is not None:
        q = q.where(db.clients.c.id.in_(ids or [-1]))
    with db.engine().connect() as c:
        return [dict(r) for r in c.execute(q).mappings()]


def get_client(cid: int) -> dict | None:
    with db.engine().connect() as c:
        r = c.execute(select(db.clients).where(db.clients.c.id == cid)).mappings().first()
    if not r:
        return None
    d = dict(r)
    d["has_logo"] = d.pop("logo") is not None
    return d


def client_logo(cid: int) -> tuple[bytes, str] | None:
    with db.engine().connect() as c:
        r = c.execute(select(db.clients.c.logo, db.clients.c.logo_type).where(db.clients.c.id == cid)).first()
    return (r[0], r[1]) if r and r[0] else None


def create_client(name: str, industry: str = "", brand_color: str = "#5B5CE6", notes: str = "") -> int:
    name = (name or "").strip()
    if not name:
        raise ValueError("Client name is required.")
    with db.engine().begin() as c:
        if c.execute(select(db.clients.c.id).where(func.lower(db.clients.c.name) == name.lower())).first():
            raise ValueError("A client with this name already exists.")
        return c.execute(insert(db.clients).values(name=name, industry=industry or "", brand_color=_color(brand_color), notes=notes or "")).inserted_primary_key[0]


def _color(v: str | None) -> str:
    v = (v or "#5B5CE6").strip()
    if not (len(v) == 7 and v.startswith("#") and all(ch in "0123456789abcdefABCDEF" for ch in v[1:])):
        raise ValueError("Brand colour must look like #1A2B3C.")
    return v.upper()


def update_client(cid: int, **fields: Any) -> None:
    allowed = {k: v for k, v in fields.items() if k in ("name", "industry", "brand_color", "notes", "archived") and v is not None}
    if "brand_color" in allowed:
        allowed["brand_color"] = _color(allowed["brand_color"])
    if "name" in allowed and not str(allowed["name"]).strip():
        raise ValueError("Client name is required.")
    with db.engine().begin() as c:
        c.execute(update(db.clients).where(db.clients.c.id == cid).values(**allowed))


def set_client_logo(cid: int, data: bytes, ctype: str) -> None:
    _check_logo(data, ctype)
    with db.engine().begin() as c:
        c.execute(update(db.clients).where(db.clients.c.id == cid).values(logo=data, logo_type=ctype))


def _check_logo(data: bytes, ctype: str) -> None:
    if ctype not in LOGO_TYPES:
        raise ValueError("Logo must be a PNG or JPEG image.")
    if len(data) > MAX_LOGO_BYTES:
        raise ValueError("Logo must be smaller than 512 KB.")
    sig_ok = data[:8] == b"\x89PNG\r\n\x1a\n" if ctype == "image/png" else data[:3] == b"\xff\xd8\xff"
    if not sig_ok:
        raise ValueError("The file does not look like a valid PNG or JPEG.")


def delete_client(cid: int) -> None:
    with db.engine().begin() as c:
        for t in (db.datasets, db.uploads, db.saved_forecasts, db.reports, db.user_clients):   # datasets/uploads: legacy tables
            c.execute(delete(t).where(t.c.client_id == cid))
        c.execute(delete(db.clients).where(db.clients.c.id == cid))


# ---------------------------------------------------------------- users
def list_users() -> list[dict]:
    with db.engine().connect() as c:
        rows = [dict(r) for r in c.execute(select(db.users.c.id, db.users.c.email, db.users.c.name, db.users.c.role, db.users.c.active).order_by(db.users.c.email)).mappings()]
        links = c.execute(select(db.user_clients)).all()
    by: dict[int, list[int]] = {}
    for uid, cid in links:
        by.setdefault(uid, []).append(cid)
    for r in rows:
        r["client_ids"] = sorted(by.get(r["id"], []))
    return rows


def update_user(uid: int, name: str | None = None, role: str | None = None, active: bool | None = None, client_ids: list[int] | None = None) -> None:
    vals: dict[str, Any] = {}
    if name is not None:
        vals["name"] = name
    if role is not None:
        if role not in ("admin", "planner"):
            raise ValueError("Role must be admin or planner.")
        vals["role"] = role
    if active is not None:
        vals["active"] = bool(active)
    with db.engine().begin() as c:
        if vals:
            c.execute(update(db.users).where(db.users.c.id == uid).values(**vals))
        if active is False:
            c.execute(delete(db.auth_sessions).where(db.auth_sessions.c.user_id == uid))
        if client_ids is not None:
            c.execute(delete(db.user_clients).where(db.user_clients.c.user_id == uid))
            if client_ids:
                c.execute(insert(db.user_clients), [{"user_id": uid, "client_id": int(x)} for x in set(client_ids)])


def count_admins() -> int:
    with db.engine().connect() as c:
        return int(c.execute(select(func.count()).select_from(db.users).where(db.users.c.role == "admin", db.users.c.active.is_(True))).scalar())


# ---------------------------------------------------------------- saved forecasts
def save_forecast(client_id: int, kind: str, dataset: str, ftype: str, title: str, request: dict, result: dict, user_id: int) -> int:
    with db.engine().begin() as c:
        return c.execute(insert(db.saved_forecasts).values(client_id=client_id, kind=kind, dataset=dataset, ftype=ftype, title=title[:300] or "Forecast",
                                                           request=json.dumps(request, default=str), result=json.dumps(result, default=str),
                                                           backend=str(result.get("backend") or result.get("method") or ""), created_by=user_id)).inserted_primary_key[0]


def list_forecasts(client_id: int) -> list[dict]:
    with db.engine().connect() as c:
        rows = c.execute(select(db.saved_forecasts.c.id, db.saved_forecasts.c.kind, db.saved_forecasts.c.dataset, db.saved_forecasts.c.ftype, db.saved_forecasts.c.title,
                                db.saved_forecasts.c.backend, db.saved_forecasts.c.created_at, db.users.c.email)
                         .join(db.users, db.users.c.id == db.saved_forecasts.c.created_by, isouter=True)
                         .where(db.saved_forecasts.c.client_id == client_id).order_by(db.saved_forecasts.c.id.desc())).mappings().all()
    return [{**{k: r[k] for k in ("id", "kind", "dataset", "ftype", "title", "backend")}, "by": r["email"], "created_at": _iso(r["created_at"])} for r in rows]


def get_forecast(client_id: int, fid: int) -> dict | None:
    with db.engine().connect() as c:
        r = c.execute(select(db.saved_forecasts).where(db.saved_forecasts.c.client_id == client_id, db.saved_forecasts.c.id == fid)).mappings().first()
    if not r:
        return None
    return {"id": r["id"], "kind": r["kind"], "dataset": r["dataset"], "ftype": r["ftype"], "title": r["title"], "request": json.loads(r["request"]),
            "result": json.loads(r["result"]), "created_at": _iso(r["created_at"])}


def delete_forecast(client_id: int, fid: int) -> None:
    with db.engine().begin() as c:
        c.execute(delete(db.saved_forecasts).where(db.saved_forecasts.c.client_id == client_id, db.saved_forecasts.c.id == fid))


# ---------------------------------------------------------------- reports
def save_report(client_id: int, kind: str, fmt: str, filename: str, content: bytes, request: dict, user_id: int) -> int:
    with db.engine().begin() as c:
        return c.execute(insert(db.reports).values(client_id=client_id, kind=kind, format=fmt, filename=filename, content=content, size=len(content),
                                                   request=json.dumps(request, default=str), created_by=user_id)).inserted_primary_key[0]


def list_reports(client_id: int) -> list[dict]:
    with db.engine().connect() as c:
        rows = c.execute(select(db.reports.c.id, db.reports.c.kind, db.reports.c.format, db.reports.c.filename, db.reports.c.size, db.reports.c.created_at, db.users.c.email)
                         .join(db.users, db.users.c.id == db.reports.c.created_by, isouter=True)
                         .where(db.reports.c.client_id == client_id).order_by(db.reports.c.id.desc()).limit(100)).mappings().all()
    return [{**{k: r[k] for k in ("id", "kind", "format", "filename", "size")}, "by": r["email"], "created_at": _iso(r["created_at"])} for r in rows]


def get_report(client_id: int, rid: int) -> dict | None:
    with db.engine().connect() as c:
        r = c.execute(select(db.reports).where(db.reports.c.client_id == client_id, db.reports.c.id == rid)).mappings().first()
    return dict(r) if r else None


def delete_report(client_id: int, rid: int) -> None:
    with db.engine().begin() as c:
        c.execute(delete(db.reports).where(db.reports.c.client_id == client_id, db.reports.c.id == rid))


# ---------------------------------------------------------------- agency branding
DEFAULT_BRANDING = {"agency_name": "Media Radar", "primary_color": "#4F46E5", "report_footer": "Confidential. Prepared for the named client only.",
                    "disclaimer": "Forecasts are probabilistic estimates based on historical data and are not guarantees of future results."}


def get_branding() -> dict:
    with db.engine().connect() as c:
        r = c.execute(select(db.settings.c.value, db.settings.c.blob).where(db.settings.c.key == "branding")).first()
    out = dict(DEFAULT_BRANDING)
    if r:
        out.update(json.loads(r[0]))
        out["has_logo"] = r[1] is not None
    else:
        out["has_logo"] = False
    return out


def set_branding(values: dict) -> None:
    cur = {k: v for k, v in get_branding().items() if k in DEFAULT_BRANDING or k == "logo_type"}
    for k in DEFAULT_BRANDING:
        if k in values and values[k] is not None:
            cur[k] = str(values[k])[:500]
    cur["primary_color"] = _color(cur["primary_color"])
    _upsert_setting("branding", json.dumps(cur), keep_blob=True)


def set_agency_logo(data: bytes, ctype: str) -> None:
    _check_logo(data, ctype)
    cur = {k: v for k, v in get_branding().items() if k != "has_logo"}
    cur["logo_type"] = ctype
    _upsert_setting("branding", json.dumps(cur), blob=data)


_BUILTIN_LOGO = Path(__file__).resolve().parent.parent / "static" / "img" / "logo-white.png"


def agency_logo() -> tuple[bytes, str] | None:
    """The Ogilvy Orbit Forecasting logo is the agency logo everywhere (app and reports)."""
    try:
        return _BUILTIN_LOGO.read_bytes(), "image/png"
    except OSError:
        return None


def _upsert_setting(key: str, value: str, blob: bytes | None = None, keep_blob: bool = False) -> None:
    with db.engine().begin() as c:
        exists = c.execute(select(db.settings.c.key).where(db.settings.c.key == key)).first()
        vals: dict[str, Any] = {"value": value}
        if not keep_blob or blob is not None:
            if blob is not None:
                vals["blob"] = blob
        if exists:
            c.execute(update(db.settings).where(db.settings.c.key == key).values(**vals))
        else:
            c.execute(insert(db.settings).values(key=key, **vals))
