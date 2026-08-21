import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchDeepSeekBalance, syncOfficialPrices } from '../lib/providers.js'
import { parseConfigPatch, parseFilter } from '../lib/validation.js'

test('configuration validation enforces bounded values and the fixed OpenRouter catalog', () => {
  assert.equal(parseConfigPatch({ retentionDays: 30 }).retentionDays, 30)
  assert.throws(() => parseConfigPatch({ retentionDays: 0 }))
  assert.throws(() => parseConfigPatch({ unknown: true }))
  assert.throws(() => parseConfigPatch({ pricing: { thirdPartyUrl: 'https://127.0.0.1/models' } }))
  assert.equal(parseConfigPatch({ pricing: { thirdPartyUrl: 'https://openrouter.ai/api/v1/models' } }).pricing.thirdPartyUrl, 'https://openrouter.ai/api/v1/models')
})

test('analytics filters reject unknown dimensions and oversized values', () => {
  assert.deepEqual(parseFilter({ range: '7d', groupBy: 'model' }), { range: '7d', groupBy: 'model' })
  assert.throws(() => parseFilter({ groupBy: 'secret' }))
  assert.throws(() => parseFilter({ model: 'x'.repeat(257) }))
})

test('price synchronization never fetches a configured arbitrary URL', async () => {
  const originalFetch = globalThis.fetch
  const urls = []
  globalThis.fetch = async url => {
    urls.push(String(url))
    return { ok: true, status: 200, statusText: 'OK', async json() { return { data: [{ id: 'openai/gpt-safe', pricing: { prompt: '0.000001', completion: '0.000002' } }] } }, async text() { return '' } }
  }
  try {
    await syncOfficialPrices({
      priceSync: { deepseek: false, openrouter: true, openai: false, google: false, anthropic: false },
      pricing: { thirdPartyUrl: 'https://127.0.0.1/internal' },
    }, new Set(['openrouter']), new Set(['openrouter:openai/gpt-safe']))
    assert.deepEqual(urls, ['https://openrouter.ai/api/v1/models'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('provider errors redact non-sk API key formats', async () => {
  const originalFetch = globalThis.fetch
  const googleStyleKey = `AIza${'A'.repeat(32)}`
  globalThis.fetch = async () => { throw new Error(`request failed for ${googleStyleKey}`) }
  try {
    const result = await fetchDeepSeekBalance({ get: () => ({ resolve: async () => googleStyleKey }) }, { credentialRef: 'GOOGLE_STYLE_KEY' })
    assert.equal(result.status, 'error')
    assert.equal(result.error.includes(googleStyleKey), false)
    assert.equal(result.error.includes('[redacted]'), true)
  } finally {
    globalThis.fetch = originalFetch
  }
})
