import pytest
from fastapi.testclient import TestClient

import synth
from app import main
from app.main import app


def up(c, kind, df, name="a.csv", mode="replace"):
    data = synth.to_csv_bytes(df)
    return c.post(f"/api/{kind}/upload?mode={mode}", files={"file": (name, data)})


def test_health_and_static_pages():
    c = TestClient(app)
    assert c.get("/health").json()["status"] == "ok"
    for page in ("/", "/tv.html", "/lmrb.html", "/css/app.css", "/js/charts.js"):
        assert c.get(page).status_code == 200
    assert "TV Programme Analysis" in c.get("/").text and "LMRB Ad Monitoring" in c.get("/").text
    assert c.get("/api/model-status").json()["backend"] in {"pending", "fallback", "timesfm"}


def test_upload_report_state_and_clear():
    c = TestClient(app)
    r = up(c, "lmrb", synth.make_lmrb())
    assert r.status_code == 200 and r.json()["report"]["rows_kept"] > 0 and "advertiser" in r.json()["options"]
    assert c.get("/api/lmrb/state").json()["loaded"] is True and c.get("/api/tv/state").json()["loaded"] is False
    assert c.delete("/api/lmrb").json() == {"loaded": False} and c.get("/api/lmrb/state").json()["loaded"] is False


def test_validation_errors_are_friendly():
    c = TestClient(app)
    assert c.post("/api/lmrb/upload", files={"file": ("x.pdf", b"abc")}).status_code == 415
    r = c.post("/api/lmrb/upload", files={"file": ("x.csv", b"foo,bar\n1,2\n")})
    assert r.status_code == 422 and "header" in r.json()["detail"].lower()
    r = c.post("/api/tv/upload", files={"file": ("x.csv", b"Channel,Date,TVR\nA,2026/09/01,1\n")})
    assert r.status_code == 422 and "Missing required columns" in r.json()["detail"]
    assert c.post("/api/nope/upload", files={"file": ("x.csv", b"a")}).status_code == 404
    assert c.post("/api/lmrb/dashboard", json={}).status_code == 409


def test_upload_size_limit(monkeypatch):
    monkeypatch.setattr(main, "MAX_UPLOAD_MB", 1)
    c = TestClient(app)
    big = b"a" * (1024 * 1024 + 10)
    r = c.post("/api/lmrb/upload", files={"file": ("big.csv", big)})
    assert r.status_code == 413 and "limit" in r.json()["detail"]


def test_append_merges_and_dedupes():
    c = TestClient(app)
    full = synth.make_lmrb(days=30)
    first = full[(full["Mn"] == 8)]
    r1 = up(c, "lmrb", first).json()["report"]["rows_kept"]
    r = up(c, "lmrb", full, "b.csv", "append").json()
    assert r["report"]["appended"] and r["report"]["rows_skipped_as_duplicates"] == r1 and r["files"] == ["a.csv", "b.csv"]
    assert r["report"]["rows_total_after_merge"] == r["report"]["rows_added"] + r1


def test_sessions_are_isolated():
    a, b = TestClient(app), TestClient(app)
    up(a, "lmrb", synth.make_lmrb(days=10))
    assert a.get("/api/lmrb/state").json()["loaded"] and not b.get("/api/lmrb/state").json()["loaded"]


def test_dashboard_filters_counter_and_empty():
    c = TestClient(app)
    up(c, "lmrb", synth.make_lmrb())
    d = c.post("/api/lmrb/dashboard", json={"filters": {"channel": ["DERANA"], "daypart": ["Prime"]}, "options": {"my_brand": "Nestle Lanka Ltd"}}).json()
    assert d["meta"]["filtered_rows"] < d["meta"]["total_rows"] and {x["key"] for x in d["meta"]["chips"]} == {"channel", "daypart"}
    assert d["data"]["kpis"]["active_channels"] == 1
    e = c.post("/api/lmrb/dashboard", json={"filters": {"advertiser": ["Nobody"]}}).json()
    assert e["data"]["empty"] is True and e["meta"]["filtered_rows"] == 0


def test_tv_dashboard_hides_opportunity_until_lmrb_loaded():
    c = TestClient(app)
    up(c, "tv", synth.make_tv())
    assert c.post("/api/tv/dashboard", json={}).json()["data"]["opportunity"] is None
    up(c, "lmrb", synth.make_lmrb())
    assert c.post("/api/tv/dashboard", json={}).json()["data"]["opportunity"] is not None


def test_rows_endpoint_paginates_sorts_and_searches():
    c = TestClient(app)
    up(c, "lmrb", synth.make_lmrb())
    r = c.post("/api/lmrb/rows", json={"page": 2, "page_size": 10, "sort": "cost", "desc": True}).json()
    assert len(r["rows"]) == 10 and r["total"] > 100 and r["page"] == 2
    s = c.post("/api/lmrb/rows", json={"search": "ceylon foods"}).json()
    assert 0 < s["total"] < r["total"]
    csv = c.post("/api/lmrb/rows/csv", json={"filters": {"channel": ["HIRU"]}})
    assert csv.status_code == 200 and csv.text.splitlines()[0].startswith("date,") and "HIRU" in csv.text
    assert c.post("/api/lmrb/rows", json={"page_size": 100000}).json()["page_size"] == 200


def test_config_endpoints_round_trip_and_apply(tmp_path, monkeypatch):
    import shutil
    from app.services import normalise as nz
    shutil.copytree(nz.CONFIG_DIR, tmp_path / "cfg")
    monkeypatch.setattr(nz, "CONFIG_DIR", tmp_path / "cfg")
    nz._cache.clear()
    c = TestClient(app)
    cfg = c.get("/api/config/channel_aliases").json()
    cfg["MYCHAN"] = ["MY CHANNEL", "MYCHAN TV"]
    assert c.put("/api/config/channel_aliases", json=cfg).json() == {"saved": True}
    assert nz.normalise_channel("Tv - my channel") == ("MYCHAN", True)
    assert c.get("/api/config/other").status_code == 404
    nz._cache.clear()
