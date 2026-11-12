"""Module 2: a synthetic Sri Lankan focus group. Four consumer personas judge the same ad independently and at the same time.

These are simulated reactions from a language model, not real people. They are good for spotting problems and comparing versions of an ad,
not for predicting exact sales. The report says so.
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any

from . import adtest_llm as llm
from .adtest_models import AdBrief, PersonaReaction, PersonaResult, VisionResult

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Persona:
    id: str
    name: str
    profile: str
    voice: str


PERSONAS: tuple[Persona, ...] = (
    Persona("A", "Colombo Gen-Z student", "22, university student in Colombo. Heavy TikTok and Instagram user, meme-savvy.",
            "You are a 22 year old university student in Colombo. You live on TikTok and Instagram, scroll fast and decide in a second. You speak urban Singlish "
            "(English mixed with Sinhala words and slang), you love memes, and you are quick to roast an ad that feels cringe, fake or like it is trying too hard. "
            "You respect ads that are funny, real and visually sharp. Price matters to you, but status and vibe matter more."),
    Persona("B", "Suburban Kandy homemaker", "42, homemaker near Kandy. Budget-conscious, family and tradition first. Watches TV, uses Facebook.",
            "You are a 42 year old homemaker in a Kandy suburb. You run the household budget and think about family, health, tradition and value for money. "
            "You watch TV in the evening and read Facebook and WhatsApp forwards. You write mostly in Sinhala, sometimes with a few English words. "
            "You trust ads that look honest and respectful, and you are put off by anything that feels vulgar, disrespectful to elders or religion, or too expensive."),
    Persona("C", "Colombo corporate executive", "31, corporate executive in Colombo. Tech-savvy, time-poor, values premium quality.",
            "You are a 31 year old corporate executive in Colombo. You are tech-savvy, short of time and willing to pay for quality, but you notice weak design, "
            "vague claims and anything that looks cheap. You write in clear English, with a little Sinhala at times. You respond to clean design, a clear benefit "
            "and a brand that feels credible."),
    Persona("D", "Regional small business owner", "28, runs a small shop in Galle or Kurunegala. Practical, day-to-day mindset.",
            "You are a 28 year old small business owner in Galle (or Kurunegala). You are practical and think about daily costs, what your customers want and "
            "whether the product is really useful. You write in simple Sinhala or casual Singlish. You like straight talk, real situations you recognise, and "
            "clear prices or offers. You ignore ads that talk about a life that is not yours."),
)

COMMON = ("You are one member of a Sri Lankan focus group. React to the ad as this person really would, in your own voice, without being polite for the sake of it. "
          "Fill in the fields as follows. gut_reaction: what you think in the first moments, in English, one or two sentences. comment: the exact comment you would "
          "post under this ad on Facebook or TikTok, in the language you really use: Sinhala in Sinhala script, Singlish in English letters, or English. "
          "It can be short, blunt, funny or unkind if that is what you would write. comment_language: the language of that comment. purchase_intent and "
          "share_intent: whole numbers from 1 to 10 (1 means never, 10 means definitely). likes and concerns: one short sentence each.")


def _parts(brief: AdBrief, vision: VisionResult | None, media: list[tuple[str, bytes]]) -> list[Any]:
    from google.genai import types

    parts: list[Any] = []
    for label, jpg in media:
        parts.append(f"{label}:")
        parts.append(types.Part.from_bytes(data=jpg, mime_type="image/jpeg"))
    seen = ""
    if vision is not None:
        v = vision.static or vision.video
        seen = f"\nA creative reviewer's summary of what is in the ad: {v.summary}" if v is not None else ""
    kind = "a video commercial (you see sample frames)" if brief.ad_type == "video" else "a static ad"
    parts.append(f"The ad is {kind}.\n<data>\n{brief.text_block()}\n</data>{seen}\nReact now.")
    return parts


async def _one(p: Persona, brief: AdBrief, vision: VisionResult | None, media: list[tuple[str, bytes]]) -> PersonaResult:
    reaction = await llm.generate_json(_parts(brief, vision, media), PersonaReaction, f"{p.voice} {COMMON}", temperature=0.9, max_tokens=2048)
    return PersonaResult(persona_id=p.id, name=p.name, profile=p.profile, reaction=reaction)


async def run_focus_group(brief: AdBrief, vision: VisionResult | None = None, media: list[tuple[str, bytes]] | None = None) -> list[PersonaResult]:
    """All four personas at the same time. If one fails the whole step fails, so the planner never sees a partly filled group by accident."""
    media = media or []
    results = await asyncio.gather(*[_one(p, brief, vision, media) for p in PERSONAS])
    return list(results)
