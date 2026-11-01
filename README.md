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

**Plain words, not statistics.** Forecasts are shown as three numbers: **most likely** (the best single guess), **low case** (a safe floor the real number should reach about 9 times in 10, used for guarantees) and **high case** (the upside). Reports and tables show the technical names in brackets (P50, P10, P90).

**Intro film.** After sign-in an animated, no-time-limit film explains how the system works, how to read a forecast and what each card can find. It advances with Next (or auto-play, which can be paused), and "Don't show this again" turns it off per user. **Watch intro** in the sidebar replays it.

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
