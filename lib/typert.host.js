/* Host RPC contribution for DSH remote services. */
import { z } from 'zod'
import { configPatchSchema, customPriceInputSchema, filterSchema, priceKeySchema, priceSourceSchema, sessionIdSchema } from './validation.js'

const unknown = (symbol = 'dsh-usage-insights#JsonValue') => ({
  mode: 'strict',
  typeSymbol: symbol,
  schema: z.unknown(),
})

const parameterSchemas = {
  sessionId: sessionIdSchema,
  filter: filterSchema.optional(),
  patch: configPatchSchema,
  key: priceKeySchema,
  source: priceSourceSchema.optional(),
  entry: customPriceInputSchema.optional(),
}

const invocation = (method, parameters = []) => ({
  id: `dsh-usage-insights#usageInsights/${method}`,
  service: 'usageInsights',
  namespace: 'usageInsights',
  method,
  invocation: { kind: 'direct' },
  parameters: parameters.map((name, index) => ({
    name,
    wire: name,
    source: 'json',
    codec: {
      mode: 'strict',
      typeSymbol: `dsh-usage-insights#${method}Parameter${index}`,
      schema: parameterSchemas[name] || z.unknown(),
    },
  })),
  result: unknown(`dsh-usage-insights#${method}Result`),
  sourceLocation: { file: 'lib/index.js', line: 1, column: 1 },
})

export const TYPERT = {
  package: 'dsh-usage-insights',
  face: 'host',
  schemas: [],
  invocations: [
    invocation('getState'),
    invocation('getFilterOptions'),
    invocation('getPriceCatalog'),
    invocation('getSessionSummary', ['sessionId']),
    invocation('queryAnalytics', ['filter']),
    invocation('updateConfig', ['patch']),
    invocation('setPricePreference', ['key', 'source']),
    invocation('setCustomPrice', ['key', 'entry']),
    invocation('syncPrices'),
    invocation('refreshFx'),
    invocation('refreshBalances'),
    invocation('backup'),
    invocation('exportDiagnostics'),
    invocation('clearHistory'),
    invocation('exportData', ['filter']),
  ],
  model: {
    package: 'dsh-usage-insights',
    face: 'host',
    services: [{
      description: 'Usage Insights ledger, pricing, balance and analytics service.',
      summary: 'Usage Insights host service.',
      tags: [],
      jsDoc: '/** Cost Insights ledger, pricing, balance and analytics service. */',
      key: 'usageInsights',
      exportName: 'UsageInsightsService',
      members: [
        { kind: 'method', name: 'getState', signature: 'getState(): Promise<unknown>', summary: 'Read dashboard state.', jsDoc: '/** Read dashboard state. */' },
        { kind: 'method', name: 'getFilterOptions', signature: 'getFilterOptions(): Promise<unknown>', summary: 'Read available analytics filter values.', jsDoc: '/** Read filter values. */' },
        { kind: 'method', name: 'getPriceCatalog', signature: 'getPriceCatalog(): Promise<unknown>', summary: 'Read compact official model price catalog.', jsDoc: '/** Read compact official price catalog. */' },
        { kind: 'method', name: 'getSessionSummary', signature: 'getSessionSummary(sessionId: unknown): Promise<unknown>', summary: 'Read one conversation cost and current pricing summary.', jsDoc: '/** Read one conversation summary. */' },
        { kind: 'method', name: 'queryAnalytics', signature: 'queryAnalytics(filter: unknown): Promise<unknown>', summary: 'Query filtered analytics.', jsDoc: '/** Query filtered analytics. */' },
        { kind: 'method', name: 'updateConfig', signature: 'updateConfig(patch: unknown): Promise<unknown>', summary: 'Update plugin configuration.', jsDoc: '/** Update plugin configuration. */' },
        { kind: 'method', name: 'setPricePreference', signature: 'setPricePreference(key: unknown, source: unknown): Promise<unknown>', summary: 'Choose one price source for a model.', jsDoc: '/** Choose a model price source. */' },
        { kind: 'method', name: 'setCustomPrice', signature: 'setCustomPrice(key: unknown, entry: unknown): Promise<unknown>', summary: 'Set or remove a custom model price.', jsDoc: '/** Set or remove a custom model price. */' },
        { kind: 'method', name: 'syncPrices', signature: 'syncPrices(): Promise<unknown>', summary: 'Synchronize official prices.', jsDoc: '/** Synchronize official prices. */' },
        { kind: 'method', name: 'refreshFx', signature: 'refreshFx(): Promise<unknown>', summary: 'Refresh the official reference FX rate.', jsDoc: '/** Refresh the official reference FX rate. */' },
        { kind: 'method', name: 'refreshBalances', signature: 'refreshBalances(): Promise<unknown>', summary: 'Refresh configured balances.', jsDoc: '/** Refresh configured balances. */' },
        { kind: 'method', name: 'backup', signature: 'backup(): Promise<unknown>', summary: 'Back up the SQLite ledger.', jsDoc: '/** Back up the SQLite ledger. */' },
        { kind: 'method', name: 'exportDiagnostics', signature: 'exportDiagnostics(): Promise<unknown>', summary: 'Export a sanitized diagnostic log.', jsDoc: '/** Export sanitized diagnostics without content or secrets. */' },
        { kind: 'method', name: 'clearHistory', signature: 'clearHistory(): Promise<unknown>', summary: 'Clear plugin history.', jsDoc: '/** Clear plugin history. */' },
        { kind: 'method', name: 'exportData', signature: 'exportData(filter: unknown): Promise<unknown>', summary: 'Export filtered plugin data.', jsDoc: '/** Export filtered plugin data. */' },
      ],
      types: [],
    }],
    events: [],
    objects: [],
  },
}
