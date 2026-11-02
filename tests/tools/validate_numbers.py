# Usage: run the browser capture (tests/tools is not part of pytest) then: python tests/tools/validate_numbers.py <folder with cap/, tv2y.csv, lm2y.csv>
"""Independent check of the forecast pages: recompute from the raw CSVs and compare with what the app sent, got back and drew."""
import json, sys, math, re
import pandas as pd, numpy as np
S = sys.argv[1]
net = json.load(open(f"{S}/cap/net.json"))
fails, passes = [], 0
def ok(cond, msg):
    global passes
    if cond: passes += 1
    else: fails.append(msg)
def close(a, b, rel=1e-6, abs_=1e-6): return a is not None and b is not None and math.isclose(float(a), float(b), rel_tol=rel, abs_tol=abs_)

# ---- raw data
tv = pd.read_csv(f"{S}/tv2y.csv"); tv["d"] = pd.to_datetime(tv["Date"].astype(str), format="%Y/%m/%d"); tv["m"] = tv["d"].dt.to_period("M")
lm = pd.read_csv(f"{S}/lm2y.csv"); lm["d"] = pd.to_datetime(dict(year=lm.Yr, month=lm.Mn, day=lm.Dd)); lm["m"] = lm["d"].dt.to_period("M")
def mtl(p): return pd.Period(p[:7], "M")

# ---- requests: find the monthly payloads
def payload(kind, gran, group, entity=None):
    for r in reversed(net["reqs"]):
        b = r["body"]
        if b["kind"] == kind and b["params"].get("granularity") == gran:
            for s in b["series"]:
                if s["group"] == group and (entity is None or s["entity"] == entity): return s
    return None
# results by (group, granularity), latest wins
res = {}
for j in net["jobs"]:
    r = j.get("result")
    if r and r.get("ok"):
        for x in r["results"]: res[(x["group"], x["granularity"], x["entity"])] = x
def R(group, gran="monthly"): return [x for (g, gr, e), x in res.items() if g == group and gr == gran]

# 1. TVR history: monthly average TVR
s = payload("tv", "monthly", "tvr_total")
exp = tv.groupby("m")["TVR"].mean()
ok(s is not None, "tvr_total monthly payload not found")
if s:
    got = dict(zip([mtl(d) for d in s["dates"]], s["values"]))
    bad = [m for m in exp.index if not close(got.get(m), exp[m], 1e-5)]
    ok(not bad and len(got) == len(exp), f"tvr_total monthly history differs from raw CSV in {len(bad)} months: {bad[:3]}")
    print(f"TVR monthly history: {len(exp)} months compared with the raw sheet")
# 2. channel audience share history
tv["ch"] = tv["Channel"].str.upper().str.replace(r"^TV - ", "", regex=True).str.replace(r" TV$", "", regex=True).str.strip()
sh = tv.groupby(["m", "ch"])["TVR"].sum().unstack(fill_value=0); sh = sh.div(sh.sum(axis=1), axis=0) * 100
n_checked = 0
for s in [x for r in reversed(net["reqs"]) if r["body"]["kind"] == "tv" and r["body"]["params"].get("granularity") == "monthly" for x in r["body"]["series"] if x["group"] == "channel_share"][:12]:
    e = s["entity"]
    if e in sh.columns:
        for d, v in zip(s["dates"], s["values"]):
            ok(close(v, sh.loc[mtl(d), e], 1e-5), f"channel_share {e} {d}: app {v} vs raw {sh.loc[mtl(d), e]}"); n_checked += 1
    break
print(f"Channel audience share history: {n_checked} points compared with the raw sheet")
# 3. LMRB advertiser monthly spend
n = 0
for r in reversed(net["reqs"]):
    b = r["body"]
    if b["kind"] == "lmrb" and b["params"].get("granularity") == "monthly":
        for s in b["series"]:
            if s["group"] == "comp_spend":
                e = s["entity"]; exp = lm[lm.Advertiser == e].groupby("m")["Cost"].sum()
                for d, v in zip(s["dates"], s["values"]):
                    ok(close(v, exp.get(mtl(d), 0.0), 1e-9), f"comp_spend {e} {d}: app {v} vs raw {exp.get(mtl(d), 0.0)}"); n += 1
        break
print(f"Competitor monthly spend history: {n} points compared with the raw sheet")
# 4. result integrity
n = 0
for (g, gr, e), x in res.items():
    f = x["forecast"]
    for k in range(len(f["dates"])):
        p10, p50, p90 = f["p10"][k], f["p50"][k], f["p90"][k]
        ok(all(v is not None and math.isfinite(v) for v in (p10, p50, p90)), f"{g}/{e} {f['dates'][k]} has a missing forecast value")
        ok(p10 <= p50 + 1e-9 <= p90 + 2e-9, f"{g}/{e} {f['dates'][k]}: P10 {p10} P50 {p50} P90 {p90} not ordered")
        ok(p10 >= -1e-9, f"{g}/{e} negative P10 {p10}"); n += 1
    if not g.startswith("stealth_"):      # the stealth detector deliberately forecasts 14 days
        ok(len(f["dates"]) >= {"monthly": 12, "weekly": 9}.get(gr, 60), f"{g}/{e} {gr}: only {len(f['dates'])} forecast points")
print(f"Forecast integrity: {n} forecast points have finite, ordered, non-negative P10 <= P50 <= P90")
# share groups never exceed 100% in total
for g in ("channel_share", "cat_share", "sov", "chan_mix"):
    for gr in ("monthly", "daily"):
        rs = R(g, gr)
        if not rs: continue
        k = min(len(r["forecast"]["dates"]) for r in rs)
        tot = [sum(r["forecast"]["p50"][i] for r in rs) for i in range(k)]
        ok(max(tot) <= 100.0 + 5, f"{g} {gr}: forecast shares sum to {max(tot):.1f}% (> 100%)")
        hist = [sum(r["history"]["values"][-1] for r in rs)]
        print(f"  {g} {gr}: forecast shares sum {min(tot):.1f}% to {max(tot):.1f}% across {len(rs)} series")

# 5. what the page shows
def lkrc(v):
    a = abs(v)
    if a >= 1e9: return f"LKR {v/1e9:.1f}B"
    if a >= 1e6: return f"LKR {v/1e6:.1f}M"
    if a >= 1e3: return f"LKR {v/1e3:.1f}K"
    return f"LKR {v:.0f}"
mean = lambda a: float(np.mean(a))
cap = {k: json.load(open(f"{S}/cap/{k}.json")) for k in ("tv_monthly", "tv_daily", "lm_monthly", "lm_daily")}
def tile(c, label): return next((k for k in c["kpis"] if k["label"].lower().startswith(label.lower())), None)
for mode, H, gran in (("monthly", 6, "monthly"), ("daily", 14, "daily")):
    c = cap[f"tv_{mode}"]; tot = R("tvr_total", gran)[0]
    p50 = mean(tot["forecast"]["p50"][:H]); p10 = mean(tot["forecast"]["p10"][:H])
    t = tile(c, "Projected average TVR"); ok(t and t["value"] == f"{p50:.2f}", f"TVR tile {mode}: shows {t and t['value']} expected {p50:.2f}")
    t = tile(c, "Guaranteed minimum TVR"); ok(t and t["value"] == f"{p10:.2f}", f"P10 tile {mode}: shows {t and t['value']} expected {p10:.2f}")
    rc = R("reach_total", gran)
    if rc:
        t = tile(c, "Projected reach"); e = mean(rc[0]["forecast"]["p50"][:H]); ok(t and t["value"] == f"{e:.1f}%", f"Reach tile {mode}: shows {t and t['value']} expected {e:.1f}%")
    print(f"TVR tiles ({mode}, next {H}): average {p50:.2f}, guaranteed {p10:.2f} - match the page")
    c = cap[f"lm_{mode}"]; comp = R("comp_spend", gran); sp = R("spots_total", gran)[0]
    e = sum(sum(x["forecast"]["p50"][:H]) for x in comp)
    t = tile(c, "Predicted competitor spend"); ok(t and t["value"] == lkrc(e), f"Competitor spend tile {mode}: shows {t and t['value']} expected {lkrc(e)}")
    e2 = sum(sp["forecast"]["p50"][:H]); t = tile(c, "Predicted spot volume"); ok(t and t["value"] == f"{round(e2):,}", f"Spot volume tile {mode}: shows {t and t['value']} expected {round(e2):,}")
    print(f"Market tiles ({mode}): competitor spend {lkrc(e)}, spot volume {round(e2):,} - match the page")
# 6. drawn share charts
def fmt_title(s): return " ".join(w.capitalize() for w in re.split(r"\s+", s.lower()))
for mode, gran, NOW, H, tag in (("monthly", "monthly", 3, 6, "tv_monthly"), ("monthly", "monthly", 3, 6, "lm_monthly")):
    c = cap[tag]
    for cid, g in (("pt-chshare", "channel_share"), ("pt-cat", "cat_share"), ("pm-sov", "sov"), ("pm-chmix", "chan_mix")):
        ch = next((x for x in c["charts"] if x["id"] == cid), None)
        if not ch: continue
        rs = R(g, gran); exp_now = sorted(round(mean(r["history"]["values"][-NOW:]), 4) for r in rs[:10] if True)
        drawn_now = sorted(round(v, 4) for v in ch["datasets"][0]["data"])
        exp_next = sorted(round(mean(r["forecast"]["p50"][:H]), 4) for r in rs)[-len(ch["datasets"][1]["data"]):]
        drawn_next = sorted(round(v, 4) for v in ch["datasets"][1]["data"])
        ok(all(any(abs(a - b) < 1e-3 for b in exp_next) for a in drawn_next), f"{cid} forecast bars differ from recomputed forecast shares: {drawn_next} vs {exp_next}")
        ok(all(any(abs(a - b) < 1e-3 for b in [round(mean(r['history']['values'][-NOW:]), 4) for r in rs]) for a in drawn_now), f"{cid} 'now' bars differ from recomputed recent shares")
        print(f"  chart {cid}: {len(drawn_next)} bars match the recomputed shares")

# 7. every series in a chart group shares the same dates (charts place series by position)
from collections import defaultdict
grp = defaultdict(list)
for (g, gr, e), x in res.items(): grp[(g, gr)].append(x)
for (g, gr), xs in grp.items():
    ends = {x["history"]["dates"][-1] for x in xs}; f0 = {x["forecast"]["dates"][0] for x in xs}
    ok(len(ends) == 1 and len(f0) == 1, f"group {g} {gr}: series end on different dates {sorted(ends)[:3]} / forecasts start {sorted(f0)[:3]}")
print(f"Alignment: {len(grp)} chart groups checked, every series in a group ends and starts its forecast on the same date")
# 8. backtest integrity: actuals are the recorded values, predictions are finite, accuracy matches its definition
nb = 0
for (g, gr, e), x in res.items():
    b = x.get("backtest")
    if not b: continue
    hist = dict(zip(x["history"]["dates"], x["history"]["values"]))
    ok(all(close(hist.get(d), a, 1e-9, 1e-9) for d, a in zip(b["dates"], b["actual"])), f"backtest {g}/{e}: actuals differ from history")
    ok(len(b["pred"]) == b["holdout"] and all(math.isfinite(v) for v in b["pred"]), f"backtest {g}/{e}: bad predictions")
    if b.get("accuracy") is not None:
        ok(0 <= b["accuracy"] <= 100, f"backtest {g}/{e}: accuracy {b['accuracy']} outside 0-100")
    if b.get("accuracy_planning") is not None:
        ok(0 <= b["accuracy_planning"] <= 100, f"backtest {g}/{e}: planning accuracy out of range")
    ok(b.get("engine", {}).get("chosen") in ("plain", "recent", "timesfm + xreg", "xreg + timesfm", "blend"), f"backtest {g}/{e}: unknown method")
    nb += 1
print(f"Backtests: {nb} series checked (actuals = recorded values, finite predictions, accuracy in range)")
# 9. programme buys: weekly spot counts per programme and per rival-programme equal the raw sheet
lm["wk"] = (lm["d"] - pd.to_timedelta(lm["d"].dt.dayofweek, unit="D")).dt.strftime("%Y-%m-%d")
_al = json.load(open("/home/user/time-forecasting/app/config/channel_aliases.json"))
_lk = {}
for k, v in _al.items():
    if k.startswith("_"): continue
    for a in [k] + list(v): _lk[re.sub(r"\s+", " ", a.strip().upper())] = k
def canon(x):
    c = re.sub(r"\s+", " ", re.sub(r"^TV\s*[-:]\s*", "", str(x).strip(), flags=re.I).upper())
    return _lk.get(c, c)
lm["chc"] = lm["Channel"].map(canon); lm["pg"] = lm["Program"].astype(str).str.strip()
npb = nmiss = 0
for r in reversed(net["reqs"]):
    b = r["body"]
    if b["kind"] != "lmrb" or b["params"].get("granularity") != "weekly": continue
    comp = next((s_ for s_ in b["series"] if s_["group"] == "adv_prog"), None)
    if not comp: continue
    adv0 = comp["entity"].split(" | ")[0]; group = lm[lm.Advertiser == adv0]["Product_Group"].mode()[0]
    sub = lm[lm.Product_Group == group]
    for s_ in b["series"]:
        if s_["group"] not in ("prog_spots", "adv_prog"): continue
        if s_["group"] == "prog_spots": ent = s_["entity"]; rows = sub
        else: adv, ent = s_["entity"].split(" | ", 1); rows = sub[sub.Advertiser == adv]
        ch, prog = ent.split(" / ", 1)
        m = rows[(rows.chc == ch.upper()) & (rows.pg.str.upper() == prog.upper())]
        if not len(m): nmiss += 1; continue
        exp = m.groupby("wk").size()
        for d, v in zip(s_["dates"], s_["values"]):
            ok(close(v, exp.get(d, 0), 1e-9, 1e-9), f"{s_['group']} {s_['entity']} week {d}: app {v} vs raw {exp.get(d, 0)}"); npb += 1
    break
ok(nmiss == 0, f"programme buys: {nmiss} series could not be matched to the raw sheet by channel and programme name")
print(f"Programme buys: {npb} weekly counts compared with the raw sheet ({nmiss} unmatched series)")
print(f"\n{passes} checks passed, {len(fails)} failed")
for f in fails[:25]: print("FAIL:", f)
sys.exit(1 if fails else 0)
