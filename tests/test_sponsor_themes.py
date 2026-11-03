"""The sponsorship items (-BB, Com Break, DJ, -Extro, -Intro, -LLogo, Next Card, Tag, Time Check, -Tr): one rule in Python and in the browser,
tolerant of the "(10)(Sin)" tags, spaces around dashes and letter case, and strict enough to leave look-alike commercials alone."""
import json
import shutil
import subprocess
from pathlib import Path

import pandas as pd
import pytest

import synth
from app.services.analytics_lmrb import is_sponsor_theme, sponsor_key

ROOT = Path(__file__).resolve().parent.parent
needs_node = pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")

# (theme as it may appear in the sheet, expected sponsorship item or None for a commercial)
CASES = [
    ("-BB", "-bb"), ("Teledrama -BB", "-bb"), ("Teledrama-BB", "-bb"), ("Teledrama - BB", "-bb"), ("Teledrama -BB (5)(Sin)", "-bb"), ("TELEDRAMA -bb", "-bb"),
    ("Com Break", "com break"), ("COM BREAK", "com break"), ("Com  Break", "com break"), ("Com Break (10)", "com break"),
    ("DJ", "dj"), ("dj (Sin)", "dj"),
    ("Dream Star -Extro", "-extro"), ("Dream Star - Extro (10)(Sin)", "-extro"),
    ("Dream Star -Intro", "-intro"), ("Dream Star -Intro (10)(Sin)", "-intro"),
    ("Dream Star -LLogo", "-llogo"), ("Dream Star - LLogo", "-llogo"), ("-LLogo (5)", "-llogo"),
    ("Next Card", "next card"), ("Next Card (5)", "next card"), ("next  card", "next card"),
    ("Tag", "tag"), ("Tag (5)(Sin)", "tag"), (" tag ", "tag"),
    ("Time Check", "time check"), ("Time check", "time check"), ("Time Check (10)(Sin)", "time check"),
    ("News -Tr", "-tr"), ("News -Tr (5)", "-tr"),
    # the item written after or before the programme name
    ("Lakshapathi Next Card", "next card"), ("Lakshapathi - Next Card (5)(Sin)", "next card"), ("Next Card_Lakshapathi", "next card"), ("Lakshapathi Intro", "-intro"),
    ("Lakshapathi_Intro (10)(Sin)", "-intro"), ("Lakshapathi BB", "-bb"), ("Lakshapathi_LLogo", "-llogo"), ("Lakshapathi Tag", "tag"), ("Lakshapathi Time Check", "time check"),
    ("Com Break Sirasa", "com break"), ("Lakshapathi_Extro", "-extro"),
    # commercials that only look similar
    ("Island Tea Reminder (30)", None), ("Tag Line Promo (30)", None), ("Christmas Tree (30)", None), ("Dj Party Offer (30)", None),
    ("Hemadamath Rasawath_Pumpkin Curry (10)(Sin)", None), ("Extra Value (20)", None), ("Introduction Offer (30)", None), ("Time Checker App (30)", None), ("Next Cardigan Sale (30)", None), ("Tagline Offer (30)", None), ("", None), (None, None),
]
LABEL = {"-bb": "-BB", "com break": "Com Break", "dj": "DJ", "-extro": "-Extro", "-intro": "-Intro", "-llogo": "-LLogo", "next card": "Next Card", "tag": "Tag", "time check": "Time Check", "-tr": "-Tr"}


@pytest.mark.parametrize("theme,key", CASES)
def test_python_rule(theme, key):
    assert sponsor_key(theme) == key and is_sponsor_theme(theme) == (key is not None)


@needs_node
def test_browser_rule_matches_python():
    themes = [t for t, _ in CASES if t is not None]
    out = subprocess.run(["node", str(ROOT / "tests/js/themes.js"), json.dumps(themes)], capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    got = {r["theme"]: r for r in json.loads(out.stdout)}
    for t, key in CASES:
        if t is None:
            continue
        r = got[t]
        assert r["key"] == key and r["sponsor"] == (key is not None) == is_sponsor_theme(t), t
        if key:
            assert r["item"] == LABEL[key], t                       # shown with the names used in the sheet


@needs_node
def test_all_ten_count_as_value_add_in_reports(tmp_path):
    """A sheet using all ten items, with "(10)(Sin)" tags and odd spacing, puts every one of them in value-add (sponsorship) spend."""
    lm = synth.make_lmrb(days=30, start="2026-06-01", seed=3)
    base = lm[lm["Channel"] == "Tv - Derana"].head(10)
    names = ["Dream Star -BB (5)(Sin)", "Com Break", "DJ (Sin)", "Dream Star - Extro", "Dream Star -Intro (10)(Sin)", "Dream Star -LLogo", "Next Card (5)", "Tag (5)(Sin)", "Time Check (10)(Sin)", "News -Tr"]
    parts = [lm] + [base.assign(Advertiser="Lanka Tea Co", Advt_Theme=n, Cost=11000 + 37 * k, AdPos=700 + k) for k, n in enumerate(names)]
    p = tmp_path / "ten.csv"
    df = pd.concat(parts, ignore_index=True)
    df.to_csv(p, index=False)
    out = subprocess.run(["node", str(ROOT / "tests/js/spotlight.js"), "exec", str(p), json.dumps({"advertisers": ["Lanka Tea Co"]})], capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr
    d = json.loads(out.stdout)
    lt = df[df["Advertiser"] == "Lanka Tea Co"]
    sp = lt[lt["Advt_Theme"].map(is_sponsor_theme)]
    assert set(names) <= set(sp["Advt_Theme"])                     # Python counts all ten
    assert d["overall"]["value_add_items"] == len(sp) and d["overall"]["value_add_spend"] == pytest.approx(sp["Cost"].sum())
    items = {r["theme"]: r["item"] for r in d["classified"] if r["advertiser"] == "Lanka Tea Co" and r["sponsorship"]}
    assert {n: items.get(n) for n in names} == dict(zip(names, ["-BB", "Com Break", "DJ", "-Extro", "-Intro", "-LLogo", "Next Card", "Tag", "Time Check", "-Tr"]))
