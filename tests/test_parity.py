"""The browser engine (app/static/js/engine) must produce the same numbers as the Python reference analytics."""
import json
import math
import shutil
import subprocess
from pathlib import Path

import pytest

import synth
from app.services import analytics_tv, filters as flt, ingest
from app.services.util import jsonable

ROOT = Path(__file__).resolve().parent.parent
pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")


def run_js(kind, path, other=None, opts=None):
    args = ["node", str(ROOT / "tests/js/dash.js"), kind, str(path)] + ([str(other)] if other else [""]) + [json.dumps(opts or {})]
    out = subprocess.run(args, capture_output=True, text=True, timeout=180)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def _num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def _key(x):
    """Sort key for records: values rounded to 4 significant digits so tiny float noise cannot reorder them."""
    def r(v):
        if _num(v):
            return None if (isinstance(v, float) and (math.isnan(v) or math.isinf(v))) else float(f"{float(v):.4g}")
        if isinstance(v, dict):
            return {k: r(w) for k, w in v.items()}
        if isinstance(v, list):
            return [r(w) for w in v]
        return v
    return json.dumps(r(x), sort_keys=True, default=str)


def norm(x):
    """Make lists of records order-insensitive (ties may be ordered differently)."""
    if isinstance(x, float) and (math.isnan(x) or math.isinf(x)):
        return None
    if isinstance(x, dict):
        return {k: norm(v) for k, v in x.items()}
    if isinstance(x, list):
        n = [norm(v) for v in x]
        return sorted(n, key=_key) if n and all(isinstance(v, dict) for v in n) else n
    return x


def close(a, b, path):
    if _num(a) and _num(b):
        if not math.isclose(float(a), float(b), rel_tol=1e-6, abs_tol=1.5e-6):
            raise AssertionError(f"{path}: python={a} js={b}")
        return
    if isinstance(a, dict) and isinstance(b, dict):
        if set(a) != set(b):
            raise AssertionError(f"{path}: keys differ python-only={set(a) - set(b)} js-only={set(b) - set(a)}")
        for k in a:
            close(a[k], b[k], f"{path}.{k}")
        return
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            raise AssertionError(f"{path}: length python={len(a)} js={len(b)}; python={json.dumps(a)[:400]} js={json.dumps(b)[:400]}")
        for i, (x, y) in enumerate(zip(a, b)):
            close(x, y, f"{path}[{i}]")
        return
    if a != b:
        raise AssertionError(f"{path}: python={json.dumps(a, default=str)[:400]} js={json.dumps(b, default=str)[:400]}")


def same(py, js, path=""):
    close(norm(jsonable(py)), norm(js), path or "root")


@pytest.fixture(scope="module")
def files(tmp_path_factory):
    d = tmp_path_factory.mktemp("parity")
    (d / "tv.csv").write_bytes(synth.to_csv_bytes(synth.make_tv()))
    (d / "lmrb.csv").write_bytes(synth.to_csv_bytes(synth.make_lmrb()))
    return d


@pytest.mark.parametrize("fixture,kind", [("tv_sample.csv", "tv"), ("lmrb_sample.csv", "lmrb")])
def test_ingest_reports_match_on_real_samples(fixture, kind):
    p = ROOT / "tests/fixtures" / fixture
    js = run_js(kind, p)
    py = ingest.parse(p.read_bytes(), fixture, kind).report
    py.pop("header_row", None)
    same(py, js["report"])


def test_tv_dashboard_matches(files):
    js = run_js("tv", files / "tv.csv", files / "lmrb.csv")
    tv = ingest.parse((files / "tv.csv").read_bytes(), "tv.csv", "tv").df
    lm = ingest.parse((files / "lmrb.csv").read_bytes(), "lmrb.csv", "lmrb").df
    same(analytics_tv.dashboard(tv, lm), js["dash"])
    py_rep = ingest.parse((files / "tv.csv").read_bytes(), "tv.csv", "tv").report
    py_rep.pop("header_row", None)
    same(py_rep, js["report"])


def test_tv_filters_and_options_match(files):
    f = {"program_search": "news", "tvr_min": 3, "daypart": ["Prime"], "date_from": "2026-08-10"}
    js = run_js("tv", files / "tv.csv", None, {"filters": f})
    tv = ingest.parse((files / "tv.csv").read_bytes(), "tv.csv", "tv").df
    same(analytics_tv.dashboard(flt.apply_filters(tv, "tv", f), None), js["dash"])
    same(flt.describe_filters("tv", f), js["chips"])
    py_opts = flt.filter_options(tv, "tv")
    for k in ("date_min", "date_max", "channel", "category", "day", "daypart"):
        same(py_opts[k], js["options"][k], k)


def _bounds(f):
    import pandas as pd
    return (pd.Timestamp(f["date_from"]) if f.get("date_from") else None, pd.Timestamp(f["date_to"]) if f.get("date_to") else None)


def _lmrb(files, with_tv=False, data_set=None):
    from app.services import joins
    lm = ingest.parse((files / "lmrb.csv").read_bytes(), "lmrb.csv", "lmrb").df
    if not with_tv:
        return lm, None
    tv = ingest.parse((files / "tv.csv").read_bytes(), "tv.csv", "tv").df
    return joins.match_spots(lm, tv, data_set)


@pytest.mark.parametrize("opts", [
    {},
    {"my_brand": "Nestle Lanka Ltd"},
    {"my_brand": "Nestle Lanka Ltd", "filters": {"date_from": "2026-08-20", "channel": ["DERANA", "SIRASA"]}},
    {"my_brand": "Nestle Lanka Ltd", "competitors": ["Unilever Sri Lanka"], "filters": {"daypart": ["Prime"]}},
])
def test_lmrb_dashboard_matches(files, opts):
    from app.services import analytics_lmrb
    js = run_js("lmrb", files / "lmrb.csv", None, opts)
    lm, _ = _lmrb(files)
    f = opts.get("filters", {})
    s, e = _bounds(f)
    py = analytics_lmrb.dashboard(flt.apply_filters(lm, "lmrb", f, skip_date=True), s, e, opts.get("my_brand"), opts.get("competitors"))
    same(py, js["dash"])


def test_lmrb_grp_join_matches(files):
    from app.services import analytics_lmrb
    opts = {"my_brand": "Nestle Lanka Ltd"}
    js = run_js("lmrb", files / "lmrb.csv", files / "tv.csv", opts)
    lm, stats = _lmrb(files, with_tv=True)
    py = analytics_lmrb.dashboard(lm, None, None, "Nestle Lanka Ltd", None)
    assert py["grp"] and py["grp"]["matched_spots"] > 0
    same(py, js["dash"])


def test_lmrb_head_to_head_and_options_match(files):
    from app.services import analytics_lmrb
    lm, _ = _lmrb(files)
    order = lm.groupby("advertiser")["cost"].sum().sort_values(ascending=False).index.tolist()
    f = {"date_from": "2026-08-05"}
    js = run_js("lmrb", files / "lmrb.csv", None, {"filters": f, "h2h": order[:2]})
    s, e = _bounds(f)
    same(analytics_lmrb.head_to_head(flt.apply_filters(lm, "lmrb", f, skip_date=True), s, e, order[0], order[1]), js["dash"])
    same(flt.describe_filters("lmrb", f), js["chips"])
    py_opts = flt.filter_options(lm, "lmrb")
    for k in ("date_min", "date_max", "advertiser", "product_group", "channel", "daypart", "duration_band", "language", "advertiser_groups"):
        same(py_opts[k], js["options"][k], k)


SERIES_CASES = [
    ("lmrb", {"entity_type": "advertiser", "metric": "spend", "gran": "daily"}),
    ("lmrb", {"entity_type": "advertiser", "metric": "spend", "gran": "weekly"}),
    ("lmrb", {"entity_type": "channel", "metric": "sov", "gran": "weekly"}),
    ("lmrb", {"entity_type": "daypart", "metric": "cps", "gran": "daily", "filters": {"advertiser": ["Nestle Lanka Ltd"]}}),
    ("lmrb", {"entity_type": "total", "metric": "spots", "gran": "monthly"}),
    ("lmrb", {"entity_type": "advertiser", "metric": "spend", "gran": "daily", "history_days": 20}),
    ("lmrb", {"entity_type": "advertiser", "metric": "cprp", "gran": "weekly", "tv": True}),
    ("lmrb", {"entity_type": "channel", "metric": "grp", "gran": "daily", "tv": True}),
    ("tv", {"entity_type": "channel", "metric": "tvr", "gran": "daily"}),
    ("tv", {"entity_type": "category", "metric": "share", "gran": "weekly"}),
    ("tv", {"entity_type": "timebelt", "metric": "tvr", "gran": "daily"}),
    ("tv", {"entity_type": "program", "metric": "tvr", "gran": "daily", "max_entities": 5}),
    ("tv", {"entity_type": "total", "metric": "reach", "gran": "daily", "filters": {"daypart": ["Prime"]}}),
]


@pytest.mark.parametrize("kind,o", SERIES_CASES)
def test_series_match(files, kind, o):
    from app.services import joins, series as S
    o = dict(o)
    if o.pop("tv", False):
        o["tv"] = str(files / "tv.csv")
    path = files / f"{kind}.csv"
    args = ["node", str(ROOT / "tests/js/series.js"), kind, str(path), json.dumps(o)]
    out = subprocess.run(args, capture_output=True, text=True, timeout=180)
    assert out.returncode == 0, out.stderr
    js = json.loads(out.stdout)
    df = ingest.parse(path.read_bytes(), path.name, kind).df
    if o.get("tv"):
        tv = ingest.parse((files / "tv.csv").read_bytes(), "tv.csv", "tv").df
        df, _ = joins.match_spots(df, tv, None)
    df = flt.apply_filters(df, kind, o.get("filters", {}))
    specs, notes = S.build_series(df, kind, o["entity_type"], o["metric"], o["gran"], max_entities=o.get("max_entities", 8), history_days=o.get("history_days"))
    assert notes == js["notes"]
    py = [{"entity": s.entity, "dates": [str(d.date()) for d in s.dates], "values": list(s.values), "n_active": s.n_active, "n_observed": s.n_observed} for s in specs]
    got = [{k: s[k] for k in ("entity", "dates", "values", "n_active", "n_observed")} for s in js["series"]]
    close(jsonable(py), got, "series")
    close(jsonable(S.rank_entities(df, kind, o["entity_type"], 60, None, o["metric"])), js["ranked"], "ranked")


def run_kpi(path, opts=None):
    out = subprocess.run(["node", str(ROOT / "tests/js/kpi.js"), str(path), json.dumps(opts or {})], capture_output=True, text=True, timeout=180)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


@pytest.mark.parametrize("opts", [{}, {"filters": {"date_from": "2026-03-01", "date_to": "2026-05-31"}}, {"filters": {"segment": ["TV burst"]}},
                                  {"series": {"entity_type": "segment", "metric": "leads", "gran": "weekly"}},
                                  {"series": {"entity_type": "total", "metric": "cpl", "gran": "daily"}}])
def test_kpi_matches(tmp_path, opts):
    from app.services import analytics_kpi, ingest_kpi, series as S
    p = tmp_path / "kpi.csv"
    p.write_bytes(synth.to_csv_bytes(synth.make_kpi()))
    js = run_kpi(p, opts)
    prop = ingest_kpi.propose(p.read_bytes(), "kpi.csv")
    for k in ("rows", "header_row", "columns", "suggested"):
        same(prop[k], js["proposal"][k], k)
    sg = prop["suggested"]
    df, report, meta = ingest_kpi.apply(prop["token"], {"date_column": sg["date_column"], "segment_column": sg["segment_column"], "metrics": sg["metrics"], "ratios": sg["ratios"]})
    same(report, js["report"], "report")
    same(meta, js["meta"], "meta")
    f = opts.get("filters", {})
    s, e = _bounds(f)
    same(analytics_kpi.dashboard(flt.apply_filters(df, "kpi", f), meta, flt.apply_filters(df, "kpi", f, skip_date=True), s, e), js["dash"], "dash")
    if opts.get("series"):
        o = opts["series"]
        specs, notes = S.build_series(flt.apply_filters(df, "kpi", f), "kpi", o["entity_type"], o["metric"], o["gran"], meta=meta)
        assert notes == js["series"]["notes"]
        close(jsonable([{"entity": x.entity, "values": list(x.values), "dates": [str(d.date()) for d in x.dates]} for x in specs]),
              [{k: x[k] for k in ("entity", "values", "dates")} for x in js["series"]["series"]], "series")


def test_kpi_monthly_and_merge(tmp_path):
    from app.services import ingest_kpi
    a = tmp_path / "a.csv"; a.write_text("Month,Region,Sales\n2025-01-01,North,10\n2025-02-01,North,12\n2025-03-01,North,9\n2025-04-01,North,15\n2025-01-01,South,5\n")
    b = tmp_path / "b.csv"; b.write_text("Month,Region,Sales\n2025-04-01,North,16\n2025-05-01,North,11\n")
    m = {"date_column": "Month", "segment_column": "Region", "metrics": [{"column": "Sales", "key": "sales", "label": "Sales", "unit": "number", "agg": "sum", "role": "kpi"}], "ratios": []}
    js = run_kpi(a, {"mapping": m, "append": str(b)})
    pa = ingest_kpi.propose(a.read_bytes(), "a.csv"); pb = ingest_kpi.propose(b.read_bytes(), "b.csv")
    da, _, meta = ingest_kpi.apply(pa["token"], json.loads(json.dumps(m))); db, _, _ = ingest_kpi.apply(pb["token"], json.loads(json.dumps(m)))
    merged, added, replaced = ingest_kpi.merge(da, db)
    assert js["n"] == len(merged) and js["meta"]["granularity"] == "monthly"  # recomputed on the merged data
    assert js["report"]["rows_added"] == added and js["report"]["rows_skipped_as_duplicates"] == replaced
