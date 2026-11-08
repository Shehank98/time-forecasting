"""Build the ITN advertising rate card (page 1 of 3, as printed) as a workbook the rate card importer reads.

    python scripts/make_itn_rate_card.py            -> app/static/sample/rate_card_ITN.xlsx

One tab "ITN": the category in the first column, then Programme, Rating, Day/s, Start, End, Rack Rate 10 Sec, Rack Rate 30 Sec. The other
duration rates of the printed card (5, 15, 20, 45, 60, 90, 120 sec) are kept in extra columns for reference; the system works from the 30 sec rate.
The printed card shows no effective date: pick it when importing.
"""
from __future__ import annotations

from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Font

# category, programme, days, start, end, 30 sec rate, as printed
ROWS = [
    ("Tele Drama", "Tele Drama (Repeat)", "Mon - Fri", "8.00 am", "9.00 am", 30000),
    ("Tele Drama", "Tele Drama (Repeat)", "Mon - Sun", "6.00 pm", "6.30 pm", 60000),
    ("Tele Drama", "Kopi Kade Teledrama", "Sunday", "6.00 pm", "6.30 pm", 150000),
    ("Tele Drama", "Prime Time Teledrama", "Mon - Sun", "7.30 pm", "9.30 pm", 275000),
    ("News", "S. News Headline", "Mon-Sun", "6.30 pm", "", 150000),
    ("News", "S. News Local", "Mon-Sun", "6.30 pm", "", 150000),
    ("News", "After Local News Any Segment", "Mon-Sun", "6.30 pm", "", 125000),
    ("News", "Noon News Bulletin", "Mon-Sun", "12.00 pm", "", 40000),
    ("News", "News Flash (before 4.00 pm)", "Mon-Sun", "", "4.00 pm", 30000),
    ("News", "S. News", "Mon-Sun", "10.00 pm", "", 150000),
    ("News", "Weekday Press", "Mon-Fri", "6.00 am", "7.00 am", 20000),
    ("News", "7 Weni Peya - Discussion", "Mon-Fri", "7.00 am", "8.00 am", 20000),
    ("Talk / Chat Show / Reality Show", "Atapattama", "Saturday", "6.00 pm", "6.30 pm", 150000),
    ("Talk / Chat Show / Reality Show", "Kids Cartoons", "Sunday", "4.00 pm", "5.00 pm", 30000),
    ("Talk / Chat Show / Reality Show", "Beat - Musical Programme", "Sat - Sun", "8.00 pm", "9.00 pm", 275000),
    ("Talk / Chat Show / Reality Show", "Doramadalawa", "Monday", "10.30 pm", "", 50000),
    ("Talk / Chat Show / Reality Show", "On-Air Politics", "Tuesday", "10.30 pm", "", 40000),
    ("Talk / Chat Show / Reality Show", "Tamil Movie", "Wednesday", "10.30 pm", "", 40000),
    ("Talk / Chat Show / Reality Show", "Karaliya Political Programme", "Thursday", "10.30 pm", "", 40000),
    ("Music / Dance Programmes & Request Show", "Chat & Music", "Friday", "10.30 pm", "", 50000),
    ("Music / Dance Programmes & Request Show", "Music @ 11", "Mon - Fri", "11.00 pm", "", 30000),
    ("Music / Dance Programmes & Request Show", "Golden Wallet", "Sunday", "10.00 pm", "", 30000),
    ("Women's / Other Programmes", "Pini Viyana / Other Programme", "Mon - Fri", "9.00 am", "12.00 pm", 30000),
    ("Movies", "ITN Tele Cinema", "Mon - Fri", "12.30 pm", "", 60000),
    ("Movies", "Saturday Night Movie", "Saturday", "10.30 pm", "", 50000),
    ("Movies", "Classic Movie", "Sat", "12.30 pm", "", 40000),
    ("Movies", "Blockbuster Movie", "Sun", "12.30 pm", "", 60000),
    ("Children, Education & Sport Programmes", "Children's Programmes", "Daily", "4.00 pm", "6.00 pm", 30000),
    ("Religious Programmes", "Sawanak Res", "Poya day", "6.15 am", "12.00 pm", 30000),
    ("Non Specified Spots", "Other Programme (Prime B)", "Mon - Sun", "10.30 pm", "12.00 am", 40000),      # printed "10.30 pm to 12.00pm", Day "Prime(B)": read as to midnight
    ("Non Specified Spots", "Other Programme", "Mon - Sun", "6.00 am", "6.00 pm", 30000),
]
# the printed card's rate for every other length, as a share of the 30 sec rate (5 sec 20%, 10 sec 40%, 15 sec 60%, 20 sec 80%, 45 sec 150%, 60 sec 200%, 90 sec 300%, 120 sec 400%)
SHARE = {5: 0.2, 10: 0.4, 15: 0.6, 20: 0.8, 45: 1.5, 60: 2.0, 90: 3.0, 120: 4.0}


def build(path: Path) -> Path:
    wb = Workbook()
    ws = wb.active
    ws.title = "ITN"
    ws.cell(1, 1, "ITN Sri Lanka: Advertising rate card (page 1 of 3)")
    heads = ["Prime / Non Prime", "Programme", "Rating", "Day/s", "Start", "End", "Rack Rate 10 Sec", "Rack Rate 30 Sec"] + [f"ITN {s} Sec" for s in (5, 15, 20, 45, 60, 90, 120)]
    for c, h in enumerate(heads, 1):
        ws.cell(2, c, h).font = Font(bold=True)
    for r, (cat, prog, days, start, end, r30) in enumerate(ROWS, 3):
        vals = [cat, prog, None, days, start or None, end or None, round(r30 * SHARE[10]), r30] + [round(r30 * SHARE[s]) for s in (5, 15, 20, 45, 60, 90, 120)]
        for c, v in enumerate(vals, 1):
            ws.cell(r, c, v)
    for c, w in enumerate([38, 34, 8, 12, 10, 10, 16, 16] + [12] * 7, 1):
        ws.column_dimensions[chr(64 + c)].width = w
    path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(path)
    return path


if __name__ == "__main__":
    print(build(Path(__file__).resolve().parent.parent / "app" / "static" / "sample" / "rate_card_ITN.xlsx"))
