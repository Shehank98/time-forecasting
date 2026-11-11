"""Competitor playbook: salary day lift, flight cycle and next move, measured from a synthetic LMRB."""
import json
import shutil
import subprocess
from pathlib import Path

import pandas as pd
import pytest

import synth

ROOT = Path(__file__).resolve().parent.parent
pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")


def run(csv, today=None):
    args = ["node", str(ROOT / "tests/js/marketplay.js"), str(csv)] + ([today] if today else [])
    out = subprocess.run(args, capture_output=True, text=True, timeout=300)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


@pytest.fixture(scope="module")
def play(tmp_path_factory):
    lm = synth.make_lmrb(days=420, start="2025-09-01", seed=5)
    # Unilever pays heavily on salary days (25th to 3rd): three extra copies of its rows then (distinct costs so de-duplication keeps them)
    pay = lm[(lm["Advertiser"] == "Unilever Sri Lanka") & ((lm["Dd"] >= 25) | (lm["Dd"] <= 3))]
    lm = pd.concat([lm] + [pay.assign(Cost=pay["Cost"] + k) for k in (1, 2, 3)], ignore_index=True)
    f = tmp_path_factory.mktemp("mp") / "lm.csv"
    lm.to_csv(f, index=False)
    return run(f, "2026-12-01")


def test_market_sees_salary_days(play):
    assert play["ok"] and play["months"] >= 12
    assert play["market"]["payday"]["lift_pct"] > 10          # the salary window is busier than the rest of the month
    bands = {b["label"]: b["index"] for b in play["market"]["bands"]}
    assert bands["25th to month end"] > bands["11th to 17th"]


def test_rival_salary_day_lift_is_larger(play):
    r = {x["advertiser"]: x for x in play["rivals"]}
    assert r["Unilever Sri Lanka"]["payday"]["lift_pct"] > r["Nestle Lanka Ltd"]["payday"]["lift_pct"] + 15


def test_pulsing_rival_gets_a_cycle_and_a_future_next_move(tmp_path):
    lm = synth.make_lmrb(days=420, start="2025-09-01", seed=5)
    f = tmp_path / "lm.csv"; lm.to_csv(f, index=False)
    r = {x["advertiser"]: x for x in run(f, "2026-11-02")["rivals"]}["Ceylon Foods"]
    assert r["flights"]["count"] >= 5
    assert 10 <= r["flights"]["cycle_days"] <= 20             # on for a week, off for a week: starts about 14 days apart
    assert r["next"] and r["next"]["days_from_today"] >= -7   # never a date already in the past
    assert r["confidence"] in ("Medium", "High")


def test_far_projection_is_marked_low(play):
    r = {x["advertiser"]: x for x in play["rivals"]}["Ceylon Foods"]     # today is 5 weeks after its last flight
    assert r["next"]["cycles_ahead"] >= 3 and r["confidence"] == "Low"


def test_next_move_follows_today_not_last_data_day(tmp_path):
    lm = synth.make_lmrb(days=300, start="2025-09-01", seed=5)
    f = tmp_path / "lm.csv"; lm.to_csv(f, index=False)
    a, b = run(f, "2026-07-10"), run(f, "2026-09-10")
    ra = {x["advertiser"]: x for x in a["rivals"]}["Ceylon Foods"]["next"]
    rb = {x["advertiser"]: x for x in b["rivals"]}["Ceylon Foods"]["next"]
    assert ra["date"] < rb["date"]
