import json

import pandas as pd
import pytest

import synth
from app.services import analytics_lmrb as A
from app.services import analytics_tv as T
from app.services import filters, ingest


@pytest.fixture(scope="module")
def lm():
    return ingest.parse(synth.to_csv_bytes(synth.make_lmrb()), "s.csv", "lmrb").df


@pytest.fixture(scope="module")
def tv():
    return ingest.parse(synth.to_csv_bytes(synth.make_tv()), "s.csv", "tv").df


def test_lmrb_dashboard_shape_and_json(lm):
    d = A.dashboard(lm, None, None, "Nestle Lanka Ltd")
    json.dumps(d)
    k = d["kpis"]
    assert k["total_spend"] == pytest.approx(lm[lm["advertiser"].isin(d["scope"])]["cost"].sum())
    assert 0 < k["sov_spend_pct"] < 100 and k["my_rank"] >= 1
    assert "Lanka Tea Co" not in d["scope"]  # different product group
    assert abs(sum(r["share_pct"] for r in d["by_advertiser"]) - 100) < 1e-6
    assert len(d["sov_weekly"]["weeks"]) >= 6


def test_competitor_set_override(lm):
    d = A.dashboard(lm, None, None, "Nestle Lanka Ltd", ["Lanka Tea Co"])
    assert set(d["scope"]) == {"Nestle Lanka Ltd", "Lanka Tea Co"}


def test_flighting_patterns(lm):
    d = A.dashboard(lm, None, None, "Nestle Lanka Ltd")
    pat = {f["advertiser"]: f["pattern"] for f in d["flighting"]["advertisers"]}
    assert pat["Nestle Lanka Ltd"] == "Always-on" and pat["Ceylon Foods"] == "Pulsing"


def test_alerts_detect_stop_and_discount(lm):
    d = A.dashboard(lm, None, None, "Nestle Lanka Ltd")
    types = {a["type"] for a in d["alerts"]["items"]}
    assert "stopped" in types or "channel_stop" in types
    assert all("—" not in a["text"] for a in d["alerts"]["items"])


def test_pricing_flags_discount_advertiser(lm):
    p = A.dashboard(lm, None, None, "Nestle Lanka Ltd")["pricing"]
    assert any(f["advertiser"] == "Ceylon Foods" for f in p["discount_flags"])


def test_position_shares_sum(lm):
    pos = A.position_strategy(lm)
    assert sum(r["share_of_first_pct"] for r in pos) == pytest.approx(100)


def test_empty_filter_result_is_handled(lm):
    out = filters.apply_filters(lm, "lmrb", {"advertiser": ["Nobody"]})
    assert out.empty
    assert A.dashboard(out, None, None, None) == {"empty": True}


def test_single_row_and_date_filters(lm):
    one = lm.iloc[:1]
    d = A.dashboard(one, None, None, None)
    assert d["kpis"]["spots"] == 1
    f = filters.apply_filters(lm, "lmrb", {"date_from": "2026-08-10", "date_to": "2026-08-16", "channel": ["DERANA"], "ad_position": ["first"]})
    assert f["date"].between("2026-08-10", "2026-08-16").all() and (f["channel"] == "DERANA").all() and f["is_first"].all()


def test_head_to_head(lm):
    h = A.head_to_head(lm, None, None, "Nestle Lanka Ltd", "Unilever Sri Lanka")
    assert not h["empty"] and len(h["highlights"]) >= 3
    json.dumps(h)


def test_tv_dashboard(tv, lm):
    d = T.dashboard(tv, lm)
    json.dumps(d)
    assert d["kpis"]["channels"] == 5 and d["kpis"]["top_programme"]["name"] == "TELEDRAMA ONE"
    assert d["opportunity"] is not None
    assert all(r["cv"] is not None for r in d["consistency"])
    assert T.dashboard(tv, None)["opportunity"] is None


def test_tv_filters(tv):
    f = filters.apply_filters(tv, "tv", {"program_search": "news", "tvr_min": 3, "daypart": ["Prime"]})
    assert len(f) and f["program"].str.contains("NEWS").all() and (f["tvr"] >= 3).all() and (f["daypart"] == "Prime").all()


def test_filter_options_and_chips(lm):
    o = filters.filter_options(lm, "lmrb")
    assert "Nestle Lanka Ltd" in o["advertiser"] and o["ad_position"] == ["first", "middle", "last"]
    chips = filters.describe_filters("lmrb", {"channel": ["DERANA"], "date_from": "2026-08-01"})
    assert {c["key"] for c in chips} == {"channel", "date"}
