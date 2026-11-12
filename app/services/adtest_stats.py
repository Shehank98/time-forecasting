"""Small statistics for the Monte Carlo runs: mean, sample standard deviation and a 95 percent margin of error from Student's t (the runs are few)."""
from __future__ import annotations

import math

from .adtest_models import Interval

# two-sided 95 percent critical values of Student's t by degrees of freedom
T95 = {1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262}


def mean(xs: list[float]) -> float:
    return sum(xs) / len(xs) if xs else 0.0


def sd(xs: list[float]) -> float:
    """Sample standard deviation (n minus 1); 0 for fewer than two values."""
    if len(xs) < 2:
        return 0.0
    m = mean(xs)
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (len(xs) - 1))


def interval(xs: list[float], lo: float | None = None, hi: float | None = None) -> Interval:
    n, m, s = len(xs), mean(xs), sd(xs)
    margin = T95.get(n - 1, 1.96) * s / math.sqrt(n) if n >= 2 else None
    low, high = (m - margin, m + margin) if margin is not None else (m, m)
    if lo is not None:
        low = max(lo, low)
    if hi is not None:
        high = min(hi, high)
    return Interval(mean=round(m, 2), sd=round(s, 2), margin=None if margin is None else round(margin, 2), low=round(low, 2), high=round(high, 2), runs=n)
