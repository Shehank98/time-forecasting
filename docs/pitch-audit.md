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

## 4. Recommended next steps (UI and features, not yet built)

Ordered by value for a planner. Each is a separate piece of work.

1. **Guided flow.** A stepper on the page (Files, Advertiser, Matches, Rates, Current estimate, Plan, Compare, Export) with the Ready chips as its steps.
2. **Scenarios.** Save, name and compare several plans for one client (for example 90% vs 100% commercial, two discount levels), and an undo for edits in the channel window.
3. **Inline "why".** Click any number (CPRP, ROI, discount) to see its working for that row, using the same formulas as the Excel.
4. **Real-data trial.** Run on a real LMRB / TVR pair, and turn every surprise into a test. This is the one check that could change the numbers.
5. **Print and share view.** A one-page pitch summary (headline sentence, by channel table, top programmes) as PDF, built from the Comparison.
6. **Keyboard and accessibility pass.** Focus into and out of windows, arrow-key row editing, visible focus rings in all 12 skins.
7. **Rate card freshness.** Show the effective date of the rate card used per channel on the Rates card, and warn when a channel's card is older than a set number of months.
