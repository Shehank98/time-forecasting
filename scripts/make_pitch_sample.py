"""Sample data for the Client Pitch Evaluator: a fake prospect's LMRB sheet, a TVR sheet and a rates template.

Run:  python scripts/make_pitch_sample.py   (writes app/static/sample/pitch_*.csv)
Everything here is invented. LMRB programme names deliberately differ from the TVR names (the same slot, a different label),
one LMRB channel is not in the TVR sheet, one programme airs at a time the TVR sheet does not have, and some programmes have no rate,
so the matching review and the warnings have something to show.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tests"))
from synth import LMRB_COLS, TV_COLS  # noqa: E402

# (tvr channel, tvr programme, lmrb channel, lmrb programme, start, minutes, days(0=Mon), base TVR, card rate for 30 sec)
SLOTS = [
    ("Tv - Derana", "DERANA ARUNA", "TV - Derana", "Derana Aruna", "06:25", 65, range(7), 3.85, 332000),
    ("Tv - Derana", "MID DAY NEWS", "TV - Derana", "Mid Day News", "12:00", 30, range(7), 1.28, 202000),
    ("Tv - Derana", "WEEKEND MOVIE", "TV - Derana", "Sunday Movie Special", "12:30", 180, (5, 6), 1.22, 228000),
    ("Tv - Derana", "HUSMAK LAGIN", "TV - Derana", "Husmak Lagin", "20:30", 30, range(5), 7.95, 1092000),
    ("Tv - Derana", "MAN ADAREI", "TV - Derana", "Man Adarei", "21:30", 30, range(5), 8.35, 664000),
    ("Tv - Derana", "DERANA DREAM STAR", "TV - Derana", "Dream Star Grand Final", "19:30", 90, (6,), 3.97, 493000),
    ("SIRASA TV", "NEWS 8", "TV - Sirasa TV", "Sirasa News", "20:00", 60, range(7), 4.0, 450000),
    ("SIRASA TV", "TELEDRAMA ONE", "TV - Sirasa TV", "Teledrama One", "21:00", 30, range(5), 5.5, 520000),
    ("SIRASA TV", "LAKSHAPATHI", "TV - Sirasa TV", "Lakshapathi", "19:30", 60, (5, 6), 6.0, 600000),
    ("SIRASA TV", "MORNING SHOW", "TV - Sirasa TV", "Sirasa Morning", "07:00", 120, range(7), 1.6, 150000),
    ("HIRU TV", "HIRU NEWS", "Tv - Hiru", "Hiru News", "19:30", 30, range(7), 3.2, 380000),
    ("HIRU TV", "HIRU MOVIE", "Tv - Hiru", "Hiru Cinema", "14:00", 150, (6,), 1.1, 140000),
    ("HIRU TV", "HIRU MORNING", "Tv - Hiru", "Hiru Morning Show", "06:30", 90, range(7), 1.0, 120000),
]
START, DAYS = "2026-08-03", 56          # eight weeks: August and September
THEMES = ["Sampath Vishwa (30)(Sin)", "Sampath Digital (15)(Sin)", "Sampath Home Loan (10)(Eng)"]


def build(seed: int = 21):
    rng = np.random.default_rng(seed)
    dates = pd.date_range(START, periods=DAYS)
    tv_rows, rank = [], 1
    for d in dates:
        for tch, tprog, _, _, st, mins, days, base, _ in SLOTS:
            if d.day_of_week not in days:
                continue
            h, m = map(int, st.split(":"))
            end = pd.Timestamp(2000, 1, 1, h, m) + pd.Timedelta(minutes=mins)
            tvr = round(base * rng.uniform(0.85, 1.15), 2)
            tv_rows.append([rank, "Custom Target", tch, d.strftime("%Y/%m/%d"), d.strftime("%A"), st, end.strftime("%H:%M"), tprog, mins, "GENERAL", tvr,
                            round(tvr * 3, 2), round(tvr / 3, 2), int(tvr * 30000), round(tvr * 1.3, 2), 0])
            rank += 1
    tvr = pd.DataFrame(tv_rows, columns=TV_COLS)

    rows, k = [], 0
    for d in dates:
        for _, _, lch, lprog, st, mins, days, _, card in SLOTS:
            if d.day_of_week not in days:
                continue
            h, m = map(int, st.split(":"))
            for _ in range(int(rng.integers(1, 4))):
                k += 1
                dur = int(rng.choice([10, 15, 20, 30], p=[0.2, 0.2, 0.2, 0.4]))
                theme = "Time Check" if rng.random() < 0.08 else THEMES[int(rng.integers(0, len(THEMES)))]
                paid = card * dur / 30 * rng.uniform(0.55, 0.75) * (0.5 if theme == "Time Check" else 1.0)     # the current agency pays well under card
                at = pd.Timestamp(2000, 1, 1, h, m) + pd.Timedelta(minutes=int(rng.integers(0, max(1, mins - 5))), seconds=int(rng.integers(0, 59)))
                rows.append(["Banking Services", "Sampath Bank", "Sampath Vishwa", theme, 1, lch, lprog, d.day, d.month, d.year, d.strftime("%a"), st, at.strftime("%H:%M:%S"),
                             k, 100, 1 + k % 9, 1 + k % 5, 6, "Sin", dur, round(paid)])
        if d.day_of_week < 5:       # a programme at a time the TVR sheet does not have
            k += 1
            rows.append(["Banking Services", "Sampath Bank", "Sampath Vishwa", THEMES[0], 1, "TV - Derana", "Late Night Show", d.day, d.month, d.year, d.strftime("%a"), "23:30", "23:40:00", k, 100, 1, 1, 6, "Sin", 30, 90000])
        if d.day_of_week in (1, 3):  # a channel that is not in the TVR sheet, and a radio station
            k += 1
            rows.append(["Banking Services", "Sampath Bank", "Sampath Vishwa", THEMES[0], 1, "TV - ITN", "ITN News", d.day, d.month, d.year, d.strftime("%a"), "20:00", "20:10:00", k, 100, 1, 1, 6, "Sin", 30, 70000])
            k += 1
            rows.append(["Banking Services", "Sampath Bank", "Sampath Vishwa", THEMES[0], 1, "Radio - Shakthi FM", "Morning Show", d.day, d.month, d.year, d.strftime("%a"), "07:00", "07:10:00", k, 100, 1, 1, 6, "Sin", 30, 20000])
    lmrb = pd.DataFrame(rows, columns=LMRB_COLS)

    rates = []
    for tch, tprog, *_rest, card in [(s[0], s[1], s[8]) for s in SLOTS]:
        if tprog in ("HIRU MOVIE", "TELEDRAMA ONE"):
            continue                      # no rate yet: shows up under missing rates
        if tprog == "HIRU MORNING":
            rates.append([tch, tprog, round(card / 3), 10])        # a 10 second rate, converted to 30 seconds
        else:
            rates.append([tch, tprog, card, 30])
    return lmrb, tvr, pd.DataFrame(rates, columns=["Channel", "Programme", "Rate", "Seconds"])


def main():
    out = ROOT / "app/static/sample"
    out.mkdir(parents=True, exist_ok=True)
    lmrb, tvr, rates = build()
    lmrb.to_csv(out / "pitch_lmrb.csv", index=False)
    tvr.to_csv(out / "pitch_tvr.csv", index=False)
    rates.to_csv(out / "pitch_rates.csv", index=False)
    print(f"wrote {len(lmrb)} LMRB rows, {len(tvr)} TVR rows, {len(rates)} rates to {out}")


if __name__ == "__main__":
    main()
