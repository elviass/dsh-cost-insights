import { OFFICIAL_SOURCES, normalizeProviderId, providerKey, parseAnthropicPricingHtml, parseDeepSeekPricingHtml, parseGooglePricingHtml, parseOpenAiPricingHtml, parseOpenRouterModels } from './pricing.js'

const jsonHeaders = { Accept: 'application/json' }
const htmlHeaders = { Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9', 'User-Agent': 'dsh-usage-insights/1.0' }
const ECB_FX_URL = 'https://data-api.ecb.europa.eu/service/data/EXR/D.USD+CNY.EUR.SP00.A?format=csvdata&lastNObservations=1'

async function fetchResponse(url, options = {}, timeoutMs = 12_000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
    return response
  } finally {
    clearTimeout(timer)
  }
}

function safeMessage(error) {
  return String(error?.message || error || 'Unknown error')
    .replace(/\b(?:sk-[A-Za-z0-9_-]+|AIza[0-9A-Za-z_-]{20,}|[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,})\b/g, '[redacted]')
    .slice(0, 300)
}

export async function resolveCredential(ctx, ref) {
  if (!ref) return null
  const name = String(ref)
  const credentials = ctx.get?.('credentials')
  if (credentials?.resolve) {
    try {
      const value = await credentials.resolve(name)
      if (typeof value === 'string' && value) return value
      if (typeof value?.value === 'string' && value.value) return value.value
    } catch {}
  }
  return typeof process.env[name] === 'string' && process.env[name] ? process.env[name] : null
}

export async function fetchDeepSeekBalance(ctx, config) {
  const checkedAt = new Date().toISOString()
  const token = await resolveCredential(ctx, config?.credentialRef || 'DEEPSEEK_API_KEY')
  if (!token) return { id: 'deepseek', provider: 'deepseek', status: 'not-configured', checkedAt, accounts: [] }
  try {
    const response = await fetchResponse('https://api.deepseek.com/user/balance', { headers: { ...jsonHeaders, Authorization: `Bearer ${token}` } })
    const payload = await response.json()
    const accounts = (Array.isArray(payload?.balance_infos) ? payload.balance_infos : []).map(item => ({
      currency: String(item.currency || '').toUpperCase(),
      total: Number(item.total_balance) || 0,
      granted: Number(item.granted_balance) || 0,
      toppedUp: Number(item.topped_up_balance) || 0,
      remaining: Number(item.total_balance) || 0,
    })).filter(item => item.currency)
    return { id: 'deepseek', provider: 'deepseek', status: payload?.is_available === false ? 'unavailable' : 'ok', checkedAt, accounts, sourceUrl: 'https://api-docs.deepseek.com/api/get-user-balance/' }
  } catch (error) {
    return { id: 'deepseek', provider: 'deepseek', status: 'error', checkedAt, accounts: [], error: safeMessage(error) }
  }
}

export async function fetchOpenRouterBalance(ctx, config) {
  const checkedAt = new Date().toISOString()
  const token = await resolveCredential(ctx, config?.credentialRef || 'OPENROUTER_API_KEY')
  if (!token) return { id: 'openrouter', provider: 'openrouter', status: 'not-configured', checkedAt, accounts: [] }
  try {
    const response = await fetchResponse('https://openrouter.ai/api/v1/credits', { headers: { ...jsonHeaders, Authorization: `Bearer ${token}` } })
    const payload = await response.json()
    const total = Number(payload?.data?.total_credits) || 0
    const used = Number(payload?.data?.total_usage) || 0
    return { id: 'openrouter', provider: 'openrouter', status: 'ok', checkedAt, accounts: [{ currency: 'USD', total, used, remaining: Math.max(0, total - used) }], sourceUrl: 'https://openrouter.ai/docs/api/api-reference/credits/get-credits' }
  } catch (error) {
    return { id: 'openrouter', provider: 'openrouter', status: 'error', checkedAt, accounts: [], error: safeMessage(error) }
  }
}

export async function fetchMoonshotBalance(ctx, config) {
  const checkedAt = new Date().toISOString()
  const token = await resolveCredential(ctx, config?.credentialRef || 'MOONSHOT_API_KEY')
  if (!token) return { id: 'moonshot', provider: 'moonshot', status: 'not-configured', checkedAt, accounts: [] }
  try {
    const response = await fetchResponse('https://api.moonshot.cn/v1/users/me/balance', { headers: { ...jsonHeaders, Authorization: `Bearer ${token}` } })
    const payload = await response.json()
    const remaining = parseMoonshotBalance(payload)
    return { id: 'moonshot', provider: 'moonshot', status: 'ok', checkedAt, accounts: [{ currency: 'CNY', remaining }], sourceUrl: 'https://api.moonshot.cn/v1/users/me/balance' }
  } catch (error) {
    return { id: 'moonshot', provider: 'moonshot', status: 'error', checkedAt, accounts: [], error: safeMessage(error) }
  }
}

export function parseMoonshotBalance(payload) {
  const raw = payload?.available_balance ?? payload?.balance ?? payload?.cash_balance ?? payload?.data?.available_balance
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) throw new Error('Moonshot balance response: available_balance not found')
  return value >= 100 ? value / 100 : value
}

export async function fetchSiliconFlowBalance(ctx, config) {
  const checkedAt = new Date().toISOString()
  const token = await resolveCredential(ctx, config?.credentialRef || 'SILICONFLOW_API_KEY')
  if (!token) return { id: 'siliconflow', provider: 'siliconflow', status: 'not-configured', checkedAt, accounts: [] }
  try {
    const response = await fetchResponse('https://api.siliconflow.cn/v1/user/info', { headers: { ...jsonHeaders, Authorization: `Bearer ${token}` } })
    const payload = await response.json()
    const remaining = parseSiliconFlowBalance(payload)
    return { id: 'siliconflow', provider: 'siliconflow', status: 'ok', checkedAt, accounts: [{ currency: 'CNY', remaining }], sourceUrl: 'https://api.siliconflow.cn/v1/user/info' }
  } catch (error) {
    return { id: 'siliconflow', provider: 'siliconflow', status: 'error', checkedAt, accounts: [], error: safeMessage(error) }
  }
}


export function parseSiliconFlowBalance(payload) {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload
  const remaining = Number(data?.balance ?? data?.amount ?? data?.remain ?? data?.remaining)
  if (!Number.isFinite(remaining) || remaining < 0) throw new Error('SiliconFlow balance response: balance not found')
  return remaining
}

export async function refreshBalances(ctx, config) {
  const tasks = []
  if (config?.balanceAdapters?.deepseek?.enabled) tasks.push(fetchDeepSeekBalance(ctx, config.balanceAdapters.deepseek))
  if (config?.balanceAdapters?.openrouter?.enabled) tasks.push(fetchOpenRouterBalance(ctx, config.balanceAdapters.openrouter))
  if (config?.balanceAdapters?.moonshot?.enabled) tasks.push(fetchMoonshotBalance(ctx, config.balanceAdapters.moonshot))
  if (config?.balanceAdapters?.siliconflow?.enabled) tasks.push(fetchSiliconFlowBalance(ctx, config.balanceAdapters.siliconflow))
  const results = await Promise.all(tasks)
  const automatic = Object.fromEntries(results.map(result => [result.id, result]))
  const manual = Object.fromEntries((config?.manualBalances ?? []).filter(item => item?.id).map(item => [String(item.id), {
    id: String(item.id), provider: String(item.provider || item.id), label: item.label, status: 'manual', checkedAt: item.updatedAt || null,
    accounts: [{ currency: String(item.currency || 'CNY').toUpperCase(), total: Number(item.total) || 0, remaining: Number(item.remaining) || 0 }],
    source: 'manual',
  }]))
  return { ...manual, ...automatic }
}

function parseCsvLine(line) {
  const fields = []
  let value = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1 } else quoted = !quoted
    } else if (char === ',' && !quoted) { fields.push(value); value = '' } else value += char
  }
  fields.push(value)
  return fields
}

export function parseEcbFxCsv(csv, fetchedAt = new Date().toISOString()) {
  const lines = String(csv).replace(/\r/g, '').split('\n').filter(Boolean)
  if (lines.length < 3) throw new Error('ECB FX response: expected USD and CNY observations')
  const headers = parseCsvLine(lines[0])
  const index = Object.fromEntries(headers.map((name, position) => [name, position]))
  const observations = lines.slice(1).map(parseCsvLine).map(row => ({
    currency: row[index.CURRENCY], observedAt: row[index.TIME_PERIOD], value: Number(row[index.OBS_VALUE]),
  }))
  const usd = observations.find(item => item.currency === 'USD')
  const cny = observations.find(item => item.currency === 'CNY')
  if (!usd || !cny || !(usd.value > 0) || !(cny.value > 0)) throw new Error('ECB FX response: invalid USD/CNY observations')
  return {
    baseCurrency: 'USD', quoteCurrency: 'CNY', rate: cny.value / usd.value, source: 'ecb-reference',
    sourceUrl: ECB_FX_URL, observedAt: [usd.observedAt, cny.observedAt].sort().at(-1), fetchedAt, status: 'ok',
  }
}

export async function refreshFx() {
  const fetchedAt = new Date().toISOString()
  const response = await fetchResponse(ECB_FX_URL, { headers: { Accept: 'text/csv' } })
  return parseEcbFxCsv(await response.text(), fetchedAt)
}

export async function syncOfficialPrices(config, providers = null, configuredModels = null) {
  const checkedAt = new Date().toISOString()
  const models = {}
  const candidates = {}
  const sources = {}
  const allowed = providers ? new Set([...providers].map(value => String(value).toLowerCase())) : null
  const targetKeys = configuredModels == null ? null : new Set([...configuredModels].map(value => String(value).toLowerCase()))
  const aliases = { 'deepseek:deepseek-chat': 'deepseek:deepseek-v4-flash', 'deepseek:deepseek-reasoner': 'deepseek:deepseek-v4-flash' }
  const isTarget = (provider, model) => {
    if (!targetKeys) return true
    const key = providerKey(provider, model)
    return targetKeys.has(key) || targetKeys.has(aliases[key]) || (provider === 'deepseek' && [...targetKeys].some(value => aliases[value] === key))
  }
  const hasTargetProvider = provider => !targetKeys || [...targetKeys].some(key => key.startsWith(`${normalizeProviderId(provider)}:`))
  if (targetKeys && !targetKeys.size) return { checkedAt, models, candidates, sources }
  const enabled = id => config?.priceSync?.[id] !== false && (!allowed || allowed.has(id))
  const add = (kind, entries) => {
    for (const [key, raw] of Object.entries(entries || {})) {
      if (!isTarget(raw.provider, raw.model)) continue
      const entry = { ...raw, source: kind, sourceKind: kind, checkedAt: raw.checkedAt || checkedAt }
      if (!candidates[key]) candidates[key] = {}
      candidates[key][kind] = entry
      if (!models[key]) models[key] = entry
    }
  }
  if (enabled('deepseek') && hasTargetProvider('deepseek')) {
    try {
      const response = await fetchResponse(OFFICIAL_SOURCES.deepseek.url, { headers: htmlHeaders })
      const parsed = parseDeepSeekPricingHtml(await response.text(), checkedAt)
      add('official', parsed)
      sources.deepseek = { status: 'ok', checkedAt, url: OFFICIAL_SOURCES.deepseek.url, modelCount: Object.keys(parsed).length }
    } catch (error) {
      sources.deepseek = { status: 'error', checkedAt, url: OFFICIAL_SOURCES.deepseek.url, error: safeMessage(error) }
    }
  }
  const configuredUrl = String(config?.pricing?.thirdPartyUrl || OFFICIAL_SOURCES.openrouter.url).trim()
  const thirdPartyUrl = configuredUrl === OFFICIAL_SOURCES.openrouter.url ? configuredUrl : OFFICIAL_SOURCES.openrouter.url
  if (thirdPartyUrl && (!targetKeys || [...targetKeys].length > 0)) {
    try {
      const response = await fetchResponse(thirdPartyUrl, { headers: jsonHeaders })
      const parsed = parseOpenRouterModels(await response.json(), checkedAt)
      const apiEntries = {}, thirdPartyEntries = {}
      for (const entry of Object.values(parsed)) {
        if (enabled('openrouter')) apiEntries[providerKey('openrouter', entry.model)] = { ...entry, sourceUrl: thirdPartyUrl }
        const [author, ...rest] = String(entry.model).split('/')
        const provider = normalizeProviderId(author), model = rest.join('/')
        if (model && (!allowed || allowed.has(provider))) thirdPartyEntries[providerKey(provider, model)] = { ...entry, provider, model, sourceUrl: thirdPartyUrl }
      }
      add('api', apiEntries)
      add('thirdParty', thirdPartyEntries)
      sources.openrouter = { status: 'ok', checkedAt, url: thirdPartyUrl, modelCount: Object.keys(parsed).length }
    } catch (error) {
      sources.openrouter = { status: 'error', checkedAt, url: thirdPartyUrl, error: safeMessage(error) }
    }
  }
  if (enabled('openai') && hasTargetProvider('openai')) {
    try {
      const response = await fetchResponse(OFFICIAL_SOURCES.openai.url, { headers: htmlHeaders })
      const parsed = parseOpenAiPricingHtml(await response.text(), checkedAt)
      add('official', parsed)
      sources.openai = { status: 'ok', checkedAt, url: OFFICIAL_SOURCES.openai.url, modelCount: Object.keys(parsed).length }
    } catch (error) {
      sources.openai = { status: 'error', checkedAt, url: OFFICIAL_SOURCES.openai.url, error: safeMessage(error) }
    }
  }
  if (enabled('google') && hasTargetProvider('google')) {
    try {
      const response = await fetchResponse(OFFICIAL_SOURCES.google.url, { headers: htmlHeaders })
      const parsed = parseGooglePricingHtml(await response.text(), checkedAt)
      add('official', parsed)
      sources.google = { status: 'ok', checkedAt, url: OFFICIAL_SOURCES.google.url, modelCount: Object.keys(parsed).length }
    } catch (error) {
      sources.google = { status: 'error', checkedAt, url: OFFICIAL_SOURCES.google.url, error: safeMessage(error) }
    }
  }
  if (enabled('anthropic') && hasTargetProvider('anthropic')) {
    try {
      const response = await fetchResponse(OFFICIAL_SOURCES.anthropic.url, { headers: htmlHeaders })
      const parsed = parseAnthropicPricingHtml(await response.text(), checkedAt)
      add('official', parsed)
      sources.anthropic = { status: 'ok', checkedAt, url: OFFICIAL_SOURCES.anthropic.url, modelCount: Object.keys(parsed).length }
    } catch (error) {
      sources.anthropic = { status: 'error', checkedAt, url: OFFICIAL_SOURCES.anthropic.url, error: safeMessage(error) }
    }
  }
  return { checkedAt, models, candidates, sources }
}

export { ECB_FX_URL }
