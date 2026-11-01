/* "?" explanations for every chart and table in the analysis tabs, matched by card title.
 * Prediction charts carry their own text; these describe how each view is built and what a planner gets from it.
 */
(function (App) {
  const H = {
    // TV analysis
    'Top programmes by average TVR': ['Average TVR across all airings of each programme on each channel, after the filters.', 'The programmes that reliably pull the biggest audiences, for shortlisting a buy.'],
    'Average TVR by channel': ['Mean TVR of every airing per channel in the filtered window.', 'Which stations carry the strongest average audience.'],
    'Daily average TVR': ['Mean TVR of all airings for each day. This history is what the TVR fan chart forecasts.', 'Spot dips, peaks and seasonality before you plan.'],
    'Top programmes': ['One row per programme and channel: airings, average and peak TVR, reach and share.', 'A sortable shortlist; click a header to re-rank by reach or share.'],
    'Average TVR: channel by category': ['Mean TVR for every channel and category pair. Darker cells mean bigger audiences.', 'Which channel owns which genre.'],
    'Average TVR: channel by daypart': ['Mean TVR for every channel and daypart pair.', 'The best daypart on each channel.'],
    'Average TVR: channel by day of week': ['Mean TVR for every channel and weekday pair.', 'Weekday strengths per channel for scheduling.'],
    'Average TVR: time-belt by day of week': ['Programme start times are grouped into time-belts and averaged per weekday.', 'Exact belts that work on each day; the TVR forecast tab projects this forward.'],
    'Category performance': ['Average TVR per programme category.', 'Genres that deliver the biggest audiences.'],
    'Category trend': ['Weekly average TVR of the top categories.', 'Whether a genre is gaining or fading; the forecast tab projects the share shift.'],
    'Efficiency': ['TVR and reach divided by programme minutes.', 'Short programmes that deliver a lot of audience per minute of airtime.'],
    // LMRB analysis
    'Share of voice over time': ['Each advertiser\'s weekly spend as a share of the competitor set\'s total.', 'Who is gaining or losing presence week by week.'],
    'Spend by advertiser': ['Total monitored spend per advertiser in the filtered window.', 'The size of each competitor\'s TV investment.'],
    'Latest competitor movements': ['Rules compare the last 7 days with the 7 days before: spend changes over 30%, channel starts and stops, new or dropped creatives and possible discounts.', 'A weekly briefing of what rivals just did.'],
    'Spend ranking': ['Spend per item of the chosen dimension, ranked, with change versus the comparison window.', 'Where the money goes and what moved.'],
    'Share of spend': ['Each item\'s share of total spend in the window.', 'Concentration of spend at a glance.'],
    'Advertiser by channel': ['Spend for every advertiser and channel pair.', 'Each competitor\'s channel mix.'],
    'Advertiser by daypart': ['Spend for every advertiser and daypart pair.', 'When in the day each competitor buys.'],
    'Advertiser by programme (top programmes in scope)': ['Spend for each advertiser in the most-bought programmes.', 'Programmes your rivals depend on.'],
    'Daily spot calendar': ['Spots per day per advertiser; darker means more spots.', 'Flighting rhythm: always-on, pulsing or bursts.'],
    'Flighting patterns': ['Active days, gaps, bursts (days well above the advertiser\'s average) and a pattern label per advertiser.', 'How each competitor schedules campaigns.'],
    'Median cost per second by channel and daypart (LKR)': ['Spend divided by seconds for every spot, then the median per channel and daypart.', 'A fair price map for negotiations.'],
    'Possible discount deals': ['Advertiser cells paying at least 20% below the channel and daypart median cost per second over 3 or more spots.', 'Who is getting better rates than the market.'],
    'Price outlier spots': ['Spots whose cost per second sits far outside the usual range for that channel and daypart (Tukey rule).', 'Data errors or special deals worth checking.'],
    'Cost per second by advertiser, channel and daypart': ['Cost per second for every advertiser, channel and daypart cell, indexed to the cell median.', 'Detailed rate benchmarking.'],
    'First and last in break rate': ['Share of each advertiser\'s spots placed first or last in the break.', 'Who pays for premium positions.'],
    'Share of all first-in-break placements': ['Each advertiser\'s share of all first-position spots.', 'Who dominates the most visible slot.'],
    'Weekly spend': ['Weekly spend of the two compared advertisers.', 'Side-by-side pressure over time.'],
    'Spend by channel': ['Spend per channel for the two compared advertisers.', 'Channel strategy differences.'],
    'Spend by daypart': ['Spend per daypart for the two compared advertisers.', 'Timing strategy differences.'],
    'Spend by language': ['Spend per ad language for the two compared advertisers.', 'Audience language focus.'],
    'GRPs by advertiser': ['Each spot is matched to the programme airing at that time and given its TVR; ratings are summed per advertiser.', 'Delivered audience, not just money spent.'],
    'CPRP by advertiser': ['Spend on matched spots divided by GRPs.', 'Who buys rating points most efficiently.'],
    'Weekly GRPs': ['Matched spot ratings summed per week per advertiser.', 'Delivered weight over time.'],
    'CPRP by channel and daypart (LKR)': ['Spend divided by GRPs per channel and daypart.', 'The cheapest places to buy rating points.'],
    'By channel': ['GRPs, cost and CPRP per channel.', 'Channel efficiency for the competitor set.'],
    'By daypart': ['GRPs, cost and CPRP per daypart.', 'Daypart efficiency.'],
    'Programmes delivering the most GRPs': ['Matched programmes ranked by GRPs delivered to the competitor set.', 'Programmes that carry the category\'s weight.'],
    // KPI
    'Trend': ['The chosen metric per period after the filters.', 'Direction and seasonality of the client\'s own results.'],
    'Day of week pattern': ['Average of the metric for each weekday, indexed so 100 is an average day.', 'Which days convert best.'],
    'Seasonal pattern': ['Average of the metric per calendar month, indexed so 100 is an average month (needs about a year of data).', 'High and low seasons for planning.'],
    // Forecast studio
    'Actuals and forecast': ['The forecast engine forecasts each series with low case, most likely and high case estimates; the orange band is the backtest range for the latest periods.', 'Expected values, a likely range and alerts when actuals leave the expected band.'],
    'Expected results by scenario': ['The forecast engine forecasts the result with planned spend as a covariate (XReg) for each budget scenario.', 'How results respond to more or less spend, and the cost per extra result.'],
    'Results over the horizon': ['The most likely result path for each spend scenario.', 'When the extra results arrive.'],
    'Outlook summary': ['Trend, expected totals, activity and peaks per forecast series.', 'Which entities are emerging or declining.'],
    'Scenario comparison': ['Totals, ranges and cost per result for each spend plan.', 'The most efficient budget level.'],
  };
  App.HELP = H;
  /** Adds a "?" next to every card title in the element that has an explanation and none yet. */
  App.decorateHelp = function (root) {
    if (!root) return;
    root.querySelectorAll('.card h3').forEach((h) => {
      if (h.querySelector('.help')) return;
      const t = h.textContent.trim(), e = H[t];
      if (!e) return;
      h.insertAdjacentHTML('beforeend', ' ' + App.help(e[0], e[1], { howLabel: 'How it is built' }));
      h.style.display = 'flex'; h.style.alignItems = 'center'; h.style.gap = '8px';
    });
  };
})(window.App);
