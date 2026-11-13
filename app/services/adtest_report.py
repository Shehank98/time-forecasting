"""The client-ready Pre-Launch Ad Audit as one interactive HTML file.

Short by design: one screen per topic behind tabs, numbers before words, and detail only when the reader asks for it (click to expand, filter, search).
Everything is inside the file (styles, data, script), so it opens offline, can be emailed, and prints every tab to A4 with the Print button.
Sinhala and Tamil render correctly because it is HTML.
"""
from __future__ import annotations

import json
import re
from datetime import date
from html import escape as e

from .adtest_models import AdTestResult

DEFAULT_PRIMARY = "#1f3a93"
LABEL_TEXT = {"Launch": "Ready to launch.", "Launch after fixes": "Launch after the high priority fixes.",
              "Rework": "Rework the creative before launch.", "Do not launch": "Do not launch in its current form."}
TONE = {"Launch": "good", "Launch after fixes": "good", "Rework": "warn", "Do not launch": "bad"}


def _hex(c: str | None) -> str:
    return c if isinstance(c, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", c or "") else DEFAULT_PRIMARY


def _pm(v: float, m: float | None, d: int = 1) -> str:
    return f"{v:.{d}f}" + (f" &plusmn; {m:.{d}f}" if m is not None else "")


def _ring(score: float, primary: str) -> str:
    c = 2 * 3.14159 * 52
    off = c * (1 - max(0, min(100, score)) / 100)
    return (f'<svg viewBox="0 0 120 120" class="ring"><circle cx="60" cy="60" r="52" stroke="#e7eaf0" stroke-width="10" fill="none"/>'
            f'<circle cx="60" cy="60" r="52" stroke="{primary}" stroke-width="10" fill="none" stroke-linecap="round" stroke-dasharray="{c:.1f}" '
            f'stroke-dashoffset="{off:.1f}" transform="rotate(-90 60 60)" class="arc" style="--c:{c:.1f}"/><text x="60" y="66" text-anchor="middle" class="rn">{score:.0f}</text></svg>')


def _findings(r: AdTestResult) -> list[str]:
    """Three short findings, the ones a client asks about first."""
    out, pn, c = [], r.panel, r.risk
    if pn:
        out.append(f"{pn.positive:.0f}% of viewers react positively; {pn.troll + pn.angry:.0f}% mock it or get angry.")
        segs = [s for s in pn.segments if s.n >= 3 and s.kind in ("age", "region", "gender")]
        if segs:
            best, worst = max(segs, key=lambda s: s.purchase), min(segs, key=lambda s: s.purchase)
            if best.label != worst.label:
                out.append(f"Strongest with {best.label} ({best.purchase:.1f}/10), weakest with {worst.label} ({worst.purchase:.1f}/10).")
    weak = [p for p in r.vision.placements if p.verdict == "Weak"]
    if weak:
        out.append(f"{weak[0].label} sits where people rarely look.")
    out.append(f"{c.risk_level} cultural risk. {c.risk_summary}")
    return out[:4]


def _data(r: AdTestResult) -> dict:
    pn = r.panel
    return {
        "personas": [{"n": p.name, "a": p.age, "p": p.place, "b": p.background, "m": p.mindset, "mood": p.reaction.mood, "buy": round(p.purchase_mean, 1),
                      "share": round(p.share_mean, 1), "c": p.reaction.comment, "lang": p.reaction.comment_language, "g": p.reaction.gut_reaction} for p in r.personas],
        "segments": [{"k": s.kind, "l": s.label, "n": s.n, "buy": s.purchase, "pos": s.positive, "neg": s.negative} for s in (pn.segments if pn else [])],
        "actions": [{"p": x.priority, "a": x.area, "t": x.action, "w": x.why} for x in r.recommendations],
    }


def build_html(r: AdTestResult, branding: dict | None = None, client: str = "") -> str:
    b, v, c, k, via, pn = r.brief, r.vision, r.risk, r.scorecard, r.viability, r.panel
    br = branding or {}
    primary, agency = _hex(br.get("primary_color")), (br.get("agency_name") or "Media Radar")
    footer = br.get("report_footer") or "Confidential. Prepared for the named client only."
    video, rev = b.ad_type == "video", (v.static or v.video)
    brand = b.brand or client or "the advertiser"
    label = via.label if via else ""
    tone = TONE.get(label, k.verdict_tone)

    # ---------------- summary
    tiles = [("Visual impact", f"{k.visual_impact:.0f}", "/100"), ("3 second hook" if video else "Eye-catch", f"{k.hook_score:.0f}", "/100"),
             ("Backlash risk", f"{k.backlash_risk:.0f}", k.risk_level), ("Would buy", _pm(k.avg_purchase_intent, pn.purchase_ci.margin if pn and pn.purchase_ci else None), "/10"),
             ("Would share", _pm(k.avg_share_intent, pn.share_ci.margin if pn and pn.share_ci else None), "/10")]
    tiles_html = "".join(f'<div class="tile"><span>{e(t)}</span><b>{val}</b><small>{e(sub)}</small></div>' for t, val, sub in tiles)
    top3 = "".join(f'<li><span class="pill {x.priority.lower()}">{e(x.priority)}</span>{e(x.action)}</li>' for x in r.recommendations[:3])
    summary = f"""<section id="t-summary" class="tab-pane" data-title="Executive summary">
<div class="hero"><div>{_ring(via.score, primary) if via else ''}</div><div><div class="kick">Pre-launch viability</div>
<div class="big">{_pm(via.score, via.margin, 0) if via else ''}<small>/100</small></div><span class="badge {tone}">{e(label)}</span><p class="verdict">{e(LABEL_TEXT.get(label, k.verdict))}</p></div></div>
<div class="tiles">{tiles_html}</div>
<div class="grid2"><div class="card"><h3>Key findings</h3><ul class="clean">{''.join(f'<li>{e(x)}</li>' for x in _findings(r))}</ul></div>
<div class="card"><h3>Do first</h3><ul class="clean acts">{top3 or '<li class="muted">No actions.</li>'}</ul><button class="link" data-go="actions">All actions</button></div></div></section>"""

    # ---------------- the ad
    img = f'<img id="ad-img" alt="The tested ad" src="{e(r.thumbnail)}" data-a="{e(r.thumbnail)}" data-b="{e(r.heatmap)}">' if r.thumbnail.startswith("data:image/") else ""
    zones = "".join(f'<li><span class="pill {"good" if p.verdict == "Strong" else "high" if p.verdict == "Weak" else "medium"}">{e(p.verdict)}</span><b>{e(p.label)}</b> <span class="muted">{p.area_pct:.1f}% of frame</span>'
                    f'<details><summary>Why</summary><p>{e(p.advice)}</p></details></li>' for p in v.placements)
    scores = "".join(f'<div class="meter"><span>{e(s.name)}</span><i><b style="width:{s.value * 10:.0f}%"></b></i><em>{s.value:.1f}</em></div>' for s in (rev.scores if rev else []))
    brief_rows = "".join(f'<tr><td class="muted">{e(a)}</td><td>{e(bv)}</td></tr>' for a, bv in [("Headline", b.headline), ("Copy", b.ad_copy), ("Category", b.category), ("Goal", (b.goal or "").title())] if bv)
    vid = ""
    if v.video and v.video.timeline:
        pts = v.video.timeline
        W, H = 520, 120
        x = lambda i: 20 + i * (W - 40) / max(1, len(pts) - 1)  # noqa: E731
        y = lambda a: H - 16 - a / 10 * (H - 32)  # noqa: E731
        path = " ".join(f"{'M' if i == 0 else 'L'}{x(i):.1f} {y(p.attention):.1f}" for i, p in enumerate(pts))
        dots = "".join(f'<circle cx="{x(i):.1f}" cy="{y(p.attention):.1f}" r="3.5" class="{"lo" if p.attention < 4 else ""}"><title>{p.second}s: {p.attention:.1f}. {e(p.note)}</title></circle>' for i, p in enumerate(pts))
        vid = f'<div class="card"><h3>Attention by second</h3><svg viewBox="0 0 {W} {H}" class="tl"><path d="{path}"/>{dots}</svg><p class="muted small">Hover a point for the second. Red: likely drop-off.</p></div>'
    the_ad = f"""<section id="t-ad" class="tab-pane" data-title="The ad">
<div class="grid2"><div class="card">{('<div class="seg"><button class="on" data-img="a">Ad</button><button data-img="b">Attention</button></div>' if r.heatmap.startswith('data:image/') else '')}{img}</div>
<div><div class="card"><h3>Where the eye goes</h3><p class="muted small">{e(rev.first_glance) if rev and rev.first_glance else ''}</p><ul class="clean zones">{zones}</ul></div>
<div class="card"><h3>Creative scores</h3>{scores}<div class="meter"><span>Readability</span><i><b style="width:{(rev.readability if rev else 0):.0f}%"></b></i><em>{(rev.readability if rev else 0):.0f}</em></div>
<div class="meter"><span>Clean layout</span><i><b style="width:{(rev.cleanliness if rev else 0):.0f}%"></b></i><em>{(rev.cleanliness if rev else 0):.0f}</em></div></div></div></div>
{vid}<details class="card"><summary>Brief</summary><table>{brief_rows}</table></details></section>"""

    # ---------------- audience
    aud = ""
    if pn:
        split = "".join(f'<i class="{cls}" style="width:{val:.1f}%" title="{lab} {val:.0f}%">{f"{val:.0f}%" if val >= 8 else ""}</i>'
                        for lab, val, cls in (("Positive", pn.positive, "good"), ("Neutral", pn.neutral, "neu"), ("Mocking", pn.troll, "warn"), ("Angry", pn.angry, "bad")))
        emo = "".join(f'<div class="meter"><span>{e(x.emotion)}</span><i><b style="width:{x.percent:.0f}%"></b></i><em>{x.percent:.0f}%</em></div>' for x in pn.emotions[:5])
        worries = "".join(f'<li>{e(x.text)} <span class="muted">({x.count})</span></li>' for x in pn.concerns[:4])
        aud = f"""<section id="t-audience" class="tab-pane" data-title="Audience">
<div class="tiles t4"><div class="tile"><span>People</span><b>{pn.size}</b><small>{f"x {pn.runs} runs" if pn.runs > 1 else ""}</small></div><div class="tile"><span>Would buy</span><b>{_pm(pn.purchase, pn.purchase_ci.margin if pn.purchase_ci else None)}</b><small>/10</small></div>
<div class="tile"><span>Would share</span><b>{_pm(pn.share, pn.share_ci.margin if pn.share_ci else None)}</b><small>/10</small></div><div class="tile"><span>Emotional pull</span><b>{pn.resonance:.1f}</b><small>/10</small></div></div>
<div class="card"><h3>Mood</h3><div class="split">{split}</div><p class="muted small">{'Weighted to Sri Lankan adults.' if pn.weighted else 'Not weighted.'}</p></div>
<div class="grid2"><div class="card"><h3>What they feel</h3>{emo}</div><div class="card"><h3>Top worries</h3><ul class="clean">{worries or '<li class="muted">None</li>'}</ul></div></div>
<div class="card"><h3>By group</h3><div class="seg" id="seg-kind"><button class="on" data-k="age">Age</button><button data-k="region">Where</button><button data-k="gender">Gender</button><button data-k="background">Background</button><button data-k="mindset">Mindset</button></div>
<div id="seg-list"></div><p class="muted small">Bar: would buy out of 10. Faded rows have fewer than 3 people.</p></div>
<div class="card"><h3>Every persona</h3><div class="filters"><input id="p-q" type="search" placeholder="Search name, town, comment"><div class="seg" id="p-mood"><button class="on" data-m="">All</button><button data-m="Positive">Positive</button><button data-m="Neutral">Neutral</button><button data-m="Troll">Mocking</button><button data-m="Angry">Angry</button></div></div>
<div id="p-list" class="plist"></div><button class="link" id="p-more">Show more</button></div></section>"""

    # ---------------- risk
    rtone = {"Low": "good", "Medium": "warn", "High": "bad", "Critical": "bad"}[c.risk_level]
    flags = "".join(f'<li><span class="pill {"high" if f.severity in ("High", "Critical") else "medium" if f.severity == "Medium" else "good"}">{e(f.severity)}</span><b>{e(f.where)}</b> <span class="muted">{e(f.category)}</span>'
                    f'<details><summary>Issue and fix</summary><p>{e(f.issue)}</p><p><b>Fix:</b> {e(f.suggestion)}</p></details></li>' for f in c.flags)
    s_ = c.reaction_split
    rsplit = "".join(f'<i class="{cls}" style="width:{val:.1f}%" title="{lab} {val:.0f}%">{f"{val:.0f}%" if val >= 8 else ""}</i>'
                     for lab, val, cls in (("Positive", s_.positive, "good"), ("Neutral", s_.neutral, "neu"), ("Trolling", s_.troll, "warn"), ("Angry", s_.angry, "bad")))
    wall = "".join(f'<div class="q"><q>{e(x.text)}</q><small>{e(x.language)} &middot; {e(x.reaction)}</small></div>' for x in c.crowd_comments[:6])
    risk = f"""<section id="t-risk" class="tab-pane" data-title="Culture and risk">
<div class="hero small"><div><span class="badge {rtone}">{e(c.risk_level)} risk</span></div><div><p class="verdict">{e(c.risk_summary)}</p><p class="muted small">Meme potential {c.meme_potential:.1f}/10</p></div></div>
<div class="card"><h3>Predicted public reaction</h3><div class="split">{rsplit}</div></div>
<div class="grid2"><div class="card"><h3>Flags</h3><ul class="clean zones">{flags or '<li class="muted">No flags.</li>'}</ul></div><div class="card"><h3>Sample comments</h3><div class="qs">{wall}</div></div></div></section>"""

    # ---------------- benchmarks
    brow = ""
    for x in r.benchmarks:
        t = "good" if x.verdict == "Strong" else "medium" if x.verdict == "Typical" else "high"
        brow += (f'<div class="bm"><div class="bm-h"><b>{e(x.label)}</b><span class="pill {t}">{e(x.verdict)}</span></div>'
                 f'<div class="band"><i class="typ" style="left:{x.typical_low:.0f}%;width:{max(1, x.typical_high - x.typical_low):.0f}%"></i><i class="pt {t}" style="left:{max(0, min(100, x.value)):.0f}%" title="This ad: {x.value:.0f}"></i></div>'
                 f'<div class="muted small">This ad {x.value:.0f} &middot; typical {x.typical_low:.0f} to {x.typical_high:.0f}{"" if x.higher_is_better else " (lower is better)"}</div></div>')
    bench = f"""<section id="t-bench" class="tab-pane" data-title="Benchmarks"><div class="card"><h3>Against typical bands</h3><div class="bms">{brow}</div>
<details><summary>About these bands</summary><p class="small">{e(r.benchmark_note)}</p></details></div></section>"""

    # ---------------- actions
    actions = f"""<section id="t-actions" class="tab-pane" data-title="Recommended actions"><div class="card"><h3>Recommended actions</h3>
<div class="seg" id="a-pri"><button class="on" data-p="">All</button><button data-p="High">High</button><button data-p="Medium">Medium</button><button data-p="Low">Low</button></div>
<p class="muted small">Tick an action when it is done. Ticks are saved in this browser.</p><ul class="clean checks" id="a-list"></ul></div></section>"""

    # ---------------- method
    wrows = "".join(f'<tr><td>{n}</td><td class="n">{via.parts.get(key, 0):.0f}</td><td class="n">{via.weights.get(key, 0) * 100:.0f}%</td></tr>'
                    for key, n in (("visual", "Visual impact"), ("hook", "Hook"), ("purchase", "Purchase intent"), ("share", "Share intent"), ("safety", "Safety"))) if via else ""
    u = r.usage
    method = f"""<section id="t-method" class="tab-pane" data-title="Method"><div class="card"><h3>How this was made</h3>
<ul class="clean"><li>Ad read by {e(r.model)}.</li><li>{pn.size if pn else len(r.personas)} simulated Sri Lankan consumers from a bank of 200{', weighted to the population' if pn and pn.weighted else ''}{f', {pn.runs} runs each' if pn and pn.runs > 1 else ''}.</li>
<li>Simulated reactions: use them to compare versions of an ad, not to forecast sales.</li></ul>
{f'<details><summary>How the viability score is built</summary><table><tr><th>Ingredient</th><th class="n">Value</th><th class="n">Weight</th></tr>{wrows}</table></details>' if via else ''}
<details><summary>All notes and limitations</summary><ul>{''.join(f'<li class="small">{e(x)}</li>' for x in r.caveats)}</ul><p class="small muted">{u.input_tokens:,} input and {u.output_tokens:,} output tokens, {u.calls} calls.</p></details></div></section>"""

    tabs = [("summary", "Summary"), ("ad", "The ad")] + ([("audience", "Audience")] if pn else []) + [("risk", "Culture and risk"), ("bench", "Benchmarks"), ("actions", "Actions"), ("method", "Method")]
    nav = "".join(f'<button data-go="{t}" class="{"on" if i == 0 else ""}">{e(l)}</button>' for i, (t, l) in enumerate(tabs))
    data = json.dumps(_data(r), ensure_ascii=False).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    key = re.sub(r"[^a-z0-9]+", "-", f"{brand}-{date.today().isoformat()}".lower())

    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pre-launch ad audit: {e(brand)}</title><style>{CSS.replace("__P__", primary)}</style></head><body>
<header class="top"><div class="brand"><div class="ag">{e(agency)}</div><div class="tt">Pre-launch ad audit &middot; <b>{e(brand)}</b>{(' &middot; ' + e(b.product)) if b.product else ''}</div></div>
<div class="sc"><span class="badge {tone}">{e(label)}</span><b>{f"{via.score:.0f}" if via else ''}</b><small>/100</small><button class="btn" onclick="window.print()">Print or save PDF</button></div>
<nav class="tabs">{nav}</nav></header>
<main>{summary}{the_ad}{aud}{risk}{bench}{actions}{method}</main>
<footer><span>{e(agency)} &middot; {date.today().strftime('%d %B %Y')} &middot; prepared for {e(client or brand)}</span><span>{e(footer)}</span></footer>
<script type="application/json" id="data">{data}</script>
<script>{JS.replace("__KEY__", key)}</script></body></html>"""


CSS = """
:root{--p:__P__;--ink:#14171f;--muted:#646b78;--line:#e6e9ef;--bg:#f4f6f9;--good:#13804b;--warn:#b26b00;--bad:#c42b3c}
*{box-sizing:border-box} html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 Inter,"Segoe UI",system-ui,-apple-system,"Noto Sans Sinhala","Iskoola Pota","Noto Sans Tamil","Latha",sans-serif}
.top{position:sticky;top:0;z-index:5;background:#fff;border-bottom:1px solid var(--line);display:grid;grid-template-columns:1fr auto;gap:6px 18px;padding:14px 28px 0}
.ag{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--p);font-weight:700} .tt{font-size:17px}
.sc{display:flex;align-items:center;gap:8px} .sc b{font-size:26px} .sc small{color:var(--muted)}
.tabs{grid-column:1/-1;display:flex;gap:4px;overflow-x:auto} .tabs button{border:0;background:none;padding:10px 14px;font:inherit;font-weight:600;color:var(--muted);border-bottom:3px solid transparent;cursor:pointer;white-space:nowrap}
.tabs button.on{color:var(--ink);border-bottom-color:var(--p)} .tabs button:hover{color:var(--ink)}
main{max-width:1040px;margin:0 auto;padding:24px 20px 40px} .tab-pane{display:none;animation:in .25s ease} .tab-pane.on{display:block} @keyframes in{from{opacity:0;transform:translateY(6px)}}
h3{margin:0 0 10px;font-size:15px} p{margin:6px 0} .muted{color:var(--muted)} .small{font-size:12.5px}
.card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:18px;margin:0 0 14px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px} .grid2>.card,.grid2>div>.card{margin-bottom:14px}
.hero{display:flex;gap:22px;align-items:center;background:#fff;border:1px solid var(--line);border-radius:16px;padding:20px 24px;margin-bottom:14px} .hero.small{padding:16px 20px}
.ring{width:118px;height:118px} .ring .rn{font-size:30px;font-weight:800;fill:var(--ink)} .ring .arc{animation:arc 1.2s ease} @keyframes arc{from{stroke-dashoffset:var(--c)}}
.kick{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:700} .big{font-size:40px;font-weight:800;line-height:1.1} .big small{font-size:15px;color:var(--muted)}
.verdict{font-size:16px;font-weight:600;margin:8px 0 0}
.badge{display:inline-block;padding:3px 11px;border-radius:999px;font-size:12px;font-weight:700;background:#eef0f4} .badge.good{background:#e5f5ec;color:var(--good)} .badge.warn{background:#fff3df;color:var(--warn)} .badge.bad{background:#fde8eb;color:var(--bad)}
.tiles{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:14px} .tiles.t4{grid-template-columns:repeat(4,1fr)}
.tile{background:#fff;border:1px solid var(--line);border-radius:12px;padding:12px 14px} .tile span{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:700} .tile b{font-size:22px} .tile small{color:var(--muted);margin-left:3px}
ul.clean{list-style:none;margin:0;padding:0} ul.clean li{padding:7px 0;border-bottom:1px solid var(--line)} ul.clean li:last-child{border-bottom:0}
.pill{display:inline-block;min-width:58px;text-align:center;font-size:11px;font-weight:700;border-radius:999px;padding:2px 8px;margin-right:8px;background:#eef0f4}
.pill.high{background:#fde8eb;color:var(--bad)} .pill.medium{background:#fff3df;color:var(--warn)} .pill.low{background:#eef0f4;color:var(--muted)} .pill.good{background:#e5f5ec;color:var(--good)}
.link{border:0;background:none;color:var(--p);font:inherit;font-weight:600;cursor:pointer;padding:6px 0}
.btn{border:1px solid var(--line);background:#fff;border-radius:999px;padding:7px 14px;font:inherit;font-weight:600;cursor:pointer} .btn:hover{border-color:var(--p)}
.seg{display:inline-flex;flex-wrap:wrap;gap:2px;background:#eef0f4;border-radius:10px;padding:3px;margin-bottom:10px} .seg button{border:0;background:none;padding:6px 12px;border-radius:8px;font:inherit;font-size:13px;font-weight:600;color:var(--muted);cursor:pointer}
.seg button.on{background:#fff;color:var(--ink);box-shadow:0 1px 3px rgba(0,0,0,.12)}
img{max-width:100%;border-radius:10px;border:1px solid var(--line);display:block}
.meter{display:grid;grid-template-columns:130px 1fr 44px;gap:10px;align-items:center;margin:6px 0;font-size:13px} .meter i{height:8px;background:#eef0f4;border-radius:4px;overflow:hidden} .meter i b{display:block;height:100%;background:var(--p);border-radius:4px;animation:grow .9s ease} .meter em{font-style:normal;text-align:right;font-weight:600}
@keyframes grow{from{width:0}}
.split{display:flex;height:28px;border-radius:8px;overflow:hidden} .split i{display:flex;align-items:center;justify-content:center;color:#fff;font-style:normal;font-size:12px;font-weight:700;animation:grow .9s ease}
.split .good{background:var(--good)} .split .neu{background:#9aa3b5} .split .warn{background:#d98a00} .split .bad{background:var(--bad)}
details summary{cursor:pointer;color:var(--p);font-weight:600;font-size:13px;margin-top:6px} details.card summary{font-size:15px;color:var(--ink)}
.zones details p{margin:6px 0 0;font-size:13px}
table{width:100%;border-collapse:collapse;font-size:13px} td,th{padding:6px 8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top} .n{text-align:right}
.tl{width:100%} .tl path{fill:none;stroke:var(--p);stroke-width:2.5} .tl circle{fill:var(--p)} .tl circle.lo{fill:var(--bad)}
.seg-row{display:grid;grid-template-columns:150px 1fr 40px 90px;gap:10px;align-items:center;padding:6px 0;border-bottom:1px solid var(--line);font-size:13px} .seg-row.thin{opacity:.45}
.seg-row i{height:10px;background:#eef0f4;border-radius:5px;overflow:hidden} .seg-row i b{display:block;height:100%;background:var(--p)} .seg-row .mn{display:flex;height:8px;border-radius:4px;overflow:hidden;background:#eef0f4} .seg-row .mn b{background:var(--good)} .seg-row .mn s{background:var(--bad)}
.filters{display:flex;gap:10px;flex-wrap:wrap;align-items:center} .filters input{flex:1;min-width:200px;padding:8px 12px;border:1px solid var(--line);border-radius:10px;font:inherit}
.plist{display:grid;grid-template-columns:1fr 1fr;gap:10px} .pc{border:1px solid var(--line);border-radius:12px;padding:10px 12px} .pc .h{display:flex;justify-content:space-between;gap:8px} .pc q{display:block;margin:6px 0;font-size:14px}
.pc small{color:var(--muted)} .md{font-size:11px;font-weight:700;border-radius:999px;padding:1px 8px} .md.Positive{background:#e5f5ec;color:var(--good)} .md.Neutral{background:#eef0f4;color:var(--muted)} .md.Troll{background:#fff3df;color:var(--warn)} .md.Angry{background:#fde8eb;color:var(--bad)}
.qs{display:grid;gap:8px} .q{background:var(--bg);border-radius:10px;padding:8px 12px} .q q{display:block} .q small{color:var(--muted)}
.bms{display:grid;grid-template-columns:1fr 1fr;gap:12px} .bm-h{display:flex;justify-content:space-between;align-items:center} .band{position:relative;height:10px;background:#eef0f4;border-radius:5px;margin:10px 0 6px}
.band .typ{position:absolute;top:0;bottom:0;background:#c9cfdc;border-radius:5px} .band .pt{position:absolute;top:-4px;width:18px;height:18px;margin-left:-9px;border-radius:50%;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.25);background:var(--p)}
.band .pt.good{background:var(--good)} .band .pt.medium{background:var(--warn)} .band .pt.high{background:var(--bad)}
.checks li{display:flex;gap:10px;align-items:flex-start} .checks input{margin-top:3px;width:17px;height:17px;accent-color:var(--p)} .checks li.done .tx{text-decoration:line-through;color:var(--muted)} .checks .ar{display:block;font-size:12px;color:var(--muted)}
footer{max-width:1040px;margin:0 auto;padding:0 20px 30px;display:flex;justify-content:space-between;gap:14px;color:var(--muted);font-size:12px}
@media (max-width:760px){.grid2,.plist,.bms{grid-template-columns:1fr} .tiles,.tiles.t4{grid-template-columns:repeat(2,1fr)} .top{padding:12px 14px 0} .seg-row{grid-template-columns:110px 1fr 36px}}
@page{size:A4;margin:14mm}
@media print{body{background:#fff} .top{position:static} .tabs,.btn,.link,#p-more,.filters,#seg-kind,#a-pri,.seg{display:none!important} .tab-pane{display:block!important;break-before:page;animation:none}
 .tab-pane:first-of-type{break-before:auto} .tab-pane::before{content:attr(data-title);display:block;font-size:20px;font-weight:800;margin:0 0 12px}
 details{display:block} details>*{display:block} .card,.tile,.pc,.bm{break-inside:avoid}}
"""

JS = r"""
(function(){
  var D = JSON.parse(document.getElementById('data').textContent);
  var esc = function(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); };
  var $ = function(q, r){ return (r || document).querySelector(q); }, $$ = function(q, r){ return Array.prototype.slice.call((r || document).querySelectorAll(q)); };
  function go(t){ $$('.tab-pane').forEach(function(p){ p.classList.toggle('on', p.id === 't-' + t); }); $$('.tabs button').forEach(function(b){ b.classList.toggle('on', b.dataset.go === t); }); window.scrollTo(0, 0); try { history.replaceState(null, '', '#' + t); } catch (e) {} }
  $$('[data-go]').forEach(function(b){ b.addEventListener('click', function(){ go(b.dataset.go); }); });
  go((location.hash || '#summary').slice(1) || 'summary'); if (!$('.tab-pane.on')) go('summary');
  function seg(el, cb){ if (!el) return; $$('button', el).forEach(function(b){ b.addEventListener('click', function(){ $$('button', el).forEach(function(x){ x.classList.toggle('on', x === b); }); cb(b); }); }); }
  // ad / attention picture
  var img = $('#ad-img'); seg($('.tab-pane#t-ad .seg'), function(b){ if (img) img.src = b.dataset.img === 'b' ? img.dataset.b : img.dataset.a; });
  // segments
  function drawSeg(k){ var host = $('#seg-list'); if (!host) return; var rows = D.segments.filter(function(s){ return s.k === k; }).sort(function(a, b){ return b.buy - a.buy; });
    host.innerHTML = rows.map(function(s){ return '<div class="seg-row' + (s.n < 3 ? ' thin' : '') + '"><span>' + esc(s.l) + ' <span class="muted">' + s.n + '</span></span><i><b style="width:' + (s.buy * 10) + '%"></b></i><b>' + s.buy.toFixed(1) + '</b><span class="mn" title="' + s.pos.toFixed(0) + '% positive, ' + s.neg.toFixed(0) + '% mocking or angry"><b style="width:' + s.pos + '%"></b><span style="flex:1"></span><s style="width:' + s.neg + '%"></s></span></div>'; }).join(''); }
  seg($('#seg-kind'), function(b){ drawSeg(b.dataset.k); }); drawSeg('age');
  // personas
  var mood = '', shown = 12;
  function drawP(){ var host = $('#p-list'); if (!host) return; var q = ($('#p-q').value || '').toLowerCase();
    var rows = D.personas.filter(function(p){ return (!mood || p.mood === mood) && (!q || (p.n + ' ' + p.p + ' ' + p.c + ' ' + p.m + ' ' + p.b).toLowerCase().indexOf(q) >= 0); });
    host.innerHTML = rows.slice(0, shown).map(function(p){ return '<div class="pc"><div class="h"><b>' + esc(p.n) + ', ' + p.a + '</b><span class="md ' + esc(p.mood) + '">' + esc(p.mood === 'Troll' ? 'Mocking' : p.mood) + '</span></div><small>' + esc(p.p) + ' &middot; ' + esc(p.m) + '</small><q>' + esc(p.c) + '</q><small>Buy ' + p.buy + '/10 &middot; share ' + p.share + '/10 &middot; ' + esc(p.lang) + '</small></div>'; }).join('') || '<p class="muted">Nobody matches.</p>';
    var more = $('#p-more'); if (more) more.style.display = rows.length > shown ? '' : 'none'; }
  if ($('#p-q')) { $('#p-q').addEventListener('input', function(){ shown = 12; drawP(); }); seg($('#p-mood'), function(b){ mood = b.dataset.m; shown = 12; drawP(); }); $('#p-more').addEventListener('click', function(){ shown += 24; drawP(); }); drawP(); }
  // actions with ticks saved in this browser
  var KEY = 'audit-done:__KEY__', done = {}; try { done = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) {}
  var pri = '';
  function drawA(){ var host = $('#a-list'); if (!host) return;
    host.innerHTML = D.actions.map(function(a, i){ return { a: a, i: i }; }).filter(function(x){ return !pri || x.a.p === pri; }).map(function(x){ var a = x.a, d = !!done[x.i];
      return '<li class="' + (d ? 'done' : '') + '"><input type="checkbox" data-i="' + x.i + '"' + (d ? ' checked' : '') + '><div><span class="pill ' + a.p.toLowerCase() + '">' + esc(a.p) + '</span><span class="tx">' + esc(a.t) + '</span><span class="ar">' + esc(a.a) + (a.w ? ' &middot; ' + esc(a.w) : '') + '</span></div></li>'; }).join('') || '<li class="muted">No actions.</li>';
    $$('input', host).forEach(function(c){ c.addEventListener('change', function(){ done[c.dataset.i] = c.checked; try { localStorage.setItem(KEY, JSON.stringify(done)); } catch (e) {} drawA(); }); }); }
  seg($('#a-pri'), function(b){ pri = b.dataset.p; drawA(); }); drawA();
  // printing shows every persona
  window.addEventListener('beforeprint', function(){ shown = 1e9; mood = ''; drawP(); });
})();
"""
