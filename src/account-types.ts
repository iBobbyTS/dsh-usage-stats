import type {
  UsageWindow,
  CreditBalance,
  AccountSnapshot,
} from './view-protocol.js'
export type {
  UsageWindow,
  CreditBalance,
  AccountSnapshot,
} from './view-protocol.js'
import type { readFile } from 'node:fs/promises'
export interface Credentials {
  resolve(ref: string): Promise<{ value?: string } | null | undefined>
}

export interface SubscriptionSnapshot {
  id: string
  displayName: string
  mode: string
  status: string
  plan?: string
  windows: UsageWindow[]
  credits?: CreditBalance
  reason?: string | null
  region?: string
  missingCredentials?: string[]
}
export interface SubscriptionOptions {
  apiKeyRef?: string
  allowLocalAuth?: boolean
  baseURL?: string
  commandCodeVersion?: string
  inferredRegion?: string
  region?: string
  zaiRegionOverride?: string
  openCodeApiKeyRef?: string
  zaiApiKeyRef?: string
  zaiDefaultRegion?: string
}
export interface SubscriptionDeps extends SubscriptionOptions {
  fetch?: (url: string, init: RequestInit) => Promise<ResponseLike>
  readFile?: typeof readFile
  homedir?: () => string
  timeoutMs?: number
  now?: () => number
}
export type CollectorDeps = SubscriptionDeps & { now: () => number }
export interface ProviderFailure extends Error {
  providerStatus?: string
  httpStatus?: number
  safeReason?: string
  code?: string
  killed?: boolean
  cause?: unknown
}
export function failureDetails(value: unknown): ProviderFailure {
  return (
    value !== null && typeof value === 'object'
      ? value
      : new Error(String(value))
  ) as ProviderFailure
}
export type WireFields = Record<string, unknown>

export interface AccountWire extends Record<string, unknown> {
  data?: WireData
  quota?: WireFields
  subscription?: WireFields
  rate_limits?: WireFields[]
}
export interface WireData extends Record<string, unknown> {
  user_quota?: WireFields
}

export interface AccountSpec {
  id: string
  displayName: string
  adapter: string | null
  mode: string | null
  quotaBinding?: import('./domain.js').Provider['quotaBinding']
  apiKeyRef?: string | null
  credentialRecord?: string
  useDefaultZaiCredential: boolean
  useDefaultOpenCodeCredential: boolean
  overrideIncomplete: boolean
  baseURL?: string | null
  providerBaseURL?: string | null
  monitor: import('./domain.js').Monitor
  configKey: string
  provenanceHint?: string
}
export interface ResponseLike {
  ok: boolean
  status: number
  headers?: { get(name: string): string | null }
  arrayBuffer?(): Promise<ArrayBufferLike>
  json(): Promise<unknown>
  text(): Promise<string>
}
export interface Address {
  address: string
  family: number
}
export interface ClientMetadata {
  version: string
  locale: string
  timezoneOffsetSeconds: number
}
export interface DeepSeekAccount {
  [key: symbol]: unknown
  getState(): Promise<{ status: string }>
  getBalance(
    client: ClientMetadata,
  ): Promise<{
    status: string
    value?: { currency?: unknown; balance?: unknown }[]
    bonusWallets?: { currency?: unknown; balance?: unknown }[]
  } | null>
}
export interface CreditService {
  [key: symbol]: unknown
  supportedProviders():
    | { id: string; displayName?: string }[]
    | Promise<unknown>
  creditsBalances(
    id: string,
  ): Promise<{
    accounts: {
      accountId?: string
      nickname?: string
      stale?: boolean
      error?: string
      balance?: { total?: unknown; unit?: string; packages?: WireFields[] }
    }[]
  }>
}
export interface HostServices {
  deepseekAccount: DeepSeekAccount
  creditBalance: CreditService
  usageQuota: import('./quota-protocol.js').QuotaRegistry
}
export interface AccountDeps extends Omit<SubscriptionDeps, 'fetch'> {
  fetch?: (url: string, init: RequestInit) => Promise<ResponseLike>
  lookup?: typeof import('node:dns/promises').lookup
  maxResponseBytes?: number
  requestPinned?: (
    url: URL,
    address: Address,
    init: RequestInit,
    signal: AbortSignal,
  ) => Promise<ResponseLike>
  refreshMs?: number
  refreshPolicy?: Record<string, number>
  activityTtlMs?: number
  includeLegacyProviders?: boolean
  clientMetadata?: unknown
  sub2apiDetection?: Map<string, boolean>
  deepseekAccount?: DeepSeekAccount | (() => DeepSeekAccount | null | undefined)
  creditBalance?: CreditService | (() => CreditService | null | undefined)
  usageQuota?:
    | HostServices['usageQuota']
    | (() => HostServices['usageQuota'] | null | undefined)
  arkExecFile?: NonNullable<
    Parameters<typeof import('./ark-coding-plan.js').queryArkCodingPlan>[1]
  >['arkExecFile']
}
export interface AccountCredentials extends Credentials {
  readRecord?(
    key: string,
  ): Promise<{ kind: string; key?: string } | null | undefined>
}
