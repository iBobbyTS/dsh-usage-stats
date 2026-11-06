import type { Monitor } from './domain.js'
import { failureDetails } from './account-types.js'
interface ProviderOption {
  adapter: string | null
  displayMetric: string
  usageBaseURL: string | null
  credentialRef: string | null
}
/**
 * User-selected monitoring backend and compact display metric per DSH route.
 *
 * No credentials are stored here. credentialRef is an environment/credential
 * reference name, never a raw API token. Account snapshots remain host-only.
 */
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { validateAccountConfig } from './accounts.js'

export const MONITOR_ADAPTERS = Object.freeze([
  'deepseek-balance',
  'openrouter-balance',
  'moonshot-balance',
  'zai-balance',
  'general',
  'new-api',
  'sub2api',
  'sub2api-auth',
  'opencode-go',
  'commandcode-goat',
  'zai-token-plan',
  'kimi-token-plan',
  'minimax-token-plan',
  'ollama',
  'codearts-credits',
])
export const WINDOW_KINDS = Object.freeze([
  'session',
  'daily',
  'weekly',
  'monthly',
  'quota',
  'mcp',
])
const METRICS = new Set([
  'auto',
  'balance',
  ...WINDOW_KINDS.map((kind) => 'window:' + kind),
])
const ADAPTER_SET = new Set(MONITOR_ADAPTERS)
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,255}$/
const REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/

export function validateProviderOptionId(providerId: unknown) {
  if (
    typeof providerId !== 'string' ||
    !ID_PATTERN.test(providerId) ||
    ['__proto__', 'prototype', 'constructor'].includes(providerId)
  ) {
    throw new Error('invalid provider id')
  }
  return providerId
}

export function validateProviderOption(raw: unknown): ProviderOption {
  const value = raw as Record<string, unknown>
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('provider options must be an object')
  }
  const adapter =
    value.adapter === null ||
    value.adapter === undefined ||
    value.adapter === 'auto'
      ? null
      : value.adapter
  if (adapter !== null && !ADAPTER_SET.has(adapter as string))
    throw new Error('unsupported monitor adapter')
  const displayMetric = value.displayMetric ?? 'auto'
  if (!METRICS.has(displayMetric as string))
    throw new Error('unsupported display metric')
  const usageBaseURL =
    value.usageBaseURL === null ||
    value.usageBaseURL === undefined ||
    value.usageBaseURL === ''
      ? null
      : value.usageBaseURL
  if (usageBaseURL !== null) {
    if (typeof usageBaseURL !== 'string' || usageBaseURL.length > 2048)
      throw new Error('invalid usage URL')
    let url
    try {
      url = new URL(usageBaseURL)
    } catch {
      throw new Error('invalid usage URL')
    }
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error(
        'usage URL must be HTTPS without credentials, query, or fragment',
      )
    }
  }
  const credentialRef =
    value.credentialRef === null ||
    value.credentialRef === undefined ||
    value.credentialRef === ''
      ? null
      : value.credentialRef
  if (
    credentialRef !== null &&
    (typeof credentialRef !== 'string' || !REF_PATTERN.test(credentialRef))
  ) {
    throw new Error(
      'credential reference must name a DSH credential/env variable',
    )
  }
  if ((usageBaseURL !== null || credentialRef !== null) && adapter === null) {
    throw new Error(
      'select a monitor adapter before overriding its endpoint or credential',
    )
  }
  return {
    adapter: adapter as string | null,
    displayMetric: displayMetric as string,
    usageBaseURL: usageBaseURL as string | null,
    credentialRef,
  }
}

export function validateProviderOptions(
  raw: unknown,
): Record<string, ProviderOption> {
  const value = raw as Record<string, unknown>
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('invalid options document')
  const keys = Object.keys(value)
  if (keys.length > 256) throw new Error('too many provider options')
  const result = Object.create(null)
  for (const key of keys)
    result[validateProviderOptionId(key)] = validateProviderOption(value[key])
  return result
}

export function combineMonitorConfig(
  baseMonitors: Record<string, Monitor>,
  options: Record<string, ProviderOption>,
) {
  const monitors = Object.assign(Object.create(null), baseMonitors)
  for (const [providerId, option] of Object.entries(options)) {
    if (option.adapter === null) continue
    monitors[providerId] = {
      ...(baseMonitors[providerId] ?? {}),
      adapter: option.adapter,
      ...(option.usageBaseURL === null
        ? {}
        : { usageBaseURL: option.usageBaseURL }),
      ...(option.credentialRef === null
        ? {}
        : { credentialRef: option.credentialRef }),
    }
  }
  return validateAccountConfig({ monitors }).monitors
}

export function providerOptionsPath() {
  return join(
    process.env.DSH_HOME ?? join(homedir(), '.dsh'),
    'storages',
    'usage-stats-provider-options.json',
  )
}

export async function loadProviderOptions(path = providerOptionsPath()) {
  let content
  try {
    content = await readFile(path, 'utf8')
  } catch (error) {
    if (failureDetails(error).code === 'ENOENT') return Object.create(null)
    throw error
  }
  if (content.length > 131072)
    throw new Error('provider options file is too large')
  return validateProviderOptions(JSON.parse(content))
}

export async function saveProviderOptions(
  options: unknown,
  path = providerOptionsPath(),
) {
  const normalized = validateProviderOptions(options)
  await mkdir(dirname(path), { recursive: true })
  const temp =
    path +
    '.' +
    process.pid +
    '.' +
    Math.random().toString(36).slice(2) +
    '.tmp'
  try {
    await writeFile(temp, JSON.stringify(normalized, null, 2) + '\n', {
      mode: 0o600,
      flag: 'wx',
    })
    await rename(temp, path)
  } catch (error) {
    await unlink(temp).catch(() => {})
    throw error
  }
}
