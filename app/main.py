"""FastAPI entry point: one service for the API and the static frontend."""
from __future__ import annotations

import logging
import os
import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .routers import account, ai, data, forecasting, reports
from .services import auth, db
from .services import forecast as fc

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("app")

STATIC_DIR = Path(__file__).parent / "static"
UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.engine()
    auth.bootstrap_admin()
    if os.environ.get("PRELOAD_MODEL", "1") == "1" and os.environ.get("FORCE_FALLBACK") != "1":
        threading.Thread(target=fc.model.load, daemon=True, name="timesfm-preload").start()
    yield


app = FastAPI(title="Media Radar: competitor analysis and forecasting", version="2.0.0", lifespan=lifespan)


@app.middleware("http")
async def guard(request: Request, call_next):
    """CSRF guard (state changes need a header a cross-site form cannot set) plus security headers."""
    if request.url.path.startswith("/api/") and request.method in UNSAFE and request.headers.get("x-requested-with") != "fetch":
        return JSONResponse({"detail": "Missing request header."}, status_code=403)
    resp = await call_next(request)
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("Referrer-Policy", "same-origin")
    resp.headers.setdefault("X-Frame-Options", "DENY")
    if request.url.path.startswith("/api/"):
        resp.headers.setdefault("Cache-Control", "no-store")
    return resp


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


for r in (account.router, forecasting.router, ai.router, reports.router, data.router):
    app.include_router(r)


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception) -> JSONResponse:
    log.exception("Unhandled error on %s", request.url.path)
    return JSONResponse({"detail": "Something went wrong on the server. Please try again."}, status_code=500)


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
