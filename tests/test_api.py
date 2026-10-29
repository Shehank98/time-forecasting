import uuid

import pytest
from fastapi.testclient import TestClient

import synth
from app.main import app
from app.routers import data as data_router
from helpers import ADMIN, api, login, new_client, up


def test_health_and_static_pages():
    c = TestClient(app)
    assert c.get("/health").json()["status"] == "ok"
    for page in ("/", "/login.html", "/tv.html", "/lmrb.html", "/kpi.html", "/admin.html", "/css/app.css", "/js/charts.js"):
        assert c.get(page).status_code == 200, page


def test_api_requires_sign_in_and_csrf_header():
    anon = TestClient(app, headers={"X-Requested-With": "fetch"})
    assert anon.get("/api/auth/me").status_code == 401
    assert anon.post("/api/lmrb/dashboard", json={}).status_code == 401
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


def test_workspace_needs_a_client():
    c = login()
    assert c.post("/api/lmrb/dashboard", json={}).status_code == 409
    c.headers["X-Client-Id"] = "999999"
    assert c.post("/api/lmrb/dashboard", json={}).status_code == 403 or c.post("/api/lmrb/dashboard", json={}).status_code == 404


def test_upload_report_state_and_persistence():
    c = api()
    r = up(c, "lmrb", synth.make_lmrb())
    assert r.status_code == 200 and r.json()["report"]["rows_kept"] > 0 and "advertiser" in r.json()["options"]
    from app.services import store
    store.cache.clear()                                      # force a reload from the database
    st = c.get("/api/lmrb/state").json()
    assert st["loaded"] is True and st["report"]["rows_kept"] == r.json()["report"]["rows_kept"]
    s = c.get("/api/workspace/summary").json()
    assert s["datasets"][0]["kind"] == "lmrb" and s["uploads"][0]["file_name"] == "a.csv"
    assert c.delete("/api/lmrb").json() == {"loaded": False} and c.get("/api/lmrb/state").json()["loaded"] is False


def test_validation_errors_are_friendly():
    c = api()
    assert c.post("/api/lmrb/upload", files={"file": ("x.pdf", b"abc")}).status_code == 415
    r = c.post("/api/lmrb/upload", files={"file": ("x.csv", b"foo,bar\n1,2\n")})
    assert r.status_code == 422 and "header" in r.json()["detail"].lower()
    r = c.post("/api/tv/upload", files={"file": ("x.csv", b"Channel,Date,TVR\nA,2026/09/01,1\n")})
    assert r.status_code == 422 and "Missing required columns" in r.json()["detail"]
    assert c.post("/api/nope/upload", files={"file": ("x.csv", b"a")}).status_code == 404
    assert c.post("/api/lmrb/dashboard", json={}).status_code == 409


def test_upload_size_limit(monkeypatch):
    monkeypatch.setattr(data_router, "MAX_UPLOAD_MB", 1)
    c = api()
    r = c.post("/api/lmrb/upload", files={"file": ("big.csv", b"a" * (1024 * 1024 + 10))})
    assert r.status_code == 413 and "limit" in r.json()["detail"]


def test_append_merges_and_dedupes():
    c = api()
    full = synth.make_lmrb(days=30)
    r1 = up(c, "lmrb", full[full["Mn"] == 8]).json()["report"]["rows_kept"]
    r = up(c, "lmrb", full, "b.csv", "append").json()
    assert r["report"]["appended"] and r["report"]["rows_skipped_as_duplicates"] == r1 and r["files"] == ["a.csv", "b.csv"]
    assert r["report"]["rows_total_after_merge"] == r["report"]["rows_added"] + r1


def test_clients_are_isolated_and_planners_need_access():
    admin = login()
    a, b = new_client(admin), new_client(admin)
    admin.headers["X-Client-Id"] = str(a)
    up(admin, "lmrb", synth.make_lmrb(days=10))
    admin.headers["X-Client-Id"] = str(b)
    assert admin.get("/api/lmrb/state").json()["loaded"] is False          # client B does not see client A's data
    email = f"planner{uuid.uuid4().hex[:6]}@agency.lk"
    uid = admin.post("/api/users", json={"email": email, "password": "planner-pass-1", "role": "planner", "client_ids": [b]}).json()["id"]
    p = login(email, "planner-pass-1")
    assert [x["id"] for x in p.get("/api/clients").json()] == [b]
    p.headers["X-Client-Id"] = str(a)
    assert p.get("/api/lmrb/state").status_code == 403
    assert p.post("/api/clients", json={"name": "Nope"}).status_code == 403 and p.get("/api/users").status_code == 403
    admin.put(f"/api/users/{uid}", json={"active": False})
    assert p.get("/api/auth/me").status_code == 401                         # deactivation ends sessions


def test_cannot_remove_the_last_admin():
    c = login()
    me = c.get("/api/auth/me").json()["user"]
    from app.services import repo
    if repo.count_admins() == 1:
        assert c.put(f"/api/users/{me['id']}", json={"role": "planner"}).status_code == 422


def test_client_delete_needs_exact_name_and_cascades():
    c = login()
    name = f"Delete Me {uuid.uuid4().hex[:5]}"
    cid = new_client(c, name)
    c.headers["X-Client-Id"] = str(cid)
    up(c, "lmrb", synth.make_lmrb(days=8))
    assert c.delete(f"/api/clients/{cid}?confirm=wrong").status_code == 422
    assert c.delete(f"/api/clients/{cid}", params={"confirm": name}).json()["deleted"]
    from app.services import repo
    assert repo.list_datasets(cid) == []


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


def test_dashboard_filters_counter_and_empty():
    c = api()
    up(c, "lmrb", synth.make_lmrb())
    d = c.post("/api/lmrb/dashboard", json={"filters": {"channel": ["DERANA"], "daypart": ["Prime"]}, "options": {"my_brand": "Nestle Lanka Ltd"}}).json()
    assert d["meta"]["filtered_rows"] < d["meta"]["total_rows"] and {x["key"] for x in d["meta"]["chips"]} == {"channel", "daypart"}
    assert d["data"]["kpis"]["active_channels"] == 1
    e = c.post("/api/lmrb/dashboard", json={"filters": {"advertiser": ["Nobody"]}}).json()
    assert e["data"]["empty"] is True and e["meta"]["filtered_rows"] == 0


def test_tv_and_lmrb_together_give_opportunity_and_grps():
    c = api()
    up(c, "tv", synth.make_tv())
    assert c.post("/api/tv/dashboard", json={}).json()["data"]["opportunity"] is None
    up(c, "lmrb", synth.make_lmrb())
    assert c.post("/api/tv/dashboard", json={}).json()["data"]["opportunity"] is not None
    d = c.post("/api/lmrb/dashboard", json={"options": {"my_brand": "Nestle Lanka Ltd"}}).json()
    assert d["data"]["grp"]["total_grps"] > 0 and d["meta"]["grp_stats"]["matched_spots"] > 0


def test_rows_endpoint_paginates_sorts_and_searches():
    c = api()
    up(c, "lmrb", synth.make_lmrb())
    r = c.post("/api/lmrb/rows", json={"page": 2, "page_size": 10, "sort": "cost", "desc": True}).json()
    assert len(r["rows"]) == 10 and r["total"] > 100 and r["page"] == 2
    s = c.post("/api/lmrb/rows", json={"search": "ceylon foods"}).json()
    assert 0 < s["total"] < r["total"]
    csv = c.post("/api/lmrb/rows/csv", json={"filters": {"channel": ["HIRU"]}})
    assert csv.status_code == 200 and csv.text.splitlines()[0].startswith("date,") and "HIRU" in csv.text
    assert c.post("/api/lmrb/rows", json={"page_size": 100000}).json()["page_size"] == 200


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


def test_forecast_jobs_are_private_to_their_user():
    c = api()
    up(c, "lmrb", synth.make_lmrb())
    jid = c.post("/api/forecast/start", json={"kind": "lmrb", "params": {"metric": "spend", "entity_type": "total", "granularity": "weekly", "horizon_days": 28}}).json()["job_id"]
    email = f"p{uuid.uuid4().hex[:6]}@agency.lk"
    login().post("/api/users", json={"email": email, "password": "planner-pass-1", "client_ids": [int(c.headers["X-Client-Id"])]})
    other = login(email, "planner-pass-1")
    other.headers["X-Client-Id"] = c.headers["X-Client-Id"]
    assert other.get(f"/api/forecast/job/{jid}").status_code == 404
