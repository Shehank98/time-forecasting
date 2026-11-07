"""Client Pitch Evaluator: matching, 30 sec maths, ROI, plan and exports, against independent pandas calculations on the sample data."""
import datetime as dt
import io
import json
import re
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


def test_same_slot_programmes_are_one_row_matched_once(data, tmp_path):
    p, lm, tv, _ = data
    mv = lm.copy()
    m = mv["Program"] == "Sunday Movie Special"
    names = ["Movie Alpha", "Movie Beta", "Movie Gamma"]
    mv.loc[m, "Program"] = [names[i % 3] for i in range(int(m.sum()))]            # three different titles in the same weekend movie belt
    mv.to_csv(tmp_path / "mv.csv", index=False)
    r = run(tmp_path / "mv.csv", p / "tv.csv", OPTS)
    slot = [s for s in r["slots"] if s["channel"] == "DERANA" and s["n_names"] == 3]
    assert len(slot) == 1 and sorted(n["name"] for n in slot[0]["names"]) == sorted(n.upper() for n in names)
    s = slot[0]
    assert s["tvr_program"] == "WEEKEND MOVIE" and s["level"] == "High" and not s["approved"] and s["start"] == "12:30" and s["days"] == "Sat-Sun"
    assert {x["tvr_program"] for x in r["matches"] if x["slot"] == s["key"]} == {"WEEKEND MOVIE"}            # every title follows the slot
    assert sum(x["spots"] for x in r["matches"] if x["slot"] == s["key"]) == s["spots"]
    assert len(r["slots"]) < len(r["matches"])                                                           # fewer rows to check than programmes
    # approving keeps it; correcting the slot moves every title in it
    ok = run(tmp_path / "mv.csv", p / "tv.csv", {**OPTS, "mappings": {"SLOT|" + s["key"]: s["tvr_key"]}})
    assert [x for x in ok["slots"] if x["key"] == s["key"]][0]["approved"]
    husmak = [c for c in r["catalogue"]["DERANA"] if "HUSMAK" in c["label"]][0]["key"]
    moved = run(tmp_path / "mv.csv", p / "tv.csv", {**OPTS, "mappings": {"SLOT|" + s["key"]: husmak}})
    assert {x["tvr_program"] for x in moved["matches"] if x["slot"] == s["key"]} == {"HUSMAK LAGIN"}
    ign = run(tmp_path / "mv.csv", p / "tv.csv", {**OPTS, "mappings": {"SLOT|" + s["key"]: "-"}})
    assert [x for x in ign["slots"] if x["key"] == s["key"]][0]["ignored"] and "WEEKEND MOVIE" not in {x["program"] for x in ign["current"]["rows"]}


def test_optimiser_goals(data):
    p, *_ = data
    base = {**OPTS, "max_spots": 3}
    g = run(p / "lm.csv", p / "tv.csv", {**base, "objective": "grp"})["plan"]
    r = run(p / "lm.csv", p / "tv.csv", {**base, "objective": "roi"})["plan"]
    b = run(p / "lm.csv", p / "tv.csv", {**base, "objective": "balanced"})["plan"]
    for x in (g, r, b):
        assert all(c["spend"] <= c["budget"] + 1e-6 for c in x["channels"].values())
    assert r["totals"]["roi"] >= g["totals"]["roi"] - 1e-9                       # asking for ROI never gives a lower ROI ...
    assert g["totals"]["ngrp"] >= r["totals"]["ngrp"] - 1e-9                     # ... and asking for GRPs never gives fewer GRPs
    assert min(g["totals"]["ngrp"], r["totals"]["ngrp"]) - 1e-9 <= b["totals"]["ngrp"] <= max(g["totals"]["ngrp"], r["totals"]["ngrp"]) + 1e-9
    assert r["totals"]["roi"] > g["totals"]["roi"] or r["rows"] == g["rows"]    # the special-rate programme has the best value per rupee


@pytest.mark.skipif(shutil.which("soffice") is None, reason="LibreOffice is not installed")
def test_evaluation_workbook_formulas_calculate(data, tmp_path):
    """The workbook is written with formulas. A spreadsheet program recalculates every one and must land on the same numbers as the cached values and the engine."""
    import openpyxl
    p, *_ = data
    o = {"rates": {"channels": OPTS["rates"]["channels"]}}                                                   # every programme has a rate, so ROI uses all spend
    proc = subprocess.run(["node", str(ROOT / "tests/js/pitch_xlsx.js"), str(p / "lm.csv"), str(p / "tv.csv"), json.dumps(o), str(tmp_path / "ev")], capture_output=True, text=True, timeout=240)
    assert proc.returncode == 0, proc.stderr
    meta = json.loads(proc.stdout)
    assert meta["sheets"] == ["Summary", "DERANA", "SIRASA", "HIRU", "Formulas"]
    subprocess.run(["soffice", "--headless", "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", str(tmp_path / "calc"), str(tmp_path / "ev_nocache.xlsx")], capture_output=True, timeout=180)
    cached, calc, formulas = (openpyxl.load_workbook(tmp_path / "ev_cached.xlsx", data_only=True), openpyxl.load_workbook(tmp_path / "calc/ev_nocache.xlsx", data_only=True), openpyxl.load_workbook(tmp_path / "ev_cached.xlsx"))
    n = 0
    for ws in cached:
        for row in ws.iter_rows():
            for c in row:
                if isinstance(c.value, (int, float)):
                    n += 1
                    v = calc[ws.title][c.coordinate].value
                    assert isinstance(v, (int, float)) and abs(v - c.value) <= 1e-6 * max(1, abs(c.value)), (ws.title, c.coordinate, c.value, v)
    assert n > 200
    assert sum(1 for ws in formulas for row in ws.iter_rows() for c in row if isinstance(c.value, str) and c.value.startswith("=")) > 150          # real formulas, not pasted numbers
    S = calc["Summary"]
    hdr = {str(c.value).strip(): i for i, c in enumerate(S[2]) if c.value}
    assert list(hdr)[:17] == ["Channel", "Total Investment", "Total Rate Card (all Expo)", "Com Only", "C ROI%", "ROI%", "Com Only GRPs", "Com Only NGRPs", "Com Only CPRP", "Com Only N CPRP", "Total GRPs", "Total NGRPs",
                              "CPRP All Expo", "NCPRP - 30 Sec All Expo", "Total Number of Spots", "Total Number of V/A", "Total Exposures"]
    summ = {}
    for r in S.iter_rows(min_row=3):
        if r[0].value:
            summ[r[0].value] = [x.value for x in r]
        if r[0].value == "TV ":
            break                                                                                                  # below it comes the CPRP table, which repeats the channel names
    for c in meta["channels"]:
        row = summ[c["channel"]]
        g = lambda name: row[hdr[name]]  # noqa: E731
        assert g("Total Investment") == pytest.approx(c["spend"]) and g("C ROI%") == pytest.approx(c["com_roi"]) and g("ROI%") == pytest.approx(c["all_roi"])
        assert g("Com Only NGRPs") == pytest.approx(c["ngrp"]) and g("Com Only GRPs") == pytest.approx(c["grp"]) and g("Commercial Cost") == pytest.approx(c["com_spend"])
        assert g("Com Only CPRP") == pytest.approx(c["com_spend"] / c["grp"]) and g("Com Only N CPRP") == pytest.approx(c["cprp"])                       # cost per rating point, and on a 30 second basis
        assert g("Total Exposures") == g("Total Number of Spots") + g("Total Number of V/A") == c["com_spots"] + c["va_spots"]
    assert summ["TV "][hdr["Total Investment"]] == pytest.approx(sum(c["spend"] for c in meta["channels"]))
    # under the summary: the CPRP of every channel, company only and all exposure
    start = [i for i, r in enumerate(S.iter_rows(values_only=True), 1) if r[0] and str(r[0]).startswith("CPRP BY CHANNEL")][0]
    head = [c.value for c in S[start + 1]][:7]
    assert head == ["Channel", "Com Only CPRP", "Com Only NCPRP (30 sec)", "All Exposure CPRP", "All Exposure NCPRP (30 sec)", "Com Only GRPs", "All Exposure GRPs"]
    cp = {r[0].value: [x.value for x in r] for r in S.iter_rows(min_row=start + 2, max_row=start + 1 + len(meta["channels"]) + 1) if r[0].value}
    for c in meta["channels"]:
        assert cp[c["channel"]][2] == pytest.approx(c["cprp"]) and cp[c["channel"]][1] == pytest.approx(c["com_spend"] / c["grp"]) and cp[c["channel"]][5] == pytest.approx(c["grp"])
    assert "TV " in cp
    f = {r[0].value: r[1].value for r in calc["Formulas"].iter_rows(min_row=3, max_row=5)}
    assert f == {"Base seconds": 30, "SSCL rate": 0.025, "VAT rate": 0.18}
    # a channel sheet is laid out like the agency sheets: number of spots straight after DUR, rates per spot at the row's duration, real time cells, comma style money, plain number GRPs and TVR
    d, dc = calc["DERANA"], cached["DERANA"]
    assert [c.value for c in d[8]][2:17] == ["DESCRIPTION", "DAY", "TIME BELT", None, "DUR", "NUMBER OF SPOTS", "TVR", "GRP", "NGRP", "CPRP", "NCPRP", "RATE CARD RATE", "NEGOTIATED RATE", "TOTAL VALUE", "TOTAL COST"]
    assert [c.value for c in d[2]][2:4] == ["CLIENT :", "SAMPATH BANK"] and [c.value for c in d[5]][2:4] == ["CHANNEL :", "DERANA"]
    fm = formulas["DERANA"]
    husmak = [r for r in range(9, d.max_row) if d.cell(r, 3).value == "HUSMAK LAGIN"][0]
    assert fm.cell(husmak, 10).value == f"=I{husmak}*H{husmak}" and fm.cell(husmak, 16).value == f"=N{husmak}*H{husmak}" and fm.cell(husmak, 17).value == f"=O{husmak}*H{husmak}"
    assert re.fullmatch(r"=\([0-9.]+/Formulas!\$B\$3\)\*G\d+", fm.cell(husmak, 14).value) and re.fullmatch(r"=\([0-9.]+/Formulas!\$B\$3\)\*G\d+", fm.cell(husmak, 15).value)      # rate per spot = 30 sec rate / 30 x DUR
    nf = lambda col: fm.cell(husmak, col).number_format  # noqa: E731
    assert nf(9) == "0.00" and nf(10) == "#,##0.00" and nf(11) == "#,##0.00"                                       # TVR and GRPs: Number
    assert nf(12).startswith("_(* #,##0.00_)") and nf(13).startswith("_(* #,##0.00_)")                              # CPRP and NCPRP: Comma Style
    assert nf(14).startswith("_(* #,##0_)") and nf(15).startswith("_(* #,##0_)") and nf(16).startswith("_(* #,##0_)") and nf(17).startswith("_(* #,##0_)")      # rates, value, cost: Comma Style
    assert isinstance(dc.cell(husmak, 5).value, (dt.time, dt.datetime)) and nf(5) == "h:mm"                          # the time belt is a real time
    assert S.cell(3, 2).number_format.startswith("_(* #,##0_)") and S.cell(3, 9).number_format.startswith("_(* #,##0.00_)") and S.cell(3, 7).number_format == "#,##0.00"
    inv = [r for r in d.iter_rows() if r[2].value and str(r[2].value).startswith("ACTUAL INVESTMENT")][0][15].value
    gt = [r for r in d.iter_rows() if r[2].value == "GRAND TOTAL"][0][15].value
    assert gt == pytest.approx(inv / 0.975 + inv / 0.975 * 0.18)                                           # the agency's tax method


@pytest.mark.skipif(shutil.which("soffice") is None, reason="LibreOffice is not installed")
def test_deal_block_in_the_evaluation_workbook(data, tmp_path):
    """The contract's investment, commercial share and prime split sit beside the channel sheet and are compared with what the spots add up to."""
    import openpyxl
    p, *_ = data
    o = {"rates": {"channels": OPTS["rates"]["channels"]}, "deals": {"DERANA": {"investment": 20_000_000, "commercial_pct": 80, "prime_pct": 50}}}
    proc = subprocess.run(["node", str(ROOT / "tests/js/pitch_xlsx.js"), str(p / "lm.csv"), str(p / "tv.csv"), json.dumps(o), str(tmp_path / "dl")], capture_output=True, text=True, timeout=240)
    assert proc.returncode == 0, proc.stderr
    subprocess.run(["soffice", "--headless", "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", str(tmp_path / "calc"), str(tmp_path / "dl_nocache.xlsx")], capture_output=True, timeout=180)
    cached, calc = openpyxl.load_workbook(tmp_path / "dl_cached.xlsx", data_only=True), openpyxl.load_workbook(tmp_path / "calc/dl_nocache.xlsx", data_only=True)
    for ws in cached:
        for row in ws.iter_rows():
            for c in row:
                if isinstance(c.value, (int, float)):
                    v = calc[ws.title][c.coordinate].value
                    assert isinstance(v, (int, float)) and abs(v - c.value) <= 1e-6 * max(1, abs(c.value)), (ws.title, c.coordinate, c.value, v)
    d = calc["DERANA"]
    side = [r for r in d.iter_rows() if r[19].value]                                                      # column T
    k = [i for i, r in enumerate(side) if r[19].value == "PLANNED AGAINST BUDGET"][0]
    lab = {}
    for r in side[:k]:
        lab.setdefault(str(r[19].value), r)                                                              # the budget block
    assert lab["Investment (contract)"][22].value == 20_000_000
    assert lab["Commercial benefits (share of the investment)"][21].value == pytest.approx(0.8) and lab["Commercial benefits (share of the investment)"][22].value == pytest.approx(16_000_000)
    assert lab["Sponsorship / frequency items (the rest)"][22].value == pytest.approx(4_000_000)
    assert lab["Prime time (of the commercial benefits)"][22].value == pytest.approx(8_000_000) and lab["Non prime time"][22].value == pytest.approx(8_000_000)
    com = [r for r in d.iter_rows() if r[2].value == "COMMERCIAL VALUE"][0]
    band = {"PT": 0.0, "NPT": 0.0}
    for r in d.iter_rows(min_row=9):
        if r[17].value in band:
            band[r[17].value] += r[16].value or 0
    assert sum(band.values()) == pytest.approx(com[16].value)
    lines = {str(r[19].value): r for r in side[k + 1:]}
    # "Planned against budget" lines: budget (V), planned (W), balance (X)
    byname = {n: (lines[n][21].value, lines[n][22].value, lines[n][23].value) for n in ("Commercial benefits", "Prime time", "Non prime time", "Sponsorship / frequency items")}
    assert byname["Commercial benefits"][1] == pytest.approx(com[16].value) and byname["Prime time"][1] == pytest.approx(band["PT"]) and byname["Non prime time"][1] == pytest.approx(band["NPT"])
    assert all(b[2] == pytest.approx(b[0] - b[1]) for b in byname.values())
    assert lines["Discount vs rate card (commercial)"][22].value == pytest.approx(1 - 16_000_000 / com[15].value)
    S = calc["Summary"]
    hdr = {str(c.value).strip(): i for i, c in enumerate(S[2]) if c.value}
    row = [r for r in S.iter_rows(min_row=3) if r[0].value == "DERANA"][0]
    assert row[hdr["Actual Investment"]].value == 20_000_000 and row[hdr["Commercial % of Investment"]].value == pytest.approx(0.8) and row[hdr["Discount vs Rate Card (Com)"]].value == pytest.approx(1 - 16_000_000 / com[15].value)
    assert [r for r in S.iter_rows(min_row=3) if r[0].value == "SIRASA"][0][hdr["Actual Investment"]].value in (None, 0)           # no deal: blank
    assert d.cell(8, 18).value == "BAND"
