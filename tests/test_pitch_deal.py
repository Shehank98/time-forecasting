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


def test_time_bands_weekend_split_and_programme_list_and_shares(data):
    """Bands per channel: prime / non prime weekday / non prime weekend, and a programme list (Prime A, Prime B, Non prime) like Hiru's."""
    p, lm, tv = data
    wk = run(p, {"month": "all", "bands": {"DERANA": {"preset": "pt_wk"}}})
    band = {c["program"]: c["band"] for c in wk["candidates"] if c["channel"] == "DERANA"}
    assert band["HUSMAK LAGIN"] == "PT" and band["DERANA ARUNA"] == "NPT_WD" and band["WEEKEND MOVIE"] == "NPT_WE"
    hiru_list = [{"cat": "A", "name": "Hiru News", "days": "Monday to Sunday", "start": "19:30", "end": "20:00"}, {"cat": "B", "name": "Hiru Morning Show", "days": "Daily", "start": "06:30 am", "end": "08:00 am"}]
    hb = run(p, {"month": "all", "bands": {"HIRU": {"preset": "abc", "list": hiru_list}}})
    hband = {c["program"]: c["band"] for c in hb["candidates"] if c["channel"] == "HIRU"}
    assert hband["HIRU NEWS"] == "A" and hband["HIRU MORNING"] == "B" and hband["HIRU MOVIE"] == "NP"      # a programme not in the list is non prime
    assert {x["program"] for x in hb["bands"]["HIRU"]["uncategorised"]} == {"HIRU MOVIE"}
    # shares: strict shares are limits, not targets
    sh = {"HIRU": {"preset": "abc", "list": hiru_list, "shares": {"A": 20, "B": 40, "NP": 40}, "strict": True}}
    st = run(p, {"month": "all", "bands": sh, "max_spots": 8})
    budget = st["budgets"]["HIRU"]
    spent = {}
    for r in st["plan"]["rows"]:
        if r["channel"] == "HIRU":
            spent[r["band"]] = spent.get(r["band"], 0) + r["spend"]
    assert spent.get("A", 0) <= 0.20 * budget + 1e-6 and spent.get("B", 0) <= 0.40 * budget + 1e-6 and spent.get("NP", 0) <= 0.40 * budget + 1e-6
    assert st["band_shares"]["HIRU"] == {"A": 0.2, "B": 0.4, "NP": 0.4} and st["band_strict"]["HIRU"] is True


def test_hiru_categorisation_list_effective_23_10_2026():
    """The built-in Hiru list parses days and times the way the PDF writes them."""
    out = subprocess.run(["node", "-e", """
const fs = require('fs'), vm = require('vm'); const root = '%s/app/static/js/engine/';
for (const f of ['pitchmatch.js', 'pitchbands.js']) vm.runInThisContext(fs.readFileSync(root + f, 'utf8'));
const B = MR.pitchBands; const H = B.HIRU;
const e = (program, start, days) => ({ program, start: start * 60, days, pt: false });
const wd = [1,1,1,1,1,0,0], we = [0,0,0,0,0,1,1], sat = [0,0,0,0,0,1,0];
const cfg = { preset: 'abc', list: H.rows };
console.log(JSON.stringify({ rows: H.rows.length, days: B.parseDays('Monday to Thursday'), we: B.parseDays('Saturday & Sunday'), t1: B.parseTime('11.55 am'), t2: B.parseTime('09:55 pm'), t3: B.parseTime('12:30 am'),
  news: B.classify(e('9.55 News', 21 * 60 + 55, wd), cfg).id, rpt: B.classify(e('Ron Soya - RPT', 11 * 60, wd), cfg).id, live: B.classify(e('Ron Soya', 20 * 60 + 30, wd), cfg).id, early: B.classify(e('Paththarey Wistharey', 6 * 60 + 30, we), cfg).id,
  star: B.classify(e('Hiru Star - Season 05', 19 * 60 + 30, sat), cfg).id, movie: B.classify(e('Afternoon Movies', 12 * 60 + 30, wd), cfg).id, unknown: B.classify(e('Some New Show', 15 * 60, wd), cfg).listed }));
""" % str(ROOT)], capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    r = json.loads(out.stdout)
    assert r["rows"] == 53 and r["days"] == [0, 1, 2, 3] and r["we"] == [5, 6] and r["t1"] == 715 and r["t2"] == 1315 and r["t3"] == 30
    assert (r["news"], r["rpt"], r["live"], r["early"], r["star"], r["movie"]) == ("A", "NP", "A", "B", "A", "NP") and r["unknown"] is False


def test_daypart_shows_the_rate_card_rate_next_to_the_monitored_rate(data):
    """Prime / non prime by channel: monitored rate = LMRB cost / 30 sec equivalents; rate card rate = rack value / 30 sec equivalents of the rated rows."""
    p, lm, tv = data
    r = run(p, {"month": "all"})
    rows = r["current"]["rows"]
    for c in r["current"]["daypart"]["by_channel"]:
        for side, flag in (("prime", True), ("non_prime", False)):
            x = c[side]
            rs = [q for q in rows if q["channel"] == c["channel"] and q["pt"] == flag]
            if not rs:
                continue
            assert x["avg30"] == pytest.approx(sum(q["cost"] for q in rs) / sum(q["eq30"] for q in rs))
            rated = [q for q in rs if q["rated"]]
            assert x["avg30_card"] == pytest.approx(sum(q["value"] for q in rated) / sum(q["eq30"] for q in rated))
            assert x["cprp_card"] == pytest.approx(sum(q["value"] for q in rated) / sum(q["ngrp"] for q in rated))
    der = [c for c in r["current"]["daypart"]["by_channel"] if c["channel"] == "DERANA"][0]
    assert der["prime"]["avg30_card"] == pytest.approx(900000) and der["non_prime"]["avg30_card"] == pytest.approx(250000)      # the channel's card rates typed in the test


def test_client_analysis_covers_every_channel_the_client_buys(data):
    """The LMRB alone says where the client spends: channels without TVR (and radio) are in the analysis, with spend, spots and programmes, but no ratings."""
    p, lm, tv = data
    r = run(p, {"month": "all"})
    cl = r["client"]
    names = {(c["medium"], c["channel"]): c for c in cl["channels"]}
    assert ("TV", "ITN") in names and not names[("TV", "ITN")]["has_tvr"] and names[("TV", "DERANA")]["has_tvr"]
    assert any(c["medium"].lower().startswith("radio") for c in cl["channels"])
    assert cl["total_spend"] == pytest.approx(lm["Cost"].sum())                       # every row of the sheet, all media
    itn = lm[lm["Channel"] == "TV - ITN"]
    assert names[("TV", "ITN")]["spend"] == pytest.approx(itn["Cost"].sum()) and names[("TV", "ITN")]["spots"] == len(itn)
    b = cl["lmrb_only"]["TV|ITN"]
    assert sum(x["spots"] for x in b["rows"]) + sum(x["spots"] for x in b["sponsorship"]) == len(itn)
    assert sum(x["cost"] for x in b["rows"]) + sum(x["spend"] for x in b["sponsorship"]) == pytest.approx(itn["Cost"].sum())
    assert all(x["dur"] in set(itn["Dur"]) for x in b["rows"]) and "TV|DERANA" not in cl["lmrb_only"]
    assert cl["tvr_spend"] == pytest.approx(lm[lm["Channel"].isin(CHAN)]["Cost"].sum())
    ov = {(x["medium"], x["channel"]): x for x in r["overview"]["rows"]}
    assert ("TV", "ITN") in ov and ov[("TV", "ITN")]["has_tvr"] is False
    one = run(p, {"month": "2026-09"})
    sep = lm[(lm["Mn"] == 9)]
    assert one["client"]["total_spend"] == pytest.approx(sep["Cost"].sum())
