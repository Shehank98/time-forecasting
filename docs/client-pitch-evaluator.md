# Client Pitch Evaluator: full description

This document describes what the Client Pitch Evaluator (the "Pitch" card, TV only) does today, in the order a planner meets it. Each part ends with **Where to check**: the file or test that proves the statement, so any claim can be verified against the code. Where something is a limit or a guess, it is said plainly in section 14.

---

## 1. What it is for

A planner is pitching for an advertiser who is with another agency. We have two files for that advertiser:

- the **LMRB sheet**: what the current agency bought (every spot: channel, programme, day, time, duration, cost);
- the **TVR sheet**: the audience each programme delivered (TVR per airing).

With those, and our **rate card** (what each channel charges), the page shows what the current agency bought and what it really cost, then builds an alternative plan for the same money, and compares them (GRPs, CPRP, ROI). It also produces **Excel evaluations with live formulas** in the agency's own sheet format.

Everything is **TV only** and only channels that exist in the TVR sheet are evaluated. Tax (VAT, SSCL) is not in any on-screen number. (The Excel has VAT and SSCL cells in its Formulas sheet.)

**Where to check:** `app/static/js/engine/pitch.js` (engine), `app/static/js/pitch-page.js` (page), `app/services/export_eval.py` (Excel), README section "Client Pitch Evaluator".

## 2. Where the calculations run

- All numbers are calculated **in the browser**, in the data worker (`MR.pitchBuild`), from the uploaded files. Nothing about the data is stored on the server except the rate card and the reports you download.
- The same engine files run under Node in the tests (`tests/js/pitch.js`), which is how the Python tests check the maths.
- The server builds the **Excel evaluation** (`POST /api/pitch/evaluation`) and the **PDF / Word summaries** (`/api/pitch/pdf`, `/api/pitch/docx`) from numbers the browser sends. Downloads are also saved under Reports.
- Your choices (settings, typed rates, match approvals, deals, built evaluations) are kept per client in the browser under the key `pitch:<clientId>`.

## 3. The inputs

| Input | What it is | Where it comes from |
|---|---|---|
| LMRB sheet | The current buy. Uses channel, programme, day, programme time, ad time, duration, cost, theme, advertiser, medium | Upload on the page (a column-matching dialog appears if headings are not recognised) |
| TVR sheet | Audience per programme airing: channel, date, day, start, end, programme, TVR | Upload on the page |
| Rate card | The agency's own rack rates and negotiated rates per programme | Imported once by an admin in Data sources, kept in the database |
| Rates you type | A 30 sec (or other length) rate for a programme the card does not have | Rates and negotiation section |
| Deals | Investment, commercial %, prime %, estimated discount, bonus % | Investment tab, plan table, Build evaluation dialogs |

A **sample data** button loads a generated Sampath Bank example (`scripts/make_pitch_sample.py`, files in `app/static/sample/pitch_*.csv`).

## 4. The filters at the top

- **Advertiser**: the advertiser to pitch for. The current buy, the budgets, the plan and both evaluations are built from that advertiser's LMRB rows only. If the client's name matches an advertiser it is picked automatically. "All advertisers" shows the whole market. Changing it clears the evaluations built in Build evaluation.
- **Month**: one month or all months. The default is the latest month with TV rows.
- **Channel** (multi-select) and **Prime / non prime / all**.
- **Settings**: prime time window (default 19:00 to 22:30), minimum TVR for the plan (default 1), most spots per episode in the plan (default 2), the plan's budget basis, "use the negotiated rates stored in the rate card", the lowest automatic match score (default 45%), and how the current buy is costed (default: the actual investment you enter, spread by rate card value).

**Where to check:** `filters()` and `settingsDialog()` in `pitch-page.js`; the `DEF` object holds the defaults; `advWanted` in `pitchBuild` does the advertiser filter; test `test_evaluation_is_built_for_one_advertiser`.

## 5. The page: ten section cards

The page is the data sources, the filters, and **ten cards** in three groups. Clicking a card opens that section in a large window; the "Go to" list in the window switches section; Escape returns to the cards. Tables are sized to fit without sideways scrolling at 1280 px and wider.

1. **The current buy**: Spend overview, Current basket, Investment and discount, Daypart view.
2. **Our plan**: Our recommended basket, Build evaluation, Comparison.
3. **Set up and share**: Review matches, Rates and negotiation, Export.

## 6. How a programme in the LMRB is matched to a TVR programme

LMRB and TVR name the same programme differently, so the first job is matching. Nothing is shown for a programme until it has a TVR programme.

1. **Slots**: LMRB programme names are grouped by channel + start time + days. Several names in the same slot are shown as one row, so a movie slot with many film titles is approved once.
2. **Name comparison** (`engine/pitchmatch.js`): the name is cleaned (repeat marks, season / episode numbers, times in the name, brackets, filler words dropped), then compared by: letters (bigram overlap and edit distance), **sound** (a consonant skeleton, so Sinhala / Tamil spellings such as "Mayawee" and "Mayawi" meet), words (each word finds its closest word), one name inside another, **initials**, and the **kind** of programme (movie, news, kids, music, reality, quiz). Two names of clashing kinds have their score halved.
3. **Time**: the start time and days of the slot add to or reduce the score.
4. **Result**: the best TVR programme above the "lowest match score" setting is accepted automatically; the others are listed as "to check" with ranked suggestions.
5. **Review matches** lets you approve, change or ignore. An approval is **learned** (per client) so the same names match in later months. Programmes you ignore are left out.

**Where to check:** `pitchmatch.js`; `tests/test_pitch_matching.py` (7 tests); `matchGroups` in `pitch.js`.

## 7. The current buy (what the previous agency bought)

For the chosen advertiser, month and filters, the engine reads the TV rows and builds:

- **Rows: one per LMRB programme and duration.** Each row is a TVR programme (its TVR name), the LMRB programme name it came from, the **real duration** in seconds, the spots, the cost, the average rate per spot, the rate card rate and negotiated rate **at that duration** (30 sec rate x duration / 30), the TVR, GRPs, CPRP. So a programme bought at 10s, 15s and 30s is three rows with the spot counts of the sheet.
- **Spots**: one LMRB row = one spot.
- **30 second equivalents** (`eq30`) = spots x duration / 30. Rates, GRPs and CPRP are compared on this basis.
- **TVR of a programme** = the average TVR over its airings in the TVR sheet (all months uploaded), not just the chosen month.
- **Prime / non prime**: a programme is prime when its TVR start time falls inside the prime window.
- **Sponsorship items** are shown apart from the basket, one line per channel and item (e.g. "-LLogo"), with total spots, spots per month, average cost, spend, TVR delivered, GRPs and CPRP. An item is a sponsorship when its LMRB theme is flagged as sponsorship (the same setting as the Market card). Each item keeps its real durations (a `durs` list, one entry per duration).
- **Measures**: GRP = TVR x spots; NGRP = TVR x 30 sec equivalents; CPRP = cost / GRP; NCPRP = cost / NGRP.
- **ROI** = rate card value / cost. Rate card value = rate card 30 sec rate x 30 sec equivalents. *ROI commercial* uses the programme rows only; *ROI all exposure* adds the sponsorship items. Programmes with no rate are left out of ROI and the page says how much of the spend that is ("Spend with a rate").

**Where to check:** `pitchBuild` in `engine/pitch.js` (the `prog` map and `rows`); tests `test_current_basket_rows_follow_the_lmrb_programme_and_duration` and `test_durations_are_the_real_ones_from_the_lmrb`.

## 8. Rates: where a rate comes from

For each TVR programme the **30 sec rack rate** is, in order: a rate you typed (converted to 30 sec, so a 10 sec rate x 3), else the rate card row matched by channel + weekday + start time, then by name. The **negotiated 30 sec rate** applies, in priority order: a programme rule you set, a channel rule you set, the discount typed for the channel in our plan, the rate card row's own negotiated rate, then the default rule. A rule is a **discount %**, a **flat** rate or a **special** rate.

The **rate card database** (`rate_cards` table) is imported from the planners' workbook: one tab per channel; the 30 sec rack rate is typed or 3 x the 10 sec rate; in the "Negosiated Rate" column a **formula** such as `=G3*27%` is stored as a **discount** (27% of rack = 73% off) and a **typed number** is a **special rate** for that programme. Versions are kept by effective date (a new date adds a version, the same date replaces it); the newest version is used.

**Where to check:** `rateResolver` in `pitch.js`; `app/services/ratecard.py`; `tests/test_ratecard.py` (4 tests).

## 9. Investment, discount and evidence

The LMRB shows what each spot was *monitored* at, which is not always what was paid. So the previous agency's spend is first **estimated at the channel's rate card** ("rack value"), and compared with what you know.

- **Investment** (what the channel was really paid), **commercial %** (the share that bought programmes: 100%, 90%, 80%), **prime %** (how the commercial money splits), and an **estimated discount %** can be entered per channel on the Investment and discount tab.
- **Real discount** = 1 - (investment x commercial %) / rack value. The investment wins; with only a discount, cost = rack value x (1 - discount).
- If both are typed, the sheet shows the **gap in points** between your estimate and the real discount.
- When some programmes have no rate, only their share is compared and the table says how many were left out.
- Setting "current buy is costed at": with *actual*, the commercial investment is spread over programmes in proportion to rack value (one discount per channel); the sponsorship rows are scaled to the rest of the investment.

**Where to check:** `dealOf`, the `evidence` block and `current_basis` in `pitch.js`; `tests/test_pitch_deal.py`.

## 10. Our recommended basket (the plan)

- **Budget per channel**: what the current agency spent on that channel (programmes only, or all exposure, per the setting). If you type an **investment** for a channel in the plan table ("What we put into each channel"), the commercial budget is investment x commercial %, and that wins over the current spend. Order of priority: plan investment, then current deal investment (when the setting says so), then LMRB spend.
- **Candidates**: TVR programmes with a rate and a TVR above the minimum. Each has a **cap** = episodes per month x most spots per episode.
- **Optimiser** (`pitchAllocate`): programmes are bought in order of the goal until the budget is used.
  - *Most GRPs*: cheapest CPRP first (CPRP = our 30 sec rate / TVR).
  - *Best ROI*: highest rate card value per rupee first.
  - *Balanced*: a mix of the two.
- **Prime share**: if a prime % is given, that share of the budget is spent on prime programmes first and the rest on non prime, then **anything one side could not spend goes to the other side**. This means the prime share is a target, not a hard cap; the page shows the real split.
- **Our discount %** per channel changes our negotiated rate (see section 8).
- **Bonus %**: the free extra a channel gives, as a share of the commercial rate card value (see section 11).
- Programmes can be switched off one by one; the totals update at once. The tab also shows CPRP per programme, a Time column (Prime / Non prime), and a **Prime time and non prime time table** (spots, spend, TVR and CPRP per channel).
- All plan spots are 30 sec.

**Where to check:** `engine/pitchalloc.js`; `test_plan_stays_inside_the_budget_and_buys_cheapest_first`, `test_optimiser_goals`, `test_our_plan_has_its_own_investment_discount_prime_and_bonus`.

## 11. Build evaluation: two evaluations per channel

One card per channel; a switch chooses the evaluation.

**Current agency estimate**
- *Start from the current buy* asks one thing per channel: the **estimated discount %**.
- The programmes, durations, spots and TVR come from the LMRB (advertiser, month and filters as chosen). The rate card rate and negotiated rate are shown at each row's duration. Negotiated rate = rate card rate x (1 - discount). Programmes with no rate card rate keep the LMRB rate.
- Sponsorship items keep their LMRB cost.
- The channel window is **read-only**: the discount box, nine numbers (spots, cost at this discount, cost in the LMRB sheet, rate card value, discount, GRPs, CPRP, ROI commercial, ROI all exposure), then Prime time, Non prime time and Sponsorship tables with totals and CPRP.
- If an investment was typed for the channel on the Investment tab, it still wins over the typed discount.

**Our plan**
- *Start from our plan* asks investment, our discount %, commercial %, bonus % and prime % per channel, then fills the programmes with the optimiser and suggests bonus programmes.
- The channel window has: the deal numbers; **budget meters** (commercial benefits, prime time, sponsorship rest, bonus); a KPI strip; a searchable programme picker (**Add** / **Add as bonus**); rows grouped as prime, non prime, sponsorship items you add and bonus programmes, each with editable spots, TVR, duration and rates (rates are entered at the row's duration) and a CPRP per row; group totals with CPRP; "Fill with the optimiser", "Suggest bonus programmes", "Add a sponsorship item".
- **Bonus** = free extra value: allowance = bonus % x the commercial rate card value. Bonus programmes cost nothing, and count at rate card value in all-exposure ROI and GRPs. "Suggest" adds the programmes with the most TVR per rate card value until the allowance is used (at most 12).
- A meter turns red when a budget is exceeded (it does not block you).

**Where to check:** `build`, `startDialog`, `chBuilder`, `curView`, `applyRates`, `suggestBonus` in `pitch-page.js`.

## 12. The Excel evaluation (formula workbook)

Built on the server with openpyxl, in the agency's sheet format.

- **Sheets**: Summary, one sheet per channel, Formulas.
- **Channel sheet columns** (C to R): DESCRIPTION, DAY, TIME BELT (from, to), DUR, NUMBER OF SPOTS, TVR, GRP, NGRP, CPRP, NCPRP, RATE CARD RATE, NEGOTIATED RATE, TOTAL VALUE, TOTAL COST, BAND.
- **Blocks**: SPONSORSHIP BENEFITS, then COMMERCIAL BENEFITS split into PRIME TIME and NON PRIME TIME, then BONUS COMMERCIALS (when present). Totals: COMMERCIAL VALUE, SPONSORSHIP VALUE, BONUS VALUE, ALL EXPOSURE VALUE, then ROI rows and SSCL / VAT lines.
- **Formulas**: rates are per spot at the row's duration (30 sec rate / 30 x DUR); GRP, NGRP, CPRP, NCPRP, value, cost and totals are live Excel formulas. Change a TVR, rate or spot count and the sheet recalculates. The Formulas sheet holds the settings (base seconds, SSCL, VAT) and the formula of every column.
- **Deal block** (columns T to X, from row 10): investment, commercial %, sponsorship rest, prime and non prime split, bonus allowed, planned against budget, discount vs rate card, and (when typed) the estimated discount and the difference in points.
- **Summary** (one row per channel): spots, GRPs, CPRP, ROI, discount, bonus %, bonus spots, bonus rate card value, plus totals; and a per-channel CPRP / all exposure CPRP table. Numbers use Excel's comma style.
- **Which channels**: the Export tab and the Build evaluation buttons use the channels you built; for the others the engine's current buy / recommended basket is used.
- Verified by recalculating the files in LibreOffice: no formula error cells.

**Where to check:** `app/services/export_eval.py` (its docstring lists the layout); `test_evaluation_workbook_is_styled_and_its_formulas_calculate`, `test_deal_block_in_the_evaluation_workbook`, `test_bonus_commercials_are_free_but_count_at_rate_card_value`.

## 13. Other screens

- **Spend overview**: monthly spend by channel (commercial + sponsorship), share and change on the last month, and the sponsorship vs commercial split.
- **Current basket**: channel ROI table, programme basket (worst 20% by CPRP shaded), sponsorship items.
- **Daypart view**: prime and non prime TVR, rate and CPRP per channel.
- **Rates and negotiation**: rate card status and import, per-programme typed rates and negotiation, channel rules, paste from Excel.
- **Comparison**: current agency vs our plan in one table (spend, spots, GRPs, average 30 sec rate, CPRP, prime and non prime TVR, prime shares, ROI) and one plain-language sentence, plus a chart. The sentence is generated by `MR.pitchCompare` and says "for the same budget" only when the budgets are within 2%.
- **Export**: all tables to Excel, a PDF summary, a Word summary, and the evaluation workbooks.

## 14. Limits and things to double check (honest list)

1. **I tested with generated sample data only** (`scripts/make_pitch_sample.py`: Sampath Bank, three channels). I have not seen your real LMRB / TVR sheets in this environment. Counts such as "Ada Derana 24x07@10 has 12 spots" should be checked on your real data; the code now keeps one row per LMRB programme and duration, but whether your name matching puts every LMRB name on the right TVR programme depends on your data and your approvals.
2. **The prime share is a target, not a cap** (section 10). In the sample, the plan spent 7.97M on prime against a 6.75M target because non prime inventory ran out; the meter shows it in red.
3. **Programme TVR is an average of all airings in the TVR sheet**, not the TVR of the chosen month.
4. **"Real discount" depends on the rate card.** If a programme has no rate card rate it is left out of the rack value; the table says how many.
5. **Sponsorship items** use the channel's average prime / non prime TVR weighted by their prime and non prime spots (they are not tied to a programme), so their TVR is an estimate.
6. **Sponsorship cost in the current estimate** keeps the LMRB cost. If you type an investment in the channel, the sponsorship rest is shown on a meter but the rows are not rescaled afterwards.
7. **Plan programmes are always 30 sec**; only the current buy has mixed durations.
8. **Tax** is not in any on-screen number.
9. **Browser tests**: the page flow was checked with Playwright scripts that are **not in the repository**; the Python tests cover the engine (via Node) and the Excel builder, not the page's buttons.
10. **Forecast-type claims**: nothing in this section is a forecast. The plan is an allocation of a budget over past audiences (TVR), not a prediction of future TVR.

## 15. Tests

`tests/test_pitch.py` (13), `tests/test_pitch_deal.py` (8), `tests/test_pitch_matching.py` (7), `tests/test_ratecard.py` (4). Run with `python3 -m pytest tests/test_pitch.py tests/test_pitch_deal.py tests/test_pitch_matching.py tests/test_ratecard.py`. The workbook tests need LibreOffice (`soffice`) and are skipped without it.
