"""Small helpers shared across services."""
from __future__ import annotations

import datetime as dt
import math
from typing import Any

import numpy as np
import pandas as pd


def jsonable(obj: Any) -> Any:
    """Recursively convert numpy/pandas values to JSON safe Python (NaN -> None)."""
    if obj is None:
        return None
    if isinstance(obj, (pd.Timestamp, dt.datetime)):
        return None if pd.isna(obj) else obj.strftime("%Y-%m-%d")
    if isinstance(obj, dt.date):
        return obj.strftime("%Y-%m-%d")
    if isinstance(obj, (np.bool_, bool)):
        return bool(obj)
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (float, np.floating)):
        f = float(obj)
        return None if (math.isnan(f) or math.isinf(f)) else round(f, 6)
    if isinstance(obj, dict):
        return {str(k): jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set)):
        return [jsonable(v) for v in obj]
    if isinstance(obj, np.ndarray):
        return [jsonable(v) for v in obj.tolist()]
    if isinstance(obj, pd.Series):
        return [jsonable(v) for v in obj.tolist()]
    if obj is pd.NaT:
        return None
    return obj


def pct_change(cur: float, prev: float) -> float | None:
    """Percent change, None when the previous value is zero or missing."""
    if prev is None or cur is None or prev == 0 or pd.isna(prev) or pd.isna(cur):
        return None
    return (cur - prev) / abs(prev) * 100.0


def safe_div(a: float, b: float) -> float | None:
    if b is None or a is None or b == 0 or pd.isna(a) or pd.isna(b):
        return None
    return a / b


def fmt_lkr(v: float | None) -> str:
    if v is None or pd.isna(v):
        return "n/a"
    return f"LKR {v:,.0f}"


def day_str(d: Any) -> str:
    return pd.Timestamp(d).strftime("%Y-%m-%d")
