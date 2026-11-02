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
    tags = {(r["advertiser"], r["theme"]): r["spots"] for r in x["sponsorship"]["tags"]}
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
              "Detailed breakdown: channels", "Detailed breakdown: programmes", "Commercial spots", "Sponsorship tag", "Teledrama Night", "Share of wallet"):
        assert s in text, s
    assert "—" not in text
