"""Where things sit on the frame, judged in code. The advice about a logo in a blind spot comes from this model of where people look, not from Gemini's opinion
of its own boxes, so it is repeatable and free.

The attention prior blends two well documented habits: people look near the centre first, and in left-to-right languages they scan from the top left.
The bottom right corner is where the eye arrives last. It is a rule of thumb, not an eye-tracking study.
"""
from __future__ import annotations

import math

from .adtest_models import Placement, Zone

GRID = 6


def prior(x: float, y: float) -> float:
    """How much attention the point (x, y) usually gets, 0 to 1 (x left to right, y top to bottom, both 0 to 1)."""
    centre = math.exp(-(((x - 0.5) ** 2) + ((y - 0.45) ** 2)) / (2 * 0.28 ** 2))
    top_left = max(0.0, 1.0 - (x * 0.6 + y * 0.9))
    return max(0.0, min(1.0, 0.6 * centre + 0.4 * top_left))


def prior_grid(n: int = GRID) -> list[list[float]]:
    return [[round(prior((c + 0.5) / n, (r + 0.5) / n), 3) for c in range(n)] for r in range(n)]


def _where(x: float, y: float) -> str:
    v = "top" if y < 0.34 else "bottom" if y > 0.66 else "middle"
    h = "left" if x < 0.34 else "right" if x > 0.66 else "centre"
    return "the centre" if v == "middle" and h == "centre" else f"the {v} {h}" if v != "middle" else f"the {h} edge"


MIN_AREA = {"logo": 2.0, "cta": 2.5, "headline": 4.0, "hook": 6.0, "price": 1.5}
NAME = {"logo": "Brand logo", "cta": "Call to action", "hook": "Primary hook", "headline": "Headline", "price": "Price or offer", "product": "Product", "face": "Face", "other": "Element"}


def check_zone(z: Zone) -> Placement:
    y0, x0, y1, x1 = z.box
    cx, cy, area = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) * (y1 - y0) * 100
    pr = prior(cx, cy)
    verdict = "Strong" if pr >= 0.5 else "OK" if pr >= 0.3 else "Weak"
    name, where = NAME.get(z.kind, "Element"), _where(cx, cy)
    bits: list[str] = []
    if verdict == "Weak" and z.kind in ("logo", "cta", "hook", "headline", "price"):
        target = "the top left" if z.kind in ("logo", "headline") else "the lower centre, in the eye path" if z.kind == "cta" else "the centre or the top left"
        bits.append(f"{name} is in {where}, a low-attention area ({pr * 100:.0f}% of the usual attention). Move it to {target}.")
    elif verdict == "Strong":
        bits.append(f"{name} sits in {where}, where people usually look first.")
    else:
        bits.append(f"{name} is in {where}, a fair place but not the first one the eye reaches.")
    need = MIN_AREA.get(z.kind)
    if need and area < need:
        bits.append(f"It fills only {area:.1f}% of the frame; aim for at least {need:.0f}% so it reads in one second.")
    if z.kind == "hook" and z.order not in (0, 1):
        bits.append("The hook is not the first thing the eye lands on; make it the largest or highest contrast element.")
    return Placement(kind=z.kind, label=z.label or name, area_pct=round(area, 1), attention_prior=round(pr, 2), verdict=verdict, advice=" ".join(bits))


def check_zones(zones: list[Zone]) -> list[Placement]:
    return [check_zone(z) for z in zones]
