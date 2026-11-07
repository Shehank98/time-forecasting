# Client Pitch Evaluator: audit

Scope: engine (`engine/pitch*.js`), page (`pitch-page.js`), Excel builder (`export_eval.py`), rate card service. Data used: the generated sample (Sampath Bank, 3 TV channels, 2 months). **Nothing here was run on a real LMRB / TVR file**, so matching quality on real names is not audited.

## 1. What was checked and how

| Area | Method | Result |
|---|---|---|
| Spend conservation | Independent pass over the sheet: programmes + sponsorship + unmatched must equal every TV row in view, for month all / each month / advertiser / channel filter (new test `test_no_spend_or_spot_is_lost_or_counted_twice`) | Exact (to the rupee) in all 5 cases |
| Spot conservation | Spots in view read straight from the sheet vs rows counted | Exact |
| Row maths | 30 sec equivalents, GRP, NGRP, CPRP, rate card value, ROI recomputed in pandas (existing `test_pitch.py` references) and re-proved live on every row (Number checks panel) | All agree |
| Duration handling | Programme rows and sponsorship items carry real durations, never an average (tests added earlier) | Fixed earlier this week (sponsorship was averaged) |
| Plan | Spend never above budget for suggested channels; total = sum of rows | Holds |
| Bad rows | Rows with no duration, zero cost, negative cost | No crash; **were silent**, now counted and shown (see 2.1) |
| Excel | Recalculated in LibreOffice: no error cells; commercial / bonus / all-exposure totals match the engine | Holds |

## 2. Findings and what was done

1. **Silent assumptions (fixed).** A row with no duration was counted as 30 seconds, and zero or negative cost rows were absorbed, without a word. The engine now returns an `audit` block (`view_spend`, `view_spots`, `no_duration_rows`, `zero_cost_rows`, `negative_cost_rows`) and the Data checks list says how many rows are affected and how they are treated.
2. **Stale evaluations (fixed).** A current agency estimate built for one month, advertiser, filter set or set of match approvals stayed on screen after any of them changed, so a card could show last month's numbers under this month's header. The estimate is now cleared with a message when its inputs change. (Our plan evaluations keep your edits, because they are your decisions, not data.)
3. **No proof of the numbers on screen (fixed).** Added **Number checks** (Export tab): nine live checks that re-prove the totals against the sheet and the row formulas. A cross or a missing tick means something is wrong. Added **How every number is calculated** (Export and Comparison).
4. **Comparison was totals only (fixed).** Added a **By channel** table: spend, GRPs, CPRP and ROI, current against plan, with the change.
5. **No view of "is this ready to pitch" (fixed).** Added a **Ready to pitch** strip under the filters: advertiser chosen, matches checked, rate card imported, rate coverage, investment or discount entered, evaluations built. Each chip opens the place where it is fixed. If the LMRB has only one advertiser, it is selected automatically.

## 3. Known limits (not fixed, stated plainly)

- **Prime share is a target, not a hard cap** in the optimiser (what one side cannot spend moves to the other). The meter shows the real split.
- **Programme TVR is the average over all airings in the TVR sheet**, not the chosen month. Right for planning, but it is not "the TVR in September".
- **Sponsorship TVR is an estimate** (channel prime / non prime average, weighted by the item's prime and non prime spots).
- **Plan programmes are always 30 sec.** Only the current buy has mixed durations.
- **Matching** depends on the data; the sample is clean. On real data the "to check" list is the control: approve it before pitching (the Ready strip warns).
- **Tax** is not in any on-screen number; the Excel has SSCL and VAT cells.
- **The browser flows are tested by Playwright scripts that are not in the repository.** The engine and the Excel builder are covered by pytest.

## 4. Implemented after the audit

1. **Guided steps.** The Ready strip is now seven numbered steps (Advertiser, Matches, Rate card, Rates cover, Investment or discount, Current estimate, Our plan) with a "Next step" line; the next undone step is highlighted and each opens where it is done.
2. **Scenarios.** Comparison has a Scenarios table: save the plan under a name (12 kept per client), compare spend, GRPs, CPRP and ROI against the unsaved plan, load or delete. Loading restores investments, discounts, built channels and switched-off programmes.
3. **Undo** in every channel window (button and Ctrl/Cmd+Z, 40 steps).
4. **Working on hover.** Value, cost, GRP and CPRP cells in the channel window show their calculation (for example `Cost 14,608,000 / NGRP 339.5`).
5. **Focus.** The channel window takes focus on open, is labelled for screen readers, and returns focus to the card on close.
6. **Rate card freshness.** The Rate card step shows its effective date and warns when it is more than 6 months old.

## 5. Still open

- **A trial on a real LMRB / TVR pair** (the one check that could change numbers).
- **One-page print / PDF pitch view** built from the Comparison.
- **Arrow-key row editing** and a contrast check of every new element in all 12 skins (the new elements use the theme variables, but only the default skin was looked at).
