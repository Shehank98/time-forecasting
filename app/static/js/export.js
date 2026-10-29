/* Report export: asks the server for an Excel or PDF file that respects filters and downloads it. */
(function (App) {
  App.exporter = {
    async run(format, ctx, opts) {
      const fc = opts.includeForecast && App.lastForecast && App.lastForecast[ctx.kind] ? App.lastForecast[ctx.kind].params : null;
      const ai = opts.includeAi && App.lastInsights && App.lastInsights[ctx.kind] ? App.lastInsights[ctx.kind].insights : null;
      const { blob, name } = await App.api.blob('/api/export', { kind: ctx.kind, format, filters: ctx.filters(), options: ctx.options(), include_ai: !!opts.includeAi, forecast: fc, ai });
      App.download(blob, name);
      App.toast(`Report ready: ${name}`, 'ok');
    },
  };
})(window.App);
