"""Deep Negotiation & Brand Intelligence hub: browser engine numbers checked against pandas, and the PDF endpoint."""
import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

import synth
from app.services import normalise as nz

ROOT = Path(__file__).resolve().parent.parent
needs_node = pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
KEY = ["Advertiser", "Product", "Advt_Theme", "ch", "t", "Advt_time", "BrkNo", "PosinBrk", "AdPos", "Cost"]


def node(sheet, opts):
    out = subprocess.run(["node", str(ROOT / "tests/js/negotiation.js"), str(sheet), json.dumps(opts)], capture_output=True, text=True, timeout=240)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


@pytest.fixture(scope="module")
def sheet(tmp_path_factory):
    lm = synth.make_lmrb(days=90, start="2026-05-01", seed=5)
    p = tmp_path_factory.mktemp("neg") / "lm.csv"
    lm.to_csv(p, index=False)
    df = lm.copy()
    df["ch"] = df["Channel"].map(lambda c: nz.normalise_channel(c)[0])
    df["t"] = pd.to_datetime(dict(year=df["Yr"], month=df["Mn"], day=df["Dd"]))
    return p, df.drop_duplicates(subset=KEY).reset_index(drop=True)


@needs_node
def test_hierarchy_matches_pandas(sheet):
    p, df = sheet
    rebate, thr = 2_000_000, 15
    d = node(p, {"rebate_threshold": rebate, "clutter_threshold": thr, "max_brands": 50, "max_themes": 50})
    assert d["totals"]["spots"] == len(df)
    assert d["totals"]["spend"] == pytest.approx(df["Cost"].sum())
    ch = df.groupby("ch")["Cost"].sum()
    adv_tot = df.groupby("Advertiser")["Cost"].sum()
    for c in d["channels"]:
        sub = df[df["ch"] == c["name"]]
        assert c["spend"] == pytest.approx(ch[c["name"]])
        assert c["spots"] == len(sub)
        assert c["avg_clutter"] == pytest.approx(sub["AdsinBrk"].mean())
        assert c["first_pct"] == pytest.approx((sub["PosinBrk"] == 1).mean() * 100)
        for b in c["brands"]:
            sb = sub[sub["Advertiser"] == b["name"]]
            assert b["spend"] == pytest.approx(sb["Cost"].sum())
            assert b["sow"] == pytest.approx(sb["Cost"].sum() / adv_tot[b["name"]] * 100)
            assert b["share_of_channel"] == pytest.approx(sb["Cost"].sum() / ch[c["name"]] * 100)
            assert b["rebate_eligible"] == (sb["Cost"].sum() >= rebate)
            for t in b["themes"]:
                st = sb[sb["Advt_Theme"] == t["name"]]
                assert t["spots"] == len(st)
                assert t["spend"] == pytest.approx(st["Cost"].sum())
                assert t["first_seen"] == str(st["t"].min().date()) and t["last_seen"] == str(st["t"].max().date())
    # leverage flags
    rb = {(l["channel"], l["advertiser"]) for l in d["leverage"] if l["type"] == "rebate"}
    exp = {k for k, v in df.groupby(["ch", "Advertiser"])["Cost"].sum().items() if v >= rebate}
    assert rb == exp and rb
    for l in d["leverage"]:
        if l["type"] == "rebate":
            assert "Retroactive Volume Discount Opportunity (10-15%)" in l["text"]
            assert l["est_low"] == pytest.approx(l["spend"] * 0.10) and l["est_high"] == pytest.approx(l["spend"] * 0.15)
        else:
            assert l["avg_clutter"] > thr and "3 free bonus spots" in l["text"]


@needs_node
def test_matrix_and_vulnerability(sheet):
    p, df = sheet
    d = node(p, {"clutter_threshold": 20})
    m = d["matrix"]
    adv_tot = df.groupby("Advertiser")["Cost"].sum()
    for i, a in enumerate(m["rows"]):
        assert sum(m["spend"][i]) <= adv_tot[a] + 1e-6
        for j, c in enumerate(m["cols"]):
            v = df[(df["Advertiser"] == a) & (df["ch"] == c)]["Cost"].sum()
            assert m["spend"][i][j] == pytest.approx(v)
            assert (m["sow"][i][j] or 0) == pytest.approx(v / adv_tot[a] * 100)
    # vulnerability index computed independently
    ads, pos = df["AdsinBrk"].astype(float), df["PosinBrk"].astype(float)
    depth = np.where(ads > 2, np.minimum(pos - 1, ads - pos) / ((ads - 1) / 2), 0).clip(0, 1)
    vuln = (np.minimum(1, ads / 20) * depth).mean() * 100
    assert d["totals"]["vulnerability"] == pytest.approx(vuln, rel=1e-6)
    assert 0 <= d["totals"]["vulnerability"] <= 100


@needs_node
def test_filters_cascade(sheet):
    p, df = sheet
    one = sorted(df["ch"].unique())[0]
    d = node(p, {"channels": [one], "advertisers": ["Nestle Lanka Ltd"]})
    sub = df[(df["ch"] == one) & (df["Advertiser"] == "Nestle Lanka Ltd")]
    assert [c["name"] for c in d["channels"]] == [one]
    assert d["totals"]["spend"] == pytest.approx(sub["Cost"].sum())
    assert set(d["options"]["themes"]) == set(sub["Advt_Theme"])
    assert len(d["options"]["channels"]) == df["ch"].nunique()  # channel options are never narrowed
    pg = node(p, {"product_group": "Beverages"})
    assert pg["totals"]["spend"] == pytest.approx(df[df["Product_Group"] == "Beverages"]["Cost"].sum())
    assert node(p, {"advertisers": ["Nobody"]})["totals"]["spend"] > 0  # unknown names are ignored, not zeroed
    assert node(p, {"themes": ["Knorr Family (30)(Eng)"], "advertisers": ["Nestle Lanka Ltd"]})["empty"] is True


@needs_node
def test_shift_to_short_spots_detected(tmp_path):
    lm = synth.make_lmrb(days=60, start="2026-05-01", seed=9)
    t = pd.to_datetime(dict(year=lm["Yr"], month=lm["Mn"], day=lm["Dd"]))
    nest = lm["Advertiser"] == "Nestle Lanka Ltd"
    lm.loc[nest & (t < t.min() + pd.Timedelta(days=30)), "Dur"] = 30
    lm.loc[nest & (t >= t.min() + pd.Timedelta(days=30)), "Dur"] = 10
    p = tmp_path / "s.csv"; lm.to_csv(p, index=False)
    d = node(p, {})
    s = next(x for x in d["shifts"] if x["advertiser"] == "Nestle Lanka Ltd")
    assert s["change_pts"] > 80 and "short" in s["tactic"]


@needs_node
def test_pdf_endpoint(sheet):
    import io
    from helpers import api
    p, _ = sheet
    hub = node(p, {"rebate_threshold": 2_000_000, "clutter_threshold": 15})
    c = api()
    r = c.post("/api/negotiation/pdf", json={"hub": hub, "meta": {"dataset": "lm.csv", "filters": ["Spot type: commercial"]}})
    assert r.status_code == 200 and r.content[:5] == b"%PDF-" and r.headers["x-report-id"]
    assert c.get("/api/reports").json()[0]["format"] == "pdf"
    assert c.post("/api/negotiation/pdf", json={"hub": {"empty": True}}).status_code == 422
    pdf = pytest.importorskip("pypdf").PdfReader(io.BytesIO(r.content))
    text = " ".join(pg.extract_text() for pg in pdf.pages)
    assert len(pdf.pages) >= 3
    for s in ("Negotiation highlights", "Retroactive Volume Discount Opportunity (10-15%)", "3 free bonus spots", "Share of wallet matrix", "Level 1: channels", "DERANA"):
        assert s in text, s
    assert "\u2014" not in text
