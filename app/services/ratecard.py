"""Agency TV rate card: read the planners' rate card workbook and keep it in the database, versioned by effective date.

Workbook layout (one tab per channel, the first row is a title, the second the headings):
    Prime / Non Prime | Programme | Rating | Day/s | Start | End | Rack Rate 10 Sec | Rack Rate 30 Sec | (negotiated rate under a "Negosiated Rate" title)
- 30 sec rack rate: typed, or 3 x the 10 sec rate when the 30 sec cell is a formula of it.
- Negotiated rate: a formula such as =G3*27% (the rack rate x 27%) is read as a DISCOUNT RATE (the sheet's own number is kept: 27% of rack = 73% off).
  A number typed into the cell is a SPECIAL RATE for that programme.
"""
from __future__ import annotations

import datetime as dt
import io
import logging
import re
from typing import Any

from sqlalchemy import delete, func, insert, select

from . import db
from .normalise import normalise_channel

log = logging.getLogger(__name__)
DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
MONTHS = {m: i + 1 for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}


BUILTIN = {"itn": "rate_card_ITN.xlsx"}           # rate cards shipped with the app (scripts/make_itn_rate_card.py builds the ITN one from the printed card)


def builtin_bytes(name: str) -> tuple[bytes, str]:
    """(workbook bytes, file name) of a bundled rate card."""
    from pathlib import Path
    fn = BUILTIN.get(name.lower())
    if not fn:
        raise RateCardError("There is no bundled rate card with that name.")
    path = Path(__file__).resolve().parent.parent / "static" / "sample" / fn
    if not path.exists():
        raise RateCardError("The bundled rate card file is missing.")
    return path.read_bytes(), fn


class RateCardError(ValueError):
    """A problem with the uploaded workbook that the user can fix."""


def parse_time(v: Any) -> int | None:
    """Seconds since midnight from a time cell: 18:55:00, '06:55 pm', '12:00 nn', '12:00:00 NN'."""
    if v is None or v == "":
        return None
    if isinstance(v, (dt.time, dt.datetime)):
        return v.hour * 3600 + v.minute * 60 + v.second
    if isinstance(v, (int, float)) and 0 <= float(v) < 1:
        return round(float(v) * 86400)
    m = re.match(r"^\s*(\d{1,2})[:.](\d{2})(?::(\d{2}))?\s*(am|pm|nn|noon)?\s*$", str(v).strip().lower())
    if not m:
        return None
    h, mi, sec, ap = int(m.group(1)), int(m.group(2)), int(m.group(3) or 0), m.group(4)
    if ap == "pm" and h < 12:
        h += 12
    elif ap == "am" and h == 12:
        h = 0
    return (h % 24) * 3600 + mi * 60 + sec if h <= 24 else None


def parse_days(text: Any) -> tuple[str, str]:
    """(cleaned label, Mon..Sun mask) from 'Mon-Fri', 'Sat/Sun', 'Saturday & Sunday', 'Mon to Sunday', 'Daily'."""
    raw = re.sub(r"\s+", " ", str(text or "")).strip()
    low = raw.lower()
    if not low or "daily" in low or "all days" in low:
        return raw or "Daily", "1111111"
    toks = [(m.start(), m.end(), DAYS.index(m.group(1))) for m in re.finditer(r"(mon|tue|wed|thu|fri|sat|sun)[a-z]*", low)]
    if not toks:
        return raw, "1111111"
    days: set[int] = set()
    i = 0
    while i < len(toks):
        a = toks[i]
        if i + 1 < len(toks) and re.search(r"-|–|\bto\b", low[a[1]:toks[i + 1][0]]):
            b = toks[i + 1]
            days.update(range(a[2], b[2] + 1) if b[2] >= a[2] else list(range(a[2], 7)) + list(range(0, b[2] + 1)))
            i += 2
        else:
            days.add(a[2])
            i += 1
    return raw, "".join("1" if d in days else "0" for d in range(7))


def parse_effective(text: Any) -> str | None:
    """A date written in a title: 'Effective: 2025.sep.1', '2026 sep 1', '2026.08.07', '2026 july 1st'."""
    s = str(text or "").lower()
    m = re.search(r"(20\d{2})\s*[.\-/ ]\s*([a-z]{3,9}|\d{1,2})\s*[.\-/ ]\s*(\d{1,2})", s)
    if not m:
        return None
    y, mo, d = int(m.group(1)), m.group(2), int(m.group(3))
    mm = int(mo) if mo.isdigit() else MONTHS.get(mo[:3])
    try:
        return dt.date(y, mm, d).isoformat() if mm else None
    except ValueError:
        return None


def _num(v: Any) -> float | None:
    if isinstance(v, bool) or v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v).replace(",", "").strip())
    except ValueError:
        return None


def _find(headers: list[str], *needles: str) -> int | None:
    for i, h in enumerate(headers):
        if all(n in h for n in needles):
            return i
    return None


def _col(i: int) -> str:
    s, i = "", i + 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def parse_workbook(content: bytes, default_effective: str | None = None) -> dict:
    """Read every channel tab. Returns {channels: [{channel, sheet, effective, rows, discount_rows, special_rows, warnings}], warnings: []}."""
    import openpyxl
    try:
        wf = openpyxl.load_workbook(io.BytesIO(content))
        wv = openpyxl.load_workbook(io.BytesIO(content), data_only=True)
    except Exception as e:                                   # noqa: BLE001 - any unreadable file is the user's to fix
        raise RateCardError("That file could not be read as an Excel workbook (.xlsx).") from e
    out, warnings = [], []
    default_effective = default_effective or dt.date.today().isoformat()
    for ws in wv.worksheets:
        wsf = wf[ws.title]
        head_row = next((r for r in range(1, 8) if any("programme" in str(c.value or "").lower() for c in ws[r])), None)
        if head_row is None:
            continue                                         # a summary or notes tab
        headers = [str(c.value or "").strip().lower() for c in ws[head_row]]
        title_row = [str(c.value or "").strip().lower() for c in ws[head_row - 1]] if head_row > 1 else []
        i_prog, i_rate = _find(headers, "programme"), _find(headers, "rating")
        i_day, i_start, i_end = _find(headers, "day"), _find(headers, "start"), _find(headers, "end")
        i30, i10 = _find(headers, "rack", "30"), _find(headers, "rack", "10")
        i_con = next((i for i, h in enumerate(headers) if "contract" in h and "30" in h and "rack" not in h and "non" not in h), None)      # "Contract Rate 30 Sec": the rate the negotiated discount is taken from
        i_neg = next((i for i, t in enumerate(title_row) if "negos" in t or "negot" in t), None)
        if i_prog is None or (i30 is None and i10 is None and i_con is None):
            warnings.append(f"Tab \"{ws.title}\": no programme or rack rate column was found, so it was skipped.")
            continue
        channel, matched = normalise_channel(ws.title)
        sheet_warn: list[str] = []
        if not matched:
            sheet_warn.append(f"The tab name \"{ws.title}\" is not in the channel alias table, so the channel is saved as {channel}. Add an alias under Settings if that is not the name used in the other sheets.")
        effective = parse_effective(ws.cell(1, 1).value) or default_effective
        rows, n_disc, n_spec = [], 0, 0
        for r in range(head_row + 1, ws.max_row + 1):
            prog = ws.cell(r, i_prog + 1).value
            rack30, rack10 = _num(ws.cell(r, i30 + 1).value) if i30 is not None else None, _num(ws.cell(r, i10 + 1).value) if i10 is not None else None
            if rack30 is None and rack10:
                rack30 = rack10 * 3
            contract30 = _num(ws.cell(r, i_con + 1).value) if i_con is not None else None
            if not rack30 and contract30:
                rack30 = contract30                                   # a card with only a contract rate: it is also the rack rate
            if not prog or not str(prog).strip() or not rack30 or rack30 <= 0:
                continue
            label, mask = parse_days(ws.cell(r, i_day + 1).value if i_day is not None else "")
            neg_mode = neg_value = neg_rate = None
            if i_neg is not None:
                typed, formula = ws.cell(r, i_neg + 1).value, wsf.cell(r, i_neg + 1).value
                neg_rate = _num(typed)
                m = re.fullmatch(r"=\s*\$?([A-Z]+)\$?\d+\s*\*\s*(\d*\.?\d+)\s*(%?)", str(formula or "").strip())
                if m:                                            # a formula: read the factor from it (cached results may be missing)
                    f = float(m.group(2)) / (100 if m.group(3) else 1)
                    ref_ok = m.group(1) in {_col(i30) if i30 is not None else "", _col(i10) if i10 is not None else "", _col(i_con) if i_con is not None else ""}
                    if ref_ok and 0 < f <= 1:
                        base = rack30 if m.group(1) == (_col(i30) if i30 is not None else "") else (contract30 if m.group(1) == (_col(i_con) if i_con is not None else "") and contract30 else (rack10 or rack30))
                        neg_mode, neg_value, neg_rate = "discount", round((1 - f * base / rack30) * 100, 4), f * base
                        n_disc += 1
                if neg_mode is None and neg_rate and neg_rate > 0:
                    neg_mode, neg_value = "special", neg_rate
                    n_spec += 1
            band = str(ws.cell(r, 1).value or "").strip()
            rows.append({"channel": channel, "effective_from": effective, "programme": re.sub(r"\s+", " ", str(prog)).strip(), "band": band, "days": label, "day_mask": mask,
                         "start_sec": parse_time(ws.cell(r, i_start + 1).value) if i_start is not None else None, "end_sec": parse_time(ws.cell(r, i_end + 1).value) if i_end is not None else None,
                         "rating": _num(ws.cell(r, i_rate + 1).value) if i_rate is not None else None, "rack30": rack30, "rack10": rack10, "contract30": contract30, "neg_mode": neg_mode, "neg_value": neg_value,
                         "neg_rate": neg_rate if neg_mode else None})
        if not rows:
            warnings.append(f"Tab \"{ws.title}\": no programme rows with a rack rate.")
            continue
        out.append({"channel": channel, "sheet": ws.title, "effective": effective, "rows": rows, "discount_rows": n_disc, "special_rows": n_spec,
                    "dated": parse_effective(ws.cell(1, 1).value) is not None, "warnings": sheet_warn})
    if not out:
        raise RateCardError("No channel tabs with programmes and rack rates were found. Each tab needs the headings Programme, Day/s, Start, End and Rack Rate 30 Sec.")
    return {"channels": out, "warnings": warnings}


def store(parsed: dict, source: str, user_id: int) -> list[dict]:
    """Save every channel. The same channel and effective date is replaced; a new date adds a version."""
    done = []
    with db.engine().begin() as c:
        for ch in parsed["channels"]:
            c.execute(delete(db.rate_cards).where(db.rate_cards.c.channel == ch["channel"], db.rate_cards.c.effective_from == ch["effective"]))
            c.execute(insert(db.rate_cards), [{**r, "source": source[:300], "created_by": user_id} for r in ch["rows"]])
            done.append({"channel": ch["channel"], "sheet": ch["sheet"], "effective_from": ch["effective"], "rows": len(ch["rows"]), "discount_rows": ch["discount_rows"],
                         "special_rows": ch["special_rows"], "dated": ch["dated"], "warnings": ch["warnings"]})
    log.info("[ratecard] stored %s", [(d["channel"], d["effective_from"], d["rows"]) for d in done])
    return done


def versions() -> list[dict]:
    t = db.rate_cards
    with db.engine().connect() as c:
        rows = c.execute(select(t.c.channel, t.c.effective_from, func.count().label("rows"), func.max(t.c.source).label("source"), func.max(t.c.created_at).label("created_at"),
                                func.sum(func.coalesce((t.c.neg_mode == "discount").cast(db.Integer), 0)).label("disc"), func.sum(func.coalesce((t.c.neg_mode == "special").cast(db.Integer), 0)).label("spec"))
                         .group_by(t.c.channel, t.c.effective_from).order_by(t.c.channel, t.c.effective_from.desc())).all()
    by: dict[str, list[dict]] = {}
    for r in rows:
        by.setdefault(r.channel, []).append({"effective_from": r.effective_from, "rows": r.rows, "source": r.source, "created_at": r.created_at.isoformat() if r.created_at else None,
                                            "discount_rows": int(r.disc or 0), "special_rows": int(r.spec or 0)})
    return [{"channel": ch, "latest": v[0]["effective_from"], "versions": v} for ch, v in sorted(by.items())]


def current(as_of: str | None = None) -> dict:
    """The newest version of every channel (not later than as_of when given)."""
    t = db.rate_cards
    with db.engine().connect() as c:
        q = select(t.c.channel, func.max(t.c.effective_from).label("eff")).group_by(t.c.channel)
        if as_of:
            q = q.where(t.c.effective_from <= as_of)
        latest = {r.channel: r.eff for r in c.execute(q)}
        entries = []
        for ch, eff in latest.items():
            for r in c.execute(select(t).where(t.c.channel == ch, t.c.effective_from == eff).order_by(t.c.start_sec, t.c.programme)).mappings():
                entries.append({"channel": ch, "effective_from": eff, "programme": r["programme"], "band": r["band"], "days": r["days"], "mask": r["day_mask"], "start": r["start_sec"], "end": r["end_sec"],
                                "rating": r["rating"], "rack30": r["rack30"], "rack10": r["rack10"], "contract30": r["contract30"], "neg_mode": r["neg_mode"], "neg_value": r["neg_value"], "neg_rate": r["neg_rate"]})
    return {"channels": [{"channel": ch, "effective_from": eff, "rows": sum(1 for e in entries if e["channel"] == ch)} for ch, eff in sorted(latest.items())], "entries": entries}


def delete_version(channel: str, effective_from: str) -> int:
    t = db.rate_cards
    with db.engine().begin() as c:
        return c.execute(delete(t).where(t.c.channel == channel, t.c.effective_from == effective_from)).rowcount
