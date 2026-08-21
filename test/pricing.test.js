import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateCost, isDeepSeekPeak, parseAnthropicPricingHtml, parseDeepSeekPricingHtml, parseGooglePricingHtml, parseOpenAiPricingHtml, resolvePrice } from '../lib/pricing.js'

const entry = {
  provider: 'vendor',
  model: 'model-exact',
  currency: 'USD',
  mode: 'flat',
  input: 1,
  cacheRead: 0.1,
  cacheWrite: 1,
  output: 2,
  reasoning: 2,
}
const book = {
  models: { 'vendor:model-exact': entry },
  aliases: { 'vendor:model-alias': 'vendor:model-exact' },
  deepseekPeakWindowsUtc: [{ start: 1, end: 4 }, { start: 6, end: 10 }],
}

test('price matching is exact or an explicit alias, never fuzzy', () => {
  assert.equal(resolvePrice(book, 'vendor', 'model-exact').matchedBy, 'exact')
  assert.equal(resolvePrice(book, 'vendor', 'model-alias').matchedBy, 'alias')
  assert.equal(resolvePrice(book, 'vendor', 'model-exact-preview').matchedBy, 'unpriced')
  assert.equal(resolvePrice(book, 'vendor', 'MODEL-EXACT').matchedBy, 'exact')
})

test('reasoning tokens are not double-counted inside output tokens', () => {
  const result = calculateCost({
    inputTokens: 1_000_000,
    cacheReadTokens: 1_000_000,
    cacheWriteTokens: 0,
    outputTokens: 1_000_000,
    reasoningTokens: 400_000,
  }, { entry, tier: 'flat' }, 7)
  assert.equal(result.native, 3.1)
  assert.equal(result.usd, 3.1)
  assert.equal(result.cny, 21.7)
})

test('DeepSeek peak windows use UTC and exact boundaries', () => {
  assert.equal(isDeepSeekPeak(Date.parse('2026-08-20T00:59:59Z'), book.deepseekPeakWindowsUtc), false)
  assert.equal(isDeepSeekPeak(Date.parse('2026-08-20T01:00:00Z'), book.deepseekPeakWindowsUtc), true)
  assert.equal(isDeepSeekPeak(Date.parse('2026-08-20T03:59:59Z'), book.deepseekPeakWindowsUtc), true)
  assert.equal(isDeepSeekPeak(Date.parse('2026-08-20T04:00:00Z'), book.deepseekPeakWindowsUtc), false)
})

test('DeepSeek Chinese official table keeps native CNY peak and off-peak prices', () => {
  const html = '<table><tr><td>模型</td><td>deepseek-v4-flash</td><td>deepseek-v4-pro</td></tr><tr><td>百万tokens输入（缓存命中）</td><td>空闲时段</td><td>0.05元</td><td>0.15元</td></tr><tr><td>高峰时段</td><td>0.10元</td><td>0.30元</td></tr><tr><td>百万tokens输入（缓存未命中）</td><td>空闲时段</td><td>1.5元</td><td>4.5元</td></tr><tr><td>高峰时段</td><td>3.0元</td><td>9.0元</td></tr><tr><td>百万tokens输出</td><td>空闲时段</td><td>4.5元</td><td>13.5元</td></tr><tr><td>高峰时段</td><td>9.0元</td><td>27.0元</td></tr></table>'
  const prices = parseDeepSeekPricingHtml(html, '2026-08-21T00:00:00.000Z')
  assert.equal(prices['deepseek:deepseek-v4-flash'].currency, 'CNY')
  assert.equal(prices['deepseek:deepseek-v4-flash'].offPeak.input, 1.5)
  assert.equal(prices['deepseek:deepseek-v4-pro'].peak.output, 27)
})

test('OpenAI official flagship table parses short and long context prices', () => {
  const html = '<section>Flagship models Model Input Cached input Cache writes Output Input Cached input Cache writes Output gpt-5.6-sol $5.00 $0.50 $6.25 $30.00 $10.00 $1.00 $12.50 $45.00 Regional processing</section>'
  const prices = parseOpenAiPricingHtml(html, '2026-08-21T00:00:00.000Z')
  assert.equal(prices['openai:gpt-5.6-sol'].input, 5)
  assert.equal(prices['openai:gpt-5.6-sol'].cacheWrite, 6.25)
  assert.equal(prices['openai:gpt-5.6-sol'].longContext.output, 45)
  assert.equal(prices['openai:gpt-5.6-sol'].source, 'official-live')
  const long = calculateCost({ inputTokens: 300_000, outputTokens: 1_000_000 }, { entry: prices['openai:gpt-5.6-sol'], tier: 'flat' }, 7)
  assert.equal(long.tier, 'long-context')
  assert.equal(long.native, 48)
})

test('Google official pricing sections parse paid standard and long-context tiers', () => {
  const html = '<article>Gemini Pro gemini-3.1-pro-preview Standard Free Tier Paid Tier, per 1M tokens in USD Input price Not available $2.00, prompts $4.00, prompts &gt; 200k tokens Output price (including thinking tokens) Not available $12.00, prompts $18.00, prompts &gt; 200k Context caching price Not available $0.20, prompts $0.40, prompts &gt; 200k Grounding with Google Search Batch</article>'
  const prices = parseGooglePricingHtml(html, '2026-08-21T00:00:00.000Z')
  const price = prices['google:gemini-3.1-pro-preview']
  assert.equal(price.input, 2)
  assert.equal(price.output, 12)
  assert.equal(price.cacheRead, 0.2)
  assert.equal(price.longContext.output, 18)
})

test('Anthropic official table preserves base, cache-write durations, cache-read, and output prices', () => {
  const html = '<table>Model Base Input Tokens 5m Cache Writes 1h Cache Writes Cache Hits & Refreshes Output Tokens Claude Sonnet 4.6 $3 / MTok $3.75 / MTok $6 / MTok $0.30 / MTok $15 / MTok MTok = Million tokens</table>'
  const prices = parseAnthropicPricingHtml(html, '2026-08-21T00:00:00.000Z')
  const price = prices['anthropic:claude-sonnet-4-6']
  assert.equal(price.input, 3)
  assert.equal(price.cacheWrite5m, 3.75)
  assert.equal(price.cacheWrite1h, 6)
  assert.equal(price.cacheRead, 0.3)
  assert.equal(price.output, 15)
})
