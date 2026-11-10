"""Audit the forecast engine against series whose future is known.

    python scripts/forecast_audit.py                       # the main model (needs the weights: TIMESFM_LOCAL_DIR or the Hugging Face cache)
    FORCE_FALLBACK=1 python scripts/forecast_audit.py       # the statistical fallback
    python scripts/forecast_audit.py --json out.json        # keep the per-series numbers

Every series is media-shaped (ratings with a weekday pattern, spend with a trend, campaign bursts, a level change, pure noise, weekly and
monthly series). The engine sees only the history; the last `horizon` points are kept back and compared with what it forecast. The same
points are also forecast by a seasonal naive baseline (the same weekday last week, the same month last year), so "better than a simple rule"
is measured, not claimed. The script goes through the production path (specs_from_payload -> run_specs), so the method choice, the calendar
covariates and the reported accuracy are all the ones the app uses.

Reported per family:
  WAPE         total absolute error / total actual, of the P50 forecast on the kept-back points (lower is better)
  naive WAPE   the same for the seasonal naive baseline
  wins         in how many series the engine beat the baseline
  coverage     share of kept-back points inside the P10 to P90 band (about 80% is right)
  told / true  the accuracy the app shows the planner (from its own backtest) against the accuracy it really had on the kept-back points
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.services import forecast as fc  # noqa: E402
from app.services import series as S  # noqa: E402

WEEK = np.array([0.92, 0.95, 0.97, 1.0, 1.04, 1.12, 1.15])      # Mon..Sun: weekends higher, as TV ratings are


def families(seed: int) -> dict[str, tuple[str, np.ndarray, int]]:
    """name -> (granularity, values, horizon points). The last `horizon` values are the kept-back truth."""
    r = np.random.default_rng(seed)
    n, t = 208, np.arange(208)
    dow = WEEK[t % 7]
    out: dict[str, tuple[str, np.ndarray, int]] = {}
    out["Programme rating, weekday pattern"] = ("daily", np.clip((4.0 + r.uniform(0, 4)) * dow + r.normal(0, 0.35, n), 0, None), 28)
    out["Spend with a rising trend"] = ("daily", np.clip(1e6 * (1 + 0.003 * t) * dow * r.lognormal(0, 0.12, n), 0, None), 28)
    on = ((t + r.integers(0, 35)) % 35) < 21                                          # three weeks on air, two weeks off
    out["Campaign bursts (on and off)"] = ("daily", np.where(on, 8e5 * dow * r.lognormal(0, 0.15, n), 0.0), 28)
    out["Level change two months ago"] = ("daily", np.clip((5.0 * np.where(t >= 120, 1.4, 1.0)) * dow + r.normal(0, 0.4, n), 0, None), 28)
    out["Pure noise around a level"] = ("daily", np.clip(100 + r.normal(0, 20, n), 0, None), 28)
    w = np.arange(130)
    out["Weekly series with a yearly cycle"] = ("weekly", np.clip(50 + 12 * np.sin(2 * np.pi * w / 52) + 0.05 * w + r.normal(0, 3, 130), 0, None), 8)
    m = np.arange(48)
    out["Monthly series with a yearly cycle"] = ("monthly", np.clip(200 + 40 * np.sin(2 * np.pi * (m + r.integers(0, 12)) / 12) + 1.5 * m + r.normal(0, 10, 48), 0, None), 6)
    return out


def wape(a: np.ndarray, f: np.ndarray) -> float | None:
    t = float(np.abs(a).sum())
    return float(np.abs(a - f).sum() / t * 100) if t > 0 else None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds", type=int, default=8)
    ap.add_argument("--json", default=None)
    a = ap.parse_args()
    rows, backend, t0 = [], None, time.time()
    by_gran: dict[str, list[tuple[str, int, np.ndarray, int]]] = {}
    for seed in range(a.seeds):
        for name, (gran, y, h) in families(seed).items():
            by_gran.setdefault(gran, []).append((name, seed, y, h))
    for gran, items in by_gran.items():
        h = items[0][3]
        start = pd.Timestamp("2025-01-06")                                             # a Monday, so the weekday pattern lines up with the calendar
        payload = []
        for name, seed, y, _ in items:
            hist = y[:-h]
            dates = pd.date_range(start, periods=len(hist), freq=S.STEP[gran])
            payload.append({"entity": f"{name} #{seed}", "group": name, "metric": "value", "agg": "mean", "zero_fill": True, "dates": [str(d.date()) for d in dates], "values": [float(v) for v in hist]})
        specs, notes = fc.specs_from_payload(payload, gran)
        res = fc.run_specs(specs, notes, "audit", {"horizon_days": h * S.DAYS_PER[gran]})
        assert res["ok"], res
        backend = res["backend"]
        for (name, seed, y, _), r in zip(items, res["results"]):
            truth, hist = y[-h:], y[:-h]
            p50, p10, p90 = (np.array(r["forecast"][k][:h], dtype=float) for k in ("p50", "p10", "p90"))
            naive = fc.seasonal_naive(hist, h, S.season_length(gran, len(hist)))
            bt = r.get("backtest") or {}
            w = wape(truth, p50)
            rows.append({"family": name, "seed": seed, "gran": gran, "wape": w, "naive_wape": wape(truth, naive), "coverage": float(np.mean((truth >= p10) & (truth <= p90)) * 100),
                         "told_accuracy": bt.get("accuracy_planning") if bt.get("accuracy_planning") is not None else bt.get("accuracy"), "true_accuracy": None if w is None else max(0.0, 100 - w),
                         "true_weekly_accuracy": (max(0.0, 100 - wape(truth[: (h // 7) * 7].reshape(-1, 7).sum(1), p50[: (h // 7) * 7].reshape(-1, 7).sum(1))) if gran == "daily" else None),
                         "method": (bt.get("engine") or {}).get("label"), "reliability": (r.get("reliability") or {}).get("level")})
    df = pd.DataFrame(rows)
    print(f"\nForecast audit. Backend: {'main model' if backend == 'timesfm' else 'statistical fallback'}. {len(df)} series, {time.time() - t0:.1f}s.\n")
    print(f"{'Family':40s} {'WAPE':>7s} {'naive':>7s} {'wins':>6s} {'cover':>6s} {'told':>6s} {'true':>6s}")
    for fam, g in df.groupby("family", sort=False):
        true_acc = g["true_weekly_accuracy"].mean() if g["gran"].iloc[0] == "daily" else g["true_accuracy"].mean()
        print(f"{fam:40s} {g['wape'].mean():7.1f} {g['naive_wape'].mean():7.1f} {int((g['wape'] < g['naive_wape']).sum()):3d}/{len(g):<2d} {g['coverage'].mean():6.0f} {g['told_accuracy'].mean():6.1f} {true_acc:6.1f}")
    true_all = np.where(df["gran"] == "daily", df["true_weekly_accuracy"], df["true_accuracy"]).astype(float)
    print(f"\n{'ALL':40s} {df['wape'].mean():7.1f} {df['naive_wape'].mean():7.1f} {int((df['wape'] < df['naive_wape']).sum()):3d}/{len(df):<2d} {df['coverage'].mean():6.0f} {df['told_accuracy'].mean():6.1f} {np.nanmean(true_all):6.1f}")
    print("\nMethods chosen:", df["method"].value_counts().to_dict())
    if a.json:
        Path(a.json).write_text(json.dumps({"backend": backend, "rows": rows}, indent=1))


if __name__ == "__main__":
    main()
