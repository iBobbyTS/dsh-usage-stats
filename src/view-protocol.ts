export interface UsageWindow {
  amount?: number
  unit?: string
  kind: string
  usedPercent?: number
  remainingPercent?: number
  resetsAt?: string | null
  remaining?: number | null
  windowSeconds?: number
  label?: string
  [key: string]: unknown
}
export interface CreditBalance {
  wallets?: {
    currency: string
    remaining: number
    breakdown?: { granted: number; toppedUp: number }
  }[]
  remaining: number | null
  used?: number | null
  total?: number | null
  currency?: string | null
  unlimited?: boolean
  expiresAt?: string | null
  available?: boolean
  breakdown?: { granted?: number | null; toppedUp?: number | null }
  [key: string]: unknown
}
export interface AccountSnapshot {
  id: string
  displayName: string
  mode: string
  adapter: string | null
  provenance: string
  status: string
  fetchedAt: number | null
  plan?: string
  balance?: CreditBalance | null
  windows?: UsageWindow[]
  alert?: {
    level: string
    metric: string
    value: number | null
    threshold?: number
  }
  source?: string
  reason?: string | null
  missingCredentials?: string[]
  partial?: string[]
  lastAttemptAt?: number | null
  lastSuccessAt?: number | null
  observedAt?: number
  ageMs?: number | null
  stale?: boolean
  [key: symbol]: unknown
  [key: string]: unknown
}
export interface ModelUsage {
  model: string
  tokens: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cacheHitRate: number | null
  costComplete?: boolean
  estimatedCost?: number | null
  currency?: string | null
}
export interface DayUsage extends Omit<ModelUsage, 'model'> {
  date: string
  models: ModelUsage[]
}
export interface SessionUsage {
  sessionId: string
  title?: string | null
  providers: string[]
  models: string[]
  tokens: number
  costComplete: boolean
  estimatedCost: number | null
  currency: string | null
  lastAt: string | null
}
export interface BudgetWindow {
  limit: number | null
  currency: string
  estimatedSpend: number | null
  percent: number | null
  costComplete: boolean
  level: string
}
export interface UsageView {
  days?: DayUsage[]
  sessions?: SessionUsage[]
  total?: Omit<ModelUsage, 'model'>
  updatedAt?: number
  budgets?: { currency: string; daily: BudgetWindow; monthly: BudgetWindow }
}
export interface ProviderView {
  id: string
  displayName?: string
  configured?: boolean
  status?: string
  accountMode?: string | null
  adapter?: string | null
  stale?: boolean
  pricingWindow?: { tariff: string; nextTransitionAt?: string | null }
  [key: string]: unknown
}
export interface ProviderOption {
  adapter: string | null
  displayMetric: string
  usageBaseURL: string | null
  credentialRef: string | null
}
