"""Offline Sri Lanka media calendar: daily event covariates and chart pins.

Everything here is computed locally with no network access, for any year.

Verified dates win: events in app/config/holidays_lk.json (Poya, Vesak, New Year ...) override the computed ones for the years they cover.
Computed dates are approximations and should be checked against the official calendar:
  * Poya days are the Sri Lanka date (UTC+5:30) of the astronomical full moon (Meeus, Astronomical Algorithms ch. 49, main terms).
  * Vesak is the first full moon on or after 28 April.
  * Ramadan uses the tabular Islamic calendar, which can differ from the sighted moon by a day or two.
"""
from __future__ import annotations

import math
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache

import numpy as np
import pandas as pd

SL_OFFSET = timedelta(hours=5, minutes=30)
FEATURES = ("is_poya_day", "is_festival_window", "is_salary_week", "is_weekend", "is_major_event")


# ------------------------------------------------------------------ astronomy
def _jde_to_datetime(jde: float) -> datetime:
    """Julian ephemeris day to a UTC datetime (delta T ignored: well under a minute of error for our purpose)."""
    return datetime(2000, 1, 1, 12, tzinfo=timezone.utc) + timedelta(days=jde - 2451545.0)


def _full_moon_jde(k: float) -> float:
    """Julian ephemeris day of the full moon with half-integer index k (Meeus ch. 49, main periodic terms)."""
    t = k / 1236.85
    jde = 2451550.09766 + 29.530588861 * k + 0.00015437 * t ** 2 - 0.00000015 * t ** 3 + 0.00000000073 * t ** 4
    e = 1 - 0.002516 * t - 0.0000074 * t ** 2
    m = math.radians((2.5534 + 29.10535670 * k - 0.0000014 * t ** 2) % 360)
    mp = math.radians((201.5643 + 385.81693528 * k + 0.0107582 * t ** 2 + 0.00001238 * t ** 3) % 360)
    f = math.radians((160.7108 + 390.67050284 * k - 0.0016118 * t ** 2 - 0.00000227 * t ** 3) % 360)
    om = math.radians((124.7746 - 1.56375588 * k + 0.0020672 * t ** 2 + 0.00000215 * t ** 3) % 360)
    corr = (-0.40614 * math.sin(mp) + 0.17302 * e * math.sin(m) + 0.01614 * math.sin(2 * mp) + 0.01043 * math.sin(2 * f)
            + 0.00734 * e * math.sin(mp - m) - 0.00515 * e * math.sin(mp + m) + 0.00209 * e * e * math.sin(2 * m)
            - 0.00111 * math.sin(mp - 2 * f) - 0.00057 * math.sin(mp + 2 * f) + 0.00056 * e * math.sin(2 * mp + m)
            - 0.00042 * math.sin(3 * mp) + 0.00042 * e * math.sin(m + 2 * f) + 0.00038 * e * math.sin(m - 2 * f)
            - 0.00024 * e * math.sin(2 * mp - m) - 0.00017 * math.sin(om))
    return jde + corr


@lru_cache(maxsize=None)
def poya_days_computed(year: int) -> tuple[date, ...]:
    """Computed Poya dates (Sri Lanka local date of each full moon) in a calendar year."""
    k0 = math.floor((year - 2000) * 12.3685) - 1
    out = []
    for n in range(0, 16):
        dt = _jde_to_datetime(_full_moon_jde(k0 + n + 0.5)) + SL_OFFSET
        if dt.year == year:
            out.append(dt.date())
    return tuple(sorted(set(out)))


def _verified() -> dict[str, dict[date, str]]:
    """Verified events from the editable config, grouped by type."""
    try:
        from app.services import normalise as nz
        cfg = nz.load_config("holidays_lk.json")
    except Exception:  # noqa: BLE001 - the calendar still works without the file
        return {}
    out: dict[str, dict[date, str]] = {}
    for e in cfg.get("events", []):
        try:
            out.setdefault(e["type"], {})[date.fromisoformat(e["date"])] = e.get("name", e["type"])
        except (KeyError, ValueError):
            continue
    return out


def _poya_set(year: int) -> dict[date, str]:
    ver = _verified()
    verified_years = {d.year for d in ver.get("poya", {})}
    if year in verified_years:
        return dict(ver.get("poya", {})) | {d: n for d, n in ver.get("vesak", {}).items() if "poya" in n.lower()}
    return {d: "Poya (computed)" for d in poya_days_computed(year)}


@lru_cache(maxsize=None)
def vesak_poya(year: int) -> date | None:
    ver = _verified().get("vesak", {})
    for d, name in ver.items():
        if d.year == year and "poya" in name.lower():
            return d
    for d in poya_days_computed(year):
        if d >= date(year, 4, 28):
            return d
    return None


def _islamic_to_gregorian(iy: int, im: int, idy: int) -> date:
    jd = idy + math.ceil(29.5 * (im - 1)) + (iy - 1) * 354 + (3 + 11 * iy) // 30 + 1948439.5 - 1
    return date(2000, 1, 1) + timedelta(days=int(math.floor(jd + 0.5)) - 2451545)


@lru_cache(maxsize=None)
def ramadan_window(year: int) -> tuple[date, date] | None:
    """Tabular Islamic calendar: 1 Ramadan to 1 Shawwal. Returns the window that overlaps the Gregorian year, if any."""
    for iy in range(int((year - 622) * 33 / 32) - 1, int((year - 622) * 33 / 32) + 3):
        a = _islamic_to_gregorian(iy, 9, 1)
        b = _islamic_to_gregorian(iy, 10, 1)
        if a.year == year or b.year == year:
            return a, b
    return None


# ------------------------------------------------------------------ daily flags
def _major(events: list[dict] | None) -> tuple[list[tuple[date, date, str]], int]:
    out = []
    for e in events or []:
        try:
            a = date.fromisoformat(str(e["start"])[:10]); b = date.fromisoformat(str(e.get("end") or e["start"])[:10])
            if b >= a:
                out.append((a, b, str(e.get("name") or "Major event")[:60]))
        except (KeyError, ValueError):
            continue
    return out, len(out)


def day_flags(d: date, major: list[tuple[date, date, str]] | None = None) -> dict[str, int]:
    """The five covariates for one day, as 0/1."""
    poya = d in _poya_set(d.year)
    festival = (d.month == 4 and d.day <= 20) or (d.month == 12 and d.day >= 15)
    v = vesak_poya(d.year)
    if v is not None and v - timedelta(days=3) <= d <= v + timedelta(days=2):
        festival = True
    rw = ramadan_window(d.year)
    for r in ([rw] if rw else []) + ([ramadan_window(d.year - 1)] if ramadan_window(d.year - 1) else []):
        if r[0] <= d < r[1]:
            festival = True
    return {"is_poya_day": int(poya), "is_festival_window": int(festival), "is_salary_week": int(d.day >= 25 or d.day <= 5),
            "is_weekend": int(d.weekday() >= 5), "is_major_event": int(any(a <= d <= b for a, b, _ in (major or [])))}


def daily_frame(start: str | date, end: str | date, events: list[dict] | None = None) -> pd.DataFrame:
    """One row per day with the five covariates, indexed by date."""
    idx = pd.date_range(start, end, freq="D")
    major, _ = _major(events)
    rows = [day_flags(d.date(), major) for d in idx]
    return pd.DataFrame(rows, index=idx, columns=list(FEATURES))


def covariates(dates: pd.DatetimeIndex, gran: str, events: list[dict] | None = None) -> dict[str, np.ndarray]:
    """Covariate arrays aligned to `dates`. Weekly and monthly series get the number of flagged days in the period."""
    if len(dates) == 0:
        return {k: np.zeros(0) for k in FEATURES}
    step = {"daily": 1, "weekly": 7, "monthly": 31}[gran]
    last = dates[-1] + (pd.offsets.MonthEnd(0) if gran == "monthly" else pd.Timedelta(days=step - 1))
    daily = daily_frame(dates[0], last, events)
    if gran == "daily":
        return {k: daily[k].reindex(dates).to_numpy(dtype=float) for k in FEATURES}
    out = {}
    for k in FEATURES:
        arr = np.zeros(len(dates))
        for i, d0 in enumerate(dates):
            d1 = d0 + pd.Timedelta(days=6) if gran == "weekly" else d0 + pd.offsets.MonthEnd(0)
            arr[i] = daily.loc[d0:d1, k].sum()
        out[k] = arr
    return out


# ------------------------------------------------------------------ chart pins
_PIN = {"poya": ("🌕", "Poya"), "salary": ("💰", "Salary window"), "festival": ("🎉", "Festival"), "event": ("📌", "Major event")}


def pins(start: str, end: str, events: list[dict] | None = None) -> list[dict]:
    """Event markers for a chart timeline. Poya days each get a pin, windows get one pin where they start."""
    out: list[dict] = []
    major, _ = _major(events)
    daily = daily_frame(start, end, events)
    prev = {k: 0 for k in FEATURES}
    ver = _verified()
    for ts, row in daily.iterrows():
        d = ts.date()
        iso = str(d)
        if row["is_poya_day"]:
            name = _poya_set(d.year).get(d, "Poya")
            out.append({"date": iso, "kind": "poya", "emoji": _PIN["poya"][0], "label": f"{'Vesak Poya' if vesak_poya(d.year) == d else 'Poya day'}" + ("" if "computed" not in name else " (computed)")})
        if row["is_salary_week"] and not prev["is_salary_week"] and d.day >= 25:
            out.append({"date": iso, "kind": "salary", "emoji": _PIN["salary"][0], "label": "Salary window starts (25th to 5th)"})
        if row["is_festival_window"] and not prev["is_festival_window"]:
            if d.month == 4:
                nm = "Sinhala and Tamil New Year window"
            elif d.month == 12:
                nm = "Christmas and New Year window"
            elif ramadan_window(d.year) and ramadan_window(d.year)[0] <= d < ramadan_window(d.year)[1] or (ramadan_window(d.year - 1) and ramadan_window(d.year - 1)[0] <= d < ramadan_window(d.year - 1)[1]):
                nm = "Ramadan"
            else:
                nm = "Vesak week"
            out.append({"date": iso, "kind": "festival", "emoji": _PIN["festival"][0], "label": nm})
        if row["is_major_event"] and not prev["is_major_event"]:
            nm = next((n for a, b, n in major if a <= d <= b), "Major event")
            out.append({"date": iso, "kind": "event", "emoji": _PIN["event"][0], "label": nm})
        prev = row.to_dict()
    for t, key in (("public", "festival"),):
        for d, nm in ver.get(t, {}).items():
            if pd.Timestamp(start) <= pd.Timestamp(d) <= pd.Timestamp(end) and not any(p["date"] == str(d) and p["kind"] == key for p in out):
                out.append({"date": str(d), "kind": "festival", "emoji": "🏛", "label": nm})
    return sorted(out, key=lambda p: (p["date"], p["kind"]))
