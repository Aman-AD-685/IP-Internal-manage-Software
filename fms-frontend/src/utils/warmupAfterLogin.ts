import { dashboardApi } from '../api/dashboard'
import { DASHBOARD_KPI_NAMES, prefetchDashboardKpiPerson, MONTHS } from '../api/dashboardKpi'
import { getDefaultPreviousWeekFilter } from '../pages/Dashboard/kpiWeekUtils'
import { prefetchRouteData } from './routePrefetch'
import { ROUTES } from './constants'

/** Defer work until after first paint (memory: do not compete with bootstrap). */
export function scheduleAfterFirstPaint(fn: () => void, delayMs = 2000): () => void {
  const id = window.setTimeout(fn, delayMs)
  return () => window.clearTimeout(id)
}

export function scheduleWhenIdle(fn: () => void, timeoutMs = 4000): () => void {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(() => fn(), { timeout: timeoutMs })
    return () => cancelIdleCallback(id)
  }
  const id = window.setTimeout(fn, Math.min(timeoutMs, 2500))
  return () => window.clearTimeout(id)
}

/**
 * Warm caches for the page the user is heading to (login → dashboard/tickets in ~1–2s).
 */
export function warmupAfterLogin(targetPath: string): void {
  const routeKey = targetPath.startsWith('/') ? targetPath : `/${targetPath}`
  void dashboardApi.getBootstrap().catch(() => {})
  prefetchRouteData(routeKey)
  const [path] = routeKey.split('?')
  if (path !== ROUTES.DASHBOARD) prefetchRouteData(ROUTES.DASHBOARD)
  if (!routeKey.includes(ROUTES.TICKETS)) {
    prefetchRouteData(`${ROUTES.TICKETS}?section=chores-bugs`)
  }
  if (path !== ROUTES.SUPPORT_DASHBOARD && path !== ROUTES.DASHBOARD) {
    prefetchRouteData(ROUTES.SUPPORT_DASHBOARD)
  }

  if (path === ROUTES.DASHBOARD_KPI || routeKey.includes(ROUTES.DASHBOARD_KPI)) {
    const prev = getDefaultPreviousWeekFilter()
    const filters = {
      month: MONTHS[prev.monthIndex] ?? MONTHS[0],
      year: prev.year,
      week: `week ${prev.week}`,
    }
    const personQ = new URLSearchParams(routeKey.includes('?') ? routeKey.slice(routeKey.indexOf('?') + 1) : '')
    const personRaw = personQ.get('person')?.trim()
    const match = personRaw
      ? DASHBOARD_KPI_NAMES.find((n) => n.toLowerCase() === personRaw.toLowerCase())
      : null
    if (match) {
      prefetchDashboardKpiPerson(match, filters)
    }
  }
}
