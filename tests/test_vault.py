"""History vault: de-duplicated daily totals, merged into forecast contexts without ever replacing what the browser sent."""
import numpy as np
import pandas as pd
import pytest

import synth
from app.services import vault as V


@pytest.fixture(autouse=True)
def vault_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("VAULT_DIR", str(tmp_path / "vault"))
    monkeypatch.delenv("VAULT_ENABLED", raising=False)


def lm_rows(df: pd.DataFrame) -> list[dict]:
    """What the browser worker sends: totals per date, product group, advertiser and channel."""
    d = pd.DataFrame({"date": pd.to_datetime(dict(year=df["Yr"], month=df["Mn"], day=df["Dd"])).dt.strftime("%Y-%m-%d"), "product_group": df["Product_Group"], "advertiser": df["Advertiser"], "channel": df["Channel"],
                      "cost": df["Cost"], "dur": df["Dur"], "adsinbrk": df["AdsinBrk"], "totads": df["TotAds"]})
    d["cost_d"] = np.where(d["dur"] > 0, d["cost"], 0.0); d["seconds"] = np.where(d["dur"] > 0, d["dur"], 0.0); d["spots"] = 1
    d["totads_sum"] = d["totads"]; d["totads_n"] = 1; d["clutter_sum"] = d["adsinbrk"]; d["clutter_n"] = 1
    g = d.groupby(["date", "product_group", "advertiser", "channel"], as_index=False)[["cost", "cost_d", "seconds", "spots", "totads_sum", "totads_n", "clutter_sum", "clutter_n"]].sum()
    return g.to_dict("records")


@pytest.fixture()
def lm():
    return synth.make_lmrb(days=240, start="2026-01-01", seed=5)


def truth_spend(df, adv):
    t = pd.to_datetime(dict(year=df["Yr"], month=df["Mn"], day=df["Dd"]))
    return df[df["Advertiser"] == adv].groupby(t[df["Advertiser"] == adv])["Cost"].sum()


def test_ingest_is_idempotent_and_overlaps_replace_not_double(lm):
    rows = lm_rows(lm)
    r1 = V.ingest("lmrb", rows, user_id=1)
    assert r1["added"] == len(rows) and r1["changed"] == 0
    r2 = V.ingest("lmrb", rows, user_id=2)
    assert r2["added"] == 0 and r2["changed"] == 0 and r2["unchanged"] == len(rows)
    edited = [dict(r) for r in rows[:50]]; edited[0]["cost"] += 1000
    r3 = V.ingest("lmrb", edited, user_id=1)
    assert r3["added"] == 0 and r3["changed"] == 1
    d = V.daily({"kind": "lmrb", "group": "comp_spend", "product_group": rows[0]["product_group"], "entity": rows[0]["advertiser"]})
    total = sum(r["cost"] for r in rows if r["advertiser"] == rows[0]["advertiser"] and r["product_group"] == rows[0]["product_group"]) + 1000
    assert abs(d["num"].sum() - total) < 1e-6
    assert len(V.ledger()) == 2                              # the idempotent upload was not logged


def test_extend_prepends_only_dates_before_the_browser_series(lm):
    V.ingest("lmrb", lm_rows(lm))
    adv, pg = "Nestle Lanka Ltd", "Flavour Enhancers"
    truth = truth_spend(lm, adv).asfreq("D", fill_value=0.0)
    cut = truth.index[150]
    browser = truth[truth.index >= cut]
    item = {"entity": adv, "agg": "sum", "zero_fill": True, "dates": [str(d.date()) for d in browser.index], "values": browser.tolist(), "vault": {"kind": "lmrb", "group": "comp_spend", "product_group": pg, "entity": adv}}
    st = V.extend([item], "daily")
    assert st["series_extended"] == 1 and st["points_added"] == 150 and 4.5 < st["months"] < 5.5
    s = pd.Series(item["values"], index=pd.to_datetime(item["dates"]))
    assert s.index.is_monotonic_increasing and (s.index.to_series().diff().dropna() == pd.Timedelta(days=1)).all()
    assert np.allclose(s.to_numpy(), truth.reindex(s.index).to_numpy())          # history equals the truth, the browser part is untouched
    assert item["values"][-len(browser):] == browser.tolist()


@pytest.mark.parametrize("gran,freq", [("weekly", "W-SUN"), ("monthly", "MS")])
def test_extend_weekly_and_monthly_use_complete_periods(lm, gran, freq):
    V.ingest("lmrb", lm_rows(lm))
    adv, pg = "Unilever Sri Lanka", "Flavour Enhancers"
    truth = truth_spend(lm, adv).asfreq("D", fill_value=0.0)
    per = truth.resample("W-MON", label="left", closed="left").sum() if gran == "weekly" else truth.resample("MS").sum()
    start = per.index[-3]
    br = per[per.index >= start]
    item = {"entity": adv, "agg": "sum", "zero_fill": True, "dates": [str(d.date()) for d in br.index], "values": br.tolist(), "vault": {"kind": "lmrb", "group": "comp_spend", "product_group": pg, "entity": adv}}
    V.extend([item], gran)
    s = pd.Series(item["values"], index=pd.to_datetime(item["dates"]))
    assert len(s) > len(br)
    inter = s.index[s.index < start]
    full_periods = per.reindex(inter)
    first_complete = inter[0]
    assert first_complete >= truth.index[0]
    assert np.allclose(s.loc[inter].to_numpy(), full_periods.to_numpy(), equal_nan=True)


def test_ratio_mean_and_share_series_match_pandas(lm):
    V.ingest("lmrb", lm_rows(lm))
    pg = "Flavour Enhancers"
    t = pd.to_datetime(dict(year=lm["Yr"], month=lm["Mn"], day=lm["Dd"]))
    cps = V.daily({"kind": "lmrb", "group": "cps_total", "product_group": pg})
    keep = (lm["Dur"] > 0) & (lm["Product_Group"] == pg)
    ok = lm[keep].assign(t=t[keep])
    want = ok.groupby("t")["Cost"].sum() / ok.groupby("t")["Dur"].sum()
    got = cps["num"] / cps["den"]
    assert np.allclose(got.reindex(want.index).to_numpy(), want.to_numpy())
    tv = synth.make_tv(days=60, start="2026-06-01")
    rows = [{"date": pd.Timestamp(r["Date"].replace("/", "-")).strftime("%Y-%m-%d"), "channel": r["Channel"], "start": 72000, "program": r["Program"], "tvr": r["TVR"], "reach_pct": r["Reach %"], "category": r["Category"], "data_set": r["Data Set"]} for _, r in tv.iterrows()]
    V.ingest("tv", rows)
    d = V.daily({"kind": "tv", "group": "tvr_total"})
    assert np.allclose((d["num"] / d["den"]).to_numpy(), tv.assign(d=pd.to_datetime(tv["Date"])).groupby("d")["TVR"].mean().to_numpy())
    sh = V.daily({"kind": "tv", "group": "channel_share", "entity": "Tv - Derana"})
    one = sh["num"] / sh["den"] * 100
    assert (one > 0).all() and (one < 100).all()


def test_disabled_vault_changes_nothing(lm, monkeypatch):
    monkeypatch.setenv("VAULT_ENABLED", "0")
    assert V.ingest("lmrb", lm_rows(lm))["enabled"] is False
    item = {"entity": "x", "dates": ["2026-06-01"], "values": [1.0], "vault": {"kind": "lmrb", "group": "comp_spend", "product_group": "p", "entity": "x"}}
    assert V.extend([item], "daily")["series_extended"] == 0 and item["values"] == [1.0]


def test_unknown_series_and_empty_vault_are_ignored():
    item = {"entity": "x", "dates": ["2026-06-01", "2026-06-02"], "values": [1.0, 2.0], "vault": {"kind": "lmrb", "group": "comp_spend", "product_group": "none", "entity": "x"}}
    assert V.extend([item], "daily")["series_extended"] == 0
    assert V.daily({"kind": "lmrb", "group": "sov", "product_group": "p"}) is None


# ------------------------------------------------------------------ through the API
def test_api_ingest_status_and_forecast_use_stored_history(lm):
    from helpers import api, wait_job
    c = api()
    rows = lm_rows(lm)
    adv, pg = "Nestle Lanka Ltd", "Flavour Enhancers"
    assert c.post("/api/vault/ingest", json={"kind": "lmrb", "rows": rows[:100], "source": "a.csv"}).json()["added"] == 100
    for i in range(100, len(rows), 40000):
        assert c.post("/api/vault/ingest", json={"kind": "lmrb", "rows": rows[i:i + 40000]}).status_code == 200
    assert c.post("/api/vault/ingest", json={"kind": "lmrb", "rows": [{}] * 3}).status_code == 422
    assert c.post("/api/vault/ingest", json={"kind": "lmrb", "rows": [{"date": "2026-01-01"}] * 60001}).status_code == 422
    st = c.get("/api/vault/status", params={"product_group": pg}).json()
    assert st["lmrb"][pg]["months"] > 7 and st["lmrb"][pg]["advertisers"] >= 3
    assert st["adapters"]["training_enabled"] is False and st["adapters"]["applied_at_inference"] is False
    truth = truth_spend(lm, adv).asfreq("D", fill_value=0.0)
    last = truth[truth.index >= truth.index[-60]]
    item = {"entity": adv, "group": "comp_spend", "metric": "spend", "label": "Spend", "unit": "currency", "agg": "sum", "zero_fill": True, "dates": [str(d.date()) for d in last.index], "values": last.tolist(),
            "vault": {"kind": "lmrb", "group": "comp_spend", "product_group": pg, "entity": adv}}
    plain = {k: v for k, v in item.items() if k != "vault"}
    r = c.post("/api/forecast/run", json={"kind": "lmrb", "series": [item], "params": {"granularity": "daily", "horizon_days": 14, "covariates": False}}).json()
    res = wait_job(c, r["job_id"])["result"]
    assert res["vault"]["series_extended"] == 1 and res["vault"]["points_added"] == len(truth) - 60 and res["vault"]["months"] > 5
    assert res["results"][0]["n_points"] == len(truth)
    r2 = c.post("/api/forecast/run", json={"kind": "lmrb", "series": [plain], "params": {"granularity": "daily", "horizon_days": 14, "covariates": False}}).json()
    assert wait_job(c, r2["job_id"])["result"]["results"][0]["n_points"] == 60          # no descriptor, no extra history


def test_train_and_clear_are_admin_only_and_training_is_off_by_default():
    from fastapi.testclient import TestClient
    from app.main import app
    from helpers import api
    anon = TestClient(app, headers={"X-Requested-With": "fetch"})
    assert anon.post("/api/vault/train", json={}).status_code == 401
    c = api()
    r = c.post("/api/vault/train", json={"product_group": "Detergents"}).json()
    assert r["ok"] is False and "LORA_ENABLED" in r["message"]
    assert c.post("/api/vault/clear", json={"kind": "bogus"}).status_code == 422


# ------------------------------------------------------------------ incremental LoRA runner (data side)
def test_lora_dry_run_selects_only_new_windows_and_never_writes_weights(lm, tmp_path, monkeypatch):
    import json
    import subprocess
    import sys
    from pathlib import Path
    V.ingest("lmrb", lm_rows(lm))
    models = tmp_path / "models"; models.mkdir()
    env = {**__import__("os").environ, "VAULT_DIR": str(tmp_path / "vault"), "MODELS_DIR": str(models), "PYTHONPATH": str(Path(__file__).resolve().parent.parent)}
    script = str(Path(__file__).resolve().parent.parent / "scripts" / "incremental_lora_update.py")
    run = lambda *a: json.loads(subprocess.run([sys.executable, script, *a], capture_output=True, text=True, env=env, timeout=120, check=True).stdout)
    r = run("--product-group", "Flavour Enhancers", "--with-global", "--dry-run", "--context", "64", "--stride", "7")
    by = {a["adapter"]: a for a in r["adapters"]}
    assert by["lora_Flavour_Enhancers"]["new_windows"] > 10 and by["lora_Flavour_Enhancers"]["replay_windows"] == 0
    assert by["lora_global_sl"]["new_windows"] >= by["lora_Flavour_Enhancers"]["new_windows"]
    assert not list(models.glob("*.pt"))
    # an adapter that was already trained through the end of the vault has nothing new to learn, only replay
    (models / "lora_manifest.json").write_text(json.dumps({"lora_Flavour_Enhancers": {"trained_through": "2026-08-20"}}))
    r2 = {a["adapter"]: a for a in run("--product-group", "Flavour Enhancers", "--dry-run", "--context", "64", "--stride", "7")["adapters"]}
    assert 0 < r2["lora_Flavour_Enhancers"]["new_windows"] < by["lora_Flavour_Enhancers"]["new_windows"]
    assert r2["lora_Flavour_Enhancers"]["replay_windows"] > 0


def test_lora_real_run_without_torch_explains_itself(lm, tmp_path):
    import subprocess
    import sys
    from pathlib import Path
    try:
        import torch  # noqa: F401
        pytest.skip("torch is installed; the training step is exercised elsewhere")
    except ImportError:
        pass
    V.ingest("lmrb", lm_rows(lm))
    env = {**__import__("os").environ, "VAULT_DIR": str(tmp_path / "vault"), "MODELS_DIR": str(tmp_path / "m"), "PYTHONPATH": str(Path(__file__).resolve().parent.parent)}
    p = subprocess.run([sys.executable, str(Path(__file__).resolve().parent.parent / "scripts" / "incremental_lora_update.py"), "--product-group", "Flavour Enhancers", "--context", "64"], capture_output=True, text=True, env=env, timeout=120)
    assert p.returncode != 0 and "torch" in (p.stderr + p.stdout)


# ------------------------------------------------------------------ what the browser engine sends
def _node(kind, path):
    import json
    import shutil
    import subprocess
    from pathlib import Path
    if shutil.which("node") is None:
        pytest.skip("node is not installed")
    root = Path(__file__).resolve().parent.parent
    out = subprocess.run(["node", str(root / "tests/js/vaultrows.js"), kind, str(path)], capture_output=True, text=True, timeout=240)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def test_browser_totals_match_the_sheet_and_the_vault_round_trips(lm, tmp_path):
    p = tmp_path / "lm.csv"; lm.to_csv(p, index=False)
    r = _node("lmrb", p)
    assert abs(sum(x["cost"] for x in r["rows"]) - lm["Cost"].sum()) < 1e-3 and sum(x["spots"] for x in r["rows"]) == len(lm)
    assert {"comp_spend", "spots_total", "cps_total"} <= set(r["groups"]) and r["plain_has_vault"] is False
    res = V.ingest("lmrb", r["rows"])
    assert res["added"] == len(r["rows"]) and V.ingest("lmrb", r["rows"])["added"] == 0
    d = V.daily(next(x for x in r["desc"] if x["group"] == "comp_spend" and x["entity"] == "Nestle Lanka Ltd"))
    assert abs(d["num"].sum() - truth_spend(lm, "Nestle Lanka Ltd").sum()) < 1e-3


def test_tv_rows_and_descriptors(tmp_path):
    tv = synth.make_tv(days=40, start="2026-06-01"); p = tmp_path / "tv.csv"; tv.to_csv(p, index=False)
    r = _node("tv", p)
    assert len(r["rows"]) == len(tv) and {"tvr_total", "reach_total", "channel_tvr", "channel_share"} <= set(r["groups"]) and r["plain_has_vault"] is False
    assert V.ingest("tv", r["rows"])["added"] == len(tv)
    d = V.daily({"kind": "tv", "group": "tvr_total"})
    assert np.allclose((d["num"] / d["den"]).to_numpy(), tv.assign(d=pd.to_datetime(tv["Date"])).groupby("d")["TVR"].mean().to_numpy())
