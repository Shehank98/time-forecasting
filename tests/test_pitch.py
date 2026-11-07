"""Client Pitch Evaluator: matching, 30 sec maths, ROI, plan and exports, against independent pandas calculations on the sample data."""
import io
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
CANON_L = {"TV - Derana": "DERANA", "TV - Sirasa TV": "SIRASA", "Tv - Hiru": "HIRU"}
CANON_T = {"Tv - Derana": "DERANA", "SIRASA TV": "SIRASA", "HIRU TV": "HIRU"}
RATES = {"DERANA": (900000, 30), "SIRASA": (500000, 30), "HIRU": (380000, 30)}      # prime / non prime card rate per channel
OPTS = {"rates": {"channels": {"DERANA": {"pt": {"rate": 900000, "secs": 30}, "npt": {"rate": 250000, "secs": 30}}, "SIRASA": {"pt": {"rate": 500000, "secs": 30}, "npt": {"rate": 150000, "secs": 30}},
                               "HIRU": {"pt": {"rate": 380000, "secs": 30}, "npt": {"rate": 120000, "secs": 30}}},
                  "programmes": {"HIRU|HIRU MORNING": {"rate": 40000, "secs": 10}, "DERANA|HUSMAK LAGIN": {"rate": 1000000, "secs": 30}}},
        "nego": {"default": {"mode": "discount", "value": 45}, "programmes": {"SIRASA|LAKSHAPATHI": {"mode": "special", "value": 280000}}}}


def run(lmrb, tvr, opts=None, colmap=None):
    args = ["node", str(ROOT / "tests/js/pitch.js"), str(lmrb), str(tvr), json.dumps(opts or {})] + ([json.dumps(colmap)] if colmap else [])
    out = subprocess.run(args, capture_output=True, text=True, timeout=240)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


@pytest.fixture(scope="module")
def data(tmp_path_factory):
    d = tmp_path_factory.mktemp("pitch")
    lm, tv, rt = mk.build()
    lm.to_csv(d / "lm.csv", index=False)
    tv.to_csv(d / "tv.csv", index=False)
    return d, lm, tv, rt


def reference(lm, tv, month="2026-09"):
    """Independent pandas version of the current evaluation (commercial rows, per TVR programme)."""
    tv = tv.copy()
    tv["ch"] = tv["Channel"].map(CANON_T)
    tv["prog"] = tv["Program"].str.upper()
    avg = tv.groupby(["ch", "prog"])["TVR"].mean()
    slot = {(s[2], s[3]): s[1] for s in mk.SLOTS}            # (lmrb channel, lmrb programme) -> tvr programme
    d = lm[lm["Channel"].isin(CANON_L)].copy()
    d["ch"] = d["Channel"].map(CANON_L)
    d["month"] = d["Yr"].astype(str) + "-" + d["Mn"].astype(str).str.zfill(2)
    d = d[d["month"] == month]
    d["tvrprog"] = [slot.get((c, p)) for c, p in zip(d["Channel"], d["Program"])]
    d = d[d["tvrprog"].notna()]
    d["tvr"] = [avg[(c, p)] for c, p in zip(d["ch"], d["tvrprog"])]
    d["eq30"] = d["Dur"] / 30
    d["va"] = d["Advt_Theme"] == "Time Check"
    d["ngrp"] = d["tvr"] * d["eq30"]
    return d


def test_matching_and_30_second_maths(data):
    p, lm, tv, _ = data
    r = run(p / "lm.csv", p / "tv.csv", OPTS)
    got = {(m["channel"], m["lmrb_program"]): m["tvr_program"] for m in r["matches"]}
    expect = {(CANON_L[s[2]], s[3].upper()): s[1].upper() for s in mk.SLOTS}
    assert {k: v for k, v in got.items() if v} == expect
    assert got[("DERANA", "LATE NIGHT SHOW")] is None                       # no TVR programme at that time: left unmatched
    assert [c["channel"] for c in r["warnings"]["skipped_channels"]] == ["ITN"]       # a TV channel that is not in the TVR sheet
    assert r["tvr_channels"] == ["DERANA", "HIRU", "SIRASA"]                # radio never enters
    d = reference(lm, tv)
    com = d[~d["va"]]
    cur = r["current"]
    assert cur["com_spend"] == pytest.approx(com["Cost"].sum()) and cur["va_spend"] == pytest.approx(d[d["va"]]["Cost"].sum())
    assert cur["spots"] == len(com) and cur["eq30"] == pytest.approx(com["eq30"].sum())
    assert cur["ngrp"] == pytest.approx(com["ngrp"].sum()) and cur["cprp"] == pytest.approx(com["Cost"].sum() / com["ngrp"].sum())
    assert cur["avg30"] == pytest.approx(com["Cost"].sum() / com["eq30"].sum())
    for c in cur["channels"]:
        x = com[com["ch"] == c["channel"]]
        assert c["com_spend"] == pytest.approx(x["Cost"].sum()) and c["ngrp"] == pytest.approx(x["ngrp"].sum()) and c["avg30"] == pytest.approx(x["Cost"].sum() / x["eq30"].sum())


def test_rates_roi_and_negotiation(data):
    p, lm, tv, _ = data
    r = run(p / "lm.csv", p / "tv.csv", OPTS)
    rows = {(x["channel"], x["program"]): x for x in r["current"]["rows"]}
    assert rows[("HIRU", "HIRU MORNING")]["card30"] == pytest.approx(120000)         # a 10 sec rate x 3
    assert rows[("DERANA", "HUSMAK LAGIN")]["card30"] == 1000000                       # a programme rate beats the channel rate
    assert rows[("DERANA", "DERANA ARUNA")]["card30"] == 250000                        # non prime channel rate
    assert rows[("DERANA", "MAN ADAREI")]["card30"] == 900000 and rows[("DERANA", "MAN ADAREI")]["pt"]
    assert rows[("DERANA", "HUSMAK LAGIN")]["neg30"] == pytest.approx(550000)          # 45% off the card
    d = reference(lm, tv)
    com = d[~d["va"]].copy()
    card = {k: v["card30"] for k, v in rows.items()}
    com["tvrprog"] = com["tvrprog"].str.upper()
    com["value"] = [card[(c, pr)] * e for c, pr, e in zip(com["ch"], com["tvrprog"], com["eq30"])]
    der = r["current"]["channels"][[c["channel"] for c in r["current"]["channels"]].index("DERANA")]
    x = com[com["ch"] == "DERANA"]
    assert der["com_roi"] == pytest.approx(x["value"].sum() / x["Cost"].sum())
    # the sponsorship item is a different roi basis: all exposure adds it
    va = d[(d["ch"] == "DERANA") & d["va"]]
    va_value = sum(card[("DERANA", pr.upper())] * e for pr, e in zip(va["tvrprog"], va["eq30"]))
    assert der["all_roi"] == pytest.approx((x["value"].sum() + va_value) / (x["Cost"].sum() + va["Cost"].sum()))
    special = [c for c in r["candidates"] if c["program"] == "LAKSHAPATHI"][0]
    assert special["neg30"] == 280000 and special["cprp"] == pytest.approx(280000 / special["tvr"])


def test_plan_stays_inside_the_budget_and_buys_cheapest_first(data):
    p, lm, tv, _ = data
    r = run(p / "lm.csv", p / "tv.csv", {**OPTS, "max_spots": 3})
    plan = r["plan"]
    for ch, x in plan["channels"].items():
        assert x["spend"] <= x["budget"] + 1e-6 and x["budget"] == pytest.approx(r["budgets"][ch])
        assert x["budget"] == pytest.approx([c for c in r["current"]["channels"] if c["channel"] == ch][0]["com_spend"])      # same money as the current buy
        rows = [q for q in plan["rows"] if q["channel"] == ch]
        assert all(q["spots"] <= q["cap"] for q in rows) and sum(q["spend"] for q in rows) == pytest.approx(x["spend"])
        assert abs(sum(q["grp"] for q in rows) - x["grp"]) < 1e-6
        assert [q["cprp"] for q in rows] == sorted(q["cprp"] for q in rows)                     # cheapest rating points are bought first
        for q in rows:                                                                         # a programme below its limit means the money ran out
            if q["spots"] < q["cap"]:
                assert x["left"] < q["neg30"] + 1e-6
    t = plan["totals"]
    assert t["ngrp"] == pytest.approx(sum(q["grp"] for q in plan["rows"])) and t["cprp"] == pytest.approx(t["spend"] / t["ngrp"])
    assert r["comparison"]["grp_gain_pct"] == pytest.approx((t["ngrp"] / r["comparison"]["current"]["ngrp"] - 1) * 100)
    # switching a programme off removes it and cannot raise GRPs for free
    off = plan["rows"][0]["key"]
    r2 = run(p / "lm.csv", p / "tv.csv", {**OPTS, "max_spots": 3, "excluded": [off]})
    assert off not in [q["key"] for q in r2["plan"]["rows"]]
    assert r2["plan"]["totals"]["ngrp"] <= t["ngrp"] + 1e-6
    # a stricter minimum TVR drops candidates
    r3 = run(p / "lm.csv", p / "tv.csv", {**OPTS, "min_tvr": 5})
    assert all(c["tvr"] >= 5 for c in r3["candidates"]) and len(r3["candidates"]) < len(r["candidates"])


def test_manual_fix_month_and_daypart(data):
    p, lm, tv, _ = data
    r = run(p / "lm.csv", p / "tv.csv", OPTS)
    key = "DERANA|LATE NIGHT SHOW"
    husmak = [c for c in r["catalogue"]["DERANA"] if "HUSMAK" in c["label"]][0]["key"]
    assert r["warnings"]["unmatched_programmes"] == 1 and r["warnings"]["unmatched_list"][0]["lmrb_program"] == "LATE NIGHT SHOW"
    r2 = run(p / "lm.csv", p / "tv.csv", {**OPTS, "mappings": {key: husmak}})
    m = [x for x in r2["matches"] if x["key"] == key][0]
    assert m["method"] == "manual" and m["confidence"] == 100 and r2["warnings"]["unmatched_programmes"] == 0
    r3 = run(p / "lm.csv", p / "tv.csv", {**OPTS, "mappings": {key: "-"}})
    assert r3["warnings"]["unmatched_programmes"] == 0                      # ignored on purpose, not a warning
    aug = run(p / "lm.csv", p / "tv.csv", {**OPTS, "month": "2026-08"})
    assert aug["month"] == "2026-08" and r["month"] == "2026-09" and r["months"] == ["2026-08", "2026-09"]
    allm = run(p / "lm.csv", p / "tv.csv", {**OPTS, "month": "all"})
    assert allm["current"]["com_spend"] == pytest.approx(r["current"]["com_spend"] + aug["current"]["com_spend"])
    d = reference(lm, tv, "2026-08")
    assert aug["current"]["com_spend"] == pytest.approx(d[~d["va"]]["Cost"].sum())
    pt = run(p / "lm.csv", p / "tv.csv", {**OPTS, "daypart": "PT"})
    assert pt["current"]["rows"] and all(x["pt"] for x in pt["current"]["rows"])
    npt = run(p / "lm.csv", p / "tv.csv", {**OPTS, "daypart": "NPT"})
    assert pt["current"]["com_spend"] + npt["current"]["com_spend"] == pytest.approx(r["current"]["com_spend"])
    # a different prime window moves programmes between the two groups
    wide = run(p / "lm.csv", p / "tv.csv", {**OPTS, "pt_start": 12 * 3600, "pt_end": 23 * 3600})
    assert wide["current"]["daypart"]["prime"]["spend"] > r["current"]["daypart"]["prime"]["spend"]


def test_column_remap(data, tmp_path):
    p, lm, tv, _ = data
    odd = lm.rename(columns={"Channel": "Station", "Cost": "Amount (LKR)"})
    odd.to_csv(tmp_path / "odd.csv", index=False)
    base = run(p / "lm.csv", p / "tv.csv", OPTS)
    bad = subprocess.run(["node", str(ROOT / "tests/js/pitch.js"), str(tmp_path / "odd.csv"), str(p / "tv.csv"), "{}"], capture_output=True, text=True)
    assert bad.returncode != 0 and "Missing required columns" in bad.stderr              # the automatic match fails ...
    fixed = run(tmp_path / "odd.csv", p / "tv.csv", OPTS, {"channel": "Station", "cost": "Amount (LKR)"})
    assert fixed["current"]["com_spend"] == pytest.approx(base["current"]["com_spend"]) and fixed["current"]["ngrp"] == pytest.approx(base["current"]["ngrp"])      # ... and the user's choice works


def test_pitch_exports(data):
    from helpers import api
    p, *_ = data
    r = run(p / "lm.csv", p / "tv.csv", OPTS)
    cur = r["current"]
    body = {"comparison": {**r["comparison"], "plan": r["plan"]["totals"]}, "current": {"totals": r["comparison"]["current"], "channels": cur["channels"], "rows": cur["rows"], "sponsorship": cur["sponsorship"], "daypart": cur["daypart"]},
            "plan": {"rows": r["plan"]["rows"], "channels": r["plan"]["channels"], "totals": r["plan"]["totals"]}, "warnings": r["warnings"], "settings": r["settings"], "month": r["month"], "meta": {"client": "Sampath Bank"}}
    c = api()
    pdf = c.post("/api/pitch/pdf", json=body)
    assert pdf.status_code == 200 and pdf.content[:5] == b"%PDF-" and pdf.headers["x-report-id"]
    text = " ".join(" ".join(pg.extract_text().split()) for pg in pytest.importorskip("pypdf").PdfReader(io.BytesIO(pdf.content)).pages)
    for s in ("Client Pitch Evaluation", "1. Current agency vs our plan", "Total GRPs (30 sec)", "2. Current evaluation by channel", "3. Our recommended basket", "4. What the current agency bought", "Husmak Lagin", "Derana"):
        assert s in text, s
    assert r["comparison"]["sentence"].split(".")[0][:12] in text
    assert "—" not in text and "TimesFM" not in text
    docx = c.post("/api/pitch/docx", json=body)
    assert docx.status_code == 200 and docx.content[:2] == b"PK"
    from docx import Document
    words = " ".join(par.text for par in Document(io.BytesIO(docx.content)).paragraphs) + " ".join(cell.text for t in Document(io.BytesIO(docx.content)).tables for row in t.rows for cell in row.cells)
    assert "Client Pitch Evaluation" in words and "Total GRPs" in words
    assert c.post("/api/pitch/pdf", json={"comparison": {}}).status_code == 422


def test_sponsorship_is_grouped_by_channel_and_item(data):
    p, lm, tv, _ = data
    r = run(p / "lm.csv", p / "tv.csv", OPTS)
    rows = r["current"]["sponsorship"]
    assert len({(x["channel"], x["theme"]) for x in rows}) == len(rows)                      # one line per channel and item
    d = reference(lm, tv)
    va = d[d["va"] & (d["ch"] == "DERANA")]
    x = [q for q in rows if q["channel"] == "DERANA" and q["theme"] == "Time Check"][0]
    mins = lambda hm: int(hm[:2]) * 60 + int(hm[3:5])  # noqa: E731
    is_pt = lambda hm: 19 * 60 <= mins(hm) < 22 * 60 + 30  # noqa: E731
    t = tv[tv["Channel"] == "Tv - Derana"]
    pt_avg = t[t["Start"].map(is_pt)]["TVR"].mean()
    npt_avg = t[~t["Start"].map(is_pt)]["TVR"].mean()
    n_pt = int(va["Prog_time"].map(is_pt).sum())
    assert x["spots"] == len(va) and x["spots_per_month"] == len(va) and x["spend"] == pytest.approx(va["Cost"].sum()) and x["avg_cost"] == pytest.approx(va["Cost"].mean())
    assert x["pt_spots"] == n_pt and x["avg_pt_tvr"] == pytest.approx(pt_avg) and x["avg_npt_tvr"] == pytest.approx(npt_avg)
    tvr = (n_pt * pt_avg + (len(va) - n_pt) * npt_avg) / len(va)
    assert x["tvr"] == pytest.approx(tvr) and x["grp"] == pytest.approx(tvr * len(va)) and x["ngrp"] == pytest.approx(tvr * va["eq30"].sum())
    allm = run(p / "lm.csv", p / "tv.csv", {**OPTS, "month": "all"})
    y = [q for q in allm["current"]["sponsorship"] if q["channel"] == "DERANA" and q["theme"] == "Time Check"][0]
    assert y["spots_per_month"] == pytest.approx(y["spots"] / 2)                                # two months uploaded
