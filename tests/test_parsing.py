import datetime as dt
from pathlib import Path

import pandas as pd
import pytest

import synth
from app.services import ingest

FIX = Path(__file__).parent / "fixtures"


def parse(name, kind):
    return ingest.parse((FIX / name).read_bytes(), name, kind)


def test_tv_sample_parses():
    r = parse("tv_sample.csv", "tv")
    assert r.report["rows_kept"] == 5
    assert r.df["date"].min() == pd.Timestamp("2026-09-09")
    assert set(r.df["channel"]) == {"SHAKTHI", "SIYATHA", "SIRASA"}
    row = r.df[r.df["program"] == "NAMAYAI DAHAYA"].iloc[0]
    assert row["daypart"] == "Prime" and row["day"] == "Wed" and row["duration"] == 60


def test_lmrb_sample_parses_and_derives():
    r = parse("lmrb_sample.csv", "lmrb")
    assert r.report["rows_kept"] == 4 and r.report["dropped"]["blank_rows"] == 1
    df = r.df
    assert set(df["channel"]) == {"DERANA"}
    assert df["date"].nunique() == 1 and df["date"].iloc[0] == pd.Timestamp("2026-09-08")
    first = df.iloc[0]
    assert first["cps"] == pytest.approx(5766.6)
    assert first["daypart"] == "Morning" and first["position"] == "middle"
    last = df.iloc[3]  # PosinBrk 23 of 23
    assert bool(last["is_last"]) and last["daypart"] == "Afternoon"
    assert first["creative_id"].startswith("Nestle Lanka Ltd | Maggi Rasa Musu | Hemadamath")


def test_headers_case_and_whitespace_insensitive():
    csv = b"  CHANNEL ,date,PROGRAM, tvr ,Reach %\nTv - Derana,2026-09-01,News,2.5,3.1\n"
    r = ingest.parse(csv, "x.csv", "tv")
    assert r.report["rows_kept"] == 1 and "Optional columns not found" in " ".join(r.report["warnings"])
    assert r.df["channel"].iloc[0] == "DERANA" and r.df["reach_pct"].iloc[0] == pytest.approx(3.1)


def test_numeric_strings_with_commas_and_bad_rows_reported():
    csv = (b"Channel,Date,Program,TVR,Reach\nDerana,2026/09/01,A,\"1,234.5\",\"105,000\"\n"
           b"Derana,not a date,B,1,1\nDerana,2026/09/02,C,abc,1\n")
    r = ingest.parse(csv, "x.csv", "tv")
    assert r.report["rows_kept"] == 1
    assert r.df["tvr"].iloc[0] == pytest.approx(1234.5) and r.df["reach"].iloc[0] == 105000
    assert r.report["dropped"]["bad_date"] == 1 and r.report["dropped"]["missing_required"] == 1
    assert r.report["unparseable_values"]["tvr"] == 1


def test_mixed_date_formats():
    csv = b"Channel,Date,Program,TVR\nA,2026/09/01,X,1\nA,2026-09-02,Y,1\nA,03/09/2026,Z,1\nA,04.09.2026,W,1\n"
    r = ingest.parse(csv, "x.csv", "tv")
    assert sorted(r.df["date"].dt.day.tolist()) == [1, 2, 3, 4]


def test_duplicates_dropped_and_counted():
    row = "Derana,2026/09/01,News,2.5,20:00\n"
    r = ingest.parse(("Channel,Date,Program,TVR,Start\n" + row * 3).encode(), "x.csv", "tv")
    assert r.report["rows_kept"] == 1 and r.report["dropped"]["duplicates"] == 2


def test_title_rows_above_header_are_skipped():
    csv = b"Monthly report,,,\n,,,\nChannel,Date,Program,TVR\nDerana,2026/09/01,News,2\n"
    assert ingest.parse(csv, "x.csv", "tv").report["rows_kept"] == 1


def test_missing_required_columns_raise_friendly_error():
    with pytest.raises(ingest.IngestError, match="Missing required columns"):
        ingest.parse(b"Channel,Date,TVR\nA,2026/09/01,1\n", "x.csv", "tv")


def test_unsupported_and_empty_files():
    with pytest.raises(ingest.IngestError):
        ingest.parse(b"abc", "x.pdf", "tv")
    with pytest.raises(ingest.IngestError):
        ingest.parse(b"", "x.csv", "tv")


def test_xlsx_roundtrip_with_excel_time_objects():
    df = synth.make_lmrb(days=3)
    df["Advt_time"] = [dt.time(int(t[:2]), int(t[3:5]), int(t[6:8])) for t in df["Advt_time"]]
    r = ingest.parse(synth.to_xlsx_bytes(df), "x.xlsx", "lmrb")
    assert r.report["rows_kept"] > 0 and (r.df["daypart"] != "Unknown").all()


def test_merge_appends_and_dedupes():
    b = ingest.parse(synth.to_csv_bytes(synth.make_lmrb(days=20)), "b.csv", "lmrb").df
    a = b[b["date"] < b["date"].min() + pd.Timedelta(days=10)]
    merged, added, skipped = ingest.merge(a, b, "lmrb")
    assert len(merged) == len(b) and skipped == len(a) and added == len(b) - len(a)


def test_unknown_channel_is_reported_not_fatal():
    r = ingest.parse(b"Channel,Date,Program,TVR\nMystery Box,2026/09/01,X,1\n", "x.csv", "tv")
    assert r.df["channel"].iloc[0] == "MYSTERY BOX" and r.report["unmatched_channels"] == ["Mystery Box"]
