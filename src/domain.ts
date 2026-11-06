export interface Buckets {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}
export interface Provider {
  id: string
  displayName?: string
  name?: string
  baseURL?: string | null
  apiKeyEnv?: string | null
  accountService?: string
  credentialRecord?: string
  quotaBinding?: { id: string; revision: string; generation: number }
  ownedBaseURL?: boolean
  balanceScheme?: string | null
  [key: string]: unknown
}
export interface Monitor {
  providerId?: string
  displayName?: string
  mode?: string
  region?: string
  commandCodeVersion?: string
  arkCLIExecutable?: string
  arkCLIProfile?: string
  fallbackCredentialRef?: string
  fallbackUserIdRef?: string
  allowInsecure?: boolean
  allowPrivateNetwork?: boolean
  allowCrossOrigin?: boolean
  warning?: { warnBelow?: unknown; criticalBelow?: unknown }
  request?: {
    path: string
    method?: string
    headers?: Record<string, unknown>
    auth?: { type: string; param: string; credentialRef?: string }
  }
  extract?: Record<string, unknown>
  adapter?: string | null
  usageBaseURL?: string | null
  credentialRef?: string | null
  [key: string]: unknown
}
export interface AccountConfig {
  refresh?: {
    enabled: boolean
    activeMs: number
    detailMs: number
    backgroundMs: number
  }
  disableBackgroundRefresh?: boolean
  monitors: Record<string, Monitor>
  [key: string]: unknown
}
export interface Identity {
  routeId: string
  displayName: string
  providerFamily: string
  pricingFamily: string
  baseURL: string | null
  accountAdapter: string | null
  confidence: string
}
export interface Source {
  kind: string
  provider: string
  url: string
}
export interface UnitPrices {
  input: number | null
  cacheRead: number | null
  cacheWrite: number | null
  output: number | null
}
export interface Schedule {
  timezone: string
  peakDays: readonly number[]
  peakWindows: readonly (readonly string[])[]
  otherwise: string
}
export interface PriceRule {
  id: string
  providerFamily: string
  pricingFamily: string
  modelMatcher: { type: string; model: string }
  effectiveFrom: string | null
  effectiveTo: string | null
  pricing: Partial<Record<string, UnitPrices>>
  currency: string
  schedule: Schedule | null
  source: Source
  updatedAt: string
}
export interface PricingInput {
  identity: Identity | null
  model: string
  timestamp: unknown
  currency: string
  buckets?: Buckets
}
export interface CostEstimate {
  amount: number
  currency: string
  ruleId?: string | null
  source?: Source | null
  updatedAt?: string | null
}
export type CostSample =
  | { counted: false }
  | { counted: true; complete: false }
  | {
      counted: true
      complete: true
      amount: number
      currency: string
      ruleId: string | null
      source: Source | null
      updatedAt: string | null
    }
export interface CostAccumulator {
  pricedSamples: number
  incompleteSamples: number
  currencies: Map<string, { amount: number; count: number }>
  rules: Map<
    string,
    { count: number; source: Source | null; updatedAt: string | null }
  >
}
export interface BillingDay {
  total: CostAccumulator
  models: Map<string, CostAccumulator>
}
export interface UsageDay {
  totals: Buckets
  models: Map<string, Buckets>
}
export interface UsageSample {
  ledgerKey?: string
  seq: number
  aliases: string[]
  key: string
  day: string
  model: string
  providerId: string
  time: number | null
  buckets: Buckets
  cost: CostSample
}
export interface UsageState {
  days: Map<string, UsageDay>
  billing: {
    total: CostAccumulator
    days: Map<string, BillingDay>
    providers: Map<string, number>
    models: Map<string, number>
    sampleCount: number
    firstAt: number | null
    lastAt: number | null
    penultimateAt: number | null
  }
  lastSample: UsageSample | null
  compactionSamples: Map<string, UsageSample>
  usageSamples: Map<string, UsageSample>
  inheritedEventCount: number | null
  currentModel: string | null
  currentRoute: {
    providerId: string
    model: string
    updatedAt: number | null
  } | null
  consumed: number
  title?: string | null
}
export interface UsageEvent {
  type: string
  seq: number
  time: number
  data?: {
    turn?: number
    step?: number
    chunk?: { type: string; usage: Buckets }
    usage?: Buckets
    compactionId?: string
    message?: { source?: { model?: string; provider?: string } }
    model?: string
    provider?: string
    header?: { config?: { model?: string; provider?: string } }
    inherited?: boolean
  }
}
export type CostEstimator = (input: {
  providerId: string
  model: string
  timestamp: number
  buckets: Buckets
}) => CostEstimate | null
