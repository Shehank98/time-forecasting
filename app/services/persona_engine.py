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

from . import adtest_llm as llm
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
          "complain), and concern (their main worry in under 8 words, empty if none). Return one entry per person, in the order listed, and no others.")


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


async def _batch(people: list[Persona], brief: AdBrief, vision: VisionResult | None, media: list[tuple[str, bytes]]) -> dict[str, Any]:
    got: dict[str, Any] = {}
    want = list(people)
    for attempt in range(2):          # a second try asks only for the people the first answer missed
        out = await llm.generate_json(_parts(brief, vision, media, want), PanelBatch, SYSTEM, temperature=0.9, model=llm.panel_model(), thinking=0,
                                      max_tokens=min(16000, 400 + 190 * len(want)))
        ids = {p.id for p in want}
        for r in out.reactions:
            if r.id in ids and r.id not in got:
                got[r.id] = r
        want = [p for p in people if p.id not in got]
        if not want:
            break
        log.warning("[adtest] batch missed %d of %d personas (attempt %d)", len(want), len(people), attempt + 1)
    return got


async def run_focus_group(brief: AdBrief, vision: VisionResult | None, media: list[tuple[str, bytes]], panel: list[Persona],
                          progress: Callable[[int, int], None] | None = None) -> list[PersonaResult]:
    """The whole panel in batches of up to 25, up to four batches at once. Personas the model still skipped are left out and counted in the summary."""
    batches = [panel[i:i + BATCH] for i in range(0, len(panel), BATCH)]
    sem, done = asyncio.Semaphore(PARALLEL), [0]

    async def one(people: list[Persona]) -> dict[str, Any]:
        async with sem:
            got = await _batch(people, brief, vision, media)
            done[0] += len(people)
            if progress:
                progress(done[0], len(panel))
            return got

    parts = await asyncio.gather(*[one(b) for b in batches])
    reactions = {k: v for d in parts for k, v in d.items()}
    out = []
    for p in panel:
        r = reactions.get(p.id)
        if r is None:
            continue
        out.append(PersonaResult(persona_id=p.id, name=p.name, profile=p.profile(), age=p.age, gender=p.gender, place=p.place, background=p.background,
                                 age_group=p.age_group, region=p.region, mindset=p.mindset, reaction=r))
    if not out:
        raise llm.gem.GeminiError("Gemini returned no persona reactions. Please try again in a moment.", 502)
    return out
