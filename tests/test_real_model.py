"""Runs the real timesfm torch architecture (random weights: the released checkpoint needs huggingface.co) through our code.

This verifies the plumbing against the real library: the covariate (XReg) call and its return shapes, the quantile columns, the accuracy check
with covariates, and the LoRA training loop. It says nothing about forecast quality. Skipped when torch or timesfm are not installed.
"""
import numpy as np
import pandas as pd
import pytest

torch = pytest.importorskip("torch")
timesfm = pytest.importorskip("timesfm")
pytest.importorskip("jax")
pytest.importorskip("sklearn")

from app.services import forecast as F  # noqa: E402
from app.services import lora_torch as L  # noqa: E402


def _random_model():
    torch.manual_seed(0)
    tfm = timesfm.TimesFM_2p5_200M_torch(torch_compile=False)
    for n, p in tfm.model.named_parameters():
        if n.endswith(".scale"):                       # random init switches every layer off (zero norm scales); give them values
            p.data.normal_(0, 0.3)
    tfm.model.eval()
    return tfm


@pytest.fixture(scope="module")
def tfm():
    t = _random_model()
    t.compile(timesfm.ForecastConfig(max_context=1024, max_horizon=256, normalize_inputs=True, use_continuous_quantile_head=True,
                                     force_flip_invariance=True, infer_is_positive=True, fix_quantile_crossing=True, return_backcast=True, per_core_batch_size=32))
    return t


def _items(n=150):
    d = pd.date_range("2026-01-01", periods=n)
    rng = np.random.default_rng(1)
    return [{"entity": e, "group": "g", "metric": "spend", "label": "Spend", "unit": "currency", "agg": "sum", "dates": [str(x.date()) for x in d],
             "values": (100 + 10 * (d.dayofweek >= 5) + 20 * k + rng.normal(0, 2, n)).tolist()} for k, e in enumerate("ABC")]


def test_covariates_run_through_the_real_xreg_path(tfm, monkeypatch):
    monkeypatch.setattr(F.model, "_tfm", tfm); monkeypatch.setattr(F.model, "_failed", False)
    specs, notes = F.specs_from_payload(_items(), "daily")
    res = F.run_specs(specs, notes, "lmrb", {"horizon_days": 30, "holdout": 30, "covariates": True, "covariate_guard": False})
    assert res["ok"] and res["backend"] == "timesfm" and res["covariate_note"] is None
    assert {"is_poya_day", "is_salary_week", "is_festival_window", "is_weekend"} <= set(res["covariates_used"])
    r = res["results"][0]
    f = r["forecast"]
    assert len(f["p50"]) == 30 and np.all(np.array(f["p10"]) <= np.array(f["p50"]) + 1e-6) and np.all(np.array(f["p50"]) <= np.array(f["p90"]) + 1e-6)
    assert r["backtest"]["holdout"] == 30 and len(r["backtest"]["pred"]) == 30 and r["backtest"]["model"]["smape"] is not None
    plain = F.run_specs(*F.specs_from_payload(_items(), "daily"), "lmrb", {"horizon_days": 30, "holdout": 30, "covariates": False})
    assert np.abs(np.array(f["p50"]) - np.array(plain["results"][0]["forecast"]["p50"])).max() > 1e-6          # the covariates really change the forecast
    # with the safety check on, every series reports which method won the held-out check, among all four candidates
    guarded = F.run_specs(*F.specs_from_payload(_items(), "daily"), "lmrb", {"horizon_days": 30, "holdout": 30, "covariates": True})
    eng = guarded["results"][0]["backtest"]["engine"]
    assert eng["chosen"] in ("plain", "recent", "timesfm + xreg", "xreg + timesfm", "blend") and len(eng["mae_by_method"]) == 5 and guarded["results"][0]["backtest"]["folds"] == 2


def test_monthly_covariates(tfm, monkeypatch):
    monkeypatch.setattr(F.model, "_tfm", tfm); monkeypatch.setattr(F.model, "_failed", False)
    m = pd.date_range("2024-01-01", periods=30, freq="MS")
    item = {"entity": "M", "group": "g", "metric": "tvr", "label": "x", "unit": "rating", "agg": "mean", "zero_fill": False, "dates": [str(x.date()) for x in m],
            "values": (3 + np.random.default_rng(2).normal(0, .1, 30)).tolist()}
    res = F.run_specs(*F.specs_from_payload([item], "monthly"), "tv", {"horizon_days": 360, "holdout": 3, "covariates": True})
    assert res["ok"] and res["covariate_note"] is None and len(res["results"][0]["forecast"]["p50"]) == 12


def test_lora_trains_only_adapters_saves_reloads_and_unwraps(tmp_path):
    t = _random_model()
    m = t.model
    rng = np.random.default_rng(0)
    wins = []
    for k in range(16):
        s = 100 + 20 * np.sin(np.arange(284) / 7 + k) + rng.normal(0, 1, 284)
        wins.append({"context": s[:256], "target": s[256:]})
    x = torch.tensor(np.stack([w["context"] for w in wins[:2]]), dtype=torch.float32)
    base = {k: v.clone() for k, v in m.state_dict().items()}
    with torch.no_grad():
        before = L._predict_quantiles(m, x).clone()
    out = tmp_path / "lora_test.pt"
    res = L.fit(t, "lora_test", wins, steps=20, rank=4, lr=2e-3, out=out)
    assert res["layers"] == 40 and res["base_weights_changed"] is False and res["loss_end"] < res["loss_start"]
    # the shared base model is handed back unwrapped and unchanged
    assert not any(k.endswith(".A") or k.endswith(".B") for k in m.state_dict())
    assert all(torch.equal(base[k], v) for k, v in m.state_dict().items())
    with torch.no_grad():
        assert (L._predict_quantiles(m, x) - before).abs().max() < 1e-6
    ck = torch.load(out)
    assert len(ck["state"]) == 80 and any(v.abs().sum() > 0 for k, v in ck["state"].items() if k.endswith(".B"))
    # a fresh copy of the base plus the saved adapter gives different (trained) output
    L.inject(m, 4)
    assert L.load_lora_state(m, ck["state"]) == 80
    with torch.no_grad():
        assert (L._predict_quantiles(m, x) - before).abs().max() > 1e-3
    L.remove(m)
    assert not any(k.endswith(".A") for k in m.state_dict())
