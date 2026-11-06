/** Host-only quota protocol v1; projections must never contain credentials or raw provider records. */
export interface QuotaWindow {
  id: string
  label?: string
  usedPercent: number
  windowSeconds?: number
  resetsAt?: number
}
export interface QuotaSnapshot {
  observedAt: number
  accounts: Array<{
    id: string
    label?: string
    plan?: string
    status:
      | 'ok'
      | 'not-configured'
      | 'unauthorized'
      | 'rate-limited'
      | 'unavailable'
      | 'invalid-response'
    reason?:
      | 'reauth-required'
      | 'credential-conflict'
      | 'persistence-failed'
      | 'invalid-auth-file'
      | 'file-unavailable'
      | 'refresh-busy'
      | 'unsupported-auth-mode'
    stale?: boolean
    retryAt?: number
    windows: QuotaWindow[]
  }>
}
export interface QuotaSource {
  protocolVersion: 1
  id: string
  displayName: string
  providerRoutes: readonly string[]
  /** Opaque binding revision: changes on account/config changes, not each query. Synchronous, no network I/O. */
  revision(): string
  read(options: { signal: AbortSignal }): Promise<QuotaSnapshot>
}
export interface QuotaRegistry {
  readonly protocolVersion: 1
  register(source: QuotaSource): () => void
  list(): Array<{
    id: string
    displayName: string
    providerRoutes: string[]
    revision: string
  }>
  read(
    id: string,
    revision: string,
    options?: { signal?: AbortSignal },
  ): Promise<QuotaSnapshot>
  subscribe(listener: () => void): () => void
  dispose(): void
}
