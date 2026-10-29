"""Channel and daypart normalisation driven by editable JSON config files.

The same normalisation is applied to the TV (TVR) sheet and the LMRB sheet
so the two can be joined on channel, day of week and daypart.
"""
from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path
from typing import Any

import pandas as pd

log = logging.getLogger(__name__)

CONFIG_DIR = Path(os.environ.get("CONFIG_DIR", Path(__file__).resolve().parent.parent / "config"))

_cache: dict[str, tuple[float, Any]] = {}


def load_config(name: str) -> dict:
    """Load a JSON config file, reloading automatically when the file changes."""
    path = CONFIG_DIR / name
    mtime = path.stat().st_mtime
    hit = _cache.get(name)
    if hit and hit[0] == mtime:
        return hit[1]
    with path.open(encoding="utf-8") as fh:
        data = json.load(fh)
    _cache[name] = (mtime, data)
    return data


def _clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value)).strip().upper()


_PREFIX = re.compile(r"^TV\s*[-:–]\s*")
_SUFFIX = re.compile(r"\s+(TV|CHANNEL)$")


def _alias_lookup() -> dict[str, str]:
    cfg = load_config("channel_aliases.json")
    lookup: dict[str, str] = {}
    for canon, aliases in cfg.items():
        if canon.startswith("_"):
            continue
        lookup[_clean(canon)] = canon
        for a in aliases:
            lookup[_clean(a)] = canon
    return lookup


def normalise_channel(raw: Any) -> tuple[str, bool]:
    """Return (canonical channel name, matched_alias_table).

    "Tv - Derana", "DERANA" and "Derana TV" all become "DERANA". Unknown
    channels are still cleaned and uppercased but flagged as unmatched.
    """
    if raw is None or (isinstance(raw, float) and pd.isna(raw)):
        return "UNKNOWN", False
    lookup = _alias_lookup()
    cleaned = _clean(raw)
    if not cleaned:
        return "UNKNOWN", False
    candidates = [cleaned]
    stripped = _PREFIX.sub("", cleaned)
    candidates.append(stripped)
    candidates.append(_SUFFIX.sub("", stripped))
    for cand in candidates:
        if cand in lookup:
            return lookup[cand], True
    return candidates[1] or "UNKNOWN", False


def normalise_channel_series(series: pd.Series) -> tuple[pd.Series, list[str]]:
    """Vectorised channel normalisation. Returns (series, unmatched raw names)."""
    uniques = series.dropna().unique()
    mapping: dict[Any, str] = {}
    unmatched: list[str] = []
    for u in uniques:
        canon, ok = normalise_channel(u)
        mapping[u] = canon
        if not ok:
            unmatched.append(str(u))
    out = series.map(mapping).fillna("UNKNOWN")
    return out, sorted(unmatched)


def dayparts() -> list[dict]:
    return load_config("dayparts.json")["dayparts"]


def prime_dayparts() -> list[str]:
    return load_config("dayparts.json").get("prime", ["Prime"])


def daypart_order() -> list[str]:
    return [d["name"] for d in dayparts()]


def daypart_for_hour(hour: float) -> str | None:
    """Map an hour (0-24, fractional allowed) to a daypart name."""
    if hour is None or pd.isna(hour):
        return None
    h = float(hour) % 24
    for d in dayparts():
        s, e = d["start"], d["end"]
        if s < e and s <= h < e:
            return d["name"]
        if s > e and (h >= s or h < e):
            return d["name"]
    return None


def daypart_series(seconds_of_day: pd.Series) -> pd.Series:
    """Vectorised daypart mapping from seconds since midnight."""
    hours = seconds_of_day / 3600.0
    cache: dict[int, str | None] = {}

    def f(h: float) -> str | None:
        if pd.isna(h):
            return None
        k = int(h)
        if k not in cache:
            cache[k] = daypart_for_hour(k)
        return cache[k]

    return hours.map(f)


def duration_band(seconds: pd.Series) -> pd.Series:
    bands = load_config("dayparts.json")["duration_bands"]

    def f(v: float) -> str | None:
        if pd.isna(v):
            return None
        for b in bands:
            if b["max"] is None or v <= b["max"]:
                return b["label"]
        return None

    return seconds.map(f)


def duration_band_order() -> list[str]:
    return [b["label"] for b in load_config("dayparts.json")["duration_bands"]]


def min_points() -> dict[str, int]:
    return load_config("dayparts.json").get("min_points", {"daily": 14, "weekly": 8})
