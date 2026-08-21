import test from 'node:test'
import assert from 'node:assert/strict'
import { parseEcbFxCsv, parseMoonshotBalance, parseSiliconFlowBalance, refreshBalances, syncOfficialPrices } from '../lib/providers.js'

test('ECB EUR-reference observations produce a USD/CNY cross rate', () => {
  const csv = [
    'CURRENCY,TIME_PERIOD,OBS_VALUE',
    'USD,2026-08-20,1.1681',
    'CNY,2026-08-20,7.8538',
  ].join('\n')
  const result = parseEcbFxCsv(csv, '2026-08-20T12:00:00.000Z')
  assert.equal(result.source, 'ecb-reference')
  assert.equal(result.observedAt, '2026-08-20')
  assert.ok(Math.abs(result.rate - 6.723568187655166) < 1e-12)
})

test('manual balances are structured local data and never retain arbitrary request URLs', async () => {
  const result = await refreshBalances({ get() { return null } }, {
    balanceAdapters: { deepseek: { enabled: false }, openrouter: { enabled: false } },
    manualBalances: [{ id: 'custom', provider: 'custom', currency: 'CNY', total: 100, remaining: 60, url: 'https://untrusted.invalid/balance' }],
  })
  assert.equal(result.custom.accounts[0].remaining, 60)
  assert.equal(JSON.stringify(result).includes('untrusted.invalid'), false)
})

test('official CNY balance payloads normalize Moonshot cents and SiliconFlow yuan', () => {
  assert.equal(parseMoonshotBalance({ available_balance: 12345 }), 123.45)
  assert.equal(parseMoonshotBalance({ data: { available_balance: 12.5 } }), 12.5)
  assert.equal(parseSiliconFlowBalance({ data: { balance: '88.60' } }), 88.6)
})

test('price sync only retains configured models and never treats a form URL as an automatic source', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    return { ok: true, status: 200, statusText: 'OK', async json() { return { data: [
      { id: 'deepseek/deepseek-v4-flash', pricing: { prompt: '0.000001', completion: '0.000004' } },
      { id: 'deepseek/deepseek-v4-pro', pricing: { prompt: '0.000002', completion: '0.000008' } },
    ] } }, async text() { return '' } }
  }
  try {
    const result = await syncOfficialPrices({
      priceSync: { deepseek: false, openrouter: true, openai: false, google: false, anthropic: false },
      pricing: { thirdPartyUrl: 'https://example.invalid/models', formUrl: 'https://example.invalid/form.json' },
    }, new Set(['openrouter', 'deepseek']), new Set(['deepseek:deepseek-v4-flash']))
    assert.equal(calls, 1)
    assert.ok(result.candidates['deepseek:deepseek-v4-flash']?.thirdParty)
    assert.equal(result.candidates['deepseek:deepseek-v4-pro'], undefined)
    assert.equal(result.sources.form, undefined)
  } finally {
    globalThis.fetch = originalFetch
  }
})
