import uuid

import pytest
from fastapi.testclient import TestClient

import synth
from app.main import app
from helpers import ADMIN, api, login, new_client, series_payload, summary, wait_job


def test_health_and_static_pages():
    c = TestClient(app)
    assert c.get("/health").json()["status"] == "ok"
    for page in ("/", "/login.html", "/tv.html", "/lmrb.html", "/kpi.html", "/admin.html", "/css/app.css", "/js/charts.js", "/js/engine/core.js", "/js/data-worker.js"):
        assert c.get(page).status_code == 200, page


def test_api_requires_sign_in_and_csrf_header():
    anon = TestClient(app, headers={"X-Requested-With": "fetch"})
    assert anon.get("/api/auth/me").status_code == 401
    assert anon.post("/api/forecast/run", json={"series": []}).status_code == 401
    raw = TestClient(app)          # no X-Requested-With header: blocked before auth
    assert raw.post("/api/auth/login", json={"email": ADMIN[0], "password": ADMIN[1]}).status_code == 403


def test_login_failures_and_throttle():
    c = TestClient(app, headers={"X-Requested-With": "fetch"})
    email = f"nobody{uuid.uuid4().hex[:6]}@x.lk"
    codes = [c.post("/api/auth/login", json={"email": email, "password": "wrong-password"}).status_code for _ in range(6)]
    assert codes[:5] == [401] * 5 and codes[5] == 429


def test_me_logout_and_cookie_flags():
    c = login()
    me = c.get("/api/auth/me").json()
    assert me["user"]["role"] == "admin" and "agency_name" in me["branding"]
    r = TestClient(app, headers={"X-Requested-With": "fetch", "x-forwarded-proto": "https"}).post("/api/auth/login", json={"email": ADMIN[0], "password": ADMIN[1]})
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "secure" in cookie and "samesite=lax" in cookie
    assert c.post("/api/auth/logout").json()["ok"] and c.get("/api/auth/me").status_code == 401


def test_cannot_remove_the_last_admin():
    c = login()
    me = c.get("/api/auth/me").json()["user"]
    from app.services import repo
    if repo.count_admins() == 1:
        assert c.put(f"/api/users/{me['id']}", json={"role": "planner"}).status_code == 422


def test_logo_upload_validation():
    c = login()
    cid = new_client(c)
    png = b"\x89PNG\r\n\x1a\n" + b"0" * 100
    assert c.post(f"/api/clients/{cid}/logo", files={"file": ("l.png", png, "image/png")}).json()["ok"]
    assert c.get(f"/api/clients/{cid}/logo").content == png
    assert c.post(f"/api/clients/{cid}/logo", files={"file": ("l.png", b"<svg/>", "image/png")}).status_code == 422
    assert c.post("/api/branding/logo", files={"file": ("l.gif", b"GIF89a", "image/gif")}).status_code == 422


def test_branding_round_trip():
    c = login()
    b = c.put("/api/branding", json={"agency_name": "Media Mind LK", "primary_color": "#112233"}).json()
    assert b["agency_name"] == "Media Mind LK" and b["primary_color"] == "#112233"
    assert c.put("/api/branding", json={"primary_color": "red"}).status_code == 422
    assert TestClient(app).get("/api/branding/public").json()["agency_name"] == "Media Mind LK"


def test_config_is_admin_only_and_applies(tmp_path, monkeypatch):
    import shutil
    from app.services import normalise as nz
    shutil.copytree(nz.CONFIG_DIR, tmp_path / "cfg")
    monkeypatch.setattr(nz, "CONFIG_DIR", tmp_path / "cfg")
    nz._cache.clear()
    c = login()
    cfg = c.get("/api/config/channel_aliases").json()
    cfg["MYCHAN"] = ["MY CHANNEL", "MYCHAN TV"]
    assert c.put("/api/config/channel_aliases", json=cfg).json() == {"saved": True}
    assert nz.normalise_channel("Tv - my channel") == ("MYCHAN", True)
    email = f"p{uuid.uuid4().hex[:6]}@agency.lk"
    c.post("/api/users", json={"email": email, "password": "planner-pass-1"})
    assert login(email, "planner-pass-1").put("/api/config/channel_aliases", json=cfg).status_code == 403
    nz._cache.clear()


def test_short_admin_password_does_not_stop_startup(monkeypatch, tmp_path):
    from app.services import auth, db
    monkeypatch.setenv("SQLITE_PATH", str(tmp_path / "fresh.db"))
    monkeypatch.setenv("DATABASE_URL", "")
    monkeypatch.setenv("ADMIN_EMAIL", "boss@agency.lk")
    monkeypatch.setenv("ADMIN_PASSWORD", "short")
    db.reset_engine()
    try:
        auth.bootstrap_admin()                       # must not raise
        assert not auth.has_users() and "10 characters" in auth.SETUP_PROBLEM
        assert TestClient(app).get("/api/branding/public").json()["setup_problem"]
        monkeypatch.setenv("ADMIN_PASSWORD", "long-enough-pass")
        auth.bootstrap_admin()
        assert auth.has_users() and auth.SETUP_PROBLEM is None
    finally:
        db.reset_engine()
        monkeypatch.undo()
        db.engine()


def test_workspace_needs_a_client_and_access():
    c = login()
    assert c.post("/api/forecast/run", json={"series": series_payload(), "params": {}}).status_code == 409
    c.headers["X-Client-Id"] = "999999"
    assert c.post("/api/forecast/run", json={"series": series_payload(), "params": {}}).status_code in (403, 404)


def test_planner_access_and_job_privacy():
    admin = login()
    a, b = new_client(admin), new_client(admin)
    email = f"planner{uuid.uuid4().hex[:6]}@agency.lk"
    uid = admin.post("/api/users", json={"email": email, "password": "planner-pass-1", "role": "planner", "client_ids": [b]}).json()["id"]
    p = login(email, "planner-pass-1")
    assert [x["id"] for x in p.get("/api/clients").json()] == [b]
    p.headers["X-Client-Id"] = str(a)
    assert p.post("/api/forecast/run", json={"series": series_payload(), "params": {}}).status_code == 403
    assert p.post("/api/clients", json={"name": "Nope"}).status_code == 403 and p.get("/api/users").status_code == 403
    admin.headers["X-Client-Id"] = str(b)
    jid = admin.post("/api/forecast/run", json={"series": series_payload(), "params": {"granularity": "daily", "horizon_days": 7}}).json()["job_id"]
    p.headers["X-Client-Id"] = str(b)
    assert p.get(f"/api/forecast/job/{jid}").status_code == 404           # jobs are private to the user who started them
    admin.put(f"/api/users/{uid}", json={"active": False})
    assert p.get("/api/auth/me").status_code == 401


def test_forecast_run_from_browser_series():
    c = api()
    payload = series_payload(n=3) + series_payload("tv", "tvr", "channel", n=2)
    for s in payload[3:]:
        s["group"] = "tv"
    j = wait_job(c, c.post("/api/forecast/run", json={"kind": "mixed", "series": payload, "params": {"granularity": "daily", "horizon_days": 21, "lead_days": 7}}).json()["job_id"])
    res = j["result"]
    assert j["status"] == "done" and res["ok"] and len(res["results"]) == 5
    assert {r["group"] for r in res["results"]} == {"g1", "tv"} and len(res["results"][0]["forecast"]["p50"]) == 21
    assert res["results"][0]["reliability"]["level"] in ("High", "Medium", "Low") and "peaks" in res["results"][0]
    again = wait_job(c, c.post("/api/forecast/run", json={"kind": "mixed", "series": payload, "params": {"granularity": "daily", "horizon_days": 21, "lead_days": 7}}).json()["job_id"])
    assert again["result"]["cached"] is True


@pytest.mark.parametrize("bad,msg", [
    ({"dates": ["2026-01-01", "2026-01-03"], "values": [1, 2]}, "regularly spaced"),
    ({"dates": ["2026-01-01"], "values": [1, 2]}, "same, non-zero length"),
    ({"dates": ["nope"], "values": [1]}, "invalid dates")])
def test_forecast_payload_validation(bad, msg):
    c = api()
    r = c.post("/api/forecast/run", json={"series": [{"entity": "x", **bad}], "params": {"granularity": "daily"}})
    assert r.status_code == 422 and msg in r.json()["detail"]
    assert c.post("/api/forecast/run", json={"series": series_payload(), "params": {"horizon_days": 9999}}).status_code == 422


def test_request_size_guard():
    c = api()
    r = c.post("/api/forecast/run", content=b"{}", headers={"Content-Type": "application/json", "Content-Length": str(500 * 1024 * 1024)})
    assert r.status_code == 413


def test_scenarios_and_pacing_from_series():
    c = api()
    spend = series_payload(metric="spend", entity_type="total", gran="weekly")[0]
    spots = series_payload(metric="spots", entity_type="total", gran="weekly")[0]
    j = wait_job(c, c.post("/api/scenarios/run", json={"target": spots, "driver": spend, "params": {"granularity": "weekly", "horizon_days": 28, "multipliers": [0.8, 1, 1.2]}}).json()["job_id"])
    assert j["result"]["ok"] and [s["scenario"] for s in j["result"]["scenarios"]] == ["Budget -20%", "Current pace", "Budget +20%"]
    assert c.post("/api/scenarios/run", json={"target": spots, "driver": spend, "params": {"multipliers": [9]}}).status_code == 422
    daily = series_payload(metric="spend", entity_type="total", gran="daily")[0]
    p = c.post("/api/pacing/run", json={"series": daily, "params": {"start": daily["dates"][-20], "end": "2026-09-30", "target": 5e7, "entity": "Market"}}).json()
    assert p["ok"] and p["entity"] == "Market" and p["status"] in ("On track", "Under pacing", "Over pacing")
    assert c.post("/api/pacing/run", json={"series": daily, "params": {"start": "2026-09-01", "end": "2026-09-30", "target": -1}}).status_code == 422


def test_saved_forecasts_and_summary():
    c = api()
    sid = c.post("/api/saved-forecasts", json={"title": "Q4 plan", "ftype": "outlook", "request": {"kind": "tv"}, "result": {"ok": True}}).json()["id"]
    assert any(f["id"] == sid for f in c.get("/api/workspace/summary").json()["forecasts"])
    assert c.post("/api/saved-forecasts", json={"title": "x", "ftype": "nope", "request": {}, "result": {}}).status_code == 422
    other = api()
    assert other.get(f"/api/saved-forecasts/{sid}").status_code == 404


def test_client_delete_needs_exact_name():
    c = login()
    name = f"Delete Me {uuid.uuid4().hex[:5]}"
    cid = new_client(c, name)
    c.headers["X-Client-Id"] = str(cid)
    c.post("/api/saved-forecasts", json={"title": "t", "request": {}, "result": {}})
    assert c.delete(f"/api/clients/{cid}?confirm=wrong").status_code == 422
    assert c.delete(f"/api/clients/{cid}", params={"confirm": name}).json()["deleted"]
    from app.services import repo
    assert repo.list_forecasts(cid) == []
