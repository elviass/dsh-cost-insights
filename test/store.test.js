import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LedgerStore } from '../lib/store.js'

test('SQLite ledger groups usage and never persists prompt, response, or key fields', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-usage-insights-'))
  const path = join(root, 'ledger.sqlite')
  const store = await new LedgerStore(path).open()
  try {
    store.account({
      id: 'call-1',
      at: Date.parse('2026-08-20T02:00:00Z'),
      sessionId: 'child',
      rootSessionId: 'root',
      workspaceId: 'workspace-1',
      workspace: 'F:/workspace',
      provider: 'deepseek',
      model: 'deepseek-chat',
      credentialRef: 'DEEPSEEK_API_KEY',
      purpose: 'main-agent',
      terminal: 'finished',
      tokens: { inputTokens: 800, cacheReadTokens: 200, cacheWriteTokens: 0, outputTokens: 100, reasoningTokens: 40 },
      cacheSupported: true,
      priced: true,
      currency: 'USD',
      costNative: 0.001,
      costUsd: 0.001,
      costCny: 0.0067,
      usdToCny: 6.7,
      prompt: 'must never persist',
      response: 'must never persist',
      apiKey: `sk-${'must-never-persist'}`,
    })
    const result = store.query({ sessionId: 'root', groupBy: 'workspace' })
    assert.equal(result.totals.calls, 1)
    assert.equal(result.totals.cacheHitRate, 0.2)
    assert.equal(Math.abs(result.totals.inputCostCny + result.totals.cacheWriteCostCny + result.totals.outputCostCny - result.totals.costCny) < 1e-10, true)
    assert.equal(result.groups[0].key, 'workspace-1')
    const exported = JSON.stringify(store.exportData({}))
    assert.equal(exported.includes('must never persist'), false)
    assert.equal(exported.includes(`sk-${'must-never-persist'}`), false)
    const bytes = await readFile(path)
    assert.equal(bytes.includes(Buffer.from('must never persist')), false)
  } finally {
    store.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('expired call details become permanent daily rollups without losing filters or totals', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-usage-rollup-'))
  const path = join(root, 'ledger.sqlite')
  const store = await new LedgerStore(path).open()
  try {
    const at = Date.parse('2020-01-02T04:00:00Z')
    store.account({
      id: 'old-call', at, sessionId: 'old-session', workspaceId: 'old-workspace', workspace: 'F:/old',
      provider: 'deepseek', model: 'deepseek-chat', credentialRef: 'KEY_A', purpose: 'main-agent', terminal: 'finished',
      tokens: { inputTokens: 100, cacheReadTokens: 25, outputTokens: 10 }, cacheSupported: true,
      priced: true, currency: 'USD', costNative: 1, costUsd: 1, costCny: 7, usdToCny: 7,
    })
    const pruned = store.prune(Date.parse('2026-08-20T00:00:00Z'))
    assert.equal(pruned.removed, 1)
    assert.equal(store.db.prepare('SELECT COUNT(*) count FROM calls').get().count, 0)
    assert.equal(store.db.prepare('SELECT COUNT(*) count FROM daily_rollups').get().count, 1)
    const result = store.query({ provider: 'deepseek', workspaceId: 'old-workspace', groupBy: 'model' })
    assert.equal(result.totals.calls, 1)
    assert.equal(result.totals.costCny, 7)
    assert.equal(result.totals.cacheHitRate, 0.2)
    assert.equal(result.groups[0].key, 'deepseek-chat')
    const options = store.getFilterOptions()
    assert.deepEqual(options.providers, ['deepseek'])
    assert.deepEqual(options.models, ['deepseek-chat'])
    assert.deepEqual(options.conversations, ['old-session'])
    assert.deepEqual(options.conversationWorkspaces, [{ conversation: 'old-session', workspace_key: 'id:old-workspace' }])
    assert.deepEqual(options.providerModels, [{ provider: 'deepseek', model: 'deepseek-chat' }])
  } finally {
    store.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('diagnostic export contains runtime health without sensitive fields', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-usage-diagnostics-'))
  const path = join(root, 'ledger.sqlite')
  const store = await new LedgerStore(path).open()
  try {
    const diagnostics = store.exportDiagnostics()
    const serialized = JSON.stringify(diagnostics)
    assert.equal(diagnostics.plugin.version, '1.0.0')
    assert.equal(diagnostics.privacy.apiKeys, false)
    assert.equal(diagnostics.privacy.prompts, false)
    assert.equal(serialized.includes('DEEPSEEK_API_KEY'), false)
  } finally {
    store.close()
    await rm(root, { recursive: true, force: true })
  }
})
