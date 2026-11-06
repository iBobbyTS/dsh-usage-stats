import type * as React from 'react'
import type {
  ProviderView,
  AccountSnapshot,
  ProviderOption,
  UsageView,
} from './view-protocol.js'
export type Translate = (
  key: string,
  params?: Record<string, unknown>,
) => string
export type Stop = () => void
export type Store<T> = { getSnapshot(): T; subscribe(fn: Stop): Stop }
export interface Directory {
  store: Store<{
    status: string
    current?: { provider: string; model: string }
    pending?: unknown
    routable?: boolean
    error?: unknown
  }>
  load(): unknown
}
export interface FollowServices {
  sessions?: {
    list?: Store<{
      phase: string
      byId: Record<string, { id: string; retainedBy?: { mainView?: number } }>
    }>
  }
  modelDirectories?: { directoryFor(id: string): Directory }
  [key: string]: unknown
}
export interface FollowState {
  status: string
  sessionId?: string
  providerId?: string
  model?: string
  service?: FollowServices | null
}
export interface ClientContext {
  locale: {
    bind(ns: string): (key: string) => string
    register(ns: string, dicts: object): Stop
  }
  get?(name: string): unknown
  inject?(
    names: string[],
    fn: (ctx: FollowServices & Pick<ClientContext, 'effect'>) => void,
  ): unknown
  effect(fn: () => unknown, label?: string): unknown
  slots: {
    inject(name: string, fn: () => unknown): unknown
    register(spec: object, component: React.ComponentType<never>): Stop
  }
}
export interface Payload extends UsageView {
  ok?: boolean
  providers?: ProviderView[]
  account?: AccountSnapshot | null
  context?: { providerId?: string }
  option?: ProviderOption
  resolvedAdapter?: string | null
  displayMetric?: string
  error?: string
  message?: string
  display?: { currentSessionPill?: boolean }
}
declare const require: (
  name: '@deepseek-ai/dsh-client-ui-primitives',
) => Record<
  string,
  React.ComponentType<React.PropsWithChildren<{ size?: number }>>
>
export const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
