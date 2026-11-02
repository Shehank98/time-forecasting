"""Programme & Sponsorship Spotlight: browser engine numbers checked against an independent pandas calculation."""
import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

import synth
from app.services import normalise as nz
from app.services.analytics_lmrb import is_sponsor_theme

ROOT = Path(__file__).resolve().parent.parent
pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
KEY = ["Advertiser", "Product", "Advt_Theme", "ch", "t", "Advt_time", "BrkNo", "PosinBrk", "AdPos", "Cost"]
PROG = "TELEDRAMA NIGHT"


def node(op, sheet, opts=None):
    out = subprocess.run(["node", str(ROOT / "tests/js/spotlight.js"), op, str(sheet), json.dumps(opts or {})], capture_output=True, text=True, timeout=240)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def billboard(t):
    x = str(t).strip().lower()
    return is_sponsor_theme(t) and (x in ("com break", "next card") or x.endswith(("-bb", "-intro", "-extro")))


def expected_roles(sub):
    sp = sub[sub["sp"]].groupby("Advertiser").agg(spend=("Cost", "sum"), bb=("bb", "sum"))
    tot = sp["spend"].sum()
    with_bb = sp[sp["bb"] > 0]
    title = with_bb["spend"].idxmax() if len(with_bb) and with_bb["spend"].max() >= 0.25 * tot else None
    out = {}
    for a in sub["Advertiser"].unique():
        if a not in sp.index:
            out[a] = "Regular Spot"
        elif sp.loc[a, "bb"] > 0:
            out[a] = "Title Sponsor" if a == title else "Co-Sponsor"
        else:
            out[a] = "Logo Placement"
    return out


@pytest.fixture(scope="module")
def sheet(tmp_path_factory):
    lm = synth.make_lmrb(days=70, start="2026-06-01", seed=13)
    t = pd.to_datetime(dict(year=lm["Yr"], month=lm["Mn"], day=lm["Dd"]))
    tele = lm[(lm["Program"] == "Teledrama Night") & (lm["Channel"] == "Tv - Derana")]
    # Lanka Tea Co buys the opening billboard of every Teledrama Night on Derana: the title sponsor
    tea = tele.drop_duplicates(subset=["Dd", "Mn", "Yr"]).assign(Advertiser="Lanka Tea Co", Product="Island Tea", Advt_Theme="Teledrama Night -Intro",
                                                               Dur=10, Cost=150000, PosinBrk=1, AdsinBrk=6, AdPos=1, BrkNo=0)
    # Ceylon Biscuits only runs a logo tag: logo placement
    logo = tele.head(12).assign(Advertiser="Ceylon Biscuits", Product="Lemon Puff", Advt_Theme="Tag", Dur=5, Cost=8000, BrkNo=9)
    # a finale: one date with eight times the usual spots
    fin_day = t[tele.index].max()
    fin = tele[t[tele.index] == fin_day]
    finale = pd.concat([fin.assign(AdPos=fin["AdPos"] + 100 * k, Cost=fin["Cost"] + k) for k in range(1, 8)])
    # one special placement: a 120 second spot at 40x the usual cost
    special = tele.head(1).assign(Advertiser="Ceylon Foods", Product="Spice Pot", Advt_Theme="Spice Pot Story (120)", Dur=120, Cost=tele["Cost"].median() * 40, BrkNo=7)
    df = pd.concat([lm, tea, logo, finale, special], ignore_index=True)
    p = tmp_path_factory.mktemp("spot") / "lm.csv"
    df.to_csv(p, index=False)
    df["ch"] = df["Channel"].map(lambda c: nz.normalise_channel(c)[0])
    df["t"] = pd.to_datetime(dict(year=df["Yr"], month=df["Mn"], day=df["Dd"]))
    df["prog"] = df["Program"].str.strip().str.upper()
    df = df.drop_duplicates(subset=KEY).reset_index(drop=True)
    df["sp"] = df["Advt_Theme"].map(is_sponsor_theme)
    df["bb"] = df["Advt_Theme"].map(billboard)
    return p, df, str(fin_day.date())


def test_programme_index(sheet):
    p, df, _ = sheet
    d = node("index", p)
    ref = df.groupby(["ch", "prog"])["Cost"].sum()
    assert d["total"] == len(ref)
    for x in d["programmes"]:
        assert x["spend"] == pytest.approx(ref[(x["channel"], x["program"])])
    assert [x["spend"] for x in d["programmes"]] == sorted((x["spend"] for x in d["programmes"]), reverse=True)


def test_programme_spotlight_matches_pandas(sheet):
    p, df, fin = sheet
    d = node("programme", p, {"program": PROG, "channel": "DERANA"})
    sub = df[(df["prog"] == PROG) & (df["ch"] == "DERANA")]
    t = d["totals"]
    assert t["spend"] == pytest.approx(sub["Cost"].sum()) and t["spots"] == len(sub)
    assert t["sponsor_spend"] == pytest.approx(sub.loc[sub["sp"], "Cost"].sum())
    assert t["special_spots"] == 1
    assert t["episodes"] == sub["t"].nunique()
    assert t["fib_pct"] == pytest.approx((sub["PosinBrk"] == 1).mean() * 100)
    roles = {b["name"]: b["role"] for b in d["brands"]}
    assert roles == expected_roles(sub)
    assert roles["Lanka Tea Co"] == "Title Sponsor" and roles["Ceylon Biscuits"] == "Logo Placement" and "Co-Sponsor" in roles.values()
    f = d["focus"]
    assert f["name"] == "Lanka Tea Co"                      # the title sponsor is focused by default
    fs = sub[sub["Advertiser"] == "Lanka Tea Co"]
    assert f["spend"] == pytest.approx(fs["Cost"].sum()) and f["spots"] == len(fs)
    assert f["sov_spend"] == pytest.approx(fs["Cost"].sum() / sub["Cost"].sum() * 100)
    assert f["sponsor_spend"] + f["regular_spend"] + f["special_spend"] == pytest.approx(f["spend"])
    tl = d["timeline"]
    assert sum(tl["spots"]) == len(sub) and sum(tl["focus_spots"]) == len(fs)
    if tl["gran"] == "day":
        assert fin in [tl["labels"][j] for j in tl["peaks"]]
    lead = d["brief"][0]["text"]
    assert lead.startswith("Lanka Tea Co holds the primary sponsorship for Teledrama Night with a total investment of LKR")
    assert f"{len(fs):,} spots" in lead and "First-in-Break" in lead and "—" not in " ".join(x["text"] for x in d["brief"])
    # pick another brand and every channel airing the programme
    d2 = node("programme", p, {"program": PROG, "brand": "Nestle Lanka Ltd", "gran": "month"})
    s2 = df[df["prog"] == PROG]
    assert d2["focus"]["name"] == "Nestle Lanka Ltd" and d2["totals"]["spend"] == pytest.approx(s2["Cost"].sum())
    assert sorted(d2["channels"]) == sorted(s2["ch"].unique())
    assert [x["period"] for x in d2["focus"]["periods"]] == sorted(s2[s2["Advertiser"] == "Nestle Lanka Ltd"]["t"].dt.strftime("%Y-%m").unique())
    assert node("programme", p, {"program": "NO SUCH SHOW"})["empty"] is True


def test_matrix_rows_and_filters(sheet):
    p, df, _ = sheet
    d = node("matrix", p, {"limit": 5000})
    ref = df.groupby(["ch", "prog", "Advertiser"]).agg(spend=("Cost", "sum"), spots=("Cost", "size"), days=("t", "nunique"), clut=("AdsinBrk", "mean"))
    assert d["n_rows"] == len(ref)
    for r in d["rows"]:
        x = ref.loc[(r["channel"], r["program"], r["advertiser"])]
        assert r["spend"] == pytest.approx(x["spend"]) and r["spots"] == x["spots"]
        assert r["per_day"] == pytest.approx(x["spots"] / x["days"])
        assert r["avg_clutter"] == pytest.approx(x["clut"])
        assert sum(r["dur_split"].values()) + r["dur_unknown"] == r["spots"]
        assert 0 <= r["health"]["score"] <= 100
        assert r["health"]["score"] == sum(r["health"]["parts"].values()) or abs(r["health"]["score"] - sum(r["health"]["parts"].values())) <= 1
    # 10 second filter: only 8 to 12 second spots count
    d10 = node("matrix", p, {"dur": "10", "limit": 5000})
    s10 = df[(df["Dur"] >= 8) & (df["Dur"] <= 12)]
    assert sum(r["spots"] for r in d10["rows"]) == len(s10)
    assert all(r["dur_split"]["10s"] == r["spots"] for r in d10["rows"])
    # role tags come from all lengths and filter rows
    title = node("matrix", p, {"tag": "Title Sponsor"})
    assert any(r["advertiser"] == "Lanka Tea Co" and r["program"] == PROG for r in title["rows"]) and all(r["role"] == "Title Sponsor" for r in title["rows"])
    ch = node("matrix", p, {"channel": "SIRASA", "search": "nestle"})
    assert ch["rows"] and all(r["channel"] == "SIRASA" and r["advertiser"] == "Nestle Lanka Ltd" for r in ch["rows"])


def test_health_score_formula(sheet):
    p, df, _ = sheet
    d = node("matrix", p, {"limit": 5000, "clutter_threshold": 30})
    r = next(x for x in d["rows"] if x["commercial_cps"] and x["programme_cps"])
    h = r["health"]
    clutter = 40 * np.clip((30 - r["avg_clutter"]) / 25, 0, 1)
    position = 35 * np.clip(r["bumper_pct"] / 50, 0, 1)
    price = 25 * np.clip(1.5 - r["commercial_cps"] / r["programme_cps"], 0, 1)
    assert h["score"] == round(clutter + position + price)
    assert h["band"] == ("good" if h["score"] >= 65 else "fair" if h["score"] >= 40 else "poor")


def test_row_detail(sheet):
    p, df, _ = sheet
    d = node("row", p, {"channel": "DERANA", "program": PROG, "advertiser": "Lanka Tea Co"})
    sub = df[(df["ch"] == "DERANA") & (df["prog"] == PROG)]
    assert sum(x["spots"] for x in d["daily"]) == (sub["Advertiser"] == "Lanka Tea Co").sum()
    assert sum(x["programme_spots"] for x in d["daily"]) == len(sub)
    assert d["themes"][0]["type"] == "Billboard"
