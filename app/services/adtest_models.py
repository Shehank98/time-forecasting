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


class StaticReview(BaseModel):
    summary: str
    one_second_eye_catch: float = Field(ge=0, le=10, description="Would a feed scroller or newspaper reader notice and understand it within one second")
    scores: list[Score] = Field(description="Visual hierarchy, typography legibility, colour psychology, brand logo prominence, clutter (10 = clean, 0 = very cluttered)")
    headline_read: str = Field(default="", description="The headline and key text exactly as the model reads it from the image")
    fixes: list[Fix] = Field(default_factory=list)


class VideoReview(BaseModel):
    summary: str
    hook_strength_3s: float = Field(ge=0, le=10, description="How strongly the first three seconds stop a scroller")
    pacing: float = Field(ge=0, le=10)
    emotion_arc: str = ""
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
    notes: list[str] = Field(default_factory=list)


class PersonaReaction(BaseModel):
    gut_reaction: str = Field(description="One or two honest sentences of what this person thinks in the first moments")
    comment: str = Field(description="The exact comment they would post on Facebook or TikTok")
    comment_language: Literal["Sinhala", "Singlish", "English", "Tamil"] = "English"
    purchase_intent: int = Field(ge=1, le=10)
    share_intent: int = Field(ge=1, le=10)
    likes: str = ""
    concerns: str = ""


class PersonaResult(BaseModel):
    persona_id: str
    name: str
    profile: str
    reaction: PersonaReaction


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

    def text_block(self) -> str:
        rows = [("Brand", self.brand), ("Product or service", self.product), ("Headline", self.headline), ("Body copy or script", self.ad_copy),
                ("Target audience", self.audience), ("Campaign objective", self.objective), ("Market notes", self.market_notes)]
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


class AdTestResult(BaseModel):
    brief: AdBrief
    vision: VisionResult
    personas: list[PersonaResult]
    risk: CulturalRisk
    scorecard: Scorecard
    model: str = ""
    thumbnail: str = Field(default="", description="Small JPEG of the ad as a data URI, for the report")
    caveats: list[str] = Field(default_factory=list)
