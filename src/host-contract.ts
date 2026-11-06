import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { UsageEvent } from './domain.js'
import type { AccountCredentials, HostServices } from './account-types.js'
export interface SessionHeader {
  id: string
  title?: string
  isSeeded?: boolean
  [key: string]: unknown
}
export interface LiveSession {
  id: string
  title?: string
  seq: number
  events?: UsageEvent[]
  inheritedEventCount?: number
  snapshotEvents?(from: number): UsageEvent[]
}
export interface PersistedEntry {
  header?: SessionHeader
  id?: string
  title?: string
  isSeeded?: boolean
  revision?: string
  inheritedEventCount?: number
}
export interface Persistence {
  list(): Promise<PersistedEntry[]>
  listSnapshots?(): Promise<PersistedEntry[]>
  open?(
    id: string,
    mode: string,
  ): Promise<{
    read(from: number): Promise<{ events: UsageEvent[] }>
    close(): Promise<void>
    inheritedEventCount?: number
  }>
  readFrom(
    id: string,
    from: number,
  ): Promise<{ events: UsageEvent[]; inheritedEventCount?: number }>
}
export interface ProviderProfile {
  displayName?: unknown
  apiKeyEnv?: unknown
  baseURL?: unknown
}
export interface SettingsValue extends ProviderProfile {
  providers?: Record<string, ProviderProfile>
}
export interface Services extends HostServices {
  sessions: { list(): LiveSession[]; get(id: string): LiveSession | undefined }
  sessionPersistence: Persistence
  settings: {
    get(key: string): SettingsValue | undefined
    describe?(): { ns: string; value?: SettingsValue }[]
  }
  llm: { listProviders(): { id: string; name: string }[] }
  credentials: AccountCredentials
}
export interface HostContext {
  get<K extends keyof Services>(name: K): Services[K] | undefined
  logger: Pick<Context['logger'], 'warn'>
  __usageStatsDiagnostics?: Record<string, number>
  credentials: AccountCredentials
  webServer: { register(route: WebRoute): () => void }
  effect(fn: () => unknown, label?: string): unknown
  provide?(name: string, value: unknown): unknown
  on(name: 'session/disposed', fn: (session: LiveSession) => void): unknown
}
