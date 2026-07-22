import { STORAGE_KEYS } from './constants'

/**
 * Browser-session auth (industry pattern for internal SaaS):
 * - Stay signed in while the browser is open (all tabs, pinned tabs, F5 reload).
 * - Closing the entire browser clears auth; next visit requires login again.
 * - Manual logout remains optional; security is enforced on browser close.
 *
 * sessionStorage = per-tab; localStorage mirror = cross-tab while browser run is active.
 */
const RELOAD_BACKUP_KEY = 'fms_auth_reload_backup'
const BROWSER_SESSION_KEY = 'fms_browser_session'
const TAB_COUNT_KEY = 'fms_tab_count'
const HEARTBEAT_KEY = 'fms_session_heartbeat'
const UNLOAD_AT_KEY = 'fms_unload_at'
const LIVE_CHANNEL = 'fms_auth_tab_live'

const HEARTBEAT_INTERVAL_MS = 4_000
/** Used only to decide multi-tab hydrate while a confirmed peer may be throttled. */
const HEARTBEAT_STALE_MS = 25_000
/** Wait for another open tab that already confirmed this browser run. */
const PEER_PROBE_MS = 300
/** F5 pagehide→load is near-instant; Chrome session restore is not. */
const RELOAD_UNLOAD_MAX_MS = 5_000

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

function isRecentUnloadForReload(): boolean {
  const raw = getLocal()?.getItem(UNLOAD_AT_KEY)
  if (!raw) return false
  const ts = parseInt(raw, 10)
  if (!Number.isFinite(ts)) return false
  return Date.now() - ts < RELOAD_UNLOAD_MAX_MS
}

function markUnloadAt(): void {
  getLocal()?.setItem(UNLOAD_AT_KEY, String(Date.now()))
}

function clearUnloadAt(): void {
  getLocal()?.removeItem(UNLOAD_AT_KEY)
}

function isReloadNavigation(): boolean {
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    return nav?.type === 'reload'
  } catch {
    return false
  }
}

function readTabCount(): number {
  return parseInt(getLocal()?.getItem(TAB_COUNT_KEY) || '0', 10) || 0
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

function clearAllAuthStorage(): void {
  clearAuthKeysInSession()
  clearMirroredAuthInLocal()
  clearReloadBackup()
  clearHeartbeat()
  clearUnloadAt()
  getSession()?.removeItem(BROWSER_SESSION_KEY)
  getLocal()?.removeItem(BROWSER_SESSION_KEY)
  getLocal()?.setItem(TAB_COUNT_KEY, '0')
  stopAuthSessionHeartbeat()
  browserRunConfirmed = false
}

/**
 * In-memory only — Chrome "Continue where you left off" / pinned-tab restore can bring
 * back sessionStorage+localStorage, but this flag resets every real JS start.
 * Only a confirmed live tab may answer peer pings (so restored tabs don't keep each other alive).
 */
let browserRunConfirmed = false

function confirmBrowserRun(): void {
  browserRunConfirmed = true
}

/** Another tab still running JS in this browser? (survives sleep better than heartbeat alone). */
function probePeerTabsAlive(): Promise<boolean> {
  if (typeof BroadcastChannel === 'undefined') return Promise.resolve(false)
  return new Promise((resolve) => {
    const ch = new BroadcastChannel(LIVE_CHANNEL)
    let settled = false
    const finish = (alive: boolean) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      try {
        ch.close()
      } catch {
        /* ignore */
      }
      resolve(alive)
    }
    const timer = window.setTimeout(() => finish(false), PEER_PROBE_MS)
    ch.onmessage = (ev: MessageEvent<{ type?: string }>) => {
      if (ev.data?.type === 'pong') finish(true)
    }
    try {
      ch.postMessage({ type: 'ping' })
    } catch {
      finish(false)
    }
  })
}

/**
 * Browser was fully closed (all tabs, including pinned): require login on next open.
 * Chrome may restore sessionStorage after quit — never treat restored tokens as a live run
 * unless a peer that already confirmed this browser process answers.
 * F5 skips this (caller).
 */
async function clearStaleSessionAfterBrowserClose(): Promise<void> {
  const local = getLocal()
  if (!local) return

  const hasLocalAuth = !!local.getItem(STORAGE_KEYS.AUTH_TOKEN)
  const hasSessionAuth = !!getSession()?.getItem(STORAGE_KEYS.AUTH_TOKEN)
  const marker = local.getItem(BROWSER_SESSION_KEY)
  const tabCountBeforeOpen = readTabCount()
  const hasResidue =
    hasLocalAuth || hasSessionAuth || tabCountBeforeOpen !== 0 || !!marker || !!local.getItem(HEARTBEAT_KEY)

  if (!hasResidue) return

  // Live peer already confirmed in this browser process (multi-tab / sleep).
  if (await probePeerTabsAlive()) {
    confirmBrowserRun()
    return
  }

  // No confirmed peer: cold reopen after close/kill, or Chrome pinned-tab session restore.
  clearAllAuthStorage()
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

  for (const key of AUTH_KEYS) {
    const value = local.getItem(key)
    if (value) session.setItem(key, value)
    else session.removeItem(key)
  }
  session.setItem(BROWSER_SESSION_KEY, marker)
}

/** New tab while browser still open: hydrate from mirror when another tab is signed in. */
function hydrateAuthFromActiveBrowserSession(): void {
  const session = getSession()
  if (!session || session.getItem(STORAGE_KEYS.AUTH_TOKEN)) return

  const local = getLocal()
  if (!local?.getItem(BROWSER_SESSION_KEY)) return

  const tabCountBeforeOpen = readTabCount()
  if (tabCountBeforeOpen < 1 && !isHeartbeatFresh()) return

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
  local.setItem(TAB_COUNT_KEY, String(readTabCount() + 1))
}

function decrementOpenTabCount(): void {
  const local = getLocal()
  if (!local) return
  const next = Math.max(0, readTabCount() - 1)
  local.setItem(TAB_COUNT_KEY, String(next))
  if (next === 0) {
    local.removeItem(BROWSER_SESSION_KEY)
    clearMirroredAuthInLocal()
    clearHeartbeat()
  }
}

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
 * Call once before React mounts (await so cold-open clear finishes first).
 * F5 reload keeps login; closing browser (all tabs / pinned) ends session.
 */
export async function bootstrapAuthBrowserSession(): Promise<void> {
  if (typeof window === 'undefined') return

  const isReload = isReloadNavigation()
  const recentUnload = isRecentUnloadForReload()

  if (!isReload || !recentUnload) {
    // Not a true F5 (incl. Chrome pinned-tab / session restore that may report reload).
    clearReloadBackup()
    await clearStaleSessionAfterBrowserClose()
  }

  bumpOpenTabCount()
  if (!getLocal()?.getItem(BROWSER_SESSION_KEY)) {
    clearMirroredAuthInLocal()
    clearHeartbeat()
  }

  if (isReload && recentUnload) {
    restoreReloadBackup()
    ensureAuthMirroredToLocal()
    clearUnloadAt()
    if (hasSignedInStorage()) confirmBrowserRun()
    startAuthSessionHeartbeatIfSignedIn()
    return
  }

  clearUnloadAt()
  hydrateAuthFromActiveBrowserSession()
  ensureAuthMirroredToLocal()
  clearStaleAuthAfterBrowserClose()
  if (hasSignedInStorage()) confirmBrowserRun()
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
  if (readTabCount() < 1) {
    local.setItem(TAB_COUNT_KEY, '1')
  }
  touchHeartbeat()
  confirmBrowserRun()
  startAuthSessionHeartbeatIfSignedIn()
}

export function clearAuthBrowserSessionMarkers(): void {
  clearAllAuthStorage()
}

export function installAuthBrowserSessionHandlers(): void {
  if (handlersInstalled || typeof window === 'undefined') return
  handlersInstalled = true

  // Fires when tab/window closes, including pinned tabs when the browser exits.
  window.addEventListener('pagehide', (event) => {
    if (event.persisted) return
    markUnloadAt()
    writeReloadBackup()
    clearAuthKeysInSession()
    decrementOpenTabCount()
  })

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && browserRunConfirmed && hasSignedInStorage()) {
      touchHeartbeat()
    }
  })

  window.addEventListener('focus', () => {
    if (browserRunConfirmed && hasSignedInStorage()) touchHeartbeat()
  })

  if (typeof BroadcastChannel !== 'undefined') {
    const liveCh = new BroadcastChannel(LIVE_CHANNEL)
    liveCh.onmessage = (ev: MessageEvent<{ type?: string }>) => {
      // Restored pinned tabs have storage but browserRunConfirmed=false — must not pong.
      if (ev.data?.type === 'ping' && browserRunConfirmed && hasSignedInStorage()) {
        try {
          liveCh.postMessage({ type: 'pong' })
        } catch {
          /* ignore */
        }
      }
    }
  }
}
