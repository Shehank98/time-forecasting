"""A self-contained HTML audit report. HTML (not PDF) so Sinhala text shows correctly; the planner can print it to PDF from the browser."""
from __future__ import annotations

from datetime import date
from html import escape as e

from .adtest_models import AdTestResult

CSS = """
body{font:15px/1.5 system-ui,-apple-system,'Segoe UI','Noto Sans Sinhala',sans-serif;color:#17212b;max-width:960px;margin:24px auto;padding:0 18px}
h1{font-size:26px;margin:0 0 4px} h2{font-size:18px;margin:28px 0 8px;border-bottom:2px solid #e3e8ef;padding-bottom:4px} h3{font-size:15px;margin:14px 0 4px}
.muted{color:#5b6877}.small{font-size:13px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.tile{border:1px solid #dfe5ec;border-radius:10px;padding:10px 12px}.tile b{display:block;font-size:24px}.tile span{font-size:12px;color:#5b6877;text-transform:uppercase;letter-spacing:.06em}
.good{color:#0f7b3f}.warn{color:#a15c00}.bad{color:#b3261e}
.verdict{border-left:5px solid;padding:8px 12px;margin:14px 0;border-radius:6px;background:#f6f8fb;font-weight:600}
.verdict.good{border-color:#0f7b3f}.verdict.warn{border-color:#d98a00}.verdict.bad{border-color:#b3261e}
table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #e3e8ef;padding:6px 8px;text-align:left;vertical-align:top;font-size:14px}th{background:#f6f8fb}
.cols{display:grid;grid-template-columns:260px 1fr;gap:18px}.cols img{width:100%;border-radius:8px;border:1px solid #dfe5ec}
.bar{height:10px;border-radius:5px;background:#e3e8ef;overflow:hidden}.bar i{display:block;height:100%;background:#2563eb}
.cmt{border:1px solid #dfe5ec;border-radius:10px;padding:8px 10px;margin:6px 0}.cmt small{color:#5b6877}
@media print{body{margin:0}.cols{grid-template-columns:200px 1fr}}
@media(max-width:640px){.cols{grid-template-columns:1fr}}
"""


def _bar(v: float, top: float = 10) -> str:
    return f'<div class="bar"><i style="width:{max(0, min(100, v / top * 100)):.0f}%"></i></div>'


def _fixes(items) -> str:
    return "".join(f"<tr><td>{e(f.priority)}</td><td>{e(f.problem)}</td><td>{e(f.fix)}</td></tr>" for f in items)


def build_html(r: AdTestResult) -> str:
    b, v, c, k = r.brief, r.vision, r.risk, r.scorecard
    tone = {"good": "good", "warn": "warn", "bad": "bad"}[k.verdict_tone]
    rev = v.static or v.video
    scores = "".join(f"<tr><td>{e(s.name)}</td><td>{s.value:.1f} / 10{_bar(s.value)}</td><td>{e(s.why)}</td></tr>" for s in (rev.scores if rev else []))
    extra = ""
    if v.video:
        extra = (f"<p><b>3 second hook:</b> {v.video.hook_strength_3s:.1f} / 10. <b>Pacing:</b> {v.video.pacing:.1f} / 10. {e(v.video.emotion_arc)}</p>"
                 + ("<h3>Attention second by second</h3><table><tr><th>Second</th><th>Attention</th><th>Note</th></tr>"
                    + "".join(f"<tr><td>{p.second}</td><td>{p.attention:.1f}{_bar(p.attention)}</td><td>{e(p.note)}</td></tr>" for p in v.video.timeline) + "</table>" if v.video.timeline else "")
                 + ("<h3>Where viewers may drop off</h3><ul>" + "".join(f"<li>{e(x)}</li>" for x in v.video.drop_off_risks) + "</ul>" if v.video.drop_off_risks else ""))
    if v.static:
        extra = f"<p><b>One second eye-catch:</b> {v.static.one_second_eye_catch:.1f} / 10. <b>Headline as read:</b> {e(v.static.headline_read)}</p>"
    fixes = _fixes(rev.fixes if rev else [])
    personas = "".join(
        f'<div class="cmt"><b>{e(p.name)}</b> <small>{e(p.profile)}</small><br><i>{e(p.reaction.gut_reaction)}</i>'
        f'<div style="margin-top:4px">&ldquo;{e(p.reaction.comment)}&rdquo; <small>({e(p.reaction.comment_language)})</small></div>'
        f'<small>Purchase intent {p.reaction.purchase_intent}/10, share intent {p.reaction.share_intent}/10. Likes: {e(p.reaction.likes)} Concerns: {e(p.reaction.concerns)}</small></div>'
        for p in r.personas)
    s = c.reaction_split
    flags = "".join(f"<tr><td>{e(f.category)}</td><td>{e(f.where)}</td><td>{e(f.issue)}</td><td>{e(f.suggestion)}</td><td>{e(f.severity)}</td></tr>" for f in c.flags)
    wall = "".join(f'<div class="cmt">{e(x.text)} <small>({e(x.language)}, {e(x.reaction)})</small></div>' for x in c.crowd_comments)
    img = f'<img alt="The ad" src="{e(r.thumbnail)}">' if r.thumbnail.startswith("data:image/") else ""
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pre-launch ad audit: {e(b.brand or 'Ad')}</title><style>{CSS}</style></head><body>
<h1>Pre-launch ad audit</h1><div class="muted small">{e(b.brand or 'Brand not given')} &middot; {e('Video commercial' if b.ad_type == 'video' else 'Static or press ad')} &middot; {date.today().isoformat()} &middot; Model: {e(r.model)}</div>
<div class="verdict {tone}">{e(k.verdict)}</div>
<div class="tiles"><div class="tile"><span>Visual impact</span><b>{k.visual_impact:.0f}</b></div><div class="tile"><span>{'3 second hook' if b.ad_type == 'video' else '1 second eye-catch'}</span><b>{k.hook_score:.0f}</b></div>
<div class="tile"><span>Backlash risk</span><b class="{'bad' if k.backlash_risk >= 65 else 'warn' if k.backlash_risk >= 35 else 'good'}">{k.backlash_risk:.0f}</b><span>{e(k.risk_level)}</span></div>
<div class="tile"><span>Purchase intent</span><b>{k.avg_purchase_intent:.1f}/10</b></div><div class="tile"><span>Share intent</span><b>{k.avg_share_intent:.1f}/10</b></div></div>
<h2>The ad and the brief</h2><div class="cols">{img}<div><p><b>Headline:</b> {e(b.headline) or 'n/a'}</p><p><b>Copy or script:</b> {e(b.ad_copy) or 'n/a'}</p>
<p><b>Audience:</b> {e(b.audience) or 'n/a'}<br><b>Objective:</b> {e(b.objective) or 'n/a'}</p><p class="muted small">{e(rev.summary) if rev else ''}</p></div></div>
<h2>Visual and attention analysis</h2>{extra}<table><tr><th>Measure</th><th>Score</th><th>Why</th></tr>{scores}</table>
<h2>Layout and creative fixes</h2><table><tr><th>Priority</th><th>Problem</th><th>Fix</th></tr>{fixes}</table>
<h2>Synthetic Sri Lankan focus group</h2>{personas}
<h2>Language, culture and backlash</h2><p><b>Risk level: {e(c.risk_level)}.</b> {e(c.risk_summary)}</p>
<p>Predicted reaction: positive {s.positive:.0f}%, neutral {s.neutral:.0f}%, trolling {s.troll:.0f}%, angry {s.angry:.0f}%. Meme potential {c.meme_potential:.1f}/10. {e(c.meme_note)}</p>
<table><tr><th>Type</th><th>Where</th><th>Issue</th><th>Suggestion</th><th>Severity</th></tr>{flags}</table>
<h3>Fixes</h3><ul>{''.join(f'<li>{e(x)}</li>' for x in c.fixes)}</ul>
<h2>Simulated comment wall</h2>{wall}
<h2>Read this first</h2><ul class="small muted">{''.join(f'<li>{e(x)}</li>' for x in r.caveats)}</ul></body></html>"""
