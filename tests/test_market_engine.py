"""Standalone Market insights from the LMRB sheet alone, and the optional timeband bridge to the TVR sheet."""
import json
import shutil
import subprocess
from pathlib import Path

import pandas as pd
import pytest

import synth

ROOT = Path(__file__).resolve().parent.parent
pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")


def run(lm, tv=None):
    args = ["node", str(ROOT / "tests/js/market.js"), str(lm)] + ([str(tv)] if tv else [])
    out = subprocess.run(args, capture_output=True, text=True, timeout=300)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


@pytest.fixture(scope="module")
def sheets(tmp_path_factory):
    d = tmp_path_factory.mktemp("mk")
    lm = synth.make_lmrb(days=1100, start="2023-11-01", seed=3)
    # Unilever bursts every April: triple the spots for two weeks, three years running
    t = pd.to_datetime(dict(year=lm["Yr"], month=lm["Mn"], day=lm["Dd"]))
    burst = lm[(lm["Advertiser"] == "Unilever Sri Lanka") & (t.dt.month == 4) & (t.dt.day.between(10, 24))]
    copies = [burst.assign(Cost=burst["Cost"] + k) for k in (1, 2, 3)]       # distinct costs so the upload de-duplication keeps them
    lm = pd.concat([lm] + copies, ignore_index=True)
    lm["Channel"] = lm["Channel"].replace({"SIRASA": "Sirasa TV"})          # alias spelling differs from the TVR sheet
    lm["Program"] = lm["Program"] + " (LMRB wording)"                      # programme names never match the TVR sheet
    lmp = d / "lm.csv"; lm.to_csv(lmp, index=False)
    tv = synth.make_tv(days=60, start="2026-06-01")
    tvp = d / "tv.csv"; tv.to_csv(tvp, index=False)
    return lmp, tvp


def test_market_insights_work_without_the_tvr_sheet(sheets):
    r = run(sheets[0])
    assert not r["has_grp"] and r["bridge"] is None
    for g in ("comp_spend", "adv_daypart", "adv_lang", "clutter_cd", "first2_cd"):
        assert r["groups"].get(g, 0) > 0, g
    assert r["years"] > 2.9


def test_seasonal_radar_finds_the_annual_burst(sheets):
    r = run(sheets[0])
    p = r["spring"]["Unilever Sri Lanka"]          # standing on 31 March, looking 30 days ahead
    assert p["covered"] == 2 and p["hits"] == 2 and p["prob"] == 1
    assert p["typical_lift"] >= 1.5
    assert r["spring"]["Nestle Lanka Ltd"]["prob"] != 1      # a rival with no April habit is not flagged


def test_creative_lifecycle_reports_current_theme(sheets):
    life = {x["advertiser"]: x for x in run(sheets[0])["lifecycle"]}
    assert life and all(x["status"] in ("Fresh", "Ageing", "Wearing out", "Refresh due") for x in life.values())
    assert all(x["age_days"] >= 1 for x in life.values())


def test_timeband_bridge_ignores_programme_names_and_aliases_channels(sheets):
    r = run(*sheets)
    b = r["bridge"]
    assert b["method"] == "timeband" and b["rated_pct"] > 0
    assert b["rated_profile"] > 0                       # LMRB history reaches back years before the TVR sheet: day-of-week profile used
    assert r["has_grp"] and r["slots"] and all(" " in s and "-" in s for s in r["slots"])
    assert b["not_rated_pct"] > 0                       # Hiru/other channels without matching timeband stay unrated, not guessed
