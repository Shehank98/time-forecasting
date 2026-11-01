import io

import openpyxl
import pytest
from fastapi.testclient import TestClient

from helpers import api, login, new_client, up as up_helper

import synth
from app.main import app
from app.services import normalise as nz

EVIL = "=HYPERLINK(\"http://evil.example\",\"x\")"


def evil_lmrb():
    df = synth.make_lmrb(days=10)
    df.loc[df.index[:5], "Advertiser"] = EVIL
    df.loc[df.index[5:8], "Advt_Theme"] = "@SUM(1+1)"
    return df


def test_excel_report_never_stores_uploaded_text_as_a_formula():
    from app.services import analytics_lmrb, ingest
    from app.services.util import jsonable
    df = ingest.parse(synth.to_csv_bytes(evil_lmrb()), "e.csv", "lmrb").df
    c = api()
    r = c.post("/api/export", json={"kind": "lmrb", "format": "xlsx", "dash": jsonable(analytics_lmrb.dashboard(df, None, None, None)), "files": [EVIL]})
    wb = openpyxl.load_workbook(io.BytesIO(r.content))
    seen = 0
    for ws in wb.worksheets:
        for row in ws.iter_rows():
            for cell in row:
                if isinstance(cell.value, str) and cell.value.startswith("="):
                    seen += 1
                    assert cell.data_type != "f", f"formula injected on {ws.title}!{cell.coordinate}"
    assert seen > 0   # the hostile text really was carried through as plain text


@pytest.fixture()
def cfg_dir(tmp_path, monkeypatch):
    import shutil
    shutil.copytree(nz.CONFIG_DIR, tmp_path / "cfg")
    monkeypatch.setattr(nz, "CONFIG_DIR", tmp_path / "cfg")
    nz._cache.clear()
    yield tmp_path / "cfg"
    nz._cache.clear()


@pytest.mark.parametrize("name,body", [
    ("channel_aliases", {"DERANA": "not a list"}), ("holidays", {"events": [{"date": "garbage", "name": "x"}]}),
    ("dayparts", {"dayparts": [{"name": "A", "start": 5, "end": 99}]}), ("dayparts", {"dayparts": []})])
def test_bad_config_is_rejected_and_file_untouched(cfg_dir, name, body):
    c = api()
    before = {p.name: p.read_text() for p in cfg_dir.iterdir()}
    r = c.put(f"/api/config/{name}", json=body)
    assert r.status_code == 422 and "Invalid config" in r.json()["detail"]
    assert before == {p.name: p.read_text() for p in cfg_dir.iterdir()}


def test_unhandled_errors_do_not_leak_details(monkeypatch):
    from app.routers import forecasting
    monkeypatch.setattr(forecasting.repo, "list_forecasts", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("secret internals")))
    c = api(raise_server_exceptions=False)
    r = c.get("/api/workspace/summary")
    assert r.status_code == 500 and "secret internals" not in r.text
