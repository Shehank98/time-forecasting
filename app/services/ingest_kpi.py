"""Client KPI ingestion: any dated sheet (spend, leads, sales, traffic, search volume, GRPs).

Step 1 (propose): read the file, find the header row, detect the date column, segment
columns and numeric metrics, and suggest units, roles and cost-per-result ratios
(CPL, CPA, CPC, CPM, CPRP) from the column names.
Step 2 (apply): with the planner's confirmed mapping, build a tidy frame
(date, segment, one column per metric) plus a parsing report.
"""
from __future__ import annotations

import logging
import re
import threading
import time
import uuid
from typing import Any

import numpy as np
import pandas as pd

from .ingest import IngestError, read_table, to_date, to_num

log = logging.getLogger(__name__)

_pending: dict[str, dict] = {}
_plock = threading.Lock()
PENDING_TTL = 1800

CURRENCY = re.compile(r"spend|cost|budget|invest|revenue|sales.?value|amount|lkr|rs\b|\bprice|cpc|cpm|cpl|cpa", re.I)
DRIVER = re.compile(r"spend|cost|budget|invest|price|discount|promo", re.I)
RATE = re.compile(r"ctr|cvr|rate|%|pct|percent|share|tvr|rating|avg|average|position|frequency", re.I)
RATIO_TARGETS = [
    (re.compile(r"lead", re.I), "cpl", "Cost per lead (CPL)", 1.0),
    (re.compile(r"conversion|acquisition|signup|sign.?up|registration|install|order|purchase|sale(?!s.?value)|customer|account", re.I), "cpa", "Cost per acquisition (CPA)", 1.0),
    (re.compile(r"click", re.I), "cpc", "Cost per click (CPC)", 1.0),
    (re.compile(r"impression|views?\b", re.I), "cpm", "Cost per thousand impressions (CPM)", 1000.0),
    (re.compile(r"\bgrps?\b|\btrps?\b|rating.?points", re.I), "cprp", "Cost per rating point (CPRP)", 1.0),
    (re.compile(r"visit|session|traffic", re.I), "cpv", "Cost per visit", 1.0),
]


def slug(s: Any) -> str:
    k = re.sub(r"[^a-z0-9]+", "_", str(s).strip().lower()).strip("_")
    return (k or "col")[:40]


def _header_row(raw: pd.DataFrame) -> int:
    best, score = 0, -1
    for i in range(min(15, len(raw))):
        vals = [v for v in raw.iloc[i].tolist() if v is not None and str(v).strip() not in ("", "nan", "None")]
        texty = sum(1 for v in vals if isinstance(v, str) and not re.fullmatch(r"[\d.,/\-: ]+", v.strip()))
        if texty >= 2 and texty > score:
            best, score = i, texty
            if texty >= max(2, len(vals) * 0.8):
                break
    return best


def propose(content: bytes, filename: str) -> dict:
    """Read the sheet and suggest a mapping. The parsed table waits in memory for step 2."""
    raw = read_table(content, filename)
    raw = raw.dropna(how="all").dropna(axis=1, how="all").reset_index(drop=True)
    if raw.empty:
        raise IngestError("The sheet is empty.")
    h = _header_row(raw)
    headers, used = [], set()
    for i, v in enumerate(raw.iloc[h].tolist()):
        name = str(v).strip() if v is not None and str(v).strip() not in ("", "nan", "None") else f"Column {i + 1}"
        base, n = name, 2
        while name in used:
            name = f"{base} ({n})"; n += 1
        used.add(name); headers.append(name)
    body = raw.iloc[h + 1:].reset_index(drop=True)
    body.columns = headers
    body = body.dropna(how="all")
    if body.empty:
        raise IngestError("No data rows were found under the header row.")
    cols = []
    for c in headers:
        s = body[c]
        nonnull = s.notna() & (s.astype(str).str.strip() != "")
        n = int(nonnull.sum()) or 1
        dates = to_date(s[nonnull]) if n else pd.Series(dtype="datetime64[ns]")
        date_share = float(dates.notna().sum() / n)
        nums, _ = to_num(s[nonnull])
        num_share = float(nums.notna().sum() / n)
        uniq = int(s[nonnull].astype(str).nunique())
        # numbers like 2026 or 45000 can look like dates; prefer numeric unless clearly date formatted
        looks_date = date_share >= 0.8 and (num_share < 0.5 or bool(s[nonnull].astype(str).str.contains(r"[/\-]|[A-Za-z]{3}").mean() > 0.5) or pd.api.types.is_datetime64_any_dtype(s))
        typ = "date" if looks_date else ("number" if num_share >= 0.8 else "text")
        cols.append({"name": c, "type": typ, "unique": uniq, "samples": [str(x) for x in s[nonnull].head(3).tolist()]})
    date_cols = [c["name"] for c in cols if c["type"] == "date"]
    if not date_cols:
        raise IngestError("No date column was found. The sheet needs one column of dates (for example 2026-09-01 or 01/09/2026).")
    seg_cols = [c["name"] for c in cols if c["type"] == "text" and 1 < c["unique"] <= 300]
    metrics = []
    for c in cols:
        if c["type"] != "number":
            continue
        name = c["name"]
        unit = "percent" if re.search(r"%|pct|percent|rate|ctr|cvr|share", name, re.I) else ("rating" if re.search(r"tvr|rating|grp|trp", name, re.I) and not re.search(r"cost", name, re.I)
                                                                                                 else ("currency" if CURRENCY.search(name) else "number"))
        agg = "mean" if (RATE.search(name) and not re.search(r"grp|trp", name, re.I)) or unit == "percent" else "sum"
        role = "driver" if DRIVER.search(name) and agg == "sum" else "kpi"
        metrics.append({"column": name, "key": slug(name), "label": name, "unit": unit, "agg": agg, "role": role, "include": True})
    if not metrics:
        raise IngestError("No numeric columns were found to forecast.")
    ratios = suggest_ratios(metrics)
    token = uuid.uuid4().hex
    with _plock:
        now = time.time()
        for k in [k for k, v in _pending.items() if now - v["t"] > PENDING_TTL]:
            del _pending[k]
        _pending[token] = {"t": now, "body": body, "file_name": filename, "rows_read": int(len(body))}
    return {"token": token, "file_name": filename, "rows": int(len(body)), "header_row": h + 1, "columns": cols,
            "suggested": {"date_column": date_cols[0], "segment_column": seg_cols[0] if len(seg_cols) == 1 else None, "segment_options": seg_cols,
                          "metrics": metrics, "ratios": ratios}}


def suggest_ratios(metrics: list[dict]) -> list[dict]:
    spend = [m for m in metrics if m["role"] == "driver" and m["unit"] == "currency" and re.search(r"spend|cost|budget|invest", m["label"], re.I)]
    if not spend:
        return []
    s = spend[0]
    out, seen = [], set()
    for m in metrics:
        if m["key"] == s["key"] or m["agg"] != "sum" or m["unit"] == "currency":
            continue
        for rx, key, label, scale in RATIO_TARGETS:
            if rx.search(m["label"]) and key not in seen:
                seen.add(key)
                out.append({"key": key, "label": label, "num": s["key"], "den": m["key"], "scale": scale, "unit": "currency"})
                break
    return out


def apply(token: str, mapping: dict) -> tuple[pd.DataFrame, dict, dict]:
    """Build the tidy frame from the waiting table and the confirmed mapping. Returns (df, report, meta)."""
    with _plock:
        pend = _pending.get(token)
    if pend is None:
        raise IngestError("This upload has expired. Please upload the file again.")
    body: pd.DataFrame = pend["body"]
    dcol, scol = mapping.get("date_column"), mapping.get("segment_column") or None
    if dcol not in body.columns:
        raise IngestError("Choose the date column.")
    if scol and scol not in body.columns:
        raise IngestError("The segment column was not found.")
    metrics = [m for m in mapping.get("metrics", []) if m.get("include", True) and m.get("column") in body.columns]
    if not metrics:
        raise IngestError("Pick at least one metric to keep.")
    keys = set()
    for m in metrics:
        m["key"] = slug(m.get("key") or m["column"])
        if m["key"] in keys or m["key"] in ("date", "segment", "week_start", "month"):
            m["key"] = m["key"] + "_2"
        keys.add(m["key"])
        if m.get("agg") not in ("sum", "mean"):
            m["agg"] = "sum"
        if m.get("unit") not in ("number", "currency", "percent", "rating"):
            m["unit"] = "number"
        m["label"] = str(m.get("label") or m["column"])[:80]
    df = pd.DataFrame({"date": to_date(body[dcol])})
    df["segment"] = body[scol].astype(str).str.strip().replace({"nan": "Unknown", "": "Unknown", "None": "Unknown"}) if scol else "All"
    unparsed: dict[str, int] = {}
    for m in metrics:
        vals, bad = to_num(body[m["column"]])
        df[m["key"]] = vals.to_numpy()
        if bad:
            unparsed[m["label"]] = bad
    bad_date = df["date"].isna()
    all_blank = df[[m["key"] for m in metrics]].isna().all(axis=1)
    dropped = {"bad_date": int(bad_date.sum()), "no_values": int((all_blank & ~bad_date).sum())}
    df = df[~bad_date & ~all_blank].reset_index(drop=True)
    before = len(df)
    df = df.drop_duplicates().reset_index(drop=True)
    dropped["duplicates"] = before - len(df)
    if df.empty:
        raise IngestError("No usable rows after cleaning. Check the date column and metric columns.")
    df["week_start"] = df["date"] - pd.to_timedelta(df["date"].dt.dayofweek, unit="D")
    df["month"] = df["date"].dt.strftime("%Y-%m")
    gran = detect_granularity(df["date"])
    ratios = [r for r in mapping.get("ratios", []) if r.get("num") in keys and r.get("den") in keys]
    for r in ratios:
        r["key"] = slug(r.get("key") or f"{r['num']}_per_{r['den']}")
        r["label"] = str(r.get("label") or r["key"])[:80]
        r["scale"] = float(r.get("scale") or 1.0)
    meta = {"metrics": [{k: m[k] for k in ("key", "label", "unit", "agg", "role", "column")} for m in metrics], "ratios": ratios,
            "date_column": dcol, "segment_column": scol, "granularity": gran}
    n_days = int(df["date"].nunique())
    warnings = []
    min_pts = {"daily": 14, "weekly": 8, "monthly": 12}[gran]
    if n_days < min_pts:
        warnings.append(f"Only {n_days} distinct {gran} periods. Forecasts will be marked Low reliability (minimum {min_pts}).")
    report = {"kind": "kpi", "file_name": pend["file_name"], "rows_read": pend["rows_read"], "rows_kept": int(len(df)), "dropped": dropped,
              "rows_dropped_total": int(sum(dropped.values())), "missing_columns": [], "unparseable_values": unparsed, "unmatched_channels": [],
              "date_min": df["date"].min().strftime("%Y-%m-%d"), "date_max": df["date"].max().strftime("%Y-%m-%d"), "n_days": n_days,
              "granularity": gran, "segments": int(df["segment"].nunique()), "warnings": warnings}
    with _plock:
        _pending.pop(token, None)
    return df, report, meta


def detect_granularity(dates: pd.Series) -> str:
    u = pd.Series(sorted(dates.dropna().unique()))
    if len(u) < 3:
        return "daily"
    gap = float(u.diff().dt.days.median())
    return "daily" if gap <= 2 else ("weekly" if gap <= 10 else "monthly")


def merge(existing: pd.DataFrame | None, new: pd.DataFrame) -> tuple[pd.DataFrame, int, int]:
    """Append rows. Rows for the same date and segment are replaced by the newer file (restated numbers)."""
    if existing is None or existing.empty:
        return new, len(new), 0
    keep_old = existing[~existing.set_index(["date", "segment"]).index.isin(new.set_index(["date", "segment"]).index)]
    merged = pd.concat([keep_old, new], ignore_index=True).sort_values(["date", "segment"]).reset_index(drop=True)
    return merged, len(merged) - len(existing), len(existing) - len(keep_old)
