"""Agency rate card database: the workbook importer, the API and how the pitch engine uses the stored rates."""
import datetime as dt
import io
import json
import shutil
import subprocess
import sys
import uuid
from pathlib import Path

import openpyxl
import pytest

from app.services import ratecard

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import make_pitch_sample as mk  # noqa: E402


def t(h, m=0):
    return dt.time(h, m)


def workbook(version="A") -> bytes:
    """Three tabs shaped like the planners' sheet: rack x 27% (a formula), rack typed with a typed negotiated rate, and a 10 sec rate x 3."""
    wb = openpyxl.Workbook()
    s = wb.active
    s.title = "Summary"
    s["B2"] = "Channel"
    d = wb.create_sheet("TV Derana")                      # no date in the title
    d.append(["TV Derana - Rack Rate Card", None, None, None, None, None, None, "Negosiated Rate", "Program CPRP "])
    d.append(["Prime / Non Prime", "Programme", "Rating", "Day/s", "Start", "End", "Rack Rate 30 Sec Contract"])
    for r, (band, name, rating, days, st, en, rack) in enumerate([("PT", "Husmak Lagin", 7.95, "Mon-Fri", t(20, 30), t(21), 910000), ("PT", "Delft", 3.61, "Sat/Sun", t(21), t(22), 466000),
                                                                  ("NPT", "Weekend Movies ", 1.22, "Sat/Sun", t(12, 30), t(15, 30), 190000)], start=3):
        d.append([band, name, rating, days, st, en, rack, f"=G{r}*27%", f"=H{r}/C{r}"])
    d.append([None, None])
    si = wb.create_sheet("Sirasa TV")
    si.append(["Sirasa TV - Rack Rate Card   |   Effective: 2025.sep.1", None, None, None, None, None, None, "Negosiated Rate"])
    si.append(["Prime / Non Prime", "Programme", "Rating", "Day/s", "Start", "End", "Rack Rate 30 Sec"])
    si.append(["PT", "Teledrama One", 5.5, "Mon-Fri", t(21), t(21, 30), 660000, 84000, "=H3/C3"])
    si.append(["NPT", "Sirasa Morning", 0.53, "Mon-Fri", t(7), t(9, 30), 180000, None, None])          # no negotiated rate at all
    h = wb.create_sheet("Hiru Tv")
    h.append(["Hiru Tv - Rack Rate Card   |   Effective: 2026.08.07" if version == "A" else "Hiru Tv - Rack Rate Card   |   Effective: 2026.09.01", None, None, None, None, None, None, None, "Negosiated Rate"])
    h.append(["Prime / Non Prime", "Programme", "Rating", "Day/s", "Start", "End", "Rack Rate 10 Sec", "Rack Rate 30 Sec"])
    h.append(["PT - A", "Hiru Morning", 1.0, "Mon to Sunday", "06:30 am", "08:00 am", 40000 if version == "A" else 50000, "=G3*3", "=H3*28%"])
    h.append(["PT - A", "Hiru News", 3.2, "Saturday & Sunday", "07:30 pm", "09:00 pm", 100000, "=G4*3", "=H4*28%"])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_time_day_and_date_readers():
    assert ratecard.parse_time(t(18, 55)) == 68100 and ratecard.parse_time("06:55 pm") == 68100 and ratecard.parse_time("12:00 nn") == 43200 and ratecard.parse_time("12:00:00 NN") == 43200
    assert ratecard.parse_time("12:30 am") == 1800 and ratecard.parse_time("nonsense") is None
    for text, mask in [("Mon-Fri", "1111100"), ("Sat/Sun", "0000011"), ("Sat - Sun", "0000011"), ("Daily ", "1111111"), ("Mon to Sunday", "1111111"), ("Saturday & Sunday", "0000011"),
                       ("Monday to Thursday", "1111000"), ("Fri - Sat", "0000110"), ("Sunday", "0000001"), ("Sat/ Sun", "0000011"), ("Mon - Sat", "1111110")]:
        assert ratecard.parse_days(text)[1] == mask, text
    assert ratecard.parse_effective("Sirasa TV - Rack Rate Card | Effective: 2025.sep.1") == "2025-09-01"
    assert ratecard.parse_effective("Hiru Tv - Rack Rate Card   |   Effective: 2026.08.07") == "2026-08-07"
    assert ratecard.parse_effective("Siyatha TV | Effective: 2026 july 1st") == "2026-07-01" and ratecard.parse_effective("TV Derana - Rack Rate Card") is None


def test_importer_reads_discounts_special_rates_and_ten_second_rates():
    p = ratecard.parse_workbook(workbook(), "2026-11-01")
    by = {c["channel"]: c for c in p["channels"]}
    assert set(by) == {"DERANA", "SIRASA", "HIRU"}                       # the Summary tab is skipped, channel names are the canonical ones
    d = by["DERANA"]
    assert d["effective"] == "2026-11-01" and not d["dated"] and d["discount_rows"] == 3 and d["special_rows"] == 0
    h = d["rows"][0]
    assert (h["programme"], h["days"], h["day_mask"], h["start_sec"], h["end_sec"], h["rack30"], h["rating"]) == ("Husmak Lagin", "Mon-Fri", "1111100", 73800, 75600, 910000, 7.95)
    assert h["neg_mode"] == "discount" and h["neg_value"] == pytest.approx(73.0) and h["neg_rate"] == pytest.approx(245700)         # rack x 27% = 73% off
    assert d["rows"][2]["programme"] == "Weekend Movies" and d["rows"][2]["day_mask"] == "0000011"
    s = by["SIRASA"]
    assert s["effective"] == "2025-09-01" and s["dated"] and s["special_rows"] == 1
    assert s["rows"][0]["neg_mode"] == "special" and s["rows"][0]["neg_value"] == 84000                                           # a typed number is a special rate
    assert s["rows"][1]["neg_mode"] is None                                                                                      # no negotiated rate: rack only
    hi = by["HIRU"]["rows"][0]
    assert hi["rack10"] == 40000 and hi["rack30"] == 120000 and hi["neg_mode"] == "discount" and hi["neg_value"] == pytest.approx(72.0) and hi["neg_rate"] == pytest.approx(33600)
    assert hi["start_sec"] == 23400 and by["HIRU"]["rows"][1]["start_sec"] == 70200 and by["HIRU"]["rows"][1]["day_mask"] == "0000011"
    with pytest.raises(ratecard.RateCardError):
        ratecard.parse_workbook(b"not a workbook")
    wb = openpyxl.Workbook()
    wb.active.append(["nothing useful"])
    buf = io.BytesIO()
    wb.save(buf)
    with pytest.raises(ratecard.RateCardError):
        ratecard.parse_workbook(buf.getvalue())


@pytest.fixture()
def admin():
    from helpers import login
    return login()


def post(c, content, **q):
    return c.post("/api/ratecards/import", params=q, content=content, headers={"Content-Type": "application/octet-stream"})


def test_api_import_versions_permissions(admin):
    from helpers import login
    ch = f"TESTCH{uuid.uuid4().hex[:5]}".upper()
    r = post(admin, workbook("A"), filename="rates.xlsx", effective="2026-11-01")
    assert r.status_code == 200 and r.json()["rows"] == 3 + 2 + 2 and {x["channel"] for x in r.json()["imported"]} == {"DERANA", "SIRASA", "HIRU"}
    cur = admin.get("/api/ratecards/current").json()
    hiru = [e for e in cur["entries"] if e["channel"] == "HIRU"]
    assert {c["channel"]: c["effective_from"] for c in cur["channels"]}["HIRU"] == "2026-08-07" and len(hiru) == 2 and hiru[0]["rack30"] == 120000
    # the same date replaces, a newer date adds a version and becomes the one in use, the older one stays
    assert post(admin, workbook("A"), filename="again.xlsx", effective="2026-11-01").status_code == 200
    assert len([e for e in admin.get("/api/ratecards/current").json()["entries"] if e["channel"] == "HIRU"]) == 2
    assert post(admin, workbook("B"), filename="new.xlsx", effective="2026-11-01").status_code == 200
    cur = admin.get("/api/ratecards/current").json()
    assert {c["channel"]: c["effective_from"] for c in cur["channels"]}["HIRU"] == "2026-09-01" and [e["rack30"] for e in cur["entries"] if e["channel"] == "HIRU"][0] == 150000
    assert [e["rack30"] for e in admin.get("/api/ratecards/current", params={"as_of": "2026-08-31"}).json()["entries"] if e["channel"] == "HIRU"][0] == 120000
    sm = {c["channel"]: c for c in admin.get("/api/ratecards/summary").json()["channels"]}
    assert [v["effective_from"] for v in sm["HIRU"]["versions"]] == ["2026-09-01", "2026-08-07"] and sm["HIRU"]["latest"] == "2026-09-01"
    # only admins change it, any signed-in user reads it
    email = f"p{uuid.uuid4().hex[:6]}@agency.lk"
    admin.post("/api/users", json={"email": email, "password": "planner-pass-1"})
    planner = login(email, "planner-pass-1")
    assert planner.get("/api/ratecards/current").status_code == 200 and planner.get("/api/ratecards/summary").status_code == 200
    assert post(planner, workbook("A")).status_code == 403 and planner.delete("/api/ratecards", params={"channel": "HIRU", "effective_from": "2026-09-01"}).status_code == 403
    assert post(admin, b"nope" * 50).status_code == 422 and post(admin, workbook("A"), effective="not-a-date").status_code == 422
    assert admin.delete("/api/ratecards", params={"channel": "HIRU", "effective_from": "2026-09-01"}).json() == {"deleted": 2}
    assert admin.delete("/api/ratecards", params={"channel": "HIRU", "effective_from": "2026-09-01"}).status_code == 404
    assert {c["channel"]: c["effective_from"] for c in admin.get("/api/ratecards/current").json()["channels"]}["HIRU"] == "2026-08-07"        # the older version is back in use
    del ch


pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")


def run(tmp, opts):
    args = ["node", str(ROOT / "tests/js/pitch.js"), str(tmp / "lm.csv"), str(tmp / "tv.csv"), json.dumps(opts)]
    out = subprocess.run(args, capture_output=True, text=True, timeout=240)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def test_pitch_engine_uses_the_stored_rates(admin, tmp_path):
    lm, tv, _ = mk.build()
    lm.to_csv(tmp_path / "lm.csv", index=False)
    tv.to_csv(tmp_path / "tv.csv", index=False)
    assert post(admin, workbook("A"), filename="rates.xlsx", effective="2026-11-01").status_code == 200
    entries = admin.get("/api/ratecards/current").json()["entries"]
    base = {"ratecard": entries}
    r = run(tmp_path, base)
    rows = {(x["channel"], x["program"]): x for x in r["rates"]}
    h = rows[("DERANA", "HUSMAK LAGIN")]                                    # matched by channel + weekday + start time, rate card names differ in case only
    assert h["card_src"] == "rate card" and h["card30"] == 910000 and h["neg30"] == pytest.approx(245700) and h["saving_pct"] == pytest.approx(73.0) and h["card_prog"] == "Husmak Lagin"
    mv = rows[("DERANA", "WEEKEND MOVIE")]                                  # a different name in the same Sat/Sun 12:30 belt: matched by the time slot
    assert mv["card_src"] == "rate card" and mv["card30"] == 190000 and mv["neg30"] == pytest.approx(51300) and mv["card_prog"] == "Weekend Movies"
    t1 = rows[("SIRASA", "TELEDRAMA ONE")]
    assert t1["card30"] == 660000 and t1["neg30"] == 84000 and t1["rule_mode"] == "special"                  # a typed negotiated rate is a special rate
    assert rows[("SIRASA", "MORNING SHOW")]["card30"] == 180000 and rows[("SIRASA", "MORNING SHOW")]["neg30"] == 180000        # Sirasa Morning 07:00 Mon-Fri: rack only, no negotiation
    hm = rows[("HIRU", "HIRU MORNING")]
    assert hm["card30"] == 120000 and hm["neg30"] == pytest.approx(33600)                                  # the 10 sec rate x 3, then 28% of it
    assert rows[("HIRU", "HIRU MOVIE")]["card_src"] is None and rows[("HIRU", "HIRU MOVIE")]["card30"] is None         # nothing in the card for it
    # what you type beats the card; a channel rule beats the card's negotiated rate; switching the card's negotiation off falls back to the default rule
    typed = run(tmp_path, {**base, "rates": {"programmes": {"DERANA|HUSMAK LAGIN": {"rate": 1000000, "secs": 30}}}})
    th = {(x["channel"], x["program"]): x for x in typed["rates"]}[("DERANA", "HUSMAK LAGIN")]
    assert th["card_src"] == "typed" and th["card30"] == 1000000 and th["neg30"] == pytest.approx(270000)
    chan = run(tmp_path, {**base, "nego": {"channels": {"DERANA": {"mode": "discount", "value": 50}}}})
    assert {(x["channel"], x["program"]): x for x in chan["rates"]}[("DERANA", "HUSMAK LAGIN")]["neg30"] == pytest.approx(455000)
    off = run(tmp_path, {**base, "use_card_nego": False, "nego": {"default": {"mode": "discount", "value": 40}}})
    ro = {(x["channel"], x["program"]): x for x in off["rates"]}
    assert ro[("DERANA", "HUSMAK LAGIN")]["neg30"] == pytest.approx(546000) and ro[("SIRASA", "TELEDRAMA ONE")]["neg30"] == pytest.approx(396000)
    # the evaluation and the plan read the same rates
    cur = {(x["channel"], x["program"]): x for x in r["current"]["rows"]}
    assert cur[("DERANA", "HUSMAK LAGIN")]["card30"] == 910000 and cur[("DERANA", "HUSMAK LAGIN")]["value"] == pytest.approx(910000 * cur[("DERANA", "HUSMAK LAGIN")]["eq30"])
    assert any(c["program"] == "HUSMAK LAGIN" and c["neg30"] == pytest.approx(245700) for c in r["candidates"])
