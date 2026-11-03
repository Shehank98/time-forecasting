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
    chans = {"Tv - Derana": 1.0, "Tv - Sirasa": 0.8, "Tv - Hiru": 0.7}
    progs = {"Morning": ("Iskole-Rep", "09:00", "09:14:07"), "Afternoon": ("Ponmagal Vandhal", "12:39", "13:03:20"),
             "Prime": ("Teledrama Night", "20:00", "20:25:10"), "Early Prime": ("News 6", "18:00", "18:12:00")}
    rows = []
    for i, d in enumerate(dates):
        for pg, adv, prod, themes, w in advs:
            if adv == "Ceylon Foods" and (i // 7) % 2 == 1:  # pulsing advertiser
                continue
            if adv == "Lanka Tea Co" and i > days - 10:  # stops late
                continue
            n = rng.poisson(3 * w * (1.3 if d.day_of_week >= 5 else 1.0) * (1 + i / days * (0.8 if adv == "Unilever Sri Lanka" else 0)))
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
    # sponsorship items (Time Check, -BB) sold at a lower rate, deterministic copies of every 9th row
    extra = []
    for k, r in enumerate(rows):
        if k % 9 == 0:
            r2 = list(r); r2[3] = "Time Check" if k % 2 == 0 else "Summer Promo -BB"; r2[-1] = round(r2[-1] * 0.4); extra.append(r2)
    rows = rows + extra
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
            tvr = max(0.05, base * rng.uniform(0.8, 1.2) * (1.15 if d.day_of_week >= 5 else 1.0))
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


def make_kpi(days: int = 420, start: str = "2025-08-01", seed: int = 5) -> pd.DataFrame:
    """Daily client data: spend drives leads, weekly and yearly seasonality, two campaigns."""
    rng = np.random.default_rng(seed)
    rows = []
    for i, d in enumerate(pd.date_range(start, periods=days)):
        season = 1 + 0.35 * np.sin(2 * np.pi * (d.day_of_year - 60) / 365)
        weekday = 0.8 if d.day_of_week >= 5 else 1.05
        for camp, share in (("Always-on search", 0.6), ("TV burst", 0.4)):
            spend = max(0.0, 150000 * share * (1.6 if camp == "TV burst" and (i // 30) % 3 == 0 else 1.0) * rng.uniform(0.8, 1.2))
            leads = max(0, int(spend / 1500 * season * weekday * rng.uniform(0.85, 1.15)))
            clicks = int(leads * rng.uniform(18, 25))
            rows.append({"Date": d.strftime("%d/%m/%Y"), "Campaign": camp, "Media Spend (LKR)": f"{spend:,.0f}", "Leads": leads, "Clicks": clicks,
                         "CTR %": round(rng.uniform(1.0, 3.0), 2)})
    return pd.DataFrame(rows)


PRESS_COLS = ["Product_Group", "Advertiser", "Product", "Ads", "Publication", "Dd", "Mn", "Yr", "Date", "Day", "Periodicity", "Lng", "Location", "Type", "Col", "CM", "Dur", "Cost"]


def press_rows(adv, product, pub, dates, cm, col, cost, per="Daily", lng="Sinhala", group="Banking Services", typ="General Int"):
    """One press insertion per date. Dur is the area (col x cm), like the real sheet."""
    out = []
    for d in dates:
        d = pd.Timestamp(d)
        out.append([group, adv, product, 1, pub, d.day, d.month, d.year, f"{d.month}/{d.day}/{d.year}", d.strftime("%a"), per, lng, "", typ, col, cm, col * cm, cost])
    return out


def make_press(seed: int = 3) -> pd.DataFrame:
    """A press sheet with known contracts, near misses and ad hoc ads."""
    rng = np.random.default_rng(seed)
    tue = lambda start, n, step=7: [pd.Timestamp(start) + pd.Timedelta(days=step * k) for k in range(n)]    # noqa: E731
    rows = []
    # A: Commercial Bank, Lankadeepa, 54 cm x 8 col, every Tuesday for 10 weeks, a 6 week break, then 6 more weeks: two contracts
    rows += press_rows("Commercial Bank", "Combank Corporate", "DAILY LANKADEEPA", tue("2026-01-06", 10), 54, 8, 345000)
    rows += press_rows("Commercial Bank", "Combank Corporate", "DAILY LANKADEEPA", tue("2026-04-28", 6), 54, 8, 350000)
    # near miss: the same paper and size but only 3 Fridays
    rows += press_rows("Commercial Bank", "Combank Corporate", "DAILY LANKADEEPA", tue("2026-02-06", 3), 54, 8, 345000)
    # a monthly magazine, same size every month for 6 months: a monthly contract
    rows += press_rows("Commercial Bank", "Combank Corporate", "LMD", [pd.Timestamp(2026, m, 1) for m in range(1, 7)], 26, 3, 170040, per="Monthly", lng="English", typ="Business")
    # B: Sampath Bank, Virakesari, every Thursday, one week missed in the middle: still one contract of 8 insertion dates
    th = tue("2026-01-01", 9)
    rows += press_rows("Sampath Bank", "Vishwa", "DAILY VIRAKESARI", [d for k, d in enumerate(th) if k != 4], 40, 8, 192000, lng="Tamil")
    # C: Sampath Bank, Virakesari, size 51 x 10: 5 Thursdays, then a 3 week gap, then 3 more: only the first run is a contract
    th2 = tue("2026-02-05", 5) + tue("2026-04-02", 3)
    rows += press_rows("Sampath Bank", "Vishwa", "DAILY VIRAKESARI", th2, 51, 10, 480000, lng="Tamil")
    # D: two ads on the same Tuesday count once: 4 Tuesdays with 2 ads each = 4 times, 8 insertions
    rows += press_rows("Dialog", "Dialog Fibre", "SUNDAY TIMES", tue("2026-03-03", 4), 30, 4, 100000, per="Weekly", lng="English")
    rows += press_rows("Dialog", "Dialog Fibre", "SUNDAY TIMES", tue("2026-03-03", 4), 30, 4, 101000, per="Weekly", lng="English")      # a second ad the same day (a different cost: identical rows are duplicates)
    # ad hoc ads on random days and sizes
    pubs = ["DAILY LANKADEEPA", "DAILY VIRAKESARI", "SUNDAY TIMES", "LMD"]
    for k in range(40):
        d = pd.Timestamp("2026-01-01") + pd.Timedelta(days=int(rng.integers(0, 200)))
        rows += press_rows(rng.choice(["Hemas", "Unilever", "Nestle"]), "Misc", pubs[k % 4], [d], int(rng.integers(5, 40)), int(rng.integers(2, 9)), int(rng.integers(40, 400)) * 1000, per="Daily" if k % 4 < 2 else "Weekly")
    return pd.DataFrame(rows, columns=PRESS_COLS)
