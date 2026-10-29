# Media Radar: competitor analysis and TimesFM forecasting for media agencies

One FastAPI service (API plus a plain HTML/CSS/vanilla JS frontend) that an agency runs for many clients.
Planners sign in, pick a client, upload data, and get competitor analysis, probabilistic forecasts,
budget scenarios, pacing checks and branded client reports.

| Workspace | Data | What planners get |
| --- | --- | --- |
| **TV Programme Analysis** | TVR sheet | Top programmes, channel by category, daypart, day and time-belt heatmaps, efficiency, consistency, slot opportunities, TVR forecasts and emerging or declining time-belts |
| **LMRB Ad Monitoring** | Competitor spots and spend | Share of voice, spend breakdowns, GRPs and CPRP (when the TVR sheet is loaded for the same client), flighting, creatives, pricing, alerts, head to head, competitor forecasts, budget scenarios, pacing |
| **Client KPI Forecast** | Any dated client sheet (leads, sales, website traffic, search demand, GRPs) | Column mapping, CPL, CPA, CPC, CPM and CPRP, segment mix, spend effects, seasonality, forecasts, spend scenarios, pacing and demand peaks with launch timing |

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
- **Clients** have a name, industry, brand colour and logo. Everything is scoped by client: datasets, saved forecasts and reports.
- **History grows**: *Append file* merges new months into the stored dataset (duplicates dropped; restated KPI rows replaced). Only parsed data is stored (as Parquet in the database), never the uploaded file.
- **Saved forecasts**: *Save to client* keeps a forecast, scenario plan or pacing check with its settings. Open it again from Client overview.
- **Reports** are kept per client and can be downloaded again.

## Reports

From any workspace, **Client report** builds one of three formats with the current filters, and optionally the last forecast, scenario plan, pacing check and executive summary:

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

Tests (they never download the model):

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
5. The image installs CPU-only torch and pre-downloads the TimesFM 2.5 checkpoint (about 0.9 GB) at build time, so the build needs access to huggingface.co. Alternative: mount a volume at `/data`, set `HF_HOME=/data/hf` and build with `--build-arg PREFETCH_MODEL=0`.
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
| `TIMESFM_MAX_CONTEXT` | `1024` | Longest history fed to the model, in periods |
| `PRELOAD_MODEL` | `1` | Load TimesFM in the background at startup |
| `FORCE_FALLBACK` | `0` | Never load TimesFM |
| `MAX_UPLOAD_MB` | `25` | Upload limit |
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
- The Gemini key never leaves the server; Gemini only ever sees aggregated numbers.

## Project layout

```
app/
  main.py                 app, middleware, routers, static files
  core.py                 shared request models, auth and workspace dependencies, computations
  routers/                account (auth, clients, users, branding, settings), data, forecasting, ai, reports
  services/
    db.py, auth.py, repo.py, store.py    database, users and sessions, data access, per-client datasets
    ingest.py, ingest_kpi.py, normalise.py, filters.py
    analytics_tv.py, analytics_lmrb.py, analytics_kpi.py, joins.py (GRP and CPRP)
    series.py, forecast.py                metric registry, TimesFM 2.5, scenarios, pacing, peaks, monitoring
    gemini_client.py, narrative.py        AI insights and the report narrative
    report_data.py, export_pdf.py, export_pptx.py, export_excel.py
  config/                 channel_aliases.json, holidays_lk.json, dayparts.json
  static/                 login, client overview, three workspaces, admin; css and js
tests/                    parsing, analytics, forecasting, KPI, reports, Gemini, API, security
```

## Limits to know about

- GRPs are estimated from the programme's average TVR at the spot time, not minute-by-minute ratings. The match rate is shown.
- Spend scenarios learn from how results moved with spend in the client's own history. If spend barely varied, the app says so and the scenarios look similar.
- Total reach in the TV workspace is a sum across airings, not unique people.
- The PDF uses a Latin-1 font, so Sinhala or Tamil text prints as `?`. PowerPoint and Excel keep full Unicode.
- Real TimesFM inference needs the checkpoint, which the build downloads from Hugging Face. The test suite exercises the TimesFM 2.5 code path with a stand-in model that mimics its outputs.
