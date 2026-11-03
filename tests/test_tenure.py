"""Sponsorship over time: year-by-year ads for an advertiser in a programme across a 2-year upload, checked against pandas."""
import io

import pandas as pd
import pytest

import synth
from app.services import normalise as nz
from test_spotlight import needs_node_mark, node

pytestmark = needs_node_mark
CH, PROG = "DERANA", "DREAM STAR"
Y1_END = pd.Timestamp("2025-10-31")


def make_rows(tmpl, dates, adv, product, theme, k=1, dur=10, cost=20000, offset=0):
    out = []
    for j in range(k):
        df = pd.DataFrame([tmpl] * len(dates)).reset_index(drop=True)
        df["Channel"], df["Program"], df["Advertiser"], df["Product"], df["Advt_Theme"], df["Dur"] = "Tv - Derana", "Dream Star", adv, product, theme, dur
        df["Dd"], df["Mn"], df["Yr"], df["Day"] = [d.day for d in dates], [d.month for d in dates], [d.year for d in dates], [d.strftime("%a") for d in dates]
        df["Cost"] = [cost + offset + j * 7 + n for n in range(len(dates))]
        df["AdPos"], df["BrkNo"], df["PosinBrk"], df["AdsinBrk"] = 900 + offset + j, 70 + offset + j, 1 + (j % 4), 8
        out.append(df)
    return pd.concat(out, ignore_index=True)


@pytest.fixture(scope="module")
def sheet(tmp_path_factory):
    lm = synth.make_lmrb(days=700, start="2024-11-01", seed=2)
    dates = list(pd.date_range("2024-11-01", periods=700))
    tm = lm.iloc[0].to_dict()
    y1 = [d for d in dates if d <= Y1_END]
    y2 = [d for d in dates if d > Y1_END]
    parts = [lm,
             make_rows(tm, dates, "Lanka Tea Co", "Island Tea", "Dream Star -Intro", offset=0),                  # sponsors both years, every airing
             make_rows(tm, dates[::3], "Lanka Tea Co", "Island Tea", "Island Tea Reminder (30)", dur=30, offset=100),  # plus ordinary spots on some days
             make_rows(tm, y1, "Ceylon Foods", "Spice Pot", "Dream Star Logo", offset=200),                       # year 1 only
             make_rows(tm, y2, "Nestle Lanka Ltd", "Maggi", "Dream Star -Outro", offset=300),                    # starts in year 2
             make_rows(tm, dates[::40], "Unilever Sri Lanka", "Knorr", "Tag", dur=5, offset=500),                  # a stray tag every 40 days: occasional, not a sponsorship tenure
             make_rows(tm, dates[::10], "Ceylon Biscuits", "Lemon Puff", "Lemon Puff (30)", dur=30, offset=400)]  # only ordinary spots
    p = tmp_path_factory.mktemp("ten") / "lm.csv"
    all_ = pd.concat(parts, ignore_index=True)
    all_.to_csv(p, index=False)
    df = all_.copy()
    df["ch"] = df["Channel"].map(lambda c: nz.normalise_channel(c)[0])
    df["t"] = pd.to_datetime(dict(year=df["Yr"], month=df["Mn"], day=df["Dd"]))
    df["prog"] = df["Program"].str.strip().str.upper()
    df["yr"] = (df["t"] > Y1_END).astype(int)
    return p, df


def lt_periods(rows):
    return rows["Lanka Tea Co"]["periods"]


def test_year_by_year_numbers_match_pandas(sheet):
    p, df = sheet
    d = node("tenure", p, {"channel": CH, "program": PROG})
    assert [x["label"] for x in d["periods"]] == ["Year 1", "Year 2"] and d["periods"][0]["range"] == "Nov 2024 to Oct 2025"
    prog = df[(df["ch"] == CH) & (df["prog"] == PROG)]
    rows = {r["advertiser"]: r for r in d["rows"]}
    assert set(rows) == {"Lanka Tea Co", "Ceylon Foods", "Nestle Lanka Ltd", "Unilever Sri Lanka"}     # advertisers with sponsorship items (Ceylon Biscuits has ordinary spots only)
    assert [r["advertiser"] for r in d["rows"]][0] == "Lanka Tea Co" and [r["status_code"] for r in d["rows"]][-1] == "occasional"   # consistent tenures first
    for adv, r in rows.items():
        sub = prog[prog["Advertiser"] == adv]
        for y in (0, 1):
            x, s = r["periods"][y], sub[sub["yr"] == y]
            assert x["total_ads"] == len(s) and x["spend"] == pytest.approx(s["Cost"].sum()) and x["days_present"] == s["t"].nunique()
            sp = s[s["Advt_Theme"].isin(["Dream Star -Intro", "Dream Star Logo", "Dream Star -Outro", "Tag"])]
            assert x["sponsorship_ads"] == len(sp) and x["days_sponsored"] == sp["t"].nunique() and x["other_ads"] == len(s) - len(sp)
            assert x["airing_days"] == prog[prog["yr"] == y]["t"].nunique()              # all advertisers' airing days
        assert r["total_ads"] == len(sub) and r["airing_days"] == prog["t"].nunique()
    # statuses
    assert rows["Lanka Tea Co"]["status"] == "Sponsored all 2 years" and rows["Lanka Tea Co"]["status_code"] == "all"
    assert rows["Ceylon Foods"]["status"] == "Stopped after Year 1" and rows["Nestle Lanka Ltd"]["status"] == "Started in Year 2"
    uni = rows["Unilever Sri Lanka"]                         # items in both years but on well under half of the airing days
    assert uni["status_code"] == "occasional" and uni["status"] == "Occasional sponsorship items (2 of 2 years)" and uni["years_sponsored"] == 0 and uni["years_with_items"] == 2
    assert all(x["sponsored"] and not x["consistent"] for x in uni["periods"]) and all(x["consistent"] for x in lt_periods(rows))
    lt = rows["Lanka Tea Co"]
    assert lt["months_span"] == 24 and lt["sponsored_from"] == "Nov 2024" and lt["sponsored_to"] == "Oct 2026"
    assert lt["presence_pct"] == pytest.approx(100) and lt["gaps"] == []
    assert lt["headline"].startswith("Lanka Tea Co sponsored Dream Star on Derana for 24 months (Nov 2024 to Oct 2026)") and lt["headline"].endswith("Sponsored all 2 years.")
    # what ads: themes with ads per year
    th = {t["theme"]: t for t in lt["themes"]}
    assert th["Dream Star -Intro"]["sponsorship"] and th["Dream Star -Intro"]["item"] == "Intro"
    s1 = prog[(prog["Advertiser"] == "Lanka Tea Co") & (prog["Advt_Theme"] == "Dream Star -Intro")]
    assert th["Dream Star -Intro"]["per_period"] == [int((s1["yr"] == 0).sum()), int((s1["yr"] == 1).sum())]
    assert not th["Island Tea Reminder (30)"]["sponsorship"] and lt["themes"][0]["sponsorship"]      # sponsorship themes listed first
    assert [m["month"] for m in lt["months"]][:2] == ["2024-11", "2024-12"] and sum(m["sponsorship_ads"] + m["other_ads"] for m in lt["months"]) == lt["total_ads"]
    assert rows["Ceylon Foods"]["months_with_sponsorship"] == 12 and rows["Nestle Lanka Ltd"]["sponsored_from"] == "Nov 2025"


def test_modes_filters_and_gaps(sheet, tmp_path):
    p, df = sheet
    cal = node("tenure", p, {"channel": CH, "program": PROG, "mode": "calendar"})
    assert [x["label"] for x in cal["periods"]] == ["2024", "2025", "2026"]
    r = next(x for x in cal["rows"] if x["advertiser"] == "Lanka Tea Co")
    s = df[(df["ch"] == CH) & (df["prog"] == PROG) & (df["Advertiser"] == "Lanka Tea Co")]
    assert [x["total_ads"] for x in r["periods"]] == [int((s["t"].dt.year == y).sum()) for y in (2024, 2025, 2026)]
    # an advertiser and programme pick returns that one row; options cascade
    one = node("tenure", p, {"channel": CH, "program": PROG, "advertiser": "Ceylon Foods"})
    assert len(one["rows"]) == 1 and one["rows"][0]["advertiser"] == "Ceylon Foods"
    assert {a["advertiser"] for a in one["options"]["advertisers"] if a["sponsored"]} >= {"Lanka Tea Co", "Ceylon Foods", "Nestle Lanka Ltd"}
    assert any(x["program"] == PROG and x["sponsored"] for x in one["options"]["programmes"])
    # show all: ordinary-spot advertisers appear too, with a "no sponsorship" status
    allr = node("tenure", p, {"channel": CH, "program": PROG, "show": "all"})
    uni = next(x for x in allr["rows"] if x["advertiser"] == "Ceylon Biscuits")
    assert uni["status_code"] == "none" and uni["sponsorship_ads"] == 0 and "no sponsorship" in uni["headline"]
    assert node("tenure", p, {"channel": CH, "program": "NO SUCH SHOW"})["empty"] is True
    # a sponsorship that pauses for two months in the middle shows the gap; stopping at the end is not a gap
    lm = synth.make_lmrb(days=300, start="2025-01-01", seed=8)
    every = list(pd.date_range("2025-01-01", periods=300))
    spon = [d for d in every if not (pd.Timestamp("2025-04-01") <= d <= pd.Timestamp("2025-05-31")) and d <= pd.Timestamp("2025-08-31")]
    tm = lm.iloc[0].to_dict()
    g = pd.concat([lm, make_rows(tm, spon, "Lanka Tea Co", "Island Tea", "Dream Star -Intro", offset=50), make_rows(tm, every, "Nestle Lanka Ltd", "Maggi", "Maggi Spot (30)", dur=30, offset=500)], ignore_index=True)
    q = tmp_path / "g.csv"; g.to_csv(q, index=False)
    r2 = next(x for x in node("tenure", q, {"channel": CH, "program": PROG})["rows"] if x["advertiser"] == "Lanka Tea Co")
    assert [(x["from"], x["to"], x["months"]) for x in r2["gaps"]] == [("Apr 2025", "May 2025", 2)] and r2["status_code"] == "single"
    assert r2["sponsored_to"] == "Aug 2025" and r2["months_span"] == 8


def test_tenure_pdf(sheet):
    from helpers import api
    p, _ = sheet
    rep = node("tenure", p, {"channel": CH, "program": PROG})
    c = api()
    r = c.post("/api/spotlight/tenure/pdf", json={"report": rep, "meta": {"dataset": "lm.csv"}})
    assert r.status_code == 200 and r.content[:5] == b"%PDF-" and r.headers["x-report-id"]
    assert c.post("/api/spotlight/tenure/pdf", json={"report": {"empty": True}}).status_code == 422
    pdf = pytest.importorskip("pypdf").PdfReader(io.BytesIO(r.content))
    text = " ".join(pg.extract_text() for pg in pdf.pages)
    for s in ("Sponsorship over time", "Year 1", "Year 2", "Lanka Tea Co", "Dream Star", "Sponsored all 2 years", "Stopped after Year 1", "What ads ran", "Dream Star -Intro"):
        assert s in text, s
    assert "—" not in text
