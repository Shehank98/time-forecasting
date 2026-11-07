"""Load the agency rate card workbook into the database (the one DATABASE_URL points at).

    python scripts/import_ratecard.py "rate card.xlsx" [--effective 2026-09-01] [--user-id 1]

The same channel and effective date is replaced; a newer date adds a version. Tabs that give no date use --effective, else today.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.services import db, ratecard  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("--effective", default=None, help="date (YYYY-MM-DD) for tabs without a date in their title")
    ap.add_argument("--user-id", type=int, default=None)
    a = ap.parse_args()
    db.engine()          # creates the tables on first use
    parsed = ratecard.parse_workbook(Path(a.file).read_bytes(), a.effective)
    for d in ratecard.store(parsed, Path(a.file).name, a.user_id):
        print(f"{d['channel']:<16} effective {d['effective_from']}  {d['rows']:>3} programmes  ({d['discount_rows']} discount, {d['special_rows']} special)" + ("" if d["dated"] else "  [no date in the sheet]"))
    for w in parsed["warnings"]:
        print("WARNING:", w)


if __name__ == "__main__":
    main()
