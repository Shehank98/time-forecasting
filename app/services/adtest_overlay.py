"""Draws the attention zones on the ad for the client report: a soft heat glow on the eye path and a labelled box on each zone."""
from __future__ import annotations

import base64
import io

from .adtest_models import Zone

COLORS = {"hook": (255, 176, 32), "logo": (61, 224, 255), "cta": (34, 197, 94), "headline": (168, 85, 247), "price": (255, 79, 216), "product": (96, 165, 250), "face": (251, 146, 60), "other": (148, 163, 184)}
HEAT = {1: 1.0, 2: 0.7, 3: 0.5}


def heatmap_uri(jpeg: bytes, zones: list[Zone], side: int = 820) -> str:
    from PIL import Image, ImageDraw, ImageFilter

    im = Image.open(io.BytesIO(jpeg)).convert("RGB")
    im.thumbnail((side, side))
    w, h = im.size
    heat = Image.new("L", (w, h), 0)
    hd = ImageDraw.Draw(heat)
    for z in zones:
        if z.order in HEAT:
            y0, x0, y1, x1 = z.box
            hd.ellipse([x0 * w, y0 * h, x1 * w, y1 * h], fill=int(255 * HEAT[z.order]))
    heat = heat.filter(ImageFilter.GaussianBlur(max(8, min(w, h) // 14)))
    red = Image.new("RGB", (w, h), (255, 60, 40))
    base = Image.composite(red, im, heat.point(lambda v: int(v * 0.55)))
    d = ImageDraw.Draw(base)
    for z in zones:
        y0, x0, y1, x1 = z.box
        c = COLORS.get(z.kind, COLORS["other"])
        d.rectangle([x0 * w, y0 * h, x1 * w, y1 * h], outline=c, width=3)
        tag = f"{z.order or '-'} {z.kind}"
        tw = 7 * len(tag) + 8
        ty = max(0, y0 * h - 16)
        d.rectangle([x0 * w, ty, x0 * w + tw, ty + 16], fill=c)
        d.text((x0 * w + 4, ty + 2), tag, fill=(0, 0, 0))
    buf = io.BytesIO()
    base.save(buf, "JPEG", quality=85)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
