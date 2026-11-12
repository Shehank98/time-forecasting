"""Module 3: Sri Lankan cultural, language and backlash audit, plus a simulated comment wall.

One structured Gemini call reads the ad (image or frames), the headline and copy, and the persona comments, and returns the predicted reaction split,
a risk level, specific flags with fixes, and a crowd of sample comments in Sinhala, Singlish and English. All of this is a model judgement, not a measurement.
"""
from __future__ import annotations

import logging
from typing import Any

from . import adtest_llm as llm
from .adtest_models import AdBrief, CulturalRisk, PersonaResult, Scorecard, VisionResult

log = logging.getLogger(__name__)

SYSTEM = ("You are a Sri Lankan cultural strategist and PR risk analyst who audits ads in Sinhala, Tamil, Singlish and English before launch. "
          "You know local social media: how Facebook comment sections and TikTok behave, what gets turned into a meme, and what causes a boycott or a complaint.")

CHAIN = (
    "Work through this audit in order and put the results in the fields.\n"
    "1. Linguistic nuance: look for unintended double meanings, awkward literal translations, slang that changes meaning by region, and words that sound "
    "like something rude in Sinhala (the kind of line with two sides, දෙපැත්ත කැපෙන වචන), Singlish or Tamil. Add one flag per problem with category Linguistic.\n"
    "2. Cultural and social triggers: religion (Buddhist, Hindu, Muslim, Christian symbols, dress, temples, poya days), economic sensitivity (cost of living, "
    "showing luxury or waste during hardship), gender and family roles, ethnic or regional stereotypes, and national symbols. One flag per problem, with the category.\n"
    "3. Meme and trolling potential: could this headline, face, pose or visual be turned into a negative meme? Give meme_potential from 0 to 10 and say how it "
    "would be done in meme_note.\n"
    "4. Predicted reaction split across a public Facebook or TikTok comment section: positive (hearts and praise), neutral, troll (haha reactions and mocking), "
    "angry (backlash). Give four numbers that add up to about 100.\n"
    "5. risk_level: Low, Medium, High or Critical. Critical only if there is a real chance of a boycott, a formal complaint or a news story.\n"
    "6. fixes: specific changes to the headline, wording or visual, each in one or two sentences. Quote the original words and give the replacement.\n"
    "7. crowd_comments: 12 realistic comments from different people, mixed across Sinhala in Sinhala script, Singlish and English, with a fair mix of "
    "reactions matching your split. Short, like real comments. Set each comment's reaction to Positive, Neutral, Troll or Angry.")


def _parts(brief: AdBrief, vision: VisionResult, personas: list[PersonaResult], media: list[tuple[str, bytes]]) -> list[Any]:
    from google.genai import types

    parts: list[Any] = []
    for label, jpg in media:
        parts.append(f"{label}:")
        parts.append(types.Part.from_bytes(data=jpg, mime_type="image/jpeg"))
    heard = "\n".join(f"- {p.name}, {p.age}, {p.background} ({p.reaction.mood}, {p.reaction.comment_language}): {p.reaction.comment}" for p in sample_comments(personas))
    rev = vision.static or vision.video
    parts.append(f"Audit this {'video commercial (sample frames)' if brief.ad_type == 'video' else 'static ad'}.\n<data>\n{brief.text_block()}\n</data>\n"
                 f"What the creative reviewer saw: {rev.summary if rev else 'n/a'}\nA sample of comments from a larger simulated focus group:\n<data>\n{heard}\n</data>\n{CHAIN}")
    return parts


def sample_comments(personas: list[PersonaResult], n: int = 12) -> list[PersonaResult]:
    """Not every comment goes to the audit (that would cost tokens for no gain): the angriest and most mocking, then the most positive, then neutral ones."""
    order = {"Angry": 0, "Troll": 1, "Positive": 2, "Neutral": 3}
    by = sorted(personas, key=lambda p: (order[p.reaction.mood], p.reaction.purchase_intent, p.persona_id))
    picked, per = [], {"Angry": 4, "Troll": 3, "Positive": 3, "Neutral": 2}
    for mood, k in per.items():
        picked += [p for p in by if p.reaction.mood == mood][:k]
    rest = [p for p in by if p not in picked]
    return (picked + rest)[:n]


async def audit(brief: AdBrief, vision: VisionResult, personas: list[PersonaResult], media: list[tuple[str, bytes]] | None = None) -> CulturalRisk:
    return await llm.generate_json(_parts(brief, vision, personas, media or []), CulturalRisk, SYSTEM, temperature=0.6, max_tokens=8192,
                                   model=llm.panel_model(), thinking=1024)


LEVEL_BASE = {"Low": 10, "Medium": 35, "High": 65, "Critical": 90}


def backlash_score(risk: CulturalRisk) -> float:
    """0 to 100. The level sets the base; the angry and troll share and the meme chance move it within the band."""
    s = risk.reaction_split
    lift = (s.angry * 0.35 + s.troll * 0.2 + risk.meme_potential * 1.5) * 0.5
    return round(max(0.0, min(100.0, LEVEL_BASE[risk.risk_level] + lift - 8)), 1)


def make_scorecard(vision: VisionResult, personas: list[PersonaResult], risk: CulturalRisk) -> Scorecard:
    n = max(1, len(personas))
    pi = round(sum(p.reaction.purchase_intent for p in personas) / n, 1)
    si = round(sum(p.reaction.share_intent for p in personas) / n, 1)
    bl = backlash_score(risk)
    if risk.risk_level in ("High", "Critical") or bl >= 65:
        verdict, tone = "Fix before launch: the backlash risk is high.", "bad"
    elif vision.visual_impact < 55 or vision.hook_score < 50 or pi < 4:
        verdict, tone = "Needs work: the ad is safe but will not stop people or move them to act.", "warn"
    elif bl >= 35:
        verdict, tone = "Good, with a few risks to fix first.", "warn"
    else:
        verdict, tone = "Ready to launch. Apply the small fixes if you have time.", "good"
    return Scorecard(visual_impact=vision.visual_impact, hook_score=vision.hook_score, backlash_risk=bl, risk_level=risk.risk_level,
                     avg_purchase_intent=pi, avg_share_intent=si, verdict=verdict, verdict_tone=tone)
