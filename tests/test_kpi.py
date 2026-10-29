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


def _upload_kpi(c, name="Leads 2026"):
    p = c.post("/api/kpi/propose", files={"file": ("kpi.csv", synth.to_csv_bytes(synth.make_kpi()))}).json()
    r = c.post("/api/kpi/apply", json={"token": p["token"], "dataset": name, "mapping": p["suggested"]})
    assert r.status_code == 200, r.text
    return r.json()


def test_kpi_endpoints_end_to_end():
    c = api()
    st = _upload_kpi(c)
    assert st["loaded"] and st["meta"]["granularity"] == "daily" and st["datasets"][0]["name"] == "Leads 2026"
    d = c.post("/api/kpi/dashboard", json={"dataset": "Leads 2026", "filters": {"segment": ["TV burst"]}}).json()
    assert d["data"]["segments"] == [] and d["meta"]["filtered_rows"] < d["meta"]["total_rows"]
    ent = c.post("/api/forecast/entities", json={"kind": "kpi", "dataset": "Leads 2026", "params": {"entity_type": "segment"}}).json()
    assert {"leads", "cpl", "media_spend_lkr"} <= set(ent["catalog"]["metrics"]) and ent["default_granularity"] == "daily"
    pc = c.post("/api/pacing", json={"kind": "kpi", "dataset": "Leads 2026", "params": {"metric": "leads", "entity_type": "total", "start": "2026-09-01", "end": "2026-10-31", "target": 9000}}).json()
    assert pc["ok"] and pc["status"] in {"On track", "Under pacing", "Over pacing"}
    assert c.post("/api/pacing", json={"kind": "kpi", "dataset": "Leads 2026", "params": {"metric": "ctr", "entity_type": "total", "start": "2026-09-01", "end": "2026-10-31", "target": 1}}).json()["ok"] is False
    m = c.put("/api/kpi/meta", json={"dataset": "Leads 2026", "metrics": [{"key": "leads", "label": "Qualified leads"}], "ratios": [{"label": "CPL", "num": "media_spend_lkr", "den": "leads"}]}).json()
    assert [x["label"] for x in m["meta"]["metrics"] if x["key"] == "leads"] == ["Qualified leads"] and m["meta"]["ratios"][0]["label"] == "CPL"
    assert c.post("/api/kpi/apply", json={"token": "nope", "dataset": "X", "mapping": {}}).status_code == 422
    assert c.post("/api/kpi/apply", json={"token": "nope", "dataset": "bad:name", "mapping": {}}).status_code == 422


def test_kpi_scenarios_job_and_saving():
    import time
    c = api()
    _upload_kpi(c, "Leads")
    body = {"kind": "kpi", "dataset": "Leads", "params": {"target": "leads", "driver": "media_spend_lkr", "entity_type": "total", "granularity": "weekly", "horizon_days": 28, "multipliers": [0.8, 1.0, 1.3]}}
    jid = c.post("/api/scenarios/start", json=body).json()["job_id"]
    for _ in range(100):
        j = c.get(f"/api/forecast/job/{jid}").json()
        if j["status"] != "running":
            break
        time.sleep(0.1)
    res = j["result"]
    assert res["ok"] and len(res["scenarios"]) == 3
    p50 = [s["kpi_p50"] for s in res["scenarios"]]
    assert p50[0] < p50[1] < p50[2] and res["driver_effect"]["slope"] > 0
    assert c.post("/api/scenarios/start", json={**body, "params": {**body["params"], "driver": "leads"}}).status_code == 422
    sid = c.post("/api/saved-forecasts", json={"title": "Q4 plan", "ftype": "scenarios", "request": body, "result": res}).json()["id"]
    assert c.get(f"/api/saved-forecasts/{sid}").json()["title"] == "Q4 plan"
    assert any(f["id"] == sid for f in c.get("/api/workspace/summary").json()["forecasts"])
