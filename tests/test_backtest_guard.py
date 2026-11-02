"""The incident: spend fell 80% in the last two weeks, weekends stay high, and the forecast came out as exactly zero on every weekday.

Cause: the calendar regression ("xreg + timesfm") was fitted across the old, high level, so its weekday baseline was far above reality and the
corrected forecast fell below zero and was clipped. The engine now also tries other methods and keeps the one that wins the held-out check.
"""
import numpy as np
import pandas as pd
import pytest

from app.services import forecast as F


def incident_series(n=90):
    d = pd.date_range("2026-06-01", periods=n)
    rng = np.random.default_rng(3)
    wk = (d.dayofweek >= 5).astype(float)
    y = np.where(np.arange(n) < n - 15, 6_000_000 + 2_000_000 * wk, 250_000 + 3_800_000 * wk) * rng.uniform(0.9, 1.1, n)
    return d, y


def payload(d, y, entity="A"):
    return [{"entity": entity, "group": "g", "metric": "spend", "label": "Spend", "unit": "currency", "agg": "sum", "dates": [str(x.date()) for x in d], "values": list(map(float, y))}]


class IncidentModel:
    """Plain forecast: median of the context's last 14 days, same for every future day. The two calendar methods behave like the real ones:
    'xreg + timesfm' fits a weekend regression on the WHOLE context and adds the latest residual level; 'timesfm + xreg' fits it on the plain model's residuals."""
    _tfm = object(); _failed = False; error = None; xreg_ok = True

    def __init__(self):
        self.modes = []

    @staticmethod
    def _plain(c, h):
        base = np.median(c[-14:])
        return np.stack([np.full(h, base * 0.8), np.full(h, base), np.full(h, base * 1.2)], axis=-1)

    def predict(self, contexts, horizon, gran="daily"):
        return np.stack([self._plain(np.asarray(c), horizon) for c in contexts]), "timesfm"

    def predict_covariates(self, contexts, horizon, dyn_num, dyn_cat=None, mode="xreg + timesfm"):
        self.modes.append(mode)
        out = []
        for j, c in enumerate(contexts):
            c = np.asarray(c); n = len(c)
            wk = np.asarray(dyn_num["is_weekend"][j], dtype=float)
            X = np.stack([np.ones(len(wk)), wk], 1)
            if mode == "xreg + timesfm":                              # regression on the whole context, then carry the latest residual level forward
                beta, *_ = np.linalg.lstsq(X[:n], c, rcond=None)
                mid = X[n:n + horizon] @ beta + (c - X[:n] @ beta)[-14:].mean()
            else:                                                      # plain level first, regression only on what is left over
                level = np.median(c[-14:])
                beta, *_ = np.linalg.lstsq(X[:n], c - level, rcond=None)
                mid = level + X[n:n + horizon] @ beta
            out.append(np.stack([mid * 0.8, mid, mid * 1.2], axis=-1))
        return np.stack(out)

    def status(self):
        return {"backend": "fake"}


def test_calendar_method_that_fails_the_backtest_is_not_used(monkeypatch):
    fake = IncidentModel(); monkeypatch.setattr(F, "model", fake)
    d, y = incident_series()
    specs, notes = F.specs_from_payload(payload(d, y), "daily")
    res = F.run_specs(specs, notes, "lmrb", {"horizon_days": 28, "covariates": True})
    r = res["results"][0]
    assert set(fake.modes) == {"timesfm + xreg", "xreg + timesfm"}
    f = np.array(r["forecast"]["p50"])
    assert (f > 0).all(), "weekday forecasts must never collapse to zero when recent weekdays are 250k"
    eng = r["backtest"]["engine"]
    assert eng["chosen"] in ("plain", "recent", "timesfm + xreg", "xreg + timesfm") and len(eng["mae_by_method"]) >= 3
    best_err = min(eng["mae_by_method"].values())
    assert eng["mae_by_method"][eng["label"]] == pytest.approx(best_err) or eng["chosen"] == "plain"
    assert any("Level shift" in w for w in r["warnings"])


def test_a_calendar_method_that_wins_is_chosen(monkeypatch):
    """A stable series with a real weekend effect: the calendar method gets the weekends right and plain cannot."""
    fake = IncidentModel(); monkeypatch.setattr(F, "model", fake)
    d = pd.date_range("2026-03-01", periods=120)
    rng = np.random.default_rng(5)
    y = (1_000_000 + 3_000_000 * (d.dayofweek >= 5)) * rng.uniform(0.97, 1.03, 120)
    specs, notes = F.specs_from_payload(payload(d, y), "daily")
    res = F.run_specs(specs, notes, "lmrb", {"horizon_days": 14, "covariates": True})
    eng = res["results"][0]["backtest"]["engine"]
    assert eng["chosen"] in ("timesfm + xreg", "xreg + timesfm") and res["results"][0]["backtest"]["accuracy"] > 85


def test_guard_can_be_switched_off_for_debugging(monkeypatch):
    fake = IncidentModel(); monkeypatch.setattr(F, "model", fake)
    d, y = incident_series()
    specs, notes = F.specs_from_payload(payload(d, y), "daily")
    r = F.run_specs(specs, notes, "lmrb", {"horizon_days": 28, "covariates": True, "covariate_guard": False})["results"][0]
    assert r["backtest"]["engine"]["chosen"] == "timesfm + xreg"


# ------------------------------------------------------------------ metrics
def test_accuracy_uses_wape_when_there_are_near_zero_days():
    train = np.full(28, 4_000_000.0)
    actual = np.array([160_000, 260_000, 0, 360_000, 3_215_000, 4_535_000, 39_600.0])
    pred = np.array([835_283, 1_005_460, 1_142_401, 823_749, 3_892_275, 3_952_921, 663_033.0])
    acc, basis = F.accuracy(actual, pred, train)
    assert basis == "WAPE" and 40 < acc < 45 and F.smape(actual, pred) > 100          # the incident sheet: sMAPE 106, WAPE 57
    steady = np.array([100.0, 110, 95, 105, 100, 98, 102])
    acc2, basis2 = F.accuracy(steady, steady * 1.05, np.full(28, 100.0))
    assert basis2 == "sMAPE" and 90 < acc2 < 100


def test_reliability_trusts_mase_over_a_smape_inflated_by_zero_days():
    bt = {"model": {"smape": 106.0, "mase": 0.3, "mae": 100.0}, "baseline": {"mae": 300.0}, "accuracy": 43.0, "accuracy_basis": "WAPE"}
    out = F.reliability(90, 90, "daily", bt, False)
    assert out["level"] != "Low" or "WAPE" in " ".join(out["reasons"])
    bad = {"model": {"smape": 90.0, "mase": 1.6, "mae": 400.0}, "baseline": {"mae": 300.0}, "accuracy": 30.0, "accuracy_basis": "WAPE"}
    assert F.reliability(90, 90, "daily", bad, False)["level"] == "Low"


def test_incomplete_last_day_is_left_out():
    d = pd.date_range("2026-08-01", periods=31)
    y = np.full(31, 250_000.0); y[-1] = 39_600.0
    specs, notes = F.specs_from_payload(payload(d, y), "daily")
    assert len(specs[0].values) == 30 and any("looks incomplete" in n for n in notes)
    y2 = y.copy(); y2[-1] = 240_000.0
    specs2, notes2 = F.specs_from_payload(payload(d, y2), "daily")
    assert len(specs2[0].values) == 31 and not notes2


def test_level_shift_message():
    y = np.r_[np.full(40, 6e6), np.full(14, 1e6)]
    assert "Level shift" in F.level_shift(y, "daily") and F.level_shift(np.full(60, 5.0), "daily") is None
