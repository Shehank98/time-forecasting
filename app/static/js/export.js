/* Client report export: branded PDF, PowerPoint or Excel that respects filters; a copy is kept per client. */
(function (App) {
  App.lastForecast = App.lastForecast || {}; App.lastScenarios = App.lastScenarios || {}; App.lastPacing = App.lastPacing || {}; App.lastInsights = App.lastInsights || {};
  App.exporter = {
    async run(format, ctx, opts) {
      const k = ctx.fkey();
      const pick = (store, on) => (on && App[store][k] ? App[store][k].params : null);
      const ai = opts.includeAi && App.lastInsights[k] ? App.lastInsights[k].insights : null;
      const { blob, name } = await App.api.blob('/api/export', ctx.body({ format, title: opts.title || '', include_ai: !!opts.includeAi, ai,
        forecast: pick('lastForecast', opts.includeForecast), scenarios: pick('lastScenarios', opts.includeScenarios), pacing: pick('lastPacing', opts.includePacing), saved_ids: opts.savedIds || null }));
      App.download(blob, name);
      App.toast(`Report ready: ${name}`, 'ok');
    },
  };
})(window.App);
