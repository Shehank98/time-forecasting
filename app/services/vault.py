"""Agency history vault: compact daily totals kept between uploads so forecasts can use the longest history available.

What is stored (never raw spot or airing rows with free text beyond programme names):
  * LMRB: one row per (date, product group, advertiser, channel) with cost, seconds, spot count and break-length sums.
  * TVR:  one row per airing with date, channel, programme, category, start/end and the rating columns.
Layout: data/vault/lmrb/<product_group>/<advertiser>.parquet and data/vault/tv/<channel>.parquet.
Rows are keyed, so uploading the same or an overlapping sheet again replaces cells instead of double counting them.

The vault only ever extends a series backwards: dates the browser already sent are never replaced.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import tempfile
import threading
import time
from pathlib import Path

import numpy as np
import pandas as pd

log = logging.getLogger("vault")
_LOCK = threading.RLock()

LM_KEY = ["date", "product_group", "advertiser", "channel"]
LM_NUM = ["cost", "cost_d", "seconds", "spots", "totads_sum", "totads_n", "clutter_sum", "clutter_n"]
TV_KEY = ["date", "channel", "start", "program"]
TV_NUM = ["tvr", "reach_pct", "tvr_share", "avg_time", "duration", "end"]
TV_TXT = ["data_set", "category"]
MAX_ROWS_PER_REQUEST = 60000


def root() -> Path:
    return Path(os.environ.get("VAULT_DIR") or Path(__file__).resolve().parent.parent.parent / "data" / "vault")


def enabled() -> bool:
    return os.environ.get("VAULT_ENABLED", "1") != "0"


def slug(s: str) -> str:
    base = re.sub(r"[^A-Za-z0-9]+", "_", str(s)).strip("_")[:60] or "x"
    return f"{base}-{hashlib.sha1(str(s).encode()).hexdigest()[:6]}"       # the hash keeps different names that slug alike apart


def _atomic_write(df: pd.DataFrame, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    os.close(fd)
    try:
        df.to_parquet(tmp, index=False)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def _ledger_path() -> Path:
    return root() / "ledger.jsonl"


def version() -> str:
    """Changes whenever anything is added, so cached forecasts do not outlive the history they used."""
    p = _ledger_path()
    return f"{p.stat().st_size}-{int(p.stat().st_mtime)}" if p.exists() else "0"


def _log(entry: dict) -> None:
    root().mkdir(parents=True, exist_ok=True)
    with open(_ledger_path(), "a", encoding="utf8") as f:
        f.write(json.dumps(entry) + "\n")


def ledger(limit: int = 200) -> list[dict]:
    p = _ledger_path()
    if not p.exists():
        return []
    rows = [json.loads(x) for x in p.read_text(encoding="utf8").splitlines() if x.strip()]
    return rows[-limit:]


# ------------------------------------------------------------------ ingest
def _clean_lm(rows: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(rows)
    need = set(LM_KEY + LM_NUM)
    missing = need - set(df.columns)
    if missing:
        raise ValueError(f"Missing LMRB columns: {sorted(missing)}")
    df = df[LM_KEY + LM_NUM].copy()
    df["date"] = pd.to_datetime(df["date"], errors="coerce").dt.strftime("%Y-%m-%d")
    for c in ("product_group", "advertiser", "channel"):
        df[c] = df[c].astype(str).str.strip().replace("", "Unknown")
    for c in LM_NUM:
        df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0.0)
    return df.dropna(subset=["date"]).groupby(LM_KEY, as_index=False)[LM_NUM].sum()


def _clean_tv(rows: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(rows)
    for c in TV_KEY + TV_NUM + TV_TXT:
        if c not in df.columns:
            df[c] = np.nan if c in TV_NUM else ""
    df = df[TV_KEY + TV_NUM + TV_TXT].copy()
    df["date"] = pd.to_datetime(df["date"], errors="coerce").dt.strftime("%Y-%m-%d")
    for c in ("channel", "program", "data_set", "category"):
        df[c] = df[c].fillna("").astype(str).str.strip()
    df["start"] = pd.to_numeric(df["start"], errors="coerce").fillna(-1).astype(int)
    for c in TV_NUM:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    return df.dropna(subset=["date"]).drop_duplicates(TV_KEY, keep="last")


def _merge(old: pd.DataFrame | None, new: pd.DataFrame, key: list[str]) -> tuple[pd.DataFrame, int, int]:
    """Latest upload wins per key. Returns the merged frame and how many cells were added and changed."""
    new = new.reset_index(drop=True)
    if old is None or old.empty:
        return new, len(new), 0
    cols = list(new.columns)
    old = old[cols]
    tag = old.merge(new[key].assign(_in_new=1), on=key, how="left")
    kept = old[tag["_in_new"].isna().to_numpy()]
    both = new.merge(old, on=key, how="inner", suffixes=("", "_old"))
    value_cols = [c for c in cols if c not in key]
    changed = 0
    for _, r in both.iterrows():
        if not all(_same(r[c], r[c + "_old"]) for c in value_cols):
            changed += 1
    return pd.concat([kept, new], ignore_index=True), len(new) - len(both), changed


def _same(x, y) -> bool:
    try:
        if pd.isna(x) and pd.isna(y):
            return True
        return bool(abs(float(x) - float(y)) < 1e-6)
    except (TypeError, ValueError):
        return x == y


def ingest(kind: str, rows: list[dict], user_id: int | None = None, source: str = "") -> dict:
    if not enabled():
        return {"enabled": False, "added": 0, "changed": 0, "unchanged": 0}
    if kind not in ("lmrb", "tv"):
        raise ValueError("kind must be lmrb or tv")
    if not rows:
        return {"enabled": True, "added": 0, "changed": 0, "unchanged": 0}
    if len(rows) > MAX_ROWS_PER_REQUEST:
        raise ValueError(f"Send at most {MAX_ROWS_PER_REQUEST} rows per request.")
    added = changed = total = 0
    with _LOCK:
        if kind == "lmrb":
            df, keys = _clean_lm(rows), LM_KEY
            parts = [((pg, adv), g, root() / "lmrb" / slug(pg) / f"{slug(adv)}.parquet") for (pg, adv), g in df.groupby(["product_group", "advertiser"])]
        else:
            df, keys = _clean_tv(rows), TV_KEY
            parts = [(ch, g, root() / "tv" / f"{slug(ch)}.parquet") for ch, g in df.groupby("channel")]
        for _k, part, path in parts:
            old = pd.read_parquet(path) if path.exists() else None
            merged, a, c = _merge(old, part, keys)
            if a or c:
                _atomic_write(merged.sort_values(keys).reset_index(drop=True), path)
            added += a; changed += c; total += len(part)
        dmin, dmax = str(df["date"].min()), str(df["date"].max())
        if added or changed:
            _log({"at": int(time.time()), "kind": kind, "user": user_id, "rows": int(total), "added": added, "changed": changed, "date_min": dmin, "date_max": dmax, "source": source[:80],
                  "hash": hashlib.sha1(pd.util.hash_pandas_object(df, index=False).values.tobytes()).hexdigest()[:12]})
    return {"enabled": True, "added": added, "changed": changed, "unchanged": total - added - changed, "date_min": dmin, "date_max": dmax}


# ------------------------------------------------------------------ reading
def _lm_frames(product_group: str, advertiser: str | None = None) -> pd.DataFrame | None:
    d = root() / "lmrb" / slug(product_group)
    if not d.exists():
        return None
    files = [d / f"{slug(advertiser)}.parquet"] if advertiser else sorted(d.glob("*.parquet"))
    frames = [pd.read_parquet(f) for f in files if f.exists()]
    return pd.concat(frames, ignore_index=True) if frames else None


def _tv_frames(channel: str | None = None) -> pd.DataFrame | None:
    d = root() / "tv"
    if not d.exists():
        return None
    files = [d / f"{slug(channel)}.parquet"] if channel else sorted(d.glob("*.parquet"))
    frames = [pd.read_parquet(f) for f in files if f.exists()]
    return pd.concat(frames, ignore_index=True) if frames else None


def daily(desc: dict) -> pd.DataFrame | None:
    """Daily numerator and denominator for a series description sent by the browser.

    desc = {kind, group, product_group, entity}. The columns are num, den, agg ('sum' needs num only; 'mean' and 'ratio' use num/den; 'share' num and tot).
    Returns None when the vault holds nothing for it.
    """
    kind, g, ent = desc.get("kind"), desc.get("group"), desc.get("entity")
    if kind == "lmrb":
        pg = desc.get("product_group")
        if not pg:
            return None
        if g in ("comp_spend", "stealth_spend", "stealth_totads", "stealth_clutter"):
            df = _lm_frames(pg, ent)
        elif g in ("spots_total", "cps_total"):
            df = _lm_frames(pg)
        else:
            return None
        if df is None or df.empty:
            return None
        grp = df.groupby("date")
        if g in ("comp_spend", "stealth_spend"):
            out = pd.DataFrame({"num": grp["cost"].sum()}); out["agg"] = "sum"
        elif g == "spots_total":
            out = pd.DataFrame({"num": grp["spots"].sum()}); out["agg"] = "sum"
        elif g == "cps_total":
            out = pd.DataFrame({"num": grp["cost_d"].sum(), "den": grp["seconds"].sum()}); out["agg"] = "ratio"
        elif g == "stealth_totads":
            out = pd.DataFrame({"num": grp["totads_sum"].sum(), "den": grp["totads_n"].sum()}); out["agg"] = "mean"
        else:
            out = pd.DataFrame({"num": grp["clutter_sum"].sum(), "den": grp["clutter_n"].sum()}); out["agg"] = "mean"
    elif kind == "tv":
        if g in ("tvr_total", "reach_total"):
            df = _tv_frames()
        elif g in ("channel_tvr", "channel_share"):
            df = _tv_frames(None)
        else:
            return None
        if df is None or df.empty:
            return None
        col = "reach_pct" if g == "reach_total" else "tvr"
        if g in ("channel_tvr",):
            df = df[df["channel"] == ent]
        sub = df[np.isfinite(df[col])] if col in df else df
        grp = sub.groupby("date")
        if g == "channel_share":
            tot = df[np.isfinite(df["tvr"])].groupby("date")["tvr"].sum()
            mine = df[(df["channel"] == ent) & np.isfinite(df["tvr"])].groupby("date")["tvr"].sum()
            out = pd.DataFrame({"num": mine.reindex(tot.index).fillna(0.0), "den": tot}); out["agg"] = "share"
        else:
            out = pd.DataFrame({"num": grp[col].sum(), "den": grp[col].count()}); out["agg"] = "mean"
    else:
        return None
    out.index = pd.to_datetime(out.index)
    return out.sort_index()


def _periods(idx: pd.DatetimeIndex, gran: str) -> pd.DatetimeIndex:
    if gran == "daily":
        return idx
    if gran == "weekly":
        return idx - pd.to_timedelta(idx.dayofweek, unit="D")
    return idx.to_period("M").to_timestamp()


def history_series(desc: dict, gran: str, before: pd.Timestamp, zero_fill: bool) -> pd.Series | None:
    """Vault values per period strictly before `before`, complete periods only, as a regularly spaced Series."""
    d = daily(desc)
    if d is None or d.empty:
        return None
    first_day, last_day = d.index.min(), d.index.max()
    full = pd.date_range(first_day, last_day, freq="D")
    d = d.reindex(full)
    agg = d["agg"].dropna().iloc[0] if d["agg"].notna().any() else "sum"
    num, den = d["num"], d["den"] if "den" in d else None
    if agg == "sum":
        num = num.fillna(0.0)
    per = _periods(full, gran)
    g = pd.DataFrame({"p": per, "num": num.to_numpy(), "den": (den.to_numpy() if den is not None else np.zeros(len(full)))})
    if agg == "share":
        sh = g.groupby("p")[["num", "den"]].sum(min_count=1)
        vals = (sh["num"] / sh["den"].replace(0, np.nan)) * 100
    elif agg == "sum":
        vals = g.groupby("p")["num"].sum()
    else:
        sh = g.groupby("p")[["num", "den"]].sum(min_count=1)
        vals = sh["num"] / sh["den"].replace(0, np.nan)
    # complete periods only: the period must start on or after the first vault day and end on or before the last one
    step = {"daily": pd.Timedelta(days=1), "weekly": pd.Timedelta(days=7)}.get(gran)
    keep = []
    for p in vals.index:
        end = p + step - pd.Timedelta(days=1) if step is not None else p + pd.offsets.MonthEnd(0)
        keep.append(p >= first_day and end <= last_day and p < before)
    vals = vals[np.array(keep, dtype=bool)]
    if vals.empty:
        return None
    freq = {"daily": "D", "weekly": "7D", "monthly": "MS"}[gran]
    idx = pd.date_range(vals.index.min(), before - (pd.DateOffset(months=1) if gran == "monthly" else pd.Timedelta(days=7 if gran == "weekly" else 1)), freq=freq)
    out = vals.reindex(idx)
    return out.fillna(0.0) if zero_fill else out


def extend(items: list[dict], gran: str, max_points: int = 6000) -> dict:
    """Prepend vault history to every item that carries a `vault` description. Mutates items. Returns what was used."""
    stats = {"enabled": enabled(), "series_extended": 0, "points_added": 0, "months": 0.0, "product_group": None}
    if not enabled():
        return stats
    best = 0.0
    for it in items:
        desc = it.get("vault")
        if not desc or not it.get("dates"):
            continue
        try:
            first = pd.Timestamp(it["dates"][0])
            zf = bool(it.get("zero_fill", it.get("agg") in ("sum", "count", "share")))
            h = history_series(desc, gran, first, zf)
        except Exception as exc:  # noqa: BLE001 - the vault must never break a forecast
            log.warning("Vault history skipped for %s: %s", it.get("entity"), exc)
            continue
        if h is None or len(h) == 0 or len(h) + len(it["dates"]) > max_points:
            continue
        it["dates"] = [str(d.date()) for d in h.index] + list(it["dates"])
        it["values"] = [None if pd.isna(v) else float(v) for v in h.to_numpy()] + list(it["values"])
        stats["series_extended"] += 1; stats["points_added"] += int(len(h))
        stats["product_group"] = desc.get("product_group") or stats["product_group"]
        days = (first - h.index[0]).days
        best = max(best, days / 30.4)
    stats["months"] = round(best, 1)
    return stats


# ------------------------------------------------------------------ status
def coverage(product_group: str | None = None) -> dict:
    """What the vault holds, for the memory panel."""
    out: dict = {"enabled": enabled(), "lmrb": {}, "tv": None, "recent": ledger(8), "version": version()}
    r = root()
    if (r / "lmrb").exists():
        for d in sorted((r / "lmrb").iterdir()):
            if not d.is_dir():
                continue
            lo = hi = None; n_adv = 0; name = None
            for f in d.glob("*.parquet"):
                df = pd.read_parquet(f, columns=["date", "product_group"])
                if df.empty:
                    continue
                name = df["product_group"].iloc[0]; n_adv += 1
                lo = df["date"].min() if lo is None else min(lo, df["date"].min()); hi = df["date"].max() if hi is None else max(hi, df["date"].max())
            if name and (product_group is None or product_group == name):
                out["lmrb"][name] = {"advertisers": n_adv, "date_min": lo, "date_max": hi, "months": round((pd.Timestamp(hi) - pd.Timestamp(lo)).days / 30.4, 1)}
    tv = _tv_frames()
    if tv is not None and len(tv):
        out["tv"] = {"channels": int(tv["channel"].nunique()), "date_min": str(tv["date"].min()), "date_max": str(tv["date"].max()), "months": round((pd.Timestamp(tv["date"].max()) - pd.Timestamp(tv["date"].min())).days / 30.4, 1)}
    return out


def clear(kind: str, product_group: str | None = None) -> int:
    """Remove stored history (admin action). Returns the number of files removed."""
    import shutil
    n = 0
    with _LOCK:
        target = root() / kind / (slug(product_group) if (product_group and kind == "lmrb") else "")
        if target.exists():
            n = sum(1 for _ in target.rglob("*.parquet"))
            shutil.rmtree(target) if target.is_dir() else target.unlink()
        _log({"at": int(time.time()), "kind": kind, "action": "clear", "product_group": product_group, "files": n})
    return n
