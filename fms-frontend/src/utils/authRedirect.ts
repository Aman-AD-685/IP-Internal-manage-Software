import { ROUTES } from './constants'

/** Login page only — post-login always lands on the default dashboard (not the prior page). */
export function buildLoginUrl(_returnPath?: string): string {
  return ROUTES.LOGIN
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
