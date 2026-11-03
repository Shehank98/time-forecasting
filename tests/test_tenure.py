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


def make_rows(tmpl, dates, adv, product, theme, k=1, dur=10, cost=20000, offset=0, time=None):
    out = []
    for j in range(k):
        df = pd.DataFrame([tmpl] * len(dates)).reset_index(drop=True)
        df["Channel"], df["Program"], df["Advertiser"], df["Product"], df["Advt_Theme"], df["Dur"] = "Tv - Derana", "Dream Star", adv, product, theme, dur
        df["Dd"], df["Mn"], df["Yr"], df["Day"] = [d.day for d in dates], [d.month for d in dates], [d.year for d in dates], [d.strftime("%a") for d in dates]
        df["Cost"] = [cost + offset + j * 7 + n for n in range(len(dates))]
        df["AdPos"], df["BrkNo"], df["PosinBrk"], df["AdsinBrk"] = 900 + offset + j, 70 + offset + j, 1 + (j % 4), 8
        if time:
            df["Advt_time"] = time
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
             make_rows(tm, y1, "Ceylon Foods", "Spice Pot", "Dream Star Logo", offset=200, time="20:30:00"),    # year 1 only, all in prime time
             make_rows(tm, y1, "Lanka Tea Co", "Island Tea", "Dream Star Logo", offset=250, time="20:45:00"),    # Lanka also buys a prime-time logo in year 1
             make_rows(tm, y2, "Nestle Lanka Ltd", "Maggi", "Dream Star -Outro", offset=300),                    # starts in year 2
             make_rows(tm, dates[::40], "Unilever Sri Lanka", "Knorr", "Dream Star -BB", dur=5, offset=500),       # a stray billboard every 40 days: occasional, not a tenure
             make_rows(tm, y1[::2], "Ceylon Biscuits", "Lemon Puff", "Tag", k=3, dur=5, offset=700),               # frequency: tags, never programme sponsorship
             make_rows(tm, y2[::3], "Ceylon Biscuits", "Lemon Puff", "Com Break (10)(Sin)", k=2, dur=10, offset=800), # frequency: com breaks
             make_rows(tm, y2[:60], "Nestle Lanka Ltd", "Maggi", "Maggi Reminder (5)", k=12, dur=5, offset=600),   # frequency: a 5s spot 12 times a day
             make_rows(tm, dates[::10], "Ceylon Biscuits", "Lemon Puff", "Lemon Puff (30)", dur=30, offset=400)]  # only ordinary spots
    p = tmp_path_factory.mktemp("ten") / "lm.csv"
    all_ = pd.concat(parts, ignore_index=True)
    all_.to_csv(p, index=False)
    df = all_.copy()
    df["ch"] = df["Channel"].map(lambda c: nz.normalise_channel(c)[0])
    df["t"] = pd.to_datetime(dict(year=df["Yr"], month=df["Mn"], day=df["Dd"]))
    df["prog"] = df["Program"].str.strip().str.upper()
    df["yr"] = (df["t"] > Y1_END).astype(int)
    secs = pd.to_timedelta(df["Advt_time"].astype(str)).dt.total_seconds()
    prime = set(nz.prime_dayparts())
    df["prime"] = [nz.daypart_for_hour(x / 3600.0) in prime for x in secs]
    # frequency: Tag, Com Break, Time Check, or the same ad at 10s or less averaging 10+ a day on the channel (judged on the whole upload)
    from app.services.analytics_lmrb import is_sponsor_theme, sponsor_key
    df["freq_item"] = df["Advt_Theme"].map(lambda t: sponsor_key(t) in ("tag", "com break", "time check"))
    g = df.assign(d=df["Dur"].where(df["Dur"] > 0)).groupby(["Advertiser", "ch", "Advt_Theme"]).agg(med=("d", "median"), n=("Cost", "size"), days=("t", "nunique"))
    short = set(g[(g["med"] <= 10) & (g["n"] / g["days"] >= 10)].index)
    df["freq"] = df["freq_item"] | pd.Series([k in short for k in zip(df["Advertiser"], df["ch"], df["Advt_Theme"])], index=df.index)
    words = df["Advt_Theme"].str.contains(r"\b(?:Logo|Intro|Outro)\b", case=False, regex=True)
    df["sp2"] = (df["Advt_Theme"].map(is_sponsor_theme) | words) & ~df["freq"]
    return p, df


def lt_periods(rows):
    return rows["Lanka Tea Co"]["periods"]


def test_year_by_year_numbers_match_pandas(sheet):
    p, df = sheet
    d = node("tenure", p, {"channel": CH, "program": PROG})
    assert [x["label"] for x in d["periods"]] == ["Year 1", "Year 2"] and d["periods"][0]["range"] == "Nov 2024 to Oct 2025"
    prog = df[(df["ch"] == CH) & (df["prog"] == PROG) & ~df["freq"]]
    rows = {r["advertiser"]: r for r in d["rows"]}
    assert set(rows) == {"Lanka Tea Co", "Ceylon Foods", "Nestle Lanka Ltd", "Unilever Sri Lanka"}     # Ceylon Biscuits only buys frequency items     # advertisers with sponsorship items (Ceylon Biscuits has ordinary spots only)
    assert [r["advertiser"] for r in d["rows"]][0] == "Lanka Tea Co" and [r["status_code"] for r in d["rows"]][-1] == "occasional"   # consistent tenures first
    for adv, r in rows.items():
        sub = prog[prog["Advertiser"] == adv]
        for y in (0, 1):
            x, s = r["periods"][y], sub[sub["yr"] == y]
            assert x["total_ads"] == len(s) and x["spend"] == pytest.approx(s["Cost"].sum()) and x["days_present"] == s["t"].nunique()
            sp = s[s["sp2"]]
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
    assert th["Dream Star -Intro"]["sponsorship"] and th["Dream Star -Intro"]["item"] == "-Intro"
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
    s = df[(df["ch"] == CH) & (df["prog"] == PROG) & (df["Advertiser"] == "Lanka Tea Co") & ~df["freq"]]
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
    for s in ("Sponsorship over time", "Year 1", "Year 2", "Lanka Tea Co", "Dream Star", "Sponsored all 2 years", "Stopped after Year 1", "What ads ran", "Dream Star -Intro",
              "started to ended", "1 Nov 2024", "31 Oct 2025", "Whole period", "Frequency sponsorships by channel", "Month by month on this channel", "Com Break", "Month by month in this programme", "Commercial-only value", "Steady sponsorship value", "prime time"):
        assert s in text, s
    assert "—" not in text


def test_lists_for_picking(sheet):
    """No programme or channel needs to be picked: advertisers are listed, then an advertiser's channels and programmes."""
    p, df = sheet
    sp = df[df["sp2"]]
    lite = node("tenure", p, {"lite": True})
    assert lite["rows"] == [] and not lite["empty"]
    summ = {a["advertiser"]: a for a in lite["advertiser_summary"]}
    assert set(summ) == set(sp["Advertiser"]) | set(df[df["freq"]]["Advertiser"])       # frequency-only buyers are listed too
    assert summ["Ceylon Biscuits"]["frequency_ads"] == int((df["freq"] & (df["Advertiser"] == "Ceylon Biscuits")).sum())
    for adv, a in summ.items():
        x = sp[sp["Advertiser"] == adv]
        assert a["programmes"] == x.groupby(["ch", "prog"]).ngroups and a["channels"] == x["ch"].nunique() and a["sponsorship_ads"] == len(x)
    assert summ["Lanka Tea Co"]["all_years"] >= 1 and summ["Nestle Lanka Ltd"]["consistent"] >= 1
    assert lite["advertiser_summary"][0]["all_years"] == max(a["all_years"] for a in summ.values())          # long tenures first
    # one advertiser: its channels (with programme counts) and every programme under them
    d = node("tenure", p, {"advertiser": "Lanka Tea Co"})
    x = sp[sp["Advertiser"] == "Lanka Tea Co"]
    assert {c["channel"]: c["programmes"] for c in d["advertiser_channels"]} == x.groupby("ch")["prog"].nunique().to_dict()
    assert {(r["channel"], r["program"]) for r in d["rows"]} == set(map(tuple, x[["ch", "prog"]].drop_duplicates().values))
    assert {r["advertiser"] for r in d["rows"]} == {"Lanka Tea Co"} and any(r["program"] == "Dream Star" or r["program"] == PROG for r in d["rows"])
    # choosing a channel keeps the full channel list so every channel can still be clicked
    one = node("tenure", p, {"advertiser": "Lanka Tea Co", "channel": CH})
    assert {c["channel"] for c in one["advertiser_channels"]} == {c["channel"] for c in d["advertiser_channels"]}
    assert {r["channel"] for r in one["rows"]} == {CH}


def test_start_end_monthly_values_and_prime(sheet):
    """Each year's start and end, the monthly sponsorship vs commercial value, a steady-value check and prime vs non-prime time."""
    p, df = sheet
    d = node("tenure", p, {"channel": CH, "program": PROG})
    prog = df[(df["ch"] == CH) & (df["prog"] == PROG) & ~df["freq"]]
    rows = {r["advertiser"]: r for r in d["rows"]}
    for adv, r in rows.items():
        sub = prog[prog["Advertiser"] == adv]
        for y in (0, 1):
            sp = sub[(sub["yr"] == y) & sub["sp2"]]
            x = r["periods"][y]
            assert x["sponsored_start"] == (str(sp["t"].min().date()) if len(sp) else None) and x["sponsored_end"] == (str(sp["t"].max().date()) if len(sp) else None)
            assert x["sponsorship_spend"] == pytest.approx(sp["Cost"].sum()) and x["commercial_spend"] == pytest.approx(sub[sub["yr"] == y]["Cost"].sum() - sp["Cost"].sum())
        sp_all = sub[sub["sp2"]]
        assert r["sponsored_first"] == str(sp_all["t"].min().date()) and r["sponsored_last"] == str(sp_all["t"].max().date())
        # month by month: counts and values, sponsorship (value-add) vs commercial only
        for m in r["months"]:
            mm = sub[sub["t"].dt.strftime("%Y-%m") == m["month"]]
            sp = mm[mm["sp2"]]
            assert m["sponsorship_ads"] == len(sp) and m["sponsorship_value"] == pytest.approx(sp["Cost"].sum())
            assert m["other_ads"] == len(mm) - len(sp) and m["commercial_value"] == pytest.approx(mm[~mm["sp2"]]["Cost"].sum())
            assert m["sponsorship_prime_ads"] == int(sp["prime"].sum()) and m["sponsorship_other_time_ads"] == len(sp) - int(sp["prime"].sum())
        # prime vs non-prime
        ps = r["prime"]["sponsorship"]
        spa = sub[sub["sp2"]]
        assert ps["prime_ads"] == int(spa["prime"].sum()) and ps["other_ads"] == len(spa) - int(spa["prime"].sum())
        assert ps["prime_value"] == pytest.approx(spa[spa["prime"]]["Cost"].sum())
        for t in r["themes"]:
            tt = sub[sub["Advt_Theme"] == t["theme"]]
            assert t["prime_ads"] == int(tt["prime"].sum()) and t["other_time_ads"] == len(tt) - int(tt["prime"].sum())
    assert rows["Ceylon Foods"]["time_mix"] == "Prime time" and rows["Nestle Lanka Ltd"]["time_mix"] == "Non-prime time" and rows["Lanka Tea Co"]["time_mix"] == "Prime and non-prime"
    # a flat monthly value looks like a fixed package; a value that changes does not
    nes = rows["Nestle Lanka Ltd"]["pattern"]
    assert nes["steady"] and nes["text"].startswith("Steady sponsorship value: about LKR") and "fixed sponsorship package" in nes["text"] and nes["cv_pct"] <= 15
    lanka = rows["Lanka Tea Co"]["pattern"]
    # Lanka's value is flat inside each year but the package changed between years (a prime-time logo ended after year 1)
    assert not lanka["steady"] and lanka["steady_each_year"] and lanka["text"].startswith("Steady within each year, but the monthly value changed between years")
    by = {x["label"]: x for x in lanka["by_period"]}
    assert by["Year 1"]["steady"] and by["Year 2"]["steady"] and by["Year 1"]["mean"] > 1.5 * by["Year 2"]["mean"] and "lower in Year 2" in lanka["text"]
    sp1 = prog[(prog["Advertiser"] == "Lanka Tea Co") & prog["sp2"]]
    m1 = sp1[sp1["yr"] == 0].groupby(sp1["t"].dt.strftime("%Y-%m"))["Cost"].sum().sort_index().iloc[1:]           # the first (part) month is left out
    assert by["Year 1"]["mean"] == pytest.approx(m1.mean())
    assert rows["Unilever Sri Lanka"]["pattern"] is None or rows["Unilever Sri Lanka"]["pattern"]["months"] >= 3


def test_frequency_sponsorships(sheet):
    """Tag, Com Break, Time Check and frequent short spots: listed by channel with monthly counts, never counted as programme sponsorship."""
    p, df = sheet
    fq = df[df["freq"]]
    d = node("tenure", p, {"advertiser": "Ceylon Biscuits"})
    assert all(r["advertiser"] == "Ceylon Biscuits" for r in d["rows"]) and not any(r["program"] == PROG for r in d["rows"])   # its tags are not a Dream Star sponsorship
    f = {r["channel"]: r for r in d["frequency"]["rows"]}
    cb = fq[fq["Advertiser"] == "Ceylon Biscuits"]
    assert set(f) == set(cb["ch"])
    r = f[CH]
    x = cb[cb["ch"] == CH]
    assert r["tag"] == int((x["Advt_Theme"] == "Tag").sum()) and r["com_break"] == int(x["Advt_Theme"].str.startswith("Com Break").sum()) and r["ads"] == len(x)
    assert r["value"] == pytest.approx(x["Cost"].sum()) and r["days"] == x["t"].nunique() and r["daily_avg"] == pytest.approx(len(x) / x["t"].nunique())
    for y in (0, 1):
        xy = x[x["yr"] == y]
        assert r["periods"][y]["ads"] == len(xy) and r["periods"][y]["start"] == (str(xy["t"].min().date()) if len(xy) else None)
    for m in r["months"]:
        xm = x[x["t"].dt.strftime("%Y-%m") == m["month"]]
        assert m["total"] == len(xm) and m["tag"] == int((xm["Advt_Theme"] == "Tag").sum()) and m["value"] == pytest.approx(xm["Cost"].sum())
    assert r["headline"].startswith("Ceylon Biscuits ran") and "Tag" in r["headline"] and "Com Break" in r["headline"]
    # a 5 second spot 12 times a day is a frequency buy: it leaves Nestle's Dream Star numbers and shows as short spots
    n = node("tenure", p, {"advertiser": "Nestle Lanka Ltd", "channel": CH})
    nf = next(r for r in n["frequency"]["rows"] if r["channel"] == CH)
    assert nf["short_spots"] == 720 and any(t["theme"] == "Maggi Reminder (5)" and t["type"] == "Short spots" and t["daily_avg"] == pytest.approx(12) for t in nf["themes"])
    dream = next(r for r in n["rows"] if r["program"] == PROG)
    assert dream["total_ads"] == int(((df["ch"] == CH) & (df["prog"] == PROG) & (df["Advertiser"] == "Nestle Lanka Ltd") & ~df["freq"]).sum())
    assert not any(t["theme"] == "Maggi Reminder (5)" for t in dream["themes"])
    # the background Time Check items are frequency too
    assert any(r["time_check"] > 0 for r in node("tenure", p, {"advertiser": "Lanka Tea Co"})["frequency"]["rows"])
