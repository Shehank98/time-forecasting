# Media Radar: TV competitor analysis and forecasting

One FastAPI service that serves a plain HTML/CSS/vanilla JS frontend and a JSON API.

- **TV Programme Analysis** (TVR sheet): top programmes, channel by category, daypart and day heatmaps, category trend, efficiency, consistency, and time slot opportunities (when LMRB data is also loaded).
- **LMRB Ad Monitoring** (competitor ad spots and spend): share of voice, spend breakdowns, channel and programme mix, flighting patterns, creative tracker (NEW and DROPPED), pricing intelligence, position strategy, movement alerts and head to head.
- **Forecasting** with Google TimesFM 2.0 (P10, P50 and P90 bands, backtest against a seasonal naive baseline, reliability badge, anomaly and change point markers, competitor outlook).
- **AI insights and chat** with Gemini, server side only, every statement backed by an Evidence list of the numbers it used.
- **Excel and PDF reports** that respect the current filters.
- Light and dark mode, collapsible sidebar, keyboard accessible.

Everything derives from the uploaded file. Nothing is hardcoded and nothing is stored on disk: uploads live in memory per session and are dropped after `SESSION_TTL_MIN` idle minutes.

## Quick start (local)

Python 3.11 is recommended (TimesFM 2.0 needs `timesfm==1.3.0`, which supports Python 3.10 and 3.11).

```bash
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # then set GEMINI_API_KEY if you want AI features
FORCE_FALLBACK=1 uvicorn app.main:app --reload --port 8000
```

Open http://localhost:8000. `FORCE_FALLBACK=1` skips the 2 GB model and uses the statistical fallback, which is the quickest way to try the app.

To use real TimesFM locally, install CPU torch first and then TimesFM without its CUDA dependency:

```bash
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install --no-deps "timesfm==1.3.0"
pip install absl-py einshape "huggingface_hub>=0.23" scikit-learn utilsforecast tqdm jax jaxlib
```

Run the tests (they never download the model):

```bash
python -m pytest -q
```

## How to use

1. Pick a card on the home screen and drop an `.xlsx`, `.xls` or `.csv` file (max 25 MB).
2. Read the parsing summary: rows read and kept, date range, missing columns, bad rows dropped, unparsed values and channels missing from the alias table. Then open the dashboard.
3. Use the filters (multi-select, persistent while you stay on the page, Reset button, active filter chips and a filtered row counter). Every KPI, chart, table, forecast and export respects them.
4. LMRB: choose "My brand" and optionally override the competitor set. The default competitors are the advertisers in the same product group.
5. Upload a second file with **Append file** to grow history month by month. Rows are merged and duplicates are dropped.
6. **Export** gives an Excel or PDF report with the current filters, KPIs, tables, forecast and the optional Gemini summary.

### Expected columns

TV: `Rank, Data Set, Channel, Date, Day, Start, End, Program, Duration, Category, TVR, Total TVR, TVR Share %, Reach, Reach %, Avg Time`.
LMRB: `Product_Group, Advertiser, Product, Advt_Theme, Ads, Channel, Program, Dd, Mn, Yr, Day, Prog_time, Advt_time, AdPos, TotAds, BrkNo, PosinBrk, AdsinBrk, Lng, Dur, Cost`.

Headers are matched case-insensitively and trimmed. Title rows above the header, blank rows, numbers with commas, mixed date formats and Excel time cells are handled. Anything unparseable is counted in the summary instead of crashing.

## Configuration files (editable)

| File | Purpose |
| --- | --- |
| `app/config/channel_aliases.json` | Canonical channel names and aliases. "Tv - Derana", "DERANA" and "Derana TV" all become `DERANA`, on both sheets, so they can be joined. |
| `app/config/dayparts.json` | Daypart hours (default Early Morning 05-09, Morning 09-12, Afternoon 12-17, Early Prime 17-20, Prime 20-23, Late Night 23-05), prime dayparts, duration bands and minimum history (14 daily or 8 weekly points). |
| `app/config/holidays_lk.json` | Event calendar used as forecast covariates: Poya days, Sinhala and Tamil New Year, Vesak, Christmas, school holidays. **The dates shipped are a starting point and must be verified against the official calendar.** |

You can edit them in the app under **Settings**. Alias and daypart changes apply to the next upload, so re-upload to re-apply them. Set `CONFIG_DIR` to use a different folder.

## Forecasting notes

- The model is loaded once (in a background thread at startup, or on first use) and a warm-up call is made.
- All selected entities are forecast in one batched call, together with their backtest contexts.
- Frequency flag: daily is 0, weekly is 1 (monthly would also be 1).
- TimesFM returns `[mean, q0.1 ... q0.9]`. The app shows P10 (index 1), P50 (index 5) and P90 (index 9).
- Covariates (weekday, weekend and the event calendar) go through `forecast_with_covariates` (XReg) when there is enough history (28 daily or 12 weekly points). XReg only returns a point forecast, so the band is shifted by the covariate adjustment. If JAX or XReg is unavailable the plain forecast is used and the UI says so.
- Zero fill: spend, spots and share of voice treat "no ad" as 0. Cost per second, TVR and reach treat gaps as missing and interpolate.
- Weekly series drop a partial first or last week so totals stay comparable.
- Backtest: the last N points are held out (N is 7 daily or 2 weekly by default), scored with sMAPE, MAE and MASE and compared with a seasonal naive baseline.
- Reliability: High needs enough history, MASE below 0.8, sMAPE below 30% and a win over the baseline. Thin history (below the minimum), no backtest or large errors give Low. Thin history never fails, it runs and is flagged.
- If TimesFM cannot load, a statistical fallback (seasonal naive blended with exponential smoothing) is used and a red banner says **Fallback model in use**.
- Results are cached per data version, filters and parameters.

## Gemini

- `GEMINI_API_KEY` stays on the server. The browser never sees it.
- The model gets a numbered list of aggregated facts (never the raw sheet) and must cite fact ids. The Evidence section in the UI resolves those ids to labels and values. Unknown citations are flagged.
- Default model `gemini-2.5-flash`, override with `GEMINI_MODEL`.
- Rate limits and transient errors are retried with exponential backoff, then shown as a friendly message.
- The `/api/insights` endpoint builds the compact aggregate on the server from the session data and current filters, so the browser cannot send inflated numbers.

## Deploy on Railway

1. Push this repo to GitHub and create a Railway service from it. `railway.json` selects the Dockerfile.
2. Set variables: `GEMINI_API_KEY`, optionally `GEMINI_MODEL`, `MAX_UPLOAD_MB`.
3. **Memory: give the service at least 4 GB** (6 to 8 GB if you use covariates, which load JAX as well). Run **one worker only**, because the model lives in memory.
4. The image installs CPU-only torch and pre-downloads the TimesFM checkpoint (about 2 GB) at build time, so cold starts do not download it again. The build therefore needs access to huggingface.co.
5. Alternative: mount a Railway volume at `/data`, set `HF_HOME=/data/hf` and build with `--build-arg PREFETCH_MODEL=0`. The first start downloads the model once into the volume.
6. Health checks: `GET /health` (always fast) and `GET /api/model-status` (reports whether TimesFM is loaded, or whether the fallback is in use).

Start command (already in `railway.json` and the Dockerfile):

```bash
uvicorn app.main:app --host 0.0.0.0 --port $PORT --workers 1
```

## Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `GEMINI_API_KEY` | none | Enables insights and chat |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Gemini model |
| `HF_HOME` | `/opt/hf` in Docker | Hugging Face cache for the checkpoint |
| `MAX_UPLOAD_MB` | `25` | Upload limit |
| `SESSION_TTL_MIN` | `120` | Idle minutes before session data is dropped |
| `PRELOAD_MODEL` | `1` | Load TimesFM in the background at startup |
| `FORCE_FALLBACK` | `0` | Never load TimesFM |
| `TIMESFM_REPO` | `google/timesfm-2.0-500m-pytorch` | Checkpoint repo |
| `CONFIG_DIR` | `app/config` | Folder with the editable JSON files |
| `ADMIN_TOKEN` | none | When set, editing Settings requires this token. Settings are global to the service, so set it on a public URL |
| `MAX_SESSIONS` | `200` | Sessions kept in memory, least recently used dropped first |

## Project layout

```
app/
  main.py                 FastAPI routes and static mount
  services/
    ingest.py             read, validate, parse, derive fields, merge
    normalise.py          channel aliases, dayparts, duration bands
    filters.py            server side filters and filter options
    store.py              in-memory sessions with TTL
    analytics_tv.py       TV workspace aggregates
    analytics_lmrb.py     competitor analysis aggregates
    series.py             zero-filled series, calendar covariates
    forecast.py           TimesFM wrapper, fallback, backtests, outlook, jobs, cache
    gemini_client.py      facts, structured insights, chat, retries
    report_data.py        shared report sections
    export_excel.py       openpyxl tables and native charts
    export_pdf.py         reportlab and matplotlib
  config/                 channel_aliases.json, holidays_lk.json, dayparts.json
  static/                 index.html, tv.html, lmrb.html, css/, js/
tests/                    parsing, normalisation, analytics, forecast, gemini, export, api
Dockerfile  railway.json  requirements.txt  .env.example
```

## Security notes

- Uploaded text is untrusted. The UI escapes it, Excel cells that look like formulas are stored as plain text, and CSV downloads prefix such cells with an apostrophe.
- The Gemini key and the model name are read from the environment on the server and never returned by any endpoint.
- Settings (aliases, dayparts, holidays) are validated before saving and are shared by every session, so set `ADMIN_TOKEN` when the app is public.
- Session cookies are `HttpOnly`, `SameSite=Lax` and `Secure` behind HTTPS.

## Limits to know about

- Total reach is a sum across airings, not unique people. It is labelled that way in the UI.
- PDF text uses a Latin-1 font, so Sinhala or Tamil characters in programme names print as `?`. The Excel report keeps full Unicode.
- Holiday and Poya dates in `holidays_lk.json` are approximate and need checking each year.
- Sessions are in memory. Restarting the service clears uploaded data, by design.
