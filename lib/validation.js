import { z } from 'zod'

const boundedText = (max = 256) => z.string().trim().min(1).max(max)
const optionalBoundedText = (max = 256) => z.string().trim().max(max).optional()
const nonnegative = z.coerce.number().finite().min(0)
const optionalMoney = z.union([nonnegative.max(1_000_000_000_000), z.null()]).optional()
const credentialRef = z.string().trim().regex(/^[A-Za-z_][A-Za-z0-9_.:-]{0,127}$/)

const customPriceSchema = z.object({
  provider: optionalBoundedText(64),
  model: optionalBoundedText(256),
  currency: z.enum(['USD', 'CNY']).optional(),
  input: nonnegative.max(1_000_000).optional(),
  cacheRead: nonnegative.max(1_000_000).optional(),
  cacheWrite: nonnegative.max(1_000_000).optional(),
  output: nonnegative.max(1_000_000).optional(),
  reasoning: nonnegative.max(1_000_000).optional(),
}).strict().refine(value => ['input', 'cacheRead', 'cacheWrite', 'output', 'reasoning'].some(key => value[key] !== undefined), {
  message: 'At least one price rate is required',
})

const budgetsSchema = z.object({
  dailyCny: optionalMoney,
  monthlyCny: optionalMoney,
  warningPercent: z.coerce.number().finite().min(0).max(100).optional(),
  limitPercent: z.coerce.number().finite().min(1).max(100).optional(),
  systemNotifications: z.boolean().optional(),
}).strict()

const adapterSchema = z.object({
  enabled: z.boolean().optional(),
  credentialRef: credentialRef.optional(),
}).strict()

export const filterSchema = z.object({
  range: z.enum(['today', '7d', '30d', 'custom']).optional(),
  groupBy: z.enum(['date', 'hour', 'conversation', 'workspace', 'model', 'provider', 'credential', 'purpose']).optional(),
  start: z.union([z.number().finite(), z.string().trim().max(64), z.null()]).optional(),
  end: z.union([z.number().finite(), z.string().trim().max(64), z.null()]).optional(),
  sessionId: optionalBoundedText(256),
  workspaceId: optionalBoundedText(256),
  workspace: optionalBoundedText(2048),
  workspaceKey: optionalBoundedText(2056),
  provider: optionalBoundedText(128),
  model: optionalBoundedText(256),
  credentialRef: optionalBoundedText(128),
  purpose: optionalBoundedText(64),
}).strict()

export const configPatchSchema = z.object({
  timezone: optionalBoundedText(64),
  retentionDays: z.coerce.number().int().min(1).max(3650).optional(),
  priceSyncHours: z.coerce.number().finite().min(1).max(168).optional(),
  balanceRefreshMinutes: z.coerce.number().finite().min(1).max(1440).optional(),
  fxRefreshMinutes: z.coerce.number().finite().min(5).max(1440).optional(),
  display: z.object({ composer: z.boolean().optional(), sidebar: z.boolean().optional(), showUsdInDetails: z.boolean().optional() }).strict().optional(),
  budgets: budgetsSchema.optional(),
  priceSync: z.object({ deepseek: z.boolean().optional(), openrouter: z.boolean().optional(), openai: z.boolean().optional(), google: z.boolean().optional(), anthropic: z.boolean().optional() }).strict().optional(),
  pricing: z.object({
    thirdPartyUrl: z.literal('https://openrouter.ai/api/v1/models').optional(),
    preferredSources: z.record(z.string().max(320), z.enum(['api', 'official', 'thirdParty'])).optional(),
    customOverrides: z.record(z.string().max(320), customPriceSchema).optional(),
  }).strict().optional(),
  balanceAdapters: z.object({
    deepseek: adapterSchema.optional(),
    openrouter: adapterSchema.optional(),
    moonshot: adapterSchema.optional(),
    siliconflow: adapterSchema.optional(),
  }).strict().optional(),
  manualBalances: z.array(z.object({
    id: boundedText(128),
    provider: optionalBoundedText(128),
    label: z.union([z.string().max(256), z.record(z.string().max(16), z.string().max(256))]).optional(),
    currency: z.enum(['USD', 'CNY']).optional(),
    total: nonnegative.max(1_000_000_000_000).optional(),
    remaining: nonnegative.max(1_000_000_000_000).optional(),
    updatedAt: z.string().datetime().optional(),
  }).strict()).max(100).optional(),
}).strict()

export const priceKeySchema = boundedText(320)
export const priceSourceSchema = z.enum(['api', 'official', 'thirdParty']).nullable()
export const customPriceInputSchema = customPriceSchema.nullable()
export const sessionIdSchema = boundedText(256)

export function parseFilter(value) {
  return filterSchema.parse(value && typeof value === 'object' ? value : {})
}

export function parseConfigPatch(value) {
  return configPatchSchema.parse(value && typeof value === 'object' ? value : {})
}
