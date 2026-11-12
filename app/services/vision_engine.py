"""Module 1: multimodal analysis of a video commercial (keyframes at 1 fps) or a static ad (Facebook, Instagram, press artwork).

Videos are decoded with OpenCV and sampled once a second; static ads go to Gemini as one high resolution image. Audio is not analysed:
the planner pastes the voice-over or script into the brief, and the report says so.
"""
from __future__ import annotations

import base64
import io
import logging
import os
import tempfile
from typing import Any

from . import adtest_llm as llm
from .adtest_models import AdBrief, StaticReview, VideoReview, VisionResult
from .gemini_client import GeminiError

log = logging.getLogger(__name__)

IMAGE_EXT = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}
VIDEO_EXT = {".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".m4v": "video/mp4"}
MAX_IMAGE_BYTES = int(os.environ.get("ADTEST_MAX_IMAGE_MB", "15")) * 1024 * 1024
MAX_VIDEO_BYTES = int(os.environ.get("ADTEST_MAX_VIDEO_MB", "80")) * 1024 * 1024
MAX_VIDEO_SECONDS = 180
MAX_FRAMES = 30            # a 30 second ad is one frame a second; longer ads are thinned (every frame costs input tokens)
FRAME_SIDE = 768
IMAGE_SIDE = 1536          # about four image tiles; more pixels cost more tokens without a better read of a layout


class AdFileError(ValueError):
    """The upload is not usable; the message is safe to show to the planner."""


def check_upload(ad_type: str, filename: str, data: bytes) -> str:
    """Return the mime type, or raise AdFileError."""
    ext = os.path.splitext(filename or "")[1].lower()
    table = VIDEO_EXT if ad_type == "video" else IMAGE_EXT
    if ext not in table:
        raise AdFileError(f"A {'video' if ad_type == 'video' else 'image'} ad needs a {', '.join(sorted(table))} file.")
    if not data:
        raise AdFileError("The file is empty.")
    limit = MAX_VIDEO_BYTES if ad_type == "video" else MAX_IMAGE_BYTES
    if len(data) > limit:
        raise AdFileError(f"The file is {len(data) / 1048576:.0f} MB. The limit is {limit // 1048576} MB.")
    return table[ext]


# ---------------------------------------------------------------- images
def prepare_image(data: bytes) -> tuple[bytes, str, tuple[int, int]]:
    """Fix rotation, drop transparency, cap the long side at 1536 px. Returns (jpeg or png bytes, mime, size)."""
    from PIL import Image, ImageOps, UnidentifiedImageError

    try:
        im = Image.open(io.BytesIO(data))
        im.load()
    except (UnidentifiedImageError, OSError) as exc:
        raise AdFileError("The image could not be opened. Export it again as JPG or PNG.") from exc
    im = ImageOps.exif_transpose(im)
    if im.mode not in ("RGB", "L"):
        bg = Image.new("RGB", im.size, (255, 255, 255))
        im = im.convert("RGBA")
        bg.paste(im, mask=im.split()[-1])
        im = bg
    elif im.mode == "L":
        im = im.convert("RGB")
    if max(im.size) > IMAGE_SIDE:
        im.thumbnail((IMAGE_SIDE, IMAGE_SIDE))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=92)
    return buf.getvalue(), "image/jpeg", im.size


def thumbnail_uri(jpeg: bytes, side: int = 640) -> str:
    from PIL import Image

    im = Image.open(io.BytesIO(jpeg)).convert("RGB")
    im.thumbnail((side, side))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=80)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


# ---------------------------------------------------------------- video
def extract_keyframes(data: bytes, suffix: str = ".mp4") -> tuple[list[tuple[int, bytes]], dict[str, Any]]:
    """One frame per second (evenly thinned to at most 48). Returns ([(second, jpeg)], {duration, fps, width, height, step})."""
    import cv2

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
        f.write(data)
        path = f.name
    try:
        cap = cv2.VideoCapture(path)
        if not cap.isOpened():
            raise AdFileError("The video could not be opened. Export it as H.264 MP4 and try again.")
        fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
        total = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0.0
        if fps <= 0 or total <= 0:
            raise AdFileError("The video has no readable frames.")
        duration = total / fps
        if duration > MAX_VIDEO_SECONDS:
            raise AdFileError(f"The video is {duration:.0f} seconds. Pre-launch tests take up to {MAX_VIDEO_SECONDS} seconds; cut it to the ad itself.")
        seconds = list(range(0, max(1, int(duration))))
        step = 1
        if len(seconds) > MAX_FRAMES:
            step = -(-len(seconds) // MAX_FRAMES)
            seconds = seconds[::step]
        frames: list[tuple[int, bytes]] = []
        w = h = 0
        for s in seconds:
            cap.set(cv2.CAP_PROP_POS_MSEC, (s + 0.5) * 1000.0 if duration > 1 else 0)   # the middle of each second, not the cut
            ok, frame = cap.read()
            if not ok or frame is None:
                continue
            h, w = frame.shape[:2]
            k = FRAME_SIDE / float(max(h, w))
            if k < 1:
                frame = cv2.resize(frame, (int(w * k), int(h * k)), interpolation=cv2.INTER_AREA)
            ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
            if ok:
                frames.append((s, buf.tobytes()))
        cap.release()
        if not frames:
            raise AdFileError("No frames could be read from the video.")
        return frames, {"duration": round(duration, 1), "fps": round(fps, 1), "width": w, "height": h, "step": step}
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


# ---------------------------------------------------------------- prompts
STATIC_SYSTEM = ("You are a senior creative director and eye-tracking analyst who reviews static ads for Sri Lankan audiences: Facebook and Instagram "
                 "single images and carousels, and newspaper or magazine press ads. Judge only what you can see in the image and the text supplied.")
VIDEO_SYSTEM = ("You are a senior creative director who reviews video commercials (TV, TikTok, Reels) for Sri Lankan audiences. You are given one frame per "
                "second, in order, each labelled with its second. Judge only what you can see in the frames and the script supplied. You cannot hear the audio.")


def _static_prompt(brief: AdBrief) -> str:
    return ("Review this static ad.\n<data>\n" + brief.text_block() + "\n</data>\n"
            "Score each of these from 0 to 10 and explain in one sentence each: Visual hierarchy, Typography legibility, Colour psychology, "
            "Brand logo prominence, Clutter (10 means clean, 0 means very cluttered). Also give the one-second eye-catch score: would a person scrolling a "
            "feed or turning a newspaper page notice it and understand the offer in one second. Copy the headline and key text exactly as you read it into "
            "headline_read. List concrete fixes in order of priority (layout, text size, colour, logo, copy). Keep each fix to one or two sentences.")


def _video_prompt(brief: AdBrief, meta: dict[str, Any], seconds: list[int]) -> str:
    every = "" if meta["step"] == 1 else f" (every {meta['step']} seconds)"
    return (f"Review this video commercial. It is {meta['duration']} seconds long; the frames shown are at seconds {seconds[0]} to {seconds[-1]}{every}.\n"
            "<data>\n" + brief.text_block() + "\n</data>\n"
            "Give: the 3-second hook strength (0 to 10), pacing (0 to 10), the emotional arc in one sentence, an attention value from 0 to 10 for each "
            "frame second in the timeline (10 means fully engaged, low means a viewer would leave or scroll), scores from 0 to 10 for Brand visibility, "
            "Message clarity, Emotional pull and Call to action, the moments where viewers are most likely to drop off, and prioritised fixes.")


def _visual_impact(scores: list[float]) -> float:
    return round(sum(scores) / len(scores) * 10, 1) if scores else 0.0


async def analyse(brief: AdBrief, data: bytes, filename: str) -> tuple[VisionResult, str, list[tuple[str, bytes]]]:
    """Returns (vision result, thumbnail data URI, a few labelled jpegs the persona and risk steps can look at). Raises AdFileError for a bad file and GeminiError if Gemini fails."""
    from google.genai import types

    check_upload(brief.ad_type, filename, data)
    if brief.ad_type == "static":
        img, m, size = prepare_image(data)
        thumb = thumbnail_uri(img)
        rev = await llm.generate_json([types.Part.from_bytes(data=img, mime_type=m), _static_prompt(brief)], StaticReview, STATIC_SYSTEM, temperature=0.3)
        impact = _visual_impact([s.value for s in rev.scores] + [rev.one_second_eye_catch])
        res = VisionResult(ad_type="static", visual_impact=impact, hook_score=round(rev.one_second_eye_catch * 10, 1), static=rev, frames_used=1,
                           notes=[f"Analysed one image of {size[0]} by {size[1]} pixels."])
        return res, thumb, [("The ad", img)]
    frames, meta = extract_keyframes(data, os.path.splitext(filename)[1].lower() or ".mp4")
    parts: list[Any] = []
    for sec, jpg in frames:
        parts.append(f"Frame at second {sec}:")
        parts.append(types.Part.from_bytes(data=jpg, mime_type="image/jpeg"))
    parts.append(_video_prompt(brief, meta, [s for s, _ in frames]))
    rev = await llm.generate_json(parts, VideoReview, VIDEO_SYSTEM, temperature=0.3)
    impact = _visual_impact([s.value for s in rev.scores] + [rev.hook_strength_3s, rev.pacing])
    notes = [f"Analysed {len(frames)} frames from a {meta['duration']} second video ({meta['width']} by {meta['height']} pixels).",
             "Audio was not analysed. The voice-over and music are judged only from the script you typed."]
    if meta["step"] > 1:
        notes.append(f"The video is long, so one frame every {meta['step']} seconds was used.")
    res = VisionResult(ad_type="video", visual_impact=impact, hook_score=round(rev.hook_strength_3s * 10, 1), video=rev, frames_used=len(frames), notes=notes)
    pick = sorted({round(i * (len(frames) - 1) / 5) for i in range(6)}) if len(frames) > 6 else list(range(len(frames)))
    return res, thumbnail_uri(frames[min(len(frames) - 1, 1)][1]), [(f"Frame at second {frames[i][0]}", frames[i][1]) for i in pick]


def light_media(media: list[tuple[str, bytes]], side: int = 768, max_items: int = 4) -> list[tuple[str, bytes]]:
    """A smaller copy of the pictures for the persona panel and the culture audit: one image tile each (258 tokens) and at most four frames."""
    from PIL import Image

    if len(media) > max_items:
        pick = sorted({round(i * (len(media) - 1) / (max_items - 1)) for i in range(max_items)})
        media = [media[i] for i in pick]
    out = []
    for label, jpg in media:
        im = Image.open(io.BytesIO(jpg)).convert("RGB")
        im.thumbnail((side, side))
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=80)
        out.append((label, buf.getvalue()))
    return out
