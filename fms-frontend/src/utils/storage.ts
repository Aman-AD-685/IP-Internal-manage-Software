import { STORAGE_KEYS } from './constants'
import { User } from '../types/auth'
import { clearAuthBrowserSessionMarkers, syncAuthMirrorToSession } from './authBrowserSession'

/**
 * Browser-session auth: tokens in sessionStorage, mirrored to localStorage only while
 * the browser is open (multi-tab + pinned tabs). Closing the browser clears the mirror;
 * the next visit requires login. Manual logout is optional.
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

const BROWSER_SESSION_KEY = 'fms_browser_session'

/** Drop persisted auth from older builds when no active browser session mirror. */
let legacyLocalAuthCleared = false
function clearLegacyPersistedAuth(): void {
  if (legacyLocalAuthCleared) return
  legacyLocalAuthCleared = true
  try {
    const local = getLocal()
    if (local?.getItem(BROWSER_SESSION_KEY)) return
    for (const key of AUTH_KEYS) {
      local?.removeItem(key)
    }
  } catch {
    /* ignore */
  }
}

function mirrorAuthToLocal(key: string, value: string): void {
  try {
    getLocal()?.setItem(key, value)
  } catch {
    /* ignore */
  }
}

function removeAuthFromLocal(key: string): void {
  try {
    getLocal()?.removeItem(key)
  } catch {
    /* ignore */
  }
}

function getAuthStore(): Storage | null {
  clearLegacyPersistedAuth()
  syncAuthMirrorToSession()
  return getSession()
}

function clearAuthFromAllStorages(): void {
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

/** Block logging in as another user while this browser tab already has a session. */
export function checkSingleBrowserSession(nextUser: User): SingleSessionCheck {
  const store = getAuthStore()
  const token = store?.getItem(STORAGE_KEYS.AUTH_TOKEN)
  const userStr = store?.getItem(STORAGE_KEYS.USER)
  if (!token || !userStr) return { ok: true }
  try {
    const current = JSON.parse(userStr) as User
    if (current?.id && nextUser?.id && current.id !== nextUser.id) {
      const who = current.full_name || current.email || 'another user'
      return {
        ok: false,
        message: `This tab is already signed in as ${who}. Log out first to use a different account.`,
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
      return getAuthStore()?.getItem(STORAGE_KEYS.AUTH_TOKEN) ?? null
    } catch {
      return null
    }
  },

  setToken: (token: string): void => {
    try {
      getAuthStore()?.setItem(STORAGE_KEYS.AUTH_TOKEN, token)
      mirrorAuthToLocal(STORAGE_KEYS.AUTH_TOKEN, token)
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
      return getAuthStore()?.getItem(STORAGE_KEYS.REFRESH_TOKEN) ?? null
    } catch {
      return null
    }
  },

  setRefreshToken: (token: string): void => {
    try {
      getAuthStore()?.setItem(STORAGE_KEYS.REFRESH_TOKEN, token)
      mirrorAuthToLocal(STORAGE_KEYS.REFRESH_TOKEN, token)
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
      const userStr = getAuthStore()?.getItem(STORAGE_KEYS.USER)
      return userStr ? JSON.parse(userStr) : null
    } catch {
      return null
    }
  },

  setUser: (user: User): void => {
    try {
      const serialized = JSON.stringify(user)
      getAuthStore()?.setItem(STORAGE_KEYS.USER, serialized)
      mirrorAuthToLocal(STORAGE_KEYS.USER, serialized)
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
    clearAuthFromAllStorages()
    clearAuthBrowserSessionMarkers()
  },
}
