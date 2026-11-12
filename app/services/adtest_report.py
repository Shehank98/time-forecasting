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
.viab{display:flex;gap:16px;align-items:center;border:1px solid #dfe5ec;border-radius:12px;padding:12px 16px;margin:8px 0}.viab .big{font-size:42px;font-weight:800}.viab .big small{font-size:16px;color:#5b6877}
.cmt{border:1px solid #dfe5ec;border-radius:10px;padding:8px 10px;margin:6px 0}.cmt small{color:#5b6877}
@media print{body{margin:0}.cols{grid-template-columns:200px 1fr}}
@media(max-width:640px){.cols{grid-template-columns:1fr}}
"""


def _bar(v: float, top: float = 10) -> str:
    return f'<div class="bar"><i style="width:{max(0, min(100, v / top * 100)):.0f}%"></i></div>'


def _fixes(items) -> str:
    return "".join(f"<tr><td>{e(f.priority)}</td><td>{e(f.problem)}</td><td>{e(f.fix)}</td></tr>" for f in items)


def _pm(v: float, margin: float | None, dec: int = 1) -> str:
    return f"{v:.{dec}f}" + (f" &plusmn; {margin:.{dec}f}" if margin is not None else "")


def build_html(r: AdTestResult) -> str:
    b, v, c, k, via, pn = r.brief, r.vision, r.risk, r.scorecard, r.viability, r.panel
    tone = {"good": "good", "warn": "warn", "bad": "bad"}[k.verdict_tone]
    rev = v.static or v.video
    video = b.ad_type == "video"
    # executive card
    if via:
        bounds = f" <span class='muted small'>(95% range {via.low:.0f} to {via.high:.0f}, from {via.runs} repeated runs)</span>" if via.margin is not None else " <span class='muted small'>(one run: no margin of error)</span>"
        head = f'<div class="viab"><div class="big">{_pm(via.score, via.margin, 0)}<small>/100</small></div><div><b>{e(via.label)}</b>{bounds}<br><span class="muted small">Pre-launch viability for a {e(via.goal)} goal. {e(k.verdict)}</span></div></div>'
        wrows = "".join(f"<tr><td>{e(n)}</td><td>{via.parts.get(n, 0):.0f}</td><td>{via.weights.get(n, 0) * 100:.0f}%</td><td>{via.parts.get(n, 0) * via.weights.get(n, 0):.1f}</td></tr>"
                        for n in ("visual", "hook", "purchase", "share", "safety"))
        how = (f"<h3>How the score is built</h3><table><tr><th>Ingredient</th><th>Value (0 to 100)</th><th>Weight</th><th>Points</th></tr>{wrows}</table>"
               "<p class='small muted'>Weights depend on the campaign goal. Safety is 100 minus the backlash risk. The margin of error comes from repeating the simulated panel; it does not include any error in the image analysis.</p>")
    else:
        head, how = "", ""
    recs = "".join(f"<tr><td>{e(x.priority)}</td><td>{e(x.area)}</td><td>{e(x.action)}</td><td class='small muted'>{e(x.why)}</td></tr>" for x in r.recommendations)
    # visual
    scores = "".join(f"<tr><td>{e(s.name)}</td><td>{s.value:.1f} / 10{_bar(s.value)}</td><td>{e(s.why)}</td></tr>" for s in (rev.scores if rev else []))
    place = "".join(f"<tr><td>{e(p.label)} ({e(p.kind)})</td><td>{p.area_pct:.1f}%</td><td>{p.attention_prior * 100:.0f}%</td><td>{e(p.verdict)}</td><td>{e(p.advice)}</td></tr>" for p in v.placements)
    extra = ""
    if v.video:
        tl = "".join(f"<tr><td>{q.second}</td><td>{q.attention:.1f}{_bar(q.attention)}</td><td>{(v.stimulation[i] if i < len(v.stimulation) else 0):.1f}</td><td>{e(q.note)}</td></tr>" for i, q in enumerate(v.video.timeline))
        extra = (f"<p><b>3 second hook:</b> {v.video.hook_strength_3s:.1f} / 10. <b>Pacing:</b> {v.video.pacing:.1f} / 10. {e(v.video.emotion_arc)}</p>"
                 + (f"<h3>Attention second by second</h3><table><tr><th>Second</th><th>Predicted attention</th><th>Measured visual change</th><th>Note</th></tr>{tl}</table>" if tl else "")
                 + (f"<p><b>Likely drop-off seconds:</b> {', '.join(str(x) for x in v.drop_offs)}.</p>" if v.drop_offs else "")
                 + ("<h3>Where viewers may drop off</h3><ul>" + "".join(f"<li>{e(x)}</li>" for x in v.video.drop_off_risks) + "</ul>" if v.video.drop_off_risks else ""))
    if v.static:
        extra = f"<p><b>One second eye-catch:</b> {v.static.one_second_eye_catch:.1f} / 10. <b>Headline as read:</b> {e(v.static.headline_read)}</p>"
    glance = f"<p><b>What the eye sees first:</b> {e(rev.first_glance)}</p>" if rev and rev.first_glance else ""
    bench = "".join(f"<tr><td>{e(x.label)}</td><td>{x.value:.0f}</td><td>{x.typical_low:.0f} to {x.typical_high:.0f}{'' if x.higher_is_better else ' (lower is better)'}</td><td class='{'good' if x.verdict == 'Strong' else 'warn' if x.verdict == 'Typical' else 'bad'}'>{e(x.verdict)}</td><td class='small muted'>{e(x.reference)}</td></tr>" for x in r.benchmarks)
    fixes = _fixes(rev.fixes if rev else [])
    # panel
    segs = ""
    if pn:
        for kind, title in (("age", "Age group"), ("region", "Where they live"), ("gender", "Gender"), ("mindset", "Mindset"), ("background", "Background")):
            rows = "".join(f"<tr><td>{e(g.label)}</td><td>{g.n}</td><td>{g.purchase:.1f}</td><td>{g.share:.1f}</td><td>{g.positive:.0f}%</td><td>{g.negative:.0f}%</td></tr>" for g in pn.segments if g.kind == kind)
            segs += f"<h3>{e(title)}</h3><table><tr><th>Segment</th><th>People</th><th>Would buy /10</th><th>Would share /10</th><th>Positive</th><th>Mocking or angry</th></tr>{rows}</table>"
        pci = pn.purchase_ci.margin if pn.purchase_ci else None
        sci = pn.share_ci.margin if pn.share_ci else None
        emo = ", ".join(f"{e(x.emotion)} {x.percent:.0f}%" for x in pn.emotions)
        segs = (f"<p>{pn.size} personas reacted{f' in each of {pn.runs} runs' if pn.runs > 1 else ''} (of {pn.requested} planned). Would buy {_pm(pn.purchase, pci)}/10, would share {_pm(pn.share, sci)}/10"
                f"{' (95% margin of error across runs)' if pn.runs > 1 else ''}. Mood: positive {pn.positive:.0f}%, neutral {pn.neutral:.0f}%, mocking {pn.troll:.0f}%, angry {pn.angry:.0f}%. "
                f"Emotional resonance {pn.resonance:.1f}/10. Main feelings: {emo or 'n/a'}.</p>"
                + ("<h3>Most common worries</h3><ul>" + "".join(f"<li>{e(c.text)} ({c.count})</li>" for c in pn.concerns) + "</ul>" if pn.concerns else "") + segs)
    people = "".join(
        f'<tr><td>{e(p.name)}, {p.age}</td><td>{e(p.place)} &middot; {e(p.background)} &middot; {e(p.mindset)}</td><td>{e(p.reaction.mood)}</td>'
        f'<td>{_pm(p.purchase_mean, None)} / {_pm(p.share_mean, None)}{f" (sd {p.purchase_sd:.1f})" if p.runs > 1 else ""}</td>'
        f'<td>&ldquo;{e(p.reaction.comment)}&rdquo; <small>({e(p.reaction.comment_language)})</small><br><small><i>{e(p.reaction.gut_reaction)}</i></small></td></tr>' for p in r.personas)
    people = f"<table><tr><th>Who</th><th>Profile</th><th>Mood</th><th>Buy / share</th><th>Comment</th></tr>{people}</table>"
    u = r.usage
    tokens = f"<p class='small muted'>Tokens used: {u.input_tokens:,} in, {u.output_tokens:,} out, {u.calls} calls{' (saved result, no new tokens)' if u.cached else ''}.</p>"
    s_ = c.reaction_split
    flags = "".join(f"<tr><td>{e(f.category)}</td><td>{e(f.where)}</td><td>{e(f.issue)}</td><td>{e(f.suggestion)}</td><td>{e(f.severity)}</td></tr>" for f in c.flags)
    wall = "".join(f'<div class="cmt">{e(x.text)} <small>({e(x.language)}, {e(x.reaction)})</small></div>' for x in c.crowd_comments)
    img = f'<img alt="The ad" src="{e(r.thumbnail)}">' if r.thumbnail.startswith("data:image/") else ""
    heat = (f'<h2>Attention zones</h2><div class="cols"><img alt="The ad with attention zones" src="{e(r.heatmap)}"><div><p class="small muted">Red glow: where the eye is expected to land, strongest first. '
            f'Boxes: 1, 2, 3 are the eye path; a dash means not on it.</p>{glance}<table><tr><th>Element</th><th>Size</th><th>Usual attention</th><th>Verdict</th><th>Advice</th></tr>{place}</table></div></div>'
            if r.heatmap.startswith("data:image/") else "")
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pre-launch ad audit: {e(b.brand or 'Ad')}</title><style>{CSS}</style></head><body>
<h1>Pre-launch ad audit</h1><div class="muted small">{e(b.brand or 'Brand not given')} &middot; {e('Video commercial' if video else 'Static or press ad')}{(' &middot; ' + e(b.category)) if b.category else ''} &middot; {date.today().isoformat()} &middot; Model: {e(r.model)}</div>
<h2>Pre-launch viability</h2>{head}
<div class="tiles"><div class="tile"><span>Visual impact</span><b>{k.visual_impact:.0f}</b></div><div class="tile"><span>{'3 second hook' if video else '1 second eye-catch'}</span><b>{k.hook_score:.0f}</b></div>
<div class="tile"><span>Backlash risk</span><b class="{'bad' if k.backlash_risk >= 65 else 'warn' if k.backlash_risk >= 35 else 'good'}">{k.backlash_risk:.0f}</b><span>{e(k.risk_level)}</span></div>
<div class="tile"><span>Would buy</span><b>{k.avg_purchase_intent:.1f}/10</b></div><div class="tile"><span>Would share</span><b>{k.avg_share_intent:.1f}/10</b></div></div>
<div class="verdict {tone}">{e(k.verdict)}</div>{how}
<h2>Recommended actions</h2><table><tr><th>Priority</th><th>Area</th><th>Action</th><th>Why</th></tr>{recs}</table>
<h2>The ad and the brief</h2><div class="cols">{img}<div><p><b>Headline:</b> {e(b.headline) or 'n/a'}</p><p><b>Copy or script:</b> {e(b.ad_copy) or 'n/a'}</p>
<p><b>Goal:</b> {e(b.goal) or 'n/a'} &middot; <b>Audience:</b> {e(b.audience) or 'n/a'}<br><b>Objective:</b> {e(b.objective) or 'n/a'}</p><p class="muted small">{e(rev.summary) if rev else ''}</p></div></div>
{heat}
<h2>Visual and attention analysis</h2>{extra}<table><tr><th>Measure</th><th>Score</th><th>Why</th></tr>{scores}</table>
<h2>Benchmarks</h2><p class="small muted">{e(r.benchmark_note)}</p><table><tr><th>Measure</th><th>This ad</th><th>Typical band</th><th>Verdict</th><th>Reference</th></tr>{bench}</table>
<h2>Layout and creative fixes</h2><table><tr><th>Priority</th><th>Problem</th><th>Fix</th></tr>{fixes}</table>
<h2>Synthetic Sri Lankan focus group</h2>{segs}{people}
<h2>Language, culture and backlash</h2><p><b>Risk level: {e(c.risk_level)}.</b> {e(c.risk_summary)}</p>
<p>Predicted reaction: positive {s_.positive:.0f}%, neutral {s_.neutral:.0f}%, trolling {s_.troll:.0f}%, angry {s_.angry:.0f}%. Meme potential {c.meme_potential:.1f}/10. {e(c.meme_note)}</p>
<table><tr><th>Type</th><th>Where</th><th>Issue</th><th>Suggestion</th><th>Severity</th></tr>{flags}</table>
<h3>Fixes</h3><ul>{''.join(f'<li>{e(x)}</li>' for x in c.fixes)}</ul>
<h2>Simulated comment wall</h2>{wall}
<h2>Read this first</h2>{tokens}<ul class="small muted">{''.join(f'<li>{e(x)}</li>' for x in r.caveats)}</ul></body></html>"""
