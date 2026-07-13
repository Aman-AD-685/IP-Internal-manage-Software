import { prefetchRouteChunk } from './routeChunkPrefetch'
import { prefetchRouteData } from './routePrefetch'
import { ROUTES } from './constants'
import type { User } from '../types/auth'
import { getDefaultLandingRoute } from './helpers'
import { dashboardApi } from '../api/dashboard'

/** Defer work until after first paint without blocking sub-750ms navigation. */
export function scheduleAfterFirstPaint(fn: () => void, delayMs = 150): () => void {
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
 * Warm caches for the page the user is heading to (login → dashboard in ~1–2s).
 * ponytail: summary only on dashboard — no KPI person fan-out on login.
 */
export function warmupAfterLogin(targetPath: string): void {
  const routeKey = targetPath.startsWith('/') ? targetPath : `/${targetPath}`
  prefetchRouteChunk(routeKey)
  const [path] = routeKey.split('?')
  if (path === ROUTES.DASHBOARD) {
    scheduleAfterFirstPaint(() => {
      void dashboardApi.getSummary().catch(() => {})
    }, 200)
    return
  }
  scheduleWhenIdle(() => prefetchRouteData(routeKey), 3000)
}

/** Warm default routes when user already has a session (reload / new tab). */
export function warmupRestoredSession(user: User): void {
  const landing = getDefaultLandingRoute(user)
  warmupAfterLogin(landing)
  scheduleWhenIdle(() => {
    prefetchRouteChunk(ROUTES.DASHBOARD)
    if (landing !== ROUTES.DASHBOARD) {
      prefetchRouteChunk(landing)
    }
  }, 3000)
}
