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
    sponsors = set(sub[sub["sp"]]["Advertiser"])
    return {a: ("Sponsorship" if a in sponsors else "Regular Spot") for a in sub["Advertiser"].unique()}


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
    assert roles["Lanka Tea Co"] == "Sponsorship" and roles["Ceylon Biscuits"] == "Sponsorship" and "Regular Spot" in roles.values()
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
    assert lead.startswith("Lanka Tea Co has a sponsorship in Teledrama Night with a total investment of LKR")
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
    title = node("matrix", p, {"tag": "Sponsorship"})
    assert any(r["advertiser"] == "Lanka Tea Co" and r["program"] == PROG for r in title["rows"]) and all(r["role"] == "Sponsorship" for r in title["rows"])
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


def test_report_channel_programme_advertiser(sheet):
    p, df, _ = sheet
    opts = {"advertisers": ["Lanka Tea Co", "Nestle Lanka Ltd"], "date_from": "2026-06-15", "date_to": "2026-07-31", "channels": ["DERANA", "SIRASA"]}
    d = node("report", p, opts)
    win = df[(df["t"] >= "2026-06-15") & (df["t"] <= "2026-07-31") & df["ch"].isin(["DERANA", "SIRASA"])]
    sub = win[win["Advertiser"].isin(opts["advertisers"])]
    assert d["totals"]["spend"] == pytest.approx(sub["Cost"].sum()) and d["totals"]["spots"] == len(sub)
    assert d["range"] == ["2026-06-15", "2026-07-31"]
    assert d["period"][0] >= "2026-06-15" and d["period"][1] <= "2026-07-31"
    assert {c["channel"] for c in d["channels"]} == set(sub["ch"])
    for c in d["channels"]:
        assert c["spend"] == pytest.approx(sub[sub["ch"] == c["channel"]]["Cost"].sum())
        for pr in c["programmes"]:
            ps = sub[(sub["ch"] == c["channel"]) & (sub["prog"] == pr["program"])]
            allp = win[(win["ch"] == c["channel"]) & (win["prog"] == pr["program"])]
            assert pr["selected"]["spend"] == pytest.approx(ps["Cost"].sum())
            assert pr["programme_spend"] == pytest.approx(allp["Cost"].sum())       # whole programme, all advertisers
            assert pr["airing_days"] == allp["t"].nunique()
            roles = expected_roles(allp)                                           # roles judged on everyone in the programme
            for a in pr["advertisers"]:
                x = ps[ps["Advertiser"] == a["advertiser"]]
                assert a["advertiser"] in opts["advertisers"]
                assert a["spend"] == pytest.approx(x["Cost"].sum()) and a["spots"] == len(x)
                assert a["sponsor_spend"] == pytest.approx(x.loc[x["sp"], "Cost"].sum())
                assert a["sov_spend"] == pytest.approx(x["Cost"].sum() / allp["Cost"].sum() * 100)
                assert a["role"] == roles[a["advertiser"]], (c["channel"], pr["program"], a["advertiser"], allp[allp.sp].groupby("Advertiser").agg(spend=("Cost", "sum"), bb=("bb", "sum")).to_dict())
    tea = next(pr for c in d["channels"] if c["channel"] == "DERANA" for pr in c["programmes"] if pr["program"] == PROG)
    assert "Lanka Tea Co" in tea["sponsors"]
    adv = {a["advertiser"]: a for a in d["advertisers"]}
    assert set(adv) == set(opts["advertisers"]) and adv["Lanka Tea Co"]["sponsored"] >= 1
    m = d["monthly"]
    assert m["months"] == ["2026-06", "2026-07"]
    for r in m["rows"]:
        x = sub[sub["Advertiser"] == r["advertiser"]]
        assert [v["spend"] for v in r["values"]] == pytest.approx([x[x["t"].dt.strftime("%Y-%m") == mo]["Cost"].sum() for mo in m["months"]])
    assert d["briefs"] and all(b["points"] for b in d["briefs"])


def test_report_options_cascade(sheet):
    p, df, _ = sheet
    o = node("options", p, {"channels": ["DERANA"], "programs": [PROG], "date_from": "2026-07-01"})
    sub = df[(df["ch"] == "DERANA") & (df["prog"] == PROG) & (df["t"] >= "2026-07-01")]
    assert set(o["advertisers"]) == set(sub["Advertiser"])
    assert set(o["programs"]) == set(df[(df["ch"] == "DERANA") & (df["t"] >= "2026-07-01")]["prog"])
    assert len(o["channels"]) == df["ch"].nunique() and o["data_from"] == str(df["t"].min().date())
    assert node("report", p, {"date_from": "2030-01-01"})["empty"] is True


def test_report_pdf_endpoint(sheet):
    import io
    from helpers import api
    p, _, _ = sheet
    rep = node("report", p, {"advertisers": ["Lanka Tea Co", "Nestle Lanka Ltd"], "date_from": "2026-06-01", "date_to": "2026-07-31"})
    c = api()
    r = c.post("/api/spotlight/pdf", json={"report": rep, "meta": {"dataset": "lm.csv"}})
    assert r.status_code == 200 and r.content[:5] == b"%PDF-" and r.headers["x-report-id"]
    assert c.get("/api/reports").json()[0]["filename"].endswith(".pdf")
    assert c.post("/api/spotlight/pdf", json={"report": {"empty": True}}).status_code == 422
    pdf = pytest.importorskip("pypdf").PdfReader(io.BytesIO(r.content))
    text = " ".join(pg.extract_text() for pg in pdf.pages)
    for s in ("Programme & Sponsorship Report", "2026-06-01 to 2026-07-31", "Channel", "Teledrama Night", "Lanka Tea Co", "Sponsorship", "Sponsorship highlights",
              "has a sponsorship in", "Sponsorships and frequency buys", "Month by month", "Advertisers"):
        assert s in text, s
    assert "—" not in text


def test_frequency_buys(tmp_path):
    lm = synth.make_lmrb(days=40, start="2026-06-01", seed=4)
    base = lm[lm["Channel"] == "SIRASA"].drop_duplicates(subset=["Dd", "Mn", "Yr"]).head(20)
    # Lanka Tea Co runs the same 5 second tag 12 times a day on Sirasa for 20 days: a frequency buy
    tag = pd.concat([base.assign(Advertiser="Lanka Tea Co", Product="Island Tea", Advt_Theme="Island Tea Reminder (5)", Dur=5, Cost=9000 + k, AdPos=200 + k, BrkNo=20 + k) for k in range(12)])
    # same daily count but 30 seconds: not a frequency buy (too long)
    long_ = pd.concat([base.assign(Advertiser="Ceylon Foods", Product="Spice Pot", Advt_Theme="Spice Pot Long (30)", Dur=30, Cost=30000 + k, AdPos=300 + k, BrkNo=40 + k) for k in range(12)])
    # 10 second, but only 4 a day: not a frequency buy (too few)
    few = pd.concat([base.assign(Advertiser="Unilever Sri Lanka", Product="Knorr Cubes", Advt_Theme="Knorr Short (10)", Dur=10, Cost=12000 + k, AdPos=400 + k, BrkNo=60 + k) for k in range(4)])
    p = tmp_path / "f.csv"; pd.concat([lm, tag, long_, few], ignore_index=True).to_csv(p, index=False)
    d = node("list", p, {"channel": "SIRASA", "show": "all"})
    rows = {(r["advertiser"], r["theme"]): r for r in d["rows"]}
    t = rows[("Lanka Tea Co", "Island Tea Reminder (5)")]
    assert t["frequency"] and t["spots"] == 240 and t["days"] == 20 and t["daily_avg"] == pytest.approx(12) and t["length"] == 5 and "Frequency" in t["types"]
    assert not rows[("Ceylon Foods", "Spice Pot Long (30)")]["frequency"]
    assert not rows[("Unilever Sri Lanka", "Knorr Short (10)")]["frequency"]
    assert d["totals"]["frequency_buys"] == 1
    # the rule is editable: 4 a day now counts
    d2 = node("list", p, {"channel": "SIRASA", "show": "all", "min_daily": 4})
    assert {(r["advertiser"]) for r in d2["rows"] if r["frequency"]} >= {"Lanka Tea Co", "Unilever Sri Lanka"}
    # default view keeps only sponsorships and frequency buys
    d3 = node("list", p, {"channel": "SIRASA", "advertiser": "Lanka Tea Co"})
    assert d3["rows"] and all(r["sponsorship"] or r["frequency"] for r in d3["rows"])
    # matrix marks programme rows that carry the frequency buy, and the Frequency tag filters to them
    m = node("matrix", p, {"tag": "Frequency", "limit": 5000})
    assert m["rows"] and all(r["frequency"] for r in m["rows"]) and {r["advertiser"] for r in m["rows"]} == {"Lanka Tea Co"}


def test_list_matches_pandas(sheet):
    p, df, _ = sheet
    d = node("list", p, {"channel": "DERANA", "show": "all", "limit": 5000})
    sub = df[df["ch"] == "DERANA"]
    g = sub.groupby(["Advertiser", "Advt_Theme"]).agg(spots=("Cost", "size"), days=("t", "nunique"), dur=("Dur", "median"))
    assert len(d["rows"]) == len(g)
    for r in d["rows"]:
        x = g.loc[(r["advertiser"], r["theme"])]
        assert r["spots"] == x["spots"] and r["days"] == x["days"]
        assert r["daily_avg"] == pytest.approx(x["spots"] / x["days"])
        assert r["sponsorship"] == bool(is_sponsor_theme(r["theme"]))
        assert sum(pp["spots"] for pp in r["programmes"]) == r["spots"]
