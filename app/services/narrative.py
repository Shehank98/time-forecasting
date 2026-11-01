"""Client-ready narrative for reports: Gemini output when available, otherwise a rule-based summary.

Every sentence is built only from numbers already in the report, so the automated
summary is as traceable as the tables it sits next to.
"""
from __future__ import annotations

from typing import Any


def _money(v: float | None) -> str:
    if v is None:
        return "n/a"
    a = abs(v)
    if a >= 1e9:
        return f"LKR {v / 1e9:,.2f}B"
    if a >= 1e6:
        return f"LKR {v / 1e6:,.1f}M"
    return f"LKR {v:,.0f}"


def fmt_value(v: float | None, unit: str) -> str:
    if v is None:
        return "n/a"
    if unit == "currency":
        return _money(v)
    if unit == "percent":
        return f"{v:.1f}%"
    if unit == "rating":
        return f"{v:,.2f}"
    return f"{v:,.0f}" if abs(v) >= 10 else f"{v:,.2f}"


def _pct(v: float | None) -> str:
    return "n/a" if v is None else f"{v:+.0f}%"


def forecast_points(fc: dict | None) -> tuple[list[str], list[str], list[str]]:
    """(findings, actions, watch-outs) from a forecast result."""
    if not fc or not fc.get("ok"):
        return [], [], []
    rs = fc["results"]
    p = fc["params"]
    finds, acts, watch = [], [], []
    label = rs[0].get("metric_label", p.get("metric"))
    unit = rs[0].get("unit", "number")
    if len(rs) == 1:
        r = rs[0]
        o = r["outlook"]
        exp = o["expected_next_4w"] if o.get("additive") else o.get("avg_next_4w")
        finds.append(f"Forecast for {label} ({r['entity']}): {o['trend']} ({_pct(o.get('trend_change_pct'))} vs recent), "
                     f"about {fmt_value(exp, unit)} over the next {o['n_weeks']} {o.get('block', 'week')}s ({r['reliability']['level']} reliability).")
    else:
        rising = sorted([r for r in rs if r["outlook"]["trend"] == "rising"], key=lambda r: -(r["outlook"]["trend_change_pct"] or 0))
        falling = sorted([r for r in rs if r["outlook"]["trend"] == "falling"], key=lambda r: (r["outlook"]["trend_change_pct"] or 0))
        if rising:
            finds.append(f"Forecast for {label}: rising for " + ", ".join(f"{r['entity']} ({_pct(r['outlook']['trend_change_pct'])})" for r in rising[:3]) + ".")
        if falling:
            finds.append(f"Forecast for {label}: falling for " + ", ".join(f"{r['entity']} ({_pct(r['outlook']['trend_change_pct'])})" for r in falling[:3]) + ".")
        if p.get("entity_type") == "timebelt" and rising:
            acts.append(f"Secure inventory early in the emerging time-belts ({', '.join(r['entity'] for r in rising[:3])}) before rates follow the audience.")
        if p.get("entity_type") == "timebelt" and falling:
            acts.append(f"Review buys in declining time-belts ({', '.join(r['entity'] for r in falling[:3])}) and negotiate or move weight.")
        if p.get("entity_type") == "advertiser" and rising:
            acts.append(f"Expect more pressure from {rising[0]['entity']}; protect the client's key dayparts and consider a defensive burst.")
    for r in rs:
        pk = (r.get("peaks") or {}).get("peaks") or []
        if pk:
            finds.append(f"{r['entity']}: demand peak expected around {pk[0]['date']}.")
            acts.append(f"Be live for {r['entity']} by {pk[0]['launch_by']} to get ahead of the peak.")
            break
    for r in rs:
        for b in (r.get("band_breaches") or [])[:1]:
            watch.append(f"{r['entity']}: {b['text']}. Check tracking and delivery.")
    low = [r["entity"] for r in rs if r["reliability"]["level"] == "Low"]
    if low:
        watch.append("Treat these forecasts as directional because history is thin or the backtest was weak: " + ", ".join(low[:5]) + ".")
    if fc.get("backend") == "fallback":
        watch.append("The main forecast model was not available for this run, so a statistical fallback produced the forecast.")
    return finds, acts, watch


def scenario_points(sc: dict | None) -> tuple[list[str], list[str], list[str]]:
    if not sc or not sc.get("ok"):
        return [], [], []
    p, rows = sc["params"], sc["scenarios"]
    ratio = p.get("ratio_label", "cost per result")
    base = next((r for r in rows if r["scenario"] == "Current pace"), None)
    hist = sc.get("historical_ratio")
    finds, acts = [], []
    watch = [w for w in sc.get("warnings", []) if "partial" not in w and "interpolation" not in w][:2]
    show = [r for r in rows if r is base] + sorted([r for r in rows if r is not base], key=lambda r: -r["driver_total"])[:1]
    for r in show:
        finds.append(f"{r['scenario']}: {_money(r['driver_total'])} is expected to deliver about {r['kpi_p50']:,.0f} results "
                     f"({r['kpi_p10']:,.0f} to {r['kpi_p90']:,.0f}) at {_money(r['ratio_p50'])} {ratio}.")
    if base and hist:
        ok = [r for r in rows if r["driver_total"] > base["driver_total"] and r.get("marginal_ratio") and r["marginal_ratio"] <= hist * 1.5]
        if ok:
            best = max(ok, key=lambda r: r["driver_total"])
            acts.append(f"Move to '{best['scenario']}': each extra result costs about {_money(best['marginal_ratio'])}, within 1.5x the historical {ratio} of {_money(hist)}.")
        else:
            acts.append(f"Hold spend near the current pace: extra budget buys results above 1.5x the historical {ratio} of {_money(hist)}.")
    return finds, acts, watch


def pacing_points(pc: dict | None) -> tuple[list[str], list[str], list[str]]:
    if not pc or not pc.get("ok"):
        return [], [], []
    unit = "currency" if pc.get("metric") in ("spend",) or "spend" in pc.get("metric", "") or "cost" in pc.get("metric", "") else "number"
    f = [f"Pacing for {pc['metric_label']} ({pc['entity']}): {pc['status'].lower()}. {fmt_value(pc['actual_to_date'], unit)} delivered so far ({pc['pct_of_target']:.0f}% of target with "
         f"{pc['time_elapsed_pct']:.0f}% of the flight gone); projected end total {fmt_value(pc['projected_p50'], unit)} against a target of {fmt_value(pc['target'], unit)}."]
    a = []
    if pc["status"] == "Under pacing" and pc.get("required_per_day"):
        a.append(f"Raise delivery to about {fmt_value(pc['required_per_day'], unit)} per day (recent run rate {fmt_value(pc['recent_run_rate'], unit)}) to land the target.")
    elif pc["status"] == "Over pacing":
        a.append("Ease delivery or extend the flight so the budget is not exhausted early.")
    return f, a, []


def workspace_points(kind: str, dash: dict) -> tuple[list[str], list[str]]:
    finds, acts = [], []
    if dash.get("empty"):
        return finds, acts
    if kind == "lmrb":
        k = dash["kpis"]
        finds.append(f"Category spend in the window was {_money(k['total_spend'])} across {k['spots']:,} spots on {k['active_channels']} channels.")
        if k.get("sov_spend_pct") is not None:
            finds.append(f"{dash.get('my_brand')} holds {k['sov_spend_pct']:.1f}% share of voice by spend (rank {k.get('my_rank')} of {k['active_advertisers']}).")
        g = dash.get("grp")
        if g and g.get("my_grp_share_pct") is not None:
            finds.append(f"Measured in audience, the client holds {g['my_grp_share_pct']:.1f}% of GRPs at a CPRP of {_money(g['my_cprp'])} versus a market average of {_money(g['cprp'])}.")
            if g["my_cprp"] and g["cprp"] and g["my_cprp"] > g["cprp"] * 1.1:
                acts.append("The client pays above the market CPRP. Rebalance towards the channels and dayparts with the lowest CPRP in the heatmap.")
        for a in dash["alerts"]["items"][:3]:
            finds.append(a["text"])
    elif kind == "tv":
        k = dash["kpis"]
        finds.append(f"{k['programmes']} programmes across {k['channels']} channels averaged a TVR of {k['avg_tvr']:.2f}. "
                     f"Top programme: {k['top_programme']['name']} on {k['top_programme']['channel']} ({k['top_programme']['avg_tvr']:.2f}).")
        rel = [c for c in dash.get("consistency", []) if c["reliability"] in ("Very reliable", "Reliable")][:3]
        if rel:
            acts.append("Anchor schedules on reliable slots: " + "; ".join(f"{c['program']} ({c['channel']}, {c['day']} {c['start']})" for c in rel) + ".")
        if dash.get("opportunity") and dash["opportunity"]["rows"]:
            o = dash["opportunity"]["rows"][0]
            acts.append(f"Test {o['channel']} {o['day']} {o['daypart'].lower()}: strong TVR ({o['avg_tvr']:.2f}) with light competitor ad load.")
    else:
        moved = [k for k in dash["kpis"] if k.get("change_pct") is not None and abs(k["change_pct"]) >= 5]
        for k in sorted(moved, key=lambda k: -abs(k["change_pct"]))[:3]:
            finds.append(f"{k['label']} {'rose' if k['change_pct'] > 0 else 'fell'} {abs(k['change_pct']):.0f}% against the previous period, to "
                         f"{fmt_value(k['value'], 'currency' if k['agg'] == 'ratio' else k['unit'])}.")
        segs, first = dash.get("segments") or [], next((m for m in dash.get("metrics", []) if m["agg"] == "sum"), None)
        if segs and first and segs[0].get("share_pct") is not None:
            finds.append(f"{segs[0]['segment']} carries {segs[0]['share_pct']:.0f}% of {first['label']}.")
        for e in dash.get("driver_effects", [])[:1]:
            finds.append(e["text"])
    return finds, acts


def story(rep: Any) -> dict:
    """Executive summary, findings, recommendations and watch-outs for a report."""
    f1, a1, w1 = forecast_points(rep.forecast)
    f2, a2, w2 = scenario_points(rep.scenarios)
    f3, a3, w3 = pacing_points(rep.pacing)
    f4, a4 = workspace_points(rep.kind, rep.dash)
    findings = list(getattr(rep, "evidence", []) or [])[:4] + f1 + f3 + f2 + f4
    actions = a1 + a2 + a3 + a4
    watch = w1 + w2 + w3
    if rep.ai:
        ai = rep.ai
        headline = ai["executive_summary"]["statement"]
        ai_actions = [i["statement"] for i in ai.get("recommended_actions", [])]
        return {"source": "gemini", "headline": headline, "findings": [i["statement"] for i in ai.get("competitor_moves", []) + ai.get("predicted_behaviour", [])][:5] or findings[:5],
                "actions": ai_actions or actions, "watch": list(ai.get("data_caveats", []))[:4] + watch[:2],
                "threats": [i["statement"] for i in ai.get("threats", [])], "opportunities": [i["statement"] for i in ai.get("opportunities", [])]}
    headline = findings[0] if findings else "The selected data is summarised below."
    return {"source": "rules", "headline": headline, "findings": findings[1:6], "actions": actions[:6] or ["Review the forecast and scenario sections and agree the plan for the next flight."],
            "watch": watch[:4], "threats": [], "opportunities": []}


METHODOLOGY = [
    "Forecasts use the Media Radar forecast engine, an advanced time-series model that forecasts without being trained on each client's data.",
    "The model returns a probabilistic forecast: the most likely value (P50) is the central estimate, the low case (P10) is a safe floor and the high case (P90) is the upside. The range between the low and high case is expected to contain the outcome about 8 times in 10. All forecast numbers are estimates, not recorded data.",
    "Weekday, Poya days, Sinhala and Tamil New Year, Vesak, Christmas and school holidays enter as calendar covariates where history allows.",
    "Every series is backtested: the last periods are hidden, forecast, and scored with sMAPE, MAE and MASE against a seasonal naive baseline.",
    "Reliability is High when history is long enough and the backtest beats the baseline clearly, Medium when it is acceptable, and Low when history is thin or errors are large.",
    "Spend scenarios add the planned spend as a covariate, so results and cost per result move with budget the way they have in the client's own history.",
    "Pacing adds actual delivery to date to the forecast for the remaining days of the flight.",
    "GRPs are estimated by matching each spot to the programme airing at that time and using the programme's average TVR for the chosen audience.",
]
