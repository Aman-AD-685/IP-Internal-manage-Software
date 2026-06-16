import { STORAGE_KEYS } from './constants'

/** Survives only across a full page reload in the same tab (not a new navigation after browser close). */
const RELOAD_BACKUP_KEY = 'fms_auth_reload_backup'
const BROWSER_SESSION_KEY = 'fms_browser_session'
const TAB_COUNT_KEY = 'fms_tab_count'
const HEARTBEAT_KEY = 'fms_session_heartbeat'

const HEARTBEAT_INTERVAL_MS = 3_000
/** Production: if no tab pinged recently, treat browser as closed and clear auth. */
const HEARTBEAT_STALE_MS = import.meta.env.PROD ? 12_000 : 120_000

const AUTH_KEYS = [STORAGE_KEYS.AUTH_TOKEN, STORAGE_KEYS.REFRESH_TOKEN, STORAGE_KEYS.USER] as const

type ReloadBackup = {
  auth_token: string
  refresh_token: string | null
  user: string
  browser_session: string
}

function getSession(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function getLocal(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function newBrowserSessionId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function isReloadNavigation(): boolean {
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    return nav?.type === 'reload'
  } catch {
    return false
  }
}

function touchHeartbeat(): void {
  getLocal()?.setItem(HEARTBEAT_KEY, String(Date.now()))
}

function clearHeartbeat(): void {
  getLocal()?.removeItem(HEARTBEAT_KEY)
}

function isHeartbeatFresh(): boolean {
  const raw = getLocal()?.getItem(HEARTBEAT_KEY)
  if (!raw) return false
  const ts = parseInt(raw, 10)
  if (!Number.isFinite(ts)) return false
  return Date.now() - ts < HEARTBEAT_STALE_MS
}

function readReloadBackup(): ReloadBackup | null {
  const raw = getSession()?.getItem(RELOAD_BACKUP_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as ReloadBackup
  } catch {
    return null
  }
}

function writeReloadBackup(): void {
  const session = getSession()
  if (!session) return
  const auth_token = session.getItem(STORAGE_KEYS.AUTH_TOKEN)
  const user = session.getItem(STORAGE_KEYS.USER)
  if (!auth_token || !user) {
    session.removeItem(RELOAD_BACKUP_KEY)
    return
  }
  const payload: ReloadBackup = {
    auth_token,
    refresh_token: session.getItem(STORAGE_KEYS.REFRESH_TOKEN),
    user,
    browser_session: session.getItem(BROWSER_SESSION_KEY) || '',
  }
  session.setItem(RELOAD_BACKUP_KEY, JSON.stringify(payload))
}

function clearReloadBackup(): void {
  getSession()?.removeItem(RELOAD_BACKUP_KEY)
}

function clearAuthKeysInSession(): void {
  const session = getSession()
  if (!session) return
  for (const key of AUTH_KEYS) {
    session.removeItem(key)
  }
}

function restoreReloadBackup(): boolean {
  const backup = readReloadBackup()
  clearReloadBackup()
  if (!backup?.auth_token || !backup.user) return false

  const session = getSession()
  const local = getLocal()
  if (!session) return false

  session.setItem(STORAGE_KEYS.AUTH_TOKEN, backup.auth_token)
  session.setItem(STORAGE_KEYS.USER, backup.user)
  if (backup.refresh_token) {
    session.setItem(STORAGE_KEYS.REFRESH_TOKEN, backup.refresh_token)
  } else {
    session.removeItem(STORAGE_KEYS.REFRESH_TOKEN)
  }
  if (backup.browser_session) {
    session.setItem(BROWSER_SESSION_KEY, backup.browser_session)
    local?.setItem(BROWSER_SESSION_KEY, backup.browser_session)
  }
  touchHeartbeat()
  return true
}

function clearMirroredAuthInLocal(): void {
  const local = getLocal()
  if (!local) return
  for (const key of AUTH_KEYS) {
    local.removeItem(key)
  }
}

/** Drop mirrored auth when the browser was fully closed (no session marker). */
function clearStaleMirroredAuth(): void {
  const local = getLocal()
  if (!local) return
  if (!local.getItem(BROWSER_SESSION_KEY)) {
    clearMirroredAuthInLocal()
    clearHeartbeat()
  }
}

/**
 * Production: if auth exists but no tab has heartbeat recently, browser was closed — wipe session.
 * Also clears mirror when session markers were removed on last tab close.
 */
function clearStaleSessionAfterBrowserClose(): void {
  const local = getLocal()
  if (!local) return

  const hasLocalAuth = !!local.getItem(STORAGE_KEYS.AUTH_TOKEN)
  if (!hasLocalAuth) return

  if (import.meta.env.PROD && !isHeartbeatFresh()) {
    clearAuthBrowserSessionMarkers()
    clearAuthKeysInSession()
    clearReloadBackup()
    return
  }

  if (!local.getItem(BROWSER_SESSION_KEY)) {
    clearMirroredAuthInLocal()
    clearHeartbeat()
  }
}

/** Copy mirrored auth from localStorage into this tab's sessionStorage. */
export function syncAuthMirrorToSession(): void {
  const session = getSession()
  const local = getLocal()
  if (!session || !local) return

  const marker = local.getItem(BROWSER_SESSION_KEY)
  if (!marker) {
    clearAuthKeysInSession()
    session.removeItem(BROWSER_SESSION_KEY)
    return
  }

  if (import.meta.env.PROD && !isHeartbeatFresh()) {
    clearAuthKeysInSession()
    session.removeItem(BROWSER_SESSION_KEY)
    return
  }

  for (const key of AUTH_KEYS) {
    const value = local.getItem(key)
    if (value) session.setItem(key, value)
    else session.removeItem(key)
  }
  session.setItem(BROWSER_SESSION_KEY, marker)
}

/** New tab: copy auth from localStorage mirror when another tab is still signed in. */
function hydrateAuthFromActiveBrowserSession(): void {
  const session = getSession()
  if (!session) return
  if (session.getItem(STORAGE_KEYS.AUTH_TOKEN)) return

  const local = getLocal()
  if (!local?.getItem(BROWSER_SESSION_KEY)) return

  if (import.meta.env.PROD && !isHeartbeatFresh()) {
    clearAuthBrowserSessionMarkers()
    return
  }

  const tabCount = parseInt(local.getItem(TAB_COUNT_KEY) || '0', 10) || 0
  if (tabCount < 1) return

  syncAuthMirrorToSession()
}

function clearStaleAuthAfterBrowserClose(): void {
  const session = getSession()
  const local = getLocal()
  if (!session) return

  const hasToken = !!session.getItem(STORAGE_KEYS.AUTH_TOKEN)
  const sessionMarker = session.getItem(BROWSER_SESSION_KEY)
  const localMarker = local?.getItem(BROWSER_SESSION_KEY)

  if (!hasToken) {
    clearReloadBackup()
    if (local?.getItem(STORAGE_KEYS.AUTH_TOKEN) && import.meta.env.PROD && !isHeartbeatFresh()) {
      clearAuthBrowserSessionMarkers()
    }
    return
  }

  if (!localMarker || !sessionMarker || localMarker !== sessionMarker) {
    clearAuthKeysInSession()
    clearReloadBackup()
    clearMirroredAuthInLocal()
    clearHeartbeat()
  }
}

function bumpOpenTabCount(): void {
  const local = getLocal()
  if (!local) return
  const next = (parseInt(local.getItem(TAB_COUNT_KEY) || '0', 10) || 0) + 1
  local.setItem(TAB_COUNT_KEY, String(next))
}

function decrementOpenTabCount(): void {
  const local = getLocal()
  if (!local) return
  const next = Math.max(0, (parseInt(local.getItem(TAB_COUNT_KEY) || '1', 10) || 1) - 1)
  local.setItem(TAB_COUNT_KEY, String(next))
  if (next === 0) {
    local.removeItem(BROWSER_SESSION_KEY)
    clearMirroredAuthInLocal()
    clearHeartbeat()
  }
}

/** Existing tab after deploy: push session auth into local mirror if missing. */
function ensureAuthMirroredToLocal(): void {
  const session = getSession()
  const local = getLocal()
  if (!session || !local) return
  if (!local.getItem(BROWSER_SESSION_KEY)) return
  if (local.getItem(STORAGE_KEYS.AUTH_TOKEN)) return

  const token = session.getItem(STORAGE_KEYS.AUTH_TOKEN)
  if (!token) return

  for (const key of AUTH_KEYS) {
    const value = session.getItem(key)
    if (value) local.setItem(key, value)
  }
}

let handlersInstalled = false
let heartbeatTimer: number | null = null

function hasSignedInStorage(): boolean {
  return !!(
    getSession()?.getItem(STORAGE_KEYS.AUTH_TOKEN) || getLocal()?.getItem(STORAGE_KEYS.AUTH_TOKEN)
  )
}

function startAuthSessionHeartbeatIfSignedIn(): void {
  if (!hasSignedInStorage()) {
    stopAuthSessionHeartbeat()
    return
  }
  if (heartbeatTimer != null) return
  touchHeartbeat()
  heartbeatTimer = window.setInterval(() => {
    if (hasSignedInStorage()) {
      touchHeartbeat()
    } else {
      stopAuthSessionHeartbeat()
    }
  }, HEARTBEAT_INTERVAL_MS)
}

function stopAuthSessionHeartbeat(): void {
  if (heartbeatTimer != null) {
    window.clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

/**
 * Call once before React mounts. Ensures closing the browser (all tabs) ends the session;
 * F5 / reload in the same tab keeps the user signed in.
 */
export function bootstrapAuthBrowserSession(): void {
  if (typeof window === 'undefined') return

  if (!isReloadNavigation()) {
    clearStaleSessionAfterBrowserClose()
  }

  bumpOpenTabCount()
  clearStaleMirroredAuth()

  if (isReloadNavigation()) {
    restoreReloadBackup()
    ensureAuthMirroredToLocal()
    startAuthSessionHeartbeatIfSignedIn()
    return
  }

  hydrateAuthFromActiveBrowserSession()
  ensureAuthMirroredToLocal()
  clearStaleAuthAfterBrowserClose()
  startAuthSessionHeartbeatIfSignedIn()
}

/** Mark a new signed-in browser run (login / register / OTP). */
export function markAuthBrowserSessionActive(): void {
  const session = getSession()
  const local = getLocal()
  if (!session || !local) return
  const id = newBrowserSessionId()
  session.setItem(BROWSER_SESSION_KEY, id)
  local.setItem(BROWSER_SESSION_KEY, id)
  const count = parseInt(local.getItem(TAB_COUNT_KEY) || '0', 10) || 0
  if (count < 1) {
    local.setItem(TAB_COUNT_KEY, '1')
  }
  touchHeartbeat()
  startAuthSessionHeartbeatIfSignedIn()
}

export function clearAuthBrowserSessionMarkers(): void {
  getSession()?.removeItem(BROWSER_SESSION_KEY)
  getLocal()?.removeItem(BROWSER_SESSION_KEY)
  getLocal()?.setItem(TAB_COUNT_KEY, '0')
  clearMirroredAuthInLocal()
  clearReloadBackup()
  clearHeartbeat()
  stopAuthSessionHeartbeat()
}

export function installAuthBrowserSessionHandlers(): void {
  if (handlersInstalled || typeof window === 'undefined') return
  handlersInstalled = true

  window.addEventListener('pagehide', (event) => {
    if (event.persisted) return
    writeReloadBackup()
    clearAuthKeysInSession()
    decrementOpenTabCount()
  })

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && hasSignedInStorage()) {
      touchHeartbeat()
    }
  })
}
