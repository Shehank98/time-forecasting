"""Pydantic models for the Pre-Launch Ad Test card. Every Gemini answer is parsed into one of these, so a malformed answer is retried or rejected, never shown."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

AdType = Literal["video", "static"]
RiskLevel = Literal["Low", "Medium", "High", "Critical"]
Reaction = Literal["Positive", "Neutral", "Troll", "Angry"]


class Score(BaseModel):
    name: str
    value: float = Field(ge=0, le=10)
    why: str = ""


class Fix(BaseModel):
    priority: Literal["High", "Medium", "Low"] = "Medium"
    problem: str
    fix: str


class SecondPoint(BaseModel):
    second: int = Field(ge=0)
    attention: float = Field(ge=0, le=10, description="Expected viewer attention at this second, 10 = fully engaged")
    note: str = ""


ZoneKind = Literal["hook", "logo", "cta", "headline", "product", "face", "price", "other"]


class ZoneIn(BaseModel):
    """A zone as Gemini reports it: box = [ymin, xmin, ymax, xmax] on a 0 to 1000 grid."""
    kind: ZoneKind
    label: str = ""
    box: list[float] = Field(min_length=4, max_length=4)
    order: int = Field(default=0, ge=0, le=9, description="1 = where the eye lands first, 2 = second, 0 = not part of the eye path")
    note: str = ""

    @field_validator("box")
    @classmethod
    def sane(cls, v: list[float]) -> list[float]:
        b = [max(0.0, min(1000.0, float(a))) for a in v]
        if b[2] < b[0]:
            b[0], b[2] = b[2], b[0]
        if b[3] < b[1]:
            b[1], b[3] = b[3], b[1]
        if (b[2] - b[0]) < 5 or (b[3] - b[1]) < 5:
            raise ValueError("box is too small")
        return b


class Zone(BaseModel):
    """The same zone as fractions of the image, 0 to 1: box = [ymin, xmin, ymax, xmax]."""
    kind: ZoneKind
    label: str = ""
    box: list[float] = Field(min_length=4, max_length=4)
    order: int = 0
    note: str = ""


def to_zones(items: list[ZoneIn]) -> list[Zone]:
    return [Zone(kind=z.kind, label=z.label, box=[round(a / 1000.0, 4) for a in z.box], order=z.order, note=z.note) for z in items]


def _lenient_zones(v):
    """One badly drawn box should not throw away the whole answer: keep the zones that validate."""
    out = []
    for z in v or []:
        try:
            out.append(ZoneIn.model_validate(z) if not isinstance(z, ZoneIn) else z)
        except ValueError:
            continue
    return out


class Placement(BaseModel):
    """Worked out in code from a zone, so the advice does not depend on Gemini's opinion of its own box."""
    kind: ZoneKind
    label: str
    area_pct: float
    attention_prior: float = Field(description="0 to 1: how much attention that part of the frame usually gets")
    verdict: Literal["Strong", "OK", "Weak"]
    advice: str


class StaticReview(BaseModel):
    summary: str
    one_second_eye_catch: float = Field(ge=0, le=10, description="Would a feed scroller or newspaper reader notice and understand it within one second")
    scores: list[Score] = Field(description="Visual hierarchy, typography legibility, colour psychology, brand logo prominence, clutter (10 = clean, 0 = very cluttered)")
    headline_read: str = Field(default="", description="The headline and key text exactly as the model reads it from the image")
    first_glance: str = Field(default="", description="What the eye sees first, second and third in the first second, in one or two sentences")
    readability: float = Field(default=50, ge=0, le=100, description="Text size, contrast against the background and line length, 0 to 100")
    cleanliness: float = Field(default=50, ge=0, le=100, description="Layout cleanliness: 100 is clean and focused, 0 is cluttered")
    zones: list[ZoneIn] = Field(default_factory=list, description="Primary hook, brand logo, call to action and other key elements with their boxes")

    _z = field_validator("zones", mode="before")(_lenient_zones)
    fixes: list[Fix] = Field(default_factory=list)


class VideoReview(BaseModel):
    summary: str
    hook_strength_3s: float = Field(ge=0, le=10, description="How strongly the first three seconds stop a scroller")
    pacing: float = Field(ge=0, le=10)
    emotion_arc: str = ""
    first_glance: str = ""
    readability: float = Field(default=50, ge=0, le=100, description="On-screen text size and contrast, 0 to 100")
    cleanliness: float = Field(default=50, ge=0, le=100, description="Frame cleanliness: 100 is clean and focused, 0 is cluttered")
    zones: list[ZoneIn] = Field(default_factory=list, description="Hook, logo and call to action in the reference frame (the frame at second 1)")

    _z = field_validator("zones", mode="before")(_lenient_zones)
    timeline: list[SecondPoint] = Field(default_factory=list, description="Attention per second, from the sampled frames")
    scores: list[Score] = Field(default_factory=list, description="Brand visibility, clarity of message, emotional pull, call to action")
    drop_off_risks: list[str] = Field(default_factory=list)
    fixes: list[Fix] = Field(default_factory=list)


class VisionResult(BaseModel):
    ad_type: AdType
    visual_impact: float = Field(ge=0, le=100)
    hook_score: float = Field(ge=0, le=100)
    static: StaticReview | None = None
    video: VideoReview | None = None
    frames_used: int = 0
    zones: list[Zone] = Field(default_factory=list, description="The attention zones as fractions of the image, for the overlay")
    placements: list[Placement] = Field(default_factory=list)
    prior_grid: list[list[float]] = Field(default_factory=list, description="Usual attention by part of the frame, for the blind-spot view")
    stimulation: list[float] = Field(default_factory=list, description="Measured visual change per sampled second, 0 to 10, from the pixels")
    drop_offs: list[int] = Field(default_factory=list, description="Seconds where attention falls sharply")
    notes: list[str] = Field(default_factory=list)


Emotion = Literal["Joy", "Trust", "Pride", "Humour", "Curiosity", "Indifference", "Distrust", "Offence"]


class PersonaReaction(BaseModel):
    gut_reaction: str = Field(description="What this person thinks in the first moments, under 20 words")
    comment: str = Field(description="The exact comment they would post on Facebook or TikTok, under 25 words")
    comment_language: Literal["Sinhala", "Singlish", "English", "Tamil"] = "English"
    purchase_intent: int = Field(ge=1, le=10)
    share_intent: int = Field(ge=1, le=10)
    mood: Reaction = Field(default="Neutral", description="Positive, Neutral, Troll (mocking) or Angry (backlash)")
    emotion: Emotion = Field(default="Indifference", description="The main feeling the ad gives this person")
    resonance: int = Field(default=5, ge=1, le=10, description="How strongly the ad moves them emotionally, 1 to 10")
    concern: str = Field(default="", description="Their main worry or dislike in under 8 words, empty if none")


class PanelReaction(PersonaReaction):
    id: str


class PanelBatch(BaseModel):
    reactions: list[PanelReaction]


class PersonaResult(BaseModel):
    persona_id: str
    name: str
    profile: str
    age: int = 0
    gender: str = ""
    place: str = ""
    background: str = ""
    age_group: str = ""
    region: str = ""
    mindset: str = ""
    reaction: PersonaReaction
    runs: int = 1
    purchase_mean: float = 0.0
    purchase_sd: float = 0.0
    share_mean: float = 0.0
    share_sd: float = 0.0
    emotion: str = ""
    comments: list[str] = Field(default_factory=list, description="The comment from each run, so the wall shows several voices")


class Interval(BaseModel):
    mean: float
    sd: float = Field(description="Standard deviation between runs")
    margin: float | None = Field(default=None, description="95 percent margin of error from the runs; None when only one run was made")
    low: float
    high: float
    runs: int


class EmotionShare(BaseModel):
    emotion: str
    percent: float


class Segment(BaseModel):
    kind: str
    label: str
    n: int
    purchase: float
    share: float
    positive: float = Field(description="Percent of the segment whose mood is Positive")
    negative: float = Field(description="Percent whose mood is Troll or Angry")


class Concern(BaseModel):
    text: str
    count: int


class PanelSummary(BaseModel):
    size: int
    requested: int
    purchase: float
    share: float
    positive: float
    neutral: float
    troll: float
    angry: float
    segments: list[Segment] = Field(default_factory=list)
    concerns: list[Concern] = Field(default_factory=list)
    most_positive: list[str] = Field(default_factory=list)
    most_negative: list[str] = Field(default_factory=list)
    runs: int = 1
    purchase_ci: Interval | None = None
    share_ci: Interval | None = None
    resonance: float = 0.0
    emotions: list[EmotionShare] = Field(default_factory=list)
    run_means: list[float] = Field(default_factory=list, description="Panel mean purchase intent in each run")
    weighted: bool = False
    effective_n: float = 0.0
    purchase_raw: float = 0.0
    share_raw: float = 0.0
    weight_note: str = ""


class Usage(BaseModel):
    input_tokens: int = 0
    output_tokens: int = 0
    calls: int = 0
    cached: bool = False


class PanelConfig(BaseModel):
    size: Literal["quick", "standard", "full", "complete"] = "quick"
    age_min: int = Field(default=0, ge=0, le=120)
    age_max: int = Field(default=120, ge=0, le=120)
    gender: Literal["", "F", "M"] = ""
    region: str = ""
    runs: int = Field(default=3, ge=1, le=5, description="Monte Carlo runs of the whole panel; 2 or more gives margins of error")
    weighted: bool = True      # weight the panel to the Sri Lankan population (gender, ethnic group, age, region)
    quality: Literal["standard", "best"] = "standard"      # best: Gemini 2.5 Pro for every step


class Flag(BaseModel):
    where: str = Field(description="The words or visual element concerned")
    issue: str
    suggestion: str = ""
    category: Literal["Linguistic", "Religious", "Economic", "Gender", "Social", "Meme", "Other"] = "Other"
    severity: RiskLevel = "Low"


class CrowdComment(BaseModel):
    text: str
    language: Literal["Sinhala", "Singlish", "English", "Tamil"] = "English"
    reaction: Reaction = "Neutral"


class ReactionSplit(BaseModel):
    positive: float = Field(ge=0)
    neutral: float = Field(ge=0)
    troll: float = Field(ge=0)
    angry: float = Field(ge=0)

    @model_validator(mode="after")
    def to_hundred(self) -> "ReactionSplit":
        t = self.positive + self.neutral + self.troll + self.angry
        if t <= 0:
            self.neutral = 100.0
            return self
        for k in ("positive", "neutral", "troll", "angry"):
            setattr(self, k, round(getattr(self, k) * 100.0 / t, 1))
        return self


class CulturalRisk(BaseModel):
    risk_level: RiskLevel
    risk_summary: str
    reaction_split: ReactionSplit
    meme_potential: float = Field(ge=0, le=10)
    meme_note: str = ""
    flags: list[Flag] = Field(default_factory=list)
    fixes: list[str] = Field(default_factory=list)
    crowd_comments: list[CrowdComment] = Field(default_factory=list)

    @field_validator("crowd_comments")
    @classmethod
    def cap_comments(cls, v: list[CrowdComment]) -> list[CrowdComment]:
        return v[:20]


class AdBrief(BaseModel):
    """What the planner typed in next to the file."""
    ad_type: AdType
    brand: str = ""
    product: str = ""
    headline: str = ""
    ad_copy: str = Field(default="", description="Body copy, voice-over or script")
    audience: str = ""
    objective: str = ""
    market_notes: str = ""
    category: str = ""
    goal: Literal["", "awareness", "consideration", "conversion", "leads", "installs"] = ""

    def text_block(self) -> str:
        rows = [("Brand", self.brand), ("Product or service", self.product), ("Headline", self.headline), ("Body copy or script", self.ad_copy),
                ("Brand category", self.category), ("Campaign goal", self.goal), ("Target audience", self.audience), ("Campaign objective", self.objective),
                ("Market notes", self.market_notes)]
        return "\n".join(f"{k}: {v.strip()}" for k, v in rows if v and v.strip()) or "No text was supplied."


class Scorecard(BaseModel):
    visual_impact: float
    hook_score: float
    backlash_risk: float = Field(description="0 to 100, higher is worse")
    risk_level: RiskLevel
    avg_purchase_intent: float
    avg_share_intent: float
    verdict: str
    verdict_tone: Literal["good", "warn", "bad"]


class Viability(BaseModel):
    score: float
    low: float | None = None
    high: float | None = None
    margin: float | None = None
    runs: int = 1
    goal: str = "consideration"
    weights: dict[str, float] = Field(default_factory=dict)
    parts: dict[str, float] = Field(default_factory=dict, description="Each ingredient on a 0 to 100 scale before weighting")
    label: Literal["Launch", "Launch after fixes", "Rework", "Do not launch"] = "Rework"


class BenchmarkCheck(BaseModel):
    key: str
    label: str
    value: float
    typical_low: float
    typical_high: float
    higher_is_better: bool = True
    verdict: Literal["Strong", "Typical", "Below typical"]
    reference: str = ""


class Recommendation(BaseModel):
    priority: Literal["High", "Medium", "Low"]
    area: str
    action: str
    why: str = ""


class AdTestResult(BaseModel):
    brief: AdBrief
    vision: VisionResult
    personas: list[PersonaResult]
    risk: CulturalRisk
    scorecard: Scorecard
    model: str = ""
    panel: PanelSummary | None = None
    viability: Viability | None = None
    benchmarks: list[BenchmarkCheck] = Field(default_factory=list)
    benchmark_note: str = ""
    recommendations: list[Recommendation] = Field(default_factory=list)
    usage: Usage = Field(default_factory=Usage)
    thumbnail: str = Field(default="", description="Small JPEG of the ad as a data URI, for the report")
    heatmap: str = Field(default="", description="The ad with attention zones drawn on it, as a data URI, for the report")
    caveats: list[str] = Field(default_factory=list)
