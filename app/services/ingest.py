"""File ingestion: read xlsx/xls/csv, validate columns, parse and derive fields.

Everything here is tolerant. Anything that cannot be parsed is counted and
reported in the parsing summary instead of raising.
"""
from __future__ import annotations

import datetime as dt
import io
import logging
import re
import warnings
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd

from . import normalise as nz

log = logging.getLogger(__name__)

ALLOWED_EXT = (".xlsx", ".xls", ".csv")

TV_HEADERS = {
    "rank": "rank", "dataset": "data_set", "channel": "channel", "date": "date",
    "day": "day", "start": "start", "end": "end", "program": "program",
    "programme": "program", "duration": "duration", "category": "category",
    "tvr": "tvr", "totaltvr": "total_tvr", "tvrsharepct": "tvr_share",
    "tvrshare": "tvr_share", "reach": "reach", "reachpct": "reach_pct",
    "avgtime": "avg_time",
}
TV_EXPECTED = ["rank", "data_set", "channel", "date", "day", "start", "end", "program",
               "duration", "category", "tvr", "total_tvr", "tvr_share", "reach",
               "reach_pct", "avg_time"]
TV_REQUIRED = ["channel", "date", "program", "tvr"]
TV_NUMERIC = ["rank", "duration", "tvr", "total_tvr", "tvr_share", "reach", "reach_pct", "avg_time"]
TV_KEY = ["data_set", "channel", "date", "start", "program"]

LMRB_HEADERS = {
    "productgroup": "product_group", "advertiser": "advertiser", "product": "product",
    "advttheme": "theme", "ads": "ads", "channel": "channel", "program": "program",
    "programme": "program", "dd": "dd", "mn": "mn", "yr": "yr", "day": "day",
    "progtime": "prog_time", "advttime": "advt_time", "adpos": "adpos",
    "totads": "totads", "brkno": "brkno", "posinbrk": "posinbrk",
    "adsinbrk": "adsinbrk", "lng": "lng", "dur": "dur", "cost": "cost",
}
LMRB_EXPECTED = ["product_group", "advertiser", "product", "theme", "ads", "channel",
                 "program", "dd", "mn", "yr", "day", "prog_time", "advt_time", "adpos",
                 "totads", "brkno", "posinbrk", "adsinbrk", "lng", "dur", "cost"]
LMRB_REQUIRED = ["advertiser", "channel", "cost", "dd", "mn", "yr"]
LMRB_NUMERIC = ["ads", "dd", "yr", "adpos", "totads", "brkno", "posinbrk", "adsinbrk", "dur", "cost"]
LMRB_KEY = ["advertiser", "product", "theme", "channel", "date", "advt_time", "brkno",
            "posinbrk", "adpos", "cost"]

KINDS = {
    "tv": dict(headers=TV_HEADERS, expected=TV_EXPECTED, required=TV_REQUIRED, numeric=TV_NUMERIC),
    "lmrb": dict(headers=LMRB_HEADERS, expected=LMRB_EXPECTED, required=LMRB_REQUIRED, numeric=LMRB_NUMERIC),
}

MONTHS = {m.lower(): i for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)}


class IngestError(ValueError):
    """Raised for problems the user must fix (wrong file type, missing columns)."""


@dataclass
class ParseResult:
    df: pd.DataFrame
    report: dict[str, Any] = field(default_factory=dict)


def header_key(h: Any) -> str:
    """Normalise a header: lowercase, '%' -> 'pct', alphanumerics only."""
    s = str(h).strip().lower().replace("%", "pct")
    return re.sub(r"[^a-z0-9]", "", s)


# ---------------------------------------------------------------- reading
def read_table(content: bytes, filename: str) -> pd.DataFrame:
    """Read the raw sheet as an object frame with no header applied."""
    name = filename.lower()
    if not name.endswith(ALLOWED_EXT):
        raise IngestError("Unsupported file type. Please upload .xlsx, .xls or .csv.")
    if not content:
        raise IngestError("The file is empty.")
    try:
        if name.endswith(".csv"):
            for enc in ("utf-8-sig", "cp1252", "latin-1"):
                try:
                    text = content.decode(enc)
                    break
                except UnicodeDecodeError:
                    continue
            sample = text[:4096]
            sep = "\t" if sample.count("\t") > sample.count(",") else ","
            return pd.read_csv(io.StringIO(text), sep=sep, header=None, dtype=str,
                               skip_blank_lines=False, on_bad_lines="skip", engine="python")
        engine = "openpyxl" if name.endswith(".xlsx") else "xlrd"
        return pd.read_excel(io.BytesIO(content), header=None, engine=engine, dtype=object)
    except IngestError:
        raise
    except Exception as exc:  # noqa: BLE001 - any reader failure becomes a friendly error
        log.warning("Could not read %s: %s", filename, exc)
        raise IngestError(f"Could not read the file: {exc}") from exc


def locate_header(raw: pd.DataFrame, headers: dict[str, str]) -> int:
    """Find the header row among the first 15 rows (tolerates title rows)."""
    best, best_hits = 0, -1
    for i in range(min(15, len(raw))):
        hits = sum(1 for v in raw.iloc[i].tolist() if header_key(v) in headers)
        if hits > best_hits:
            best, best_hits = i, hits
    if best_hits < 3:
        raise IngestError("Could not find a header row. Check that column names match the expected template.")
    return best


# ---------------------------------------------------------------- parsers
def to_num(series: pd.Series) -> tuple[pd.Series, int]:
    """Parse numbers tolerant of commas, %, currency text. Returns (series, bad count)."""
    if pd.api.types.is_numeric_dtype(series):
        return series.astype(float), 0
    s = series.astype(object)
    cleaned = (s.astype(str).str.replace(",", "", regex=False)
               .str.replace("%", "", regex=False)
               .str.replace(r"(?i)\b(lkr|rs\.?)\b", "", regex=True)
               .str.strip().replace({"": np.nan, "-": np.nan, "nan": np.nan, "None": np.nan, "NaT": np.nan}))
    out = pd.to_numeric(cleaned, errors="coerce")
    bad = int((out.isna() & series.notna() & (series.astype(str).str.strip() != "")).sum())
    return out.astype(float), bad


def _one_time(v: Any) -> float:
    if v is None or (isinstance(v, float) and np.isnan(v)):
        return np.nan
    if isinstance(v, pd.Timestamp):
        v = v.to_pydatetime()
    if isinstance(v, dt.datetime):
        return v.hour * 3600 + v.minute * 60 + v.second
    if isinstance(v, dt.time):
        return v.hour * 3600 + v.minute * 60 + v.second
    if isinstance(v, (int, float, np.number)):
        f = float(v)
        if 0 <= f < 1:  # excel time fraction
            return round(f * 86400)
        return np.nan
    s = str(v).strip()
    m = re.match(r"^(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*([AaPp][Mm])?$", s)
    if not m:
        return np.nan
    h, mi, sec, ap = int(m.group(1)), int(m.group(2)), int(m.group(3) or 0), m.group(4)
    if ap:
        ap = ap.lower()
        h = h % 12 + (12 if ap == "pm" else 0)
    if h > 24 or mi > 59 or sec > 59:
        return np.nan
    return float(h * 3600 + mi * 60 + sec)


def to_seconds(series: pd.Series) -> pd.Series:
    """Parse clock times (text, time objects, excel fractions) to seconds since midnight."""
    uniques = series.dropna().unique()
    cache = {u: _one_time(u) for u in uniques}
    return series.map(cache).astype(float)


_DATE_FORMATS = ("%Y/%m/%d", "%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%Y.%m.%d", "%m/%d/%Y", "%d %b %Y", "%d-%b-%Y")


def _plausible(parsed: pd.Series) -> pd.Series:
    """Keep dates between 1900 and 2100 in nanosecond precision; numbers like 100 are not dates."""
    try:
        yrs = parsed.dt.year
    except (AttributeError, TypeError):
        return pd.Series(pd.NaT, index=parsed.index, dtype="datetime64[ns]")
    ok = (yrs >= 1900) & (yrs <= 2100)
    return pd.to_datetime(parsed.where(ok).astype("object"), errors="coerce").astype("datetime64[ns]")


def to_date(series: pd.Series) -> pd.Series:
    """Parse mixed-format dates (text like 2026/09/21, ISO, excel datetimes)."""
    if pd.api.types.is_datetime64_any_dtype(series):
        return series.dt.normalize()
    out = pd.Series(pd.NaT, index=series.index, dtype="datetime64[ns]")
    native = series.map(lambda v: v if isinstance(v, (dt.datetime, dt.date, pd.Timestamp)) and 1900 <= v.year <= 2100 else None)
    out = out.fillna(pd.to_datetime(native, errors="coerce"))
    txt = series.where(series.map(lambda v: isinstance(v, str)), other=None).dropna().astype(str).str.strip()
    for fmt in _DATE_FORMATS:
        pending = txt[out.reindex(txt.index).isna()]
        if pending.empty:
            break
        parsed = _plausible(pd.to_datetime(pending, format=fmt, errors="coerce"))
        out.loc[parsed.index] = out.loc[parsed.index].fillna(parsed)
    pending = txt[out.reindex(txt.index).isna()]
    if not pending.empty:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            try:
                parsed = _plausible(pd.to_datetime(pending, errors="coerce", dayfirst=True, format="mixed"))
            except (ValueError, TypeError, OverflowError):
                parsed = pd.Series(pd.NaT, index=pending.index, dtype="datetime64[ns]")
        out.loc[parsed.index] = out.loc[parsed.index].fillna(parsed)
    return out.dt.normalize()


def _month_num(series: pd.Series) -> pd.Series:
    num, _ = to_num(series)
    names = series.astype(str).str.strip().str.lower().str[:3].map(MONTHS)
    return num.fillna(names)


# ---------------------------------------------------------------- core
def _map_columns(raw: pd.DataFrame, kind: str) -> tuple[pd.DataFrame, int, list[str]]:
    cfg = KINDS[kind]
    hdr_row = locate_header(raw, cfg["headers"])
    headers = raw.iloc[hdr_row].tolist()
    body = raw.iloc[hdr_row + 1:].reset_index(drop=True)
    cols, seen = [], set()
    for h in headers:
        key = cfg["headers"].get(header_key(h))
        if key and key not in seen:
            cols.append(key)
            seen.add(key)
        else:
            cols.append(f"_drop_{len(cols)}")
    body.columns = cols
    body = body[[c for c in cols if not c.startswith("_drop_")]]
    missing = [c for c in cfg["expected"] if c not in body.columns]
    return body, hdr_row, missing


def parse(content: bytes, filename: str, kind: str) -> ParseResult:
    """Parse an uploaded file into a clean, derived DataFrame plus a report."""
    if kind not in KINDS:
        raise IngestError(f"Unknown dataset type: {kind}")
    raw = read_table(content, filename)
    body, hdr_row, missing = _map_columns(raw, kind)
    cfg = KINDS[kind]
    req_missing = [c for c in cfg["required"] if c not in body.columns]
    if req_missing:
        raise IngestError("Missing required columns: " + ", ".join(req_missing)
                          + ". Found: " + ", ".join(body.columns))
    rows_read = len(body)
    body = body.copy()
    blank = body.isna().all(axis=1) | (body.astype(str).apply(lambda c: c.str.strip()).replace({"nan": "", "None": ""}) == "").all(axis=1)
    n_blank = int(blank.sum())
    body = body[~blank].reset_index(drop=True)
    unparseable: dict[str, int] = {}
    for c in cfg["numeric"]:
        if c in body.columns:
            body[c], bad = to_num(body[c])
            if bad:
                unparseable[c] = bad
    df, dropped, extra = (_derive_tv if kind == "tv" else _derive_lmrb)(body)
    dropped["blank_rows"] = n_blank
    before = len(df)
    key = [k for k in (TV_KEY if kind == "tv" else LMRB_KEY) if k in df.columns]
    df = df.drop_duplicates(subset=key, keep="first").reset_index(drop=True)
    dropped["duplicates"] = before - len(df)
    report = build_report(kind, filename, df, rows_read, dropped, missing, unparseable, extra)
    report["header_row"] = int(hdr_row) + 1
    return ParseResult(df, report)


def build_report(kind: str, filename: str, df: pd.DataFrame, rows_read: int, dropped: dict,
                 missing: list[str], unparseable: dict, extra: dict) -> dict:
    warnings = list(extra.get("warnings", []))
    dmin = df["date"].min() if len(df) else None
    dmax = df["date"].max() if len(df) else None
    n_days = int(df["date"].nunique()) if len(df) else 0
    thin = nz.min_points()["daily"]
    if len(df) == 0:
        warnings.append("No valid rows were found after cleaning.")
    elif n_days < thin:
        warnings.append(f"Only {n_days} distinct days of history. Forecasts will be marked Low reliability (minimum is {thin}).")
    if missing:
        warnings.append("Optional columns not found: " + ", ".join(missing))
    return {
        "kind": kind, "file_name": filename, "rows_read": int(rows_read), "rows_kept": int(len(df)),
        "dropped": {k: int(v) for k, v in dropped.items()},
        "rows_dropped_total": int(sum(dropped.values())),
        "missing_columns": missing, "unparseable_values": unparseable,
        "unmatched_channels": extra.get("unmatched_channels", []),
        "date_min": dmin.strftime("%Y-%m-%d") if dmin is not None and pd.notna(dmin) else None,
        "date_max": dmax.strftime("%Y-%m-%d") if dmax is not None and pd.notna(dmax) else None,
        "n_days": n_days, "warnings": warnings,
    }


def _common_time_fields(df: pd.DataFrame, secs: pd.Series) -> pd.DataFrame:
    df["start_sec"] = secs
    df["daypart"] = nz.daypart_series(secs)
    df["daypart"] = df["daypart"].fillna("Unknown")
    return df


def _calendar_fields(df: pd.DataFrame) -> pd.DataFrame:
    df["week_start"] = df["date"] - pd.to_timedelta(df["date"].dt.dayofweek, unit="D")
    df["month"] = df["date"].dt.strftime("%Y-%m")
    df["dow"] = df["date"].dt.dayofweek
    df["day"] = df["date"].dt.strftime("%a")
    return df


def _text(df: pd.DataFrame, col: str, default: str) -> pd.Series:
    if col not in df.columns:
        return pd.Series(default, index=df.index)
    return df[col].astype(str).str.strip().replace({"nan": default, "None": default, "": default}).fillna(default)


def _derive_tv(df: pd.DataFrame) -> tuple[pd.DataFrame, dict, dict]:
    dropped = {"bad_date": 0, "missing_required": 0}
    df = df.copy()
    df["date"] = to_date(df["date"])
    bad_date = df["date"].isna()
    miss = df["channel"].isna() | df["tvr"].isna() | df["program"].isna()
    dropped["bad_date"] = int(bad_date.sum())
    dropped["missing_required"] = int((miss & ~bad_date).sum())
    df = df[~(bad_date | miss)].reset_index(drop=True)
    df["channel"], unmatched = nz.normalise_channel_series(df["channel"])
    df["program"] = df["program"].astype(str).str.strip().str.upper()
    df["data_set"] = _text(df, "data_set", "All")
    df["category"] = _text(df, "category", "UNKNOWN").str.upper()
    for c in ("rank", "duration", "total_tvr", "tvr_share", "reach", "reach_pct", "avg_time"):
        if c not in df.columns:
            df[c] = np.nan
    start = to_seconds(df["start"]) if "start" in df.columns else pd.Series(np.nan, index=df.index)
    end = to_seconds(df["end"]) if "end" in df.columns else pd.Series(np.nan, index=df.index)
    df["start"] = start.map(_fmt_hm)
    df["end"] = end.map(_fmt_hm)
    df = _common_time_fields(df, start)
    df = _calendar_fields(df)
    dur = df["duration"].copy()
    fallback = ((end - start) % 86400) / 60.0
    df["duration"] = dur.fillna(fallback)
    df["program_key"] = df["program"] + " | " + df["channel"] + " | " + df["day"] + " | " + df["start"].fillna("")
    keep = ["rank", "data_set", "channel", "date", "day", "dow", "start", "end", "start_sec", "program",
            "duration", "category", "tvr", "total_tvr", "tvr_share", "reach", "reach_pct", "avg_time",
            "daypart", "week_start", "month", "program_key"]
    return df[keep], dropped, {"unmatched_channels": unmatched}


def _fmt_hm(v: float) -> str | None:
    if v is None or pd.isna(v):
        return None
    v = int(v)
    return f"{v // 3600 % 24:02d}:{v % 3600 // 60:02d}"


def _derive_lmrb(df: pd.DataFrame) -> tuple[pd.DataFrame, dict, dict]:
    dropped = {"bad_date": 0, "missing_required": 0}
    df = df.copy()
    month = _month_num(df["mn"])
    df["date"] = pd.to_datetime({"year": df["yr"], "month": month, "day": df["dd"]}, errors="coerce")
    bad_date = df["date"].isna()
    miss = df["advertiser"].isna() | df["channel"].isna() | df["cost"].isna()
    dropped["bad_date"] = int(bad_date.sum())
    dropped["missing_required"] = int((miss & ~bad_date).sum())
    df = df[~(bad_date | miss)].reset_index(drop=True)
    df["channel"], unmatched = nz.normalise_channel_series(df["channel"])
    df["advertiser"] = _text(df, "advertiser", "Unknown")
    df["product_group"] = _text(df, "product_group", "Unknown")
    df["product"] = _text(df, "product", "Unknown")
    df["theme"] = _text(df, "theme", "Unknown")
    df["program"] = _text(df, "program", "Unknown").str.upper()
    df["lng"] = _text(df, "lng", "Unknown").str.title()
    for c in ("ads", "adpos", "totads", "brkno", "posinbrk", "adsinbrk", "dur"):
        if c not in df.columns:
            df[c] = np.nan
    advt = to_seconds(df["advt_time"]) if "advt_time" in df.columns else pd.Series(np.nan, index=df.index)
    prog = to_seconds(df["prog_time"]) if "prog_time" in df.columns else pd.Series(np.nan, index=df.index)
    secs = advt.fillna(prog)
    df["advt_time"] = advt.map(_fmt_hms)
    df["prog_time"] = prog.map(_fmt_hm)
    df = _common_time_fields(df, secs)
    df = _calendar_fields(df)
    df["ads"] = df["ads"].fillna(1)
    df["cps"] = np.where(df["dur"] > 0, df["cost"] / df["dur"], np.nan)
    df["is_first"] = df["posinbrk"] == 1
    df["is_last"] = (df["posinbrk"] == df["adsinbrk"]) & df["posinbrk"].notna() & (df["adsinbrk"] > 1)
    df["position"] = np.select([df["is_first"], df["is_last"]], ["first", "last"], default="middle")
    df.loc[df["posinbrk"].isna(), "position"] = "unknown"
    df["is_prime"] = df["daypart"].isin(nz.prime_dayparts())
    df["dur_band"] = nz.duration_band(df["dur"]).fillna("Unknown")
    df["creative_id"] = df["advertiser"] + " | " + df["product"] + " | " + df["theme"]
    keep = ["product_group", "advertiser", "product", "theme", "ads", "channel", "program", "date", "day", "dow",
            "prog_time", "advt_time", "start_sec", "adpos", "totads", "brkno", "posinbrk", "adsinbrk", "lng", "dur",
            "cost", "daypart", "week_start", "month", "cps", "is_first", "is_last", "position", "is_prime",
            "dur_band", "creative_id"]
    return df[keep], dropped, {"unmatched_channels": unmatched}


def _fmt_hms(v: float) -> str | None:
    if v is None or pd.isna(v):
        return None
    v = int(v)
    return f"{v // 3600 % 24:02d}:{v % 3600 // 60:02d}:{v % 60:02d}"


def merge(existing: pd.DataFrame | None, new: pd.DataFrame, kind: str) -> tuple[pd.DataFrame, int, int]:
    """Append new rows to existing data and dedupe. Returns (df, added, skipped)."""
    if existing is None or existing.empty:
        return new, len(new), 0
    key = [k for k in (TV_KEY if kind == "tv" else LMRB_KEY) if k in new.columns]
    combined = pd.concat([existing, new], ignore_index=True)
    merged = combined.drop_duplicates(subset=key, keep="first").reset_index(drop=True)
    added = len(merged) - len(existing)
    return merged, added, len(new) - added
