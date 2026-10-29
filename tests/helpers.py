"""Test helpers: signed-in API clients scoped to a fresh client workspace."""
import uuid

from fastapi.testclient import TestClient

import synth
from app.main import app

ADMIN = ("admin@agency.lk", "admin-pass-123")


def login(email: str = ADMIN[0], password: str = ADMIN[1], headers: dict | None = None, **kw) -> TestClient:
    c = TestClient(app, headers={"X-Requested-With": "fetch", **(headers or {})}, **kw)
    r = c.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return c


def new_client(c: TestClient, name: str | None = None) -> int:
    r = c.post("/api/clients", json={"name": name or f"Client {uuid.uuid4().hex[:8]}", "industry": "FMCG"})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def api(**kw) -> TestClient:
    """Admin client with its own client workspace selected."""
    c = login(**kw)
    c.headers["X-Client-Id"] = str(new_client(c))
    return c


def up(c: TestClient, kind: str, df, name: str = "a.csv", mode: str = "replace"):
    return c.post(f"/api/{kind}/upload?mode={mode}", files={"file": (name, synth.to_csv_bytes(df))})
