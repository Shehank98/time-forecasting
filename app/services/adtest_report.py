"""The client-ready Pre-Launch Ad Audit: a self-contained HTML document laid out like a consultancy report.

HTML rather than PDF so Sinhala and Tamil text renders correctly; it is styled for A4 and prints straight to PDF from any browser (cover page, numbered
sections, page breaks, running footer). Charts are inline SVG, so the file needs nothing else to open.
"""
from __future__ import annotations

import re
from datetime import date
from html import escape as e

from .adtest_models import AdTestResult

DEFAULT_PRIMARY = "#1f3a93"
LABEL_TEXT = {"Launch": "Ready to launch. Apply the small fixes if you have time.",
              "Launch after fixes": "Launch after the high priority fixes below.",
              "Rework": "Rework the creative before launch: the fixes below matter.",
              "Do not launch": "Do not launch in its current form."}


def _hex(c: str | None) -> str:
    return c if isinstance(c, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", c or "") else DEFAULT_PRIMARY


def _css(primary: str) -> str:
    return f"""
:root{{--p:{primary};--ink:#14171f;--muted:#5d6472;--line:#e3e6ec;--soft:#f5f6f9;--good:#13804b;--warn:#b26b00;--bad:#c42b3c}}
*{{box-sizing:border-box}} html{{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
body{{margin:0;font:14px/1.55 Inter,"Segoe UI",system-ui,-apple-system,"Noto Sans Sinhala","Iskoola Pota","Noto Sans Tamil","Latha",sans-serif;color:var(--ink);background:#eef0f4}}
.doc{{max-width:900px;margin:0 auto;background:#fff;box-shadow:0 10px 40px rgba(20,23,31,.08)}}
.page{{padding:48px 56px}} .break{{page-break-before:always;break-before:page}}
h1,h2,h3{{margin:0;font-weight:700;letter-spacing:-.01em}} h2{{font-size:22px;margin:0 0 4px}} h3{{font-size:15px;margin:22px 0 8px}}
.sec-n{{color:var(--p);font-weight:700;font-size:12px;letter-spacing:.16em;text-transform:uppercase}}
.lead{{color:var(--muted);margin:2px 0 18px}} .muted{{color:var(--muted)}} .small{{font-size:12.5px}} p{{margin:8px 0}}
/* cover */
.cover{{min-height:1060px;display:flex;flex-direction:column;padding:56px;background:linear-gradient(160deg,var(--p) 0%,#0f1730 100%);color:#fff;position:relative;overflow:hidden}}
.cover:after{{content:"";position:absolute;right:-180px;top:-120px;width:520px;height:520px;border-radius:50%;background:rgba(255,255,255,.07)}}
.cover .agency{{font-weight:700;letter-spacing:.18em;text-transform:uppercase;font-size:12px;opacity:.85}}
.cover h1{{font-size:46px;line-height:1.08;margin:120px 0 14px;max-width:620px}}
.cover .sub{{font-size:18px;opacity:.85;max-width:620px}}
.cover .meta{{margin-top:auto;display:grid;grid-template-columns:repeat(3,1fr);gap:18px;border-top:1px solid rgba(255,255,255,.25);padding-top:22px;font-size:13px}}
.cover .meta b{{display:block;font-size:11px;letter-spacing:.14em;text-transform:uppercase;opacity:.7;font-weight:600;margin-bottom:4px}}
.cover .score{{position:absolute;right:56px;top:210px;text-align:center}} .cover .score .n{{font-size:76px;font-weight:800;line-height:1}} .cover .score .l{{font-size:13px;opacity:.85}}
.cover .badge{{background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.35);color:#fff}}
/* blocks */
.verdict{{display:flex;gap:18px;align-items:center;border:1px solid var(--line);border-left:6px solid var(--p);border-radius:12px;padding:16px 20px;margin:6px 0 18px;background:var(--soft)}}
.verdict.good{{border-left-color:var(--good)}} .verdict.warn{{border-left-color:var(--warn)}} .verdict.bad{{border-left-color:var(--bad)}}
.verdict .big{{font-size:46px;font-weight:800;line-height:1;white-space:nowrap}} .verdict .big small{{font-size:16px;color:var(--muted);font-weight:600}}
.badge{{display:inline-block;padding:3px 10px;border-radius:999px;font-size:11.5px;font-weight:700;letter-spacing:.02em;background:var(--soft);border:1px solid var(--line)}}
.badge.good{{background:#e7f6ee;color:var(--good);border-color:#bfe6cf}} .badge.warn{{background:#fff4e0;color:var(--warn);border-color:#f3d9a6}} .badge.bad{{background:#fde9ec;color:var(--bad);border-color:#f4c1c9}}
.tiles{{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin:14px 0}}
.tile{{border:1px solid var(--line);border-radius:12px;padding:12px 14px}} .tile span{{display:block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:600}}
.tile b{{display:block;font-size:24px;margin-top:4px}} .tile small{{color:var(--muted)}}
.two{{display:grid;grid-template-columns:1fr 1fr;gap:20px}} .cols{{display:grid;grid-template-columns:300px 1fr;gap:22px;align-items:start}}
.cols img,.two img{{width:100%;border-radius:10px;border:1px solid var(--line)}}
.kf{{margin:0;padding-left:18px}} .kf li{{margin:5px 0}}
table{{border-collapse:collapse;width:100%;margin:8px 0 4px;font-size:13px}} th{{text-align:left;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:700;border-bottom:2px solid var(--ink);padding:7px 8px}}
td{{border-bottom:1px solid var(--line);padding:7px 8px;vertical-align:top}} tr:nth-child(even) td{{background:#fafbfc}} td.n,th.n{{text-align:right;font-variant-numeric:tabular-nums}}
.bar{{height:8px;border-radius:4px;background:#eceef3;overflow:hidden;min-width:80px}} .bar i{{display:block;height:100%;background:var(--p)}}
.quote{{border:1px solid var(--line);border-radius:12px;padding:12px 14px;background:var(--soft)}} .quote q{{display:block;font-size:14.5px;quotes:"\\201C" "\\201D"}} .quote small{{color:var(--muted)}}
.split{{display:flex;height:26px;border-radius:7px;overflow:hidden}} .split i{{display:flex;align-items:center;justify-content:center;color:#fff;font-style:normal;font-size:11.5px;font-weight:700}}
tr.thin td{{color:#9aa1ae}}
.cover .ad{{margin:44px 0 0;max-width:340px}} .cover .ad img{{width:100%;border-radius:14px;box-shadow:0 20px 50px rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.25)}}
.quotes{{display:grid;grid-template-columns:1fr 1fr;gap:10px}}
.pri{{display:inline-block;min-width:62px;text-align:center}}
.note{{border-left:3px solid var(--line);padding:4px 12px;color:var(--muted);font-size:12.5px;margin:10px 0}}
.toc{{columns:2;margin:14px 0 0;padding-left:18px}} .toc li{{margin:4px 0}}
.foot{{display:flex;justify-content:space-between;color:var(--muted);font-size:11px;border-top:1px solid var(--line);padding:12px 56px}}
@page{{size:A4;margin:0}}
@media print{{body{{background:#fff}} .doc{{box-shadow:none;max-width:none}} .page{{padding:40px 48px}} .cover{{min-height:100vh}} tr,.quote,.tile,.verdict{{break-inside:avoid}}}}
@media (max-width:760px){{.page{{padding:28px 20px}} .tiles{{grid-template-columns:repeat(2,1fr)}} .two,.cols,.quotes{{grid-template-columns:1fr}} .cover{{padding:32px 20px}} .cover h1{{font-size:32px;margin-top:60px}} .cover .score{{position:static;text-align:left;margin-top:20px}}}}
"""


def _tone(v: float, good_hi: bool = True, lo: float = 45, hi: float = 65) -> str:
    if good_hi:
        return "good" if v >= hi else "warn" if v >= lo else "bad"
    return "bad" if v >= hi else "warn" if v >= lo else "good"


def _bar(v: float, top: float = 10) -> str:
    return f'<div class="bar"><i style="width:{max(0, min(100, v / top * 100)):.0f}%"></i></div>'


def _pm(v: float, m: float | None, d: int = 1) -> str:
    return f"{v:.{d}f}" + (f" &plusmn; {m:.{d}f}" if m is not None else "")


def _split_svg(parts: list[tuple[str, float, str]]) -> str:
    """A 100 percent bar with labels (HTML, so the text never stretches)."""
    segs = "".join(f'<i style="width:{max(0.0, v):.2f}%;background:{col}">{f"{v:.0f}%" if v >= 7 else ""}</i>' for _, v, col in parts)
    legend = " ".join(f'<span style="display:inline-flex;align-items:center;gap:5px;margin-right:12px"><i style="width:10px;height:10px;border-radius:3px;background:{c};display:inline-block"></i>{e(lab)} {v:.0f}%</span>' for lab, v, c in parts)
    return f'<div class="split">{segs}</div><div class="small" style="margin-top:6px">{legend}</div>'


def _bench_svg(lo: float, hi: float, v: float, higher_better: bool, tone: str) -> str:
    col = {"good": "#13804b", "warn": "#b26b00", "bad": "#c42b3c"}[tone]
    return (f'<svg viewBox="0 0 100 10" style="width:100%;height:16px"><rect x="0" y="3.5" width="100" height="3" rx="1.5" fill="#eceef3"/>'
            f'<rect x="{lo}" y="3.5" width="{max(0.5, hi - lo)}" height="3" fill="#c9cfdc"/><circle cx="{max(1, min(99, v))}" cy="5" r="3" fill="{col}"/></svg>')


def _timeline_svg(pts, stim: list[float]) -> str:
    if not pts or len(pts) < 2:
        return ""
    W, H, P = 600, 150, 26
    x = lambda i: P + i * (W - 2 * P) / (len(pts) - 1)  # noqa: E731
    y = lambda a: H - P - a / 10 * (H - 2 * P)  # noqa: E731
    att = " ".join(f"{'M' if i == 0 else 'L'}{x(i):.1f} {y(p.attention):.1f}" for i, p in enumerate(pts))
    st = " ".join(f"{'M' if i == 0 else 'L'}{x(i):.1f} {y(v):.1f}" for i, v in enumerate(stim[:len(pts)])) if len(stim) >= 2 else ""
    grid = "".join(f'<line x1="{P}" x2="{W - P}" y1="{y(g)}" y2="{y(g)}" stroke="#eceef3"/><text x="{P - 6}" y="{y(g) + 3}" font-size="9" text-anchor="end" fill="#5d6472">{g}</text>' for g in (0, 5, 10))
    return (f'<svg viewBox="0 0 {W} {H}" style="width:100%">{grid}' + (f'<path d="{st}" fill="none" stroke="#9aa3b5" stroke-width="1.6" stroke-dasharray="4 3"/>' if st else "")
            + f'<path d="{att}" fill="none" stroke="var(--p)" stroke-width="2.4"/>'
            + "".join(f'<circle cx="{x(i):.1f}" cy="{y(p.attention):.1f}" r="2.6" fill="{"#c42b3c" if p.attention < 4 else "var(--p)"}"/>' for i, p in enumerate(pts))
            + f'<text x="{P}" y="{H - 6}" font-size="10" fill="#5d6472">{pts[0].second}s</text><text x="{W - P}" y="{H - 6}" font-size="10" fill="#5d6472" text-anchor="end">{pts[-1].second}s</text></svg>'
            + '<div class="small muted">Solid line: predicted attention (0 to 10). Dashed line: visual change measured from the frames. Red points: likely drop-off.</div>')


def _findings(r: AdTestResult) -> list[str]:
    out = []
    k, pn, c = r.scorecard, r.panel, r.risk
    out.append(f"The ad scores {k.visual_impact:.0f} out of 100 for visual impact and {k.hook_score:.0f} for its {'3 second hook' if r.brief.ad_type == 'video' else 'one second eye-catch'}.")
    if pn:
        out.append(f"Across {pn.size} simulated Sri Lankan consumers{' (weighted to the population)' if pn.weighted else ''}, purchase intent averages {pn.purchase:.1f} out of 10 and share intent {pn.share:.1f}; "
                   f"{pn.positive:.0f}% react positively and {pn.troll + pn.angry:.0f}% mock it or react angrily.")
        segs = [s for s in pn.segments if s.n >= 3]
        if segs:
            best = max(segs, key=lambda s: s.purchase)
            worst = min(segs, key=lambda s: s.purchase)
            if best.label != worst.label:
                out.append(f"It works best with {best.label} ({best.purchase:.1f} out of 10) and least with {worst.label} ({worst.purchase:.1f}).")
        if pn.concerns:
            out.append(f"The most common worry is “{pn.concerns[0].text}”, raised by {pn.concerns[0].count} people.")
    out.append(f"Cultural and backlash risk is {c.risk_level.lower()}. {c.risk_summary}")
    weak = [b for b in r.benchmarks if b.verdict == "Below typical"]
    if weak:
        out.append("Below the typical band on: " + ", ".join(b.label.lower() for b in weak) + ".")
    weak_place = [p for p in r.vision.placements if p.verdict == "Weak"]
    if weak_place:
        out.append(weak_place[0].advice)
    return out


def build_html(r: AdTestResult, branding: dict | None = None, client: str = "") -> str:
    b, v, c, k, via, pn = r.brief, r.vision, r.risk, r.scorecard, r.viability, r.panel
    br = branding or {}
    primary, agency = _hex(br.get("primary_color")), (br.get("agency_name") or "Media Radar")
    footer = br.get("report_footer") or "Confidential. Prepared for the named client only."
    video = b.ad_type == "video"
    rev = v.static or v.video
    today = date.today().strftime("%d %B %Y")
    title_brand = b.brand or client or "the advertiser"
    vtone = {"Launch": "good", "Launch after fixes": "good", "Rework": "warn", "Do not launch": "bad"}.get(via.label if via else "", k.verdict_tone)

    # ---------------------------------------------------------------- cover
    score_html = (f'<div class="score"><div class="n">{via.score:.0f}</div><div class="l">Pre-launch viability out of 100'
                  f'{f"<br>95% range {via.low:.0f} to {via.high:.0f}" if via.margin is not None else ""}</div>'
                  f'<div style="margin-top:10px"><span class="badge">{e(via.label)}</span></div></div>') if via else ""
    cover = f"""<section class="cover"><div class="agency">{e(agency)}</div>{score_html}
<h1>Pre-launch ad audit</h1><div class="sub">{e(title_brand)}{(' &middot; ' + e(b.product)) if b.product else ''}<br>{'Video commercial' if video else 'Static or press advertisement'}{(' &middot; ' + e(b.category)) if b.category else ''}</div>
{f'<div class="ad"><img alt="The tested ad" src="{e(r.thumbnail)}"></div>' if r.thumbnail.startswith("data:image/") else ''}
<div class="meta"><div><b>Prepared for</b>{e(client or title_brand)}</div><div><b>Date</b>{today}</div><div><b>Campaign goal</b>{e((b.goal or 'consideration').title())}</div></div></section>"""

    # ---------------------------------------------------------------- 1 executive summary
    top_actions = "".join(f'<tr><td><span class="badge pri {"bad" if x.priority == "High" else "warn" if x.priority == "Medium" else ""}">{e(x.priority)}</span></td><td>{e(x.action)}</td></tr>' for x in r.recommendations[:5])
    tiles = (f'<div class="tile"><span>Visual impact</span><b>{k.visual_impact:.0f}</b><small>out of 100</small></div>'
             f'<div class="tile"><span>{"3 second hook" if video else "1 second eye-catch"}</span><b>{k.hook_score:.0f}</b><small>out of 100</small></div>'
             f'<div class="tile"><span>Backlash risk</span><b style="color:var(--{_tone(k.backlash_risk, False, 35, 65)})">{k.backlash_risk:.0f}</b><small>{e(k.risk_level)}, lower is safer</small></div>'
             f'<div class="tile"><span>Would buy</span><b>{_pm(k.avg_purchase_intent, pn.purchase_ci.margin if pn and pn.purchase_ci else None)}</b><small>out of 10</small></div>'
             f'<div class="tile"><span>Would share</span><b>{_pm(k.avg_share_intent, pn.share_ci.margin if pn and pn.share_ci else None)}</b><small>out of 10</small></div>')
    verdict = (f'<div class="verdict {vtone}"><div class="big">{_pm(via.score, via.margin, 0)}<small> / 100</small></div><div><span class="badge {vtone}">{e(via.label)}</span>'
               f'<div style="margin-top:6px;font-weight:600">{e(LABEL_TEXT.get(via.label, k.verdict))}</div><div class="small muted">Pre-launch viability for a {e(via.goal)} goal'
               f'{f", 95% range {via.low:.0f} to {via.high:.0f} from {via.runs} repeated runs" if via.margin is not None else ""}.</div></div></div>') if via else f'<div class="verdict {vtone}"><b>{e(k.verdict)}</b></div>'
    sec1 = f"""<section class="page break"><div class="sec-n">Section 1</div><h2>Executive summary</h2><p class="lead">What we found and what to do before this ad goes live.</p>
{verdict}<div class="tiles">{tiles}</div>
<h3>Key findings</h3><ul class="kf">{''.join(f'<li>{e(x)}</li>' for x in _findings(r))}</ul>
<h3>Top actions before launch</h3><table><tr><th style="width:90px">Priority</th><th>Action</th></tr>{top_actions or '<tr><td colspan="2" class="muted">No actions were raised.</td></tr>'}</table>
<h3>Contents</h3><ol class="toc"><li>Executive summary</li><li>The ad and the brief</li><li>Visual impact and attention</li><li>Audience reaction</li><li>Language, culture and backlash</li><li>Benchmarks</li><li>Recommended actions</li><li>Method and limitations</li><li>Appendix: every persona</li></ol></section>"""

    # ---------------------------------------------------------------- 2 the ad and the brief
    img = f'<img alt="The ad" src="{e(r.thumbnail)}">' if r.thumbnail.startswith("data:image/") else ""
    heat = f'<img alt="The ad with attention zones" src="{e(r.heatmap)}">' if r.heatmap.startswith("data:image/") else ""
    brief_rows = "".join(f"<tr><td style='width:180px' class='muted'>{e(a)}</td><td>{e(bv)}</td></tr>" for a, bv in [
        ("Brand", b.brand), ("Product or offer", b.product), ("Brand category", b.category), ("Campaign goal", b.goal.title() if b.goal else ""), ("Headline", b.headline),
        ("Copy or script", b.ad_copy), ("Target audience", b.audience), ("Objective", b.objective), ("Notes", b.market_notes)] if bv)
    sec2 = f"""<section class="page break"><div class="sec-n">Section 2</div><h2>The ad and the brief</h2><p class="lead">The material that was tested.</p>
<div class="two">{img}{heat or ''}</div>{'<p class="small muted">Right: red glow marks where the eye is expected to land first; boxes mark the key zones in reading order.</p>' if heat else ''}
<table>{brief_rows}</table>{f'<p>{e(rev.summary)}</p>' if rev else ''}</section>"""

    # ---------------------------------------------------------------- 3 visual
    scores = "".join(f"<tr><td>{e(s.name)}</td><td class='n'>{s.value:.1f}</td><td style='width:140px'>{_bar(s.value)}</td><td class='small'>{e(s.why)}</td></tr>" for s in (rev.scores if rev else []))
    place = "".join(f"<tr><td>{e(p.label)}</td><td class='n'>{p.area_pct:.1f}%</td><td class='n'>{p.attention_prior * 100:.0f}%</td><td><span class='badge {'good' if p.verdict == 'Strong' else 'bad' if p.verdict == 'Weak' else 'warn'}'>{e(p.verdict)}</span></td><td class='small'>{e(p.advice)}</td></tr>" for p in v.placements)
    fixes = "".join(f"<tr><td><span class='badge pri {'bad' if f.priority == 'High' else 'warn' if f.priority == 'Medium' else ''}'>{e(f.priority)}</span></td><td>{e(f.problem)}</td><td>{e(f.fix)}</td></tr>" for f in (rev.fixes if rev else []))
    vid = ""
    if v.video:
        vid = (f"<h3>Attention second by second</h3>{_timeline_svg(v.video.timeline, v.stimulation)}"
               f"<p><b>3 second hook</b> {v.video.hook_strength_3s:.1f} / 10 &middot; <b>Pacing</b> {v.video.pacing:.1f} / 10. {e(v.video.emotion_arc)}</p>"
               + (f"<p><b>Likely drop-off seconds:</b> {', '.join(str(x) for x in v.drop_offs)}.</p>" if v.drop_offs else ""))
    stat = f"<p><b>One second eye-catch</b> {v.static.one_second_eye_catch:.1f} / 10. <b>Headline as read from the image:</b> {e(v.static.headline_read)}</p>" if v.static else ""
    sec3 = f"""<section class="page break"><div class="sec-n">Section 3</div><h2>Visual impact and attention</h2><p class="lead">How the creative performs in the first seconds, and whether the eye finds what matters.</p>
{f'<p><b>What the eye sees first:</b> {e(rev.first_glance)}</p>' if rev and rev.first_glance else ''}{stat}
<div class="tiles" style="grid-template-columns:repeat(3,1fr)"><div class="tile"><span>Readability</span><b>{(rev.readability if rev else 0):.0f}</b><small>out of 100</small></div><div class="tile"><span>Layout cleanliness</span><b>{(rev.cleanliness if rev else 0):.0f}</b><small>out of 100</small></div><div class="tile"><span>Visual impact</span><b>{v.visual_impact:.0f}</b><small>out of 100</small></div></div>
{vid}<h3>Creative scores</h3><table><tr><th>Measure</th><th class="n">Score</th><th></th><th>Why</th></tr>{scores}</table>
{f'<h3>Where the key elements sit</h3><table><tr><th>Element</th><th class="n">Size</th><th class="n">Usual attention</th><th>Verdict</th><th>Advice</th></tr>{place}</table><p class="note">Placement verdicts use a rule-of-thumb model of where people look (centre first, then top left), not eye tracking.</p>' if place else ''}
{f'<h3>Creative fixes</h3><table><tr><th style="width:90px">Priority</th><th>Problem</th><th>Fix</th></tr>{fixes}</table>' if fixes else ''}</section>"""

    # ---------------------------------------------------------------- 4 audience
    sec4 = ""
    if pn:
        split = _split_svg([("Positive", pn.positive, "#13804b"), ("Neutral", pn.neutral, "#9aa3b5"), ("Mocking", pn.troll, "#d98a00"), ("Angry", pn.angry, "#c42b3c")])
        emo = "".join(f"<tr><td>{e(x.emotion)}</td><td style='width:60%'>{_bar(x.percent, 100)}</td><td class='n'>{x.percent:.0f}%</td></tr>" for x in pn.emotions)
        seg_tables = ""
        for kind, title in (("age", "By age group"), ("region", "By where they live"), ("gender", "By gender"), ("background", "By background"), ("mindset", "By mindset")):
            rows = "".join(f"<tr{' class=thin' if s.n < 3 else ''}><td>{e(s.label)}</td><td class='n'>{s.n}</td><td class='n'>{s.purchase:.1f}</td><td style='width:110px'>{_bar(s.purchase)}</td><td class='n'>{s.share:.1f}</td><td class='n'>{s.positive:.0f}%</td><td class='n' style='color:{'var(--bad)' if s.negative >= 40 else 'inherit'}'>{s.negative:.0f}%</td></tr>"
                           for s in sorted([x for x in pn.segments if x.kind == kind], key=lambda x: -x.purchase))
            seg_tables += f"<h3>{e(title)}</h3><table><tr><th>Segment</th><th class='n'>People</th><th class='n'>Would buy</th><th></th><th class='n'>Would share</th><th class='n'>Positive</th><th class='n'>Mocking or angry</th></tr>{rows}</table>"
        seg_tables += "<p class='small muted'>Grey rows have fewer than 3 people: read them as anecdotes, not as a result.</p>" if any(x.n < 3 for x in pn.segments) else ""
        picks = []
        for mood in ("Positive", "Angry", "Troll", "Neutral"):
            picks += [p for p in r.personas if p.reaction.mood == mood][:2 if mood in ("Positive", "Angry") else 1]
        quotes = "".join(f'<div class="quote"><q>{e(p.reaction.comment)}</q><small>{e(p.name)}, {p.age}, {e(p.place)} &middot; {e(p.mindset)} &middot; {e(p.reaction.mood)} &middot; {e(p.reaction.comment_language)}</small></div>' for p in picks[:6])
        worries = "".join(f"<li>{e(x.text)} <span class='muted'>({x.count} people)</span></li>" for x in pn.concerns)
        sec4 = f"""<section class="page break"><div class="sec-n">Section 4</div><h2>Audience reaction</h2><p class="lead">{pn.size} simulated Sri Lankan consumers{f', each answering {pn.runs} times' if pn.runs > 1 else ''}. {e(pn.weight_note)}</p>
<div class="tiles" style="grid-template-columns:repeat(4,1fr)"><div class="tile"><span>Panel</span><b>{pn.size}</b><small>{f'worth about {pn.effective_n:.0f} after weighting' if pn.weighted else 'people'}</small></div>
<div class="tile"><span>Would buy</span><b>{_pm(pn.purchase, pn.purchase_ci.margin if pn.purchase_ci else None)}</b><small>out of 10</small></div>
<div class="tile"><span>Would share</span><b>{_pm(pn.share, pn.share_ci.margin if pn.share_ci else None)}</b><small>out of 10</small></div>
<div class="tile"><span>Emotional pull</span><b>{pn.resonance:.1f}</b><small>out of 10</small></div></div>
<h3>Mood of the comment section</h3>{split}
{f'<h3>What they feel</h3><table>{emo}</table>' if emo else ''}
{f'<h3>Most common worries</h3><ul class="kf">{worries}</ul>' if worries else ''}
<h3>In their own words</h3><div class="quotes">{quotes}</div>
{seg_tables}</section>"""

    # ---------------------------------------------------------------- 5 culture
    s_ = c.reaction_split
    flags = "".join(f"<tr><td>{e(f.category)}</td><td>{e(f.where)}</td><td>{e(f.issue)}</td><td>{e(f.suggestion)}</td><td><span class='badge {'bad' if f.severity in ('High', 'Critical') else 'warn' if f.severity == 'Medium' else 'good'}'>{e(f.severity)}</span></td></tr>" for f in c.flags)
    wall = "".join(f'<div class="quote"><q>{e(x.text)}</q><small>{e(x.language)} &middot; {e(x.reaction)}</small></div>' for x in c.crowd_comments[:8])
    rtone = {"Low": "good", "Medium": "warn", "High": "bad", "Critical": "bad"}[c.risk_level]
    sec5 = f"""<section class="page break"><div class="sec-n">Section 5</div><h2>Language, culture and backlash</h2><p class="lead">Double meanings, religious, economic and gender sensitivities, and how easily the ad could be turned into a meme.</p>
<div class="verdict {rtone}"><div><span class="badge {rtone}">{e(c.risk_level)} risk</span><div style="margin-top:6px">{e(c.risk_summary)}</div><div class="small muted">Meme potential {c.meme_potential:.1f} out of 10. {e(c.meme_note)}</div></div></div>
<h3>Predicted public reaction</h3>{_split_svg([("Positive", s_.positive, "#13804b"), ("Neutral", s_.neutral, "#9aa3b5"), ("Trolling", s_.troll, "#d98a00"), ("Angry", s_.angry, "#c42b3c")])}
{f'<h3>Flags</h3><table><tr><th>Type</th><th>Where</th><th>Issue</th><th>Suggestion</th><th>Severity</th></tr>{flags}</table>' if flags else '<p class="muted">No specific language or cultural flags were raised.</p>'}
{f'<h3>Recommended wording and visual fixes</h3><ul class="kf">{"".join(f"<li>{e(x)}</li>" for x in c.fixes)}</ul>' if c.fixes else ''}
{f'<h3>Sample of the simulated comment section</h3><div class="quotes">{wall}</div>' if wall else ''}</section>"""

    # ---------------------------------------------------------------- 6 benchmarks
    brow = ""
    for x in r.benchmarks:
        t = "good" if x.verdict == "Strong" else "warn" if x.verdict == "Typical" else "bad"
        brow += (f"<tr><td>{e(x.label)}</td><td class='n'><b>{x.value:.0f}</b></td><td style='width:180px'>{_bench_svg(x.typical_low, x.typical_high, x.value, x.higher_is_better, t)}</td>"
                 f"<td class='n'>{x.typical_low:.0f} to {x.typical_high:.0f}{'' if x.higher_is_better else '*'}</td><td><span class='badge {t}'>{e(x.verdict)}</span></td></tr>")
    sec6 = f"""<section class="page break"><div class="sec-n">Section 6</div><h2>Benchmarks</h2><p class="lead">This ad against typical bands. Grey band: typical range. Dot: this ad.</p>
<table><tr><th>Measure</th><th class="n">This ad</th><th></th><th class="n">Typical</th><th>Verdict</th></tr>{brow}</table><p class="small muted">* lower is better.</p>
<p class="note">{e(r.benchmark_note)}</p>
{''.join(f'<p class="small"><b>{e(x.label)}.</b> {e(x.reference)}</p>' for x in r.benchmarks if x.reference)}</section>"""

    # ---------------------------------------------------------------- 7 actions
    arows = "".join(f"<tr><td><span class='badge pri {'bad' if x.priority == 'High' else 'warn' if x.priority == 'Medium' else ''}'>{e(x.priority)}</span></td><td class='small muted'>{e(x.area)}</td><td>{e(x.action)}{f'<div class=small muted>{e(x.why)}</div>' if x.why else ''}</td></tr>" for x in r.recommendations)
    sec7 = f"""<section class="page break"><div class="sec-n">Section 7</div><h2>Recommended actions</h2><p class="lead">Every action, most important first. High: do before launch. Medium: should fix. Low: nice to have.</p>
<table><tr><th style="width:90px">Priority</th><th style="width:150px">Area</th><th>Action</th></tr>{arows}</table></section>"""

    # ---------------------------------------------------------------- 8 method
    wrows = "".join(f"<tr><td>{e(n)}</td><td class='n'>{via.parts.get(key, 0):.0f}</td><td class='n'>{via.weights.get(key, 0) * 100:.0f}%</td><td class='n'>{via.parts.get(key, 0) * via.weights.get(key, 0):.1f}</td></tr>"
                    for key, n in (("visual", "Visual impact"), ("hook", "Hook or eye-catch"), ("purchase", "Purchase intent"), ("share", "Share intent"), ("safety", "Safety (100 minus backlash)"))) if via else ""
    u = r.usage
    sec8 = f"""<section class="page break"><div class="sec-n">Section 8</div><h2>Method and limitations</h2><p class="lead">How the numbers in this report were produced.</p>
<h3>Reading the ad</h3><p>The ad was analysed with Google Gemini ({e(r.model)}). {'Videos are sampled at one frame per second and the visual change between frames is measured directly from the pixels.' if video else 'The image was read at high resolution.'} Zones (hook, logo, call to action) and their reading order come from the model; placement verdicts come from a fixed attention model.</p>
<h3>The audience</h3><p>Reactions come from a bank of 200 simulated Sri Lankan consumer personas covering ages 16 to 75, Colombo, other towns and villages, the estates, the North and East and workers abroad, Sinhala, Tamil, Muslim and other backgrounds, and twelve mindsets. The panel is chosen to mirror the population{'; averages are then weighted (raking) so the panel matches Sri Lankan adults by gender, ethnic group, age and region' if pn and pn.weighted else ''}.{f' The whole panel answered {pn.runs} times with different random seeds; the margins of error (95%, Student t) come from the spread between those runs.' if pn and pn.runs > 1 else ''}</p>
{f'<h3>How the viability score is built</h3><table><tr><th>Ingredient</th><th class="n">Value (0 to 100)</th><th class="n">Weight</th><th class="n">Points</th></tr>{wrows}<tr><td><b>Pre-launch viability</b></td><td></td><td class="n">100%</td><td class="n"><b>{via.score:.1f}</b></td></tr></table><p class="small muted">Weights depend on the campaign goal ({e(via.goal)}).</p>' if via else ''}
<h3>Limitations</h3><ul class="kf">{''.join(f'<li>{e(x)}</li>' for x in r.caveats)}</ul>
<p class="small muted">Model usage for this audit: {u.input_tokens:,} input and {u.output_tokens:,} output tokens over {u.calls} calls{' (served from a saved result)' if u.cached else ''}.</p></section>"""

    # ---------------------------------------------------------------- appendix
    prow = "".join(f"<tr><td>{e(p.name)}, {p.age}</td><td class='small'>{e(p.place)}<br><span class='muted'>{e(p.background)} &middot; {e(p.mindset)}</span></td><td>{e(p.reaction.mood)}</td>"
                   f"<td class='n'>{p.purchase_mean:.1f}</td><td class='n'>{p.share_mean:.1f}</td><td class='small'>{e(p.reaction.comment)}<br><span class='muted'>{e(p.reaction.gut_reaction)}</span></td></tr>" for p in r.personas)
    appx = f"""<section class="page break"><div class="sec-n">Appendix</div><h2>Every persona</h2><p class="lead">{len(r.personas)} simulated consumers and what each said.</p>
<table><tr><th>Who</th><th>Profile</th><th>Mood</th><th class="n">Buy</th><th class="n">Share</th><th>Comment and first reaction</th></tr>{prow}</table></section>"""

    foot = f'<div class="foot"><span>{e(agency)} &middot; Pre-launch ad audit &middot; {e(title_brand)}</span><span>{e(footer)}</span></div>'
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pre-launch ad audit: {e(title_brand)}</title><style>{_css(primary)}</style></head><body><main class="doc">
{cover}{sec1}{sec2}{sec3}{sec4}{sec5}{sec6}{sec7}{sec8}{appx}{foot}</main></body></html>"""
