# Media Radar: competitor analysis and TimesFM forecasting for media agencies

One FastAPI service (API plus a plain HTML/CSS/vanilla JS frontend) that an agency runs for many clients.
Planners sign in, pick a client and open one of three prediction cards from **Mission control**. Each card opens
with a short launch animation. The interface uses a futuristic dark theme by default, with a light variant.

| Card | Data | What planners get |
| --- | --- | --- |
| **TVR Audience Behaviour Prediction** | TVR sheet (plus LMRB for the market tab) | *TVR & Audience Forecast* tab, *Market & Competitor Forecast* tab, and the analysis tabs: top programmes, heatmaps, categories, efficiency, consistency, slot opportunities, Forecast studio, AI insights, raw rows |
| **Market Prediction** | LMRB ad monitoring sheet (plus TVR for ratings and CPRP) | Both forecast tabs, plus share of voice, spend breakdowns, GRPs and CPRP, flighting, creatives, pricing, position, alerts, head to head, Forecast studio, AI insights, raw rows |
| **Client KPI Forecast** | Any dated client sheet (leads, sales, website traffic, search demand, GRPs) | Column mapping, CPL, CPA, CPC, CPM and CPRP, segment mix, spend effects, seasonality, forecasts, spend scenarios, pacing and demand peaks with launch timing |

### The two forecast tabs

Both TV cards share a **global control bar**: the TVR and LMRB uploaders, a forecast horizon and global filters for Channel, Programme, Category, Product group and Advertiser.

- **Months view (default):** TimesFM forecasts monthly totals and averages up to **12 months** ahead (quick buttons 3, 6 and 12 months, slider 1 to 12). This is the clearest view for budgets and strategy. It needs at least 12 months of history and works best with 24 or more; with less, the page shows a warning and the reliability badge drops to Low. Beyond 12 months the ranges get too wide to be useful, so the app stops there.
- **Days view:** the next 60 days, day by day (quick buttons 7, 14 and 30, slider 1 to 60), for tactical weekly planning.
- Inside a view TimesFM runs once for the full range, so changing the horizon only re-slices the outlook and is instant; switching between Months and Days runs a new forecast. The switch is also in the top bar of the forecast popup. In months view the heatmap shows forecast month by start hour, and bursts compare each month with the previous three.

| Tab | KPI cards | Charts |
| --- | --- | --- |
| **TVR & Audience Forecast** | Projected average TVR, Guaranteed minimum TVR (P10), Projected reach %, Top growing category | TVR fan chart (history solid, forecast dashed, P10 to P90 ribbon; the tooltip converts it into guaranteed GRPs for your spots per day and the shortfall risk), daypart by weekday heatmap of forecast TVR share, category share shift (stacked to 100%), channel momentum, programme risk map, reach outlook |
| **Market & Competitor Forecast** | Predicted competitor spend, Predicted spot volume, High-clutter alert (max AdsinBrk), Best estimated CPRP slot | Competitor spend and next move per advertiser in the chosen product group, with *Predicted Competitor Campaign Burst* markers (a forecast day more than 25% above the trailing 7-day average), break clutter and position combo (rising clutter in red, PosinBrk 1 to 2 advice), CPRP efficiency bubbles (forecast rating vs forecast spot cost, size = clutter, colour = channel) with the *Optimal Buying Zone*, share of voice forecast, daypart spend shift, cost inflation outlook |

**Themes.** 12 skins, chosen from **Theme** in the sidebar or the top-right of the sign-in page and saved on that computer: Deep Space (default), Aurora Light, Daylight Studio, Midnight Ledger, Broadcast Control Room, Warm Studio, Paper & Ink (icon-rail sidebar), Ocean Glass, Violet Night, Forest Dusk, Slate Pro and Sunset Pop. Each one restyles colours, fonts, corners, the sidebar and the chart colours. To add one, add a block in `app/static/css/app.css` (`:root[data-skin="name"]`) and an entry in `app/static/js/skins.js`.

**Plain words, not statistics.** Forecasts are shown as three numbers: **most likely** (the best single guess), **low case** (a safe floor the real number should reach about 9 times in 10, used for guarantees) and **high case** (the upside). Reports and tables show the technical names in brackets (P50, P10, P90).

**Intro film.** After sign-in a full-screen animated film plays by itself and explains how the system works, how to read a forecast, and what each card finds (the TVR and Market scenes show animated sample dashboards). Back and Next sit inside the screen, Space pauses, Esc or Skip closes it, and "Don't show this again" turns it off per user. **Watch intro** in the sidebar replays it.

**Check the numbers.** Every chart has a **Numbers** button with the exact actual and forecast values, an accuracy check on recent months the engine had not seen, and a CSV download. Everything marked FORECAST has a purple badge, dashed border and hatched zone.

More forecasts for media specialists: channel audience share, channel by daypart TVR, genre share, competitor spend by channel, channel mix, share of audience delivered (GRPs) and the cost per rating point outlook.

The Client KPI Forecast card is hidden from Mission control and the sidebar (`SHOW_KPI` in `app/static/js/home.js`); the page still exists at `/kpi.html`.

Every chart has a **?** icon: hover or focus it to read how the chart predicts (or is built) and what a planner gets from it.
Under each forecast chart a **Planner's Evidence** box states the numbers in plain language and ends with a recommendation. The evidence also feeds AI insights and the client reports.

### Data stays in the browser

Sheets are uploaded **once** and kept in the planner's browser, never on the server:

- A Web Worker streams the file, parses it into compact column arrays and stores them in IndexedDB, separately for each signed-in user and client. Reopening the card on the same computer loads it in seconds.
- CSV works at any size; a 545 MB LMRB file with 3.9 million spots parses and stores in about 35 seconds and reloads in about 3 seconds. Excel files are limited to 150 MB because browsers must hold the whole workbook in memory; for bigger sheets use *File > Save As > CSV*.
- *Append new period* merges a new month into the stored history and skips duplicate rows. *Replace* and *Remove* are in the same panel, and Mission control shows browser storage use with a *Clear* button.
- Dashboards, filters and raw rows are computed in the worker. Only compact daily series (a few kilobytes) go to the server for TimesFM, and only aggregated summaries go to Gemini and the report builders.
- Each planner and each computer keeps its own copy. Saved forecasts and reports are stored on the server per client, as before.
- The browser engine (`app/static/js/engine`) is a port of the Python analytics in `app/services`; `tests/test_parity.py` runs both on the same files and checks the numbers match.

## The agency use cases it covers

1. **Predictive media planning and ROI.** *Spend scenarios* forecast a result (leads, GRPs) under several budgets (for example -20%, current pace, +20%, +50%) and derive cost per result (CPL, CPA, CPRP) with a P10 to P90 range. Planned spend enters TimesFM as a covariate. A suggested plan picks the largest budget whose extra results stay within 1.5 times the historical cost per result. The Excel report has a blue input cell where a planner can type any budget and see interpolated results.
2. **TVR and time-belt forecasting.** Forecast TVR by channel, category, daypart, recurring programme or 30-minute time-belt. The outlook ranks emerging and declining belts so buyers can secure inventory weeks ahead.
3. **Campaign anomaly and pacing detection.** Every forecast backtests the most recent periods and flags actuals outside the expected P10 to P90 band (spikes, drops, zero days that look like tracking breaks). *Pacing* adds delivery to date to the forecast for the rest of the flight and says whether the target will be hit.
4. **Search demand and category trends.** Upload search volume or category data as a Client KPI dataset. Forecasts mark expected demand peaks and the date to be live by (default two weeks ahead).
5. **Narrative for clients.** Gemini (or a rule-based writer when Gemini is unavailable) turns the numbers into an executive summary, findings, recommended actions and watch-outs. Every statement in the app links to the numbers it used.

## Forecasting engine

- **Google TimesFM 2.5** (`google/timesfm-2.5-200m-pytorch`, Apache 2.0), zero-shot, on CPU, loaded once and kept in memory.
- **Batched**: all selected entities plus their backtest contexts go through the model in one call.
- **Probabilistic**: TimesFM returns `[mean, q0.1 ... q0.9]`. P10, P50 and P90 come from the continuous quantile head, with quantile crossing fixed.
- **Covariates** through `forecast_with_covariates` (XReg): weekday, weekend and the editable Sri Lankan event calendar (Poya, Sinhala and Tamil New Year, Vesak, Christmas, school holidays). Scenarios add planned spend.
- **Granularity**: daily, weekly or monthly. TimesFM 2.5 has no frequency flag; the series spacing is enough.
- **Zero fill**: spend, spots, leads and share of voice treat "no activity" as 0. TVR, reach and ratios treat gaps as missing and interpolate. Partial first and last weeks or months are dropped for totals.
- **Backtest and reliability**: the last periods are held out and scored with sMAPE, MAE, MASE and band coverage against a seasonal naive baseline. The badge is High, Medium or Low. Thin history still runs and is marked Low.
- **Change points and anomalies** on history, plus band breaches on recent periods.
- **Fallback**: if TimesFM cannot load, seasonal naive plus exponential smoothing takes over (scenarios use a linear driver model) and the UI shows a red banner. Nothing breaks.
- **Cache** per data version, filters and parameters. Long runs execute as background jobs with progress.

## Client workspaces

- **Users and roles**: admins manage clients, users, branding and settings. Planners see only the clients assigned to them.
- **Clients** have a name, industry, brand colour and logo. Saved forecasts and reports are scoped by client on the server; sheets are scoped by user and client in each browser.
- **History grows**: *Append new period* (or *Append file* for KPI datasets) merges new months into the stored data (duplicates dropped; restated KPI rows replaced).
- **Saved forecasts**: *Save to client* keeps a forecast, scenario plan or pacing check with its settings. Open it again from Mission control.
- **Reports** are kept per client and can be downloaded again.

## Reports

From any card, **Client report** builds one of three formats from the summary the browser computed for the current filters, and optionally the prediction tabs with their Planner's Evidence, the last Forecast studio run, scenario plan, pacing check and executive summary:

- **Branded PDF**: cover with agency and client logos, executive summary with KPI tiles, forecast outlook with P10 to P90 charts, peaks and alerts, budget scenarios, pacing, workspace insights, and a methodology and reliability appendix with backtest results and the disclaimer.
- **PowerPoint deck**: one message per slide, with native editable charts (forecast bands, scenarios, pacing, share of voice, GRPs, top programmes, KPI trends).
- **Excel workbook**: branded cover with the summary, KPI sheet, a *Scenarios* sheet with live formulas and a custom budget input, a day-by-day *Pacing tracker* where planners type actuals and see cumulative and variance formulas update, every analysis table as a native Excel table with native charts, and a *Methodology* sheet.

Agency name, logo, colour, footer and disclaimer are set under **Admin > Report branding**.

## Run locally

Python 3.11 is recommended.

```bash
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

```bash
cp .env.example .env
```

Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env` (and `GEMINI_API_KEY` for AI features), then:

```bash
set -a; source .env; set +a; FORCE_FALLBACK=1 uvicorn app.main:app --reload --port 8000
```

Open http://localhost:8000 and sign in. `FORCE_FALLBACK=1` skips the model for a quick start, and without `DATABASE_URL` a SQLite file at `data/app.db` is used.

To run TimesFM 2.5 locally, install CPU torch first and then TimesFM without its dependencies:

```bash
pip install torch --index-url https://download.pytorch.org/whl/cpu
```

```bash
pip install --no-deps "timesfm==2.0.2" && pip install "huggingface_hub>=0.23" "safetensors>=0.5.3" scikit-learn jax jaxlib
```

Tests (they never download the model; the parity tests need Node 18 or newer):

```bash
python -m pytest -q
```

Against a real PostgreSQL:

```bash
TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/mr_test python -m pytest -q
```

## Deploy on Railway

1. Push this repository to GitHub and create a Railway service from it. `railway.json` selects the Dockerfile.
2. Add the **PostgreSQL** plugin and set `DATABASE_URL=${{Postgres.DATABASE_URL}}` on the app service.
3. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` (the first admin is created on first start), `GEMINI_API_KEY`, and optionally `GEMINI_MODEL`.
4. Memory: **3 GB minimum, 4 GB comfortable**, with **one worker** (the model lives in memory once). TimesFM 2.5 is 200M parameters, much lighter than 2.0.
5. The image installs CPU-only torch and pre-downloads the TimesFM 2.5 checkpoint (about 0.9 GB) at build time, then runs offline (`HF_HUB_OFFLINE=1`) from that saved checkpoint, so the running service never calls Hugging Face. The build needs access to huggingface.co. Alternative: mount a volume at `/data`, put the checkpoint there, and set `TIMESFM_LOCAL_DIR` (or `HF_HOME=/data/hf`), building with `--build-arg PREFETCH_MODEL=0`.
6. Health: `GET /health` is always fast. `GET /api/model-status` says whether TimesFM is loaded or the fallback is in use.
7. Sign in, open **Admin**, set report branding, create clients and add planners.

## Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | SQLite at `data/app.db` | PostgreSQL URL (Railway's `postgres://` form is accepted) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | none | First admin, created only when no user exists |
| `GEMINI_API_KEY` | none | Enables insights, chat and Gemini report summaries |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Gemini model |
| `HF_HOME` | `/opt/hf` in Docker | Hugging Face cache for the checkpoint |
| `TIMESFM_REPO` | `google/timesfm-2.5-200m-pytorch` | Checkpoint repo or local folder |
| `TIMESFM_LOCAL_DIR` | none | Folder with a saved checkpoint (`model.safetensors`); used offline when present |
| `HF_HUB_OFFLINE` | `1` in Docker when the model was prefetched | Never contact Hugging Face at run time |
| `TIMESFM_MAX_CONTEXT` | `1024` | Longest history fed to the model, in periods |
| `PRELOAD_MODEL` | `1` | Load TimesFM in the background at startup |
| `FORCE_FALLBACK` | `0` | Never load TimesFM |
| `MAX_BODY_MB` | `30` | Largest JSON request (series, summaries); sheets never reach the server |
| `LOGIN_DAYS` | `7` | Sign-in session length |
| `CONFIG_DIR` | `app/config` | Folder with the editable JSON settings |

## Editable settings (Admin > Settings)

| File | Purpose |
| --- | --- |
| `channel_aliases.json` | Canonical channel names. "Tv - Derana", "DERANA" and "Derana TV" all become `DERANA` on both sheets so they can be joined. |
| `dayparts.json` | Dayparts (Early Morning 05-09, Morning 09-12, Afternoon 12-17, Early Prime 17-20, Prime 20-23, Late Night 23-05), time-belt size (15, 30 or 60 minutes), duration bands and minimum history (14 daily, 8 weekly, 12 monthly points). |
| `holidays_lk.json` | Event calendar used as covariates. **The shipped Poya and holiday dates are a starting point; verify them against the official calendar each year.** |

## Security

- Passwords are hashed with scrypt; sign-in cookies are HttpOnly, SameSite=Lax and Secure behind HTTPS; session tokens are stored hashed. Sign-in is throttled.
- Every data request is checked against the user's client access. State-changing requests need a header that cross-site forms cannot send (CSRF guard).
- Uploaded text is escaped in the UI, never executed as an Excel formula, and prefixed in CSV downloads. Logos are type and size checked.
- Sheets never leave the browser. Excel files are read with SheetJS 0.18.5 (the last npm release, Apache 2.0) inside the worker; it has a published prototype-pollution advisory for crafted files, so the app only opens the planner's own files, in an isolated worker, and CSV is the recommended format.
- The Gemini key never leaves the server; Gemini only ever sees aggregated numbers.

## Project layout

```
app/
  main.py                 app, middleware, routers, static files
  core.py                 auth, client workspace and rate limit dependencies
  routers/                account (auth, clients, users, branding, settings), forecasting, ai, reports
  services/
    db.py, auth.py, repo.py, store.py    database, users and sessions, data access
    ingest.py, ingest_kpi.py, normalise.py, filters.py               Python reference for the browser engine
    analytics_tv.py, analytics_lmrb.py, analytics_kpi.py, joins.py   (parity tested against app/static/js/engine)
    series.py, forecast.py                metric registry, TimesFM 2.5, scenarios, pacing, peaks, monitoring
    gemini_client.py, narrative.py        AI insights and the report narrative
    report_data.py, export_pdf.py, export_pptx.py, export_excel.py
  config/                 channel_aliases.json, holidays_lk.json, dayparts.json
  static/                 login, Mission control, three cards, admin; css, fonts and js
    js/engine/            browser data engine: ingest, filters, analytics, GRP join, series, prediction prep
    js/data-worker.js     Web Worker with IndexedDB storage; js/datastore.js talks to it
    js/predict-tabs.js    TVR & Audience and Market & Competitor forecast tabs
tests/                    parsing, analytics, forecasting, KPI, reports, Gemini, API, security, browser parity (tests/js)
```

## Limits to know about

- GRPs are estimated from the programme's average TVR at the spot time, not minute-by-minute ratings. The match rate is shown.
- Spend scenarios learn from how results moved with spend in the client's own history. If spend barely varied, the app says so and the scenarios look similar.
- Total reach in the TV workspace is a sum across airings, not unique people.
- The PDF uses a Latin-1 font, so Sinhala or Tamil text prints as `?`. PowerPoint and Excel keep full Unicode.
- Real TimesFM inference needs the checkpoint, which the build downloads from Hugging Face. The test suite exercises the TimesFM 2.5 code path with a stand-in model that mimics its outputs.
- Browser storage is per browser profile. Private windows and some locked-down browsers do not keep data; the app then works for the session only and says so. Very large sheets need a recent desktop browser with a few GB of free memory.
- The LMRB analysis tabs recompute on every filter change; on several million spots that takes a few seconds (the loader shows progress). Filtering by brand or date range makes it faster.

## Planner views, flip cards and click-through

- **Each prediction card is split by question.** TVR: *Next month plan* (channels to hold, programmes to buy, where audience is moving), *Channel share* (share path per channel), *Programmes* (league with low/likely/high), *When and who* (hours, genres, reach). Market: *Next month plan* (rivals, predicted bursts, best value slots), *Competitors*, *Price and discounts*, *Slots and clutter*.
- **Sponsorship vs commercial.** Spots whose theme is `-BB`, `Com Break`, `DJ`, `-Extro`, `-Intro`, `-LLogo`, `Next Card`, `Tag`, `Time Check` or `-Tr` are sponsorship items (same list as the JKH dashboard); everything else is a commercial. Pricing, discounts, price outliers and the reports treat them separately, and the Market forecast projects each type on its own. The JS engine and `analytics_lmrb.py` implement the same split (parity tested).
- **Flip any chart** to see how its numbers were built (sheet, series, forecast engine, chart) with the exact data table and a CSV download.
- **Click any point, bar or heatmap cell** to open a detail popup with the numbers behind it, marked Recorded or Forecast.

## Standalone playbooks and the timeband bridge

Each prediction card works on its own sheet.

- **TVR card (TVR sheet only):** *Planner's Action Playbook* with a loyal-vs-zapping map (forecast TVR against forecast Reach %, plus viewing time when present), slot decay and volatility warnings (a drop of more than 15% against the last 4 weeks over the next 14 and 30 days, or a very wide low-to-high range), and off-peak sweet-spot hours.
- **Market card (LMRB sheet only, 1 to 5 years):** *Competitor War-Room* with a Focus brand vs rivals view (channel, daypart, language), a seasonal burst radar (how many earlier years had a burst in the same calendar window; needs about 3 years), a creative fatigue and refresh predictor (theme age against each advertiser's usual theme lifespan, spot length shifts), and forecast break clutter and first-in-break rates per channel and daypart.
- **Optional bridge:** when both sheets are loaded, ratings are matched by canonical channel and 30-minute timeband (exact date when it exists, otherwise the usual weekday pattern), never by programme name. Spots on radio, press or channels the TVR sheet does not cover show as TVR N/A and are left out of CPRP and Best slots to buy.
- The burst radar and creative predictor are estimates from history, labelled "Pattern from history" / "Estimate from history".

## Phase 2: calendar covariates, trust meter, new programme estimator, stealth alerts, history vault

- **Sri Lanka media calendar** (`app/services/sl_media_calendar.py`): Poya day, festival windows (Sinhala and Tamil New Year, Christmas and New Year, Vesak week, Ramadan), salary week (25th to 5th), weekend and user-flagged major events. Poya dates come from the verified list in `app/config/holidays_lk.json` where it has the year, and are computed from the full moon for any other year (within a day, so check them). Ramadan uses the tabular Islamic calendar. These are passed to the forecast engine as covariates for both the forecast and its accuracy check, and drawn as pins on the charts. Flag cricket tournaments and other special events under **Major events** on each prediction card.
- **Trust meter:** every forecast run also forecasts the last 30 recorded days (14 for stealth checks) from earlier data. Accuracy = 100 minus sMAPE, shown as a badge on charts and in the Numbers popup. The **Backtest** button overlays what the engine would have said.
- **Volatility Index** = (high case - low case) / most likely, on the risk scatter and programme league; flip the card for a negotiation guide.
- **New Programme Estimator** (TVR, Programmes view): first 4 weeks for a show with no history, from the slot baseline and lead-in, rival loyalty (caps the upside, names the stealable audience) and the launch curve of earlier shows in the category. It is a statistical estimate, not a model forecast.
- **Stealth anomaly detector** (LMRB Alerts tab and the Rivals shortlist): the last 14 recorded days against the expected P10 to P90 range; two or more days above the ceiling, or a new theme, raises an alert with root-cause numbers.
- **History vault:** compact daily totals from every upload are saved under `data/vault/` (override with `VAULT_DIR`, switch off with `VAULT_ENABLED=0`), de-duplicated by key so overlapping uploads replace instead of double count. When a forecast runs with no filters, stored history for the same series is prepended before the dates in the current upload. Mount a volume at `data/` on Railway to keep it between deploys. Admins can clear it with `POST /api/vault/clear`.
- **Incremental LoRA update:** `python scripts/incremental_lora_update.py --product-group "Detergents" --with-global` (add `--dry-run` to see what would train). Needs torch and the model checkpoint; set `LORA_ENABLED=1` to allow the Brand memory dialog to start it. It freezes the base model and trains only low-rank matrices on the attention layers (`attn.qkv_proj`, `attn.out`) with a quantile loss. Adapters (`models/lora_<ProductGroup>.pt`, `models/lora_global_sl.pt`) are saved and tracked in `models/lora_manifest.json` but are not applied at inference yet. Verified with the real timesfm architecture and random weights (`tests/test_real_model.py`, skipped when torch is not installed); not yet run on the released checkpoint.

## How the forecast is chosen (and why a high sMAPE is not the whole story)

Every series is forecast several ways and the method that does best on the held-out days is the one shown:

1. the forecast engine alone,
2. the engine on the most recent weeks only (helps after a level shift),
3. the engine with calendar effects, fitted to the engine's own residuals,
4. calendar effects first, then the engine.

A calendar method is used only if it beats the plain forecast on the held-out days by at least 5% and stays within 0.4x to 2.5x of the plain forecast's level. This stops the failure where a regression fitted across an old, higher level pushed every weekday forecast to zero. The Numbers popup and the Backtest table say which method won.

Accuracy % (the Trust badge) is 100 minus sMAPE, but 100 minus WAPE when at least 15% of the held-out days are near zero, because sMAPE reads about 200% on a zero day. MASE below 1 means the forecast beat repeating last week's pattern. Reliability uses MASE and that accuracy, not raw sMAPE. The newest day of a daily upload is left out when it is under a quarter of the days before it (usually a part day). Set `covariate_guard: false` in the forecast params to bypass the method choice when debugging.

## Reading the forecast trail

Every forecast writes its steps to two places so problems are easy to find.

- **Server log (Railway, or the terminal):** lines starting `[forecast]`: the request (series, granularity, horizon, stored history used), step 1 start, step 2 batch sizes, step 3 model backend and time, step 4 which calendar methods ran or were skipped (and why), step 5 per series the held-out error of each method and the one chosen, one summary line per series (method, forecast min/mean/max, zero days, accuracy, sMAPE, WAPE, MASE, warnings) and step 6 totals. A `CHECK` warning appears when half or more of the forecast days are zero although recent history is not. Set `LOG_LEVEL=DEBUG` for more.
- **Browser console (F12):** a collapsed group `[forecast] ...` per run with the same steps, a table with one row per series, and warnings. Turn it off with `localStorage.setItem('mr:trace', '0')`.

## Programme buys (Market card)

The **Programme buys** view forecasts how many commercials each tracked rival will place in each of the top programmes (weekly counts, monthly in months view), and the total per programme. A burst is a forecast at least 25% above the last 4 weeks (40% for a single rival in a single programme). Click any bar or heatmap cell for the rivals behind it. Only the top rivals and the 12 busiest programmes are forecast, to keep a run fast.

## How accuracy is measured

Every series with at least 8 points is backtested, on up to two past windows, and the method that does best across those windows is used (including an average of the two best). Trust is measured on the level planners buy at: weekly totals for daily series (the daily figure is shown next to it). It is the measured result, not a target: noisy, intermittent or short series will score lower, and the badge says so.

## Actuals and forecast chart (Forecast studio)

Long histories open on a recent window (3 months of a daily series, 1 year of a weekly one, 2 years of a monthly one) with the forecast. Buttons switch the range (up to All) and, for daily data, between daily values and weekly totals. A thin strip under the chart shows the whole history with the visible window highlighted. Daily data is drawn as a 7-day average over the faint daily line; switch it off to see raw days. Range band, backtest and alerts can be toggled. In the weekly view, incomplete first and last weeks are left out and weekly ranges combine the daily ranges as if days vary independently (approximate).

The same controls (range, daily or weekly, 7-day average, range band, overview strip) are on the time charts of the TVR and Market cards: Total audience, Reach outlook, Channel share path, Competitor spend and next move, Cost per second and Cost per rating point. Recurring Poya and salary pins are shown only on short daily views.

`tests/tools/validate_numbers.py` recomputes the forecast inputs, tiles, share charts, programme buy counts, alignment and backtests from the raw sheets and compares them with what the browser sent, received and drew.

## Deep Negotiation & Brand Intelligence (Market card)

A tab on the LMRB card for rate negotiations. It drills down in three levels: Channel, then Advertiser / brand (with a Product group filter), then Advt_Theme.

- **Channel to Brand to Theme table.** Click a row to open it. Each row shows spend, spots, average ads in break, first-in-break %, a vulnerability index, the dates it ran and the spot-length mix (for example 30s 60%, 10s 40%).
- **Share of wallet matrix.** Brand x channel. Switch between three views:
  - **Share of wallet:** a brand's spend on a channel as a share of that brand's total spend.
  - **Share of channel:** a brand's share of everyone's spend on that channel.
  - **Spend:** the amount in LKR.
- **Theme rotation tracker.** Shows how long each theme ran and how much was invested in it. A theme counts as on air if it was seen in the last 14 days. A second table shows whether each brand moved to 10s-and-under reminder spots between the first and second half of its run.
- **Clutter and position vulnerability.** A bubble chart of each brand on each channel: average ads in break (AdsinBrk) against first-in-break share (PosinBrk = 1). The vulnerability index runs from 0 to 100. It rises when a spot sits in the middle of a crowded break. A table also shows clutter by channel and timeband.
- **Negotiation leverage.** Both thresholds can be edited in the tab:
  - **Volume rebate:** when one brand spends the threshold or more on one channel (default LKR 10,000,000), it shows "Retroactive Volume Discount Opportunity (10-15%)" with the LKR value to ask for.
  - **Clutter penalty:** when the average ads in break is above the threshold (default 35), it advises: "demand 3 free bonus spots or priority First-in-Break placement".
- **Download Negotiation PDF Report.** The browser sends only the filtered summary to `POST /api/negotiation/pdf`. The server builds an A4 landscape ReportLab PDF with:
  - a cover page and headline numbers;
  - the negotiation highlights;
  - the channel table, the Channel to Brand to Theme table and the share of wallet matrix;
  - theme rotation, clutter by timeband, and how each number is worked out.

  A copy is saved under Reports.

The numbers are computed in the browser (`app/static/js/engine/negotiation.js`). `tests/test_negotiation.py` checks them against pandas.

## Programme & Sponsorship Spotlight (Market card)

A tab with two views. Both use the same rules for sorting spots.

**How spots are sorted**
- **Sponsorship:** the theme is a sponsorship item. These are billboards (-BB, Intro, Extro, Com Break, Next Card) and logo items (LLogo, Tag, Time Check, DJ, -Tr). Any advertiser with these items in a programme is marked **Sponsorship** for that programme.
- **Frequency:** the same ad (theme) on one channel is a frequency buy when its usual length is 10 seconds or less and it averages 10 or more ads a day on air. Both numbers can be changed in the tab.
- **Special placement:** any other spot that is 60 seconds or longer and costs 3x or more the programme's median spot.
- **Regular Spot:** everything else.

**Programme Spotlight**
- Pick a **Channel** and an **Advertiser** (or leave either on All). The table shows one row per advertiser, channel and theme:
  - advertiser and product;
  - channel;
  - theme, and whether it is a billboard, logo/tag or spot;
  - type: Sponsorship, Frequency or Regular Spot;
  - the programmes it ran in, with ad counts;
  - ad count, days on air, daily average and busiest day;
  - spot length and the dates it ran.
- "Show" switches between sponsorships and frequency buys only (the default) and every ad. The table can be downloaded as CSV.
- **Open** on a row shows the programme in detail with that brand in focus: headline numbers, sponsorship vs regular spend, ad count by episode with peak episodes, break position, and the Sponsorship Impact Brief.

**Short-form & Sponsorship Matrix**
- One row per programme and brand. Each row shows:
  - channel and programme;
  - advertiser and product;
  - sponsorship type;
  - a duration split of 5s, 10s, 15s, 20s, 30s and 30s+;
  - spots per day and per month;
  - average ads in break;
  - first in break, and first or last in break.
- The **Negotiation health** score runs from 0 to 100. It adds three parts:
  - low clutter, worth 40 points;
  - first or last in break, worth 35 points;
  - price per second against the programme's going rate, worth 25 points.
- The health badge is green at 65 or more, amber at 40 to 64, and red below 40. The clutter threshold is shared with the Negotiation tab.
- Quick filters: spot length (5s, 10s, 10s and under, 15s, 30s, 30s+), channel, sponsorship tag and search.
- Click a column heading to sort. Click a row to see its daily spots and cost efficiency.
- **Export CSV** and **Export Excel** download the table.

The numbers are computed in the browser (`app/static/js/engine/spotlight.js`). `tests/test_spotlight.py` checks them against pandas.

**PDF report (third view in the Spotlight tab)**
- **Choose what goes in:**
  - Channel, Programme and Advertiser (pick one or several of each). Each list narrows the one after it.
  - A From and To date. Quick range buttons fill in the last 30 days, last 3 months, last full month, this year or all dates.
  - "PDF for this programme" on the Programme Spotlight view opens the report already set to that channel, programme, brand and dates.
- **A live preview** shows the main table, in the same Channel › Programme › Advertiser order as the PDF.
- **Download Programme & Sponsorship PDF** builds an A4 landscape report at `POST /api/spotlight/pdf`. It contains:
  - a cover page with the chosen dates, channels, programmes and advertisers, and headline numbers;
  - sponsorship talking points for the biggest programmes;
  - the Channel › Programme › Advertiser table, with each advertiser's role, sponsorship and regular spend, items, spots, spots per day, share of voice, spot lengths, ads in break, first in break and health score;
  - an advertiser summary with a chart;
  - a month by month table;
  - a list of peak episodes.

  A copy is saved under Reports.
- **Roles use everyone in the programme.** The advertiser pick only limits which rows are shown, so a brand's role stays the same however you filter.

## Executive Negotiation Summary (Market card)

A table-first summary for agency heads and brand managers. It is the second tab, right after Overview.

**Filters:** advertisers, channels and a From/To date (with quick ranges). These narrow everything on the page and in the PDF, together with the page filters.

1. **Overall campaign summary:**
   - active brands and products, total monitored spend, **commercial only** vs **value addition / sponsorship** spend, spots and sponsorship items, programmes;
   - exclusive sponsorships and high-frequency reminders;
   - GRPs and CPRP when a TVR sheet is loaded;
   - duration, language and medium splits, and the top brands.
2. **TV channel-wise breakdown:** ranked by total monitored spend, highest first. Each channel shows commercial spend, value-add spend, total, commercial spots, sponsorship items, total spots and share of wallet (and GRPs with a TVR sheet). A bold totals row closes the table, with zebra rows and right-aligned numbers.
3. **Programmes & sponsorship intelligence:** each programme shows its classification, the sponsors with spot counts, sponsorship items, high-frequency spots, commercial spots, total spots, airing days and spots per airing. Programmes with an exclusive sponsorship come first. A totals row closes the table.

**How ads are classified.** This is worked out for each ad (advertiser + theme) inside each programme (a channel and programme name):
- **High-Frequency Reminders:** on the days the ad ran in the programme it averaged **more than 10** spots a day, or it was **10 seconds or shorter** and averaged **10 or more** a day. Both numbers can be changed in the Programme Spotlight tab.
- **Exclusive Sponsorship / Value-Add:** a sponsorship item that appears consistently in the programme, meaning on at least **half of the programme's airing days** (and at least 3 days, or every airing when there are fewer). Sponsorship items are found from the theme: Logo, Intro, Outro or Extro (whole words), -BB, Com Break, Next Card, LLogo, Tag, Time Check, DJ and -Tr.
- **Sponsorship / Value-Add:** a sponsorship item that does not recur consistently.
- An ad can be both, for example a logo shown 12 times an episode.

**Click any channel or programme row** to open its details underneath:
- **High-frequency spots vs logo, intro and outro sponsorships:** a mini-table of every classified ad with its classification, spots, days present out of airing days, daily average, duration split (5s, 10s, 30s and so on) and placements in the break (first, middle, last).
- **Commercial details:** commercial spots and spend, the duration split and dayparts.
- **Ratings & volume:** GRPs, average spot rating, CPRP and the share of spots rated (from the TVR sheet, matched by channel and 30-minute timeband), plus spots per day, busiest day, ads in break and first in break.
- **Sponsorship details:** sponsorship items, billboards, logos and tags, sponsorship spend and the top advertisers.

**Medium** is worked out from the channel name: "FM" or "Radio" counts as Radio, everything else as TV. The LMRB sheet has no medium column.

**Export Executive Summary PDF** (`POST /api/executive/pdf`) contains the three summary sections with totals, a table of the classified ads, then the full drill-down for the top 10 channels and the top 12 programmes. A copy is kept under Reports.

The numbers are computed in the browser (`app/static/js/engine/executive.js`). `tests/test_executive.py` checks them against pandas and tests each edge case of the classification.

## Sponsorship over time (Market card, Spotlight tab)

The fourth view of the Programme & Sponsorship Spotlight tab. It answers: "Did this advertiser sponsor this programme across the whole upload, and what ran in each year?"

- **You only pick the advertiser** (type to search). Nothing else needs choosing, because the app lists the channels and programmes for you:
  1. With no advertiser chosen, it lists every advertiser that has sponsorships, with long, consistent sponsorships first. Click one.
  2. With an advertiser chosen, it lists every **channel**, and under each channel every **programme** they sponsored, with status, the ads in each year, total ads, sponsorship ads and spend. Channel buttons above the table narrow it to one channel.
  3. Click a programme (for example Dream Star on Derana) to see exactly what ran.
- **Year periods:** "Data years" are 12-month blocks counted from the first month of the upload (Year 1, Year 2), so a 2-year file gives two like-for-like years. "Calendar years" splits by calendar year instead.
- **Channels and programmes list:** each channel has a header row with its totals, then one row per programme with the ads in each year, and a bold totals row at the end.
- **Detail for one advertiser and programme:**
  - a plain sentence, for example "Lanka Tea Co sponsored Dream Star on Derana for 24 months (Nov 2024 to Oct 2026): 1,371 sponsorship ads and 234 other ads, 1,605 in total. Sponsored all 2 years.";
  - a year-by-year table: programme airing days, days sponsored, sponsorship ads, other ads, total ads, ads per airing and spend, with a whole-period total;
  - an ads-per-month chart with a line where each new year starts;
  - pauses in the middle of the sponsorship (for example Jan to Feb 2026);
  - **What ads ran:** each theme with its ad count in every year, and first and last seen.
- **Status:**
  - **A year counts as sponsored** when the advertiser's sponsorship items (billboard, logo, intro, outro, tag, time check and so on) were on at least half of the programme's airing days that year.
  - **Sponsored all N years:** sponsored that way in every year the programme aired.
  - **Started in Year N / Stopped after Year N / Sponsored in X of N years:** the other patterns.
  - **Occasional sponsorship items:** only a few stray items, which are listed last.
- **Download Sponsorship over Time PDF** (`POST /api/spotlight/tenure/pdf`):
  - **Cover:** the year periods and the selection.
  - **Who sponsored what, year by year:** one row per advertiser and programme. Each year column shows **when the sponsorship started and ended in that year** (for example "1 Nov 2024 to 31 Oct 2025") and the ads they ran that year. The **ad themes** (sponsorship items first, with their counts) are listed in the same row.
  - **A section for each advertiser and programme** (the first 8):
    - the year table with sponsorship started and ended, programme airing days, days sponsored, sponsorship ads and value, commercial-only ads and value, and total ads, with a whole-period row;
    - **What ads ran:** each theme with its ads per year, how many were in prime time and in other times, and first and last seen;
    - an ads-per-month chart;
    - **Month by month in this programme:** for each month, the sponsorship ads and their value, how many were in prime time and in other times, and the commercial-only ads and their value, with a totals row and a note on months with no sponsorship.
  - **Is it a fixed package?** The monthly sponsorship value is checked. If it stays about the same every month (within 15%), the note says "Steady sponsorship value: about LKR X every month. A flat monthly value usually means a fixed sponsorship package." If it is steady within each year but changes between years, the note says so, with each year's monthly amount. The first and last sponsored months are left out when there are 5 or more, because they are often part months.
  - **Prime time vs non-prime time:** the sponsorship ads in prime time (the Prime daypart, 20:00 to 23:00) and in other times, with their value, and a label: Prime time, Non-prime time, or Prime and non-prime.
  - A copy is kept under Reports.

**Can't find an ad? Check how it is counted.** Open "Can't find an ad?" in the Sponsorship over time view and type part of a theme or programme name (for example "Lakshapathi"). It lists every ad whose theme or programme contains that text, with:
- the channel, programme, advertiser and the **theme exactly as written in your sheet**;
- the ad count and the dates it ran;
- **how it is counted**: programme sponsorship (and which item, such as Next Card), frequency sponsorship, or commercial;
- **why**: for a commercial, the exact theme text and the sponsorship items it was checked against, so a theme written in an unexpected way (for example an abbreviation) shows up straight away. Typing an advertiser above narrows the check to that advertiser.

**Every programme is in the PDF.** "Who sponsored what, year by year" lists every programme the screen lists (up to 400 rows, flowing over several pages) and the frequency table lists every channel. Before, the PDF stopped at 60 rows and cut the smallest sponsorships first.

**Prime time vs other times** is shown for both kinds of sponsorship. Prime time is the Prime daypart in your settings (20:00 to 23:00); everything else counts as other times.
- **Programme sponsorship:** a "Sponsor ads: prime / other time" column in the overview table (and on each channel header), and a prime time vs non-prime time note and columns in each programme's section.
- **Frequency sponsorships:** "In prime time" and "Other times" columns in the channel table, with a label (Prime time, Non-prime time, or Prime and non-prime), and the same two columns in the month-by-month table and in "What ads ran". The one-line summary says how many sat in prime time and how many in other times.

The same start and end dates, month-by-month table, steady-value note and prime-time split are shown on screen when you open a programme.

**Programme sponsorship vs frequency sponsorship.** In this view the two are kept apart:
- **Programme sponsorship:** -BB, -Intro, -Extro, -LLogo, Next Card, DJ and -Tr items (plus whole-word Logo, Intro and Outro themes) placed in a programme. These drive the programme tables, the "Sponsored all N years" status and the year and month figures above.
- **Frequency sponsorship:** **Tag, Com Break and Time Check** items, and any commercial that is **10 seconds or shorter and averages 10 or more spots a day** on a channel (the same ad and theme, judged across the whole upload). Programme sponsorship items are never turned into frequency spots, so an intro or next card that runs 12 times a day stays programme sponsorship. They are bought on the channel, so they are **never counted as programme sponsorship**.
- **Where they are shown:**
  - On screen, a **Frequency sponsorships by channel** table appears under the programme list. Click a channel for the month-by-month counts and the ads that ran.
  - In the PDF, "Who sponsored what, year by year" is grouped by channel, with a channel row and its totals followed by its programmes. The frequency table follows it: per channel, the Tag, Com Break, Time Check and short-spot counts, total ads, each year with its start and end dates, days on air, daily average and value. Each channel then gets a page with a month-by-month table (Tag, Com Break, Time Check, short spots, total and value) and "What ads ran".

The numbers are computed in the browser (`app/static/js/engine/tenure.js`). `tests/test_tenure.py` checks them against pandas on a 2-year sample with a both-years sponsor, a year-1-only sponsor, a year-2-only sponsor and an occasional one.

## Sponsorship items (how a theme is recognised)

These Advt_Theme values can count as sponsorship (value-add); everything else is a commercial. **-Tr is not counted unless you tick it.**

| Item | Matches when the theme | Examples that match |
|---|---|---|
| -BB | ends in "-BB", or ends with the word "BB" | Teledrama -BB, Teledrama - BB (5)(Sin), Lakshapathi BB |
| Com Break | contains the words "Com Break" | Com Break, COM BREAK (10), Com Break Sirasa |
| DJ | is "DJ", or ends with the word "DJ" | DJ (Sin), Morning DJ |
| -Extro | contains the word "Extro" or "Outro" | Dream Star - Extro, Lakshapathi_Extro, Show Outro |
| -Intro | contains the word "Intro" | Dream Star -Intro (10)(Sin), Lakshapathi Intro, Lakshapathi_Intro |
| -LLogo | contains the word "LLogo" or "Logo" | Dream Star - LLogo, Lakshapathi_LLogo, Island Tea Logo |
| Next Card | contains the words "Next Card" | Next Card (5), Lakshapathi Next Card, Next Card_Lakshapathi |
| Tag | is "Tag", or ends with the word "Tag" | Tag (5)(Sin), Lakshapathi Tag |
| Time Check | contains the words "Time Check" | Time check, Time Check (10)(Sin), Lakshapathi Time Check |
| -Tr (off by default) | ends in "-Tr", or ends with the word "Tr" | News -Tr (5) |

**What the matching ignores:**
- letter case;
- the "(length)(language)" tags at the end, for example "(10)(Sin)";
- spaces around the dash;
- underscores, which are read as spaces;
- double spaces;
- the programme name written before or after the item.

Commercials that only look similar, such as "Tag Line Promo", "DJ Party Offer", "Time Checker App" or "Next Cardigan Sale", stay commercials. Words count only when whole, and Tag, DJ, BB and Tr count only as the last word.

**One rule everywhere.** The Logo, Intro and Outro words are part of the -LLogo, -Intro and -Extro items above, so ticking or unticking those items controls them in every view. The rule is the same in the browser (`app/static/js/engine/analytics_lmrb.js`) and on the server (`app/services/analytics_lmrb.py`), and `tests/test_sponsor_themes.py` checks that both agree.

**Tick what counts as sponsorship.** Click **Sponsorship items** at the top of the Spotlight tab or the Executive Negotiation Summary to open the tick boxes (one per item above). Save, and every sponsorship report, table and PDF uses your choice straight away:
- An item that is not ticked is counted as an ordinary commercial. Unticking Tag, Com Break or Time Check also removes them from the frequency sponsorships.
- The choice is saved as a shared setting (Settings > Sponsorship items, `app/config/sponsorship.json`), so it applies to the whole agency. Only an admin can save it. For anyone else it applies until the page is reloaded, and the page says so.
- The PDFs list the items that were counted, and the Spotlight tab shows "Counting as sponsorship: ..." at the top. "Back to the standard list" restores the default (every item except -Tr).
- The "Can't find an ad?" check says "Commercial (item switched off)" when a theme is recognised but its item is not ticked.

## Press, contracts and spend by year (Market card)

**Upload.** The Market card has a third upload slot, **Press sheet**, next to the LMRB and TVR slots. It is a separate file with these columns: `Product_Group, Advertiser, Product, Ads, Publication, Dd, Mn, Yr, Date, Day, Periodicity, Lng, Location, Type, Col, CM, Dur, Cost`. Cost may carry thousands separators ("170,040"). Size is `CM x Col` (for example 10 cm x 8 col); `Dur` is the same area (col x cm). Like the other sheets it is read in the browser and kept in IndexedDB; only summaries reach the server.

**Medium (TV, radio, press) in the LMRB sheet** comes from the raw channel name: `TV - Sirasa TV` is TV, `Radio - Shakthi FM` is radio (shown as its own station, with "(RADIO)" added if the name collides with a TV channel), and a name with neither prefix is counted as **press**. Those unprefixed names are listed on the Spend by year tab so they can be checked. LMRB sheets uploaded before this change have no medium column: the tab says so and shows everything as TV until the sheet is uploaded again. The Executive summary's medium split now uses the same rule.

**Contracts** (tab *Press & contracts*, shown once a press sheet is loaded). A contract is the same advertiser and product, in the same publication, at the same size, run again and again:
- daily and weekly papers: on the same weekday (every Tuesday); one missed week is allowed (gap of up to 14 days);
- monthly and other magazines: in consecutive months (a gap of up to one month);
- a run counts as a contract at **4 or more** insertions (changeable on the tab: 3, 4, 6, 8 or 12);
- the same advertiser can hold several contracts in one paper (different size or weekday), and a renewal after a break is its own contract; two ads on the same date count as one "time" but all of them count as insertions and cost.

The tab shows contracts (times, first and last date, missed weeks, average and total cost, Active or Ended, every date on click), contract share of press spend, spend by publication and advertiser, and by month. **Download Press & Contracts PDF** puts the contracts table, contracts by advertiser, press spend tables and the dates of the biggest contracts in one report (also saved under Reports).

**Spend by year (Com and VAL)** (tab, always on the Market card). One block per year with channels down the side (TV channels, radio stations, press publications) and Jan to Dec across, in LKR, as three blocks: **Commercial only**, **VAL** (value addition = the sponsorship items ticked in Settings) and **Total**. All press is commercial. Pick advertisers on the tab (it does not use the page filters), then **Download Excel**: a **Summary** sheet (totals by year with VAL share and change on the previous year, medium share by year, medium across the years), a **Channel share** sheet (every channel, every year: commercial, VAL, total, share of year, share of its medium, rank, active months, busiest month), then one detail sheet per year.

Not built, by request: grouping different programmes in the same time belt as movie sponsorships.

## Client Pitch Evaluator (card 04, TV only)

Shows a prospect what their current agency bought, rates it against the TVR sheet, then shows what the same money buys at our negotiated rates. Open it from Mission control. It uses the selected client as the prospect, so each prospect keeps its own files, rates, matches and settings (the files in IndexedDB, the settings in this browser). Try it with **Load sample data** (made-up files in `app/static/sample/`, rebuilt by `python scripts/make_pitch_sample.py`).

**Inputs.** (1) LMRB sheet and (2) TVR sheet: uploaded and remembered like the other cards; several months can be added and the latest month is shown first. Columns are found automatically; if a required column is not found, a dialog lets you say which column is which. (3) Rate card file (`Channel, Programme, Rate, Seconds`, csv or xlsx) and (4) manual rates (a form, or paste from Excel). Rates are typed against **TVR programme names**; a rate for 10 or 15 seconds is converted to 30 seconds. A channel can also have one prime and one non prime 30 sec rate, so every programme on it is priced without typing each one; a programme rate beats the channel rate.

**Rules and formulas**
- Only channels in the TVR sheet are evaluated; other TV channels are listed as skipped. Radio is not part of this card.
- **Matching.** For each LMRB programme (per channel) the weekday and programme start time of its spots are compared with the TVR programmes of that channel (start within 15 minutes, else the ad time inside the slot). The programme with the most spots wins. Confidence = 60% share of spots that fit the slot + 40% name similarity; a name-only match needs a similarity of 0.6 and counts at 80%. 75% and above is High, 50 to 74 Medium, less Low. Fixes made in **Review matches** (or "ignore this programme") are saved for the client.
- 30 sec equivalent = spots x duration / 30. Average 30 sec rate = cost / 30 sec equivalents.
- TVR of a programme = average over every airing in every uploaded TVR month. GRP = TVR x spots. NGRP (the "GRPs" shown) = TVR x 30 sec equivalents. **CPRP** = cost / NGRP, which is the 30 sec spot cost / TVR.
- Prime time = the programme starts inside the prime window (Settings, default 19:00 to 22:30). Average PT and non PT TVR are weighted by spots; PT share of spend and spots are shown.
- Sponsorship items (the ticked items in the Market card's Settings) are shown apart from the programme basket, with spend, programme, channel and the TVR they delivered.
- **ROI** = value at rate card / spend, where value = card 30 sec rate x 30 sec equivalents. *Commercial only* uses the commercial spots; *all exposure* adds the sponsorship items. Rows without a rate are left out of both value and spend of the ROI, and the share of spend that had a rate is shown. Tax (VAT, SSCL) is not included.
- **Negotiated rate** per programme or channel: discount % off the card, a flat 30 sec rate, or a special programme rate. The Rates tab shows card, negotiated, what the agency actually paid (effective) and the saving against both.
- **Our plan.** Budget per channel = what the current agency spent on that channel (programme basket, or all exposure; set in Settings). Candidates are TVR programmes with a negotiated rate and a TVR at or above the minimum. They are bought lowest CPRP first, each up to (episodes per month x most spots per episode) 30 sec spots, until the channel budget is used. Switching a programme off updates every total at once. Channels with no rated programme are left out of the comparison on both sides, and the page says so.
- Gain sentence: "X% more GRPs for the same budget" (or, when the plan cannot use the whole budget, the CPRP gain and the share of budget used).

**Exports.** Excel (comparison, channel ROI, current basket, sponsorship, our plan, rates, matches, monthly spend), a PDF summary (`POST /api/pitch/pdf`, also saved under Reports) and a Word summary (`/api/pitch/docx`).

**Assumptions to know.** The prospect is a client workspace (it shares its LMRB and TVR slots with that client's other cards). Rates, negotiation rules and match fixes are kept in this browser, not on the server. The TVR average is across all uploaded months, not the month of the buy. A rate for N seconds scales linearly to 30 seconds. Value-add rows use the programme's card rate and their own duration.


### Pitch evaluator: review matches, optimiser, evaluation sheets and builder

- **Review matches is grouped by time slot.** LMRB programmes with the same channel, start time and days (for example many different movie titles in one weekend movie belt) are one row, matched to a TVR programme once; every name inside follows. The score is the share of the slot's spots that fit the TVR programme's slot. **Approve** pins a match (saved for the client), **Approve all high confidence** does every High row at once, the list corrects or ignores a slot, and **Undo** returns it to automatic.
- **Optimise for.** The recommended basket can be built for *most GRPs* (cheapest rating points first), *best ROI* (most rate card value per rupee first, ROI = card rate / negotiated rate per programme) or *balanced*. The same budget per channel and the same limits apply.
- **Evaluation sheets in the agency format** (Export tab): Summary sheet (Total Investment, Total Rate Card, Com Only, C ROI%, ROI%, GRPs, NGRPs, CPRP, NCPRP, spots), one sheet per channel (header block, sponsorship rows, commercial rows, COMMERCIAL VALUE, ALL EXPOSURE VALUE, actual investment, SSCL, VAT, grand total, commercial and all-exposure ROI) and a **Formulas** sheet. Every calculated cell is a real Excel formula: change a TVR, a rate or the spots and the sheet recalculates. The Formulas sheet holds the settings the sheets read (base seconds 30, SSCL 2.5%, VAT 18%) and lists each column's formula. Available for the current buy, our plan and your built evaluation. Tests recalculate the workbook in LibreOffice and compare every number.
  - GRP = TVR x spots; NGRP = GRP x duration / 30; TOTAL VALUE = rate card x spots x duration / 30; TOTAL COST = negotiated (or paid) rate x spots x duration / 30; CPRP = cost / GRP; NCPRP = cost / NGRP; ROI = value / cost (commercial ROI uses the commercial rows, all exposure adds the sponsorship rows). Tax rows follow the agency method (investment is 100% without taxes, grossed up for SSCL and VAT).
- **Build evaluation tab.** Add TVR programmes by channel (TVR, time belt and rates come with them), add sponsorship items, edit any cell; totals, GRPs and ROI update as you type; **Optimise for a better ROI** fills it from the optimiser at a chosen % of the current spend; **Start from the current buy / our plan** copies those in. Download it in the same format, with formulas.

### Agency rate card (database)

The planners' TV rate card workbook is stored in the database once for the whole agency (table `rate_cards`) and used by the Client Pitch Evaluator.

- **Import.** An admin opens the Pitch Evaluator, **Rate card (agency database) > Import rate card sheet**, and picks the workbook (or runs `python scripts/import_ratecard.py "rate card.xlsx"` against the live `DATABASE_URL`). One tab per channel; the headings Programme, Day/s, Start, End and Rack Rate 30 Sec are read (a Rack Rate 10 Sec is multiplied by 3 when the 30 sec cell is a formula of it). Channel names come from the tab names through the channel alias table (add an alias in Settings if a tab name is not recognised: "Swarnwahini" is already one).
- **Negotiated rate column.** A formula such as `=G3*27%` means you pay 27% of the rack rate, so it is stored as a **discount rate of 73%**. A number typed into the cell is stored as a **special rate** for that programme. Derana, Hiru, Swarnavahini and Siyatha are discount rates (73%, 72%, 80%, 80%); Sirasa and Shakthi are special rates. The flat-rate option is no longer offered in the card.
- **Versions.** A date in the tab title ("Effective: 2026.08.07") is kept; tabs without one use the date typed in the import dialog (default today). The same channel and date is replaced; a newer date adds a version and becomes the one in use; older versions stay and can be deleted (Channels and versions). `GET /api/ratecards/current?as_of=...` returns the version in force on a date.
- **In the pitch.** Each TVR programme is matched to a rate card row by channel + weekday + start time (within 15 minutes), then by name, so different names for the same slot still find their rate. Card rate: a rate you typed for the programme, else the rate card, else the channel's prime / non prime rate. Negotiation: a rule you set for the programme, else for the channel, else the rate card's own discount or special rate (untick it in Settings to ignore), else the default rule. The Rates tab shows where each rate came from.
- Reading is open to every signed-in user; import and delete are admin only.

### Evaluation sheet format (matches the agency sheets)

Channel sheets use the agency layout: header block (CLIENT, SUBJECT, MEDIUM, CHANNEL, SPONSORSHIP) in C2:D6, then **DESCRIPTION, DAY, TIME BELT, DUR, NUMBER OF SPOTS, TVR, GRP, NGRP, CPRP, NCPRP, RATE CARD RATE, NEGOTIATED RATE, TOTAL VALUE, TOTAL COST** (NUMBER OF SPOTS is straight after DUR), a SPONSORSHIP BENEFITS block, a COMMERCIAL BENEFITS block, and the totals: COMMERCIAL VALUE, SPONSORSHIP VALUE, ALL EXPOSURE VALUE, ACTUAL INVESTMENT (WITHOUT TAXES), SSCL, VAT, GRAND TOTAL, COMMERCIAL ROI %, ALL EXPOSURE ROI %.
- Rates are **per spot at the row's duration** (30 sec rate / 30 x DUR), written as a formula such as `=(910000/Formulas!$B$3)*G13`; GRP = TVR x spots; NGRP = (TVR / 30 x DUR) x spots; CPRP = negotiated rate / TVR; NCPRP = negotiated rate / (TVR / 30 x DUR); TOTAL VALUE = rate card rate x spots; TOTAL COST = negotiated rate x spots.
- **Summary sheet**: Channel, Total Investment, Total Rate Card (all Expo), Com Only, C ROI%, ROI%, Com Only GRPs, Com Only NGRPs, Com Only CPRP, Com Only N CPRP, Total GRPs, Total NGRPs, CPRP All Expo, NCPRP, Total Number of Spots, Total Number of V/A, Total Exposures, Discount %, Bonus % (and the commercial and sponsorship cost they are worked from), a TV total and Total Budget row, and under it **CPRP BY CHANNEL**: com only and all exposure CPRP and NCPRP for every channel and for TV.
- Number formats: Comma Style for rates, values, costs, CPRP and NCPRP; Number (two decimals) for TVR, GRPs and NGRPs; time belts are real times (h:mm).
- ROI in the sheets is shown as a percentage (4.44 shows as 444%), as in the agency sheets; on the Comparison tab it is a multiple (4.44x).

### Programme matching (Review matches)

Every LMRB programme is scored against **every TVR programme of its channel** (`engine/pitchmatch.js`, `engine/pitch.js`), and the best five are kept as suggestions with the reason.
- **Name** (0 to 100%): the name is cleaned first (repeat marks `RPT / Rep`, season, episode and part numbers, times like "@ 6.55", brackets and filler words are dropped), then compared as letters (bigrams, edit distance), as **sound** (a consonant skeleton: th = t, w = v, ee = i, y = i, double letters and vowels ignored, so "Hitha Illana Tharu" meets "Hithe Ilana Taru", "Mayawee" meets "Mayawi", "Sangeethe" meets "Sangeetha"), word by word (a word finds its closest word on the other side; generic words such as news, show, movie count for little), as one name inside the other ("Sirasa Lakshapathi" / "Lakshapathi"), and as initials. Names made only of generic words are capped at 50%.
- **Time**: the share of the row's spots that run inside the TVR programme's slot, or how close its start is on the same weekdays (within 5 min full, 15 min, 30 min, 60 min weaker), so a belt that starts early or a moved slot still finds its programme.
- **Kind of programme**: both a movie, news, kids, music or reality programme adds support; a clash (a movie title against the news) halves the score.
- **Your approvals**: Approve (or choosing a programme in the list) remembers every name in the row for this client, so the same name is recognised in any slot or month.
- The row's score is a blend (time-led for rows with several names such as movie titles, name-led when the name is the same at another time, for example a repeat). The lowest score accepted automatically is a setting (Settings, default 45%; lower accepts weaker matches, marked Low). Rows below it stay unmatched but still show their best suggestions in the list.
