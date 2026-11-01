"""Test helpers: signed-in API clients scoped to a fresh client workspace."""
import uuid

from fastapi.testclient import TestClient

import synth
from app.main import app

ADMIN = ("admin@agency.lk", "admin-pass-123")


def login(email: str = ADMIN[0], password: str = ADMIN[1], headers: dict | None = None, **kw) -> TestClient:
    c = TestClient(app, headers={"X-Requested-With": "fetch", **(headers or {})}, **kw)
    r = c.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return c


def new_client(c: TestClient, name: str | None = None) -> int:
    r = c.post("/api/clients", json={"name": name or f"Client {uuid.uuid4().hex[:8]}", "industry": "FMCG"})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def api(**kw) -> TestClient:
    """Admin client with its own client workspace selected."""
    c = login(**kw)
    c.headers["X-Client-Id"] = str(new_client(c))
    return c


def up(c: TestClient, kind: str, df, name: str = "a.csv", mode: str = "replace"):
    return c.post(f"/api/{kind}/upload?mode={mode}", files={"file": (name, synth.to_csv_bytes(df))})


def summary(kind: str, my_brand: str | None = "Nestle Lanka Ltd"):
    """What the browser sends: the dashboard summary (computed here with the Python reference analytics)."""
    from app.services import analytics_kpi, analytics_lmrb, analytics_tv, ingest, ingest_kpi
    if kind == "lmrb":
        df = ingest.parse(synth.to_csv_bytes(synth.make_lmrb()), "l.csv", "lmrb").df
        return analytics_lmrb.dashboard(df, None, None, my_brand), {"filtered_rows": len(df), "total_rows": len(df), "chips": []}
    if kind == "tv":
        tv = ingest.parse(synth.to_csv_bytes(synth.make_tv()), "t.csv", "tv").df
        lm = ingest.parse(synth.to_csv_bytes(synth.make_lmrb()), "l.csv", "lmrb").df
        return analytics_tv.dashboard(tv, lm), {"filtered_rows": len(tv), "total_rows": len(tv), "chips": []}
    p = ingest_kpi.propose(synth.to_csv_bytes(synth.make_kpi()), "k.csv")
    df, _, meta = ingest_kpi.apply(p["token"], p["suggested"])
    return analytics_kpi.dashboard(df, meta, df), {"filtered_rows": len(df), "total_rows": len(df), "chips": [], "dataset_meta": meta}


def series_payload(kind: str = "lmrb", metric: str = "spend", entity_type: str = "advertiser", gran: str = "daily", n: int = 4):
    """Series the browser would build, produced here with the Python reference series builder."""
    from app.services import ingest, series as S
    from app.services.util import jsonable
    df = ingest.parse(synth.to_csv_bytes(synth.make_lmrb() if kind == "lmrb" else synth.make_tv()), "x.csv", kind).df
    specs, _ = S.build_series(df, kind, entity_type, metric, gran, max_entities=n)
    return [jsonable({"entity": s.entity, "group": "g1", "metric": s.metric, "label": s.mdef.label, "unit": s.mdef.unit, "agg": s.mdef.agg,
                      "zero_fill": s.mdef.zero_fill, "dates": [str(d.date()) for d in s.dates], "values": list(s.values)}) for s in specs]


def wait_job(c: TestClient, jid: str) -> dict:
    import time
    for _ in range(300):
        j = c.get(f"/api/forecast/job/{jid}").json()
        if j["status"] != "running":
            return j
        time.sleep(0.05)
    raise AssertionError("job did not finish")
