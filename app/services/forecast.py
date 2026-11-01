"""Forecasting service built on Google TimesFM 2.5 (200M, PyTorch, CPU) with a statistical fallback.

What it does for a media agency:
- Batched probabilistic forecasts (P10, P50, P90) for many entities in one call.
- Calendar covariates (weekday, Poya, New Year, school holidays) through TimesFM XReg.
- Backtests against a seasonal naive baseline and a reliability badge.
- Band monitoring: recent actuals outside the expected P10 to P90 band (pacing breaks, tracking breaks, spikes).
- Competitor outlook, demand peak detection and launch timing.
- Driver scenarios (for example spend -20%, 0, +20%) to forecast a KPI and its cost per result (CPL, CPA, CPRP).
- Pacing: projected end of campaign total against a target.

The model loads once and is cached. If it cannot load, seasonal naive plus exponential
smoothing takes over and the UI shows a banner. Nothing here raises on model problems.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
import time
import uuid
from collections import OrderedDict
from typing import Any, Callable

import numpy as np
import pandas as pd

from . import normalise as nz
from . import series as S
from . import sl_media_calendar as CAL
from .util import jsonable

log = logging.getLogger(__name__)

CHECKPOINT = os.environ.get("TIMESFM_REPO", "google/timesfm-2.5-200m-pytorch")
WEIGHTS = "model.safetensors"


def local_checkpoint() -> str | None:
    """A folder holding the saved TimesFM weights, so the model can load fully offline.

    Order: TIMESFM_LOCAL_DIR, TIMESFM_REPO when it is a folder, then the Hugging Face cache (HF_HOME/hub).
    """
    from pathlib import Path
    for cand in (os.environ.get("TIMESFM_LOCAL_DIR"), CHECKPOINT):
        if cand and Path(cand).is_dir() and (Path(cand) / WEIGHTS).exists():
            return str(Path(cand))
    home = Path(os.environ.get("HF_HOME") or Path.home() / ".cache" / "huggingface")
    snaps = home / "hub" / ("models--" + CHECKPOINT.replace("/", "--")) / "snapshots"
    if snaps.is_dir():
        for d in sorted(snaps.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
            if (d / WEIGHTS).exists():
                return str(d)
    return None
MAX_CONTEXT = int(os.environ.get("TIMESFM_MAX_CONTEXT", "1024"))
MAX_HORIZON = 256                 # multiple of the 128 output patch, covers 36 weeks daily
Q = {"p10": 1, "p50": 5, "p90": 9}  # TimesFM output is [mean, q0.1 ... q0.9]
Progress = Callable[[float, str], None]


# =============================================================== model wrapper
class ModelService:
    """Lazy, thread-safe holder for TimesFM 2.5."""

    def __init__(self) -> None:
        self._tfm: Any = None
        self._lock = threading.Lock()
        self._infer_lock = threading.Lock()
        self._failed = False
        self.error: str | None = None
        self.load_seconds: float | None = None
        self.xreg_ok: bool | None = None
        self.source: str | None = None

    def status(self) -> dict:
        backend = "timesfm" if self._tfm is not None else ("fallback" if self._failed else "pending")
        return {"backend": backend, "loaded": self._tfm is not None, "error": self.error, "checkpoint": CHECKPOINT, "model": "Media Radar forecast engine",
                "max_context": MAX_CONTEXT, "load_seconds": self.load_seconds, "source": self.source,
                "offline": os.environ.get("HF_HUB_OFFLINE") == "1", "covariates_supported": self.xreg_ok,
                "note": "Fallback statistical model in use." if self._failed else ("The forecast engine starts on first run." if self._tfm is None else "")}

    def load(self) -> bool:
        """Load TimesFM once. Returns True when the real model is available."""
        with self._lock:
            if self._tfm is not None:
                return True
            if self._failed:
                return False
            if os.environ.get("FORCE_FALLBACK") == "1":
                self._failed, self.error = True, "FORCE_FALLBACK is set"
                return False
            t0 = time.time()
            try:
                local = local_checkpoint()
                if local:
                    os.environ.setdefault("HF_HUB_OFFLINE", "1")      # saved weights: never touch the network
                    self.source = local
                elif os.environ.get("HF_HUB_OFFLINE") == "1":
                    raise RuntimeError(f"HF_HUB_OFFLINE=1 but no saved checkpoint was found for {CHECKPOINT}. Set TIMESFM_LOCAL_DIR or prefetch the weights.")
                else:
                    self.source = CHECKPOINT
                import timesfm  # type: ignore
                import torch  # type: ignore

                torch.set_float32_matmul_precision("high")
                # torch_compile=False: torch.compile needs a C compiler that the slim image does not ship.
                tfm = timesfm.TimesFM_2p5_200M_torch.from_pretrained(local or CHECKPOINT, torch_compile=False)
                tfm.compile(timesfm.ForecastConfig(
                    max_context=MAX_CONTEXT, max_horizon=MAX_HORIZON, normalize_inputs=True, use_continuous_quantile_head=True,
                    force_flip_invariance=True, infer_is_positive=True, fix_quantile_crossing=True, return_backcast=True, per_core_batch_size=32))
                tfm.forecast(horizon=8, inputs=[np.sin(np.arange(64) / 4.0)])   # warm-up
                self._tfm = tfm
                self.load_seconds = round(time.time() - t0, 1)
                cache.clear()
                log.info("TimesFM 2.5 loaded in %.1fs", self.load_seconds)
                return True
            except Exception as exc:  # noqa: BLE001 - any failure must degrade gracefully
                self._failed, self.error = True, f"{type(exc).__name__}: {exc}"[:300]
                log.error("TimesFM unavailable, using fallback: %s", self.error)
                return False

    @staticmethod
    def _bands(full: np.ndarray, horizon: int) -> np.ndarray:
        """Last `horizon` steps (backcast is prepended when return_backcast is on) as [p10, p50, p90]."""
        full = np.asarray(full)[:, -horizon:, :]
        return np.stack([full[:, :, Q["p10"]], full[:, :, Q["p50"]], full[:, :, Q["p90"]]], axis=-1)

    def predict(self, contexts: list[np.ndarray], horizon: int, gran: str = "daily") -> tuple[np.ndarray, str]:
        """Quantiles [N, H, 3] for p10, p50, p90 from one batched call."""
        if self.load():
            try:
                with self._infer_lock:
                    _, full = self._tfm.forecast(horizon=horizon, inputs=[np.asarray(c, dtype=float) for c in contexts])
                return self._bands(full, horizon), "timesfm"
            except Exception as exc:  # noqa: BLE001
                self._tfm, self._failed, self.error = None, True, f"Inference failed: {exc}"[:300]
                log.exception("TimesFM inference failed, switching to fallback")
        return fallback_batch(contexts, horizon, gran), "fallback"

    def predict_covariates(self, contexts: list[np.ndarray], horizon: int, dyn_num: dict[str, list[np.ndarray]],
                           dyn_cat: dict[str, list[np.ndarray]] | None = None) -> np.ndarray | None:
        """Covariate-aware quantiles [N, H, 3] via XReg, or None when unsupported."""
        if self._tfm is None:
            return None
        try:
            with self._infer_lock:
                _, quants = self._tfm.forecast_with_covariates(
                    [np.asarray(c, dtype=float) for c in contexts], dynamic_numerical_covariates=dyn_num or None,
                    dynamic_categorical_covariates=dyn_cat or None, xreg_mode="xreg + timesfm", ridge=1.0, normalize_xreg_target_per_input=True)
            self.xreg_ok = True
            return self._bands(np.stack([np.asarray(x)[-horizon:] for x in quants]), horizon)
        except Exception as exc:  # noqa: BLE001 - jax missing, shapes, singular design
            self.xreg_ok = False
            log.warning("Covariates unavailable (%s); using plain forecast", exc)
            return None


model = ModelService()


# =============================================================== statistical fallback
def _ses(y: np.ndarray) -> tuple[float, float]:
    """Simple exponential smoothing with alpha chosen by grid search. Returns (level, residual std)."""
    best = (np.inf, y[0], 0.0)
    for a in (0.1, 0.2, 0.3, 0.5, 0.7, 0.9):
        lvl, sse, res = y[0], 0.0, []
        for v in y[1:]:
            e = v - lvl
            res.append(e); sse += e * e; lvl = lvl + a * e
        if sse < best[0]:
            best = (sse, lvl, float(np.std(res)) if res else 0.0)
    return best[1], best[2]


def fallback_one(y: np.ndarray, horizon: int, season: int) -> np.ndarray:
    """Seasonal naive blended with exponential smoothing. Returns q[H, 3]."""
    y = np.asarray(y, dtype=float)
    n = len(y)
    if n == 0:
        return np.zeros((horizon, 3))
    if n < 3:
        m = float(np.mean(y)); sd = float(np.std(y)) if n > 1 else abs(m) * 0.3
        mean = np.full(horizon, m)
        return np.stack([mean - 1.28 * sd, mean, mean + 1.28 * sd], axis=-1)
    use_season = season > 1 and n >= 2 * season
    idx = np.arange(n) % season if use_season else np.zeros(n, dtype=int)
    seas = np.array([y[idx == k].mean() for k in range(season)]) - y.mean() if use_season else np.zeros(1)
    level, sd = _ses(y - seas[idx] if use_season else y)
    h = np.arange(1, horizon + 1)
    mean = np.full(horizon, level)
    if use_season:
        mean = mean + seas[(n + h - 1) % season]
        naive = np.array([y[n - season + (k % season)] for k in range(horizon)])
        mean = 0.7 * mean + 0.3 * naive
    sd = max(sd, 1e-9) * np.sqrt(1 + 0.15 * (h - 1))
    return np.stack([mean - 1.28 * sd, mean, mean + 1.28 * sd], axis=-1)


def fallback_batch(contexts: list[np.ndarray], horizon: int, gran: str) -> np.ndarray:
    return np.stack([fallback_one(c, horizon, S.season_length(gran, len(c))) for c in contexts])


# =============================================================== metrics
def smape(a: np.ndarray, f: np.ndarray) -> float | None:
    if not len(a):
        return None
    den = np.abs(a) + np.abs(f)
    ok = den > 0
    return float(np.mean(2 * np.abs(a - f)[ok] / den[ok]) * 100) if ok.any() else 0.0


def mae(a: np.ndarray, f: np.ndarray) -> float:
    return float(np.mean(np.abs(a - f)))


def mase(a: np.ndarray, f: np.ndarray, train: np.ndarray, m: int) -> float | None:
    if len(train) <= m:
        return None
    scale = float(np.mean(np.abs(train[m:] - train[:-m])))
    return mae(a, f) / scale if scale > 0 else None


def coverage(a: np.ndarray, lo: np.ndarray, hi: np.ndarray) -> float | None:
    """Share of actuals inside the P10 to P90 band (ideal is about 80%)."""
    return float(np.mean((a >= lo) & (a <= hi)) * 100) if len(a) else None


def seasonal_naive(train: np.ndarray, horizon: int, m: int) -> np.ndarray:
    m = m if len(train) >= m else 1
    return np.array([train[len(train) - m + (k % m)] for k in range(horizon)])


# =============================================================== anomaly / change point
def detect_anomalies(dates: pd.DatetimeIndex, y: np.ndarray, gran: str, z_thr: float = 3.0) -> list[dict]:
    """Robust rolling z-score against the median and MAD of the previous window."""
    w = {"daily": 7, "weekly": 4, "monthly": 3}[gran]
    out = []
    for i in range(w, len(y)):
        win = y[i - w:i]
        med = np.median(win)
        mad = np.median(np.abs(win - med)) * 1.4826
        floor = 0.1 * abs(med)                     # smooth series: a tiny MAD must not turn normal moves into alerts
        scale = max(mad, floor, np.std(win) * 0.5)
        if scale == 0:
            continue
        z = (y[i] - med) / scale
        rel = abs(y[i] - med) / abs(med) if med else np.inf
        if abs(z) >= z_thr and rel >= 0.25:
            out.append({"date": str(dates[i].date()), "value": float(y[i]), "z": float(z), "direction": "spike" if z > 0 else "drop"})
    return out[:30]


def detect_change_points(dates: pd.DatetimeIndex, y: np.ndarray, min_seg: int = 5, t_thr: float = 4.0, max_cp: int = 3) -> list[dict]:
    """Binary segmentation on mean shifts with a Welch t statistic and a 25% effect size floor."""
    found: list[dict] = []
    if len(y) < 2 * min_seg:
        return found
    y = np.clip(y, np.percentile(y, 5), np.percentile(y, 95))   # one spike must not look like a level shift

    def split(lo: int, hi: int, depth: int) -> None:
        if depth >= max_cp or hi - lo < 2 * min_seg:
            return
        best, bi = 0.0, -1
        for k in range(lo + min_seg, hi - min_seg + 1):
            a, b = y[lo:k], y[k:hi]
            se = np.sqrt(a.var(ddof=1) / len(a) + b.var(ddof=1) / len(b)) if len(a) > 1 and len(b) > 1 else 0
            t = abs(a.mean() - b.mean()) / se if se > 0 else 0
            if t > best:
                best, bi = t, k
        if bi < 0 or best < t_thr:
            return
        before, after = y[lo:bi].mean(), y[bi:hi].mean()
        if abs(after - before) / max(abs(before), abs(after), 1e-9) < 0.25:
            return
        found.append({"date": str(dates[bi].date()), "before": float(before), "after": float(after),
                      "change_pct": float((after - before) / abs(before) * 100) if before else None, "t": float(best)})
        split(lo, bi, depth + 1); split(bi, hi, depth + 1)

    split(0, len(y), 0)
    return sorted(found, key=lambda d: d["date"])


def band_breaches(dates: list[str], actual: np.ndarray, p10: np.ndarray, p90: np.ndarray) -> list[dict]:
    """Recent periods where the actual left the expected band: the pacing and tracking alarm."""
    out = []
    for d, a, lo, hi in zip(dates, actual, p10, p90):
        if a > hi or a < lo:
            ref = hi if a > hi else lo
            gap = (a - ref) / abs(ref) * 100 if ref else None
            sev = "high" if gap is None or abs(gap) >= 50 or (a == 0 and lo > 0) else "medium"
            what = "above the expected range" if a > hi else ("zero where activity was expected (possible tracking break or pause)" if a == 0 and lo > 0 else "below the expected range")
            out.append({"date": d, "actual": float(a), "p10": float(lo), "p90": float(hi), "gap_pct": gap, "direction": "above" if a > hi else "below", "severity": sev, "text": f"{d}: {what}"})
    return out


# =============================================================== outlook and peaks
def _blocks(gran: str) -> tuple[int, int, str]:
    """(points per block, blocks in the outlook, block name)."""
    return {"daily": (7, 4, "week"), "weekly": (1, 4, "week"), "monthly": (1, 3, "month")}[gran]


def outlook(spec: S.SeriesSpec, fdates: pd.DatetimeIndex, p10: np.ndarray, p50: np.ndarray, p90: np.ndarray) -> dict:
    """Next 4 weeks (or 3 months): expected total, trend, active blocks and burst windows."""
    m = spec.mdef
    additive = bool(m and m.additive)
    per, nblk, name = _blocks(spec.gran)
    y = spec.values
    if spec.gran == "daily":
        hist_b = pd.Series(y, index=spec.dates).resample("W-SUN").sum() if additive else pd.Series(y, index=spec.dates).resample("W-SUN").mean()
        hist_b = hist_b.iloc[1:-1] if len(hist_b) > 4 else hist_b
    else:
        hist_b = pd.Series(y, index=spec.dates)
    n_blocks = min(nblk, len(p50) // per)
    k = n_blocks * per
    out: dict[str, Any] = {"weeks": [], "n_weeks": n_blocks, "block": name, "additive": additive}
    recent = y[-max(k, per):] if len(y) else y
    base = float(np.mean(recent)) if len(recent) else 0.0
    fut = float(np.mean(p50[:max(k, per)])) if len(p50) else 0.0
    change = (fut - base) / abs(base) * 100 if base else None
    out["trend"] = "stable" if change is None or abs(change) < 10 else ("rising" if change > 0 else "falling")
    out["trend_change_pct"] = change
    out["expected_next_4w"] = float(np.sum(p50[:k])) if additive and k else None
    out["expected_next_4w_p10"] = float(np.sum(p10[:k])) if additive and k else None
    out["expected_next_4w_p90"] = float(np.sum(p90[:k])) if additive and k else None
    out["avg_next_4w"] = float(np.mean(p50[:k])) if not additive and k else None
    out["range_note"] = "Summed P10 and P90 are indicative bounds, not exact quantiles of the total."
    hv = hist_b.to_numpy(dtype=float)
    act = hv[hv > 0]
    med_act = float(np.median(act)) if len(act) else 0.0
    mean_b, std_b = (float(hv.mean()), float(hv.std())) if len(hv) else (0.0, 0.0)
    agg = np.sum if additive else np.mean
    for i in range(n_blocks):
        sl = slice(i * per, (i + 1) * per)
        v = float(agg(p50[sl]))
        w = {"week_start": str(fdates[sl][0].date()), "expected": v, "p10": float(agg(p10[sl])), "p90": float(agg(p90[sl]))}
        if additive:
            w["status"] = "active" if med_act > 0 and v >= 0.15 * med_act else "inactive"
            w["burst"] = bool(w["status"] == "active" and v >= mean_b + std_b and v >= 1.25 * (float(np.mean(act)) if len(act) else v))
        out["weeks"].append(w)
    out["active_weeks"] = sum(1 for w in out["weeks"] if w.get("status") == "active")
    out["inactive_weeks"] = sum(1 for w in out["weeks"] if w.get("status") == "inactive")
    out["burst_windows"] = [w["week_start"] for w in out["weeks"] if w.get("burst")]
    out["history_weeks"] = int(len(hv))
    return out


def find_peaks(spec: S.SeriesSpec, fdates: pd.DatetimeIndex, p50: np.ndarray, lead_days: int = 14) -> dict:
    """Demand peaks in the forecast and the launch window that gets ahead of them."""
    y = spec.values
    if not len(p50) or not len(y):
        return {"peaks": [], "season_peak": None}
    ref_mean, ref_std = float(np.mean(y)), float(np.std(y))
    thr = ref_mean + 0.5 * ref_std
    peaks = []
    for i, v in enumerate(p50):
        left = p50[i - 1] if i > 0 else -np.inf
        right = p50[i + 1] if i < len(p50) - 1 else -np.inf
        if v >= left and v >= right and v >= thr and v > 0:
            d = fdates[i]
            launch = d - pd.Timedelta(days=lead_days)
            peaks.append({"date": str(d.date()), "expected": float(v), "vs_history_pct": (v - ref_mean) / ref_mean * 100 if ref_mean else None,
                          "launch_by": str(max(launch, fdates[0] - pd.Timedelta(days=lead_days)).date())})
    peaks = sorted(peaks, key=lambda p: -p["expected"])[:3]
    season_peak = None
    if spec.gran in ("weekly", "monthly", "daily") and len(spec.dates) >= 365 // S.DAYS_PER[spec.gran]:
        s = pd.Series(y, index=spec.dates)
        by = s.groupby(s.index.month).mean()
        if len(by) >= 6 and by.mean() > 0:
            season_peak = {"month": int(by.idxmax()), "index_vs_avg": float(by.max() / by.mean() * 100)}
    return {"peaks": peaks, "season_peak": season_peak, "lead_days": lead_days}


# =============================================================== reliability
def min_points(gran: str) -> int:
    cfg = nz.min_points()
    return int(cfg.get(gran, {"daily": 14, "weekly": 8, "monthly": 12}[gran]))


def reliability(n_points: int, n_observed: int, gran: str, bt: dict | None, all_zero: bool) -> dict:
    mp = min_points(gran)
    reasons: list[str] = []
    if all_zero:
        return {"level": "Low", "reasons": ["The series is all zeros, so there is nothing to learn from."]}
    level = "High"
    n = min(n_points, n_observed) if n_observed else n_points
    if n < mp:
        level = "Low"; reasons.append(f"Only {n} {gran} points of history (minimum {mp}).")
    if bt is None:
        level = "Low"; reasons.append("History is too short for a backtest, so accuracy is unknown.")
    else:
        m, base = bt["model"], bt["baseline"]
        s, ms = m.get("smape"), m.get("mase")
        beats = m["mae"] <= base["mae"]
        if (ms is not None and ms >= 1.2) or (s is not None and s > 60):
            level = "Low"; reasons.append(f"Backtest error is high (sMAPE {s:.0f}%" + (f", MASE {ms:.2f})." if ms is not None else ")."))
        elif not (ms is not None and ms < 0.8 and (s is None or s < 30) and beats and n >= 2 * mp):
            if level == "High":
                level = "Medium"
            reasons.append("Backtest is acceptable but not strong enough for High." if beats else "The model did not beat the seasonal naive baseline.")
        if not beats and level == "High":
            level = "Medium"
    if not reasons:
        reasons.append("Long enough history and a backtest that beats the seasonal naive baseline.")
    return {"level": level, "reasons": reasons}


# =============================================================== orchestration
# these legacy event columns are now covered by the Sri Lanka media calendar's own features
_LEGACY_EVENT_COLUMNS = {"is_poya", "is_new_year", "is_vesak", "is_christmas"}


def _cov_arrays(dates: pd.DatetimeIndex, n_hist: int, gran: str, events: list[dict] | None = None) -> tuple[dict, dict]:
    """Calendar covariates covering context plus horizon (dates already include the horizon).

    Poya day, festival window, salary week, weekend and user-flagged major events come from sl_media_calendar;
    public and school holidays still come from the editable holidays file.
    """
    feats = {k: v for k, v in S.calendar_features(dates, gran).items() if k not in _LEGACY_EVENT_COLUMNS}
    feats.update(CAL.covariates(dates, gran, events))
    num = {k: v for k, v in feats.items() if np.ptp(v) > 0 and np.ptp(v[:n_hist]) > 0}
    cat = {}
    if gran == "daily":
        cat["day_of_week"] = np.array([d.day_of_week for d in dates])
    if gran == "weekly" and n_hist >= 104:
        cat["week_of_year"] = np.array([int(d.isocalendar().week) for d in dates])
    if gran == "monthly" and n_hist >= 24:
        cat["month"] = np.array([d.month for d in dates])
    return num, cat


def _apply_covariates(specs: list[S.SeriesSpec], contexts: list[np.ndarray], H: int, gran: str, q: np.ndarray, events: list[dict] | None = None,
                      rows: list[int] | None = None, horizons: list[int] | None = None, cut: list[int] | None = None) -> tuple[list[str], str | None]:
    """Replace the plain quantiles in q with covariate-aware ones.

    rows[i] is the row of q for context i (default: i). horizons[i] is how many future points to keep (default H).
    cut[i] is how many points were removed from the end of the full history (used for backtest contexts).
    """
    rows = rows if rows is not None else list(range(len(contexts)))
    horizons = horizons if horizons is not None else [H] * len(contexts)
    cut = cut if cut is not None else [0] * len(contexts)
    min_cov = {"daily": 28, "weekly": 12, "monthly": 12}[gran]
    elig = [i for i, sp in enumerate(specs) if len(contexts[i]) >= min_cov]
    if not elig:
        return [], f"Covariates need at least {min_cov} {gran} points; skipped for thin history."
    Hm = max(horizons[i] for i in elig)
    arrs = {}
    for i in elig:
        hist_dates = specs[i].dates[-(len(contexts[i]) + cut[i]):]
        hist_dates = hist_dates[:len(hist_dates) - cut[i]] if cut[i] else hist_dates
        alld = hist_dates.append(S.future_dates(hist_dates[-1], Hm, gran))
        arrs[i] = _cov_arrays(alld, len(contexts[i]), gran, events)
    names_num = sorted(set.intersection(*[set(arrs[i][0]) for i in elig]))
    names_cat = sorted(set.intersection(*[set(arrs[i][1]) for i in elig]))
    if not (names_num or names_cat):
        return [], "No calendar event varies across the history, so covariates were skipped."
    adj = model.predict_covariates([contexts[i] for i in elig], Hm, {n: [arrs[i][0][n] for i in elig] for n in names_num},
                                   {n: [arrs[i][1][n] for i in elig] for n in names_cat})
    if adj is None:
        return [], "Covariates could not be applied in this environment, so the plain forecast is shown."
    for j, i in enumerate(elig):
        h = horizons[i]
        q[rows[i], :h, :] = adj[j][:h]
    return names_num + names_cat, None


def run(df: pd.DataFrame, kind: str, params: dict, progress: Progress | None = None, meta: dict | None = None) -> dict:
    """Batched forecast for all selected entities of a frame (server-side reference path)."""
    gran = params.get("granularity", "weekly")
    specs, notes = S.build_series(df, kind, params.get("entity_type", "total"), params["metric"], gran, params.get("entities") or None,
                                  params.get("history_days") or None, int(params.get("max_entities", 8)), meta)
    if not specs:
        return {"ok": False, "message": notes[0] if notes else "No series could be built.", "notes": notes}
    return run_specs(specs, notes, kind, params, progress)


MAX_SERIES = 300
MAX_POINTS = 6000


def specs_from_payload(items: list[dict], gran: str) -> tuple[list[S.SeriesSpec], list[str]]:
    """Series built in the browser: [{entity, group, metric, label, unit, agg, zero_fill, dates, values}].

    The browser keeps the raw data; only these compact, regularly spaced series reach the server.
    """
    if gran not in S.GRANULARITIES:
        raise ValueError("granularity must be daily, weekly or monthly")
    if not items:
        raise ValueError("No series were sent.")
    if len(items) > MAX_SERIES:
        raise ValueError(f"At most {MAX_SERIES} series per request.")
    specs, notes = [], []
    for it in items:
        dates = pd.DatetimeIndex(pd.to_datetime(it.get("dates") or [], errors="coerce"))
        vals = np.array([np.nan if v is None else float(v) for v in (it.get("values") or [])], dtype=float)
        if len(dates) != len(vals) or len(dates) == 0:
            raise ValueError(f"Series {it.get('entity')!r}: dates and values must have the same, non-zero length.")
        if len(dates) > MAX_POINTS:
            raise ValueError(f"Series {it.get('entity')!r} has more than {MAX_POINTS} points.")
        if dates.isna().any():
            raise ValueError(f"Series {it.get('entity')!r} has invalid dates.")
        expected = pd.date_range(dates[0], periods=len(dates), freq=S.STEP[gran])
        if not dates.equals(expected):
            raise ValueError(f"Series {it.get('entity')!r} is not regularly spaced at {gran} granularity.")
        agg = it.get("agg") if it.get("agg") in ("sum", "count", "mean", "ratio", "share") else "mean"
        zero_fill = bool(it.get("zero_fill", agg in ("sum", "count", "share")))
        mdef = S.MetricDef(str(it.get("metric") or "value"), str(it.get("label") or it.get("metric") or "Value")[:120], agg,
                           zero_fill=zero_fill, unit=it.get("unit") if it.get("unit") in ("number", "currency", "percent", "rating") else "number")
        n_obs = int(np.isfinite(vals).sum())
        if n_obs == 0:
            notes.append(f"{it.get('entity')}: no data in the selected window, skipped.")
            continue
        s = pd.Series(vals, index=dates)
        s = s.fillna(0.0) if zero_fill else s.interpolate(limit_direction="both")
        v = s.to_numpy(dtype=float)
        sp = S.SeriesSpec(entity=str(it.get("entity") or "All")[:160], dates=dates, values=v, metric=mdef.key, gran=gran, mdef=mdef,
                          n_active=int((v != 0).sum()), n_observed=len(v) if zero_fill else n_obs)
        sp.group = str(it.get("group") or "")[:60]
        specs.append(sp)
    return specs, notes


def run_specs(specs: list[S.SeriesSpec], notes: list[str], kind: str, params: dict, progress: Progress | None = None) -> dict:
    """Forecast prepared series in one batched TimesFM call. Returns a JSON-safe result."""
    prog = progress or (lambda p, m: None)
    if not specs:
        return {"ok": False, "message": notes[0] if notes else "No series could be built.", "notes": notes}
    prog(0.05, "Preparing series")
    gran = specs[0].gran
    H = S.horizon_points(int(params.get("horizon_days", 28)), gran)
    if H > MAX_HORIZON:
        H = MAX_HORIZON; notes.append(f"Horizon limited to {MAX_HORIZON} {gran} points.")
    mp = min_points(gran)
    default_hold = {"daily": 7, "weekly": 2, "monthly": 2}[gran]
    contexts, holds = [], []
    for sp in specs:
        y = sp.values[-MAX_CONTEXT:]
        h = min(int(params.get("holdout") or default_hold), len(y) // 3)
        contexts.append(y)
        holds.append(h if h >= 2 and len(y) - h >= 4 else 0)
    # one batched call: full contexts first, then the truncated contexts used for backtests and band monitoring
    bt_idx = [i for i, h in enumerate(holds) if h]
    batch = contexts + [contexts[i][:-holds[i]] for i in bt_idx]
    horizon_all = max([H] + [holds[i] for i in bt_idx])
    prog(0.2, "Starting the forecast engine" if model._tfm is None and not model._failed else "Forecasting")
    q, backend = model.predict(batch, horizon_all, gran)
    prog(0.65, "Applying calendar covariates")
    cov_used, cov_msg = ([], None)
    if params.get("covariates", True) and backend == "timesfm":
        ev = params.get("major_events")
        cov_used, cov_msg = _apply_covariates(specs, contexts, H, gran, q, ev)
        if bt_idx and cov_msg is None:      # the accuracy check must use the same covariate-aware model as the forecast
            bt_specs = [specs[i] for i in bt_idx]
            _apply_covariates(bt_specs, [contexts[i][:-holds[i]] for i in bt_idx], H, gran, q, ev, rows=[len(specs) + k for k in range(len(bt_idx))],
                              horizons=[holds[i] for i in bt_idx], cut=[holds[i] for i in bt_idx])
    results = []
    bt_pos = {i: len(specs) + k for k, i in enumerate(bt_idx)}
    for i, sp in enumerate(specs):
        prog(0.7 + 0.25 * (i + 1) / len(specs), f"Analysing {sp.entity}")
        y, nonneg = sp.values, bool(sp.mdef and sp.mdef.nonneg)
        fd = S.future_dates(sp.dates[-1], H, gran)
        qq = np.sort(q[i, :H, :], axis=-1)
        if nonneg:
            qq = np.clip(qq, 0, None)
        p10, p50, p90 = qq[:, 0], qq[:, 1], qq[:, 2]
        bt, breaches = None, []
        if i in bt_pos:
            h, k = holds[i], bt_pos[i]
            train, actual = contexts[i][:-h], contexts[i][-h:]
            bq = np.sort(q[k, :h, :], axis=-1)
            if nonneg:
                bq = np.clip(bq, 0, None)
            m = S.season_length(gran, len(train))
            base = seasonal_naive(train, h, m)
            bdates = [str(d.date()) for d in sp.dates[-h:]]
            bt = {"dates": bdates, "actual": actual, "pred": bq[:, 1], "p10": bq[:, 0], "p90": bq[:, 2], "holdout": h,
                  "model": {"smape": smape(actual, bq[:, 1]), "mae": mae(actual, bq[:, 1]), "mase": mase(actual, bq[:, 1], train, m), "coverage": coverage(actual, bq[:, 0], bq[:, 2])},
                  "baseline": {"smape": smape(actual, base), "mae": mae(actual, base), "mase": mase(actual, base, train, m), "name": "Seasonal naive"}}
            breaches = band_breaches(bdates, actual, bq[:, 0], bq[:, 2])
        all_zero = not np.any(y)
        warnings = list(sp.notes)
        if len(y) < mp:
            warnings.append(f"Thin history: {len(y)} {gran} points, below the minimum of {mp}. The forecast still ran but is marked Low reliability.")
        if all_zero:
            warnings.append("All values are zero. The forecast is flat zero.")
        results.append({
            "entity": sp.entity, "group": getattr(sp, "group", ""), "metric": sp.metric, "metric_label": sp.mdef.label if sp.mdef else sp.metric, "unit": sp.mdef.unit if sp.mdef else "number",
            "granularity": gran, "n_points": int(len(y)), "n_active": sp.n_active,
            "history": {"dates": [str(d.date()) for d in sp.dates], "values": y},
            "forecast": {"dates": [str(d.date()) for d in fd], "p10": p10, "p50": p50, "p90": p90},
            "backtest": bt, "band_breaches": breaches, "reliability": reliability(len(y), sp.n_observed, gran, bt, all_zero),
            "anomalies": detect_anomalies(sp.dates, y, gran), "change_points": detect_change_points(sp.dates, y) if len(y) >= 12 else [],
            "outlook": outlook(sp, fd, p10, p50, p90), "peaks": find_peaks(sp, fd, p50, int(params.get("lead_days", 14))), "warnings": warnings})
    prog(1.0, "Done")
    return jsonable({"ok": True, "kind": kind, "params": {**params, "granularity": gran, "horizon_points": H}, "backend": backend,
                     "model": model.status(), "covariates_used": cov_used, "covariate_note": cov_msg, "notes": notes, "results": results})


# =============================================================== driver scenarios (media planning / ROI)
def _driver_future(driver: np.ndarray, H: int, gran: str, multiplier: float, total: float | None) -> np.ndarray:
    """Future driver plan. Daily keeps the last week's weekday shape, scaled."""
    recent = driver[-(7 if gran == "daily" else 4):] if len(driver) else np.zeros(1)
    if gran == "daily" and len(driver) >= 7:
        base = np.array([recent[k % 7] for k in range(H)])
    else:
        base = np.full(H, float(np.mean(recent)))
    if total is not None:
        s = base.sum()
        return base / s * total if s > 0 else np.full(H, total / H)
    return base * multiplier


def _fallback_scenarios(y: np.ndarray, x: np.ndarray, dates: pd.DatetimeIndex, futures: list[np.ndarray], H: int, gran: str) -> tuple[np.ndarray, dict]:
    """Linear driver effect plus a seasonal residual forecast, used when TimesFM is not available."""
    n = len(y)
    dow = np.array([d.day_of_week for d in dates]) if gran == "daily" else np.zeros(n, dtype=int)
    X = np.column_stack([np.ones(n), x] + ([np.eye(7)[dow][:, 1:]] if gran == "daily" else []))
    beta, *_ = np.linalg.lstsq(X, y, rcond=None)
    resid = y - X @ beta
    rq = fallback_one(resid, H, S.season_length(gran, n))
    fdates = S.future_dates(dates[-1], H, gran)
    fdow = np.array([d.day_of_week for d in fdates]) if gran == "daily" else np.zeros(H, dtype=int)
    out = []
    for xf in futures:
        Xf = np.column_stack([np.ones(H), xf] + ([np.eye(7)[fdow][:, 1:]] if gran == "daily" else []))
        out.append((Xf @ beta)[:, None] + rq)
    ss_tot = float(np.sum((y - y.mean()) ** 2)) or 1.0
    return np.stack(out), {"slope": float(beta[1]), "r2": float(1 - np.sum(resid ** 2) / ss_tot)}


def run_scenarios(df: pd.DataFrame, kind: str, params: dict, meta: dict | None = None, progress: Progress | None = None) -> dict:
    """Forecast a KPI under several driver plans (for example spend -20%, 0, +20%) and derive cost per result.

    params: target (KPI metric), driver (spend-like metric), granularity, horizon_days, entity_type, entity,
            multipliers (list of floats) and/or budgets (list of totals for the horizon), ratio_label.
    """
    gran = params.get("granularity", "weekly")
    et, ent = params.get("entity_type", "total"), params.get("entity")
    ys, notes = S.build_series(df, kind, et, params["target"], gran, [ent] if ent else None, params.get("history_days"), 1, meta)
    xs, _ = S.build_series(df, kind, et, params["driver"], gran, [ent] if ent else None, params.get("history_days"), 1, meta)
    if not ys or not xs:
        return {"ok": False, "message": (notes or ["Target or driver series could not be built."])[0]}
    ysp, xsp = ys[0], xs[0]
    common = ysp.dates.intersection(xsp.dates)
    y = pd.Series(ysp.values, index=ysp.dates).reindex(common).to_numpy(dtype=float)
    x = pd.Series(xsp.values, index=xsp.dates).reindex(common).to_numpy(dtype=float)
    return scenarios_core(common, y, x, {**params, "granularity": gran}, notes, progress)


def scenarios_core(dates: pd.DatetimeIndex, y: np.ndarray, x: np.ndarray, params: dict, notes: list[str] | None = None, progress: Progress | None = None) -> dict:
    """Scenario engine on aligned target (y) and driver (x) series."""
    prog = progress or (lambda p, m: None)
    gran = params.get("granularity", "weekly")
    notes = list(notes or [])
    y, x = np.asarray(y, dtype=float)[-MAX_CONTEXT:], np.asarray(x, dtype=float)[-MAX_CONTEXT:]
    dates = pd.DatetimeIndex(dates)[-len(y):]
    if len(y) < 3:
        return {"ok": False, "message": "Scenarios need at least 3 periods of history."}
    H = min(S.horizon_points(int(params.get("horizon_days", 28)), gran), MAX_HORIZON)
    warnings: list[str] = list(notes)
    if len(y) < min_points(gran):
        warnings.append(f"Only {len(y)} {gran} points of history. Scenario results are indicative only.")
    cv = float(np.std(x) / np.mean(x)) if np.mean(x) > 0 else 0.0
    if cv < 0.1:
        warnings.append("The driver barely varied in the history, so its effect on the KPI cannot be learned well. Expect scenarios to look similar.")
    plans: list[tuple[str, np.ndarray]] = []
    for mlt in params.get("multipliers") or ([0.8, 1.0, 1.2] if not params.get("budgets") else []):
        label = "Current pace" if abs(mlt - 1) < 1e-9 else f"Budget {'+' if mlt > 1 else ''}{(mlt - 1) * 100:.0f}%"
        plans.append((label, _driver_future(x, H, gran, float(mlt), None)))
    for b in params.get("budgets") or []:
        plans.append((f"Budget {b:,.0f}", _driver_future(x, H, gran, 1.0, float(b))))
    prog(0.4, "Running scenarios")
    fdates = S.future_dates(dates[-1], H, gran)
    alld = dates.append(fdates)
    cal_num, cal_cat = _cov_arrays(alld, len(y), gran)
    method = "fallback"
    qs = None
    if model.load() and len(y) >= 8:
        dyn_num = {"driver": [np.concatenate([x, xf]) for _, xf in plans]}
        dyn_num.update({k: [v] * len(plans) for k, v in cal_num.items()})
        dyn_cat = {k: [v] * len(plans) for k, v in cal_cat.items()}
        qs = model.predict_covariates([y] * len(plans), H, dyn_num, dyn_cat)
        if qs is not None:
            method = "timesfm_xreg"
    slope_info = None
    if qs is None:
        qs, slope_info = _fallback_scenarios(y, x, dates, [xf for _, xf in plans], H, gran)
        warnings.append("Scenarios used a linear driver model plus seasonal smoothing because the main forecast model's driver covariates were not available.")
    qs = np.clip(np.sort(qs, axis=-1), 0, None)
    # elasticity from history for the evidence trail
    if slope_info is None and len(y) >= 6 and np.std(x) > 0:
        b = np.polyfit(x, y, 1)
        pred = np.polyval(b, x)
        ss = float(np.sum((y - y.mean()) ** 2)) or 1.0
        slope_info = {"slope": float(b[0]), "r2": float(1 - np.sum((y - pred) ** 2) / ss)}
    rows, base_row = [], None
    scale = float(params.get("ratio_scale", 1.0))
    for (label, xf), qq in zip(plans, qs):
        k10, k50, k90 = float(qq[:, 0].sum()), float(qq[:, 1].sum()), float(qq[:, 2].sum())
        spend = float(xf.sum())
        row = {"scenario": label, "driver_total": spend, "kpi_p10": k10, "kpi_p50": k50, "kpi_p90": k90,
               "ratio_p50": spend / k50 * scale if k50 > 0 else None, "ratio_best": spend / k90 * scale if k90 > 0 else None, "ratio_worst": spend / k10 * scale if k10 > 0 else None,
               "series": {"dates": [str(d.date()) for d in fdates], "driver": xf, "p10": qq[:, 0], "p50": qq[:, 1], "p90": qq[:, 2]}}
        if label == "Current pace":
            base_row = row
        rows.append(row)
    if base_row:
        for r in rows:
            dk, ds = r["kpi_p50"] - base_row["kpi_p50"], r["driver_total"] - base_row["driver_total"]
            r["incremental_kpi"] = dk
            r["marginal_ratio"] = ds / dk * scale if dk > 0 and ds > 0 else None
    hist_ratio = float(x.sum() / y.sum() * scale) if y.sum() > 0 else None
    prog(1.0, "Done")
    return jsonable({"ok": True, "method": method, "model": model.status(), "params": {**params, "granularity": gran, "horizon_points": H},
                     "history": {"dates": [str(d.date()) for d in dates], "target": y, "driver": x}, "scenarios": rows,
                     "historical_ratio": hist_ratio, "driver_effect": slope_info, "calendar_covariates": list(cal_num) + list(cal_cat), "warnings": warnings})


# =============================================================== pacing
def pacing(df: pd.DataFrame, kind: str, params: dict, meta: dict | None = None) -> dict:
    """Projected end-of-flight total for a metric against a target (budget, leads, GRPs).

    params: metric, entity_type, entity, start, end, target, tolerance_pct (default 5).
    """
    et, ent = params.get("entity_type", "total"), params.get("entity")
    specs, notes = S.build_series(df, kind, et, params["metric"], "daily", [ent] if ent else None, None, 1, meta)
    if not specs:
        return {"ok": False, "message": (notes or ["No data for pacing."])[0]}
    return pacing_core(specs[0], params, notes)


def pacing_core(sp: S.SeriesSpec, params: dict, notes: list[str] | None = None) -> dict:
    """Pacing on one daily series."""
    notes = list(notes or [])
    start, end = pd.Timestamp(params["start"]), pd.Timestamp(params["end"])
    target = float(params["target"])
    tol = float(params.get("tolerance_pct", 5))
    if end < start:
        return {"ok": False, "message": "The flight end is before its start."}
    if sp.mdef and not sp.mdef.additive:
        return {"ok": False, "message": f"Pacing needs a total-able metric such as spend, spots, leads or GRPs, not {sp.mdef.label}."}
    s = pd.Series(sp.values, index=sp.dates)
    last = s.index.max()
    to_date = float(s[(s.index >= start) & (s.index <= min(end, last))].sum())
    remaining_days = max(0, (end - max(last, start - pd.Timedelta(days=1))).days)
    elapsed = max(0, (min(last, end) - start).days + 1)
    total_days = (end - start).days + 1
    if remaining_days > 0:
        H = min(remaining_days, MAX_HORIZON)
        q, backend = model.predict([sp.values[-MAX_CONTEXT:]], H, "daily")
        qq = np.clip(np.sort(q[0, :H, :], axis=-1), 0, None)
        if H < remaining_days:   # extend flat beyond the model horizon
            qq = np.vstack([qq, np.repeat(qq[-1:], remaining_days - H, axis=0)])
            notes.append(f"The forecast covers {H} days; the rest of the flight assumes the last forecast day repeats.")
        rem = qq.sum(axis=0)
        fdates = S.future_dates(last, remaining_days, "daily")
    else:
        rem, backend, qq, fdates = np.zeros(3), "none", np.zeros((0, 3)), pd.DatetimeIndex([])
    proj = to_date + rem
    status = "On track"
    if proj[1] < target * (1 - tol / 100):
        status = "Under pacing"
    elif proj[1] > target * (1 + tol / 100):
        status = "Over pacing"
    expected_share = elapsed / total_days if total_days > 0 else 1
    need_per_day = (target - to_date) / remaining_days if remaining_days > 0 else None
    run_rate = float(s.iloc[-7:].mean()) if len(s) else 0.0
    cum = s[(s.index >= start) & (s.index <= end)].cumsum()
    return jsonable({
        "ok": True, "metric": sp.metric, "metric_label": sp.mdef.label if sp.mdef else sp.metric, "entity": sp.entity, "backend": backend,
        "start": str(start.date()), "end": str(end.date()), "last_actual": str(last.date()), "target": target,
        "actual_to_date": to_date, "pct_of_target": to_date / target * 100 if target else None, "time_elapsed_pct": expected_share * 100,
        "projected_p10": float(proj[0]), "projected_p50": float(proj[1]), "projected_p90": float(proj[2]),
        "projected_vs_target_pct": (proj[1] - target) / target * 100 if target else None, "status": status,
        "probability_note": "On track means the P50 projection is within the tolerance of the target.",
        "target_reached_in_band": bool(proj[0] <= target <= proj[2]),
        "required_per_day": need_per_day, "recent_run_rate": run_rate, "remaining_days": remaining_days,
        "cumulative": {"dates": [str(d.date()) for d in cum.index], "values": cum.to_numpy()},
        "projection": {"dates": [str(d.date()) for d in fdates], "p10": to_date + np.cumsum(qq[:, 0]) if len(qq) else [], "p50": to_date + np.cumsum(qq[:, 1]) if len(qq) else [],
                       "p90": to_date + np.cumsum(qq[:, 2]) if len(qq) else []},
        "notes": notes})


# =============================================================== cache and jobs
class ResultCache:
    def __init__(self, size: int = 128) -> None:
        self._d: OrderedDict[str, dict] = OrderedDict(); self._size = size; self._lock = threading.Lock()

    @staticmethod
    def key(version: str, kind: str, filters: dict, options: dict, params: dict) -> str:
        blob = json.dumps({"v": version, "k": kind, "f": filters, "o": options, "p": params}, sort_keys=True, default=str)
        return hashlib.sha1(blob.encode()).hexdigest()

    def get(self, k: str) -> dict | None:
        with self._lock:
            if k in self._d:
                self._d.move_to_end(k); return self._d[k]
        return None

    def put(self, k: str, v: dict) -> None:
        with self._lock:
            self._d[k] = v; self._d.move_to_end(k)
            while len(self._d) > self._size:
                self._d.popitem(last=False)

    def clear(self) -> None:
        with self._lock:
            self._d.clear()


cache = ResultCache()


class Jobs:
    """Tiny in-memory job runner so long forecasts show progress without blocking requests."""

    def __init__(self) -> None:
        self._j: dict[str, dict] = {}; self._lock = threading.Lock()

    def start(self, fn: Callable[[Progress], dict], owner: str = "") -> str:
        jid = uuid.uuid4().hex[:16]
        with self._lock:
            now = time.time()
            for k in [k for k, v in self._j.items() if now - v["t"] > 1800]:
                del self._j[k]
            self._j[jid] = {"status": "running", "progress": 0.0, "message": "Queued", "result": None, "error": None, "t": now, "owner": owner}

        def upd(p: float, m: str) -> None:
            self._j[jid].update(progress=p, message=m)

        def work() -> None:
            try:
                res = fn(upd); self._j[jid].update(status="done", result=res, progress=1.0, message="Done")
            except Exception as exc:  # noqa: BLE001
                log.exception("Forecast job failed")
                self._j[jid].update(status="error", error=str(exc) or "Forecast failed")
        threading.Thread(target=work, daemon=True).start()
        return jid

    def get(self, jid: str, owner: str = "") -> dict | None:
        j = self._j.get(jid)
        return j if j and (not j["owner"] or j["owner"] == owner) else None


jobs = Jobs()
