"""Database schema and engine. PostgreSQL in production (DATABASE_URL), SQLite for local use and tests.

Parsed datasets are stored as Parquet blobs per client, so history grows month by month
without keeping the original uploaded files.
"""
from __future__ import annotations

import logging
import os
import threading
from pathlib import Path

from sqlalchemy import (Boolean, Column, DateTime, ForeignKey, Integer, LargeBinary, MetaData, String, Table, Text,
                        UniqueConstraint, create_engine, event, func)
from sqlalchemy.engine import Engine

log = logging.getLogger(__name__)
metadata = MetaData()

users = Table(
    "users", metadata,
    Column("id", Integer, primary_key=True),
    Column("email", String(255), nullable=False, unique=True),
    Column("name", String(200), nullable=False, default=""),
    Column("password_hash", String(400), nullable=False),
    Column("role", String(20), nullable=False, default="planner"),       # admin | planner
    Column("active", Boolean, nullable=False, default=True),
    Column("created_at", DateTime(timezone=True), server_default=func.now()),
)

clients = Table(
    "clients", metadata,
    Column("id", Integer, primary_key=True),
    Column("name", String(200), nullable=False, unique=True),
    Column("industry", String(100), nullable=False, default=""),
    Column("brand_color", String(9), nullable=False, default="#5B5CE6"),
    Column("logo", LargeBinary),
    Column("logo_type", String(40)),
    Column("notes", Text, nullable=False, default=""),
    Column("archived", Boolean, nullable=False, default=False),
    Column("created_at", DateTime(timezone=True), server_default=func.now()),
)

user_clients = Table(
    "user_clients", metadata,
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("client_id", Integer, ForeignKey("clients.id", ondelete="CASCADE"), primary_key=True),
)

auth_sessions = Table(
    "auth_sessions", metadata,
    Column("token_hash", String(64), primary_key=True),
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
    Column("created_at", DateTime(timezone=True), server_default=func.now()),
    Column("expires_at", DateTime(timezone=True), nullable=False),
)

datasets = Table(
    "datasets", metadata,
    Column("id", Integer, primary_key=True),
    Column("client_id", Integer, ForeignKey("clients.id", ondelete="CASCADE"), nullable=False),
    Column("kind", String(20), nullable=False),          # tv | lmrb | kpi
    Column("name", String(200), nullable=False, default=""),
    Column("data", LargeBinary, nullable=False),         # parquet
    Column("report", Text, nullable=False, default="{}"),
    Column("meta", Text, nullable=False, default="{}"),  # kpi column mapping
    Column("files", Text, nullable=False, default="[]"),
    Column("hashes", Text, nullable=False, default="[]"),
    Column("rows", Integer, nullable=False, default=0),
    Column("updated_by", Integer, ForeignKey("users.id", ondelete="SET NULL")),
    Column("updated_at", DateTime(timezone=True), server_default=func.now(), onupdate=func.now()),
    UniqueConstraint("client_id", "kind", "name", name="uq_dataset"),
)

uploads = Table(
    "uploads", metadata,
    Column("id", Integer, primary_key=True),
    Column("client_id", Integer, ForeignKey("clients.id", ondelete="CASCADE"), nullable=False),
    Column("kind", String(20), nullable=False),
    Column("name", String(200), nullable=False, default=""),
    Column("file_name", String(300), nullable=False),
    Column("mode", String(10), nullable=False),
    Column("rows_in", Integer, nullable=False, default=0),
    Column("rows_added", Integer, nullable=False, default=0),
    Column("user_id", Integer, ForeignKey("users.id", ondelete="SET NULL")),
    Column("created_at", DateTime(timezone=True), server_default=func.now()),
)

saved_forecasts = Table(
    "saved_forecasts", metadata,
    Column("id", Integer, primary_key=True),
    Column("client_id", Integer, ForeignKey("clients.id", ondelete="CASCADE"), nullable=False),
    Column("kind", String(20), nullable=False),
    Column("dataset", String(200), nullable=False, default=""),
    Column("ftype", String(20), nullable=False, default="forecast"),   # forecast | scenarios | pacing
    Column("title", String(300), nullable=False),
    Column("request", Text, nullable=False),     # filters, options and params used
    Column("result", Text, nullable=False),
    Column("backend", String(20), nullable=False, default=""),
    Column("created_by", Integer, ForeignKey("users.id", ondelete="SET NULL")),
    Column("created_at", DateTime(timezone=True), server_default=func.now()),
)

reports = Table(
    "reports", metadata,
    Column("id", Integer, primary_key=True),
    Column("client_id", Integer, ForeignKey("clients.id", ondelete="CASCADE"), nullable=False),
    Column("kind", String(20), nullable=False),
    Column("format", String(10), nullable=False),
    Column("filename", String(300), nullable=False),
    Column("content", LargeBinary, nullable=False),
    Column("size", Integer, nullable=False, default=0),
    Column("request", Text, nullable=False, default="{}"),
    Column("created_by", Integer, ForeignKey("users.id", ondelete="SET NULL")),
    Column("created_at", DateTime(timezone=True), server_default=func.now()),
)

settings = Table(
    "settings", metadata,
    Column("key", String(100), primary_key=True),
    Column("value", Text, nullable=False),
    Column("blob", LargeBinary),
)

_engine: Engine | None = None
_lock = threading.Lock()


def database_url() -> str:
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        path = Path(os.environ.get("SQLITE_PATH", "data/app.db"))
        path.parent.mkdir(parents=True, exist_ok=True)
        return f"sqlite:///{path}"
    if url.startswith("postgres://"):            # Railway / Heroku style
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


def engine() -> Engine:
    global _engine
    with _lock:
        if _engine is None:
            url = database_url()
            kw = {"pool_pre_ping": True, "future": True}
            if url.startswith("sqlite"):
                kw["connect_args"] = {"check_same_thread": False}
            _engine = create_engine(url, **kw)
            if url.startswith("sqlite"):
                @event.listens_for(_engine, "connect")
                def _fk(dbapi_conn, _):  # SQLite needs foreign keys switched on for ON DELETE CASCADE
                    cur = dbapi_conn.cursor(); cur.execute("PRAGMA foreign_keys=ON"); cur.close()
            metadata.create_all(_engine)
            log.info("Database ready (%s)", url.split("@")[-1] if "@" in url else url)
        return _engine


def reset_engine() -> None:
    """Drop the cached engine (tests switch databases)."""
    global _engine
    with _lock:
        if _engine is not None:
            _engine.dispose()
        _engine = None
