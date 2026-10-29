"""FastAPI entry point: serves the static frontend and the JSON API from one service."""
from __future__ import annotations

import json
import logging
import os
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import pandas as pd
from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from starlette.background import BackgroundTask
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .services import analytics_lmrb, analytics_tv, ingest, normalise, series as series_mod, filters as flt
from .services import forecast as fc
from .services import gemini_client as gem
from .services import export_excel, export_pdf, report_data
from .services.store import Dataset, Session, SessionStore, content_hash
from .services.util import jsonable

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("app")

MAX_UPLOAD_MB = int(os.environ.get("MAX_UPLOAD_MB", "25"))
STATIC_DIR = Path(__file__).parent / "static"
KINDS = ("tv", "lmrb")

@asynccontextmanager
async def lifespan(_: FastAPI):
    """Warm TimesFM in the background so the first forecast is fast (PRELOAD_MODEL=0 keeps it lazy)."""
    if os.environ.get("PRELOAD_MODEL", "1") == "1" and os.environ.get("FORCE_FALLBACK") != "1":
        threading.Thread(target=fc.model.load, daemon=True, name="timesfm-preload").start()
    yield


app = FastAPI(title="TV Competitor Analysis and Forecasting", version="1.0.0", lifespan=lifespan)
store = SessionStore()


# ------------------------------------------------------------------ session
def current_session(request: Request, response: Response) -> Session:
    """Resolve the session from the cookie, creating one when missing or expired."""
    sess = store.get(request.cookies.get("sid"))
    secure = request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"
    response.set_cookie("sid", sess.sid, httponly=True, samesite="lax", secure=secure, max_age=60 * 60 * 24)
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


def csv_safe(df: pd.DataFrame) -> pd.DataFrame:
    """Neutralise spreadsheet formula injection: text cells starting with = + - @ get a leading apostrophe."""
    out = df.copy()
    for c in out.columns:
        if out[c].dtype == object or str(out[c].dtype).startswith("str"):
            out[c] = out[c].map(lambda v: "'" + v if isinstance(v, str) and v[:1] in ("=", "+", "-", "@", "\t", "\r") else v)
    return out


@app.post("/api/{kind}/rows/csv")
def rows_csv(kind: str, req: DashReq, sess: Session = Depends(current_session)) -> Response:
    """Download the filtered rows as CSV (capped to keep memory bounded)."""
    ds = dataset(sess, kind)
    df = flt.apply_filters(ds.df, kind, req.filters)[TABLE_COLS[kind]].head(250_000)
    return Response(csv_safe(df).to_csv(index=False), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{kind}_filtered_rows.csv"'})


@app.get("/api/model-status")
def model_status() -> dict:
    return fc.model.status()


# ------------------------------------------------------------------ forecasting
class ForecastReq(DashReq):
    kind: str
    params: dict[str, Any] = Field(default_factory=dict)


def forecast_frame(sess: Session, kind: str, filters: dict, options: dict) -> pd.DataFrame:
    """Filtered frame used for forecasting. LMRB respects the selected competitor set."""
    ds = dataset(sess, kind)
    df = flt.apply_filters(ds.df, kind, filters)
    if kind == "lmrb" and options.get("my_brand"):
        base = flt.apply_filters(ds.df, kind, filters, skip_date=True)
        df = df[df["advertiser"].isin(analytics_lmrb.competitor_set(base, options["my_brand"], options.get("competitors") or None))]
    return df


def forecast_result(sess: Session, req: ForecastReq, progress=None) -> dict:
    """Compute (or fetch from cache) a forecast. Shared by the API and the exports."""
    ds = dataset(sess, req.kind)
    key = fc.cache.key(ds.version, req.kind, req.filters, req.options, req.params)
    hit = fc.cache.get(key)
    if hit is not None:
        return {**hit, "cached": True}
    res = fc.run(forecast_frame(sess, req.kind, req.filters, req.options), req.kind, req.params, progress)
    res["cached"] = False
    if res.get("ok"):
        fc.cache.put(key, res)
    return res


@app.post("/api/forecast/entities")
def forecast_entities(req: ForecastReq, sess: Session = Depends(current_session)) -> dict:
    try:
        df = forecast_frame(sess, req.kind, req.filters, req.options)
        et = req.params.get("entity_type", "advertiser" if req.kind == "lmrb" else "channel")
        return jsonable({"entities": series_mod.rank_entities(df, req.kind, et), "catalog": series_mod.metric_catalog(req.kind),
                         "min_points": normalise.min_points(), "model": fc.model.status()})
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post("/api/forecast/start")
def forecast_start(req: ForecastReq, sess: Session = Depends(current_session)) -> dict:
    if not req.params.get("metric"):
        raise HTTPException(422, "Choose a metric to forecast.")
    dataset(sess, req.kind)
    jid = fc.jobs.start(lambda progress: forecast_result(sess, req, progress))
    return {"job_id": jid}


@app.get("/api/forecast/job/{jid}")
def forecast_job(jid: str) -> dict:
    j = fc.jobs.get(jid)
    if j is None:
        raise HTTPException(404, "Forecast job not found. It may have expired.")
    return jsonable({k: j[k] for k in ("status", "progress", "message", "result", "error")})


# ------------------------------------------------------------------ AI insights and chat
class AiReq(DashReq):
    kind: str
    forecast: dict[str, Any] | None = None       # forecast params the user last ran (served from cache)
    question: str = ""
    history: list[dict[str, Any]] = Field(default_factory=list)
    refresh: bool = False


_ai_hits: dict[str, list[float]] = {}
_insight_cache: dict[str, dict] = {}


def _rate_limit(sid: str, per_minute: int = 12) -> None:
    import time
    now = time.time()
    hits = [t for t in _ai_hits.get(sid, []) if now - t < 60]
    if len(hits) >= per_minute:
        raise HTTPException(429, "Too many AI requests. Please wait a minute.")
    hits.append(now)
    _ai_hits[sid] = hits


def ai_facts(sess: Session, req: AiReq) -> tuple[gem.Facts, dict | None, dict, dict]:
    """Aggregates only (never raw rows): dashboard KPIs and movers, plus the cached forecast when requested."""
    built = build_dashboard(sess, req.kind, req.filters, req.options)
    fcres = None
    if req.forecast:
        fcres = forecast_result(sess, ForecastReq(kind=req.kind, filters=req.filters, options=req.options, params=req.forecast))
    return gem.build_facts(req.kind, built["data"], fcres, built["meta"]), fcres, built["data"], built["meta"]


@app.post("/api/insights")
def insights(req: AiReq, sess: Session = Depends(current_session)) -> dict:
    _rate_limit(sess.sid)
    facts, fcres, dash, meta = ai_facts(sess, req)
    if dash.get("empty"):
        raise HTTPException(422, "No rows match the current filters, so there is nothing to analyse.")
    key = fc.ResultCache.key(dataset(sess, req.kind).version, req.kind, req.filters, req.options, {"ai": req.forecast, "m": gem.service.model_name})
    if not req.refresh and key in _insight_cache:
        return {**_insight_cache[key], "cached": True}
    try:
        out = gem.service.insights(facts, req.kind, gem.standing_caveats(fcres, dash, meta))
    except gem.GeminiError as exc:
        raise HTTPException(exc.status, str(exc)) from exc
    res = jsonable({"insights": out, "model": gem.service.model_name, "fact_count": len(facts.items), "cached": False})
    _insight_cache[key] = res
    if len(_insight_cache) > 100:
        _insight_cache.pop(next(iter(_insight_cache)))
    return res


@app.post("/api/chat")
def chat(req: AiReq, sess: Session = Depends(current_session)) -> dict:
    if not req.question.strip():
        raise HTTPException(422, "Type a question first.")
    _rate_limit(sess.sid)
    facts, _, dash, _ = ai_facts(sess, req)
    if dash.get("empty"):
        raise HTTPException(422, "No rows match the current filters, so there is nothing to ask about.")
    try:
        return jsonable(gem.service.chat(facts, req.question, req.history))
    except gem.GeminiError as exc:
        raise HTTPException(exc.status, str(exc)) from exc


@app.get("/api/ai-status")
def ai_status() -> dict:
    return {"configured": gem.service.configured(), "model": gem.service.model_name}


# ------------------------------------------------------------------ export
class ExportReq(DashReq):
    kind: str
    format: str = "xlsx"
    include_ai: bool = False
    forecast: dict[str, Any] | None = None      # forecast params to include (served from cache when already run)
    ai: dict[str, Any] | None = None            # insights already generated in the browser session


@app.post("/api/export")
def export(req: ExportReq, sess: Session = Depends(current_session)) -> FileResponse:
    """Build an Excel or PDF report for the current filters, stream it and delete the temp file afterwards."""
    import datetime as dt
    import tempfile
    if req.format not in ("xlsx", "pdf"):
        raise HTTPException(422, "Format must be xlsx or pdf.")
    ds = dataset(sess, req.kind)
    built = build_dashboard(sess, req.kind, req.filters, req.options)
    if built["data"].get("empty"):
        raise HTTPException(422, "No rows match the current filters, so there is nothing to export.")
    notes: list[str] = []
    fcres = None
    if req.forecast:
        try:
            fcres = forecast_result(sess, ForecastReq(kind=req.kind, filters=req.filters, options=req.options, params=req.forecast))
            if not fcres.get("ok"):
                notes.append("Forecast not included: " + str(fcres.get("message", "no result")))
                fcres = None
        except Exception as exc:  # noqa: BLE001
            log.exception("Forecast for export failed")
            notes.append(f"Forecast not included: {exc}")
    ai = None
    if req.include_ai:
        ai = req.ai
        if ai is None:
            try:
                facts = gem.build_facts(req.kind, built["data"], fcres, built["meta"])
                ai = jsonable(gem.service.insights(facts, req.kind, gem.standing_caveats(fcres, built["data"], built["meta"])))
            except gem.GeminiError as exc:
                notes.append(f"AI summary not included: {exc}")
    chips = [f"{c['label']}: {c['value']}" for c in built["meta"]["chips"]]
    rep = report_data.build(req.kind, built["data"], built["meta"], ds.files, fcres, ai, chips)
    rep.notes += notes
    stamp = dt.datetime.now().strftime("%Y%m%d_%H%M")
    fname = f"{req.kind}_report_{stamp}.{req.format}"
    fd, path = tempfile.mkstemp(suffix="." + req.format)
    os.close(fd)
    try:
        if req.format == "xlsx":
            export_excel.build_workbook(rep).save(path)
        else:
            Path(path).write_bytes(export_pdf.build_pdf(rep))
    except Exception:
        os.remove(path)
        log.exception("Export failed")
        raise HTTPException(500, "The report could not be built. Please try again with fewer filters.")
    media = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" if req.format == "xlsx" else "application/pdf"
    return FileResponse(path, media_type=media, filename=fname, background=BackgroundTask(os.remove, path))


# ------------------------------------------------------------------ config (editable JSON)
EDITABLE = {"channel_aliases": "channel_aliases.json", "holidays": "holidays_lk.json", "dayparts": "dayparts.json"}


@app.get("/api/config/{name}")
def get_config(name: str) -> dict:
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


@app.put("/api/config/{name}")
def put_config(name: str, body: dict, request: Request) -> dict:
    """Replace a config file. Changes apply to the next upload and forecast. Set ADMIN_TOKEN to require a token."""
    token = os.environ.get("ADMIN_TOKEN")
    if token and request.headers.get("x-admin-token") != token:
        raise HTTPException(403, "An admin token is required to change settings.")
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


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception) -> JSONResponse:
    log.exception("Unhandled error on %s", request.url.path)
    return JSONResponse({"detail": "Something went wrong on the server. Please try again."}, status_code=500)


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
