"""Module 2: a synthetic Sri Lankan focus group of up to 100 personas.

Token saving is the design. The ad is shown once per batch of up to 25 personas, each persona is a one line description (see persona_bank), the answer is a
short fixed set of fields, and the cheaper panel model runs with thinking switched off. A full panel of 100 is four calls, not one hundred.

These are simulated reactions from a language model, not real people. They are good for spotting problems and comparing versions of an ad,
not for predicting exact sales. The report says so.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Callable

from collections import Counter
from dataclasses import dataclass, field

from . import adtest_llm as llm
from . import adtest_stats as stats
from .adtest_models import AdBrief, PanelBatch, PersonaResult, VisionResult
from .persona_bank import Persona

log = logging.getLogger(__name__)
BATCH = 25
PARALLEL = 4

SYSTEM = ("You simulate a Sri Lankan consumer focus group. For each person listed, react to the ad as that person really would, in their voice, "
          "without being polite for the sake of it. Real people are blunt, funny, suspicious or unimpressed. Different people must react differently. "
          "For each person return: id (exactly as listed), gut_reaction (under 20 words, English), comment (the exact comment they would post under this ad on Facebook "
          "or TikTok, under 25 words, in the language they really use: Sinhala in Sinhala script, Tamil in Tamil script, Singlish in English letters, or English), "
          "comment_language, purchase_intent and share_intent (whole numbers 1 to 10), mood (Positive, Neutral, Troll if they would mock it, Angry if they would "
          "complain), emotion (the main feeling the ad gives them: Joy, Trust, Pride, Humour, Curiosity, Indifference, Distrust or Offence), resonance (1 to 10: how strongly it "
          "moves them), and concern (their main worry in under 8 words, empty if none). Return one entry per person, in the order listed, and no others.")


def _parts(brief: AdBrief, vision: VisionResult | None, media: list[tuple[str, bytes]], people: list[Persona]) -> list[Any]:
    from google.genai import types

    parts: list[Any] = []
    for label, jpg in media:
        parts.append(f"{label}:")
        parts.append(types.Part.from_bytes(data=jpg, mime_type="image/jpeg"))
    rev = (vision.static or vision.video) if vision is not None else None
    kind = "a video commercial (sample frames shown)" if brief.ad_type == "video" else "a static ad"
    seen = f"\nReviewer's summary: {rev.summary}" if rev is not None else ""
    parts.append(f"The ad is {kind}.\n<data>\n{brief.text_block()}\n</data>{seen}\n\nThe people:\n" + "\n".join(p.line() for p in people) + "\n\nReact now.")
    return parts


async def _batch(people: list[Persona], brief: AdBrief, vision: VisionResult | None, media: list[tuple[str, bytes]], seed: int | None = None) -> dict[str, Any]:
    got: dict[str, Any] = {}
    want = list(people)
    for attempt in range(2):          # a second try asks only for the people the first answer missed
        out = await llm.generate_json(_parts(brief, vision, media, want), PanelBatch, SYSTEM, temperature=0.9, model=llm.panel_model(), thinking=0,
                                      max_tokens=min(16000, 400 + 210 * len(want)), seed=seed)
        ids = {p.id for p in want}
        for r in out.reactions:
            if r.id in ids and r.id not in got:
                got[r.id] = r
        want = [p for p in people if p.id not in got]
        if not want:
            break
        log.warning("[adtest] batch missed %d of %d personas (attempt %d)", len(want), len(people), attempt + 1)
    return got


@dataclass
class RunPanel:
    """One Monte Carlo run of the whole panel."""
    n: int
    purchase: float
    share: float
    resonance: float
    positive: float
    negative: float


@dataclass
class FocusGroup:
    results: list[PersonaResult]
    runs: list[RunPanel] = field(default_factory=list)
    per_run: list[dict] = field(default_factory=list)      # each run: {persona id: its reaction}


def weighted_runs(per_run: list[dict], weights: dict[str, float]) -> list[RunPanel]:
    """The same per-run panel averages, with each persona counted by its population weight (1 for everyone when there are no weights)."""
    out = []
    for d in per_run:
        items = list(d.items())
        if not items:
            continue
        w = [weights.get(k, 1.0) for k, _ in items]
        t = sum(w) or 1.0
        avg = lambda f: sum(wi * f(v) for wi, (_, v) in zip(w, items)) / t  # noqa: E731
        out.append(RunPanel(n=len(items), purchase=avg(lambda v: v.purchase_intent), share=avg(lambda v: v.share_intent), resonance=avg(lambda v: v.resonance),
                            positive=100 * avg(lambda v: v.mood == "Positive"), negative=100 * avg(lambda v: v.mood in ("Troll", "Angry"))))
    return out


MOOD_ORDER = {"Angry": 0, "Troll": 1, "Neutral": 2, "Positive": 3}


def _majority(values: list[str], first: str) -> str:
    c = Counter(values)
    top = max(c.values())
    return first if c[first] == top else sorted(k for k, v in c.items() if v == top)[0]


async def run_focus_group(brief: AdBrief, vision: VisionResult | None, media: list[tuple[str, bytes]], panel: list[Persona],
                          progress: Callable[[int, int], None] | None = None, runs: int = 3) -> FocusGroup:
    """Monte Carlo ensemble: the whole panel answers `runs` times, each run with its own seed, a different persona order (so batches mix differently) and
    high temperature. Batches of up to 25 run up to four at once. A persona the model still skipped in a run is left out of that run and counted in the summary."""
    runs = max(1, runs)
    sem, done, total = asyncio.Semaphore(PARALLEL), [0], len(panel) * runs

    async def one(r: int, people: list[Persona]) -> tuple[int, dict[str, Any]]:
        async with sem:
            got = await _batch(people, brief, vision, media, seed=1000 + r)
            done[0] += len(people)
            if progress:
                progress(done[0], total)
            return r, got

    jobs = []
    for r in range(runs):
        rot = (r * 7) % max(1, len(panel))
        order = panel[rot:] + panel[:rot]
        jobs += [one(r, order[i:i + BATCH]) for i in range(0, len(order), BATCH)]
    parts = await asyncio.gather(*jobs)
    by_run: list[dict[str, Any]] = [{} for _ in range(runs)]
    for r, got in parts:
        by_run[r].update(got)

    out: list[PersonaResult] = []
    for p in panel:
        rs = [by_run[r][p.id] for r in range(runs) if p.id in by_run[r]]
        if not rs:
            continue
        pm, sm = [float(x.purchase_intent) for x in rs], [float(x.share_intent) for x in rs]
        mean_p = stats.mean(pm)
        rep = min(rs, key=lambda x: abs(x.purchase_intent - mean_p))          # the run closest to the average speaks for the person
        out.append(PersonaResult(persona_id=p.id, name=p.name, profile=p.profile(), age=p.age, gender=p.gender, place=p.place, background=p.background, age_group=p.age_group,
                                 region=p.region, mindset=p.mindset, reaction=rep, runs=len(rs), purchase_mean=round(mean_p, 2), purchase_sd=round(stats.sd(pm), 2),
                                 share_mean=round(stats.mean(sm), 2), share_sd=round(stats.sd(sm), 2), emotion=_majority([x.emotion for x in rs], rep.emotion),
                                 comments=[x.comment for x in rs]))
        out[-1].reaction = rep.model_copy(update={"mood": _majority([x.mood for x in rs], rep.mood)})
    if not out:
        raise llm.gem.GeminiError("Gemini returned no persona reactions. Please try again in a moment.", 502)
    rp = []
    for d in by_run:
        if not d:
            continue
        v = list(d.values())
        rp.append(RunPanel(n=len(v), purchase=stats.mean([x.purchase_intent for x in v]), share=stats.mean([x.share_intent for x in v]), resonance=stats.mean([x.resonance for x in v]),
                           positive=100 * sum(x.mood == "Positive" for x in v) / len(v), negative=100 * sum(x.mood in ("Troll", "Angry") for x in v) / len(v)))
    return FocusGroup(out, rp, [d for d in by_run if d])
