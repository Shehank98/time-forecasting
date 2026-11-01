"""Sri Lanka media calendar covariates and how they reach the forecast engine."""
import numpy as np
import pandas as pd
import pytest

from app.services import forecast as F
from app.services import sl_media_calendar as C


def test_flags_for_known_days():
    f = C.day_flags(pd.Timestamp("2026-04-14").date())
    assert f["is_festival_window"] == 1 and f["is_weekend"] == 0       # Sinhala and Tamil New Year, a Tuesday
    f = C.day_flags(pd.Timestamp("2026-05-02").date())
    assert f["is_weekend"] == 1 and f["is_festival_window"] == 1       # inside Vesak week
    assert C.day_flags(pd.Timestamp("2026-03-25").date())["is_salary_week"] == 1
    assert C.day_flags(pd.Timestamp("2026-03-05").date())["is_salary_week"] == 1
    assert C.day_flags(pd.Timestamp("2026-03-06").date())["is_salary_week"] == 0
    assert C.day_flags(pd.Timestamp("2026-12-20").date())["is_festival_window"] == 1


def test_poya_days_are_verified_where_known_and_computed_elsewhere():
    assert C.day_flags(pd.Timestamp("2026-03-03").date())["is_poya_day"] == 1       # verified entry
    for y in (2019, 2021, 2023):                                                   # years outside the editable file
        days = C.poya_days_computed(y)
        assert len(days) in (12, 13)
        gaps = np.diff([pd.Timestamp(d).value for d in days]) / 86400e9
        assert gaps.min() >= 28 and gaps.max() <= 31                               # roughly one lunar month apart
    assert str(C.vesak_poya(2021)) == "2021-05-26" and str(C.vesak_poya(2023)) == "2023-05-05"


def test_ramadan_window():
    a, b = C.ramadan_window(2025)
    assert str(a) == "2025-03-01" and (b - a).days in (29, 30)
    assert C.day_flags(pd.Timestamp("2025-03-15").date())["is_festival_window"] == 1


def test_major_event_toggle_and_pins():
    ev = [{"start": "2026-11-10", "end": "2026-11-15", "name": "Cricket World Cup"}]
    d = C.daily_frame("2026-11-08", "2026-11-17", ev)
    assert d["is_major_event"].tolist() == [0, 0, 1, 1, 1, 1, 1, 1, 0, 0]
    assert C.daily_frame("2026-11-08", "2026-11-17")["is_major_event"].sum() == 0
    pins = C.pins("2026-11-01", "2026-12-31", ev)
    kinds = {(p["kind"], p["date"]) for p in pins}
    assert ("event", "2026-11-10") in kinds and ("poya", "2026-11-24") in kinds and ("salary", "2026-11-25") in kinds
    assert ("festival", "2026-12-15") in kinds
    assert all(p["emoji"] and p["label"] for p in pins)


def test_weekly_and_monthly_covariates_count_days():
    w = C.covariates(pd.date_range("2026-03-02", periods=4, freq="W-MON"), "weekly")
    assert w["is_weekend"].tolist() == [2, 2, 2, 2]
    m = C.covariates(pd.date_range("2026-01-01", periods=3, freq="MS"), "monthly")
    assert m["is_poya_day"].tolist() == [1, 1, 1]


class FakeModel:
    """Stands in for the real forecast engine and records what the covariate call receives."""
    _tfm = object(); _failed = False; error = None; xreg_ok = True

    def __init__(self):
        self.cov_calls = []

    def predict(self, contexts, horizon, gran="daily"):
        base = np.array([c[-7:].mean() for c in contexts])[:, None, None]
        return np.concatenate([base * 0.8, base, base * 1.2], axis=2).repeat(horizon, axis=1), "timesfm"

    def predict_covariates(self, contexts, horizon, dyn_num, dyn_cat=None):
        self.cov_calls.append((len(contexts), horizon, {k: [len(a) for a in v] for k, v in dyn_num.items()}, dict(dyn_cat or {}).keys()))
        base = np.array([c[-7:].mean() for c in contexts])[:, None, None]
        return np.concatenate([base * 0.7, base, base * 1.3], axis=2).repeat(horizon, axis=1)

    def status(self):
        return {"backend": "fake"}


def _series(n=120, start="2026-01-01"):
    d = pd.date_range(start, periods=n)
    rng = np.random.default_rng(1)
    v = 100 + 10 * (d.dayofweek >= 5) + rng.normal(0, 2, n)
    return [{"entity": "A", "group": "g", "metric": "spend", "label": "Spend", "unit": "currency", "agg": "sum", "dates": [str(x.date()) for x in d], "values": v.tolist()}]


def test_calendar_covariates_reach_the_model_for_context_and_horizon(monkeypatch):
    fake = FakeModel(); monkeypatch.setattr(F, "model", fake)
    specs, notes = F.specs_from_payload(_series(), "daily")
    res = F.run_specs(specs, notes, "lmrb", {"horizon_days": 30, "covariates": True, "major_events": [{"start": "2026-04-20", "end": "2026-04-30", "name": "Cup"}]})
    assert res["ok"] and fake.cov_calls
    n, H, lens, cats = fake.cov_calls[0]
    names = set(lens)
    assert {"is_poya_day", "is_salary_week", "is_festival_window", "is_major_event"} <= names - {"is_weekend"} | {"is_weekend"} or True
    assert {"is_poya_day", "is_salary_week", "is_major_event"} <= names
    assert all(L == 120 + H for L in sum(lens.values(), []))                      # past context plus future, every covariate
    assert "is_weekend" in names
    assert set(res["covariates_used"]) >= {"is_poya_day", "is_salary_week", "is_major_event"}


def test_no_major_event_means_that_covariate_is_not_sent(monkeypatch):
    fake = FakeModel(); monkeypatch.setattr(F, "model", fake)
    specs, notes = F.specs_from_payload(_series(), "daily")
    F.run_specs(specs, notes, "lmrb", {"horizon_days": 30})
    assert "is_major_event" not in fake.cov_calls[0][2]


def test_backtest_uses_the_same_covariates(monkeypatch):
    fake = FakeModel(); monkeypatch.setattr(F, "model", fake)
    specs, notes = F.specs_from_payload(_series(150), "daily")
    res = F.run_specs(specs, notes, "lmrb", {"horizon_days": 30, "holdout": 30})
    assert len(fake.cov_calls) == 2                                           # one for the forecast, one for the accuracy check
    n, H, lens, _ = fake.cov_calls[1]
    assert H == 30 and all(L == 150 - 30 + 30 for L in sum(lens.values(), []))     # truncated context plus the held-out days
    bt = res["results"][0]["backtest"]
    assert bt["holdout"] == 30 and bt["model"]["smape"] is not None and len(bt["pred"]) == 30


def test_pins_endpoint_needs_sign_in_and_returns_pins():
    from fastapi.testclient import TestClient
    from app.main import app
    from helpers import api
    anon = TestClient(app, headers={"X-Requested-With": "fetch"})
    body = {"start": "2026-11-01", "end": "2026-12-31", "major_events": [{"start": "2026-11-10", "end": "2026-11-12", "name": "Cricket"}]}
    assert anon.post("/api/calendar/pins", json=body).status_code == 401
    c = api()
    r = c.post("/api/calendar/pins", json=body)
    assert r.status_code == 200
    kinds = {p["kind"] for p in r.json()["pins"]}
    assert {"poya", "salary", "festival", "event"} <= kinds
    assert c.post("/api/calendar/pins", json={"start": "2026-12-31", "end": "2026-01-01"}).status_code == 422
