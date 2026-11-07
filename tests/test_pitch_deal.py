"""Client Pitch Evaluator: deal inputs (investment, commercial share, prime share), investment estimated at rate card, and the discount that follows."""
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import make_pitch_sample as mk  # noqa: E402

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
CHAN = {"TV - Derana": "DERANA", "TV - Sirasa TV": "SIRASA", "Tv - Hiru": "HIRU"}
RATES = {"channels": {"DERANA": {"pt": {"rate": 900000, "secs": 30}, "npt": {"rate": 250000, "secs": 30}}, "SIRASA": {"pt": {"rate": 500000, "secs": 30}, "npt": {"rate": 150000, "secs": 30}},
                      "HIRU": {"pt": {"rate": 380000, "secs": 30}, "npt": {"rate": 120000, "secs": 30}}}}
BASE = {"rates": RATES, "nego": {"default": {"mode": "discount", "value": 50}}, "max_spots": 6}


@pytest.fixture(scope="module")
def data(tmp_path_factory):
    d = tmp_path_factory.mktemp("deal")
    lm, tv, _ = mk.build()
    lm.to_csv(d / "lm.csv", index=False)
    tv.to_csv(d / "tv.csv", index=False)
    return d, lm, tv


def run(d, opts):
    out = subprocess.run(["node", str(ROOT / "tests/js/pitch.js"), str(d / "lm.csv"), str(d / "tv.csv"), json.dumps({**BASE, **opts})], capture_output=True, text=True, timeout=240)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def test_rack_value_is_the_investment_estimated_at_rate_card(data):
    d, lm, tv = data
    r = run(d, {})
    ev = {e["channel"]: e for e in r["evidence"]}
    rows = r["current"]["rows"]
    for ch, e in ev.items():
        mine = [x for x in rows if x["channel"] == ch]
        assert e["rack_value"] == pytest.approx(sum(x["card30"] * x["eq30"] for x in mine if x["rated"]))                 # spots x duration/30 x rack rate
        assert e["lmrb_cost"] == pytest.approx(sum(x["cost"] for x in mine)) and e["coverage_pct"] == pytest.approx(100)
        assert e["lmrb_pct_of_rack"] == pytest.approx(e["lmrb_cost"] / e["rack_value"] * 100) and e["lmrb_discount_pct"] == pytest.approx(100 - e["lmrb_pct_of_rack"])
        assert e["pt_value"] + e["npt_value"] == pytest.approx(e["rack_value"]) and e["deal"] is None and e["implied_discount_pct"] is None
    # independent pandas check of one channel
    lm = lm.copy()
    lm["ch"] = lm["Channel"].map(CHAN)
    lm["month"] = lm["Yr"].astype(str) + "-" + lm["Mn"].astype(str).str.zfill(2)
    d1 = lm[(lm["ch"] == "DERANA") & (lm["month"] == "2026-09") & (lm["Advt_Theme"] != "Time Check") & (lm["Program"] != "Late Night Show")]
    start = {s[3]: s[4] for s in mk.SLOTS}
    pt = d1["Program"].map(lambda p: 19 * 3600 <= int(start[p][:2]) * 3600 + int(start[p][3:]) * 60 < 22.5 * 3600)
    rate = pt.map({True: 900000, False: 250000})
    assert ev["DERANA"]["rack_value"] == pytest.approx((rate * d1["Dur"] / 30).sum())


def test_actual_investment_gives_the_real_discount(data):
    d, _, _ = data
    est = {e["channel"]: e for e in run(d, {})["evidence"]}
    rack = est["DERANA"]["rack_value"]
    deals = {"DERANA": {"investment": 20_000_000, "commercial_pct": 80}}
    r = run(d, {"deals": deals})
    e = {x["channel"]: x for x in r["evidence"]}["DERANA"]
    assert e["commercial_investment"] == 16_000_000 and e["sponsorship_investment"] == 4_000_000
    assert e["implied_discount_pct"] == pytest.approx((1 - 16_000_000 / rack) * 100) and e["implied_pays_pct"] == pytest.approx(16_000_000 / rack * 100)
    assert e["rack_value"] == pytest.approx(rack)                                      # the estimate does not change with what was entered
    assert est["SIRASA"]["deal"] is None and {x["channel"]: x for x in r["evidence"]}["SIRASA"]["implied_discount_pct"] is None      # other channels have no real investment yet
    # the current buy as it was really paid: one discount for the channel, the investment split commercial / sponsorship
    a = run(d, {"deals": deals, "current_basis": "actual"})
    ch = {c["channel"]: c for c in a["current"]["channels"]}
    assert ch["DERANA"]["com_spend"] == pytest.approx(16_000_000) and ch["DERANA"]["va_spend"] == pytest.approx(4_000_000) and ch["DERANA"]["spend"] == pytest.approx(20_000_000)
    k = 16_000_000 / rack
    rows = [x for x in a["current"]["rows"] if x["channel"] == "DERANA"]
    assert all(x["cost"] == pytest.approx(x["value"] * k) and x["cost_lmrb"] > 0 for x in rows)
    assert ch["DERANA"]["com_roi"] == pytest.approx(rack / 16_000_000)                    # ROI = rack value / what they paid
    assert ch["SIRASA"]["com_spend"] == pytest.approx([c for c in run(d, {})["current"]["channels"] if c["channel"] == "SIRASA"][0]["com_spend"])      # untouched without a deal
    assert a["current"]["rows"][0]["avg30"] == pytest.approx(a["current"]["rows"][0]["cost"] / a["current"]["rows"][0]["eq30"])
    full = run(d, {"deals": {"DERANA": {"investment": 16_000_000}}, "current_basis": "actual"})                # 100% commercial: the frequency items come free
    assert {c["channel"]: c for c in full["current"]["channels"]}["DERANA"]["va_spend"] == pytest.approx(0)


def test_plan_budget_from_the_deal_and_a_prime_split(data):
    d, _, _ = data
    cur = {c["channel"]: c for c in run(d, {})["current"]["channels"]}
    deals = {"DERANA": {"investment": 30_000_000, "commercial_pct": 90, "prime_pct": 50}}
    r = run(d, {"deals": deals, "budget_basis": "deal"})
    assert r["budgets"]["DERANA"] == pytest.approx(27_000_000)                                                      # investment x commercial share
    assert r["budgets"]["SIRASA"] == pytest.approx(cur["SIRASA"]["com_spend"])                                       # no deal: the current commercial spend
    p = r["plan"]["channels"]["DERANA"]
    assert p["spend"] <= 27_000_000 + 1e-6
    rows = [x for x in r["plan"]["rows"] if x["channel"] == "DERANA"]
    pt_spend = sum(x["spend"] for x in rows if x["pt"])
    assert 0.35 <= pt_spend / p["spend"] <= 0.65 and r["prime_share"] == {"DERANA": 0.5}                            # about half the money in prime time
    flat = run(d, {"deals": {"DERANA": {"investment": 30_000_000, "commercial_pct": 90}}, "budget_basis": "deal"})
    assert flat["prime_share"] == {}
    # the sentence only says "same budget" when it is
    assert "same budget" not in r["comparison"]["sentence"] and abs(r["plan"]["totals"]["budget"] / r["comparison"]["current"]["spend"] - 1) > 0.02
    assert "same budget" in run(d, {})["comparison"]["sentence"]


def test_current_agency_from_an_estimated_discount_or_an_investment(data):
    d, _, _ = data
    base = {e["channel"]: e for e in run(d, {})["evidence"]}
    rack = base["DERANA"]["rack_value"]
    # only a discount typed: the cost is the rack value less that discount
    r = run(d, {"deals": {"DERANA": {"discount_pct": 60}}, "current_basis": "actual"})
    e = {x["channel"]: x for x in r["evidence"]}["DERANA"]
    assert e["investment_source"] == "from the discount" and e["commercial_investment"] == pytest.approx(rack * 0.4) and e["implied_discount_pct"] == pytest.approx(60) and e["discount_gap_pts"] is None
    ch = {c["channel"]: c for c in r["current"]["channels"]}["DERANA"]
    assert ch["com_spend"] == pytest.approx(rack * 0.4) and ch["com_roi"] == pytest.approx(1 / 0.4)                   # ROI = rack value / cost
    # an investment and a discount: the investment wins, the discount is only checked
    both = run(d, {"deals": {"DERANA": {"investment": 30_000_000, "discount_pct": 70}}, "current_basis": "actual"})
    e2 = {x["channel"]: x for x in both["evidence"]}["DERANA"]
    assert e2["investment_source"] == "entered" and e2["commercial_investment"] == 30_000_000 and e2["typed_discount_pct"] == 70
    assert e2["implied_discount_pct"] == pytest.approx((1 - 30_000_000 / rack) * 100) and e2["discount_gap_pts"] == pytest.approx(70 - e2["implied_discount_pct"])
    assert {c["channel"]: c for c in both["current"]["channels"]}["DERANA"]["com_spend"] == pytest.approx(30_000_000)
    # a deal with neither stays out
    assert {x["channel"]: x for x in run(d, {"deals": {"DERANA": {"commercial_pct": 80}}})["evidence"]}["DERANA"]["deal"] is None


def test_our_plan_has_its_own_investment_discount_prime_and_bonus(data):
    d, _, _ = data
    cur = {c["channel"]: c for c in run(d, {})["current"]["channels"]}
    pd = {"DERANA": {"investment": 15_000_000, "commercial_pct": 90, "prime_pct": 40, "discount_pct": 55, "bonus_pct": 10}}
    r = run(d, {"plan_deals": pd, "nego": {"default": {"mode": "discount", "value": 50}}})
    assert r["budgets"]["DERANA"] == pytest.approx(13_500_000) and r["budgets"]["SIRASA"] == pytest.approx(cur["SIRASA"]["com_spend"])      # the other channels keep the current commercial spend
    assert r["prime_share"]["DERANA"] == 0.4
    for c in r["candidates"]:
        if c["channel"] == "DERANA":
            assert c["neg30"] == pytest.approx(c["card30"] * 0.45)                                                  # our discount beats the default rule
        elif c["channel"] == "SIRASA":
            assert c["neg30"] == pytest.approx(c["card30"] * 0.5)
    pi = r["plan_inputs"]["DERANA"]
    card_value = sum(x["card30"] * x["spots"] for x in r["plan"]["rows"] if x["channel"] == "DERANA")
    assert pi["investment"] == 15_000_000 and pi["source"] == "entered" and pi["card_value"] == pytest.approx(card_value) and pi["bonus_allowed"] == pytest.approx(0.10 * card_value)
    assert r["plan"]["channels"]["DERANA"]["spend"] <= 13_500_000 + 1e-6
    # a channel rule you set yourself still beats the discount typed with the investment
    ch = run(d, {"plan_deals": pd, "nego": {"channels": {"DERANA": {"mode": "discount", "value": 30}}}})
    assert all(c["neg30"] == pytest.approx(c["card30"] * 0.7) for c in ch["candidates"] if c["channel"] == "DERANA")
    # without our inputs the plan is as before
    assert run(d, {})["budgets"]["DERANA"] == pytest.approx(cur["DERANA"]["com_spend"]) and run(d, {})["plan_inputs"]["DERANA"]["source"] == "current buy"


def test_evaluation_is_built_for_one_advertiser(data):
    """Choosing an advertiser keeps only that advertiser's LMRB rows in the current buy; the list of advertisers is offered."""
    p, *_ = data
    allr = run(p, {"month": "all"})
    advs = [a["name"] for a in allr["advertisers"]]
    assert len(advs) >= 1 and allr["advertiser"] is None
    one = run(p, {"month": "all", "advertiser": advs[0]})
    assert one["advertiser"] == advs[0]
    assert one["current"]["spend"] <= allr["current"]["spend"] + 1e-6
    if len(advs) > 1:
        assert one["current"]["spend"] < allr["current"]["spend"]
    none = run(p, {"month": "all", "advertiser": "No Such Advertiser"})
    assert none["empty"]


def test_current_basket_rows_follow_the_lmrb_programme_and_duration(data):
    """One row per LMRB programme and duration: the spot count is the sheet's, and the rates are given at that duration."""
    p, lm, _ = data
    r = run(p, {"month": "all"})
    rows = r["current"]["rows"]
    keys = {(x["key"], x["lmrb_program"], x["dur"]) for x in rows}
    assert len(keys) == len(rows)
    for x in rows:
        assert x["avg_rate"] == pytest.approx(x["cost"] / x["spots"])
        if x["card_rate"]:
            assert x["card_rate"] == pytest.approx(x["card30"] * x["dur"] / 30)
        if x["neg_rate"]:
            assert x["neg_rate"] == pytest.approx(x["neg30"] * x["dur"] / 30)


def test_durations_are_the_real_ones_from_the_lmrb(data):
    """No averaged durations: programme rows and sponsorship items carry real LMRB durations only."""
    p, lm, _ = data
    real = {float(x) for x in lm["Dur"].dropna().unique()}
    r = run(p, {"month": "all"})
    assert {x["dur"] for x in r["current"]["rows"]} <= real
    for s in r["current"]["sponsorship"]:
        assert s["durs"] and {q["dur"] for q in s["durs"]} <= real
        assert sum(q["spots"] for q in s["durs"]) == s["spots"]
        assert sum(q["spend"] for q in s["durs"]) == pytest.approx(s["spend"])


@pytest.mark.parametrize("opts", [{"month": "all"}, {"month": "2026-09"}, {"month": "2026-08"}, {"month": "all", "advertiser": "Sampath Bank"}, {"month": "all", "channels": ["DERANA"]}])
def test_no_spend_or_spot_is_lost_or_counted_twice(data, opts):
    """Programmes + sponsorship + unmatched equals every TV row of the sheet in view, for any month, advertiser or channel filter."""
    p, lm, _ = data
    r = run(p, opts)
    au = r["audit"]
    total = sum(x["cost"] for x in r["current"]["rows"]) + sum(x["spend"] for x in r["current"]["sponsorship"]) + r["warnings"]["unmatched_spend"]
    assert total == pytest.approx(au["view_spend"])
    tv = lm[lm["Channel"].isin(CHAN)].copy()
    tv["month"] = tv["Yr"].astype(str) + "-" + tv["Mn"].astype(str).str.zfill(2)
    if opts.get("month") != "all":
        tv = tv[tv["month"] == opts["month"]]
    if opts.get("channels"):
        tv = tv[tv["Channel"].map(CHAN).isin(opts["channels"])]
    assert au["view_spend"] == pytest.approx(tv["Cost"].sum()) and au["view_spots"] == len(tv)


def test_odd_lmrb_rows_are_counted_and_reported(data, tmp_path):
    """Rows with no duration, zero cost or a negative cost are counted in the audit block, never crash the build."""
    p, lm, _ = data
    bad = lm.copy()
    bad.loc[bad.index[:5], "Dur"] = None
    bad.loc[bad.index[5:8], "Cost"] = 0
    bad.loc[bad.index[8], "Cost"] = -1000
    bad.to_csv(tmp_path / "bad.csv", index=False)
    out = subprocess.run(["node", str(ROOT / "tests/js/pitch.js"), str(tmp_path / "bad.csv"), str(p / "tv.csv"), json.dumps({**BASE, "month": "all"})], capture_output=True, text=True, timeout=240)
    assert out.returncode == 0, out.stderr
    au = json.loads(out.stdout)["audit"]
    assert au["no_duration_rows"] >= 5 and au["zero_cost_rows"] >= 3 and au["negative_cost_rows"] == 1


def test_same_programme_at_slightly_different_times_is_one_programme(data, tmp_path):
    """The same TVR programme listed 15 minutes earlier on some days (or on a subset of days) is merged into one, with the TVR averaged over all airings."""
    p, lm, tv = data
    base = run(p, {"month": "all"})
    n0 = len({(c["channel"], c["program"]) for c in base["candidates"]})
    t2 = tv.copy()
    husmak = t2[t2["Program"] == "HUSMAK LAGIN"].copy()
    assert len(husmak) > 4
    shifted = husmak.iloc[:4].copy()
    shifted["Start"] = "20:15"
    shifted["TVR"] = 2.0
    t2 = pd.concat([t2[~t2.index.isin(shifted.index)], shifted], ignore_index=True)
    t2.to_csv(tmp_path / "tv2.csv", index=False)
    out = subprocess.run(["node", str(ROOT / "tests/js/pitch.js"), str(p / "lm.csv"), str(tmp_path / "tv2.csv"), json.dumps({**BASE, "month": "all"})], capture_output=True, text=True, timeout=240)
    assert out.returncode == 0, out.stderr
    r = json.loads(out.stdout)
    assert r["audit"]["merged_tvr_slots"] >= 1
    hus = [c for c in r["candidates"] if c["program"] == "HUSMAK LAGIN"]
    assert len(hus) == 1                                                       # one programme, not two slots
    allrows = t2[t2["Program"] == "HUSMAK LAGIN"]
    assert hus[0]["tvr"] == pytest.approx(allrows["TVR"].mean(), rel=1e-6)    # averaged over every airing


def test_tvr_of_different_target_audiences_are_never_averaged(data, tmp_path):
    """A TVR sheet with two data sets (target audiences): one is used at a time, the average is of that audience only."""
    p, lm, tv = data
    t2 = tv.copy()
    t2["Data Set"] = "All 4+"
    other = tv.copy()
    other["Data Set"] = "Women 25-44"
    other["TVR"] = other["TVR"] * 3
    both = pd.concat([t2, other], ignore_index=True)
    both.to_csv(tmp_path / "tv_ds.csv", index=False)
    def go(ds):
        out = subprocess.run(["node", str(ROOT / "tests/js/pitch.js"), str(p / "lm.csv"), str(tmp_path / "tv_ds.csv"), json.dumps({**BASE, "month": "all", **({"data_set": ds} if ds else {})})], capture_output=True, text=True, timeout=240)
        assert out.returncode == 0, out.stderr
        return json.loads(out.stdout)
    a, w = go("All 4+"), go("Women 25-44")
    assert {x["name"] for x in a["data_sets"]} == {"All 4+", "Women 25-44"} and a["data_set"] == "All 4+" and w["data_set"] == "Women 25-44"
    base = run(p, {"month": "all"})
    tv_a = {c["key"]: c["tvr"] for c in a["candidates"]}
    tv_b = {c["key"]: c["tvr"] for c in base["candidates"]}
    assert tv_a == pytest.approx(tv_b)                                         # the same numbers as a sheet that has only that audience
    w_tvr = {c["key"]: c["tvr"] for c in w["candidates"]}
    assert all(w_tvr[k] == pytest.approx(3 * tv_a[k], rel=1e-6) for k in tv_a if k in w_tvr)
