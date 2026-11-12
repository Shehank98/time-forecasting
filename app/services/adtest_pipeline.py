"""Runs the three engines in order: vision, then the focus group, then the cultural audit, and builds the scorecard."""
from __future__ import annotations

import logging
import time
from typing import Callable

from . import adtest_llm as llm
from . import cultural_risk_engine as risk_engine
from . import persona_engine, vision_engine
from .adtest_models import AdBrief, AdTestResult

log = logging.getLogger(__name__)
Progress = Callable[[float, str], None]

CAVEATS = ["The personas and the comment wall are simulated by a language model. They show likely problems and let you compare versions of an ad. "
           "They are not real people and do not predict sales.",
           "Scores are the reviewer's judgement on a 0 to 10 scale, so compare versions of the same ad rather than reading one number as a fact."]


async def run(brief: AdBrief, data: bytes, filename: str, progress: Progress | None = None) -> AdTestResult:
    say = progress or (lambda p, m: None)
    t0 = time.perf_counter()
    say(0.05, "Reading the video frames" if brief.ad_type == "video" else "Reading the image")
    vision, thumb, media = await vision_engine.analyse(brief, data, filename)
    log.info("[adtest] vision done in %.1fs (%s, %d frames)", time.perf_counter() - t0, brief.ad_type, vision.frames_used)
    say(0.4, "Four Sri Lankan consumers are reacting to the ad")
    personas = await persona_engine.run_focus_group(brief, vision, media)
    say(0.7, "Checking language, culture and backlash risk")
    risk = await risk_engine.audit(brief, vision, personas, media)
    say(0.95, "Building the scorecard")
    card = risk_engine.make_scorecard(vision, personas, risk)
    log.info("[adtest] finished in %.1fs: risk=%s impact=%.0f hook=%.0f", time.perf_counter() - t0, risk.risk_level, vision.visual_impact, vision.hook_score)
    return AdTestResult(brief=brief, vision=vision, personas=personas, risk=risk, scorecard=card, model=llm.model_name(), thumbnail=thumb,
                        caveats=CAVEATS + vision.notes)
