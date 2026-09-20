import test from 'node:test'
import assert from 'node:assert/strict'

test('client activation does not wait for the initial analytics refresh', async () => {
  const previousWindow = globalThis.window
  let definition
  globalThis.window = {
    __ModuleLoader__: {
      load(value) { definition = value },
    },
  }

  const cleanups = []
  try {
    await import('../lib/client.js')
    assert.equal(definition?.id, 'dsh-cost-insights')

    const client = definition.factory((name) => {
      if (name === 'react') {
        return {
          Fragment: Symbol('Fragment'),
          createElement() {},
          memo(component) { return component },
        }
      }
      if (name === '@deepseek-ai/dsh-client-ui-primitives') return { Tooltip() {} }
      throw new Error(`unexpected client dependency: ${name}`)
    })

    let refreshCalls = 0
    const pendingRefresh = () => {
      refreshCalls += 1
      return new Promise(() => {})
    }
    const remote = {
      getState: pendingRefresh,
      getFilterOptions: pendingRefresh,
      queryAnalytics: pendingRefresh,
      getPriceCatalog: pendingRefresh,
    }
    const ctx = {
      remote: { async $mount() {} },
      get(name) {
        assert.equal(name, 'remote.usageInsights')
        return remote
      },
      locale: {
        getSnapshot() { return { active: 'en' } },
      },
      on() {},
      slots: { inject() {} },
      effect(factory) {
        const cleanup = factory()
        if (typeof cleanup === 'function') cleanups.push(cleanup)
      },
    }

    const outcome = await Promise.race([
      client.apply(ctx).then(() => 'resolved'),
      new Promise(resolve => setTimeout(() => resolve('timed out'), 100)),
    ])

    assert.equal(outcome, 'resolved')
    assert.equal(refreshCalls, 4)
  } finally {
    for (const cleanup of cleanups.reverse()) cleanup()
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
})
