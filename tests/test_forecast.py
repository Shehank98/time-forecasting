import numpy as np
import pandas as pd
import pytest

import synth
from app.services import forecast as F
from app.services import ingest
from app.services import series as S


@pytest.fixture(scope="module")
def lm():
    return ingest.parse(synth.to_csv_bytes(synth.make_lmrb()), "s.csv", "lmrb").df


@pytest.fixture(scope="module")
def tv():
    return ingest.parse(synth.to_csv_bytes(synth.make_tv()), "s.csv", "tv").df


def params(**kw):
    base = {"entity_type": "advertiser", "metric": "spend", "granularity": "daily", "horizon_days": 14}
    base.update(kw)
    return base


def test_zero_fill_and_alignment(lm):
    specs, _ = S.build_series(lm, "lmrb", "advertiser", "spend", "daily", ["Ceylon Foods"])
    sp = specs[0]
    assert len(sp.values) == lm["date"].nunique() or len(sp.values) == (lm["date"].max() - lm["date"].min()).days + 1
    assert (sp.values == 0).any() and not np.isnan(sp.values).any()     # pulsing advertiser has zero days, not gaps
    assert sp.dates.freq is not None


def test_weekly_drops_partial_weeks(lm):
    mid = lm[(lm["date"] >= "2026-08-05") & (lm["date"] <= "2026-09-10")]
    specs, notes = S.build_series(mid, "lmrb", "total", "spend", "weekly")
    assert len(notes) >= 2 and all(d.dayofweek == 0 for d in specs[0].dates) and any("partial" in n for n in notes)


def test_cps_is_interpolated_not_zero(lm):
    specs, notes = S.build_series(lm, "lmrb", "channel", "cps", "daily")
    assert all((s.values > 0).all() for s in specs) and any("interpolation" in n for n in notes)


def test_sov_sums_to_100(lm):
    specs, _ = S.build_series(lm, "lmrb", "advertiser", "sov", "weekly", max_entities=10)
    total = sum(s.values for s in specs)
    assert np.allclose(total[total > 0], 100)


def test_frequency_flags():
    assert S.FREQ_FLAG == {"daily": 0, "weekly": 1, "monthly": 1}


def test_run_returns_bands_backtest_and_reliability(lm):
    r = F.run(lm, "lmrb", params())
    assert r["ok"] and r["backend"] == "fallback" and len(r["results"]) >= 3
    x = r["results"][0]
    assert len(x["forecast"]["p50"]) == 14 and x["backtest"]["holdout"] >= 2
    assert all(a <= b <= c for a, b, c in zip(x["forecast"]["p10"], x["forecast"]["p50"], x["forecast"]["p90"]))
    assert x["reliability"]["level"] in {"High", "Medium", "Low"} and {"smape", "mae", "mase"} <= set(x["backtest"]["model"])
    assert x["backtest"]["baseline"]["name"] == "Seasonal naive" and min(x["forecast"]["p10"]) >= 0


def test_thin_history_runs_and_is_low():
    df = ingest.parse(synth.to_csv_bytes(synth.make_lmrb(days=9)), "s.csv", "lmrb").df
    r = F.run(df, "lmrb", params(entity_type="total"))
    x = r["results"][0]
    assert r["ok"] and x["reliability"]["level"] == "Low" and any("Thin history" in w for w in x["warnings"])


def test_all_zero_and_single_point():
    df = ingest.parse(synth.to_csv_bytes(synth.make_lmrb(days=3)), "s.csv", "lmrb").df
    df = df.assign(cost=0.0)
    r = F.run(df, "lmrb", params(entity_type="total"))
    assert r["results"][0]["reliability"]["level"] == "Low" and set(r["results"][0]["forecast"]["p50"]) == {0.0}
    one = ingest.parse((synth.LMRB_COLS and ",".join(synth.LMRB_COLS) + "\nA,B,C,D,1,Derana,P,1,9,2026,Tue,09:00,09:10:00,1,5,1,2,5,Sin,10,1000\n").encode(), "o.csv", "lmrb").df
    r1 = F.run(one, "lmrb", params(entity_type="total", granularity="weekly"))
    assert r1["ok"] and r1["results"][0]["reliability"]["level"] == "Low"


def test_empty_selection_never_crashes(lm):
    r = F.run(lm, "lmrb", params(entities=["Nobody"]))
    assert r["ok"] is False and "message" in r


def test_tv_forecast_and_programme_weekly(tv):
    r = F.run(tv, "tv", {"entity_type": "channel", "metric": "tvr", "granularity": "daily", "horizon_days": 7})
    assert r["ok"] and {x["entity"] for x in r["results"]} >= {"SIRASA", "DERANA"}
    p = F.run(tv, "tv", {"entity_type": "program", "metric": "tvr", "granularity": "daily", "horizon_days": 14, "max_entities": 3})
    assert p["results"][0]["granularity"] == "weekly" and any("weekly" in n for n in p["notes"])


def test_batched_single_call(lm, monkeypatch):
    calls = []
    orig = F.model.predict

    def spy(ctxs, freqs, h):
        calls.append(len(ctxs))
        return orig(ctxs, freqs, h)
    monkeypatch.setattr(F.model, "predict", spy)
    r = F.run(lm, "lmrb", params(max_entities=4))
    assert len(calls) == 1 and calls[0] == len(r["results"]) * 2     # forecasts and backtest contexts together


def test_metrics_helpers():
    a, f = np.array([10.0, 20.0]), np.array([12.0, 18.0])
    assert F.mae(a, f) == 2 and F.smape(a, f) == pytest.approx(((2 * 2 / 22) + (2 * 2 / 38)) / 2 * 100)
    assert F.mase(a, f, np.array([1.0, 3.0, 5.0]), 1) == pytest.approx(1.0) and F.smape(np.zeros(2), np.zeros(2)) == 0.0
    assert list(F.seasonal_naive(np.array([1.0, 2, 3, 4, 5, 6, 7, 8]), 3, 7)) == [2, 3, 4]


def test_anomaly_and_change_point_detection():
    d = pd.date_range("2026-01-01", periods=40)
    y = np.r_[np.full(20, 100.0) + np.random.default_rng(1).normal(0, 2, 20), np.full(20, 200.0) + np.random.default_rng(2).normal(0, 2, 20)]
    y[10] = 400
    assert any(a["date"] == str(d[10].date()) for a in F.detect_anomalies(d, y, "daily"))
    cps = F.detect_change_points(d, y)
    assert cps and abs(pd.Timestamp(cps[0]["date"]) - d[20]).days <= 2


def test_cache_key_changes_with_params():
    k1 = F.ResultCache.key("v1", "lmrb", {}, {}, {"a": 1})
    assert k1 == F.ResultCache.key("v1", "lmrb", {}, {}, {"a": 1}) and k1 != F.ResultCache.key("v1", "lmrb", {}, {}, {"a": 2}) and k1 != F.ResultCache.key("v2", "lmrb", {}, {}, {"a": 1})


class FakeTfm:
    """Mimics timesfm.TimesFm v1 outputs: mean plus [q0.1..q0.9] and forecast_with_covariates."""
    def __init__(self):
        self.forecast_calls, self.cov_kwargs = 0, None

    def forecast(self, inputs, freq=None):
        self.forecast_calls += 1
        n, H = len(inputs), 128
        q = np.zeros((n, H, 10))
        for i, x in enumerate(inputs):
            for k in range(10):
                q[i, :, k] = x[-1] + (k - 5)     # distinct per index so the mapping is testable
        return q[:, :, 5], q

    def forecast_with_covariates(self, inputs, **kw):
        self.cov_kwargs = kw
        return [np.full(128, 1000.0) for _ in inputs], [np.zeros(128) for _ in inputs]


def test_timesfm_path_uses_correct_quantiles_and_covariates(lm, monkeypatch):
    fake = FakeTfm()
    monkeypatch.setattr(F.model, "_tfm", fake)
    monkeypatch.setattr(F.model, "_failed", False)
    r = F.run(lm, "lmrb", params(entity_type="total", horizon_days=7, granularity="daily"))
    x = r["results"][0]
    assert r["backend"] == "timesfm" and fake.forecast_calls == 1 and fake.cov_kwargs["freq"] == [0]
    assert "day_of_week" in r["covariates_used"] and any(c.startswith("is_") for c in r["covariates_used"])
    last = x["history"]["values"][-1]
    assert np.allclose(x["forecast"]["p50"], 1000.0)                        # covariate adjusted point forecast
    assert np.allclose(np.array(x["forecast"]["p90"]) - np.array(x["forecast"]["p10"]), 8)   # idx 9 minus idx 1
    assert r["frequency_flag"] == 0


def test_timesfm_failure_falls_back(lm, monkeypatch):
    class Boom(FakeTfm):
        def forecast(self, inputs, freq=None):
            raise RuntimeError("oom")
    monkeypatch.setattr(F.model, "_tfm", Boom())
    monkeypatch.setattr(F.model, "_failed", False)
    r = F.run(lm, "lmrb", params(entity_type="total"))
    assert r["ok"] and r["backend"] == "fallback" and F.model.status()["backend"] == "fallback"


def test_calendar_features_cover_event_types():
    d = pd.date_range("2026-04-10", periods=10)
    f = S.calendar_features(d, "daily")
    assert f["is_new_year"].sum() == 2 and "is_poya" in f
    w = S.calendar_features(pd.DatetimeIndex(["2026-04-13"]), "weekly")
    assert w["is_new_year"][0] == 2
