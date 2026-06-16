import { API_BASE_URL, PRODUCTION_API_FALLBACK } from '../api/axios'
import { isHttpLoopbackApiUrl } from './localBackend'

/** Build authenticated WebSocket URL (browser cannot set Authorization header on WS). */
export function resolveWebSocketUrl(token: string): string {
  const trimmed = (token || '').trim()
  if (!trimmed) return ''

  let wsBase: string
  const apiBase = (API_BASE_URL || '').replace(/\/+$/, '')

  if (typeof window !== 'undefined' && (apiBase === '/api' || apiBase.startsWith('/'))) {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    wsBase = `${proto}//${window.location.host}/api`
  } else if (apiBase.startsWith('http')) {
    const u = new URL(apiBase)
    const proto = u.protocol === 'https:' ? 'wss:' : 'ws:'
    const path = (u.pathname || '').replace(/\/+$/, '')
    wsBase = `${proto}//${u.host}${path}`
  } else if (isHttpLoopbackApiUrl(apiBase)) {
    const proto = 'ws:'
    wsBase = `${proto}//${apiBase.replace(/^https?:\/\//, '')}`
  } else {
    const fallback = PRODUCTION_API_FALLBACK.replace(/^https?:\/\//, '').replace(/\/+$/, '')
    wsBase = `wss://${fallback}`
  }

  return `${wsBase.replace(/\/+$/, '')}/ws?token=${encodeURIComponent(trimmed)}`
}
