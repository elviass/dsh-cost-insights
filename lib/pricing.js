const DEEPSEEK_PRICING_URL = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing'
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models'
const OPENAI_PRICING_URL = 'https://developers.openai.com/api/docs/pricing'
// Force the canonical English source because Google localizes this page by IP.
// The parser intentionally consumes the stable English table labels.
const GOOGLE_PRICING_URL = 'https://ai.google.dev/gemini-api/docs/pricing?hl=en'
const ANTHROPIC_PRICING_URL = 'https://platform.claude.com/docs/en/about-claude/pricing'

export const OFFICIAL_SOURCES = Object.freeze({
  deepseek: {
    id: 'deepseek-official',
    provider: 'deepseek',
    url: DEEPSEEK_PRICING_URL,
    currency: 'CNY',
    kind: 'html',
  },
  openrouter: {
    id: 'openrouter-official',
    provider: 'openrouter',
    url: OPENROUTER_MODELS_URL,
    currency: 'USD',
    kind: 'json',
  },
  openai: {
    id: 'openai-official', provider: 'openai', url: OPENAI_PRICING_URL, currency: 'USD', kind: 'html',
  },
  google: {
    id: 'google-official', provider: 'google', url: GOOGLE_PRICING_URL, currency: 'USD', kind: 'html',
  },
  anthropic: {
    id: 'anthropic-official', provider: 'anthropic', url: ANTHROPIC_PRICING_URL, currency: 'USD', kind: 'html',
  },
})

export const DEFAULT_PRICE_BOOK = Object.freeze({
  version: 3,
  syncedAt: null,
  sources: {
    deepseek: { status: 'bundled', checkedAt: '2026-08-21T00:00:00.000Z', url: DEEPSEEK_PRICING_URL },
    openrouter: { status: 'not-synced', checkedAt: null, url: OPENROUTER_MODELS_URL },
    openai: { status: 'not-synced', checkedAt: null, url: OPENAI_PRICING_URL },
    google: { status: 'not-synced', checkedAt: null, url: GOOGLE_PRICING_URL },
    anthropic: { status: 'not-synced', checkedAt: null, url: ANTHROPIC_PRICING_URL },
  },
  models: {
    'deepseek:deepseek-v4-flash': {
      provider: 'deepseek', model: 'deepseek-v4-flash', currency: 'CNY', unit: 'million_tokens', mode: 'deepseek-peak',
      offPeak: { input: 1.5, cacheRead: 0.05, cacheWrite: 1.5, output: 4.5, reasoning: 4.5 },
      peak: { input: 3, cacheRead: 0.1, cacheWrite: 3, output: 9, reasoning: 9 },
      sourceUrl: DEEPSEEK_PRICING_URL, checkedAt: '2026-08-21T00:00:00.000Z', source: 'official', sourceKind: 'official',
    },
    'deepseek:deepseek-v4-pro': {
      provider: 'deepseek', model: 'deepseek-v4-pro', currency: 'CNY', unit: 'million_tokens', mode: 'deepseek-peak',
      offPeak: { input: 4.5, cacheRead: 0.15, cacheWrite: 4.5, output: 13.5, reasoning: 13.5 },
      peak: { input: 9, cacheRead: 0.3, cacheWrite: 9, output: 27, reasoning: 27 },
      sourceUrl: DEEPSEEK_PRICING_URL, checkedAt: '2026-08-21T00:00:00.000Z', source: 'official', sourceKind: 'official',
    },
  },
  candidates: {
    'deepseek:deepseek-v4-flash': { official: { provider: 'deepseek', model: 'deepseek-v4-flash', currency: 'CNY', unit: 'million_tokens', mode: 'deepseek-peak', offPeak: { input: 1.5, cacheRead: 0.05, cacheWrite: 1.5, output: 4.5, reasoning: 4.5 }, peak: { input: 3, cacheRead: 0.1, cacheWrite: 3, output: 9, reasoning: 9 }, sourceUrl: DEEPSEEK_PRICING_URL, checkedAt: '2026-08-21T00:00:00.000Z', source: 'official', sourceKind: 'official' } },
    'deepseek:deepseek-v4-pro': { official: { provider: 'deepseek', model: 'deepseek-v4-pro', currency: 'CNY', unit: 'million_tokens', mode: 'deepseek-peak', offPeak: { input: 4.5, cacheRead: 0.15, cacheWrite: 4.5, output: 13.5, reasoning: 13.5 }, peak: { input: 9, cacheRead: 0.3, cacheWrite: 9, output: 27, reasoning: 27 }, sourceUrl: DEEPSEEK_PRICING_URL, checkedAt: '2026-08-21T00:00:00.000Z', source: 'official', sourceKind: 'official' } },
  },
  aliases: {
    'deepseek:deepseek-chat': 'deepseek:deepseek-v4-flash',
    'deepseek:deepseek-reasoner': 'deepseek:deepseek-v4-flash',
  },
  deepseekPeakWindowsUtc: [{ start: 1, end: 4 }, { start: 6, end: 10 }],
})

const finite = value => {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : 0
}

export function normalizeProviderId(value) {
  const provider = String(value || 'unknown').trim().toLowerCase()
  if (provider === 'deepseek-official') return 'deepseek'
  if (provider === 'google-gemini' || provider === 'gemini') return 'google'
  if (provider === 'claude') return 'anthropic'
  return provider
}

export function providerKey(provider, model) {
  return `${normalizeProviderId(provider)}:${String(model || 'unknown').trim().toLowerCase()}`
}

export function normalizeModelId(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[\s_.]+/g, '-').replace(/-+/g, '-')
}

export function isDeepSeekPeak(atMs, windows = DEFAULT_PRICE_BOOK.deepseekPeakWindowsUtc) {
  const date = new Date(atMs)
  const hour = date.getUTCHours() + date.getUTCMinutes() / 60
  return windows.some(window => hour >= finite(window.start) && hour < finite(window.end))
}

export function resolvePrice(book, provider, model, atMs = Date.now()) {
  const normalizedProvider = normalizeProviderId(provider)
  const direct = providerKey(normalizedProvider, model)
  const alias = book?.aliases?.[direct]
  const entry = book?.models?.[direct] ?? (alias ? book?.models?.[alias] : undefined)
  const matchedBy = entry ? (alias ? 'alias' : 'exact') : 'unpriced'
  if (!entry) return { entry: null, tier: 'unpriced', matchedBy, key: direct }
  const peak = entry.mode === 'deepseek-peak' && isDeepSeekPeak(atMs, book?.deepseekPeakWindowsUtc)
  return { entry, tier: peak ? 'peak' : entry.mode === 'deepseek-peak' ? 'off-peak' : 'flat', matchedBy, key: direct }
}

export function calculateCost(usage, resolved, usdToCny) {
  if (!resolved?.entry) {
    return { native: 0, currency: null, usd: 0, cny: 0, priced: false, tier: 'unpriced' }
  }
  const entry = resolved.entry
  const input = finite(usage?.inputTokens)
  const output = finite(usage?.outputTokens)
  const cacheRead = finite(usage?.cacheReadTokens)
  const cacheWrite = finite(usage?.cacheWriteTokens)
  const reasoning = finite(usage?.reasoningTokens)
  const longContext = entry.mode === 'context-tiered' && input + cacheRead + cacheWrite >= finite(entry.contextThresholdTokens || 272_000)
  const rates = resolved.tier === 'peak' ? entry.peak : resolved.tier === 'off-peak' ? entry.offPeak : longContext ? entry.longContext : entry
  const outputNonReasoning = Math.max(0, output - reasoning)
  const native = (
    input * finite(rates.input)
    + cacheRead * finite(rates.cacheRead ?? rates.cachedInput)
    + cacheWrite * finite(rates.cacheWrite ?? rates.input)
    + outputNonReasoning * finite(rates.output)
    + reasoning * finite(rates.reasoning ?? rates.output)
  ) / 1_000_000
  const fx = Number.isFinite(Number(usdToCny)) && Number(usdToCny) > 0 ? Number(usdToCny) : null
  const currency = entry.currency === 'CNY' ? 'CNY' : 'USD'
  return {
    native,
    currency,
    usd: currency === 'USD' ? native : fx ? native / fx : null,
    cny: currency === 'CNY' ? native : fx ? native * fx : null,
    priced: true,
    tier: longContext ? 'long-context' : resolved.tier,
  }
}

const decode = value => String(value ?? '')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;|&#160;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&gt;/gi, '>')
  .replace(/&lt;/gi, '<')
  .replace(/&quot;/gi, '"')
  .replace(/&dollar;|&#36;/gi, '$')
  .replace(/\s+/g, ' ')
  .trim()

const rowCells = html => [...String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(row =>
  [...row[1].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)].map(cell => decode(cell[1])))

const dollarValues = row => row.flatMap(cell => [...cell.matchAll(/\$\s*([0-9]+(?:\.[0-9]+)?)/g)].map(match => Number(match[1])))
const yuanValues = row => row.flatMap(cell => [...cell.matchAll(/(?:¥|￥|人民币|CNY)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:元)?/g)].map(match => Number(match[1])))

export function parseDeepSeekPricingHtml(html, checkedAt = new Date().toISOString()) {
  const rows = rowCells(html)
  const modelRow = rows.find(row => row.some(cell => /^(?:MODEL|模型)$/i.test(cell)))
  if (!modelRow || modelRow.length < 2) throw new Error('DeepSeek pricing table: MODEL row not found')
  const models = modelRow.filter(cell => /^deepseek-[a-z0-9-]+$/i.test(cell)).map(cell => cell.toLowerCase())
  if (models.length === 0) throw new Error('DeepSeek pricing table: no model ids found')
  const cnyTiers = label => {
    const index = rows.findIndex(cells => decode(cells.join(' ')).includes(label))
    if (index < 0) return { off: [], peak: [] }
    const values = cells => cells.flatMap(cell => /元/.test(cell) ? yuanValues([cell]) : [])
    return { off: values(rows[index]), peak: values(rows[index + 1] || []) }
  }
  const cnyHit = cnyTiers('缓存命中'), cnyMiss = cnyTiers('缓存未命中'), cnyOutput = cnyTiers('百万tokens输出')
  if ([cnyHit.off,cnyHit.peak,cnyMiss.off,cnyMiss.peak,cnyOutput.off,cnyOutput.peak].every(list => list.length >= models.length)) {
    return Object.fromEntries(models.map((model, index) => [providerKey('deepseek', model), {
      provider: 'deepseek', model, currency: 'CNY', unit: 'million_tokens', mode: 'deepseek-peak',
      offPeak: { input: cnyMiss.off[index], cacheRead: cnyHit.off[index], cacheWrite: cnyMiss.off[index], output: cnyOutput.off[index], reasoning: cnyOutput.off[index] },
      peak: { input: cnyMiss.peak[index], cacheRead: cnyHit.peak[index], cacheWrite: cnyMiss.peak[index], output: cnyOutput.peak[index], reasoning: cnyOutput.peak[index] },
      sourceUrl: DEEPSEEK_PRICING_URL, checkedAt, source: 'official', sourceKind: 'official',
    }]))
  }
  const findRates = (label, tier) => {
    const row = rows.find(cells => decode(cells.join(' ')).toUpperCase().includes(label) && decode(cells.join(' ')).toUpperCase().includes(tier))
    return row ? dollarValues(row) : []
  }
  const locateTierRows = label => {
    const index = rows.findIndex(cells => decode(cells.join(' ')).toUpperCase().includes(label))
    if (index < 0) return { off: [], peak: [] }
    const vicinity = rows.slice(index, index + 3)
    const off = vicinity.find(cells => cells.some(cell => /OFF-PEAK/i.test(cell)))
    const peak = vicinity.find(cells => cells.some(cell => /^PEAK$/i.test(cell)))
    return { off: off ? dollarValues(off) : [], peak: peak ? dollarValues(peak) : [] }
  }
  const hit = locateTierRows('CACHE HIT')
  const miss = locateTierRows('CACHE MISS')
  const output = locateTierRows('OUTPUT TOKENS')
  if ([hit.off, hit.peak, miss.off, miss.peak, output.off, output.peak].some(values => values.length < models.length)) {
    const text = decode(html)
    const extract = (label, tier) => {
      const pattern = new RegExp(`${label}[\\s\\S]{0,160}?${tier}[\\s\\S]{0,160}`, 'i')
      const segment = text.match(pattern)?.[0] ?? ''
      return dollarValues([segment])
    }
    hit.off = hit.off.length >= models.length ? hit.off : extract('CACHE HIT', 'OFF-PEAK')
    hit.peak = hit.peak.length >= models.length ? hit.peak : extract('CACHE HIT', 'PEAK')
    miss.off = miss.off.length >= models.length ? miss.off : extract('CACHE MISS', 'OFF-PEAK')
    miss.peak = miss.peak.length >= models.length ? miss.peak : extract('CACHE MISS', 'PEAK')
    output.off = output.off.length >= models.length ? output.off : extract('OUTPUT TOKENS', 'OFF-PEAK')
    output.peak = output.peak.length >= models.length ? output.peak : extract('OUTPUT TOKENS', 'PEAK')
  }
  if ([hit.off, hit.peak, miss.off, miss.peak, output.off, output.peak].some(values => values.length < models.length)) {
    throw new Error('DeepSeek pricing table: incomplete price rows')
  }
  const entries = {}
  models.forEach((model, index) => {
    entries[providerKey('deepseek', model)] = {
      provider: 'deepseek', model, currency: 'USD', unit: 'million_tokens', mode: 'deepseek-peak',
      offPeak: { input: miss.off[index], cacheRead: hit.off[index], cacheWrite: miss.off[index], output: output.off[index], reasoning: output.off[index] },
      peak: { input: miss.peak[index], cacheRead: hit.peak[index], cacheWrite: miss.peak[index], output: output.peak[index], reasoning: output.peak[index] },
      sourceUrl: DEEPSEEK_PRICING_URL, checkedAt, source: 'official', sourceKind: 'official',
    }
  })
  return entries
}

export function parseOpenRouterModels(payload, checkedAt = new Date().toISOString()) {
  const list = Array.isArray(payload?.data) ? payload.data : []
  const entries = {}
  for (const item of list) {
    if (!item || typeof item.id !== 'string' || !item.pricing) continue
    const input = finite(item.pricing.prompt) * 1_000_000
    const output = finite(item.pricing.completion) * 1_000_000
    const cacheRead = finite(item.pricing.input_cache_read ?? item.pricing.prompt_cache_hit ?? item.pricing.cached_prompt) * 1_000_000
    const cacheWrite = finite(item.pricing.input_cache_write ?? item.pricing.prompt_cache_write) * 1_000_000
    entries[providerKey('openrouter', item.id)] = {
      provider: 'openrouter', model: item.id, currency: 'USD', unit: 'million_tokens', mode: 'flat',
      input, output, cacheRead: cacheRead || input, cacheWrite: cacheWrite || input,
      reasoning: output, request: finite(item.pricing.request), image: finite(item.pricing.image),
      sourceUrl: OPENROUTER_MODELS_URL, checkedAt, source: 'official-live',
    }
  }
  if (Object.keys(entries).length === 0) throw new Error('OpenRouter models API: no priced models found')
  return entries
}

export function parseOpenAiPricingHtml(html, checkedAt = new Date().toISOString()) {
  const text = decode(html)
  const flagship = text.match(/Flagship models[\s\S]*?(?:Regional processing|Specialized models)/i)?.[0] || ''
  const entries = {}
  const pattern = /\b(gpt-[a-z0-9][a-z0-9.-]*)\s+\$\s*([0-9.]+)\s+\$\s*([0-9.]+)\s+\$\s*([0-9.]+)\s+\$\s*([0-9.]+)\s+\$\s*([0-9.]+)\s+\$\s*([0-9.]+)\s+\$\s*([0-9.]+)\s+\$\s*([0-9.]+)/gi
  for (const match of flagship.matchAll(pattern)) {
    const [, model, input, cacheRead, cacheWrite, output, longInput, longCacheRead, longCacheWrite, longOutput] = match
    entries[providerKey('openai', model)] = {
      provider: 'openai', model: model.toLowerCase(), currency: 'USD', unit: 'million_tokens', mode: 'context-tiered', contextThresholdTokens: 272_000,
      input: Number(input), cacheRead: Number(cacheRead), cacheWrite: Number(cacheWrite), output: Number(output), reasoning: Number(output),
      longContext: { input: Number(longInput), cacheRead: Number(longCacheRead), cacheWrite: Number(longCacheWrite), output: Number(longOutput), reasoning: Number(longOutput) },
      sourceUrl: OPENAI_PRICING_URL, checkedAt, source: 'official-live',
    }
  }
  if (Object.keys(entries).length === 0) throw new Error('OpenAI pricing page: flagship model rows not found')
  return entries
}

export function parseGooglePricingHtml(html, checkedAt = new Date().toISOString()) {
  const text = decode(html)
  const entries = {}
  const numberList = value => [...String(value).matchAll(/\$\s*([0-9]+(?:\.[0-9]+)?)/g)].map(match => Number(match[1]))
  const section = (value, start, end) => {
    const from = value.search(start)
    if (from < 0) return []
    const tail = value.slice(from).replace(start, '')
    const to = tail.search(end)
    return numberList(to < 0 ? tail : tail.slice(0, to))
  }
  for (const match of text.matchAll(/\b(gemini-[a-z0-9][a-z0-9.-]*)\b/gi)) {
    const model = match[1].toLowerCase()
    const tail = text.slice(match.index, match.index + 7000)
    const end = tail.search(/\bBatch\b/i)
    const standard = end > 0 ? tail.slice(0, end) : ''
    if (!/\bStandard\b/i.test(standard) || !/Input price/i.test(standard) || !/Output price/i.test(standard)) continue
    const inputs = section(standard, /Input price/i, /Output price/i)
    const outputs = section(standard, /Output price(?: \(including thinking tokens\))?/i, /Context caching price|Grounding with/i)
    const cached = section(standard, /Context caching price/i, /Grounding with|Used to improve/i)
    if (!Number.isFinite(inputs[0]) || !Number.isFinite(outputs[0])) continue
    const entry = {
      provider: 'google', model, currency: 'USD', unit: 'million_tokens', mode: inputs.length > 1 && />\s*200k/i.test(standard) ? 'context-tiered' : 'flat',
      contextThresholdTokens: 200_000, input: inputs[0], cacheRead: cached[0] ?? inputs[0], cacheWrite: inputs[0], output: outputs[0], reasoning: outputs[0],
      sourceUrl: GOOGLE_PRICING_URL, checkedAt, source: 'official-live',
    }
    if (entry.mode === 'context-tiered') entry.longContext = { input: inputs[1], cacheRead: cached[1] ?? cached[0] ?? inputs[1], cacheWrite: inputs[1], output: outputs[1] ?? outputs[0], reasoning: outputs[1] ?? outputs[0] }
    entries[providerKey('google', model)] = entry
  }
  if (Object.keys(entries).length === 0) throw new Error('Google Gemini pricing page: standard priced model sections not found')
  return entries
}

export function parseAnthropicPricingHtml(html, checkedAt = new Date().toISOString()) {
  const text = decode(html)
  const table = text.match(/Model Base Input Tokens[\s\S]*?MTok = Million tokens/i)?.[0] || ''
  const entries = {}
  const pattern = /(Claude (?:Fable|Mythos|Opus|Sonnet|Haiku) [0-9]+(?:\.[0-9]+)?)(?: \([^)]*\))?\s+\$\s*([0-9.]+)\s*\/\s*MTok\s+\$\s*([0-9.]+)\s*\/\s*MTok\s+\$\s*([0-9.]+)\s*\/\s*MTok\s+\$\s*([0-9.]+)\s*\/\s*MTok\s+\$\s*([0-9.]+)\s*\/\s*MTok/gi
  for (const match of table.matchAll(pattern)) {
    const [, label, input, cacheWrite5m, cacheWrite1h, cacheRead, output] = match
    const model = label.toLowerCase().replace(/\./g, '-').replace(/\s+/g, '-')
    entries[providerKey('anthropic', model)] = {
      provider: 'anthropic', model, label, currency: 'USD', unit: 'million_tokens', mode: 'flat',
      input: Number(input), cacheRead: Number(cacheRead), cacheWrite: Number(cacheWrite5m), cacheWrite5m: Number(cacheWrite5m), cacheWrite1h: Number(cacheWrite1h), output: Number(output), reasoning: Number(output),
      sourceUrl: ANTHROPIC_PRICING_URL, checkedAt, source: 'official-live',
    }
  }
  if (Object.keys(entries).length === 0) throw new Error('Anthropic pricing page: model price rows not found')
  return entries
}

export { DEEPSEEK_PRICING_URL, OPENROUTER_MODELS_URL, OPENAI_PRICING_URL, GOOGLE_PRICING_URL, ANTHROPIC_PRICING_URL }
