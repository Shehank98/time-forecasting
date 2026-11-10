# Your Sampath Bank workbook against what the system builds

Source: "Sampath Bank Evaluation TV, Radio - R1 IMPROVE C-ROI and CPRP - Radio MBC 15 Discount - With Radio.xlsx" (26 sheets). Read sheet by sheet, formulas included.

## What the workbook contains

| Sheet(s) | What it is |
|---|---|
| TV Derana, Hiru TV - Option A, Swarnavahini TV, ITN, Sirasa TV, Shakthi TV, Rupawahini, Siyatha TV | One evaluation per TV channel: sponsorship benefits (tags, prime and non prime, spots = times per day x 30), commercial benefits (programme, day, time belt, duration, TVR, GRP, NGRP, CPRP, NCPRP, rate card rate, negotiated rate, spots, value), commercial value, all exposure value, investment, SSCL 2.5%, VAT 18%, grand total, commercial ROI, all exposure ROI. Beside it: the investment, the share available for commercials (80%), and the split of that money (prime 50%, non prime 50%, weekend non prime 20%) with what is left of each |
| Summary | One line per channel: investment, commercial only investment, rate card value (all exposure and commercial), C-ROI, ROI, value-add GRPs and NGRPs, commercial GRPs, NGRPs, CPRP, NCPRP, totals, CPRP all exposure, spots, value adds, exposures, discount %, bonus %. TV total, a radio block, print and cinema lines, total budget |
| Summary with Hiru 15, without Hiru 15, with Hiru 30, without Hiru 30 | The same summary for a chosen set of channels, on a 15 sec or a 30 sec basis (15 sec = GRPs x 2), at 100% and at 85% of the investment |
| Total Summary | The four scenarios side by side: GRPs, CPRP and ROI, commercial and all exposure, at 100% and 85% |
| Property Summary | Per channel: the property (sponsorship), its details, investment per month, the current discount and bonus, the discount and bonus we ask for, annual budget, notes. TV and radio |
| NETH FM ... Sooriyan FM (10 sheets) | Radio evaluations: value against investment (no ratings) |

## What the system already builds the same way

- The channel evaluation sheet: same blocks, same formulas (GRP, NGRP, CPRP, NCPRP, value, cost, ROI), SSCL and VAT, sponsorship items, commercial programmes in prime and non prime groups (or the channel's own bands, for example Prime A / Prime B), bonus programmes, the 30 sec version.
- The budget block beside the sheet: investment, commercial %, the band split and what is left (in the app: the time bands and their meters; in the Excel: the deal block).
- The Summary: one line per channel with investment, commercial investment, rate card values, ROI, GRPs, CPRP, spots, discount and bonus.

## Gaps (not built yet)

| # | Gap | What it needs |
|---|---|---|
| 1 | **Scenarios**: with or without a chosen channel, 15 sec or 30 sec basis, 100% or 85% of the investment, and the Total Summary that puts them side by side | A scenario picker on Export: tick channels, choose 15 or 30 sec, type the investment levels. Pure arithmetic on what is already there |
| 2 | **Property Summary** sheet | Three typed fields per channel (property, details, notes). Investment, current discount and bonus, and the ones we ask for are already in the system |
| 3 | **Two rates on one programme.** Your Derana sheet values a spot at the non contract rate (963,000) and costs it at the contract rate x 27% (so 1,200,000 against 1,000,000 x 27% for Iskole). The system has one rack rate per programme | A second "contract rate" column in the rate card and in the evaluation |
| 4 | **Sponsorship frequency lines in our plan** (TAG prime 8 a day x 30, TAG non prime 24 a day x 30, with an assumed TVR) | A quick "frequency property" form: times per day, days, prime / non prime, duration; TVR from the channel's prime and non prime average. Today you can add the lines by hand |
| 5 | **Radio evaluations** (10 sheets) | Radio has no ratings in the system. A value-only evaluation (rate card value against investment, spots, ROI) can be built from the LMRB radio rows and a radio rate card |
| 6 | **85% investment line** on every summary | Part of gap 1 |
| 7 | Print and cinema lines, the reach / frequency estimate at the foot of the Summary | Typed inputs only |

## New in this round that the workbook relies on

- **Every channel the client buys is analysed from the LMRB**, including TV channels without TVR and radio: spend, share, spots, programmes, sponsorship, durations, average rates (Spend overview and Current basket).
- **Exact matching**: each spot is looked up in the TVR sheet on its own channel, date and ad time. In the sample 96% of spots are found that way.
- **Strict matching** (on by default): only exact matches, the same name in its slot, and matches you approved are counted. Everything else waits in Review matches and is left out of the numbers until you approve it.
