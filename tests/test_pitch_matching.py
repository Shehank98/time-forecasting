"""Client Pitch Evaluator: aggressive programme matching. Hard cases are made from the sample data by changing names and times."""
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import make_pitch_sample as mk  # noqa: E402

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")


def node(args):
    out = subprocess.run(["node"] + args, capture_output=True, text=True, timeout=240)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def run(tmp, lm, tv, opts=None):
    lm.to_csv(tmp / "lm.csv", index=False)
    tv.to_csv(tmp / "tv.csv", index=False)
    return node([str(ROOT / "tests/js/pitch.js"), str(tmp / "lm.csv"), str(tmp / "tv.csv"), json.dumps(opts or {})])


@pytest.fixture(scope="module")
def base():
    lm, tv, _ = mk.build()
    return lm, tv


def edit(lm, program, **kw):
    """Change the rows of one LMRB programme: new name, start time, ad time."""
    lm = lm.copy()
    m = lm["Program"] == program
    for k, v in kw.items():
        lm.loc[m, k] = v
    return lm


def slot_of(r, name):
    return [s for s in r["slots"] if name in [n["name"] for n in s["names"]]][0]


def test_name_scores_cover_spelling_sound_repeats_and_initials():
    prog = ["node", "-e", """
const fs=require('fs'),vm=require('vm');globalThis.MR={};vm.runInThisContext(fs.readFileSync(process.argv[1],'utf8'));
const pairs=JSON.parse(process.argv[2]);console.log(JSON.stringify(pairs.map(([a,b])=>MR.pitchNameScore(a,b))));"""]
    same = [("Husmaka Lagina", "HUSMAK LAGIN"), ("Sangeethe Season 2", "SANGEETHE"), ("SANGEETHE -RPT", "Sangeethe Season 2"), ("Hitha illana Tharu", "HITHA ILANA TARU"), ("Mayawi", "MAYAWEE"), ("Sirasa Lakshapathi", "LAKSHAPATHI"),
            ("Lakshapathy", "Lakshapathi"), ("Man Adarei - Rep", "MAN ADAREI"), ("Aththamai Man Oyata Adarei", "AMOA"), ("Ada Derana @ 6.55", "ADA DERANA"), ("18:55 ADA DERANA", "Ada Derana @ 6.55"),
            ("Derana Dream Star Grand Final", "DERANA DREAM STAR"), ("Hiripoda Wessa", "Hiripoda Vessa"), ("Kolamba Kattiya", "Kolomba Kattiya"), ("Weekend Afternoon Movie", "WE Afternoon Movie Movie")]
    diff = [("Late Night Show", "HUSMAK LAGIN"), ("Mid Day News", "Hiru News"), ("Husmak Lagin", "Man Adarei"), ("Sirasa Morning", "Husmak Lagin"), ("News 8", "Hiru News"), ("Movie Alpha", "WEEKEND MOVIE"), ("Neela Samanali", "Mayawee")]
    path = str(ROOT / "app/static/js/engine/pitchmatch.js")
    got = json.loads(subprocess.run(prog + [path, json.dumps(same + diff)], capture_output=True, text=True, timeout=60).stdout)
    assert all(s >= 0.8 for s in got[:len(same)]), list(zip(same, got))
    assert all(s <= 0.55 for s in got[len(same):]), list(zip(diff, got[len(same):]))                 # names made of generic words, or just different, stay low


def test_misspelt_name_and_a_slot_35_minutes_off_still_match(base, tmp_path):
    lm, tv = base
    r0 = run(tmp_path, lm, tv)
    assert {m["tvr_program"] for m in r0["matches"] if m["lmrb_program"] == "HUSMAK LAGIN"} == {"HUSMAK LAGIN"}
    hard = edit(lm, "Husmak Lagin", Program="Husmaka Lagina", Prog_time="19:55", Advt_time="20:10:00")          # other spelling, starts 35 minutes early, no ad inside the TVR slot
    r = run(tmp_path, hard, tv)
    m = [x for x in r["matches"] if x["lmrb_program"] == "HUSMAKA LAGINA"][0]
    assert m["tvr_program"] == "HUSMAK LAGIN" and m["confidence"] >= 50 and "name" in m["method"] and m["reason"]
    sl = slot_of(r, "HUSMAKA LAGINA")
    assert sl["suggestions"] and sl["suggestions"][0]["key"] == sl["tvr_key"] and len(sl["suggestions"]) <= 5
    assert [x["confidence"] for x in sl["suggestions"]] == sorted((x["confidence"] for x in sl["suggestions"]), reverse=True)
    assert r["warnings"]["unmatched_programmes"] == r0["warnings"]["unmatched_programmes"]


def test_repeat_at_another_time_matches_by_name(base, tmp_path):
    lm, tv = base
    rep = edit(lm, "Man Adarei", Program="Man Adarei - RPT", Prog_time="10:00", Advt_time="10:10:00")                # a repeat in the morning, which the TVR sheet does not have
    r = run(tmp_path, rep, tv)
    m = [x for x in r["matches"] if x["lmrb_program"].startswith("MAN ADAREI")][0]
    assert m["tvr_program"] == "MAN ADAREI" and m["level"] in ("Medium", "High") and m["method"] == "name"


def test_movie_titles_in_a_belt_that_starts_30_minutes_early(base, tmp_path):
    lm, tv = base
    mv = lm.copy()
    m = mv["Program"] == "Sunday Movie Special"
    mv.loc[m, "Program"] = [["Movie Alpha", "Movie Beta", "Movie Gamma"][i % 3] for i in range(int(m.sum()))]
    mv.loc[m, "Prog_time"] = "12:00"
    mv.loc[m, "Advt_time"] = "11:50:00"
    r = run(tmp_path, mv, tv)
    sl = slot_of(r, "MOVIE ALPHA")
    assert sl["n_names"] == 3 and sl["tvr_program"] == "WEEKEND MOVIE" and sl["confidence"] >= 45 and "kind" in sl["method"] + sl["reason"]
    assert {x["tvr_program"] for x in r["matches"] if x["slot"] == sl["key"]} == {"WEEKEND MOVIE"}


def test_names_you_approved_are_recognised_elsewhere(base, tmp_path):
    lm, tv = base
    # a programme whose name says nothing and whose slot the TVR sheet does not have (03:00)
    odd = edit(lm, "Sirasa Morning", Program="Jeewithayata Idadenna", Prog_time="03:00", Advt_time="03:10:00")
    r = run(tmp_path, odd, tv)
    lone = slot_of(r, "JEEWITHAYATA IDADENNA")
    assert lone["tvr_key"] is None and lone["level"] == "None"                                    # nothing in it says what it is
    # an earlier approval (kept by the page) says what it is
    kept = run(tmp_path, odd, tv, {"learned": {"SIRASA|jeewithayataidadenna": "MORNING SHOW"}})
    k = slot_of(kept, "JEEWITHAYATA IDADENNA")
    assert k["tvr_program"] == "MORNING SHOW" and k["method"] == "your earlier approval" and k["confidence"] >= 85 and "approved" in k["reason"]
    assert kept["warnings"]["unmatched_programmes"] == r["warnings"]["unmatched_programmes"] - 1
    # a name approved for another programme does not leak onto unrelated names
    other = run(tmp_path, odd, tv, {"learned": {"SIRASA|someothername": "MORNING SHOW"}})
    assert slot_of(other, "JEEWITHAYATA IDADENNA")["tvr_key"] is None


def test_no_false_matches_and_the_minimum_score(base, tmp_path):
    lm, tv = base
    junk = edit(lm, "Late Night Show", Program="Zzz Qqq Xxx")
    r = run(tmp_path, junk, tv)
    assert [m for m in r["matches"] if m["lmrb_program"] == "ZZZ QQQ XXX"][0]["tvr_key"] is None                    # nothing like it anywhere
    assert r["warnings"]["unmatched_programmes"] == 1
    hard = edit(lm, "Husmak Lagin", Program="Husmaka Lagina", Prog_time="19:55", Advt_time="20:10:00")
    strict = run(tmp_path, hard, tv, {"match_min": 95})
    s = slot_of(strict, "HUSMAKA LAGINA")
    assert s["tvr_key"] is None and s["suggestions"] and s["suggestions"][0]["program"] == "HUSMAK LAGIN"          # not accepted, but still offered
    loose = run(tmp_path, hard, tv, {"match_min": 20})
    assert sum(1 for m in loose["matches"] if m["tvr_key"]) >= sum(1 for m in run(tmp_path, hard, tv)["matches"] if m["tvr_key"])


def test_every_slot_gets_ranked_suggestions(base, tmp_path):
    lm, tv = base
    r = run(tmp_path, lm, tv)
    for s in r["slots"]:
        assert len(s["suggestions"]) <= 5 and all(0 <= x["confidence"] <= 100 for x in s["suggestions"])
        if s["tvr_key"] and not s["approved"]:
            assert s["suggestions"] and s["suggestions"][0]["key"] == s["tvr_key"]
