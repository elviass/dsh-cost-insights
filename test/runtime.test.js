import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'

function fakeContext() {
  const handlers = new Map()
  const cleanups = []
  const services = {}
  const headers = new Map([
    ['child', { parentSession: 'root', workspaceId: 'workspace-1', cwd: 'F:/synthetic' }],
    ['root', { workspaceId: 'workspace-1', cwd: 'F:/synthetic' }],
  ])
  return {
    handlers, cleanups, services,
    llm: { listProviders: () => [] },
    sessions: { get: id => ({ header: headers.get(String(id)) }) },
    sessionQuery: { readTitleSnapshots: async ids => ids.map(id => ({ status: 'fulfilled', value: { title: { title: `Session ${id}` } } })) },
    workspaceRegistry: { list: () => [{ id: 'workspace-1', path: 'F:/synthetic', title: 'Synthetic' }] },
    provide(name, value) { services[name] = value },
    on(name, handler) { handlers.set(name, handler) },
    effect(factory) { const cleanup = factory(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
  }
}

async function consume(iterable) {
  const chunks = []
  for await (const chunk of iterable) chunks.push(chunk)
  return chunks
}

test('LLM middleware accounts usage, deduplicates calls, classifies subagents, and ignores raw credentials', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-usage-runtime-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = root
  const ctx = fakeContext()
  try {
    await apply(ctx)
    const middleware = ctx.handlers.get('llm/stream')
    assert.equal(typeof middleware, 'function')
    const options = {
      callId: 'call-1', sessionId: 'child', provider: 'deepseek-official', model: 'deepseek-v4-flash',
      credential: `AIza${'B'.repeat(32)}`, credentialRef: 'DEEPSEEK_API_KEY',
    }
    const source = async function* () {
      yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 50 } }
      yield { type: 'finish', reason: { kind: 'completed' } }
    }
    await consume(middleware(options, source))
    await consume(middleware(options, source))
    await consume(middleware({ ...options, callId: 'no-usage' }, async function* () { yield { type: 'finish', reason: 'completed' } }))

    const analytics = await ctx.services.usageInsights.queryAnalytics({ groupBy: 'purpose' })
    assert.equal(analytics.totals.calls, 1)
    assert.equal(analytics.groups[0].key, 'subagent')
    assert.equal(analytics.recent[0].credentialRef, 'DEEPSEEK_API_KEY')
    assert.equal(JSON.stringify(analytics).includes(options.credential), false)
  } finally {
    for (const cleanup of ctx.cleanups.reverse()) await cleanup()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(root, { recursive: true, force: true })
  }
})

test('LLM middleware records terminal errors when usage was already observed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-usage-runtime-error-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = root
  const ctx = fakeContext()
  try {
    await apply(ctx)
    const source = async function* () {
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 1 } }
      throw Object.assign(new Error('synthetic failure'), { code: 'SYNTHETIC_ERROR' })
    }
    await assert.rejects(() => consume(ctx.handlers.get('llm/stream')({ callId: 'failed-call', sessionId: 'root', provider: 'deepseek', model: 'unknown' }, source)), /synthetic failure/)
    const analytics = await ctx.services.usageInsights.queryAnalytics({ groupBy: 'purpose' })
    assert.equal(analytics.totals.calls, 1)
    assert.equal(analytics.totals.failedCalls, 1)
    assert.equal(analytics.recent[0].terminal, 'SYNTHETIC_ERROR')
  } finally {
    for (const cleanup of ctx.cleanups.reverse()) await cleanup()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(root, { recursive: true, force: true })
  }
})

test('LLM middleware records aborts with usage and ignores streams disposed before completion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-usage-runtime-dispose-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = root
  const ctx = fakeContext()
  try {
    await apply(ctx)
    const middleware = ctx.handlers.get('llm/stream')
    const aborted = async function* () {
      yield { type: 'usage', usage: { inputTokens: 4, outputTokens: 2 } }
      throw Object.assign(new Error('synthetic abort'), { name: 'AbortError' })
    }
    await assert.rejects(() => consume(middleware({ callId: 'abort-call', sessionId: 'root', provider: 'deepseek', model: 'unknown' }, aborted)), /synthetic abort/)
    assert.equal((await ctx.services.usageInsights.queryAnalytics()).recent[0].terminal, 'AbortError')

    let release
    const waiting = new Promise(resolve => { release = resolve })
    const late = async function* () {
      yield { type: 'usage', usage: { inputTokens: 99, outputTokens: 1 } }
      await waiting
      yield { type: 'finish', reason: 'completed' }
    }
    const consuming = consume(middleware({ callId: 'late-call', sessionId: 'root', provider: 'deepseek', model: 'unknown' }, late))
    await new Promise(resolve => setImmediate(resolve))
    for (const cleanup of ctx.cleanups.splice(0).reverse()) await cleanup()
    release()
    await consuming
  } finally {
    for (const cleanup of ctx.cleanups.reverse()) await cleanup()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(root, { recursive: true, force: true })
  }
})
