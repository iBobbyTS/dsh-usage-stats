interface UsageEntry extends Record<string, unknown> {
  models?: UsageEntry[]
}
interface ExportUsage {
  days?: UsageEntry[]
  sessions?: (Record<string, unknown> & {
    providers?: unknown[]
    models?: unknown[]
  })[]
  total?: UsageEntry
  updatedAt?: unknown
  budgets?: {
    currency?: unknown
    daily?: Record<string, unknown>
    monthly?: Record<string, unknown>
  }
}
type Cell = { value: unknown; text?: boolean }
/**
 * Secret-free export projections for the usage-stats read model.
 *
 * This module deliberately accepts only already-normalized usage/account
 * snapshots and copies a fixed allow-list. Never pass configuration objects,
 * credentials, request headers, or raw upstream responses to an export.
 */

export const EXPORT_SCHEMA_VERSION = '1.0.0'

const CSV_FORMULA_PREFIX = /^[\t\r\n ]*[=+\-@]/

function finiteOrNull(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function stringOrNull(value: unknown) {
  return typeof value === 'string' ? value : null
}

function booleanOrFalse(value: unknown) {
  return value === true
}

function tokenFields(value: Record<string, unknown> = {}) {
  return {
    inputTokens: finiteOrNull(value.inputTokens) ?? 0,
    cacheReadTokens: finiteOrNull(value.cacheReadTokens) ?? 0,
    cacheWriteTokens: finiteOrNull(value.cacheWriteTokens) ?? 0,
    outputTokens: finiteOrNull(value.outputTokens) ?? 0,
    tokens: finiteOrNull(value.tokens) ?? 0,
  }
}

function pricingProjection(value: unknown) {
  const pricing = (
    value !== null && typeof value === 'object' ? value : {}
  ) as {
    source?: Record<string, unknown>
    ruleIds?: unknown[]
    updatedAt?: unknown
  }
  const source =
    pricing.source !== null && typeof pricing.source === 'object'
      ? {
          kind: stringOrNull(pricing.source.kind),
          provider: stringOrNull(pricing.source.provider),
          url: stringOrNull(pricing.source.url),
        }
      : null
  return {
    ruleIds: Array.isArray(pricing.ruleIds)
      ? pricing.ruleIds.filter((entry) => typeof entry === 'string')
      : [],
    source,
    updatedAt: stringOrNull(pricing.updatedAt),
  }
}

function costFields(value: Record<string, unknown> = {}) {
  const complete = booleanOrFalse(value.costComplete)
  return {
    estimatedCost: complete ? finiteOrNull(value.estimatedCost) : null,
    currency: complete ? stringOrNull(value.currency) : null,
    costComplete: complete,
    pricing: pricingProjection(value.pricing),
  }
}

function splitModelKey(value: unknown) {
  if (typeof value !== 'string')
    return { provider: 'unknown', model: 'unknown' }
  const slash = value.indexOf('/')
  if (slash <= 0 || slash === value.length - 1)
    return { provider: 'unknown', model: value || 'unknown' }
  return { provider: value.slice(0, slash), model: value.slice(slash + 1) }
}

function csvCell(value: unknown, text = false) {
  if (value === null || value === void 0) return '""'
  let rendered = String(value)
  if (text && CSV_FORMULA_PREFIX.test(rendered)) rendered = `'${rendered}`
  return `"${rendered.replaceAll('"', '""')}"`
}

function csv(rows: Cell[][]) {
  return `\uFEFF${rows.map((row) => row.map((cell) => csvCell(cell.value, cell.text)).join(',')).join('\r\n')}\r\n`
}

/** Daily provider/model rows, one row per rendered day/model bucket. */
export function dailyCsv(usage: ExportUsage) {
  const rows: Cell[][] = [
    [
      { value: 'date' },
      { value: 'provider' },
      { value: 'model' },
      { value: 'input_tokens' },
      { value: 'cache_read_tokens' },
      { value: 'cache_write_tokens' },
      { value: 'output_tokens' },
      { value: 'total_tokens' },
      { value: 'estimated_cost' },
      { value: 'currency' },
    ],
  ]
  for (const day of Array.isArray(usage?.days) ? usage.days : []) {
    if (day === null || typeof day !== 'object') continue
    for (const entry of Array.isArray(day.models) ? day.models : []) {
      if (entry === null || typeof entry !== 'object') continue
      const route = splitModelKey(entry.model)
      const tokens = tokenFields(entry)
      rows.push([
        { value: stringOrNull(day.date), text: true },
        { value: route.provider, text: true },
        { value: route.model, text: true },
        { value: tokens.inputTokens },
        { value: tokens.cacheReadTokens },
        { value: tokens.cacheWriteTokens },
        { value: tokens.outputTokens },
        { value: tokens.tokens },
        {
          value:
            entry.costComplete === true
              ? finiteOrNull(entry.estimatedCost)
              : null,
        },
        {
          value:
            entry.costComplete === true ? stringOrNull(entry.currency) : null,
          text: true,
        },
      ])
    }
  }
  return csv(rows)
}

/** Session rows. Provider/model sets stay in one row to avoid duplicating totals. */
export function sessionsCsv(usage: ExportUsage) {
  const rows: Cell[][] = [
    [
      { value: 'session_id' },
      { value: 'title' },
      { value: 'provider' },
      { value: 'model' },
      { value: 'tokens' },
      { value: 'estimated_cost' },
      { value: 'currency' },
      { value: 'last_active' },
    ],
  ]
  for (const session of Array.isArray(usage?.sessions) ? usage.sessions : []) {
    if (session === null || typeof session !== 'object') continue
    rows.push([
      { value: stringOrNull(session.sessionId), text: true },
      { value: stringOrNull(session.title), text: true },
      {
        value: Array.isArray(session.providers)
          ? session.providers
              .filter((entry) => typeof entry === 'string')
              .join(' | ')
          : '',
        text: true,
      },
      {
        value: Array.isArray(session.models)
          ? session.models
              .filter((entry) => typeof entry === 'string')
              .join(' | ')
          : '',
        text: true,
      },
      { value: finiteOrNull(session.tokens) ?? 0 },
      {
        value:
          session.costComplete === true
            ? finiteOrNull(session.estimatedCost)
            : null,
      },
      {
        value:
          session.costComplete === true ? stringOrNull(session.currency) : null,
        text: true,
      },
      { value: stringOrNull(session.lastAt), text: true },
    ])
  }
  return csv(rows)
}

function usageEntryProjection(value: Record<string, unknown> | undefined) {
  return {
    ...tokenFields(value),
    cacheHitRate: finiteOrNull(value?.cacheHitRate),
    ...costFields(value),
  }
}

function budgetWindowProjection(value: Record<string, unknown> | undefined) {
  return {
    limit: finiteOrNull(value?.limit),
    currency: stringOrNull(value?.currency),
    estimatedSpend: finiteOrNull(value?.estimatedSpend),
    percent: finiteOrNull(value?.percent),
    costComplete: booleanOrFalse(value?.costComplete),
    level: stringOrNull(value?.level),
  }
}

function alertProjection(raw: unknown) {
  const value = raw as Record<string, unknown> | null
  if (value === null || typeof value !== 'object') return null
  return {
    level: stringOrNull(value.level),
    metric: stringOrNull(value.metric),
    value: finiteOrNull(value.value),
    threshold: finiteOrNull(value.threshold),
  }
}

function accountProjection(value: Record<string, unknown> | undefined) {
  return {
    id: stringOrNull(value?.id),
    displayName: stringOrNull(value?.displayName),
    accountMode: stringOrNull(value?.accountMode),
    adapter: stringOrNull(value?.adapter),
    configured: booleanOrFalse(value?.configured),
    status: stringOrNull(value?.status),
    fetchedAt: finiteOrNull(value?.fetchedAt),
    stale: booleanOrFalse(value?.stale),
    lastAttemptAt: finiteOrNull(value?.lastAttemptAt),
    lastSuccessAt: finiteOrNull(value?.lastSuccessAt),
    ageMs: finiteOrNull(value?.ageMs),
    provenance: stringOrNull(value?.provenance),
    reason: stringOrNull(value?.reason),
    alert: alertProjection(value?.alert),
  }
}

/** Versioned full export with only explicitly approved fields. */
export function jsonExport(
  usage: ExportUsage,
  accounts: Record<string, unknown>[] = [],
  exportedAt = Date.now(),
) {
  const days = (Array.isArray(usage?.days) ? usage.days : [])
    .filter((entry) => entry !== null && typeof entry === 'object')
    .map((day) => ({
      date: stringOrNull(day.date),
      ...usageEntryProjection(day),
      models: (Array.isArray(day.models) ? day.models : [])
        .filter((entry) => entry !== null && typeof entry === 'object')
        .map((entry) => ({
          model: stringOrNull(entry.model),
          ...usageEntryProjection(entry),
        })),
    }))
  const sessions = (Array.isArray(usage?.sessions) ? usage.sessions : [])
    .filter((entry) => entry !== null && typeof entry === 'object')
    .map((session) => ({
      sessionId: stringOrNull(session.sessionId),
      title: stringOrNull(session.title),
      providers: Array.isArray(session.providers)
        ? session.providers.filter((entry) => typeof entry === 'string')
        : [],
      models: Array.isArray(session.models)
        ? session.models.filter((entry) => typeof entry === 'string')
        : [],
      ...usageEntryProjection(session),
      firstAt: stringOrNull(session.firstAt),
      lastAt: stringOrNull(session.lastAt),
    }))
  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date(exportedAt).toISOString(),
    usage: {
      updatedAt: finiteOrNull(usage?.updatedAt),
      total: usageEntryProjection(usage?.total),
      days,
      sessions,
      budgets: {
        currency: stringOrNull(usage?.budgets?.currency),
        daily: budgetWindowProjection(usage?.budgets?.daily),
        monthly: budgetWindowProjection(usage?.budgets?.monthly),
      },
    },
    accounts: (Array.isArray(accounts) ? accounts : []).map(accountProjection),
  }
}
