import pandas as pd
import pytest

from app.services import normalise as nz


@pytest.mark.parametrize("raw,expected", [
    ("Tv - Derana", "DERANA"), ("DERANA", "DERANA"), ("  derana  tv ", "DERANA"), ("SIYATHA TV", "SIYATHA"),
    ("Tv - Sirasa", "SIRASA"), ("TV 1", "TV 1"), ("Tv-Hiru", "HIRU"), ("SHAKTHI TV", "SHAKTHI"), ("Shakti", "SHAKTHI")])
def test_channel_names(raw, expected):
    assert nz.normalise_channel(raw) == (expected, True)


def test_unknown_and_empty():
    assert nz.normalise_channel("Brand New Channel") == ("BRAND NEW CHANNEL", False)
    assert nz.normalise_channel(None)[0] == "UNKNOWN" and nz.normalise_channel("  ")[0] == "UNKNOWN"


def test_both_sheets_join_on_same_name():
    assert nz.normalise_channel("Tv - Shakthi")[0] == nz.normalise_channel("SHAKTHI TV")[0]


@pytest.mark.parametrize("hour,expected", [(5, "Early Morning"), (8.99, "Early Morning"), (9, "Morning"), (12, "Afternoon"), (17, "Early Prime"),
                                           (20, "Prime"), (22.9, "Prime"), (23, "Late Night"), (0, "Late Night"), (4.9, "Late Night")])
def test_dayparts(hour, expected):
    assert nz.daypart_for_hour(hour) == expected


def test_daypart_config_is_editable(tmp_path, monkeypatch):
    import json, shutil
    shutil.copytree(nz.CONFIG_DIR, tmp_path / "cfg")
    cfg = json.loads((tmp_path / "cfg" / "dayparts.json").read_text())
    cfg["dayparts"] = [{"name": "All Day", "start": 0, "end": 24}]
    (tmp_path / "cfg" / "dayparts.json").write_text(json.dumps(cfg))
    monkeypatch.setattr(nz, "CONFIG_DIR", tmp_path / "cfg")
    nz._cache.clear()
    assert nz.daypart_for_hour(13) == "All Day"
    nz._cache.clear()


def test_duration_bands():
    s = nz.duration_band(pd.Series([5, 10, 15, 30, 45, 60, 90, None]))
    assert s.tolist()[:7] == ["<=10s", "<=10s", "11-20s", "21-30s", "31-45s", "46-60s", ">60s"] and pd.isna(s.iloc[7])
