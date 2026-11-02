"""Executive Negotiation Summary: numbers checked against pandas, drill-downs and the PDF endpoint."""
import io

import pandas as pd
import pytest

from test_spotlight import PROG, needs_node_mark, node, sheet  # noqa: F401  (shared sheet fixture)

pytestmark = needs_node_mark


def test_summary_sections_match_pandas(sheet):
    p, df, _ = sheet
    d = node("exec", p, {"date_from": "2026-06-10", "date_to": "2026-07-31"})
    sub = df[(df["t"] >= "2026-06-10") & (df["t"] <= "2026-07-31")]
    o = d["overall"]
    assert o["spend"] == pytest.approx(sub["Cost"].sum()) and o["spots"] == len(sub)
    assert o["value_add_spend"] == pytest.approx(sub.loc[sub["sp"], "Cost"].sum())
    assert o["commercial_spend"] + o["value_add_spend"] == pytest.approx(o["spend"])
    assert o["value_add_items"] == sub["sp"].sum() and o["brands"] == sub["Advertiser"].nunique()
    assert sum(x["spots"] for x in d["durations"]) == len(sub)
    assert {x["name"]: x["spots"] for x in d["languages"]} == sub["Lng"].str.title().value_counts().to_dict()
    assert [x["name"] for x in d["media"]] == ["TV"]
    # channels ranked by spend, share of wallet adds to 100
    ch = sub.groupby("ch")["Cost"].sum().sort_values(ascending=False)
    assert [c["channel"] for c in d["channels"]] == list(ch.index)
    for c in d["channels"]:
        x = sub[sub["ch"] == c["channel"]]
        assert c["spend"] == pytest.approx(x["Cost"].sum()) and c["spots"] == len(x)
        assert c["value_add_spend"] == pytest.approx(x.loc[x["sp"], "Cost"].sum()) and c["value_add_items"] == x["sp"].sum()
        assert c["sow_pct"] == pytest.approx(x["Cost"].sum() / sub["Cost"].sum() * 100)
    assert sum(c["sow_pct"] for c in d["channels"]) == pytest.approx(100)
    # programmes: sponsored first, sponsors and airing days
    pg = d["programmes"]
    assert pg[0]["sponsored"] and [r["sponsored"] for r in pg] == sorted([r["sponsored"] for r in pg], reverse=True)
    for r in pg:
        x = sub[(sub["ch"] == r["channel"]) & (sub["prog"] == r["program"])]
        assert r["spots"] == len(x) and r["airing_days"] == x["t"].nunique() and r["value_add_items"] == x["sp"].sum()
        assert {s["advertiser"] for s in r["sponsors"]} == set(x[x["sp"]]["Advertiser"])
        assert r["frequency_spots"] <= r["spots"]


def test_filters_and_drill_down(sheet):
    p, df, _ = sheet
    d = node("exec", p, {"advertisers": ["Lanka Tea Co"], "channels": ["DERANA"]})
    sub = df[(df["Advertiser"] == "Lanka Tea Co") & (df["ch"] == "DERANA")]
    assert d["overall"]["spend"] == pytest.approx(sub["Cost"].sum()) and [c["channel"] for c in d["channels"]] == ["DERANA"]
    x = node("execDetail", p, {"channel": "DERANA", "program": PROG})
    s2 = df[(df["ch"] == "DERANA") & (df["prog"] == PROG)]
    com = s2[~s2["sp"]]
    assert x["commercial"]["spots"] == len(com)
    assert sum(r["spots"] for r in x["commercial"]["by_duration"]) == len(com)
    assert x["volume"]["spots"] == len(s2) and x["volume"]["active_days"] == s2["t"].nunique()
    assert x["sponsorship"]["items"] == s2["sp"].sum()
    tags = {(r["advertiser"], r["theme"]): r["spots"] for r in x["classified"] if r["sponsorship"]}
    ref = s2[s2["sp"]].groupby(["Advertiser", "Advt_Theme"]).size().to_dict()
    assert tags == ref                                         # programme-level counts of each sponsorship tag
    assert x["volume"]["ratings"] is None                      # no TVR sheet in this test
    full = node("exec", p, {"details": True, "max_detail_channels": 3, "max_detail_programmes": 4})
    assert len(full["channel_details"]) == 3 and len(full["programme_details"]) == 4


def test_executive_pdf(sheet):
    from helpers import api
    p, _, _ = sheet
    d = node("exec", p, {"details": True})
    c = api()
    r = c.post("/api/executive/pdf", json={"summary": d, "meta": {"dataset": "lm.csv"}})
    assert r.status_code == 200 and r.content[:5] == b"%PDF-" and r.headers["x-report-id"]
    assert c.post("/api/executive/pdf", json={"summary": {"empty": True}}).status_code == 422
    pdf = pytest.importorskip("pypdf").PdfReader(io.BytesIO(r.content))
    text = " ".join(pg.extract_text() for pg in pdf.pages)
    for s in ("Executive Negotiation Summary", "1. Overall campaign summary", "2. TV channel-wise breakdown", "3. Programmes & sponsorship intelligence",
              "Detailed breakdown: channels", "Detailed breakdown: programmes", "Commercial spots", "Teledrama Night", "Share of wallet"):
        assert s in text, s
    assert "—" not in text


def test_classification_rules(tmp_path):
    """High-Frequency Reminders (per programme) and Exclusive Sponsorship / Value-Add, on hand-built cases."""
    import synth
    lm = synth.make_lmrb(days=40, start="2026-06-01", seed=4)
    tele = lm[(lm["Program"] == "Teledrama Night") & (lm["Channel"] == "Tv - Derana")].drop_duplicates(subset=["Dd", "Mn", "Yr"])
    base = tele.head(20)                                           # 20 airing days of the programme
    n_air = lm[(lm["Program"] == "Teledrama Night") & (lm["Channel"] == "Tv - Derana")][["Dd", "Mn", "Yr"]].drop_duplicates().shape[0]

    def many(k, adv, theme, dur, days=base, start=0):
        return pd.concat([days.assign(Advertiser=adv, Product=adv + " P", Advt_Theme=theme, Dur=dur, Cost=7000 + start + j, AdPos=500 + start + j, BrkNo=50 + start + j, PosinBrk=1 + (j % 3), AdsinBrk=9) for j in range(k)])
    parts = [lm,
             many(12, "Lanka Tea Co", "Island Tea Reminder (5)", 5, start=0),          # 12 a day, 5s: high frequency
             many(11, "Ceylon Foods", "Spice Pot Long (30)", 30, start=100),           # 11 a day at 30s: more than 10, so high frequency
             many(10, "Unilever Sri Lanka", "Knorr Short (10)", 10, start=200),        # exactly 10 a day at 10s: high frequency
             many(9, "Nestle Lanka Ltd", "Maggi Short (10)", 10, start=300),           # 9 a day at 10s: not
             many(10, "Ceylon Biscuits", "Lemon Puff (30)", 30, start=400),            # 10 a day at 30s: not (needs MORE than 10)
             many(1, "Lanka Tea Co", "Island Tea Logo", 10, start=500),                # a logo on all 20 of the programme's days: exclusive
             many(1, "Ceylon Foods", "Spice Pot Outro", 10, days=base.head(2), start=600)]  # an outro on only 2 days: sponsorship, not exclusive
    p = tmp_path / "c.csv"; pd.concat(parts, ignore_index=True).to_csv(p, index=False)
    d = node("exec", p, {"channels": ["DERANA"]})
    g = {(r["advertiser"], r["theme"]): r for r in d["classified"]}
    freq = {k for k, r in g.items() if r["frequency"]}
    assert ("Lanka Tea Co", "Island Tea Reminder (5)") in freq and ("Ceylon Foods", "Spice Pot Long (30)") in freq and ("Unilever Sri Lanka", "Knorr Short (10)") in freq
    assert not any(a in ("Nestle Lanka Ltd", "Ceylon Biscuits") and "Short" in t or t == "Lemon Puff (30)" for (a, t) in freq)
    five = g[("Lanka Tea Co", "Island Tea Reminder (5)")]
    assert five["types"] == ["High-Frequency Reminders"] and five["spots"] == 240 and five["days"] == 20 and five["daily_avg"] == pytest.approx(12)
    assert five["dur_split"]["5s"] == 240 and sum(five["placement"].values()) == 240 and five["placement"]["first"] > 0
    logo = g[("Lanka Tea Co", "Island Tea Logo")]
    assert logo["exclusive"] and logo["item"] == "Logo" and logo["types"] == ["Exclusive Sponsorship / Value-Add"] and logo["days"] == 20 and logo["airings"] == n_air
    outro = g[("Ceylon Foods", "Spice Pot Outro")]
    assert outro["sponsorship"] and not outro["exclusive"] and outro["item"] == "Outro" and outro["types"] == ["Sponsorship / Value-Add"]
    # the programme row, the channel row and the overall tiles agree
    pr = next(r for r in d["programmes"] if r["program"] == PROG)
    assert pr["exclusive_ads"] >= 1 and pr["frequency_ads"] >= 3 and pr["sponsored"]
    assert next(x for x in pr["sponsors"] if x["advertiser"] == "Lanka Tea Co")["exclusive"]
    assert d["overall"]["frequency_ads"] >= 3 and d["overall"]["exclusive_ads"] >= 1
    # a high-frequency sponsorship counts as both: a logo shown 12 times a day on every airing
    p2 = tmp_path / "c2.csv"; pd.concat([lm, many(12, "Lanka Tea Co", "Island Tea Logo", 5, start=700)], ignore_index=True).to_csv(p2, index=False)
    both = next(r for r in node("exec", p2, {})["classified"] if r["theme"] == "Island Tea Logo")
    assert set(both["types"]) == {"Exclusive Sponsorship / Value-Add", "High-Frequency Reminders"}
    # the thresholds are editable
    d3 = node("exec", p, {"channels": ["DERANA"], "min_daily": 9})
    assert ("Nestle Lanka Ltd", "Maggi Short (10)") in {(r["advertiser"], r["theme"]) for r in d3["classified"] if r["frequency"]}
    # the drill-down for the programme lists the same classified ads
    x = node("execDetail", p, {"channel": "DERANA", "program": PROG})
    assert {(r["advertiser"], r["theme"]) for r in x["classified"]} >= {("Lanka Tea Co", "Island Tea Logo"), ("Lanka Tea Co", "Island Tea Reminder (5)")}
    assert x["classification"]["frequency_ads"] >= 3 and x["classification"]["exclusive_ads"] >= 1


def test_keywords_logo_intro_outro(tmp_path):
    import synth
    lm = synth.make_lmrb(days=20, start="2026-06-01", seed=6)
    rows = lm[lm["Channel"] == "Tv - Derana"].head(30)
    parts = [lm] + [rows.assign(Advertiser="Lanka Tea Co", Advt_Theme=t, Cost=9000 + i, AdPos=800 + i) for i, t in enumerate(["Island Tea Logo", "Big Show Intro", "Big Show Outro", "Introduction Offer (30)"])]
    p = tmp_path / "k.csv"; pd.concat(parts, ignore_index=True).to_csv(p, index=False)
    d = node("exec", p, {"channels": ["DERANA"]})
    items = {r["theme"]: r["item"] for r in d["classified"] if r["advertiser"] == "Lanka Tea Co"}
    assert items["Island Tea Logo"] == "Logo" and items["Big Show Intro"] == "Intro" and items["Big Show Outro"] == "Outro"
    assert "Introduction Offer (30)" not in items            # a whole word only: this is a normal commercial
