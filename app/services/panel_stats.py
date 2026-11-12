"""Summary of a persona panel, worked out in code (no tokens): averages, mood split, segments by age, region, gender, mindset and background, and common worries."""
from __future__ import annotations

import re
from collections import Counter, defaultdict

from . import adtest_stats as stats
from .adtest_models import Concern, EmotionShare, PanelSummary, PersonaResult, Segment

KINDS = (("age", "age_group"), ("region", "region"), ("gender", "gender"), ("mindset", "mindset"), ("background", "background"))
GENDER = {"F": "Women", "M": "Men"}


def _avg(xs: list[float]) -> float:
    return round(sum(xs) / len(xs), 1) if xs else 0.0


def _key(text: str) -> str:
    return " ".join(re.sub(r"[^a-z ]", " ", text.lower()).split()[:3])


def summarise(results: list[PersonaResult], requested: int, run_panels: list | None = None) -> PanelSummary:
    n = max(1, len(results))
    moods = Counter(r.reaction.mood for r in results)
    segs: list[Segment] = []
    for kind, attr in KINDS:
        groups: dict[str, list[PersonaResult]] = defaultdict(list)
        for r in results:
            groups[getattr(r, attr)].append(r)
        for label, rs in groups.items():
            if not label:
                continue
            m = Counter(x.reaction.mood for x in rs)
            segs.append(Segment(kind=kind, label=GENDER.get(label, label) if kind == "gender" else label, n=len(rs),
                                purchase=_avg([x.purchase_mean for x in rs]), share=_avg([x.share_mean for x in rs]),
                                positive=round(m["Positive"] * 100 / len(rs), 1), negative=round((m["Troll"] + m["Angry"]) * 100 / len(rs), 1)))
    seen: dict[str, list] = {}
    for r in results:
        c = r.reaction.concern.strip()
        if len(c) > 2:
            seen.setdefault(_key(c), []).append(c)
    concerns = [Concern(text=v[0], count=len(v)) for _, v in sorted(seen.items(), key=lambda kv: -len(kv[1]))[:6]]
    score = lambda r: r.purchase_mean + r.share_mean + (3 if r.reaction.mood == "Positive" else -3 if r.reaction.mood in ("Troll", "Angry") else 0)  # noqa: E731
    ranked = sorted(results, key=score)
    rp = run_panels or []
    emo = Counter(r.emotion for r in results if r.emotion)
    pci = stats.interval([x.purchase for x in rp], 1, 10) if len(rp) >= 2 else None
    sci = stats.interval([x.share for x in rp], 1, 10) if len(rp) >= 2 else None
    return PanelSummary(size=len(results), requested=requested, purchase=_avg([r.purchase_mean for r in results]),
                        share=_avg([r.share_mean for r in results]), runs=max(1, len(rp)), purchase_ci=pci, share_ci=sci,
                        resonance=round(stats.mean([x.resonance for x in rp]), 1) if rp else 0.0, run_means=[round(x.purchase, 2) for x in rp],
                        emotions=[EmotionShare(emotion=k, percent=round(v * 100 / max(1, sum(emo.values())), 1)) for k, v in emo.most_common()], positive=round(moods["Positive"] * 100 / n, 1), neutral=round(moods["Neutral"] * 100 / n, 1),
                        troll=round(moods["Troll"] * 100 / n, 1), angry=round(moods["Angry"] * 100 / n, 1), segments=segs, concerns=concerns,
                        most_positive=[r.persona_id for r in ranked[::-1][:3]], most_negative=[r.persona_id for r in ranked[:3]])
