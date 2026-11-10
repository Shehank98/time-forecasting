# Forecast engine: how it works and whether the numbers are right

Audit date: 2026-11-10. Everything below was run, not assumed. To repeat it: `python scripts/forecast_audit.py` (main model) and `FORCE_FALLBACK=1 python scripts/forecast_audit.py` (fallback).

## 1. How the system predicts the future (plain words)

1. **It only uses your past numbers.** For each line you forecast (a programme's rating, a brand's spend, a channel's share) the browser builds one evenly spaced series: one value per day, week or month. Days with no activity are zero for sums and counts.
2. **A pre-trained forecast model reads that history.** The main engine is a large time-series model that was trained on a very large number of real-world series. It looks at up to the last 1,024 points of your series, recognises the shape (weekday rhythm, trend, bursts, level) and continues it. It does not know what a programme or a brand is; it knows patterns in numbers.
3. **It gives a range, not one number.** Every forecast point has a low (P10), a middle (P50) and a high (P90). The middle is the single best estimate. The range is where the value should fall about 8 times out of 10.
4. **Sri Lankan calendar effects are tested, not forced.** Weekday, Poya, New Year and school holidays are offered to the engine in two ways. Each way is kept only if it would have been more accurate on your own recent data.
5. **It checks itself on your data before you see anything.** For every series, the most recent weeks are hidden, forecast from what came before, and compared with what really happened (twice, on two different windows). Five candidates are scored this way: the engine alone, the engine on recent weeks only, the two calendar versions, and the average of the best two. The best one makes your forecast, but an alternative must beat the plain engine by at least 5% and must not move the level by more than 2.5x.
6. **That self-check is the accuracy you see.** "Accuracy 94%" means: on the hidden weeks of this very series, the forecast was off by 6% of the total. For daily series it is judged on weekly totals, because that is how media is bought. The same hidden weeks are also forecast by a simple rule (same weekday last week), so you can see whether the engine is better than common sense.
7. **If the main model cannot load, a statistical fallback takes over** (weekday averages plus smoothing) and the page shows a banner. Section 3 shows why that matters.

What it cannot do: it cannot foresee something that has never appeared in the numbers (a new competitor, a price change, a programme ending, a strike). A level change in the last weeks is picked up; a change next week is not. That is why the range and the reliability badge are there.

## 2. Is the main model really working?

Yes, checked here for the first time with the released weights (earlier checks could only use the fallback or random weights, because this sandbox could not download the weights).

- The model loaded in 6.2 s and reported `backend: timesfm`.
- The calendar (covariate) path ran with the real model and was chosen for 11 of 56 series.
- 43 of 44 forecast tests pass with the real model as backend; the one that fails asserts the word "fallback", which is correct for the test setting.

**To check production:** open `/api/model-status` on the live site. `"backend": "timesfm"` means the main model is in use; `"fallback"` means the statistical fallback is (the `error` field says why); `"pending"` means nothing has been forecast since the last start.

## 3. Are the numbers correct? Known-answer test

56 series shaped like media data, the last 28 days (or 8 weeks, or 6 months) kept back, forecast from the rest, then compared with the truth. WAPE = total error as a share of the total; lower is better.

**Main model**

| Series family | Engine WAPE | Simple rule WAPE | Engine wins | Inside the range | Accuracy shown | True accuracy |
|---|---|---|---|---|---|---|
| Programme rating, weekday pattern | 5.0% | 6.6% | 7 of 8 | 71% | 98.2% | 98.4% |
| Spend with a rising trend | 11.3% | 15.2% | 7 of 8 | 78% | 95.8% | 94.1% |
| Campaign bursts (on and off) | 26.6% | 107.2% | 8 of 8 | 82% | 89.6% | 86.1% |
| Level change two months ago | 4.5% | 5.9% | 8 of 8 | 95% | 97.9% | 98.5% |
| Pure noise around a level | 16.0% | 22.2% | 7 of 8 | 81% | 94.1% | 93.2% |
| Weekly series with a yearly cycle | 4.1% | 5.7% | 8 of 8 | 86% | 96.9% | 95.9% |
| Monthly series with a yearly cycle | 5.3% | 7.7% | 7 of 8 | 79% | 95.3% | 94.7% |
| **All** | **10.4%** | **24.4%** | **52 of 56** | **82%** | **95.4%** | **94.4%** |

**Statistical fallback, same series**

| | Engine WAPE | Simple rule WAPE | Engine wins | Inside the range | Accuracy shown | True accuracy |
|---|---|---|---|---|---|---|
| Campaign bursts (on and off) | 104.7% | 107.2% | 6 of 8 | 47% | 23.5% | 7.3% |
| **All** | **22.4%** | **24.4%** | **48 of 56** | **76%** | **85.3%** | **82.4%** |

What this says:

1. **The main model is right more often than a simple rule, by a wide margin** (error 10.4% against 24.4%), and never loses badly. On campaign bursts, where a simple rule fails completely, it is four times better.
2. **The range is honest.** 82% of real values fell inside the low-to-high range; the target is 80%.
3. **The accuracy the app shows is nearly the accuracy you get.** Shown 95.4%, true 94.4%. The one point of optimism has a reason: the method is chosen on the same hidden weeks it is then scored on. I left it as is, because one point is small and a stricter scheme would use less of your data to choose the method.
4. **The fallback is not good enough for planning.** Overall it is barely better than the simple rule, it cannot forecast on-and-off campaigns at all, and there its shown accuracy (23.5%) is still well above the truth (7.3%). If `/api/model-status` says `fallback` in production, fix that first.
5. **Pure noise stays noise.** Where there is no pattern, the engine forecasts the level and the error is whatever the noise is (16%). No model can do better; the wide range tells you so.

## 4. Limits of this audit

- The test series are built to look like media data; they are not your clients' data. The self-check in the app (step 5 above) is the per-series proof on real data and runs every time.
- 56 series is enough to see the size of the differences, not to rank the families finely.
- I could not open the production site from here, so which engine production uses is for you to check with the link above.
