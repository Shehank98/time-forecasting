"""The released forecast model on series whose future is known. Skipped when the weights are not on this machine.

To run it: put config.json and model.safetensors of the checkpoint in a folder and set TIMESFM_LOCAL_DIR, then
    FORCE_FALLBACK=0 TIMESFM_LOCAL_DIR=/path/to/weights pytest tests/test_real_weights.py
"""
import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from app.services import forecast as F
from app.services import series as S

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

pytestmark = pytest.mark.skipif(os.environ.get("FORCE_FALLBACK") == "1" or not F.local_checkpoint(), reason="the model weights are not on this machine (or FORCE_FALLBACK=1)")


def test_main_model_beats_the_simple_baseline_and_its_band_is_honest():
    import forecast_audit as A
    rows = []
    for seed in range(3):
        fam = {k: v for k, v in A.families(seed).items() if v[0] == "daily"}
        payload, truth = [], []
        for name, (gran, y, h) in fam.items():
            hist = y[:-h]
            dates = pd.date_range("2025-01-06", periods=len(hist), freq="D")
            payload.append({"entity": f"{name} #{seed}", "group": name, "metric": "value", "agg": "mean", "zero_fill": True, "dates": [str(d.date()) for d in dates], "values": [float(v) for v in hist]})
            truth.append((y[-h:], hist, h))
        specs, notes = F.specs_from_payload(payload, "daily")
        res = F.run_specs(specs, notes, "audit", {"horizon_days": 28})
        assert res["ok"] and res["backend"] == "timesfm"
        for (t, hist, h), r in zip(truth, res["results"]):
            p50, p10, p90 = (np.array(r["forecast"][k][:h], dtype=float) for k in ("p50", "p10", "p90"))
            naive = F.seasonal_naive(hist, h, S.season_length("daily", len(hist)))
            rows.append((A.wape(t, p50), A.wape(t, naive), float(np.mean((t >= p10) & (t <= p90)) * 100)))
    w, n, cov = (np.mean([r[i] for r in rows]) for i in range(3))
    assert w < 0.75 * n                                    # clearly better than "the same weekday last week"
    assert sum(r[0] < r[1] for r in rows) >= 0.8 * len(rows)
    assert 65 <= cov <= 95                                 # the P10 to P90 band holds about 80% of what happened
