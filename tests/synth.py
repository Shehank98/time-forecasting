"""Synthetic fixtures for tests (clearly fake, deterministic).

The real sample rows live in tests/fixtures. These generators build enough
history to exercise forecasting, flighting and alerts.
"""
from __future__ import annotations

import io

import numpy as np
import pandas as pd

LMRB_COLS = ["Product_Group", "Advertiser", "Product", "Advt_Theme", "Ads", "Channel", "Program", "Dd", "Mn", "Yr", "Day",
             "Prog_time", "Advt_time", "AdPos", "TotAds", "BrkNo", "PosinBrk", "AdsinBrk", "Lng", "Dur", "Cost"]


def make_lmrb(days: int = 42, start: str = "2026-08-03", seed: int = 7) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    dates = pd.date_range(start, periods=days)
    advs = [("Flavour Enhancers", "Nestle Lanka Ltd", "Maggi Rasa Musu", ["Pumpkin Curry (10)(Sin)", "Dhal Curry (20)(Sin)"], 1.0),
            ("Flavour Enhancers", "Unilever Sri Lanka", "Knorr Cubes", ["Knorr Family (30)(Eng)"], 0.7),
            ("Flavour Enhancers", "Ceylon Foods", "Spice Pot", ["Spice Pot Sin (15)"], 0.35),
            ("Beverages", "Lanka Tea Co", "Island Tea", ["Island Tea (10)(Tam)"], 0.5)]
    chans = {"Tv - Derana": 1.0, "SIRASA": 0.8, "Tv - Hiru": 0.7}
    progs = {"Morning": ("Iskole-Rep", "09:00", "09:14:07"), "Afternoon": ("Ponmagal Vandhal", "12:39", "13:03:20"),
             "Prime": ("Teledrama Night", "20:00", "20:25:10"), "Early Prime": ("News 6", "18:00", "18:12:00")}
    rows = []
    for i, d in enumerate(dates):
        for pg, adv, prod, themes, w in advs:
            if adv == "Ceylon Foods" and (i // 7) % 2 == 1:  # pulsing advertiser
                continue
            if adv == "Lanka Tea Co" and i > days - 10:  # stops late
                continue
            n = rng.poisson(3 * w * (1.3 if d.dayofweek >= 5 else 1.0) * (1 + i / days * (0.8 if adv == "Unilever Sri Lanka" else 0)))
            for _ in range(n):
                ch = rng.choice(list(chans), p=np.array(list(chans.values())) / sum(chans.values()))
                dp = rng.choice(list(progs))
                prog, pt, at = progs[dp]
                theme = themes[0] if (i < days - 10 or len(themes) == 1) else themes[-1]
                dur = int(rng.choice([10, 15, 20, 30]))
                base = 6000 * (1.6 if dp == "Prime" else 1.0) * (0.55 if adv == "Ceylon Foods" else 1.0)
                tot = int(rng.integers(5, 30))
                pos = int(rng.integers(1, tot + 1))
                rows.append([pg, adv, prod, theme, 1, ch, prog, d.day, d.month, d.year, d.strftime("%a"), pt, at, int(rng.integers(1, 80)),
                             int(rng.integers(50, 300)), int(rng.integers(1, 5)), pos, tot, "Sin", dur, round(base * dur * rng.uniform(0.9, 1.1))])
    return pd.DataFrame(rows, columns=LMRB_COLS)


TV_COLS = ["Rank", "Data Set", "Channel", "Date", "Day", "Start", "End", "Program", "Duration", "Category", "TVR", "Total TVR",
           "TVR Share %", "Reach", "Reach %", "Avg Time"]


def make_tv(days: int = 42, start: str = "2026-08-03", seed: int = 11) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    slots = [("SIRASA TV", "NEWS 8", "20:00", 60, "NEWS", 4.0), ("SIRASA TV", "TELEDRAMA ONE", "21:00", 30, "TELEDRAMA - SINHALA", 5.5),
             ("Tv - Derana", "DERANA NEWS", "20:00", 45, "NEWS", 5.0), ("Tv - Derana", "MORNING SHOW", "09:00", 60, "LIFESTYLE", 1.5),
             ("HIRU TV", "HIRU NEWS", "19:30", 30, "NEWS", 3.2), ("SHAKTHI TV", "ANNAM", "22:00", 30, "TELEDRAMA - TAMIL", 1.7),
             ("SIYATHA TV", "WEEKDAY MOVIE", "13:00", 90, "MOVIES", 1.1)]
    rows, rank = [], 1
    for i, d in enumerate(pd.date_range(start, periods=days)):
        for ch, prog, st, dur, cat, base in slots:
            h, m = map(int, st.split(":"))
            end = pd.Timestamp(2000, 1, 1, h, m) + pd.Timedelta(minutes=dur)
            tvr = max(0.05, base * rng.uniform(0.8, 1.2) * (1.15 if d.dayofweek >= 5 else 1.0))
            tot = tvr * rng.uniform(2.5, 4)
            rows.append([rank, "Custom Target", ch, d.strftime("%Y/%m/%d"), d.strftime("%A"), st, end.strftime("%H:%M"), prog, dur, cat,
                         round(tvr, 2), round(tot, 2), round(tvr / tot * 100, 2), int(tvr * 30000), round(tvr * 1.3, 2), 0])
            rank += 1
    return pd.DataFrame(rows, columns=TV_COLS)


def to_csv_bytes(df: pd.DataFrame) -> bytes:
    return df.to_csv(index=False).encode()


def to_xlsx_bytes(df: pd.DataFrame) -> bytes:
    buf = io.BytesIO()
    df.to_excel(buf, index=False)
    return buf.getvalue()
