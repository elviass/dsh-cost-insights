import { createHash } from 'node:crypto'
import { bindTypertRemote } from '@deepseek-ai/dsh-typert-protocol'
import { calculateCost, normalizeProviderId, resolvePrice } from './pricing.js'
import { openLedger } from './store.js'
import { refreshBalances as fetchBalances, refreshFx as fetchFx, syncOfficialPrices } from './providers.js'
import { customPriceInputSchema, parseConfigPatch, parseFilter, priceKeySchema, priceSourceSchema, sessionIdSchema } from './validation.js'

export const name = 'usage-insights'
export const inject = ['llm', 'sessions', 'sessionQuery', 'workspaceRegistry']

function text(value, fallback = 'unknown') {
  if (typeof value === 'string' && value) return value
  if (typeof value?.id === 'string' && value.id) return value.id
  if (typeof value?.name === 'string' && value.name) return value.name
  return fallback
}

function usageBuckets(usage) {
  const has = key => Object.prototype.hasOwnProperty.call(usage || {}, key)
  return {
    inputTokens: Number(usage?.inputTokens) || 0,
    outputTokens: Number(usage?.outputTokens) || 0,
    cacheReadTokens: Number(usage?.cacheReadTokens) || 0,
    cacheWriteTokens: Number(usage?.cacheWriteTokens) || 0,
    reasoningTokens: Number(usage?.reasoningTokens) || 0,
    cacheSupported: has('cacheReadTokens') || has('cacheWriteTokens'),
  }
}

function sessionHeader(ctx, sessionId) {
  if (!sessionId) return null
  try { return ctx.sessions.get(sessionId)?.header || null } catch { return null }
}

function sessionContext(ctx, sessionId) {
  const header = sessionHeader(ctx, sessionId)
  let rootSessionId = sessionId || null
  let current = header
  const seen = new Set(sessionId ? [String(sessionId)] : [])
  for (let depth = 0; current?.parentSession && depth < 64; depth += 1) {
    const parentId = text(current.parentSession, '')
    if (!parentId || seen.has(parentId)) break
    seen.add(parentId)
    rootSessionId = parentId
    current = sessionHeader(ctx, parentId)
  }
  return {
    header,
    rootSessionId,
    parentSessionId: header?.parentSession ? text(header.parentSession, '') || null : null,
    workspaceId: text(header?.workspaceId || header?.workspace, '') || null,
    workspace: String(header?.cwd || ''),
  }
}

async function conversationOptions(ctx, ids) {
  const values = [...new Set((ids || []).filter(Boolean).map(String))]
  if (!values.length) return []
  try {
    const snapshots = await ctx.sessionQuery.readTitleSnapshots(values)
    return values.map((value, index) => {
      const result = snapshots[index]
      const label = result?.status === 'fulfilled' ? result.value?.title?.title : null
      return { value, label: typeof label === 'string' && label.trim() ? label.trim() : value }
    })
  } catch {
    return values.map(value => ({ value, label: value }))
  }
}

function workspaceOptions(ctx, rows) {
  let registered = []
  try { registered = ctx.workspaceRegistry.list() } catch {}
  const names = new Map()
  for (const workspace of registered) {
    const label = String(workspace.title || workspace.path || workspace.id)
    names.set(String(workspace.id), label)
    names.set(String(workspace.path), label)
  }
  return (rows || []).map(row => {
    const raw = String(row.value || '')
    const identity = raw.startsWith('id:') ? raw.slice(3) : raw.startsWith('path:') ? raw.slice(5) : raw
    return { ...row, label: names.get(identity) || row.label || identity }
  })
}

async function decorateAnalytics(ctx, analytics, groupBy) {
  if (!analytics || !Array.isArray(analytics.groups)) return analytics
  let labels = new Map()
  if (groupBy === 'conversation') {
    const options = await conversationOptions(ctx, analytics.groups.map(row => row.key))
    labels = new Map(options.map(option => [option.value, option.label]))
  } else if (groupBy === 'workspace') {
    const rows = analytics.groups.map(row => ({ value: String(row.key), label: String(row.key) }))
    labels = new Map(workspaceOptions(ctx, rows).map(option => [option.value, option.label]))
  }
  if (!labels.size) return analytics
  return { ...analytics, groups: analytics.groups.map(row => ({ ...row, displayKey: labels.get(String(row.key)) || String(row.key) })) }
}

function configuredPriceProviders(ctx, store) {
  const providers = new Set()
  try {
    for (const provider of ctx.llm.listProviders()) providers.add(normalizeProviderId(text(provider, '')))
  } catch {}
  if (!providers.size) for (const provider of store.getFilterOptions().providers || []) providers.add(normalizeProviderId(text(provider, '')))
  return providers
}

function classifyPurpose(options, context) {
  const explicit = String(options?.purpose || options?.operation || options?.kind || '').toLowerCase()
  if (explicit.includes('title')) return 'session-title'
  if (explicit.includes('compact') || explicit.includes('compress')) return 'compaction'
  if (explicit.includes('subagent') || explicit.includes('delegate')) return 'subagent'
  if (['conversation', 'main-agent', 'session-title', 'compaction', 'subagent', 'system-other', 'unknown'].includes(explicit)) return explicit
  if (context.parentSessionId) return 'subagent'
  if (options?.sessionId) return 'main-agent'
  return 'unknown'
}

function credentialReference(options) {
  for (const key of ['credentialRef', 'apiKeyRef', 'apiKeyEnv']) {
    const value = options?.[key]
    if (typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_.:-]{0,127}$/.test(value) && !value.startsWith('sk-')) return value
  }
  return null
}

function callId(options, startedAt) {
  const explicit = options?.callId || options?.requestId || options?.traceId
  if (explicit) return String(explicit)
  const seed = [startedAt, options?.sessionId, text(options?.provider), text(options?.model), Math.random()].join('|')
  return createHash('sha256').update(seed).digest('hex').slice(0, 32)
}

function trackedStream(ctx, store, lifecycle, options, source) {
  return (async function* () {
    let usage = null
    let terminal = null
    const startedAt = Date.now()
    const id = callId(options, startedAt)
    try {
      for await (const chunk of source) {
        if (chunk?.type === 'usage') usage = usageBuckets(chunk.usage)
        if (chunk?.type === 'finish') terminal = chunk.reason?.kind || chunk.reason || 'finished'
        if (!usage && chunk?.usage) usage = usageBuckets(chunk.usage)
        yield chunk
      }
      terminal ||= 'finished'
    } catch (error) {
      terminal = String(error?.code || error?.name || 'error').slice(0, 80)
      throw error
    } finally {
      if (usage && !lifecycle.disposed) {
      const at = Date.now()
      const providerRoute = text(options?.provider, 'unknown').toLowerCase()
      const provider = normalizeProviderId(providerRoute)
      const model = text(options?.model)
      const resolved = resolvePrice(store.data.priceBook, provider, model, at)
      const fx = store.data.config.fx?.status === 'ok' ? store.data.config.fx.usdToCny : null
      const cost = calculateCost(usage, resolved, fx)
      const context = sessionContext(ctx, options?.sessionId)
        store.account({
        id, at, startedAt, durationMs: Math.max(0, at - startedAt), sessionId: options?.sessionId || null,
        rootSessionId: context.rootSessionId, parentSessionId: context.parentSessionId,
        workspaceId: options?.workspaceId || context.workspaceId, workspace: context.workspace,
        provider, providerRoute, model, credentialRef: credentialReference(options),
        purpose: classifyPurpose(options, context), terminal, tokens: usage, cacheSupported: usage.cacheSupported,
        priced: cost.priced, priceKey: resolved.key, priceTier: cost.tier, priceMatchedBy: resolved.matchedBy,
        priceSource: resolved.entry?.source || null, priceSourceUrl: resolved.entry?.sourceUrl || null,
        priceCheckedAt: resolved.entry?.checkedAt || null,
        rates: resolved.entry ? structuredClone(resolved.tier === 'peak' ? resolved.entry.peak : resolved.tier === 'off-peak' ? resolved.entry.offPeak : cost.tier === 'long-context' ? resolved.entry.longContext : resolved.entry) : null,
        currency: cost.currency, costNative: cost.native, costUsd: cost.usd, costCny: cost.cny,
        usdToCny: fx, fxSnapshotId: store.data.config.fx?.snapshotId || null, origin: 'live',
        })
      }
    }
  })()
}

function makeService(ctx, store) {
  return {
    async getState() { return { ...store.getState(), configuredProviders: [...configuredPriceProviders(ctx, store)] } },
    async getFilterOptions() {
      const options = store.getFilterOptions()
      const configuredProviders = [...configuredPriceProviders(ctx, store)]
      return {
        ...options,
        providers: [...new Set([...configuredProviders, ...options.providers])].sort(),
        conversations: await conversationOptions(ctx, options.conversations),
        workspaces: workspaceOptions(ctx, options.workspaces),
      }
    },
    async getPriceCatalog() {
      const configured = configuredPriceProviders(ctx, store)
      const seen = store.getFilterOptions().providerModels || [], keys = new Set()
      for (const item of seen) keys.add(`${normalizeProviderId(item.provider)}:${String(item.model).toLowerCase()}`)
      const customKeys = new Set(Object.keys(store.data.config.pricing?.customOverrides || {}))
      for (const key of customKeys) keys.add(key)
      const aliases = store.data.priceBook.aliases || {}
      for (const key of [...keys]) if (aliases[key] && keys.has(aliases[key]) && !customKeys.has(key)) keys.delete(key)
      const fx = Number(store.data.config.fx?.usdToCny), toCny = entry => {
        const currency = entry?.currency, rates = entry?.offPeak || entry
        const factor = currency === 'CNY' ? 1 : Number.isFinite(fx) && fx > 0 ? fx : null
        if (!factor) return null
        return ['input', 'cacheRead', 'cacheWrite', 'output'].map(key => Number(rates?.[key] || 0) * factor)
      }
      const differs = sourceMap => {
        const rows = Object.values(sourceMap || {}).map(toCny).filter(Boolean)
        if (rows.length < 2) return false
        return rows.slice(1).some(row => row.some((value, index) => Math.abs(value - rows[0][index]) > Math.max(.000001, Math.abs(rows[0][index]) * .01)))
      }
      return [...keys].map(key => {
        const sourceKey = store.data.priceBook.models?.[key] ? key : aliases[key] || key
        const entry = store.data.priceBook.models?.[key] || store.data.priceBook.models?.[sourceKey] || {}, sourceMap = store.data.priceBook.candidates?.[key] || store.data.priceBook.candidates?.[sourceKey] || {}, [providerFromKey, ...modelParts] = key.split(':'), provider = normalizeProviderId(entry.provider || providerFromKey), model = modelParts.join(':')
        return {
          key, sourceKey, provider, model, currency: entry.currency || null, mode: entry.mode || 'flat',
          input: entry.input ?? null, cacheRead: entry.cacheRead ?? null, cacheWrite: entry.cacheWrite ?? null, output: entry.output ?? null,
          offPeak: entry.offPeak || null, peak: entry.peak || null, longContext: entry.longContext || null,
          source: entry.sourceKind || entry.source || null, sourceUrl: entry.sourceUrl || null, checkedAt: entry.checkedAt || null,
          candidates: structuredClone(sourceMap), conflict: differs(sourceMap), custom: (entry.sourceKind || entry.source) === 'custom',
        }
      }).filter(entry => configured.has(entry.provider)).sort((a, b) => String(a.provider).localeCompare(String(b.provider)) || String(a.model).localeCompare(String(b.model)))
    },
    async getSessionSummary(sessionId) {
      const analytics = store.query({ sessionId: sessionIdSchema.parse(sessionId), groupBy: 'model' })
      const last = analytics.recent[0] || null
      const currentPrice = last ? resolvePrice(store.data.priceBook, last.provider, last.model, Date.now()) : null
      const providerBalance = last ? store.data.balances[last.provider] || { id: last.provider, provider: last.provider, status: 'unavailable', checkedAt: null, accounts: [] } : null
      return {
        totals: analytics.totals,
        last,
        currentPrice: currentPrice?.entry ? {
          key: currentPrice.key,
          tier: currentPrice.tier,
          matchedBy: currentPrice.matchedBy,
          entry: structuredClone(currentPrice.entry),
        } : null,
        balance: providerBalance ? structuredClone(providerBalance) : null,
        fx: structuredClone(store.data.config.fx || null),
        deepseekPeakWindowsUtc: structuredClone(store.data.priceBook.deepseekPeakWindowsUtc || []),
      }
    },
    async queryAnalytics(filter = {}) {
      const safeFilter = parseFilter(filter)
      const analytics = await decorateAnalytics(ctx, store.query(safeFilter), safeFilter.groupBy)
      const modelTotals = store.query({ ...safeFilter, groupBy: 'model' })
      const modelGroups = modelTotals.groups.slice(0, 12)
      const seriesGroup = safeFilter.groupBy === 'hour' ? 'hour' : 'date'
      const modelSeries = modelGroups.map(group => ({ key: group.key, displayKey: group.displayKey || group.key, series: store.query({ ...safeFilter, model: group.key, groupBy: seriesGroup }).series }))
      const distributions = {}
      for (const dimension of ['workspace', 'model', 'provider']) {
        distributions[dimension] = store.query({ ...safeFilter, groupBy: dimension }).groups.slice(0, 16)
      }
      return { ...analytics, modelGroups, modelSeries, distributions }
    },
    async updateConfig(patch = {}) { return store.updateConfig(parseConfigPatch(patch)) },
    async setPricePreference(key, source) { const result = store.setPricePreference(priceKeySchema.parse(key), priceSourceSchema.parse(source ?? null)); await store.flush(); return result },
    async setCustomPrice(key, entry) { const result = store.setCustomPrice(priceKeySchema.parse(key), customPriceInputSchema.parse(entry ?? null)); await store.flush(); return result },
    async syncPrices() {
      const configuredModels = new Set((store.getFilterOptions().providerModels || []).map(item => `${normalizeProviderId(item.provider)}:${String(item.model).toLowerCase()}`))
      const result = await syncOfficialPrices(store.data.config, configuredPriceProviders(ctx, store), configuredModels)
      store.updatePrices(result.models, result.sources, result.checkedAt, result.candidates)
      await store.flush()
      return { ...result, modelCount: Object.keys(result.models).length }
    },
    async refreshFx() {
      const snapshot = await fetchFx()
      const stored = store.updateFx(snapshot)
      await store.flush()
      return stored
    },
    async refreshBalances() {
      const balances = await fetchBalances(ctx, store.data.config)
      store.updateBalances(balances)
      await store.flush()
      return balances
    },
    async backup() { return store.backup() },
    async clearHistory() {
      const backup = await store.backup()
      const result = store.clearHistory()
      await store.flush()
      return { ...result, backup }
    },
    async exportData(filter = {}) { return store.exportData(parseFilter(filter)) },
    async exportDiagnostics() { return store.exportDiagnostics() },
  }
}

function stale(iso, intervalMs) {
  const at = Date.parse(iso || '')
  return !Number.isFinite(at) || Date.now() - at >= intervalMs
}

function pricesStale(store, intervalMs, providers = null) {
  if (stale(store.data.priceBook.syncedAt, intervalMs)) return true
  return Object.entries(store.data.config.priceSync || {}).some(([id, enabled]) => enabled !== false && (!providers || providers.has(id)) && !['ok', 'bundled'].includes(store.data.priceBook.sources?.[id]?.status))
}

export async function apply(ctx) {
  const store = await openLedger()
  const lifecycle = { disposed: false }
  const service = makeService(ctx, store)
  service.typertRemote = bindTypertRemote(service, 'usageInsights')
  ctx.provide('usageInsights', service)
  ctx.on('llm/stream', (options, next) => trackedStream(ctx, store, lifecycle, options, next()), { global: true })

  const priceTimer = setInterval(() => {
    if (lifecycle.disposed) return
    const interval = Math.max(1, Number(store.data.config.priceSyncHours) || 6) * 3_600_000
    if (pricesStale(store, interval, configuredPriceProviders(ctx, store))) void service.syncPrices().catch(() => {})
  }, 30 * 60_000)
  const balanceTimer = setInterval(() => { if (!lifecycle.disposed) void service.refreshBalances().catch(() => {}) }, Math.max(1, Number(store.data.config.balanceRefreshMinutes) || 5) * 60_000)
  const fxTimer = setInterval(() => { if (!lifecycle.disposed) void service.refreshFx().catch(() => {}) }, Math.max(5, Number(store.data.config.fxRefreshMinutes) || 60) * 60_000)
  priceTimer.unref?.(); balanceTimer.unref?.(); fxTimer.unref?.()

  ctx.on('credentials/updated', () => void service.refreshBalances().catch(() => {}))
  const startupTimer = setTimeout(() => {
    if (lifecycle.disposed) return
    const priceInterval = Math.max(1, Number(store.data.config.priceSyncHours) || 6) * 3_600_000
    if (pricesStale(store, priceInterval, configuredPriceProviders(ctx, store))) void service.syncPrices().catch(() => {})
    if (stale(store.data.config.fx?.fetchedAt, Math.max(5, Number(store.data.config.fxRefreshMinutes) || 60) * 60_000)) void service.refreshFx().catch(() => {})
    void service.refreshBalances().catch(() => {})
  }, 2_000)
  startupTimer.unref?.()

  ctx.effect(() => async () => {
    lifecycle.disposed = true
    clearInterval(priceTimer); clearInterval(balanceTimer); clearInterval(fxTimer)
    clearTimeout(startupTimer)
    try { await store.flush() } finally { store.close() }
  })
}

export { calculateCost, resolvePrice } from './pricing.js'
export { LedgerStore, openLedger } from './store.js'
