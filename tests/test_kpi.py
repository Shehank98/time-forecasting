import numpy as np
import pandas as pd
import pytest

import synth
from app.services import analytics_kpi, ingest, ingest_kpi
from app.services import forecast as F
from helpers import api


@pytest.fixture(scope="module")
def prop():
    return ingest_kpi.propose(synth.to_csv_bytes(synth.make_kpi()), "kpi.csv")


def test_propose_detects_columns_units_roles_and_ratios(prop):
    s = prop["suggested"]
    assert s["date_column"] == "Date" and s["segment_column"] == "Campaign"
    m = {x["label"]: x for x in s["metrics"]}
    assert m["Media Spend (LKR)"]["unit"] == "currency" and m["Media Spend (LKR)"]["role"] == "driver"
    assert m["Leads"]["agg"] == "sum" and m["CTR %"]["agg"] == "mean" and m["CTR %"]["unit"] == "percent"
    keys = {r["key"]: r for r in s["ratios"]}
    assert keys["cpl"]["den"] == "leads" and keys["cpc"]["den"] == "clicks"


def test_apply_builds_tidy_frame_and_report(prop):
    df, report, meta = ingest_kpi.apply(prop["token"], prop["suggested"])
    assert list(df.columns[:2]) == ["date", "segment"] and report["granularity"] == "daily"
    assert df["media_spend_lkr"].dtype.kind == "f" and df["media_spend_lkr"].max() > 1000   # commas parsed
    assert pd.Timestamp("2025-08-13") in set(df["date"])                                      # day-first dates
    assert {r["key"] for r in meta["ratios"]} >= {"cpl"}
    with pytest.raises(ingest.IngestError, match="expired"):
        ingest_kpi.apply(prop["token"], prop["suggested"])


def test_monthly_detection_and_bad_files():
    csv = b"Month,Sales\n2025-01-01,10\n2025-02-01,12\n2025-03-01,9\n2025-04-01,15\n"
    p = ingest_kpi.propose(csv, "m.csv")
    df, rep, meta = ingest_kpi.apply(p["token"], p["suggested"])
    assert meta["granularity"] == "monthly" and "Sales" in [m["label"] for m in meta["metrics"]]
    with pytest.raises(ingest.IngestError, match="date column"):
        ingest_kpi.propose(b"Name,Value\na,1\nb,2\n", "x.csv")


def test_merge_replaces_restated_rows():
    a = pd.DataFrame({"date": pd.to_datetime(["2026-01-01", "2026-01-02"]), "segment": "All", "leads": [1.0, 2.0]})
    b = pd.DataFrame({"date": pd.to_datetime(["2026-01-02", "2026-01-03"]), "segment": "All", "leads": [5.0, 3.0]})
    m, added, replaced = ingest_kpi.merge(a, b)
    assert list(m["leads"]) == [1.0, 5.0, 3.0] and added == 1 and replaced == 1


def test_dashboard_kpis_ratios_drivers_and_seasonality(prop):
    p2 = ingest_kpi.propose(synth.to_csv_bytes(synth.make_kpi()), "kpi.csv")
    df, _, meta = ingest_kpi.apply(p2["token"], p2["suggested"])
    d = analytics_kpi.dashboard(df, meta, df)
    k = {x["key"]: x for x in d["kpis"]}
    assert k["cpl"]["value"] == pytest.approx(df["media_spend_lkr"].sum() / df["leads"].sum())
    assert d["driver_effects"] and d["driver_effects"][0]["correlation"] > 0.3
    assert "day_of_week" in d["seasonality"] and "month" in d["seasonality"]
    assert {s["segment"] for s in d["segments"]} == {"Always-on search", "TV burst"}


