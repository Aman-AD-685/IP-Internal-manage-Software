import { ROUTES } from './constants'
import type { User } from '../types/auth'
import { getDefaultLandingRoute } from './helpers'

const PUBLIC_AUTH_PATHS = new Set([
  ROUTES.LOGIN,
  ROUTES.FORGOT_PASSWORD,
  ROUTES.REGISTER,
  ROUTES.RESET_PASSWORD,
  ROUTES.OTP,
  ROUTES.CONFIRMATION_SUCCESS,
])

/** Normalize in-app path (must start with /, no open redirect). */
export function normalizeReturnPath(path: string): string | null {
  const raw = (path || '').trim()
  if (!raw.startsWith('/')) return null
  if (raw.startsWith('//')) return null
  try {
    const u = new URL(raw, window.location.origin)
    if (u.origin !== window.location.origin) return null
    const p = u.pathname + u.search + u.hash
    if (PUBLIC_AUTH_PATHS.has(u.pathname)) return null
    return p || '/'
  } catch {
    return null
  }
}

export function currentReturnPath(): string {
  return window.location.pathname + window.location.search + window.location.hash
}

/** Login URL that returns user to the page they tried to open. */
export function buildLoginUrl(returnPath?: string): string {
  const target = normalizeReturnPath(returnPath || currentReturnPath())
  if (!target) return ROUTES.LOGIN
  return `${ROUTES.LOGIN}?redirect=${encodeURIComponent(target)}`
}

export function getRedirectFromSearch(search: string): string | null {
  try {
    const q = new URLSearchParams(search.startsWith('?') ? search : `?${search}`)
    const raw = q.get('redirect')
    if (!raw) return null
    return normalizeReturnPath(decodeURIComponent(raw))
  } catch {
    return null
  }
}

/** Where to send user after successful login (respects ?redirect=). */
export function getPostLoginPath(search: string, user: User): string {
  return getRedirectFromSearch(search) ?? getDefaultLandingRoute(user)
}

export function buildAppRouteUrl(route: string): string {
  const trimmed = (route || '').trim()
  if (!trimmed) return `${window.location.origin}/`
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  const qIndex = trimmed.indexOf('?')
  const hashIndex = trimmed.indexOf('#')
  const pathEnd = qIndex >= 0 ? qIndex : hashIndex >= 0 ? hashIndex : trimmed.length
  const pathPart = trimmed.slice(0, pathEnd) || '/'
  const rest = trimmed.slice(pathEnd)
  const path = pathPart.startsWith('/') ? pathPart : `/${pathPart}`
  return `${window.location.origin}${path}${rest}`
}
