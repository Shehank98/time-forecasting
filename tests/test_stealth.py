"""Stealth anomaly detector: the last 14 recorded days against the expected P10 to P90 band, plus new themes and root causes."""
import json
import shutil
import subprocess
from pathlib import Path

import pandas as pd
import pytest

import synth
from app.services import forecast as F

ROOT = Path(__file__).resolve().parent.parent
pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")


def node(*args):
    out = subprocess.run(["node", str(ROOT / "tests/js/stealth.js"), *map(str, args)], capture_output=True, text=True, timeout=240)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


@pytest.fixture(scope="module")
def sheet(tmp_path_factory):
    d = tmp_path_factory.mktemp("st")
    lm = synth.make_lmrb(days=150, start="2026-05-01", seed=21)
    t = pd.to_datetime(dict(year=lm["Yr"], month=lm["Mn"], day=lm["Dd"]))
    last = t.max()
    # Unilever floods the last 6 days at 5x its normal weight, Ceylon Foods launches a brand new theme in the last 4 days
    flood = lm[(lm["Advertiser"] == "Unilever Sri Lanka") & (t > last - pd.Timedelta(days=6))]
    copies = [flood.assign(Cost=flood["Cost"] + k) for k in range(1, 5)]
    newtheme = lm[(lm["Advertiser"] == "Ceylon Foods") & (t > last - pd.Timedelta(days=4))].assign(**{"Advt_Theme": "Monsoon Launch (30)(Sin)"}) if "Advt_Theme" in lm.columns else None
    parts = [lm] + copies + ([newtheme.assign(Cost=newtheme["Cost"] + 9)] if newtheme is not None and len(newtheme) else [])
    p = d / "lm.csv"; pd.concat(parts, ignore_index=True).to_csv(p, index=False)
    return p


@pytest.fixture(scope="module")
def bundle(sheet):
    pay = node("payload", sheet)
    assert {s["group"] for s in pay["daily"]} >= {"stealth_spend", "stealth_totads"}
    specs, notes = F.specs_from_payload(pay["daily"], "daily")
    res = F.run_specs(specs, notes, "lmrb", {"horizon_days": 14, "holdout": 14, "covariates": False})
    assert res["ok"]
    return pay["ctx"], res["results"]


def test_flooding_advertiser_is_flagged_with_root_cause(bundle, tmp_path):
    ctx, results = bundle
    f = tmp_path / "b.json"; f.write_text(json.dumps({"ctx": ctx, "results": results}, default=float))
    alerts = node("alerts", f)
    uni = next(a for a in alerts if a["advertiser"] == "Unilever Sri Lanka")
    spend = next(m for m in uni["metrics"] if m["key"] == "stealth_spend")
    assert spend["run"] >= 2 and spend["gap_pct"] > 0 and all(a > p for a, p in zip(spend["actual"], spend["p90"]))
    assert uni["severity"] in ("medium", "high") and uni["cause"] and "up" in uni["cause"][0]
    assert uni["root"]["spend_last"] > uni["root"]["spend_prev"]
    assert all("—" not in a["text"] for a in alerts)


def test_new_theme_is_reported_once_the_advertiser_had_other_themes(bundle, tmp_path):
    ctx, results = bundle
    cf = ctx["root"]["Ceylon Foods"]
    assert any("Monsoon" in t["theme"] for t in cf["new_themes"]), cf["new_themes"]
    f = tmp_path / "b.json"; f.write_text(json.dumps({"ctx": ctx, "results": results}, default=float))
    alerts = node("alerts", f)
    assert any(a["advertiser"] == "Ceylon Foods" and a["new_themes"] for a in alerts)


def test_calm_advertisers_do_not_alert(bundle, tmp_path):
    ctx, results = bundle
    f = tmp_path / "b.json"; f.write_text(json.dumps({"ctx": ctx, "results": results}, default=float))
    alerts = {a["advertiser"]: a for a in node("alerts", f)}
    assert alerts["Nestle Lanka Ltd"]["kind"] == "new_theme" and not alerts["Nestle Lanka Ltd"]["metrics"]     # a refresh is reported, but it is not a spend breach
    assert alerts["Nestle Lanka Ltd"]["severity"] == "low"
