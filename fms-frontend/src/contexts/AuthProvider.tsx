import { useState, useEffect, useRef, useCallback, ReactNode } from 'react'
import { AuthContext, AuthContextType } from './AuthContext'
import { storage, checkSingleBrowserSession } from '../utils/storage'
import { STORAGE_KEYS } from '../utils/constants'
import { sessionApiCacheClearAll } from '../utils/sessionApiCache'
import { clearAmiGreetingSession } from '../utils/amiGreeting'
import { authApi } from '../api/auth'
import type { User } from '../types/auth'
import { normalizeUserSectionPermissions } from '../utils/helpers'
import { readStoredAuthSession } from '../utils/authSession'
import { markAuthBrowserSessionActive } from '../utils/authBrowserSession'
import { scheduleWhenIdle } from '../utils/warmupAfterLogin'

/** Refresh access token every 50 min so session does not expire until user logs out (JWT often expires in 1 hr). */
const PROACTIVE_REFRESH_INTERVAL_MS = 50 * 60 * 1000

interface AuthProviderProps {
  children: ReactNode
}

export const AuthProvider = ({ children }: AuthProviderProps) => {
  const stored = readStoredAuthSession()
  const [user, setUser] = useState<User | null>(stored.user)
  const [token, setToken] = useState<string | null>(stored.token)
  const [isLoading, setIsLoading] = useState(!stored.hasSession)
  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const doProactiveRefresh = useCallback(async () => {
    const result = await authApi.refresh()
    if (result?.access_token) {
      storage.setToken(result.access_token)
      setToken(result.access_token)
      if (result.refresh_token) storage.setRefreshToken(result.refresh_token)
    }
  }, [])

  // Proactive token refresh: keep session alive while user has not logged out
  useEffect(() => {
    if (!token || !user) {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current)
        refreshIntervalRef.current = null
      }
      return
    }
    const id = setInterval(doProactiveRefresh, PROACTIVE_REFRESH_INTERVAL_MS)
    refreshIntervalRef.current = id
    return () => {
      clearInterval(id)
      refreshIntervalRef.current = null
    }
  }, [token, user, doProactiveRefresh])

  // When user returns to tab, refresh once so idle tab stays logged in
  useEffect(() => {
    if (!token || !user) return
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') doProactiveRefresh()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [token, user, doProactiveRefresh])

  // Validate stored session after first paint — do not block dashboards on /users/me (memory: stale-while-revalidate).
  useEffect(() => {
    const validateSession = async () => {
      const storedToken = storage.getToken()
      const storedUser = storage.getUser()

      if (!storedToken || !storedUser) {
        setToken(null)
        setUser(null)
        setIsLoading(false)
        return
      }

      try {
        const response = await authApi.getCurrentUser()
        if (response.data) {
          if (response.data.is_active === false) {
            sessionApiCacheClearAll()
            storage.clear()
            setToken(null)
            setUser(null)
          } else {
            const merged = normalizeUserSectionPermissions(response.data)
            setUser(merged)
            storage.setUser(merged)
            const currentToken = storage.getToken()
            if (currentToken) setToken(currentToken)
          }
          return
        }

        const code = response.error?.code
        const msg = (response.error?.message || '').toLowerCase()

        const isNetworkOrUnreachable =
          code === 'NETWORK_ERROR' ||
          !code ||
          msg.includes('network error') ||
          msg.includes('timeout')

        const isTransientServer =
          code === '503' || code === '502' || code === '504' || (code?.startsWith('5') ?? false)

        if (isNetworkOrUnreachable || isTransientServer) {
          return
        }

        if (code === '403') {
          sessionApiCacheClearAll()
          storage.clear()
          setToken(null)
          setUser(null)
          return
        }

        if (code === '401') {
          const refreshed = await authApi.refresh()
          if (refreshed?.access_token) {
            storage.setToken(refreshed.access_token)
            if (refreshed.refresh_token) storage.setRefreshToken(refreshed.refresh_token)
            setToken(refreshed.access_token)
            const retry = await authApi.getCurrentUser()
            if (retry.data && retry.data.is_active !== false) {
              const merged = normalizeUserSectionPermissions(retry.data)
              setUser(merged)
              storage.setUser(merged)
              const ct = storage.getToken()
              if (ct) setToken(ct)
              return
            }
          }
          sessionApiCacheClearAll()
          storage.clear()
          setToken(null)
          setUser(null)
          return
        }

        if (code === '404') {
          sessionApiCacheClearAll()
          storage.clear()
          setToken(null)
          setUser(null)
        }
        // Other errors: keep cached session so a stray API issue does not force logout on reload
      } catch {
        // Unexpected: keep stored session
      }
    }

    const storedToken = storage.getToken()
    const storedUser = storage.getUser()

    if (!storedToken || !storedUser) {
      setToken(null)
      setUser(null)
      setIsLoading(false)
      return
    }

    setToken(storedToken)
    setUser(normalizeUserSectionPermissions(storedUser))
    setIsLoading(false)

    return scheduleWhenIdle(() => {
      void validateSession()
    })
  }, [])

  // Sync auth when another tab in the same session logs in or out (sessionStorage).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.storageArea !== sessionStorage) return
      if (e.key !== STORAGE_KEYS.AUTH_TOKEN && e.key !== STORAGE_KEYS.USER) return

      const nextToken = storage.getToken()
      const nextUser = storage.getUser()
      if (!nextToken || !nextUser) {
        sessionApiCacheClearAll()
        setToken(null)
        setUser(null)
        return
      }
      setToken(nextToken)
      setUser(normalizeUserSectionPermissions(nextUser))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const applySession = (newToken: string, newUser: User, refreshToken?: string) => {
    const merged = normalizeUserSectionPermissions(newUser)
    setToken(newToken)
    setUser(merged)
    storage.setToken(newToken)
    storage.setUser(merged)
    if (refreshToken) storage.setRefreshToken(refreshToken)
    markAuthBrowserSessionActive()
  }

  const login = (newToken: string, newUser: User, refreshToken?: string) => {
    const gate = checkSingleBrowserSession(newUser)
    if (!gate.ok) {
      throw new Error(gate.message)
    }
    applySession(newToken, newUser, refreshToken)
  }

  const logout = async () => {
    try {
      await authApi.logout()
    } catch (error) {
      console.error('Logout error:', error)
    } finally {
      sessionApiCacheClearAll()
      clearAmiGreetingSession()
      setToken(null)
      setUser(null)
      storage.clear()
    }
  }

  const register = (newToken: string, newUser: User, refreshToken?: string) => {
    const gate = checkSingleBrowserSession(newUser)
    if (!gate.ok) throw new Error(gate.message)
    applySession(newToken, newUser, refreshToken)
  }

  const verifyOTP = (newToken: string, newUser: User, refreshToken?: string) => {
    const gate = checkSingleBrowserSession(newUser)
    if (!gate.ok) throw new Error(gate.message)
    applySession(newToken, newUser, refreshToken)
    storage.removeOTPEmail()
  }

  const refreshUser = (updatedUser: User) => {
    const merged = normalizeUserSectionPermissions(updatedUser)
    setUser(merged)
    storage.setUser(merged)
  }

  const setLoading = (loading: boolean) => {
    setIsLoading(loading)
  }

  const value: AuthContextType = {
    user,
    token,
    isAuthenticated: !!token && !!user,
    isLoading,
    login,
    logout,
    register,
    verifyOTP,
    refreshUser,
    setLoading,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
