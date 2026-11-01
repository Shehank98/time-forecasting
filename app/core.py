"""Shared dependencies: the signed-in user, the client a request works on, and rate limiting."""
from __future__ import annotations

import logging
import threading
import time

from fastapi import Depends, HTTPException, Request

from .services import auth
from .services.store import Workspace

log = logging.getLogger("app")

COOKIE = "auth"


def current_user(request: Request) -> auth.User:
    user = auth.user_for_token(request.cookies.get(COOKIE))
    if user is None:
        raise HTTPException(401, "Please sign in.")
    return user


def admin_user(user: auth.User = Depends(current_user)) -> auth.User:
    if not user.is_admin:
        raise HTTPException(403, "Only admins can do this.")
    return user


def workspace(request: Request, user: auth.User = Depends(current_user)) -> Workspace:
    """The client the request works on, from the X-Client-Id header, after an access check."""
    raw = request.headers.get("x-client-id") or request.query_params.get("client")
    try:
        cid = int(raw)
    except (TypeError, ValueError):
        raise HTTPException(409, "Select a client first.") from None
    if not auth.can_access(user, cid):
        raise HTTPException(403, "You do not have access to this client.")
    from .services import repo
    c = repo.get_client(cid)
    if not c or c["archived"]:
        raise HTTPException(404, "Client not found or archived.")
    return Workspace(cid, user.id, user.is_admin)


_hits: dict[str, list[float]] = {}
_hlock = threading.Lock()


def rate_limit(key: str, per_minute: int = 12) -> None:
    with _hlock:
        now = time.time()
        hits = [t for t in _hits.get(key, []) if now - t < 60]
        if len(hits) >= per_minute:
            raise HTTPException(429, "Too many requests. Please wait a minute.")
        hits.append(now)
        _hits[key] = hits
