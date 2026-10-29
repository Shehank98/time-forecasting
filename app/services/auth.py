"""Users, password hashing, login sessions and client access rules.

Passwords use scrypt from the standard library. Login sessions are random tokens stored
as SHA-256 hashes, so a leaked database does not leak usable cookies.
"""
from __future__ import annotations

import base64
import datetime as dt
import hashlib
import hmac
import logging
import os
import secrets
import threading
import time
from dataclasses import dataclass

from sqlalchemy import delete, insert, select, update

from . import db

log = logging.getLogger(__name__)

SESSION_DAYS = int(os.environ.get("LOGIN_DAYS", "7"))
ROLES = ("admin", "planner")
_N, _R, _P = 2 ** 14, 8, 1


@dataclass
class User:
    id: int
    email: str
    name: str
    role: str

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"


def hash_password(pw: str) -> str:
    salt = secrets.token_bytes(16)
    h = hashlib.scrypt(pw.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)
    return f"scrypt${_N}${_R}${_P}${base64.b64encode(salt).decode()}${base64.b64encode(h).decode()}"


def verify_password(pw: str, stored: str) -> bool:
    try:
        _, n, r, p, salt, h = stored.split("$")
        calc = hashlib.scrypt(pw.encode(), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p), dklen=32)
        return hmac.compare_digest(calc, base64.b64decode(h))
    except (ValueError, TypeError):
        return False


def validate_password(pw: str) -> None:
    if len(pw or "") < 10:
        raise ValueError("Passwords need at least 10 characters.")


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _aware(t: dt.datetime) -> dt.datetime:
    return t if t.tzinfo else t.replace(tzinfo=dt.timezone.utc)


def create_user(email: str, password: str, name: str = "", role: str = "planner") -> int:
    email = email.strip().lower()
    if "@" not in email:
        raise ValueError("Enter a valid email address.")
    if role not in ROLES:
        raise ValueError("Role must be admin or planner.")
    validate_password(password)
    with db.engine().begin() as c:
        if c.execute(select(db.users.c.id).where(db.users.c.email == email)).first():
            raise ValueError("A user with this email already exists.")
        return c.execute(insert(db.users).values(email=email, name=name or email.split("@")[0], password_hash=hash_password(password), role=role, active=True)).inserted_primary_key[0]


def bootstrap_admin() -> None:
    """Create the first admin from ADMIN_EMAIL and ADMIN_PASSWORD when no user exists yet."""
    with db.engine().begin() as c:
        if c.execute(select(db.users.c.id).limit(1)).first():
            return
    email, pw = os.environ.get("ADMIN_EMAIL"), os.environ.get("ADMIN_PASSWORD")
    if email and pw:
        create_user(email, pw, "Administrator", "admin")
        log.info("Created the first admin user %s", email)
    else:
        log.warning("No users exist. Set ADMIN_EMAIL and ADMIN_PASSWORD to create the first admin.")


# ---------------------------------------------------------------- login throttle
_attempts: dict[str, list[float]] = {}
_alock = threading.Lock()


def throttled(key: str, limit: int = 5, window: int = 300) -> bool:
    with _alock:
        now = time.time()
        hits = [t for t in _attempts.get(key, []) if now - t < window]
        _attempts[key] = hits
        return len(hits) >= limit


def record_failure(key: str) -> None:
    with _alock:
        _attempts.setdefault(key, []).append(time.time())


def login(email: str, password: str) -> tuple[str, User] | None:
    email = (email or "").strip().lower()
    with db.engine().begin() as c:
        row = c.execute(select(db.users).where(db.users.c.email == email)).mappings().first()
        if not row or not row["active"] or not verify_password(password or "", row["password_hash"]):
            if not row:
                hash_password("timing-equaliser")   # keep response time similar for unknown emails
            return None
        token = secrets.token_urlsafe(32)
        c.execute(insert(db.auth_sessions).values(token_hash=hashlib.sha256(token.encode()).hexdigest(), user_id=row["id"],
                                                  expires_at=_now() + dt.timedelta(days=SESSION_DAYS)))
        c.execute(delete(db.auth_sessions).where(db.auth_sessions.c.expires_at < _now()))
        return token, User(row["id"], row["email"], row["name"], row["role"])


def logout(token: str | None) -> None:
    if token:
        with db.engine().begin() as c:
            c.execute(delete(db.auth_sessions).where(db.auth_sessions.c.token_hash == hashlib.sha256(token.encode()).hexdigest()))


def user_for_token(token: str | None) -> User | None:
    if not token:
        return None
    th = hashlib.sha256(token.encode()).hexdigest()
    with db.engine().connect() as c:
        row = c.execute(select(db.users, db.auth_sessions.c.expires_at).join(db.auth_sessions, db.auth_sessions.c.user_id == db.users.c.id)
                        .where(db.auth_sessions.c.token_hash == th)).mappings().first()
    if not row or not row["active"] or _aware(row["expires_at"]) < _now():
        return None
    return User(row["id"], row["email"], row["name"], row["role"])


def set_password(user_id: int, password: str) -> None:
    validate_password(password)
    with db.engine().begin() as c:
        c.execute(update(db.users).where(db.users.c.id == user_id).values(password_hash=hash_password(password)))
        c.execute(delete(db.auth_sessions).where(db.auth_sessions.c.user_id == user_id))


def client_ids_for(user: User) -> set[int] | None:
    """None means every client (admins)."""
    if user.is_admin:
        return None
    with db.engine().connect() as c:
        return {r[0] for r in c.execute(select(db.user_clients.c.client_id).where(db.user_clients.c.user_id == user.id))}


def can_access(user: User, client_id: int) -> bool:
    ids = client_ids_for(user)
    return ids is None or client_id in ids
