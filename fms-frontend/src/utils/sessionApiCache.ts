import { storage } from './storage'

/**
 * Session-scoped API response cache (sessionStorage, same tab / browser session as auth).
 * Reduces repeat GET traffic; TTLs are conservative to limit stale UI.
 */
const PREFIX = 'fms_api_cache:v1'

type CacheEnvelope = { exp: number; payload: unknown }

export const API_CACHE_TTL_MS = {
  dashboardMetrics: 8 * 60 * 1000,
  dashboardTrends: 8 * 60 * 1000,
  dashboardDetail: 60 * 1000,
  dashboardPaymentActions: 60 * 1000,
  dashboardSuccessKpi: 5 * 60 * 1000,
  dashboardSuccessPerformanceList: 2 * 60 * 1000,
  dashboardActivity: 60 * 1000,
  dashboardKpi: 8 * 60 * 1000,
  dashboardSoumyaKpi: 8 * 60 * 1000,
  ticketsList: 3 * 60 * 1000,
  leadsListActive: 90 * 1000,
  ticketGet: 30 * 1000,
  supportCompanies: 30 * 60 * 1000,
  supportPages: 30 * 60 * 1000,
  supportDivisions: 15 * 60 * 1000,
  usersList: 60 * 1000,
  usersRoles: 5 * 60 * 1000,
  onboardingPaymentStatusList: 90 * 1000,
  trainingClientsList: 90 * 1000,
  trainingUsers: 5 * 60 * 1000,
  delegationTasks: 60 * 1000,
  delegationUsers: 5 * 60 * 1000,
  checklistTasks: 60 * 1000,
  checklistOccurrences: 45 * 1000,
  checklistUsers: 5 * 60 * 1000,
  checklistDepartments: 30 * 60 * 1000,
  dbClientOnbList: 90 * 1000,
  leadsList: 90 * 1000,
  leadsUsers: 5 * 60 * 1000,
  leadsStages: 5 * 60 * 1000,
} as const

function sessionStore(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function userSegment(): string {
  try {
    const u = storage.getUser()
    return u?.id ? String(u.id) : 'anon'
  } catch {
    return 'anon'
  }
}

function fullKey(logicalKey: string): string {
  return `${PREFIX}:${userSegment()}:${logicalKey}`
}

export function sessionApiCacheGet<T>(logicalKey: string): T | null {
  const ss = sessionStore()
  if (!ss) return null
  try {
    const raw = ss.getItem(fullKey(logicalKey))
    if (!raw) return null
    const env = JSON.parse(raw) as CacheEnvelope
    if (typeof env.exp !== 'number' || !('payload' in env)) {
      ss.removeItem(fullKey(logicalKey))
      return null
    }
    if (Date.now() > env.exp) {
      ss.removeItem(fullKey(logicalKey))
      return null
    }
    return env.payload as T
  } catch {
    return null
  }
}

export function sessionApiCacheSet(logicalKey: string, payload: unknown, ttlMs: number): void {
  const ss = sessionStore()
  if (!ss) return
  try {
    const env: CacheEnvelope = { exp: Date.now() + ttlMs, payload }
    ss.setItem(fullKey(logicalKey), JSON.stringify(env))
  } catch {
    // Quota or private mode — ignore
  }
}

export function sessionApiCacheRemove(logicalKey: string): void {
  sessionStore()?.removeItem(fullKey(logicalKey))
}

/** Remove all cached entries for the current user whose logical key starts with `logicalPrefix`. */
export function sessionApiCacheClearLogicalPrefix(logicalPrefix: string): void {
  const ss = sessionStore()
  if (!ss) return
  const seg = userSegment()
  const start = `${PREFIX}:${seg}:${logicalPrefix}`
  const toRemove: string[] = []
  for (let i = 0; i < ss.length; i++) {
    const k = ss.key(i)
    if (k && k.startsWith(start)) toRemove.push(k)
  }
  toRemove.forEach((k) => ss.removeItem(k))
}

/** Clear every API cache entry for this tab (e.g. on logout). */
export function sessionApiCacheClearAll(): void {
  const ss = sessionStore()
  if (!ss) return
  const toRemove: string[] = []
  for (let i = 0; i < ss.length; i++) {
    const k = ss.key(i)
    if (k?.startsWith(`${PREFIX}:`)) toRemove.push(k)
  }
  toRemove.forEach((k) => ss.removeItem(k))
}

function stableValue(v: unknown): unknown {
  if (Array.isArray(v)) {
    return [...v].map((x) => String(x)).filter(Boolean).sort()
  }
  return v
}

function stableParamsKey(params: unknown): string {
  if (params == null || typeof params !== 'object') return 'default'
  const o = params as Record<string, unknown>
  const keys = Object.keys(o).sort()
  const norm: Record<string, unknown> = {}
  for (const k of keys) {
    const v = o[k]
    if (v === undefined || v === null || v === '') continue
    norm[k] = stableValue(v)
  }
  return JSON.stringify(norm)
}

export function genericLogicalKey(prefix: string, params?: object): string {
  return `${prefix}:${stableParamsKey(params)}`
}

export function ticketsListLogicalKey(params?: object): string {
  return `tickets:list:${stableParamsKey(params)}`
}

export function ticketGetLogicalKey(id: string): string {
  return `tickets:get:${id}`
}

export function supportDivisionsLogicalKey(companyId?: string): string {
  return `support:divisions:v5:${companyId || 'none'}`
}

export function invalidateAfterTicketMutation(ticketId?: string): void {
  sessionApiCacheClearLogicalPrefix('tickets:list:')
  sessionApiCacheClearLogicalPrefix('dashboard:')
  if (ticketId) sessionApiCacheRemove(ticketGetLogicalKey(ticketId))
}

/** Other browser tabs listen for this key (storage event) to drop cached dashboard metrics. */
export const DASHBOARD_CROSS_TAB_BUMP_KEY = 'fms:dashboard:metrics:bump'

export function invalidateAfterDashboardPaymentSubmit(): void {
  sessionApiCacheClearLogicalPrefix('dashboard:')
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(DASHBOARD_CROSS_TAB_BUMP_KEY, String(Date.now()))
    }
  } catch {
    /* private mode / quota */
  }
}

/** Success Performance NA toggle — refresh Success dashboard KPI and performance lists. */
export function invalidateAfterPerformanceNaChange(): void {
  sessionApiCacheClearLogicalPrefix('dashboard:')
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(DASHBOARD_CROSS_TAB_BUMP_KEY, String(Date.now()))
    }
  } catch {
    /* private mode / quota */
  }
}
