/* Client report export: branded PDF, PowerPoint or Excel built from the summary this browser computed.
 * The server receives the dashboard summary, forecast results and the Planner's Evidence, never raw rows. A copy is kept per client. */
(function (App) {
  App.lastForecast = App.lastForecast || {}; App.lastScenarios = App.lastScenarios || {}; App.lastPacing = App.lastPacing || {}; App.lastInsights = App.lastInsights || {};
  App.exporter = {
    hasPrediction: (kind) => !!(App.predictEvidence && App.predictEvidence[kind]),
    async run(format, ctx, opts) {
      const k = ctx.fkey();
      const pick = (store, on) => (on && App[store][k] ? App[store][k].result : null);
      const pe = opts.includePrediction && App.predictEvidence ? App.predictEvidence[ctx.kind] : null;
      const ai = opts.includeAi && App.lastInsights[k] ? App.lastInsights[k].insights : null;
      const evidence = pe ? pe.kpis.map(([l, v]) => `${pe.title}: ${l} = ${v} (${pe.span || "next " + pe.horizon + " days"})`).concat(pe.lines) : [];
      const meta = { ...(ctx.meta || {}) };
      const { blob, name } = await App.api.blob('/api/export', { kind: ctx.kind, format, dataset: ctx.dataset(), dash: ctx.data, meta, files: (ctx.state && ctx.state.files) || [],
        title: opts.title || '', include_ai: !!opts.includeAi, ai, evidence: evidence.slice(0, 20),
        forecast: pick('lastForecast', opts.includeForecast) || (pe ? pe.result : null), scenarios: pick('lastScenarios', opts.includeScenarios), pacing: pick('lastPacing', opts.includePacing),
        saved_ids: opts.savedIds || null });
      App.download(blob, name);
      App.toast(`Report ready: ${name}`, 'ok');
    },
  };
})(window.App);
