"""Compare the predicted metrics with the typical bands in app/config/ad_benchmarks.json (indicative, editable) and build the prioritised action list."""
from __future__ import annotations

from .adtest_models import (AdTestResult, BenchmarkCheck, CulturalRisk, PanelSummary, Placement, Recommendation, Scorecard, VisionResult)
from .adtest_viability import _config

RANK = {"High": 0, "Medium": 1, "Low": 2}


def metric_values(vision: VisionResult, panel: PanelSummary | None, card: Scorecard) -> dict[str, float]:
    rev = vision.static or vision.video
    v = {"hook": vision.hook_score, "readability": getattr(rev, "readability", 50.0), "cleanliness": getattr(rev, "cleanliness", 50.0),
         "purchase": (panel.purchase if panel else card.avg_purchase_intent) * 10, "share": (panel.share if panel else card.avg_share_intent) * 10, "backlash": card.backlash_risk}
    if vision.video:
        v["pacing"] = vision.video.pacing * 10
    return v


def compare(vision: VisionResult, panel: PanelSummary | None, card: Scorecard) -> tuple[list[BenchmarkCheck], str]:
    cfg, vals, out = _config(), metric_values(vision, panel, card), []
    for m in cfg["video" if vision.ad_type == "video" else "static"]:
        if m["key"] not in vals:
            continue
        v, (lo, hi), better = float(vals[m["key"]]), m["typical"], m.get("higher_is_better", True)
        if better:
            verdict = "Strong" if v > hi else "Typical" if v >= lo else "Below typical"
        else:
            verdict = "Strong" if v < lo else "Typical" if v <= hi else "Below typical"
        out.append(BenchmarkCheck(key=m["key"], label=m["label"], value=round(v, 1), typical_low=lo, typical_high=hi, higher_is_better=better, verdict=verdict, reference=m.get("reference", "")))
    return out, cfg.get("note", "")


def recommendations(vision: VisionResult, risk: CulturalRisk, panel: PanelSummary | None, checks: list[BenchmarkCheck]) -> list[Recommendation]:
    recs: list[Recommendation] = []
    seen: set[str] = set()

    def add(priority: str, area: str, action: str, why: str = "") -> None:
        key = action.lower()[:60]
        if key not in seen:
            seen.add(key)
            recs.append(Recommendation(priority=priority, area=area, action=action, why=why))

    for p in vision.placements:
        if p.verdict == "Weak" or p.area_pct < 2:
            add("High" if p.kind in ("logo", "cta", "hook") and p.verdict == "Weak" else "Medium", "Layout", p.advice, f"{p.kind} placement")
    rev = vision.static or vision.video
    for f in (rev.fixes if rev else []):
        add(f.priority, "Creative", f"{f.problem}: {f.fix}")
    for f in risk.flags:
        pr = "High" if f.severity in ("High", "Critical") else "Medium" if f.severity == "Medium" else "Low"
        add(pr, f"Language and culture ({f.category})", f"Change \"{f.where}\": {f.suggestion or f.issue}", f.issue)
    for x in risk.fixes:
        add("High" if risk.risk_level in ("High", "Critical") else "Medium", "Language and culture", x)
    for c in checks:
        if c.verdict == "Below typical":
            add("Medium", "Benchmark", f"{c.label} is {c.value:.0f}, below the typical {c.typical_low:.0f} to {c.typical_high:.0f}." if c.higher_is_better
                else f"{c.label} is {c.value:.0f}, above the typical {c.typical_low:.0f} to {c.typical_high:.0f}.", c.reference)
    if panel:
        for c in panel.concerns[:2]:
            add("Medium", "Audience", f"Answer the common worry \"{c.text}\" ({c.count} people).")
        for s in panel.segments:
            if s.n >= 3 and s.negative >= 40:
                add("High", "Audience", f"Test with {s.label} ({s.kind}) before launch: {s.negative:.0f}% of that group mocked it or got angry.")
    recs.sort(key=lambda r: RANK[r.priority])
    return recs[:14]


def attach(res: AdTestResult) -> None:
    res.benchmarks, res.benchmark_note = compare(res.vision, res.panel, res.scorecard)
    res.recommendations = recommendations(res.vision, res.risk, res.panel, res.benchmarks)
