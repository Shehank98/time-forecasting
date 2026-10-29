"""Uploads, parsing summaries, dashboards, raw rows and the client overview."""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile
from pydantic import BaseModel, Field

from ..core import (KINDS, MAX_UPLOAD_MB, DashReq, TableReq, base_frame, bounds, build_dashboard, csv_safe, dataset, key_for, workspace)
from ..services import analytics_lmrb, filters as flt, ingest, ingest_kpi, repo
from ..services import forecast as fc
from ..services.store import Dataset, Workspace, content_hash
from ..services.util import jsonable

log = logging.getLogger("app")
router = APIRouter()

TABLE_COLS = {
    "tv": ["date", "day", "channel", "start", "end", "program", "category", "data_set", "daypart", "duration", "tvr", "total_tvr", "tvr_share", "reach", "reach_pct"],
    "lmrb": ["date", "day", "channel", "program", "advt_time", "daypart", "advertiser", "product", "theme", "product_group", "lng", "dur", "dur_band",
             "position", "brkno", "posinbrk", "adsinbrk", "cost", "cps"],
}


def table_cols(kind: str, ds: Dataset) -> list[str]:
    if kind == "kpi":
        return ["date", "segment"] + [m["key"] for m in ds.meta.get("metrics", [])]
    return TABLE_COLS[kind]


def _read_upload(file: UploadFile) -> tuple[str, bytes]:
    name = file.filename or "upload"
    if not name.lower().endswith(ingest.ALLOWED_EXT):
        raise HTTPException(415, "Unsupported file type. Please upload .xlsx, .xls or .csv.")
    limit = MAX_UPLOAD_MB * 1024 * 1024
    content = file.file.read(limit + 1)
    if len(content) > limit:
        raise HTTPException(413, f"File is larger than the {MAX_UPLOAD_MB} MB limit.")
    return name, content


def state_of(ws: Workspace, kind: str, name: str = "") -> dict:
    ds = ws.data.get(key_for(kind, name)) if (kind != "kpi" or name) else None
    st: dict[str, Any] = {"loaded": ds is not None, "has_lmrb": "lmrb" in ws.data, "has_tv": "tv" in ws.data}
    if ds is not None:
        st.update({"report": ds.report, "files": ds.files, "options": flt.filter_options(ds.df, kind), "meta": ds.meta})
    if kind == "kpi":
        st["datasets"] = [d for d in repo.list_datasets(ws.client_id) if d["kind"] == "kpi"]
    if kind == "lmrb" and "tv" in ws.data:
        st["tv_data_sets"] = flt.filter_options(ws.data["tv"].df, "tv").get("data_set_list", [])
    return jsonable(st)


# ------------------------------------------------------------------ TV and LMRB uploads
@router.post("/api/{kind}/upload")
def upload(kind: str, file: UploadFile = File(...), mode: str = Query("replace"), ws: Workspace = Depends(workspace)) -> dict:
    """Upload a TV or LMRB file. mode=append merges and dedupes with the client's stored history."""
    if kind not in ("tv", "lmrb"):
        raise HTTPException(404, "Unknown workspace")
    name, content = _read_upload(file)
    try:
        res = ingest.parse(content, name, kind)
    except ingest.IngestError as exc:
        raise HTTPException(422, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 - never crash on a bad file
        log.exception("Unexpected parse failure for %s", name)
        raise HTTPException(422, f"Could not process this file: {exc}") from exc
    existing = ws.data.get(kind)
    h = content_hash(content)
    added = len(res.df)
    if mode == "append" and existing is not None:
        merged, added, skipped = ingest.merge(existing.df, res.df, kind)
        res.report.update({"appended": True, "rows_added": added, "rows_skipped_as_duplicates": skipped, "rows_total_after_merge": len(merged),
                           "date_min": merged["date"].min().strftime("%Y-%m-%d"), "date_max": merged["date"].max().strftime("%Y-%m-%d"),
                           "n_days": int(merged["date"].nunique())})
        ws.data[kind] = Dataset(merged, res.report, existing.files + [name], existing.hashes + [h])
    else:
        ws.data[kind] = Dataset(res.df, res.report, [name], [h])
    repo.log_upload(ws.client_id, kind, "", name, mode, res.report["rows_kept"], added, ws.user_id)
    return state_of(ws, kind)


@router.get("/api/{kind}/state")
def state(kind: str, dataset_name: str = Query("", alias="dataset"), ws: Workspace = Depends(workspace)) -> dict:
    if kind not in KINDS:
        raise HTTPException(404, "Unknown workspace")
    return state_of(ws, kind, dataset_name)


@router.delete("/api/{kind}")
def clear(kind: str, dataset_name: str = Query("", alias="dataset"), ws: Workspace = Depends(workspace)) -> dict:
    ws.data.pop(key_for(kind, dataset_name))
    fc.cache.clear()
    return {"loaded": False}


# ------------------------------------------------------------------ KPI uploads (two steps)
@router.post("/api/kpi/propose")
def kpi_propose(file: UploadFile = File(...), ws: Workspace = Depends(workspace)) -> dict:
    name, content = _read_upload(file)
    try:
        return jsonable(ingest_kpi.propose(content, name))
    except ingest.IngestError as exc:
        raise HTTPException(422, str(exc)) from exc


class KpiApply(BaseModel):
    token: str
    dataset: str
    mode: str = "replace"
    mapping: dict[str, Any] = Field(default_factory=dict)


@router.post("/api/kpi/apply")
def kpi_apply(req: KpiApply, ws: Workspace = Depends(workspace)) -> dict:
    name = req.dataset.strip()[:120]
    if not name or ":" in name:
        raise HTTPException(422, "Give the dataset a name without a colon, for example 'Leads 2026'.")
    try:
        df, report, meta = ingest_kpi.apply(req.token, req.mapping)
    except ingest.IngestError as exc:
        raise HTTPException(422, str(exc)) from exc
    key = f"kpi:{name}"
    existing = ws.data.get(key)
    added = len(df)
    if req.mode == "append" and existing is not None:
        if set(m["key"] for m in existing.meta.get("metrics", [])) != set(m["key"] for m in meta["metrics"]):
            raise HTTPException(422, "The new file has different metrics from the stored dataset. Map the same columns or upload as a new dataset.")
        merged, added, replaced = ingest_kpi.merge(existing.df, df)
        report.update({"appended": True, "rows_added": added, "rows_skipped_as_duplicates": replaced, "rows_total_after_merge": len(merged),
                       "date_min": merged["date"].min().strftime("%Y-%m-%d"), "date_max": merged["date"].max().strftime("%Y-%m-%d"), "n_days": int(merged["date"].nunique())})
        meta["ratios"] = existing.meta.get("ratios", meta["ratios"])
        ws.data[key] = Dataset(merged, report, existing.files + [report["file_name"]], existing.hashes + [req.token], meta)
    else:
        ws.data[key] = Dataset(df, report, [report["file_name"]], [req.token], meta)
    repo.log_upload(ws.client_id, "kpi", name, report["file_name"], req.mode, report["rows_kept"], added, ws.user_id)
    return state_of(ws, "kpi", name)


class KpiMeta(BaseModel):
    dataset: str
    metrics: list[dict[str, Any]] | None = None
    ratios: list[dict[str, Any]] | None = None


@router.put("/api/kpi/meta")
def kpi_meta(req: KpiMeta, ws: Workspace = Depends(workspace)) -> dict:
    """Edit labels, units, aggregation and cost-per-result ratios without re-uploading."""
    ds = dataset(ws, "kpi", req.dataset)
    meta = dict(ds.meta)
    keys = {m["key"] for m in meta.get("metrics", [])}
    if req.metrics is not None:
        by = {m.get("key"): m for m in req.metrics}
        for m in meta["metrics"]:
            u = by.get(m["key"], {})
            if u.get("label"):
                m["label"] = str(u["label"])[:80]
            if u.get("unit") in ("number", "currency", "percent", "rating"):
                m["unit"] = u["unit"]
            if u.get("agg") in ("sum", "mean"):
                m["agg"] = u["agg"]
            if u.get("role") in ("kpi", "driver"):
                m["role"] = u["role"]
    if req.ratios is not None:
        ratios = []
        for r in req.ratios:
            if r.get("num") in keys and r.get("den") in keys and r.get("num") != r.get("den"):
                ratios.append({"key": ingest_kpi.slug(r.get("key") or r.get("label") or "ratio"), "label": str(r.get("label") or "Ratio")[:80],
                               "num": r["num"], "den": r["den"], "scale": float(r.get("scale") or 1), "unit": r.get("unit", "currency")})
        meta["ratios"] = ratios
    ws.data[f"kpi:{req.dataset}"] = Dataset(ds.df, ds.report, ds.files, ds.hashes, meta)
    fc.cache.clear()
    return state_of(ws, "kpi", req.dataset)


# ------------------------------------------------------------------ dashboards
@router.post("/api/{kind}/dashboard")
def dashboard(kind: str, req: DashReq, ws: Workspace = Depends(workspace)) -> dict:
    out = build_dashboard(ws, kind, req.filters, req.options, req.dataset)
    if kind == "lmrb" and "tv" in ws.data:
        out["meta"]["grp_stats"] = base_frame(ws, "lmrb", "", req.options).attrs.get("grp_stats")
    return jsonable(out)


@router.post("/api/lmrb/head2head")
def head2head(req: DashReq, ws: Workspace = Depends(workspace)) -> dict:
    a, b = req.options.get("a"), req.options.get("b")
    if not a or not b or a == b:
        raise HTTPException(422, "Pick two different advertisers.")
    nodate = flt.apply_filters(base_frame(ws, "lmrb", "", req.options), "lmrb", req.filters, skip_date=True)
    start, end = bounds(req.filters)
    return analytics_lmrb.head_to_head(nodate, start, end, a, b)


@router.post("/api/{kind}/rows")
def rows(kind: str, req: TableReq, ws: Workspace = Depends(workspace)) -> dict:
    """Paginated raw rows of the filtered data (the only place raw rows reach the browser)."""
    ds = dataset(ws, kind, req.dataset)
    cols = table_cols(kind, ds)
    df = flt.apply_filters(ds.df, kind, req.filters)[cols]
    q = req.search.strip().lower()
    if q:
        hay = df.astype(str).agg(" ".join, axis=1).str.lower()
        df = df[hay.str.contains(q, regex=False)]
    if req.sort in df.columns:
        df = df.sort_values(req.sort, ascending=not req.desc, kind="stable")
    size = max(1, min(req.page_size, 200))
    page = max(1, req.page)
    chunk = df.iloc[(page - 1) * size: page * size]
    return jsonable({"columns": cols, "rows": chunk.values.tolist(), "total": int(len(df)), "page": page, "page_size": size})


@router.post("/api/{kind}/rows/csv")
def rows_csv(kind: str, req: DashReq, ws: Workspace = Depends(workspace)) -> Response:
    """Download the filtered rows as CSV (capped to keep memory bounded)."""
    ds = dataset(ws, kind, req.dataset)
    df = flt.apply_filters(ds.df, kind, req.filters)[table_cols(kind, ds)].head(250_000)
    return Response(csv_safe(df).to_csv(index=False), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{kind}_filtered_rows.csv"'})


# ------------------------------------------------------------------ client overview
@router.get("/api/workspace/summary")
def summary(ws: Workspace = Depends(workspace)) -> dict:
    return jsonable({"client": repo.get_client(ws.client_id), "datasets": repo.list_datasets(ws.client_id), "uploads": repo.upload_history(ws.client_id),
                     "forecasts": repo.list_forecasts(ws.client_id), "reports": repo.list_reports(ws.client_id)})
