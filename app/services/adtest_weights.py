"""Weights that make a persona panel speak for the country.

Any panel over- or under-represents some groups (for example more Colombo people than the 11 percent who live there). Raking, also called iterative
proportional fitting, finds one weight per person so the weighted panel matches the population shares in app/config/population_lk.json on gender,
ethnic group, age group and region at the same time. Weights are capped so no single persona can dominate, and the effective sample size says how much
precision the weighting costs. This is the standard method survey firms use; it fixes the mix, not the quality of the simulated answers.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

CONFIG = Path(__file__).resolve().parent.parent / "config" / "population_lk.json"
DIMENSIONS = ("gender", "ethnic_group", "age_group", "region")
CAP = 4.0          # no persona counts for more than 4 times, or less than a quarter of, an average persona


@lru_cache(maxsize=1)
def targets() -> dict:
    return json.loads(CONFIG.read_text(encoding="utf-8"))


def reload() -> None:
    targets.cache_clear()


def rake(people: list, iterations: int = 60) -> dict[str, float]:
    """people: objects with id and the DIMENSIONS attributes. Returns {id: weight}, mean weight 1."""
    n = len(people)
    if n == 0:
        return {}
    w = {p.id: 1.0 for p in people}
    cfg = targets()
    for _ in range(iterations):
        biggest = 0.0
        for dim in DIMENSIONS:
            want = cfg.get(dim) or {}
            present = {getattr(p, dim) for p in people}
            share = {k: v for k, v in want.items() if k in present}            # a group with nobody in the panel cannot be weighted up
            total = sum(share.values())
            if total <= 0:
                continue
            have: dict[str, float] = {}
            for p in people:
                have[getattr(p, dim)] = have.get(getattr(p, dim), 0.0) + w[p.id]
            wsum = sum(have.values())
            for p in people:
                g = getattr(p, dim)
                if g not in share:
                    continue
                f = (share[g] / total) / (have[g] / wsum)
                biggest = max(biggest, abs(f - 1))
                w[p.id] *= f
        mean = sum(w.values()) / n
        w = {k: min(CAP, max(1 / CAP, v / mean)) for k, v in w.items()}
        if biggest < 1e-4:
            break
    mean = sum(w.values()) / n
    return {k: round(v / mean, 4) for k, v in w.items()}


def effective_n(weights: list[float]) -> float:
    """Kish's effective sample size: how many unweighted people the weighted panel is worth."""
    s, s2 = sum(weights), sum(x * x for x in weights)
    return round(s * s / s2, 1) if s2 > 0 else 0.0
