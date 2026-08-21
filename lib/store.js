import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { DEFAULT_PRICE_BOOK } from './pricing.js'

const clone = value => structuredClone(value)
const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0
const nonnegative = value => Math.max(0, finite(value))
const json = value => JSON.stringify(value ?? null)
const parseJson = (value, fallback) => {
  try { return value == null ? clone(fallback) : JSON.parse(value) } catch { return clone(fallback) }
}

export const DEFAULT_CONFIG = Object.freeze({
  version: 2,
  timezone: 'local',
  fx: { usdToCny: null, source: 'ecb-reference', observedAt: null, fetchedAt: null, status: 'not-synced' },
  retentionDays: 730,
  priceSyncHours: 6,
  balanceRefreshMinutes: 5,
  fxRefreshMinutes: 60,
  display: { composer: true, sidebar: true, showUsdInDetails: true },
  budgets: { dailyCny: null, monthlyCny: null, warningPercent: 80, limitPercent: 100, systemNotifications: true },
  priceSync: { deepseek: true, openrouter: true, openai: true, google: true, anthropic: true },
  pricing: {
    thirdPartyUrl: 'https://openrouter.ai/api/v1/models',
    preferredSources: {},
    customOverrides: {},
  },
  balanceAdapters: {
    deepseek: { enabled: true, credentialRef: 'DEEPSEEK_API_KEY' },
    openrouter: { enabled: false, credentialRef: 'OPENROUTER_API_KEY' },
    moonshot: { enabled: false, credentialRef: 'MOONSHOT_API_KEY' },
    siliconflow: { enabled: false, credentialRef: 'SILICONFLOW_API_KEY' },
  },
  manualBalances: [],
})

function merge(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return clone(base)
  const result = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    result[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? merge(base?.[key] && typeof base[key] === 'object' ? base[key] : {}, value)
      : value
  }
  return result
}

function safeTime(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

export function ledgerPath() {
  return join(dshHome(), 'storages', 'usage-insights', 'ledger.sqlite')
}

export function legacyLedgerPath() {
  return join(dshHome(), 'storages', 'cost-insights', 'ledger.json')
}

export function startOfLocalDay(at = Date.now()) {
  const date = new Date(at)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

export function startOfLocalMonth(at = Date.now()) {
  const date = new Date(at)
  date.setDate(1)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function newTotals() {
  return {
    calls: 0, pricedCalls: 0, unpricedCalls: 0, failedCalls: 0, fxMissingCalls: 0,
    inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0,
    cacheEligibleInputTokens: 0, cacheExcludedCalls: 0,
    costUsd: 0, costCny: 0,
    inputCostUsd: 0, cacheWriteCostUsd: 0, outputCostUsd: 0,
    inputCostCny: 0, cacheWriteCostCny: 0, outputCostCny: 0,
    nativeCurrencies: {}, cacheHitRate: null,
  }
}

function addRecord(total, record) {
  total.calls += 1
  total[record.priced ? 'pricedCalls' : 'unpricedCalls'] += 1
  if (record.terminal && !['finished', 'stop', 'end_turn', 'completed'].includes(record.terminal)) total.failedCalls += 1
  for (const key of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']) {
    total[key] += nonnegative(record.tokens?.[key])
  }
  total.costUsd += nonnegative(record.costUsd)
  total.costCny += nonnegative(record.costCny)
  const inputTokens = nonnegative(record.tokens?.inputTokens)
  const cacheReadTokens = nonnegative(record.tokens?.cacheReadTokens)
  const cacheWriteTokens = nonnegative(record.tokens?.cacheWriteTokens)
  const outputTokens = nonnegative(record.tokens?.outputTokens)
  const reasoningTokens = nonnegative(record.tokens?.reasoningTokens)
  const rates = record.rates || {}
  const raw = {
    input: inputTokens * nonnegative(rates.input) + cacheReadTokens * nonnegative(rates.cacheRead ?? rates.cachedInput ?? rates.input),
    write: cacheWriteTokens * nonnegative(rates.cacheWrite ?? rates.input),
    output: Math.max(0, outputTokens - reasoningTokens) * nonnegative(rates.output) + reasoningTokens * nonnegative(rates.reasoning ?? rates.output),
  }
  let rawTotal = raw.input + raw.write + raw.output
  if (!(rawTotal > 0)) {
    raw.input = inputTokens + cacheReadTokens
    raw.write = cacheWriteTokens
    raw.output = outputTokens
    rawTotal = raw.input + raw.write + raw.output
  }
  const share = rawTotal > 0 ? { input: raw.input / rawTotal, write: raw.write / rawTotal, output: raw.output / rawTotal } : { input: 0, write: 0, output: 0 }
  total.inputCostUsd += nonnegative(record.costUsd) * share.input
  total.cacheWriteCostUsd += nonnegative(record.costUsd) * share.write
  total.outputCostUsd += nonnegative(record.costUsd) * share.output
  total.inputCostCny += nonnegative(record.costCny) * share.input
  total.cacheWriteCostCny += nonnegative(record.costCny) * share.write
  total.outputCostCny += nonnegative(record.costCny) * share.output
  if (String(record.currency || '').toUpperCase() === 'USD' && nonnegative(record.costNative) > 0 && !Number.isFinite(Number(record.usdToCny))) total.fxMissingCalls += 1
  if (record.currency) total.nativeCurrencies[record.currency] = nonnegative(total.nativeCurrencies[record.currency]) + nonnegative(record.costNative)
  if (record.cacheSupported) total.cacheEligibleInputTokens += nonnegative(record.tokens?.inputTokens) + nonnegative(record.tokens?.cacheReadTokens)
  else total.cacheExcludedCalls += 1
  total.cacheHitRate = total.cacheEligibleInputTokens > 0 ? total.cacheReadTokens / total.cacheEligibleInputTokens : null
  return total
}

function addTotals(target, source) {
  for (const key of ['calls', 'pricedCalls', 'unpricedCalls', 'failedCalls', 'fxMissingCalls', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'cacheEligibleInputTokens', 'cacheExcludedCalls', 'costUsd', 'costCny', 'inputCostUsd', 'cacheWriteCostUsd', 'outputCostUsd', 'inputCostCny', 'cacheWriteCostCny', 'outputCostCny']) {
    target[key] += nonnegative(source?.[key])
  }
  for (const [currency, amount] of Object.entries(source?.nativeCurrencies || {})) target.nativeCurrencies[currency] = nonnegative(target.nativeCurrencies[currency]) + nonnegative(amount)
  target.cacheHitRate = target.cacheEligibleInputTokens > 0 ? target.cacheReadTokens / target.cacheEligibleInputTokens : null
  return target
}

const dateFormatters = new Map()
function dateKey(at, timeZone, hour = false) {
  const date = new Date(at),pad = value => String(value).padStart(2, '0')
  if (!timeZone || timeZone === 'local') return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}${hour ? ` ${pad(date.getHours())}:00` : ''}`
  const cacheKey = `${timeZone}:${hour ? 'hour' : 'date'}`
  if (!dateFormatters.has(cacheKey)) {
    const options = { year: 'numeric', month: '2-digit', day: '2-digit', hour12: false, timeZone }
    if (hour) { options.hour = '2-digit'; options.hourCycle = 'h23' }
    dateFormatters.set(cacheKey, new Intl.DateTimeFormat('en-CA', options))
  }
  const parts = Object.fromEntries(dateFormatters.get(cacheKey).formatToParts(date).map(part => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}${hour ? ` ${parts.hour}:00` : ''}`
}

function groupValue(record, groupBy, timeZone) {
  if (groupBy === 'conversation') return record.rootSessionId || record.sessionId || 'no-session'
  if (groupBy === 'workspace') return record.workspaceId || record.workspace || 'no-workspace'
  if (groupBy === 'model') return record.model || 'unknown'
  if (groupBy === 'provider') return record.provider || 'unknown'
  if (groupBy === 'credential') return record.credentialRef || 'unknown'
  if (groupBy === 'purpose') return record.purpose || 'unknown'
  if (groupBy === 'hour') return dateKey(record.at, timeZone, true)
  return dateKey(record.at, timeZone, false)
}

function hashSnapshot(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

const SCHEMA = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS calls(
  id TEXT PRIMARY KEY, at INTEGER NOT NULL, started_at INTEGER NOT NULL, duration_ms INTEGER NOT NULL,
  session_id TEXT, root_session_id TEXT, parent_session_id TEXT, workspace_id TEXT, workspace TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL, provider_route TEXT NOT NULL, model TEXT NOT NULL, credential_ref TEXT, purpose TEXT NOT NULL,
  terminal TEXT, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, cache_read_tokens INTEGER NOT NULL,
  cache_write_tokens INTEGER NOT NULL, reasoning_tokens INTEGER NOT NULL, cache_supported INTEGER NOT NULL DEFAULT 0,
  priced INTEGER NOT NULL, price_key TEXT, price_tier TEXT, price_matched_by TEXT, price_source TEXT,
  price_source_url TEXT, price_checked_at TEXT, rates_json TEXT, currency TEXT, cost_native REAL NOT NULL,
  cost_usd REAL NOT NULL, cost_cny REAL NOT NULL, usd_to_cny REAL, fx_snapshot_id TEXT, origin TEXT NOT NULL DEFAULT 'live'
);
CREATE INDEX IF NOT EXISTS calls_at_idx ON calls(at);
CREATE INDEX IF NOT EXISTS calls_session_idx ON calls(session_id, at);
CREATE INDEX IF NOT EXISTS calls_root_session_idx ON calls(root_session_id, at);
CREATE INDEX IF NOT EXISTS calls_workspace_idx ON calls(workspace_id, at);
CREATE INDEX IF NOT EXISTS calls_provider_model_idx ON calls(provider, model, at);
CREATE INDEX IF NOT EXISTS calls_purpose_idx ON calls(purpose, at);
CREATE TABLE IF NOT EXISTS price_snapshots(
  id TEXT PRIMARY KEY, provider TEXT NOT NULL, model TEXT NOT NULL, tier TEXT NOT NULL, currency TEXT NOT NULL,
  rates_json TEXT NOT NULL, source TEXT NOT NULL, source_url TEXT, checked_at TEXT, effective_at TEXT, content_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS price_snapshots_lookup_idx ON price_snapshots(provider, model, checked_at);
CREATE TABLE IF NOT EXISTS fx_snapshots(
  id TEXT PRIMARY KEY, base_currency TEXT NOT NULL, quote_currency TEXT NOT NULL, rate REAL NOT NULL,
  source TEXT NOT NULL, observed_at TEXT, fetched_at TEXT NOT NULL, status TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS balance_snapshots(
  id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT NOT NULL, account_key TEXT NOT NULL, currency TEXT NOT NULL,
  total REAL, used REAL, remaining REAL, source TEXT NOT NULL, observed_at TEXT NOT NULL, data_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS balance_snapshots_lookup_idx ON balance_snapshots(provider, observed_at);
CREATE TABLE IF NOT EXISTS daily_rollups(day TEXT NOT NULL, timezone TEXT NOT NULL, dimension TEXT NOT NULL, dimension_key TEXT NOT NULL, data_json TEXT NOT NULL, PRIMARY KEY(day, timezone, dimension, dimension_key));
CREATE TABLE IF NOT EXISTS source_audits(id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, source_id TEXT NOT NULL, status TEXT NOT NULL, observed_at INTEGER NOT NULL, data_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS manual_overrides(id TEXT PRIMARY KEY, kind TEXT NOT NULL, data_json TEXT NOT NULL, updated_at INTEGER NOT NULL);
`

export class LedgerStore {
  constructor(path = ledgerPath()) {
    this.path = path
    this.db = null
    this.data = { config: clone(DEFAULT_CONFIG), priceBook: clone(DEFAULT_PRICE_BOOK), balances: {} }
  }

  async open() {
    mkdirSync(dirname(this.path), { recursive: true })
    this.db = new DatabaseSync(this.path)
    this.db.exec(SCHEMA)
    this.db.prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(?, ?)').run(1, Date.now())
    this.data.config = merge(DEFAULT_CONFIG, this.getMeta('config', DEFAULT_CONFIG))
    delete this.data.config.pricing?.formUrl
    const storedPriceBook = this.getMeta('priceBook', DEFAULT_PRICE_BOOK)
    this.data.priceBook = merge(DEFAULT_PRICE_BOOK, storedPriceBook)
    if (Number(storedPriceBook?.version || 0) < 3) {
      this.data.priceBook.version = 3
      for (const key of ['deepseek:deepseek-v4-flash', 'deepseek:deepseek-v4-pro']) {
        this.data.priceBook.models[key] = clone(DEFAULT_PRICE_BOOK.models[key])
        this.data.priceBook.candidates[key] = clone(DEFAULT_PRICE_BOOK.candidates[key])
      }
      this.data.priceBook.aliases['deepseek:deepseek-reasoner'] = 'deepseek:deepseek-v4-flash'
      this.setMeta('priceBook', this.data.priceBook)
    }
    this.data.balances = this.getMeta('balances', {})
    this.importLegacyOnce()
    this.prune()
    return this
  }

  getMeta(key, fallback) {
    const row = this.db.prepare('SELECT value_json FROM metadata WHERE key = ?').get(key)
    return parseJson(row?.value_json, fallback)
  }

  setMeta(key, value) {
    this.db.prepare(`INSERT INTO metadata(key, value_json, updated_at) VALUES(?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at`).run(key, json(value), Date.now())
  }

  importLegacyOnce() {
    if (this.getMeta('legacyImport', null)) return
    const path = legacyLedgerPath()
    if (!existsSync(path)) {
      this.setMeta('legacyImport', { status: 'not-found', checkedAt: new Date().toISOString() })
      return
    }
    try {
      const legacy = JSON.parse(readFileSync(path, 'utf8'))
      this.data.config = merge(this.data.config, legacy.config || {})
      delete this.data.config.customBalances
      this.data.priceBook = merge(this.data.priceBook, legacy.priceBook || {})
      this.data.balances = merge(this.data.balances, legacy.balances || {})
      this.setMeta('config', this.data.config)
      this.setMeta('priceBook', this.data.priceBook)
      this.setMeta('balances', this.data.balances)
      let calls = 0
      for (const record of Array.isArray(legacy.calls) ? legacy.calls : []) if (this.account({ ...record, origin: 'legacy-import' })) calls += 1
      this.setMeta('legacyImport', { status: 'imported', path, calls, importedAt: new Date().toISOString() })
    } catch (error) {
      this.setMeta('legacyImport', { status: 'error', path, error: String(error?.message || error), checkedAt: new Date().toISOString() })
    }
  }

  prune(now = Date.now()) {
    const retentionDays = Math.max(1, nonnegative(this.data.config.retentionDays) || 730)
    const cutoff = now - retentionDays * 86_400_000
    const expired = this.db.prepare('SELECT * FROM calls WHERE at < ? ORDER BY at ASC').all(cutoff).map(row => this.rowToRecord(row))
    if (!expired.length) return { rolledUp: 0, removed: 0 }
    const buckets = new Map()
    for (const record of expired) {
      const identity = {
        sessionId: record.sessionId, rootSessionId: record.rootSessionId, workspaceId: record.workspaceId,
        workspace: record.workspace, provider: record.provider, model: record.model,
        credentialRef: record.credentialRef, purpose: record.purpose,
      }
      const day = dateKey(record.at, 'local')
      const key = hashSnapshot(identity)
      const bucketKey = `${day}:${key}`
      if (!buckets.has(bucketKey)) buckets.set(bucketKey, { day, key, identity, totals: newTotals() })
      addRecord(buckets.get(bucketKey).totals, record)
    }
    const getRollup = this.db.prepare("SELECT data_json FROM daily_rollups WHERE day=? AND timezone='local' AND dimension='record' AND dimension_key=?")
    const upsert = this.db.prepare(`INSERT INTO daily_rollups(day, timezone, dimension, dimension_key, data_json) VALUES(?,'local','record',?,?)
      ON CONFLICT(day, timezone, dimension, dimension_key) DO UPDATE SET data_json=excluded.data_json`)
    this.db.exec('BEGIN')
    try {
      for (const bucket of buckets.values()) {
        const previous = parseJson(getRollup.get(bucket.day, bucket.key)?.data_json, null)
        if (previous?.totals) addTotals(bucket.totals, previous.totals)
        upsert.run(bucket.day, bucket.key, json({ ...bucket.identity, totals: bucket.totals }))
      }
      const removed = this.db.prepare('DELETE FROM calls WHERE at < ?').run(cutoff).changes
      this.db.exec('COMMIT')
      return { rolledUp: buckets.size, removed }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  account(record) {
    const tokens = record.tokens || {}
    const id = String(record.id || `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`)
    const result = this.db.prepare(`INSERT OR IGNORE INTO calls(
      id, at, started_at, duration_ms, session_id, root_session_id, parent_session_id, workspace_id, workspace,
      provider, provider_route, model, credential_ref, purpose, terminal, input_tokens, output_tokens,
      cache_read_tokens, cache_write_tokens, reasoning_tokens, cache_supported, priced, price_key, price_tier,
      price_matched_by, price_source, price_source_url, price_checked_at, rates_json, currency, cost_native,
      cost_usd, cost_cny, usd_to_cny, fx_snapshot_id, origin
    ) VALUES(${Array(36).fill('?').join(',')})`).run(
      id, safeTime(record.at, Date.now()), safeTime(record.startedAt, Date.now()), nonnegative(record.durationMs),
      record.sessionId ? String(record.sessionId) : null, record.rootSessionId ? String(record.rootSessionId) : null,
      record.parentSessionId ? String(record.parentSessionId) : null, record.workspaceId ? String(record.workspaceId) : null,
      String(record.workspace || ''), String(record.provider || 'unknown').toLowerCase(), String(record.providerRoute || record.provider || 'unknown').toLowerCase(),
      String(record.model || 'unknown'), record.credentialRef ? String(record.credentialRef) : null, String(record.purpose || 'unknown'),
      record.terminal ? String(record.terminal) : null, nonnegative(tokens.inputTokens), nonnegative(tokens.outputTokens),
      nonnegative(tokens.cacheReadTokens), nonnegative(tokens.cacheWriteTokens), nonnegative(tokens.reasoningTokens), record.cacheSupported ? 1 : 0,
      record.priced ? 1 : 0, record.priceKey || null, record.priceTier || null, record.priceMatchedBy || null,
      record.priceSource || null, record.priceSourceUrl || null, record.priceCheckedAt || null, record.rates ? json(record.rates) : null,
      record.currency || null, nonnegative(record.costNative), nonnegative(record.costUsd), nonnegative(record.costCny),
      Number.isFinite(Number(record.usdToCny)) ? Number(record.usdToCny) : null, record.fxSnapshotId || null, String(record.origin || 'live'),
    )
    return result.changes > 0 ? id : null
  }

  rowToRecord(row) {
    return {
      id: row.id, at: row.at, startedAt: row.started_at, durationMs: row.duration_ms,
      sessionId: row.session_id, rootSessionId: row.root_session_id, parentSessionId: row.parent_session_id,
      workspaceId: row.workspace_id, workspace: row.workspace, provider: row.provider, providerRoute: row.provider_route,
      model: row.model, credentialRef: row.credential_ref, purpose: row.purpose, terminal: row.terminal,
      tokens: { inputTokens: row.input_tokens, outputTokens: row.output_tokens, cacheReadTokens: row.cache_read_tokens, cacheWriteTokens: row.cache_write_tokens, reasoningTokens: row.reasoning_tokens },
      cacheSupported: row.cache_supported === 1, priced: row.priced === 1, priceKey: row.price_key, priceTier: row.price_tier,
      priceMatchedBy: row.price_matched_by, priceSource: row.price_source, priceSourceUrl: row.price_source_url,
      priceCheckedAt: row.price_checked_at, rates: parseJson(row.rates_json, null), currency: row.currency,
      costNative: row.cost_native, costUsd: row.cost_usd, costCny: row.cost_cny, usdToCny: row.usd_to_cny,
      fxSnapshotId: row.fx_snapshot_id, origin: row.origin,
    }
  }

  query(filter = {}) {
    const conditions = []
    const params = []
    const start = safeTime(filter.start, -Infinity)
    const end = safeTime(filter.end, Infinity)
    if (Number.isFinite(start)) { conditions.push('at >= ?'); params.push(start) }
    if (Number.isFinite(end)) { conditions.push('at <= ?'); params.push(end) }
    const addFilter = (column, value) => {
      if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) return
      const values = Array.isArray(value) ? value.map(String) : [String(value)]
      conditions.push(`${column} IN (${values.map(() => '?').join(',')})`)
      params.push(...values)
    }
    if (filter.sessionId) {
      conditions.push('(session_id = ? OR root_session_id = ?)')
      params.push(String(filter.sessionId), String(filter.sessionId))
    }
    addFilter('workspace_id', filter.workspaceId)
    addFilter('workspace', filter.workspace)
    addFilter('provider', filter.provider)
    addFilter('model', filter.model)
    addFilter('purpose', filter.purpose)
    addFilter('credential_ref', filter.credentialRef)
    if (filter.priced === true || filter.priced === false) { conditions.push('priced = ?'); params.push(filter.priced ? 1 : 0) }
    const sql = `SELECT * FROM calls${conditions.length ? ` WHERE ${conditions.join(' AND ')}` : ''} ORDER BY at ASC`
    const matches = this.db.prepare(sql).all(...params).map(row => this.rowToRecord(row))
    const totals = newTotals()
    const groups = new Map()
    const series = new Map()
    const timeZone = filter.timeZone || this.data.config.timezone || 'local'
    const seriesGroup = filter.groupBy === 'hour' ? 'hour' : 'date'
    for (const record of matches) {
      addRecord(totals, record)
      const group = groupValue(record, filter.groupBy || 'date', timeZone)
      if (!groups.has(group)) groups.set(group, newTotals())
      addRecord(groups.get(group), record)
      const point = groupValue(record, seriesGroup, timeZone)
      if (!series.has(point)) series.set(point, newTotals())
      addRecord(series.get(point), record)
    }
    const rollupRows = this.db.prepare("SELECT day, data_json FROM daily_rollups WHERE timezone='local' AND dimension='record' ORDER BY day ASC").all()
    const includes = (value, selected) => selected === undefined || selected === null || selected === '' || (Array.isArray(selected) && selected.length === 0) || (Array.isArray(selected) ? selected.map(String).includes(String(value)) : String(value) === String(selected))
    for (const row of rollupRows) {
      const item = { day: row.day, ...parseJson(row.data_json, {}) }
      const dayAt = Date.parse(`${item.day}T12:00:00`)
      if ((Number.isFinite(start) && dayAt < start) || (Number.isFinite(end) && dayAt > end)) continue
      if (filter.sessionId && ![item.sessionId, item.rootSessionId].filter(Boolean).map(String).includes(String(filter.sessionId))) continue
      if (!includes(item.workspaceId, filter.workspaceId) || !includes(item.workspace, filter.workspace) || !includes(item.provider, filter.provider) || !includes(item.model, filter.model) || !includes(item.purpose, filter.purpose) || !includes(item.credentialRef, filter.credentialRef)) continue
      if (filter.priced === true && !item.totals?.pricedCalls) continue
      if (filter.priced === false && !item.totals?.unpricedCalls) continue
      addTotals(totals, item.totals)
      const pseudo = { ...item, at: dayAt }
      const group = groupValue(pseudo, filter.groupBy || 'date', timeZone)
      if (!groups.has(group)) groups.set(group, newTotals())
      addTotals(groups.get(group), item.totals)
      const point = seriesGroup === 'hour' ? `${item.day} 00:00` : item.day
      if (!series.has(point)) series.set(point, newTotals())
      addTotals(series.get(point), item.totals)
    }
    const rows = [...groups].map(([key, value]) => ({ key, ...value }))
      .sort((a, b) => b.costCny - a.costCny || b.calls - a.calls || String(a.key).localeCompare(String(b.key)))
    return {
      filter: { ...filter, start: Number.isFinite(start) ? start : null, end: Number.isFinite(end) ? end : null, timeZone },
      totals, groups: rows,
      series: [...series].map(([date, value]) => ({ date, ...value })).sort((a, b) => a.date.localeCompare(b.date)),
      recent: matches.slice(-100).reverse(),
      dimensions: {
        workspaces: [...new Set(matches.map(item => item.workspace).filter(Boolean))].sort(),
        workspaceIds: [...new Set(matches.map(item => item.workspaceId).filter(Boolean))].sort(),
        conversations: [...new Set(matches.map(item => item.rootSessionId || item.sessionId).filter(Boolean))],
        providers: [...new Set(matches.map(item => item.provider).filter(Boolean))].sort(),
        models: [...new Set(matches.map(item => item.model).filter(Boolean))].sort(),
        credentials: [...new Set(matches.map(item => item.credentialRef).filter(Boolean))].sort(),
        purposes: [...new Set(matches.map(item => item.purpose).filter(Boolean))].sort(),
      },
    }
  }

  getState(now = Date.now()) {
    const today = this.query({ start: startOfLocalDay(now), end: now }).totals
    const month = this.query({ start: startOfLocalMonth(now), end: now }).totals
    const budget = (spent, limit) => {
      const normalized = Number(limit)
      const percent = Number.isFinite(normalized) && normalized > 0 ? spent / normalized * 100 : null
      return { spent, limit: Number.isFinite(normalized) && normalized > 0 ? normalized : null, percent, status: percent === null ? 'not-configured' : percent >= Number(this.data.config.budgets?.limitPercent || 100) ? 'limit' : percent >= Number(this.data.config.budgets?.warningPercent || 80) ? 'warning' : 'ok' }
    }
    return {
      today,
      month,
      all: this.query({}).totals,
      recent: this.query({}).recent.slice(0, 20),
      config: clone(this.data.config), priceBook: { syncedAt: this.data.priceBook.syncedAt || null, sources: clone(this.data.priceBook.sources || {}) }, balances: clone(this.data.balances),
      legacyImport: this.getMeta('legacyImport', null),
      budgetStatus: { daily: budget(today.costCny, this.data.config.budgets?.dailyCny), monthly: budget(month.costCny, this.data.config.budgets?.monthlyCny) },
      storage: { path: this.path, calls: this.db.prepare('SELECT COUNT(*) AS count FROM calls').get().count, rollups: this.db.prepare('SELECT COUNT(*) AS count FROM daily_rollups').get().count, engine: 'sqlite-wal' },
    }
  }

  getFilterOptions() {
    const values = (expression, where = `${expression} IS NOT NULL AND ${expression} <> ''`) => this.db
      .prepare(`SELECT DISTINCT ${expression} AS value FROM calls WHERE ${where} ORDER BY value COLLATE NOCASE`)
      .all().map(row => String(row.value))
    const workspaces = this.db.prepare(`SELECT DISTINCT workspace_id AS id, workspace AS path FROM calls
      WHERE (workspace_id IS NOT NULL AND workspace_id <> '') OR workspace <> '' ORDER BY path COLLATE NOCASE, id COLLATE NOCASE`).all()
      .map(row => ({ value: row.id ? `id:${row.id}` : `path:${row.path}`, label: row.path || row.id }))
    const archived = this.db.prepare("SELECT data_json FROM daily_rollups WHERE timezone='local' AND dimension='record'").all().map(row => parseJson(row.data_json, {}))
    const merged = (live, key) => [...new Set([...live, ...archived.map(item => item[key]).filter(Boolean).map(String)])].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    const archivedWorkspaces = archived.filter(item => item.workspaceId || item.workspace).map(item => ({ value: item.workspaceId ? `id:${item.workspaceId}` : `path:${item.workspace}`, label: item.workspace || item.workspaceId }))
    const mergedWorkspaces = [...new Map([...workspaces, ...archivedWorkspaces].map(item => [item.value, item])).values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
    const archivedConversations = archived.map(item => item.rootSessionId || item.sessionId).filter(Boolean).map(String)
    const liveRelationships = this.db.prepare(`SELECT DISTINCT
      COALESCE(root_session_id, session_id) AS conversation,
      CASE WHEN workspace_id IS NOT NULL AND workspace_id <> '' THEN 'id:' || workspace_id ELSE 'path:' || workspace END AS workspace_key,
      provider, model, credential_ref AS credential
      FROM calls`).all()
    const archivedRelationships = archived.map(item => ({
      conversation: item.rootSessionId || item.sessionId || null,
      workspace_key: item.workspaceId ? `id:${item.workspaceId}` : item.workspace ? `path:${item.workspace}` : null,
      provider: item.provider || null,
      model: item.model || null,
      credential: item.credentialRef || null,
    }))
    const relationships = [...liveRelationships, ...archivedRelationships]
    const uniquePairs = (left, right) => [...new Map(relationships.filter(item => item[left] && item[right]).map(item => [`${item[left]}\u0000${item[right]}`, { [left]: String(item[left]), [right]: String(item[right]) }])).values()]
    return {
      conversations: [...new Set([...values('COALESCE(root_session_id, session_id)', 'COALESCE(root_session_id, session_id) IS NOT NULL'), ...archivedConversations])].sort(),
      workspaces: mergedWorkspaces,
      providers: merged(values('provider'), 'provider'), models: merged(values('model'), 'model'), credentials: merged(values('credential_ref'), 'credentialRef'), purposes: merged(values('purpose'), 'purpose'),
      conversationWorkspaces: uniquePairs('conversation', 'workspace_key'),
      providerModels: uniquePairs('provider', 'model'),
      providerCredentials: uniquePairs('provider', 'credential'),
    }
  }

  updateConfig(patch) {
    this.data.config = merge(this.data.config, patch)
    delete this.data.config.pricing?.formUrl
    delete this.data.config.customBalances
    this.setMeta('config', this.data.config)
    if (patch?.pricing) this.rebuildResolvedPrices()
    this.prune()
    return clone(this.data.config)
  }

  rebuildResolvedPrices() {
    const candidates = this.data.priceBook.candidates || {}
    const preferred = this.data.config.pricing?.preferredSources || {}
    const custom = this.data.config.pricing?.customOverrides || {}
    const resolved = { ...this.data.priceBook.models }
    for (const key of new Set([...Object.keys(candidates), ...Object.keys(custom)])) {
      if (custom[key]) {
        resolved[key] = { ...custom[key], source: 'custom', sourceKind: 'custom', mode: 'flat' }
        continue
      }
      const available = candidates[key] || {}
      const kind = available[preferred[key]] ? preferred[key] : ['api', 'official', 'thirdParty'].find(source => available[source])
      if (kind) resolved[key] = { ...available[kind], source: kind, sourceKind: kind }
    }
    this.data.priceBook.models = resolved
    this.setMeta('priceBook', this.data.priceBook)
    return clone(resolved)
  }

  setPricePreference(key, source) {
    const preferredSources = { ...(this.data.config.pricing?.preferredSources || {}) }
    if (source) preferredSources[String(key)] = String(source)
    else delete preferredSources[String(key)]
    this.data.config = { ...this.data.config, pricing: { ...(this.data.config.pricing || {}), preferredSources } }
    this.setMeta('config', this.data.config)
    this.rebuildResolvedPrices()
    return clone(this.data.priceBook.models[String(key)] || null)
  }

  setCustomPrice(key, entry) {
    const customOverrides = { ...(this.data.config.pricing?.customOverrides || {}) }
    if (entry) customOverrides[String(key)] = { ...entry, source: 'custom', sourceKind: 'custom', mode: 'flat', checkedAt: new Date().toISOString() }
    else delete customOverrides[String(key)]
    this.data.config = { ...this.data.config, pricing: { ...(this.data.config.pricing || {}), customOverrides } }
    this.setMeta('config', this.data.config)
    this.rebuildResolvedPrices()
    return clone(this.data.priceBook.models[String(key)] || null)
  }

  updatePrices(models, sources, checkedAt = new Date().toISOString(), candidates = {}) {
    const mergedCandidates = { ...(this.data.priceBook.candidates || {}) }
    for (const [key, sourceMap] of Object.entries(candidates || {})) mergedCandidates[key] = { ...(mergedCandidates[key] || {}), ...sourceMap }
    this.data.priceBook = { ...this.data.priceBook, version: 3, syncedAt: checkedAt, candidates: mergedCandidates, models: { ...this.data.priceBook.models, ...models }, sources: { ...this.data.priceBook.sources, ...sources } }
    this.rebuildResolvedPrices()
    this.setMeta('priceBook', this.data.priceBook)
    const insert = this.db.prepare('INSERT OR IGNORE INTO price_snapshots(id, provider, model, tier, currency, rates_json, source, source_url, checked_at, effective_at, content_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    for (const entry of Object.values(this.data.priceBook.models)) {
      const tiers = entry.mode === 'deepseek-peak' ? [['off-peak', entry.offPeak], ['peak', entry.peak]] : [['flat', entry]]
      for (const [tier, rates] of tiers) {
        const snapshot = { provider: entry.provider, model: entry.model, tier, currency: entry.currency, rates, source: entry.source, sourceUrl: entry.sourceUrl, checkedAt: entry.checkedAt || checkedAt }
        const hash = hashSnapshot(snapshot)
        insert.run(hash, entry.provider, entry.model, tier, entry.currency || 'USD', json(rates), entry.source || 'unknown', entry.sourceUrl || null, entry.checkedAt || checkedAt, entry.effectiveAt || null, hash)
      }
    }
    for (const [sourceId, source] of Object.entries(sources)) this.audit('price', sourceId, source.status, source)
  }

  updateFx(snapshot) {
    const id = snapshot.id || hashSnapshot(snapshot)
    this.db.prepare('INSERT OR IGNORE INTO fx_snapshots(id, base_currency, quote_currency, rate, source, observed_at, fetched_at, status) VALUES(?,?,?,?,?,?,?,?)')
      .run(id, snapshot.baseCurrency || 'USD', snapshot.quoteCurrency || 'CNY', snapshot.rate, snapshot.source, snapshot.observedAt || null, snapshot.fetchedAt, snapshot.status || 'ok')
    this.data.config = merge(this.data.config, { fx: { usdToCny: snapshot.rate, source: snapshot.source, observedAt: snapshot.observedAt, fetchedAt: snapshot.fetchedAt, status: snapshot.status || 'ok', snapshotId: id } })
    this.setMeta('config', this.data.config)
    this.audit('fx', snapshot.source, snapshot.status || 'ok', { ...snapshot, id })
    return { ...snapshot, id }
  }

  updateBalances(balances) {
    this.data.balances = { ...this.data.balances, ...clone(balances) }
    this.setMeta('balances', this.data.balances)
    const insert = this.db.prepare('INSERT INTO balance_snapshots(provider, account_key, currency, total, used, remaining, source, observed_at, data_json) VALUES(?,?,?,?,?,?,?,?,?)')
    for (const value of Object.values(balances)) {
      for (const [index, account] of (value.accounts || []).entries()) insert.run(value.provider || value.id, String(account.id || index), account.currency || 'CNY', account.total ?? null, account.used ?? null, account.remaining ?? null, value.sourceUrl || value.source || 'manual', value.checkedAt || new Date().toISOString(), json(account))
      this.audit('balance', value.id || value.provider, value.status, value)
    }
  }

  audit(kind, sourceId, status, data) {
    this.db.prepare('INSERT INTO source_audits(kind, source_id, status, observed_at, data_json) VALUES(?,?,?,?,?)').run(kind, String(sourceId), String(status || 'unknown'), Date.now(), json(data))
  }

  clearHistory() {
    const removed = this.db.prepare('SELECT COUNT(*) AS count FROM calls').get().count
    this.db.exec('BEGIN; DELETE FROM calls; DELETE FROM daily_rollups; COMMIT;')
    return { removed }
  }

  exportData(filter = {}) {
    return { exportedAt: new Date().toISOString(), schemaVersion: 1, state: this.getState(), analytics: this.query(filter) }
  }

  exportDiagnostics() {
    const state = this.getState()
    const adapters = Object.fromEntries(Object.entries(state.config?.balanceAdapters || {}).map(([id, value]) => [id, { enabled: Boolean(value?.enabled), configured: Boolean(value?.credentialRef) }]))
    const balances = Object.values(state.balances || {}).map(value => ({ provider: value?.provider || value?.id || 'unknown', status: value?.status || 'unknown', checkedAt: value?.checkedAt || null, accountCount: Array.isArray(value?.accounts) ? value.accounts.length : 0 }))
    const audits = this.db.prepare('SELECT kind, source_id AS sourceId, status, observed_at AS observedAt FROM source_audits ORDER BY id DESC LIMIT 100').all().map(value => ({ ...value, observedAt: new Date(Number(value.observedAt)).toISOString() }))
    return {
      exportedAt: new Date().toISOString(), schemaVersion: 1,
      plugin: { name: 'dsh-usage-insights', version: '1.0.0' },
      runtime: { node: process.version, platform: process.platform, arch: process.arch },
      storage: state.storage,
      config: { timezone: state.config?.timezone, retentionDays: state.config?.retentionDays, priceSyncHours: state.config?.priceSyncHours, fx: clone(state.config?.fx || {}), balanceAdapters: adapters },
      priceBook: state.priceBook,
      balances,
      usage: { today: state.today, month: state.month, all: state.all },
      audits,
      privacy: { prompts: false, responses: false, apiKeys: false },
    }
  }

  async backup() {
    this.db?.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    const directory = join(dirname(this.path), 'backups')
    await mkdir(directory, { recursive: true })
    const target = join(directory, `ledger-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`)
    await copyFile(this.path, target)
    return { path: target }
  }

  async flush() {
    this.db?.exec('PRAGMA wal_checkpoint(PASSIVE)')
  }

  close() {
    if (!this.db) return
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    this.db.close()
    this.db = null
  }
}

export async function openLedger(path) {
  return new LedgerStore(path).open()
}
