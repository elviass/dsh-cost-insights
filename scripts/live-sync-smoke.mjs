import { refreshFx, syncOfficialPrices } from '../lib/providers.js'

const providers = new Set(['deepseek', 'openrouter', 'openai', 'google', 'anthropic'])
const models = new Set([
  'deepseek:deepseek-v4-flash',
  'openrouter:deepseek/deepseek-chat',
  'openai:gpt-5.6-sol',
  'google:gemini-3.1-pro-preview',
  'anthropic:claude-sonnet-4-6',
])
const result = await syncOfficialPrices({
  priceSync: Object.fromEntries([...providers].map(provider => [provider, true])),
  pricing: { thirdPartyUrl: 'https://openrouter.ai/api/v1/models' },
}, providers, models)

const failures = []
for (const provider of providers) {
  const source = result.sources[provider]
  if (source?.status !== 'ok') failures.push(`${provider}: ${source?.error || source?.status || 'missing status'}`)
}
const fx = await refreshFx()
if (fx.status !== 'ok' || !(fx.rate > 0)) failures.push(`ecb: ${fx.status || 'invalid rate'}`)

if (failures.length) {
  failures.forEach(failure => console.error(`live-sync: ${failure}`))
  process.exit(1)
}
console.log(JSON.stringify({
  sources: Object.fromEntries(Object.entries(result.sources).map(([id, source]) => [id, { status: source.status, modelCount: source.modelCount }])),
  fx: { status: fx.status, observedAt: fx.observedAt },
}, null, 2))
