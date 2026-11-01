"""New programme estimator: a programme with no history, estimated from slot, lead-in, rival loyalty and category launch curves."""
import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

import synth

ROOT = Path(__file__).resolve().parent.parent
pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")


def build(tmp_path):
    rng = np.random.default_rng(4)
    rows, rank = [], 1
    L1 = [1.0, 1.2, 1.3, 1.35]                                   # real launch curve (relative to week 1)

    def add(d, ch, prog, st, en, cat, tvr, reach, avg_t, dur=30):
        nonlocal rank
        rows.append([rank, "All", ch, d.strftime("%Y/%m/%d"), d.strftime("%A"), st, en, prog, dur, cat, round(tvr, 2), round(tvr * 3, 2), 10.0, int(tvr * 3e4), round(reach, 2), avg_t])
        rank += 1
    for i, d in enumerate(pd.date_range("2026-01-01", periods=150)):
        n = lambda s: rng.normal(0, s)
        add(d, "DERANA", "DERANA NEWS", "20:00", "20:30", "NEWS", 5 + n(.1), 9, 25)
        if i < 60:
            add(d, "DERANA", "OLD DRAMA", "20:30", "21:00", "TELEDRAMA", 4 + n(.1), 7.0, 26)
        else:
            add(d, "DERANA", "NEW DRAMA A", "20:30", "21:00", "TELEDRAMA", 3.0 * L1[min(3, (i - 60) // 7)] + n(.05), 7.0, 26)
        add(d, "SIRASA", "SIRASA NEWS", "20:00", "20:30", "NEWS", 4 + n(.1), 9, 20)
        if i < 75:
            add(d, "SIRASA", "SIRASA OLD", "20:30", "21:00", "TELEDRAMA", 3.2 + n(.1), 12, 12)
        else:
            add(d, "SIRASA", "NEW DRAMA B", "20:30", "21:00", "TELEDRAMA", 2.0 * L1[min(3, (i - 75) // 7)] + n(.04), 12, 12)
        add(d, "SIRASA", "SIRASA TALK", "21:00", "21:30", "TALK", max(1.0, 3.0 - i * 0.012 + n(.15)), 11, 11)   # fading and jumpy: a zapping slot
        add(d, "HIRU", "HIRU NEWS", "20:00", "20:30", "NEWS", 3.0 + n(.1), 6, 15)
        add(d, "HIRU", "HIRU SHOW", "20:30", "21:00", "TALK", 2.0 + n(.1), 5, 14)
    p = tmp_path / "tv.csv"; pd.DataFrame(rows, columns=synth.TV_COLS).to_csv(p, index=False); return p


def run(tv, req):
    out = subprocess.run(["node", str(ROOT / "tests/js/coldstart.js"), str(tv), json.dumps(req)], capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


@pytest.fixture(scope="module")
def tv(tmp_path_factory):
    return build(tmp_path_factory.mktemp("cs"))


REQ = {"channel": "HIRU", "days": [0, 1, 2, 3, 4, 5, 6], "start": "20:30", "end": "21:00", "category": "TELEDRAMA"}


def test_trajectory_is_ordered_and_positive(tv):
    r = run(tv, REQ)
    assert r["ok"] and len(r["weeks"]) == 4
    for w in r["weeks"]:
        assert 0 <= w["p10"] < w["p50"] < w["p90"]
    v = r["verdict"]
    assert v["p10"] < v["p50"] < v["p90"]


def test_baseline_uses_slot_and_lead_in(tv):
    b = run(tv, REQ)["baseline"]
    assert b["basis"] == "slot history and lead-in"
    assert abs(b["slot_tvr"] - 2.0) < 0.2 and b["lead_in"] == "HIRU NEWS"
    assert 0.5 <= b["retention"] <= 1.3 and abs(b["retention"] - 2.0 / 3.0) < 0.1     # the shows after Hiru news keep about two thirds


def test_launch_curve_is_learned_from_the_category(tv):
    c = run(tv, REQ)["curve"]
    assert c["launches"] >= 2 and "category" in c["basis"]
    assert abs(c["weeks"][0] - 1) < 1e-9 and 1.1 < c["weeks"][1] < 1.3 and 1.2 < c["weeks"][2] < 1.4 and 1.25 < c["weeks"][3] < 1.45
    assert "OLD" not in " ".join(c["titles"])


def test_rival_loyalty_caps_upside_and_names_the_stealable_channel(tv):
    r = run(tv, REQ)
    by = {x["channel"]: x for x in r["rivals"]}
    assert by["DERANA"]["loyalty"] > by["SIRASA"]["loyalty"]
    assert r["strongest_rival"]["channel"] == "DERANA"
    assert r["verdict"]["biggest_loser"] == "SIRASA" and r["stealable_pool"] > 0
    assert all(w["p90"] <= w["p50"] * r["cap_factor"] + 1e-9 for w in r["weeks"])
    assert r["cap_factor"] < 1.3                                                      # a loyal rival keeps the upside tight


def test_no_data_and_no_history_cases_are_explained(tv):
    assert run(tv, {**REQ, "channel": "NOPE"})["ok"] is False
    r = run(tv, {**REQ, "category": "REALITY"})
    assert r["ok"] and r["curve"]["basis"] == "none" and any("flat launch curve" in n for n in r["notes"])
    assert run(tv, {**REQ, "start": "xx"})["ok"] is False
