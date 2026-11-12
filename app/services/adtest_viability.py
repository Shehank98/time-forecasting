"""The Pre-Launch Viability Score, out of 100, with a margin of error.

It is a plain weighted mean of five ingredients, each on a 0 to 100 scale: visual impact, hook, purchase intent, share intent and safety (100 minus backlash risk).
The weights depend on the campaign goal and live in app/config/ad_benchmarks.json, so an agency can change them. The margin of error comes from repeating the whole
persona panel (the Monte Carlo runs): the score is worked out once per run and the spread between runs gives a 95 percent interval. It shows how much the simulated
audience varied; it does not include any error in the image analysis, so read it as a floor, not a guarantee.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from . import adtest_stats as stats
from .adtest_models import Viability, VisionResult

CONFIG = Path(__file__).resolve().parent.parent / "config" / "ad_benchmarks.json"
DEFAULT_GOAL = "consideration"


@lru_cache(maxsize=1)
def _config() -> dict:
    return json.loads(CONFIG.read_text(encoding="utf-8"))


def reload_config() -> None:
    _config.cache_clear()


def weights_for(goal: str) -> dict[str, float]:
    w = _config()["viability_weights"].get(goal or DEFAULT_GOAL) or _config()["viability_weights"][DEFAULT_GOAL]
    t = sum(w.values())
    return {k: v / t for k, v in w.items()}


def _score(w: dict[str, float], parts: dict[str, float]) -> float:
    return sum(w[k] * parts[k] for k in w)


def label_for(score: float, risk_level: str) -> str:
    base = "Launch" if score >= 75 else "Launch after fixes" if score >= 60 else "Rework" if score >= 45 else "Do not launch"
    if risk_level == "Critical":
        return "Do not launch"
    if risk_level == "High" and base in ("Launch", "Launch after fixes"):
        return "Rework"
    return base


def compute(vision: VisionResult, purchase: float, share: float, backlash: float, risk_level: str, goal: str, run_purchase: list[float], run_share: list[float]) -> Viability:
    """purchase and share are panel means on the 1 to 10 scale; run_* are the same per run (for the margin)."""
    g = goal or DEFAULT_GOAL
    w = weights_for(g)
    parts = {"visual": vision.visual_impact, "hook": vision.hook_score, "purchase": purchase * 10, "share": share * 10, "safety": 100 - backlash}
    score = _score(w, parts)
    per_run = [_score(w, {**parts, "purchase": p * 10, "share": s * 10}) for p, s in zip(run_purchase, run_share)]
    iv = stats.interval(per_run, 0, 100) if len(per_run) >= 2 else None
    return Viability(score=round(score, 1), low=None if iv is None else round(max(0, score - iv.margin), 1), high=None if iv is None else round(min(100, score + iv.margin), 1),
                     margin=None if iv is None else round(iv.margin, 1), runs=max(1, len(per_run)), goal=g, weights={k: round(v, 3) for k, v in w.items()},
                     parts={k: round(v, 1) for k, v in parts.items()}, label=label_for(score, risk_level))
