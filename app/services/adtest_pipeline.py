"""Runs the three engines in order: vision, then the persona panel, then the cultural audit, and builds the scorecard.

Also holds the token savers that sit around the engines: a result cache (the same ad, copy, panel and models never pay twice) and a token estimate shown
before the run.
"""
from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
from collections import OrderedDict
from typing import Callable

from . import adtest_llm as llm
from . import cultural_risk_engine as risk_engine
from . import adtest_benchmarks, adtest_overlay, adtest_viability, adtest_weights, panel_stats, persona_bank, persona_engine, vision_engine
from .adtest_models import AdBrief, AdTestResult, PanelConfig, Usage

log = logging.getLogger(__name__)
Progress = Callable[[float, str], None]


class PanelError(ValueError):
    """The panel settings leave too few personas; the message is safe to show."""


CAVEATS = ["The personas and the comment wall are simulated by a language model. They show likely problems and let you compare versions of an ad. "
           "They are not real people and do not predict sales.",
           "Scores are the reviewer's judgement on a 0 to 10 scale, so compare versions of the same ad rather than reading one number as a fact."]


def choose_panel(cfg: PanelConfig) -> list[persona_bank.Persona]:
    pool = persona_bank.filter_bank(cfg.age_min, cfg.age_max, cfg.gender, cfg.region)
    if len(pool) < 4:
        raise PanelError("Those audience filters leave fewer than 4 personas. Widen the age range or remove a filter.")
    return persona_bank.select_panel(persona_bank.PANEL_SIZES[cfg.size], pool)


# ------------------------------------------------------------------ token estimate
def estimate_tokens(ad_type: str, panel_n: int, runs: int = 1) -> dict[str, int]:
    """A rough guide shown before the run (a real count is shown after it). Image tile = 258 tokens; a video is assumed to be 30 frames."""
    img_vision = 4 * 258 if ad_type == "static" else vision_engine.MAX_FRAMES * 258 + vision_engine.MAX_FRAMES * 8
    img_light = 258 if ad_type == "static" else 4 * 258
    vision_in, vision_out = img_vision + 1100, (2200 if ad_type == "video" else 1500)
    batches = -(-panel_n // persona_engine.BATCH)
    panel_in = runs * (batches * (img_light + 700) + panel_n * 70)
    panel_out = runs * panel_n * 110
    risk_in, risk_out = img_light + 1500, 2600
    i, o = vision_in + panel_in + risk_in, vision_out + panel_out + risk_out
    return {"input": i, "output": o, "total": i + o, "calls": 2 + runs * batches}


# ------------------------------------------------------------------ cache
CACHE: "OrderedDict[str, tuple[float, dict]]" = OrderedDict()
CACHE_LOCK = threading.Lock()
CACHE_SECONDS = 3600
CACHE_MAX = 24


def cache_key(brief: AdBrief, cfg: PanelConfig, data: bytes) -> str:
    h = hashlib.sha256()
    h.update(data)
    h.update(json.dumps([brief.model_dump(), cfg.model_dump(), llm.model_name(), llm.PRO if cfg.quality == "best" else llm.panel_model(), persona_engine.BATCH, len(persona_bank.BANK), "v3"], sort_keys=True).encode())
    return h.hexdigest()


def cache_get(key: str) -> dict | None:
    with CACHE_LOCK:
        hit = CACHE.get(key)
        if hit is None or time.time() - hit[0] > CACHE_SECONDS:
            CACHE.pop(key, None)
            return None
        CACHE.move_to_end(key)
        out = json.loads(json.dumps(hit[1]))
    out["usage"] = {**out.get("usage", {}), "cached": True}
    return out


def cache_put(key: str, result: dict) -> None:
    with CACHE_LOCK:
        CACHE[key] = (time.time(), result)
        while len(CACHE) > CACHE_MAX:
            CACHE.popitem(last=False)


# ------------------------------------------------------------------ the run
async def run(brief: AdBrief, data: bytes, filename: str, cfg: PanelConfig | None = None, progress: Progress | None = None) -> AdTestResult:
    cfg = cfg or PanelConfig()
    say = progress or (lambda p, m: None)
    panel = choose_panel(cfg)
    usage = llm.new_usage()
    llm.QUALITY.set(cfg.quality)
    t0 = time.perf_counter()
    say(0.05, "Reading the video frames" if brief.ad_type == "video" else "Reading the image")
    an = await vision_engine.analyse(brief, data, filename)
    vision = an.vision
    light = vision_engine.light_media(an.media)
    log.info("[adtest] vision done in %.1fs (%s, %d frames); panel of %d x %d runs", time.perf_counter() - t0, brief.ad_type, vision.frames_used, len(panel), cfg.runs)
    say(0.3, f"{len(panel)} Sri Lankan consumers are about to react" + (f", {cfg.runs} times each" if cfg.runs > 1 else ""))

    def tick(done: int, total: int) -> None:
        say(0.3 + 0.4 * done / max(1, total), f"{done} of {total} reactions collected")

    fg = await persona_engine.run_focus_group(brief, vision, light, panel, tick, cfg.runs)
    personas = fg.results
    say(0.72, "Checking language, culture and backlash risk")
    risk = await risk_engine.audit(brief, vision, personas, light)
    say(0.95, "Building the scorecard")
    card = risk_engine.make_scorecard(vision, personas, risk)
    present = [persona_bank.BY_ID[r.persona_id] for r in personas if r.persona_id in persona_bank.BY_ID]
    weights = adtest_weights.rake(present) if cfg.weighted else {}
    runs = persona_engine.weighted_runs(fg.per_run, weights) if fg.per_run else fg.runs
    note = ("Averages are weighted so the panel matches Sri Lanka's adults by gender, ethnic group, age and region (population shares in "
            "app/config/population_lk.json).") if weights else "Averages are not weighted: every persona counts the same."
    summary = panel_stats.summarise(personas, len(panel), runs, weights, note)
    card.avg_purchase_intent, card.avg_share_intent = summary.purchase, summary.share
    via = adtest_viability.compute(vision, summary.purchase, summary.share, card.backlash_risk, card.risk_level, brief.goal,
                                   [r.purchase for r in runs], [r.share for r in runs])
    zones = vision.zones
    try:
        heat = adtest_overlay.heatmap_uri(an.ref, zones) if zones else ""
    except Exception:  # noqa: BLE001
        log.exception("[adtest] heatmap could not be drawn")
        heat = ""
    caveats = CAVEATS + vision.notes
    if usage.get("fallback"):
        caveats.append(usage["fallback"])
    if len(personas) < len(panel):
        caveats.append(f"Gemini skipped {len(panel) - len(personas)} of {len(panel)} personas in at least one run, so those results use fewer people.")
    caveats.append(note + (f" The weighted panel is worth about {summary.effective_n:.0f} unweighted people." if weights else ""))
    if runs and len(runs) >= 2:
        caveats.append(f"The margin of error comes from {len(runs)} repeated runs of the simulated panel. It does not include any error in the image analysis.")
    log.info("[adtest] finished in %.1fs: risk=%s impact=%.0f hook=%.0f viability=%.1f tokens in=%d out=%d calls=%d", time.perf_counter() - t0, risk.risk_level,
             vision.visual_impact, vision.hook_score, via.score, usage["input_tokens"], usage["output_tokens"], usage["calls"])
    res = AdTestResult(brief=brief, vision=vision, personas=personas, risk=risk, scorecard=card, panel=summary, viability=via, usage=Usage(**{k: v for k, v in usage.items() if k in ('input_tokens', 'output_tokens', 'calls')}), thumbnail=an.thumb, heatmap=heat,
                       model=f"{llm.model_name()} (ad), {llm.panel_model()} (panel)", caveats=caveats)
    adtest_benchmarks.attach(res)
    return res
