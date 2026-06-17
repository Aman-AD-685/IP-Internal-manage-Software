/** Git SHA embedded at Vite build time — the JS bundle the user currently has loaded. */
export function getClientReleaseKey(): string {
  return (import.meta.env.VITE_APP_RELEASE_KEY || 'dev-local').trim()
}

/** Normalize release keys so 7- vs 8-char git SHAs compare equal (Vercel vs bump_app_release). */
export function normalizeReleaseKey(key: string | null | undefined): string {
  const k = (key || '').trim().toLowerCase()
  if (!k) return ''
  if (k === 'dev-local') return k
  if (/^[a-f0-9]{6,40}$/.test(k)) return k.slice(0, 7)
  return k
}

export function releaseKeysMatch(clientKey: string, serverKey: string): boolean {
  const a = normalizeReleaseKey(clientKey)
  const b = normalizeReleaseKey(serverKey)
  if (!a || !b) return false
  return a === b
}

export const APP_RELEASE_CHECK_EVENT = 'fms:check-app-release'
export const APP_RELEASE_WS_CONNECTED_EVENT = 'fms:ws-connected'

export function dispatchAppReleaseChanged(release?: {
  release_key: string
  title: string
  message: string
  is_active: boolean
}): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(APP_RELEASE_CHECK_EVENT, { detail: release }))
}

export function dispatchAppReleaseCheck(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(APP_RELEASE_CHECK_EVENT))
}
