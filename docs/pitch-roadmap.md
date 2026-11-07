# Client Pitch Evaluator: improvements, optimisations and new features

Written after a second review. "Found" means I checked it in the code or measured it; "Idea" means it is a proposal. Effort: S = hours, M = a day or two, L = several days.

## A. Fixed in this round

- **Found and fixed: TVR of different target audiences were averaged together.** A TVR sheet has a "Data Set" column (for example All 4+, Women 25-44). The engine averaged every row of a programme regardless of it. Now one audience is used at a time (the one with most rows, or the one picked in the new **Target audience** filter, shown only when the sheet has more than one). Test: `test_tvr_of_different_target_audiences_are_never_averaged`.
- **Current basket card inside Our plan.** The plan channel window has a *Current agency on this channel* box (programmes, spots, rate card value, discount) with current against my basket for spend, GRPs, CPRP and ROI, and a button that opens their full basket on top of the window. Each plan card also shows the current agency's CPRP and the change.

## B. Accuracy and correctness (highest value)

| # | Item | Why | Effort |
|---|---|---|---|
| B1 | **Trial on a real LMRB and TVR pair**; turn each surprise into a test | Only the sample has been tested; matching and slot merging depend on real names | S |
| B2 | **Rate card version by buy month.** Found: the page always uses the newest rate card (`/api/ratecards/current` has an `as_of` option that is not used). A March buy should be rated at the card in force in March | A newer card makes an old buy look more expensive or cheaper than it was | S |
| B3 | **Prime share as a hard cap** (option) in the optimiser | Found: what one side cannot spend moves to the other, so a 50% prime target can end at 65% | S |
| B4 | **TVR by month or by weekday group** (option) instead of the average of all airings | A programme that changed in the last two months is judged on old numbers | M |
| B5 | **Tax view**: show figures with VAT and SSCL on request | The sheets have them; the screens do not | S |
| B6 | **Reach and frequency.** Found: the TVR sheet has Reach, Reach % and Avg Time and the evaluator ignores them. Add reach per programme, cost per reach point, and a plan-level estimate of reach | A buy can have the same GRPs and very different reach | M |
| B7 | **Sponsorship TVR from the programme the item ran in**, not the channel average | Today it is an estimate | M |
| B8 | **Duplicate LMRB rows check** (same spot twice) in Data checks | Inflates spots and cost | S |
| B9 | **Match review at scale**: confidence sorting, bulk approve by channel, "same as last month" auto-approve | 300+ names take time | M |

## C. UI and usability

| # | Item | Effort |
|---|---|---|
| C1 | **Guided first run**: a three-step overlay (upload, advertiser, matches) with the sample button | S |
| C2 | **Plan tab on one screen**: put the channel cards and the totals side by side with the Comparison headline, so the story reads without opening windows | M |
| C3 | **Drag programmes** from the Add list into My basket; keyboard add (Enter) and spots with arrow keys | M |
| C4 | **Compare view**: current and mine side by side per programme inside a channel (what to drop, what to add) | M |
| C5 | **Contrast and focus check in all 12 skins**; reduced-motion for the flash and card hover | S |
| C6 | **Mobile layout** for the cards and the basket panel (it stacks, but tables still need a card view) | M |
| C7 | **Loading and error states** for each section (a skeleton exists only for the first load) | S |
| C8 | **Remember window state**: last open section, sort and filters per client | S |
| C9 | **Inline help**: a short "what is this number" popover on each KPI, using the How-calculated text | S |
| C10 | **One-page print view** of the Comparison (headline sentence, by channel table, top programmes) as PDF | M |

## D. Planning and optimiser features

| # | Item | Effort |
|---|---|---|
| D1 | **Cross-channel budget optimiser**: move money between channels for the best total GRPs or ROI, with a minimum and maximum per channel | L |
| D2 | **Must-have and never-buy lists** per channel; minimum spots per programme | S |
| D3 | **Frequency caps** and spacing (no more than N spots a week in one programme) | M |
| D4 | **Daypart targets** (for example at least 55% of GRPs in prime) with the optimiser honouring them | M |
| D5 | **Forecast-based plan**: plan on the forecast TVR of next month instead of the past average (uses the forecast engine; every predicted number carries the FORECAST marker) | L |
| D6 | **Negotiation helper**: for each programme, the rate we would need for the plan to beat the current CPRP by X% | M |
| D7 | **Sponsorship proposals** for the plan (our own items, costed and compared with theirs) | M |
| D8 | **What-if sliders**: investment, discount and bonus % change the totals live without re-running | M |
| D9 | **Bonus rules**: bonus only from programmes at or below a TVR, or only non prime | S |

## E. Collaboration, storage and exports

| # | Item | Effort |
|---|---|---|
| E1 | **Save the evaluations and scenarios on the server per client.** Found: they live in the browser (`pitch:<clientId>` in local storage), so clearing the browser or switching computer loses them | M |
| E2 | **Share a read-only link** to a scenario, and comments on a channel | L |
| E3 | **PowerPoint pitch deck** from the Comparison and the by channel table (the deck builder already exists) | M |
| E4 | **Excel: the 30 sec version in the same file** as a second sheet set, and a Scenarios sheet | S |
| E5 | **History**: who changed what and when for the rate card and the evaluations | M |
| E6 | **Import a previous pitch** (an evaluation workbook) to rebuild the basket | L |

## F. Technical optimisation

| # | Item | Finding | Effort |
|---|---|---|---|
| F1 | **Engine speed** | Measured on 64,620 LMRB rows and 7,560 TVR rows: parse 0.5 s, one full build 106 to 148 ms. No action needed now. At around one million rows expect about 2 s: move the per-row passes to typed arrays and cache the match groups between filter changes | S, only if needed |
| F2 | **Cache the slot and match groups** between runs (they depend only on files, approvals and settings, not on month or advertiser) | Each filter change recomputes them | S |
| F3 | **Split `pitch-page.js`** (about 1,000 lines) into modules: filters, steps, basket, plan, build, compare, export | One file makes every change risky | M |
| F4 | **Browser tests in the repository** (the Playwright scripts used here are only in my scratch folder) and a lint step | Page behaviour is untested in CI | M |
| F5 | **A calculation test for every on-screen formula** against pandas (the Number checks already prove several live) | Extend to plan totals, discount and the 30 sec merge | S |
| F6 | **Shared window component** for the channel, basket and start dialogs (three hand-built overlays today) | Focus, Escape and stacking are repeated | S |
| F7 | **Excel builder**: one place for the format constants and a snapshot test of the layout | Format changes touch many lines | S |
| F8 | **Logging of timings** (engine build, workbook build) at info level | No visibility today | S |

## G. Suggested order

1. B1 (real data), B2 (rate card by month), E1 (save on the server): these protect the numbers and the work.
2. C2, C3, C4: make building a basket faster.
3. D1, D2, D8: make the optimiser decide more of the plan.
4. E3 and C10: the pitch output.
5. F3 and F4 in parallel, so the page stays easy to change.
