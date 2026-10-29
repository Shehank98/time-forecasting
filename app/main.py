"""FastAPI entry point: serves the static frontend and the JSON API from one service."""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

import pandas as pd
from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .services import analytics_lmrb, analytics_tv, ingest, normalise, filters as flt
from .services.store import Dataset, Session, SessionStore, content_hash
from .services.util import jsonable

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("app")

MAX_UPLOAD_MB = int(os.environ.get("MAX_UPLOAD_MB", "25"))
STATIC_DIR = Path(__file__).parent / "static"
KINDS = ("tv", "lmrb")

app = FastAPI(title="TV Competitor Analysis and Forecasting", version="1.0.0")
store = SessionStore()


# ------------------------------------------------------------------ session
def current_session(request: Request, response: Response) -> Session:
    """Resolve the session from the cookie, creating one when missing or expired."""
    sess = store.get(request.cookies.get("sid"))
    response.set_cookie("sid", sess.sid, httponly=True, samesite="lax", max_age=60 * 60 * 24)
    return sess


def dataset(sess: Session, kind: str) -> Dataset:
    if kind not in KINDS:
        raise HTTPException(404, "Unknown workspace")
    ds = sess.data.get(kind)
    if ds is None or ds.df.empty:
        raise HTTPException(409, "No file loaded for this workspace. Please upload a file first.")
    return ds


class DashReq(BaseModel):
    filters: dict[str, Any] = Field(default_factory=dict)
    options: dict[str, Any] = Field(default_factory=dict)


class TableReq(DashReq):
    page: int = 1
    page_size: int = 25
    sort: str | None = None
    desc: bool = True
    search: str = ""


# ------------------------------------------------------------------ health
@app.get("/health")
def health() -> dict:
    return {"status": "ok", "sessions": len(store)}


# ------------------------------------------------------------------ upload
def _state(ds: Dataset | None, kind: str) -> dict:
    if ds is None:
        return {"loaded": False}
    return {"loaded": True, "report": ds.report, "files": ds.files, "options": jsonable(flt.filter_options(ds.df, kind)),
            "has_lmrb": None}


@app.post("/api/{kind}/upload")
def upload(kind: str, file: UploadFile = File(...), mode: str = Query("replace"), sess: Session = Depends(current_session)) -> dict:
    """Upload a file. mode=append merges and dedupes with the data already loaded."""
    if kind not in KINDS:
        raise HTTPException(404, "Unknown workspace")
    name = file.filename or "upload"
    if not name.lower().endswith(ingest.ALLOWED_EXT):
        raise HTTPException(415, "Unsupported file type. Please upload .xlsx, .xls or .csv.")
    limit = MAX_UPLOAD_MB * 1024 * 1024
    content = file.file.read(limit + 1)
    if len(content) > limit:
        raise HTTPException(413, f"File is larger than the {MAX_UPLOAD_MB} MB limit.")
    try:
        res = ingest.parse(content, name, kind)
    except ingest.IngestError as exc:
        raise HTTPException(422, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 - never crash on a bad file
        log.exception("Unexpected parse failure for %s", name)
        raise HTTPException(422, f"Could not process this file: {exc}") from exc
    existing = sess.data.get(kind)
    h = content_hash(content)
    if mode == "append" and existing is not None:
        merged, added, skipped = ingest.merge(existing.df, res.df, kind)
        res.report.update({"appended": True, "rows_added": added, "rows_skipped_as_duplicates": skipped, "rows_total_after_merge": len(merged),
                           "date_min": merged["date"].min().strftime("%Y-%m-%d"), "date_max": merged["date"].max().strftime("%Y-%m-%d"),
                           "n_days": int(merged["date"].nunique())})
        sess.data[kind] = Dataset(merged, res.report, existing.files + [name], existing.hashes + [h])
    else:
        sess.data[kind] = Dataset(res.df, res.report, [name], [h])
    log.info("Loaded %s rows for %s (%s)", len(sess.data[kind].df), kind, name)
    st = _state(sess.data[kind], kind)
    st["has_lmrb"] = "lmrb" in sess.data
    return jsonable(st)


@app.get("/api/{kind}/state")
def state(kind: str, sess: Session = Depends(current_session)) -> dict:
    if kind not in KINDS:
        raise HTTPException(404, "Unknown workspace")
    st = _state(sess.data.get(kind), kind)
    st["has_lmrb"] = "lmrb" in sess.data
    st["has_tv"] = "tv" in sess.data
    return jsonable(st)


@app.delete("/api/{kind}")
def clear(kind: str, sess: Session = Depends(current_session)) -> dict:
    sess.data.pop(kind, None)
    return {"loaded": False}


# ------------------------------------------------------------------ dashboards
def _bounds(f: dict) -> tuple[pd.Timestamp | None, pd.Timestamp | None]:
    a, b = pd.to_datetime(f.get("date_from"), errors="coerce"), pd.to_datetime(f.get("date_to"), errors="coerce")
    return (a if pd.notna(a) else None), (b if pd.notna(b) else None)


def build_dashboard(sess: Session, kind: str, filters: dict, options: dict) -> dict:
    """Shared by the dashboard endpoint, insights and exports so numbers always agree."""
    ds = dataset(sess, kind)
    filtered = flt.apply_filters(ds.df, kind, filters)
    meta = {"total_rows": int(len(ds.df)), "filtered_rows": int(len(filtered)), "chips": flt.describe_filters(kind, filters),
            "has_lmrb": "lmrb" in sess.data}
    if kind == "tv":
        lm = sess.data["lmrb"].df if "lmrb" in sess.data else None
        data = analytics_tv.dashboard(filtered, lm)
    else:
        nodate = flt.apply_filters(ds.df, kind, filters, skip_date=True)
        start, end = _bounds(filters)
        brand = options.get("my_brand") or None
        data = analytics_lmrb.dashboard(nodate, start, end, brand, options.get("competitors") or None)
    return {"meta": meta, "data": data}


@app.post("/api/{kind}/dashboard")
def dashboard(kind: str, req: DashReq, sess: Session = Depends(current_session)) -> dict:
    return jsonable(build_dashboard(sess, kind, req.filters, req.options))


@app.post("/api/lmrb/head2head")
def head2head(req: DashReq, sess: Session = Depends(current_session)) -> dict:
    ds = dataset(sess, "lmrb")
    a, b = req.options.get("a"), req.options.get("b")
    if not a or not b or a == b:
        raise HTTPException(422, "Pick two different advertisers.")
    nodate = flt.apply_filters(ds.df, "lmrb", req.filters, skip_date=True)
    start, end = _bounds(req.filters)
    return analytics_lmrb.head_to_head(nodate, start, end, a, b)


TABLE_COLS = {
    "tv": ["date", "day", "channel", "start", "end", "program", "category", "data_set", "daypart", "duration", "tvr", "total_tvr", "tvr_share", "reach", "reach_pct"],
    "lmrb": ["date", "day", "channel", "program", "advt_time", "daypart", "advertiser", "product", "theme", "product_group", "lng", "dur", "dur_band",
             "position", "brkno", "posinbrk", "adsinbrk", "cost", "cps"],
}


@app.post("/api/{kind}/rows")
def rows(kind: str, req: TableReq, sess: Session = Depends(current_session)) -> dict:
    """Paginated raw rows of the filtered data (the only place raw rows reach the browser)."""
    ds = dataset(sess, kind)
    df = flt.apply_filters(ds.df, kind, req.filters)[TABLE_COLS[kind]]
    q = req.search.strip().lower()
    if q:
        hay = df.astype(str).agg(" ".join, axis=1).str.lower()
        df = df[hay.str.contains(q, regex=False)]
    if req.sort in df.columns:
        df = df.sort_values(req.sort, ascending=not req.desc, kind="stable")
    size = max(1, min(req.page_size, 200))
    page = max(1, req.page)
    chunk = df.iloc[(page - 1) * size: page * size]
    return jsonable({"columns": TABLE_COLS[kind], "rows": chunk.values.tolist(), "total": int(len(df)), "page": page, "page_size": size})


@app.post("/api/{kind}/rows/csv")
def rows_csv(kind: str, req: DashReq, sess: Session = Depends(current_session)) -> Response:
    """Download the filtered rows as CSV (capped to keep memory bounded)."""
    ds = dataset(sess, kind)
    df = flt.apply_filters(ds.df, kind, req.filters)[TABLE_COLS[kind]].head(250_000)
    return Response(df.to_csv(index=False), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{kind}_filtered_rows.csv"'})


@app.get("/api/model-status")
def model_status() -> dict:
    return {"backend": "pending", "loaded": False, "note": "Forecast model is added in step 4."}


# ------------------------------------------------------------------ config (editable JSON)
EDITABLE = {"channel_aliases": "channel_aliases.json", "holidays": "holidays_lk.json", "dayparts": "dayparts.json"}


@app.get("/api/config/{name}")
def get_config(name: str) -> dict:
    if name not in EDITABLE:
        raise HTTPException(404, "Unknown config")
    return normalise.load_config(EDITABLE[name])


@app.put("/api/config/{name}")
def put_config(name: str, body: dict) -> dict:
    """Replace a config file. Changes apply to the next upload and forecast."""
    if name not in EDITABLE:
        raise HTTPException(404, "Unknown config")
    try:
        text = json.dumps(body, indent=2, ensure_ascii=False)
    except (TypeError, ValueError) as exc:
        raise HTTPException(422, f"Invalid JSON: {exc}") from exc
    (normalise.CONFIG_DIR / EDITABLE[name]).write_text(text, encoding="utf-8")
    normalise._cache.clear()
    return {"saved": True}


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception) -> JSONResponse:
    log.exception("Unhandled error on %s", request.url.path)
    return JSONResponse({"detail": "Something went wrong on the server. Please try again."}, status_code=500)


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
