import { STORAGE_KEYS } from './constants'
import { User } from '../types/auth'

/**
 * Auth (token, refresh, user) uses localStorage so every tab in this browser
 * shares one session — "Open in new tab" stays logged in.
 *
 * Only one user id per browser: login as a different account is blocked until logout.
 * OTP email stays in sessionStorage (tab-local).
 */

const AUTH_KEYS = [STORAGE_KEYS.AUTH_TOKEN, STORAGE_KEYS.REFRESH_TOKEN, STORAGE_KEYS.USER] as const

function getLocal(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function getSession(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

/** Move auth from old sessionStorage-only builds into localStorage once. */
let sessionAuthMigrated = false
function ensureSessionAuthMigratedToLocal(): void {
  if (sessionAuthMigrated) return
  sessionAuthMigrated = true
  const local = getLocal()
  const sess = getSession()
  if (!local || !sess) return
  try {
    for (const key of AUTH_KEYS) {
      if (local.getItem(key)) continue
      const fromSession = sess.getItem(key)
      if (fromSession) {
        local.setItem(key, fromSession)
        sess.removeItem(key)
      }
    }
  } catch {
    /* ignore */
  }
}

function clearAuthFromBothStorages(): void {
  try {
    for (const key of AUTH_KEYS) {
      getLocal()?.removeItem(key)
      getSession()?.removeItem(key)
    }
  } catch {
    /* ignore */
  }
}

export type SingleSessionCheck =
  | { ok: true }
  | { ok: false; message: string; currentUser: User }

/** Block logging in as another user while this browser already has a session. */
export function checkSingleBrowserSession(nextUser: User): SingleSessionCheck {
  ensureSessionAuthMigratedToLocal()
  const token = getLocal()?.getItem(STORAGE_KEYS.AUTH_TOKEN)
  const userStr = getLocal()?.getItem(STORAGE_KEYS.USER)
  if (!token || !userStr) return { ok: true }
  try {
    const current = JSON.parse(userStr) as User
    if (current?.id && nextUser?.id && current.id !== nextUser.id) {
      const who = current.full_name || current.email || 'another user'
      return {
        ok: false,
        message: `This browser is already signed in as ${who}. Log out first to use a different account.`,
        currentUser: current,
      }
    }
  } catch {
    return { ok: true }
  }
  return { ok: true }
}

export const storage = {
  getToken: (): string | null => {
    try {
      ensureSessionAuthMigratedToLocal()
      return getLocal()?.getItem(STORAGE_KEYS.AUTH_TOKEN) ?? null
    } catch {
      return null
    }
  },

  setToken: (token: string): void => {
    try {
      getLocal()?.setItem(STORAGE_KEYS.AUTH_TOKEN, token)
      getSession()?.removeItem(STORAGE_KEYS.AUTH_TOKEN)
    } catch (error) {
      console.error('Failed to save token:', error)
    }
  },

  removeToken: (): void => {
    try {
      getLocal()?.removeItem(STORAGE_KEYS.AUTH_TOKEN)
      getSession()?.removeItem(STORAGE_KEYS.AUTH_TOKEN)
    } catch (error) {
      console.error('Failed to remove token:', error)
    }
  },

  getRefreshToken: (): string | null => {
    try {
      ensureSessionAuthMigratedToLocal()
      return getLocal()?.getItem(STORAGE_KEYS.REFRESH_TOKEN) ?? null
    } catch {
      return null
    }
  },

  setRefreshToken: (token: string): void => {
    try {
      getLocal()?.setItem(STORAGE_KEYS.REFRESH_TOKEN, token)
      getSession()?.removeItem(STORAGE_KEYS.REFRESH_TOKEN)
    } catch (error) {
      console.error('Failed to save refresh token:', error)
    }
  },

  removeRefreshToken: (): void => {
    try {
      getLocal()?.removeItem(STORAGE_KEYS.REFRESH_TOKEN)
      getSession()?.removeItem(STORAGE_KEYS.REFRESH_TOKEN)
    } catch (error) {
      console.error('Failed to remove refresh token:', error)
    }
  },

  getUser: (): User | null => {
    try {
      ensureSessionAuthMigratedToLocal()
      const userStr = getLocal()?.getItem(STORAGE_KEYS.USER)
      return userStr ? JSON.parse(userStr) : null
    } catch {
      return null
    }
  },

  setUser: (user: User): void => {
    try {
      getLocal()?.setItem(STORAGE_KEYS.USER, JSON.stringify(user))
      getSession()?.removeItem(STORAGE_KEYS.USER)
    } catch (error) {
      console.error('Failed to save user:', error)
    }
  },

  removeUser: (): void => {
    try {
      getLocal()?.removeItem(STORAGE_KEYS.USER)
      getSession()?.removeItem(STORAGE_KEYS.USER)
    } catch (error) {
      console.error('Failed to remove user:', error)
    }
  },

  getOTPEmail: (): string | null => {
    try {
      return getSession()?.getItem(STORAGE_KEYS.OTP_EMAIL) ?? null
    } catch {
      return null
    }
  },

  setOTPEmail: (email: string): void => {
    try {
      getSession()?.setItem(STORAGE_KEYS.OTP_EMAIL, email)
    } catch (error) {
      console.error('Failed to save OTP email:', error)
    }
  },

  removeOTPEmail: (): void => {
    try {
      getSession()?.removeItem(STORAGE_KEYS.OTP_EMAIL)
    } catch (error) {
      console.error('Failed to remove OTP email:', error)
    }
  },

  clear: (): void => {
    storage.removeToken()
    storage.removeRefreshToken()
    storage.removeUser()
    storage.removeOTPEmail()
    clearAuthFromBothStorages()
  },
}
