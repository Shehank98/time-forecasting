"""Forecasting service: TimesFM 2.0 (batched, quantiles, covariates) with a statistical fallback.

The model is loaded once and cached. If it cannot be loaded, a seasonal naive plus
exponential smoothing model takes over and the UI shows a banner. The service
never raises on model problems.
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
from .util import jsonable

log = logging.getLogger(__name__)

CHECKPOINT = os.environ.get("TIMESFM_REPO", "google/timesfm-2.0-500m-pytorch")
CONTEXT_LEN = 2048
HORIZON_LEN = 128
Q_IDX = {"p10": 1, "p50": 5, "p90": 9}   # TimesFM output is [mean, q0.1 ... q0.9]
Progress = Callable[[float, str], None]


# =============================================================== model wrapper
class ModelService:
    """Lazy, thread-safe holder for the TimesFM model."""

    def __init__(self) -> None:
        self._tfm: Any = None
        self._lock = threading.Lock()
        self._loaded = False
        self._failed = False
        self.error: str | None = None
        self.load_seconds: float | None = None
        self.xreg_ok: bool | None = None

    def status(self) -> dict:
        backend = "timesfm" if self._tfm is not None else ("fallback" if self._failed else "pending")
        return {"backend": backend, "loaded": self._tfm is not None, "error": self.error, "checkpoint": CHECKPOINT,
                "load_seconds": self.load_seconds, "covariates_supported": self.xreg_ok,
                "note": "Fallback statistical model in use." if self._failed else ("TimesFM loads on first forecast." if self._tfm is None else "")}

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
                import timesfm  # type: ignore

                cls = timesfm.TimesFm
                if "Torch" not in cls.__name__:   # timesfm prefers the JAX class when jax is installed; we want PyTorch on CPU
                    from timesfm.timesfm_torch import TimesFmTorch as cls  # type: ignore
                tfm = cls(
                    hparams=timesfm.TimesFmHparams(backend="cpu", per_core_batch_size=32, horizon_len=HORIZON_LEN, num_layers=50,
                                                   use_positional_embedding=False, context_len=CONTEXT_LEN),
                    checkpoint=timesfm.TimesFmCheckpoint(huggingface_repo_id=CHECKPOINT))
                tfm.forecast([np.sin(np.arange(64) / 4.0).astype(np.float32)], freq=[0])   # warm-up
                self._tfm = tfm
                self.load_seconds = round(time.time() - t0, 1)
                cache.clear()
                log.info("TimesFM loaded in %.1fs", self.load_seconds)
                return True
            except Exception as exc:  # noqa: BLE001 - any failure must degrade gracefully
                self._failed, self.error = True, f"{type(exc).__name__}: {exc}"[:300]
                log.error("TimesFM unavailable, using fallback: %s", self.error)
                return False

    # ---- batched inference
    def predict(self, contexts: list[np.ndarray], freqs: list[int], horizon: int) -> tuple[np.ndarray, np.ndarray, str]:
        """Return (mean[N,H], quantiles[N,H,3 for p10,p50,p90], backend). One batched call for all series."""
        if self.load():
            try:
                mean, full = self._tfm.forecast([c.astype(np.float32) for c in contexts], freq=freqs)
                mean, full = np.asarray(mean)[:, :horizon], np.asarray(full)[:, :horizon, :]
                q = np.stack([full[:, :, Q_IDX["p10"]], full[:, :, Q_IDX["p50"]], full[:, :, Q_IDX["p90"]]], axis=-1)
                return mean, q, "timesfm"
            except Exception as exc:  # noqa: BLE001
                self._tfm, self._failed, self.error = None, True, f"Inference failed: {exc}"[:300]
                log.exception("TimesFM inference failed, switching to fallback")
        return (*fallback_batch(contexts, freqs, horizon), "fallback")

    def predict_covariates(self, contexts: list[np.ndarray], freqs: list[int], horizon: int, dyn_num: dict[str, list[np.ndarray]],
                           dyn_cat: dict[str, list[np.ndarray]]) -> np.ndarray | None:
        """Covariate adjusted point forecasts via XReg, or None when unsupported."""
        if self._tfm is None:
            return None
        try:
            new, _ = self._tfm.forecast_with_covariates(
                [c.astype(np.float32) for c in contexts], dynamic_numerical_covariates=dyn_num or None,
                dynamic_categorical_covariates=dyn_cat or None, freq=freqs, xreg_mode="xreg + timesfm", ridge=1.0, normalize_xreg_target_per_input=True)
            self.xreg_ok = True
            return np.stack([np.asarray(x)[:horizon] for x in new])
        except Exception as exc:  # noqa: BLE001 - jax missing, shape mismatch, etc.
            self.xreg_ok = False
            log.warning("Covariates unavailable (%s); using plain forecast", exc)
            return None


model = ModelService()


# =============================================================== statistical fallback
def _ses(y: np.ndarray) -> tuple[float, float]:
    """Simple exponential smoothing with alpha chosen by grid search. Returns (level, residual std)."""
    best = (np.inf, 0.3, y[0], 0.0)
    for a in (0.1, 0.2, 0.3, 0.5, 0.7, 0.9):
        lvl, sse, res = y[0], 0.0, []
        for v in y[1:]:
            e = v - lvl
            res.append(e); sse += e * e; lvl = lvl + a * e
        if sse < best[0]:
            best = (sse, a, lvl, float(np.std(res)) if res else 0.0)
    return best[2], best[3]


def fallback_one(y: np.ndarray, horizon: int, season: int) -> tuple[np.ndarray, np.ndarray]:
    """Seasonal naive blended with exponential smoothing. Returns (mean[H], q[H,3])."""
    y = np.asarray(y, dtype=float)
    n = len(y)
    if n == 0:
        return np.zeros(horizon), np.zeros((horizon, 3))
    if n < 3 or not np.isfinite(y).all():
        m = float(np.nanmean(y)) if n else 0.0
        mean = np.full(horizon, m); sd = float(np.nanstd(y)) if n > 1 else abs(m) * 0.3
        h = np.arange(1, horizon + 1)
        return mean, np.stack([mean - 1.28 * sd, mean, mean + 1.28 * sd], axis=-1)
    use_season = season > 1 and n >= 2 * season
    if use_season:
        idx = np.arange(n) % season
        seas = np.array([y[idx == k].mean() for k in range(season)]) - y.mean()
        deseason = y - seas[idx]
    else:
        seas, deseason = np.zeros(1), y
    level, sd = _ses(deseason)
    h = np.arange(1, horizon + 1)
    mean = np.full(horizon, level)
    if use_season:
        mean = mean + seas[(n + h - 1) % season]
        naive = np.array([y[n - season + ((k) % season)] for k in range(horizon)])
        mean = 0.7 * mean + 0.3 * naive
    sd = max(sd, 1e-9) * np.sqrt(1 + 0.15 * (h - 1))
    return mean, np.stack([mean - 1.28 * sd, mean, mean + 1.28 * sd], axis=-1)


def fallback_batch(contexts: list[np.ndarray], freqs: list[int], horizon: int) -> tuple[np.ndarray, np.ndarray]:
    means, qs = [], []
    for c, f in zip(contexts, freqs):
        m, q = fallback_one(c, horizon, 7 if f == 0 else 1)
        means.append(m); qs.append(q)
    return np.stack(means), np.stack(qs)


# =============================================================== metrics
def smape(a: np.ndarray, f: np.ndarray) -> float | None:
    den = np.abs(a) + np.abs(f)
    ok = den > 0
    return float(np.mean(2 * np.abs(a - f)[ok] / den[ok]) * 100) if ok.any() else 0.0 if len(a) else None


def mae(a: np.ndarray, f: np.ndarray) -> float:
    return float(np.mean(np.abs(a - f)))


def mase(a: np.ndarray, f: np.ndarray, train: np.ndarray, m: int) -> float | None:
    if len(train) <= m:
        return None
    scale = float(np.mean(np.abs(train[m:] - train[:-m])))
    return mae(a, f) / scale if scale > 0 else None


def seasonal_naive(train: np.ndarray, horizon: int, m: int) -> np.ndarray:
    m = m if len(train) >= m else 1
    return np.array([train[len(train) - m + (k % m)] for k in range(horizon)])


# =============================================================== anomaly / change point
def detect_anomalies(dates: pd.DatetimeIndex, y: np.ndarray, gran: str, z_thr: float = 3.0) -> list[dict]:
    """Robust rolling z-score against the median and MAD of the previous window."""
    w = 7 if gran == "daily" else 4
    out = []
    for i in range(w, len(y)):
        win = y[i - w:i]
        med = np.median(win)
        mad = np.median(np.abs(win - med)) * 1.4826
        scale = mad if mad > 0 else (np.std(win) if np.std(win) > 0 else 0)
        if scale == 0:
            continue
        z = (y[i] - med) / scale
        if abs(z) >= z_thr:
            out.append({"date": str(dates[i].date()), "value": float(y[i]), "z": float(z), "direction": "spike" if z > 0 else "drop"})
    return out[:30]


def detect_change_points(dates: pd.DatetimeIndex, y: np.ndarray, min_seg: int = 5, t_thr: float = 4.0, max_cp: int = 3) -> list[dict]:
    """Binary segmentation on mean shifts with a Welch t statistic and a 25% effect size floor."""
    found: list[dict] = []
    y = np.clip(y, np.percentile(y, 5), np.percentile(y, 95))   # winsorize so one spike cannot masquerade as a level shift

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
        base = max(abs(before), abs(after), 1e-9)
        if abs(after - before) / base < 0.25:
            return
        found.append({"date": str(dates[bi].date()), "before": float(before), "after": float(after), "change_pct": float((after - before) / abs(before) * 100) if before else None, "t": float(best)})
        split(lo, bi, depth + 1); split(bi, hi, depth + 1)

    split(0, len(y), 0)
    return sorted(found, key=lambda d: d["date"])


# =============================================================== outlook
def outlook(spec: S.SeriesSpec, fdates: pd.DatetimeIndex, p10: np.ndarray, p50: np.ndarray, p90: np.ndarray) -> dict:
    """Competitor outlook: next 4 weeks, trend, active weeks and expected burst windows."""
    additive = spec.metric in S.ADDITIVE
    y, per_week = spec.values, 7 if spec.gran == "daily" else 1
    hist_w = pd.Series(y, index=spec.dates).resample("W-SUN").sum() if spec.gran == "daily" else pd.Series(y, index=spec.dates)
    if spec.gran == "daily" and len(hist_w) > 2:
        hist_w = hist_w.iloc[1:-1] if len(hist_w) > 4 else hist_w
    n_weeks = min(4, len(p50) // per_week)
    k = n_weeks * per_week
    out: dict[str, Any] = {"weeks": [], "n_weeks": n_weeks}
    recent = y[-max(k, per_week):] if len(y) else y
    base = float(np.mean(recent)) if len(recent) else 0.0
    fut = float(np.mean(p50[:max(k, per_week)])) if len(p50) else 0.0
    change = (fut - base) / abs(base) * 100 if base else None
    out["trend"] = "stable" if change is None or abs(change) < 10 else ("rising" if change > 0 else "falling")
    out["trend_change_pct"] = change
    out["expected_next_4w"] = float(np.sum(p50[:k])) if additive and k else None
    out["expected_next_4w_p10"] = float(np.sum(p10[:k])) if additive and k else None
    out["expected_next_4w_p90"] = float(np.sum(p90[:k])) if additive and k else None
    out["avg_next_4w"] = float(np.mean(p50[:k])) if not additive and k else None
    out["range_note"] = "Sums of daily P10 and P90 are indicative bounds, not exact quantiles of the total."
    hv = hist_w.to_numpy(dtype=float)
    act = hv[hv > 0]
    med_act = float(np.median(act)) if len(act) else 0.0
    mean_w, std_w = (float(hv.mean()), float(hv.std())) if len(hv) else (0.0, 0.0)
    for i in range(n_weeks):
        sl = slice(i * per_week, (i + 1) * per_week)
        v = float(np.sum(p50[sl])) if additive else float(np.mean(p50[sl]))
        w = {"week_start": str(fdates[sl][0].date()), "expected": v, "p10": float(np.sum(p10[sl]) if additive else np.mean(p10[sl])), "p90": float(np.sum(p90[sl]) if additive else np.mean(p90[sl]))}
        if additive:
            w["status"] = "active" if med_act > 0 and v >= 0.15 * med_act else "inactive"
            w["burst"] = bool(w["status"] == "active" and v >= mean_w + std_w and v >= 1.25 * (float(np.mean(act)) if len(act) else v))
        out["weeks"].append(w)
    out["active_weeks"] = sum(1 for w in out["weeks"] if w.get("status") == "active")
    out["inactive_weeks"] = sum(1 for w in out["weeks"] if w.get("status") == "inactive")
    out["burst_windows"] = [w["week_start"] for w in out["weeks"] if w.get("burst")]
    out["history_weeks"] = int(len(hv))
    return out


# =============================================================== reliability
def reliability(n_points: int, n_observed: int, gran: str, bt: dict | None, all_zero: bool) -> dict:
    min_pts = nz.min_points()[gran]
    reasons: list[str] = []
    if all_zero:
        return {"level": "Low", "reasons": ["The series is all zeros, so there is nothing to learn from."]}
    level = "High"
    n = min(n_points, n_observed) if n_observed else n_points
    if n < min_pts:
        level = "Low"; reasons.append(f"Only {n} {gran} points of history (minimum {min_pts}).")
    if bt is None:
        level = "Low"; reasons.append("History is too short for a backtest, so accuracy is unknown.")
    else:
        m, s, base = bt["model"], bt["model"].get("smape"), bt["baseline"]
        beats = m["mae"] <= base["mae"]
        if m.get("mase") is not None and m["mase"] >= 1.2 or (s is not None and s > 60):
            level = "Low"; reasons.append(f"Backtest error is high (sMAPE {s:.0f}%, MASE {m['mase'] if m['mase'] is None else round(m['mase'], 2)}).")
        elif not (m.get("mase") is not None and m["mase"] < 0.8 and (s is None or s < 30) and beats and n >= 2 * min_pts):
            if level == "High":
                level = "Medium"
            reasons.append("Backtest is acceptable but not strong enough for High." if beats else "The model did not beat the seasonal naive baseline.")
        if not beats and level != "Low":
            level = "Medium"
    if not reasons:
        reasons.append("Long enough history and a backtest that beats the seasonal naive baseline.")
    return {"level": level, "reasons": reasons}


# =============================================================== orchestration
def _cov_arrays(spec: S.SeriesSpec, fdates: pd.DatetimeIndex, gran: str) -> tuple[dict, dict, list[str]]:
    """Per-series covariate arrays covering context plus horizon."""
    alld = spec.dates.append(fdates)
    feats = S.calendar_features(alld, gran)
    num, cat, used = {}, {}, []
    for k, v in feats.items():
        if np.ptp(v) > 0 and np.ptp(v[:len(spec.dates)]) > 0:
            num[k] = v; used.append(k)
    if gran == "daily":
        cat["day_of_week"] = np.array([d.dayofweek for d in alld]); used.append("day_of_week")
        cat["is_weekend"] = np.array([int(d.dayofweek >= 5) for d in alld]); used.append("is_weekend")
    return num, cat, used


def run(df: pd.DataFrame, kind: str, params: dict, progress: Progress | None = None) -> dict:
    """Run a batched forecast for all selected entities and return a JSON-safe result."""
    prog = progress or (lambda p, m: None)
    gran = params.get("granularity", "weekly")
    metric = params["metric"]
    horizon_days = int(params.get("horizon_days", 28))
    prog(0.05, "Preparing series")
    specs, notes = S.build_series(df, kind, params.get("entity_type", "total"), metric, gran, params.get("entities") or None,
                                  params.get("history_days") or None, int(params.get("max_entities", 8)))
    gran = specs[0].gran if specs else gran
    if not specs:
        return {"ok": False, "message": notes[0] if notes else "No series could be built.", "notes": notes}
    H = S.horizon_points(horizon_days, gran)
    if H > HORIZON_LEN:
        H = HORIZON_LEN; notes.append(f"Horizon limited to {HORIZON_LEN} points.")
    freq = S.FREQ_FLAG[gran]
    min_pts = nz.min_points()[gran]
    default_hold = 7 if gran == "daily" else 2
    contexts, ctx_info = [], []
    for sp in specs:
        y = sp.values[-CONTEXT_LEN:]
        n_hold = int(params.get("holdout") or default_hold)
        n_hold = min(n_hold, len(y) // 3)
        contexts.append(y)
        ctx_info.append(n_hold if n_hold >= 2 and len(y) - n_hold >= 4 else 0)
    # one batched call: full contexts first, then truncated contexts for backtests
    bt_idx = [i for i, h in enumerate(ctx_info) if h]
    batch = contexts + [contexts[i][:-ctx_info[i]] for i in bt_idx]
    freqs = [freq] * len(batch)
    horizon_all = max([H] + [ctx_info[i] for i in bt_idx])
    prog(0.2, f"Loading model" if model._tfm is None and not model._failed else "Running forecast")
    mean, q, backend = model.predict(batch, freqs, horizon_all)
    prog(0.7, "Post-processing")
    cov_used: list[str] = []
    cov_msg = None
    final_mean = mean[:len(specs), :H]
    use_cov = bool(params.get("covariates", True))
    if use_cov and backend == "timesfm":
        min_cov = 28 if gran == "daily" else 12
        elig = [i for i, sp in enumerate(specs) if len(sp.values) >= min_cov]
        if elig:
            fds = {i: S.future_dates(specs[i].dates[-1], H, gran) for i in elig}
            arrs = {i: _cov_arrays(specs[i], fds[i], gran) for i in elig}
            names_num = sorted(set.intersection(*[set(arrs[i][0]) for i in elig])) if elig else []
            names_cat = sorted(set.intersection(*[set(arrs[i][1]) for i in elig])) if elig else []
            if names_num or names_cat:
                adj = model.predict_covariates([contexts[i] for i in elig], [freq] * len(elig), H,
                                               {n: [arrs[i][0][n] for i in elig] for n in names_num}, {n: [arrs[i][1][n] for i in elig] for n in names_cat})
                if adj is not None:
                    cov_used = names_num + names_cat
                    for j, i in enumerate(elig):
                        shift = adj[j] - final_mean[i]
                        q[i, :H, :] = q[i, :H, :] + shift[:, None]
                        final_mean[i] = adj[j]
                else:
                    cov_msg = "Covariates could not be applied by this environment, so the plain forecast is shown."
            else:
                cov_msg = "No calendar event or weekday varies across the history, so covariates were skipped."
        else:
            cov_msg = f"Covariates need at least {min_cov} {gran} points; skipped for thin history."
    results = []
    bt_pos = {i: len(specs) + k for k, i in enumerate(bt_idx)}
    for i, sp in enumerate(specs):
        prog(0.7 + 0.25 * (i + 1) / len(specs), f"Analysing {sp.entity}")
        y = sp.values
        nonneg = sp.metric in S.NONNEG
        fd = S.future_dates(sp.dates[-1], H, gran)
        qq = np.sort(q[i, :H, :], axis=-1)
        if nonneg:
            qq = np.clip(qq, 0, None)
        p10, p50, p90 = qq[:, 0], np.clip(final_mean[i], 0, None) if nonneg else final_mean[i], qq[:, 2]
        p50 = np.clip(p50, p10, p90) if len(p50) else p50
        bt = None
        warnings = list(sp.notes)
        if i in bt_pos:
            h = ctx_info[i]; k = bt_pos[i]; train, actual = contexts[i][:-h], contexts[i][-h:]
            pred = mean[k, :h]; bq = np.sort(q[k, :h, :], axis=-1)
            if nonneg:
                pred, bq = np.clip(pred, 0, None), np.clip(bq, 0, None)
            m = 7 if gran == "daily" and len(train) >= 14 else 1
            base = seasonal_naive(train, h, 7 if gran == "daily" else 1)
            bt = {"dates": [str(d.date()) for d in sp.dates[-h:]], "actual": actual, "pred": pred, "p10": bq[:, 0], "p90": bq[:, 2], "holdout": h,
                  "model": {"smape": smape(actual, pred), "mae": mae(actual, pred), "mase": mase(actual, pred, train, m)},
                  "baseline": {"smape": smape(actual, base), "mae": mae(actual, base), "mase": mase(actual, base, train, m), "name": "Seasonal naive"}}
        all_zero = not np.any(y)
        rel = reliability(len(y), sp.n_observed, gran, bt, all_zero)
        if len(y) < min_pts:
            warnings.append(f"Thin history: {len(y)} {gran} points, below the minimum of {min_pts}. The forecast still ran but is marked Low reliability.")
        if all_zero:
            warnings.append("All values are zero. The forecast is flat zero.")
        hist_dates = [str(d.date()) for d in sp.dates]
        results.append({
            "entity": sp.entity, "metric": sp.metric, "granularity": gran, "n_points": int(len(y)), "n_active": sp.n_active,
            "history": {"dates": hist_dates, "values": y}, "forecast": {"dates": [str(d.date()) for d in fd], "p10": p10, "p50": p50, "p90": p90},
            "backtest": bt, "reliability": rel, "anomalies": detect_anomalies(sp.dates, y, gran), "change_points": detect_change_points(sp.dates, y) if len(y) >= 12 else [],
            "outlook": outlook(sp, fd, p10, p50, p90), "warnings": warnings})
    prog(1.0, "Done")
    return jsonable({"ok": True, "kind": kind, "params": {**params, "granularity": gran, "horizon_points": H}, "backend": backend,
                     "model": model.status(), "frequency_flag": freq, "covariates_used": cov_used, "covariate_note": cov_msg, "notes": notes, "results": results})


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

    def start(self, fn: Callable[[Progress], dict]) -> str:
        jid = uuid.uuid4().hex[:12]
        with self._lock:
            now = time.time()
            for k in [k for k, v in self._j.items() if now - v["t"] > 1800]:
                del self._j[k]
            self._j[jid] = {"status": "running", "progress": 0.0, "message": "Queued", "result": None, "error": None, "t": now}

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

    def get(self, jid: str) -> dict | None:
        return self._j.get(jid)


jobs = Jobs()
