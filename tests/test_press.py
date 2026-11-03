"""Press sheet: loading, contracts (same advertiser, product, paper, size and weekday, 4+ times) and TV/Radio/Press spend by year, against pandas."""
import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

import synth
from app.services.analytics_lmrb import is_sponsor_theme

ROOT = Path(__file__).resolve().parent.parent
pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")


def node(op, press, opts=None, lmrb=None):
    args = ["node", str(ROOT / "tests/js/press.js"), op, str(press) if press else "-", json.dumps(opts or {})] + ([str(lmrb)] if lmrb else [])
    out = subprocess.run(args, capture_output=True, text=True, timeout=240)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


@pytest.fixture(scope="module")
def press(tmp_path_factory):
    df = synth.make_press()
    p = tmp_path_factory.mktemp("press") / "press.csv"
    out = df.copy()
    out["Cost"] = out["Cost"].map(lambda v: f"{v:,}")            # "170,040": the real sheet has thousands separators
    out.to_csv(p, index=False)
    df["t"] = pd.to_datetime(dict(year=df["Yr"], month=df["Mn"], day=df["Dd"]))
    df["size"] = df["CM"].astype(str) + " cm x " + df["Col"].astype(str) + " col"
    return p, df


def test_loads_the_real_sheet_layout(tmp_path):
    p = tmp_path / "s.csv"
    p.write_text('Product_Group,Advertiser,Product,Ads,Publication,Dd,Mn,Yr,Date,Day,Periodicity,Lng,Location,Type,Col,CM,Dur,Cost\n'
                 'Banking Services,Commercial Bank,Combank Corporate,1,LMD,1,10,2026,10/1/2026,Thu,Monthly,English,,Business,3,26,78,"170,040"\n'
                 'Banking Services,Commercial Bank,Combank Corporate,1,DAILY VIRAKESARI,2,10,2026,10/2/2026,Fri,Daily,Tamil,,General Int,10,51,510,"480,000"\n'
                 'Banking Services,Commercial Bank,Combank Corporate,1,DAILY VIRAKESARI,2,10,2026,10/2/2026,Fri,Daily,Tamil,,General Int,10,51,510,"480,000"\n', encoding="utf-8")
    d = node("parse", p)
    assert d["n"] == 2 and d["report"]["dropped"]["duplicates"] == 1                        # the repeated row is one insertion
    assert d["first"] == {"cost": 170040, "area": 78, "col": 3, "cm": 26, "date": "2026-10-01"}
    assert d["dicts"]["size"] == ["26 cm x 3 col", "51 cm x 10 col"] and d["dicts"]["periodicity"] == ["Monthly", "Daily"]
    # unusable sheets are refused with a clear message
    def refuse(text):
        f = tmp_path / "bad.csv"; f.write_text(text, encoding="utf-8")
        r = subprocess.run(["node", str(ROOT / "tests/js/press.js"), "parse", str(f), "{}"], capture_output=True, text=True)
        assert r.returncode != 0
        return r.stderr
    assert "Could not find a header row" in refuse("Advertiser,Cost\nA,10\n")
    assert "Missing required columns: publication" in refuse("Product_Group,Advertiser,Product,Ads,Dd,Mn,Yr,Col,CM,Dur,Cost\nX,A,P,1,1,10,2026,3,26,78,100\n")
    assert "Missing date columns" in refuse("Product_Group,Advertiser,Product,Ads,Publication,Col,CM,Dur,Cost\nX,A,P,1,LMD,3,26,78,100\n")


def reference_contracts(df, min_times=4):
    """Independent contract finder: runs of the same weekday (or month) with gaps of at most 14 days (one missed week) or 2 months."""
    out = []
    df = df.copy()
    weekly = df["Periodicity"].str.lower().isin(["daily", "weekly", "fortnightly"])
    df["unit"] = np.where(weekly, (df["t"] - pd.Timestamp("1970-01-01")).dt.days, df["t"].dt.year * 12 + df["t"].dt.month - 1)
    df["wk"] = np.where(weekly, df["t"].dt.dayofweek, 7)
    for key, g in df.groupby(["Advertiser", "Product", "Publication", "size", "wk"]):
        gap_max = 14 if key[4] != 7 else 2
        units = sorted(g["unit"].unique())
        runs, run = [], []
        for u in units:
            if run and u - run[-1] > gap_max:
                runs.append(run); run = []
            run.append(u)
        runs.append(run)
        for r in runs:
            if len(r) >= min_times:
                x = g[g["unit"].isin(r)]
                out.append((key[0], key[1], key[2], key[3], key[4], len(r), len(x), str(x["t"].min().date()), str(x["t"].max().date()), int(x["Cost"].sum())))
    return sorted(out)


def test_contracts_match_the_reference(press):
    p, df = press
    d = node("contracts", p)
    got = sorted((c["advertiser"], c["product"], c["publication"], c["size"], {"Monday": 0, "Tuesday": 1, "Wednesday": 2, "Thursday": 3, "Friday": 4, "Saturday": 5, "Sunday": 6}.get(c["weekday"], 7),
                  c["times"], c["insertions"], c["first"], c["last"], round(c["total_cost"])) for c in d["contracts"])
    ref = reference_contracts(df)
    assert got == ref and len(ref) >= 5
    by = {(c["advertiser"], c["publication"], c["size"], c["first"]): c for c in d["contracts"]}
    a1 = by[("Commercial Bank", "DAILY LANKADEEPA", "54 cm x 8 col", "2026-01-06")]
    assert a1["times"] == 10 and a1["weekday"] == "Tuesday" and a1["last"] == "2026-03-10" and a1["total_cost"] == 3450000 and a1["status"] == "Ended" and a1["steady_rate"] and a1["area"] == 432
    a2 = by[("Commercial Bank", "DAILY LANKADEEPA", "54 cm x 8 col", "2026-04-28")]
    assert a2["times"] == 6                                                                  # the renewed contract after the break is its own contract
    assert not any(c["weekday"] == "Friday" and c["publication"] == "DAILY LANKADEEPA" for c in d["contracts"])      # only 3 Fridays: not a contract
    m = by[("Commercial Bank", "LMD", "26 cm x 3 col", "2026-01-01")]
    assert m["weekday"] == "Every month" and m["times"] == 6 and m["periodicity"] == "Monthly"
    b = by[("Sampath Bank", "DAILY VIRAKESARI", "40 cm x 8 col", "2026-01-01")]
    assert b["times"] == 8 and b["missed"] == 1                                              # one missed week inside the run is allowed and reported
    c = [x for x in d["contracts"] if x["advertiser"] == "Sampath Bank" and x["size"] == "51 cm x 10 col"]
    assert len(c) == 1 and c[0]["times"] == 5 and c[0]["last"] == "2026-03-05"               # a 3 week gap ends the run: the next 3 are not a contract
    dl = by[("Dialog", "SUNDAY TIMES", "30 cm x 4 col", "2026-03-03")]
    assert dl["times"] == 4 and dl["insertions"] == 8 and dl["total_cost"] == 804000                # two ads on the same date count as one time
    t = d["totals"]
    assert t["contract_spend"] + t["adhoc_spend"] == pytest.approx(t["all_spend"]) and t["all_insertions"] == len(df)
    assert t["contract_spend"] == pytest.approx(sum(r[-1] for r in ref)) and t["contracts"] == len(ref)
    # the rule is editable, and filters narrow it
    assert len(node("contracts", p, {"min_times": 3})["contracts"]) > len(ref)
    assert len(node("contracts", p, {"min_times": 8})["contracts"]) < len(ref)
    only = node("contracts", p, {"advertisers": ["Sampath Bank"]})
    assert {c["advertiser"] for c in only["contracts"]} == {"Sampath Bank"} and only["totals"]["all_spend"] == pytest.approx(df[df["Advertiser"] == "Sampath Bank"]["Cost"].sum())


def test_summary_matches_pandas(press):
    p, df = press
    d = node("summary", p)
    assert d["totals"]["spend"] == pytest.approx(df["Cost"].sum()) and d["totals"]["insertions"] == len(df)
    assert d["totals"]["area"] == pytest.approx((df["Col"] * df["CM"]).sum())
    pub = df.groupby("Publication").agg(spend=("Cost", "sum"), n=("Cost", "size"))
    for r in d["publications"]:
        assert r["spend"] == pytest.approx(pub.loc[r["name"], "spend"]) and r["insertions"] == pub.loc[r["name"], "n"]
    assert [m["month"] for m in d["months"]] == sorted(df["t"].dt.strftime("%Y-%m").unique())
    assert node("summary", p, {"date_from": "2026-03-01", "date_to": "2026-03-31"})["totals"]["spend"] == pytest.approx(df[df["t"].dt.month == 3]["Cost"].sum())


RAW = {"derana": "TV - Derana", "sirasa": "TV - sirasa TV", "hiru": "Tv - Hiru", "shakthi_fm": "Radio - Shakthi FM", "hiru_fm": "RADIO-Hiru FM", "hiru_radio": "Radio - Hiru", "deshaya": "Deshaya Weekly"}


@pytest.fixture(scope="module")
def lmrb(tmp_path_factory):
    lm = synth.make_lmrb(days=420, start="2025-06-01", seed=8)
    names = list(RAW.values())
    lm["Channel"] = [names[i % len(names)] for i in range(len(lm))]                       # every raw spelling, in turn
    p = tmp_path_factory.mktemp("lm") / "lm.csv"
    lm.to_csv(p, index=False)
    lm["t"] = pd.to_datetime(dict(year=lm["Yr"], month=lm["Mn"], day=lm["Dd"]))
    return p, lm


def test_medium_comes_from_the_channel_prefix(lmrb, press):
    p, lm = lmrb
    d = node("lmrb", None, {}, p)
    pairs = dict(x.split("|") for x in d["pairs"])
    assert pairs == {"DERANA": "TV", "SIRASA": "TV", "HIRU": "TV", "SHAKTHI FM": "Radio", "HIRU FM": "Radio", "HIRU (RADIO)": "Radio", "DESHAYA WEEKLY": "Press"}
    # "Radio - Hiru" does not merge into the TV channel HIRU; a name without TV - or Radio - is press and is listed so it can be checked
    s = node("spend", None, {}, p)
    assert [x["name"] for x in s["unprefixed"]] == ["DESHAYA WEEKLY"]


def expected_spend(lm, pr=None, advertisers=None):
    """Independent calculation of the year blocks: medium, channel, year, month -> commercial and value-add."""
    canon = {"TV - Derana": ("TV", "DERANA"), "TV - sirasa TV": ("TV", "SIRASA"), "Tv - Hiru": ("TV", "HIRU"), "Radio - Shakthi FM": ("Radio", "SHAKTHI FM"), "RADIO-Hiru FM": ("Radio", "HIRU FM"),
             "Radio - Hiru": ("Radio", "HIRU (RADIO)"), "Deshaya Weekly": ("Press", "DESHAYA WEEKLY")}
    x = lm if not advertisers else lm[lm["Advertiser"].isin(advertisers)]
    x = x.assign(medium=x["Channel"].map(lambda c: canon[c][0]), name=x["Channel"].map(lambda c: canon[c][1]), val=x["Advt_Theme"].map(is_sponsor_theme), y=x["t"].dt.year, m=x["t"].dt.month - 1)
    out = {}
    for (y, med, name, m, val), g in x.groupby(["y", "medium", "name", "m", "val"]):
        out[(int(y), med, name, int(m), "val" if val else "com")] = g["Cost"].sum()
    if pr is not None:
        q = pr if not advertisers else pr[pr["Advertiser"].isin(advertisers)]
        for (y, pub, m), g in q.groupby([q["t"].dt.year, "Publication", q["t"].dt.month - 1]):
            out[(int(y), "Press", pub, int(m), "com")] = out.get((int(y), "Press", pub, int(m), "com"), 0) + g["Cost"].sum()
    return out


def test_spend_by_year_matches_pandas(lmrb, press):
    lp, lm = lmrb
    pp, pr = press
    s = node("spend", pp, {}, lp)
    assert s["months"][:3] == ["Jan", "Feb", "Mar"] and s["has_press"] and not s["no_medium"]
    exp = expected_spend(lm, pr)
    assert {y["year"] for y in s["years"]} == {y for (y, *_r) in exp}
    got = {}
    for yb in s["years"]:
        for key, blk in (("com", "commercial"), ("val", "value_add")):
            for r in yb[blk]["rows"]:
                for m, v in enumerate(r["months"]):
                    if v:
                        got[(yb["year"], r["medium"], r["name"], m, key)] = v
    assert set(got) == {k for k, v in exp.items() if v} and all(got[k] == pytest.approx(exp[k]) for k in got)
    for yb in s["years"]:
        c, v, t = yb["commercial"], yb["value_add"], yb["total"]
        for m in range(12):                                                       # the total block is commercial + value add, month by month
            assert t["grand"]["months"][m] == pytest.approx(c["grand"]["months"][m] + v["grand"]["months"][m])
        assert c["grand"]["total"] == pytest.approx(sum(r["total"] for r in c["rows"])) and v["grand"]["total"] == pytest.approx(sum(r["total"] for r in v["rows"]))
        assert {mm["medium"] for mm in c["media"]} == {"TV", "Radio", "Press"} and sum(mm["total"] for mm in c["media"]) == pytest.approx(c["grand"]["total"])
        assert all(r["medium"] != "Press" for r in v["rows"] if r["name"] in set(pr["Publication"]))        # press has no value add
        order = [r["medium"] for r in t["rows"]]
        assert order == sorted(order, key=["TV", "Radio", "Press"].index)           # TV first, then Radio, then Press
    # the press sheet adds Press rows; without it only the LMRB press-named channel is there
    only = node("spend", None, {}, lp)
    assert not only["has_press"] and all(r["name"] == "DESHAYA WEEKLY" for yb in only["years"] for r in yb["commercial"]["rows"] if r["medium"] == "Press")
    # one advertiser
    a = node("spend", pp, {"advertisers": ["Commercial Bank"]}, lp)
    expa = expected_spend(lm, pr, ["Commercial Bank"])
    tot = sum(yb["commercial"]["grand"]["total"] + yb["value_add"]["grand"]["total"] for yb in a["years"])
    assert tot == pytest.approx(sum(expa.values()))


def test_unticked_sponsorship_items_move_spend_to_commercial(lmrb):
    lp, lm = lmrb
    base = node("spend", None, {}, lp)
    none = node("spend", None, {"_items": {k: False for k in ("-bb", "com break", "dj", "-extro", "-intro", "-llogo", "next card", "tag", "time check", "-tr")}}, lp)
    assert sum(y["value_add"]["grand"]["total"] for y in base["years"]) > 0 and sum(y["value_add"]["grand"]["total"] for y in none["years"]) == 0
    assert sum(y["total"]["grand"]["total"] for y in base["years"]) == pytest.approx(sum(y["total"]["grand"]["total"] for y in none["years"]))      # the total never changes
    assert none["items_counted"] == [] and "Tag" in base["items_counted"] and "-Tr" not in base["items_counted"]


def test_press_pdf_has_the_contracts(press):
    import io
    from helpers import api
    p, _ = press
    s, c = node("summary", p), node("contracts", p)
    cl = api()
    r = cl.post("/api/press/pdf", json={"summary": s, "contracts": c, "meta": {"dataset": "press.csv", "advertisers": ["Commercial Bank"]}})
    assert r.status_code == 200 and r.content[:5] == b"%PDF-" and r.headers["x-report-id"]
    assert cl.post("/api/press/pdf", json={"summary": {"empty": True}, "contracts": {}}).status_code == 422
    pdf = pytest.importorskip("pypdf").PdfReader(io.BytesIO(r.content))
    text = " ".join(" ".join(pg.extract_text().split()) for pg in pdf.pages)
    for t in ("Press & Contracts", "1. Contracts", "Runs on", "Tuesday", "54 cm x 8 col", "Commercial Bank", "Daily Lankadeepa", "3. Press spend by publication", "6. Dates of the biggest contracts"):
        assert t in text, t
    assert "—" not in text and "TimesFM" not in text
