import { ROUTES } from './constants'

export const RECOVERY_TOKEN_STORAGE_KEY = 'fms_recovery_access_token'
export const RECOVERY_SESSION_STORAGE_KEY = 'fms_recovery_session'

export type RecoverySessionTokens = {
  access_token: string
  refresh_token?: string | null
}

function paramsFromHash(): URLSearchParams {
  const raw = (window.location.hash || '').replace(/^#/, '')
  return new URLSearchParams(raw)
}

function paramsFromSearch(): URLSearchParams {
  return new URLSearchParams(window.location.search)
}

function sessionFromParams(params: URLSearchParams): RecoverySessionTokens | null {
  const accessToken = params.get('access_token')
  if (!accessToken) return null
  const type = params.get('type')
  if (type && type !== 'recovery') return null
  return {
    access_token: accessToken,
    refresh_token: params.get('refresh_token'),
  }
}

/** Parse Supabase recovery tokens from hash or query (implicit redirect). */
export function parseRecoverySessionFromUrl(): RecoverySessionTokens | null {
  return sessionFromParams(paramsFromHash()) ?? sessionFromParams(paramsFromSearch())
}

export function parseRecoveryAccessTokenFromUrl(): string | null {
  return parseRecoverySessionFromUrl()?.access_token ?? null
}

export function hasRecoveryRedirectInUrl(): boolean {
  if (parseRecoverySessionFromUrl()) return true
  for (const params of [paramsFromHash(), paramsFromSearch()]) {
    const type = params.get('type')
    if (type === 'recovery' && (params.get('code') || params.get('token'))) return true
  }
  return false
}

export function saveRecoverySession(session: RecoverySessionTokens): void {
  try {
    sessionStorage.setItem(RECOVERY_SESSION_STORAGE_KEY, JSON.stringify(session))
    sessionStorage.setItem(RECOVERY_TOKEN_STORAGE_KEY, session.access_token)
  } catch {
    /* ignore */
  }
}

export function saveRecoveryAccessToken(token: string): void {
  saveRecoverySession({ access_token: token })
}

export function readStoredRecoverySession(): RecoverySessionTokens | null {
  try {
    const raw = sessionStorage.getItem(RECOVERY_SESSION_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as RecoverySessionTokens
      if (parsed?.access_token) return parsed
    }
    const legacy = sessionStorage.getItem(RECOVERY_TOKEN_STORAGE_KEY)
    if (legacy) return { access_token: legacy }
  } catch {
    /* ignore */
  }
  return null
}

export function readStoredRecoveryAccessToken(): string | null {
  return readStoredRecoverySession()?.access_token ?? null
}

export function clearStoredRecoveryAccessToken(): void {
  try {
    sessionStorage.removeItem(RECOVERY_TOKEN_STORAGE_KEY)
    sessionStorage.removeItem(RECOVERY_SESSION_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

/** Capture token from URL before React/auth runs; redirect to public reset page. */
export function bootstrapRecoveryFromUrl(): void {
  const fromUrl = parseRecoverySessionFromUrl()
  if (fromUrl) {
    saveRecoverySession(fromUrl)
  }
  redirectRecoveryToResetPage()
}

/** If Supabase lands on Site URL (/) with recovery tokens, send user to /reset-password. */
export function redirectRecoveryToResetPage(): void {
  if (window.location.pathname === ROUTES.RESET_PASSWORD) return
  if (!hasRecoveryRedirectInUrl() && !readStoredRecoverySession()) return
  const target = `${ROUTES.RESET_PASSWORD}${window.location.search}${window.location.hash}`
  window.location.replace(target)
}

export function clearRecoveryParamsFromUrl(): void {
  window.history.replaceState(null, '', window.location.pathname)
}

export function recoveryCodeFromUrl(): string | null {
  for (const params of [paramsFromSearch(), paramsFromHash()]) {
    const code = params.get('code')
    const type = params.get('type')
    if (code && (!type || type === 'recovery')) return code
  }
  return null
}

export function recoveryVerifyTokenFromUrl(): string | null {
  for (const params of [paramsFromSearch(), paramsFromHash()]) {
    const token = params.get('token')
    if (token && params.get('type') === 'recovery') return token
  }
  return null
}

export function isPublicPasswordResetPath(pathname: string): boolean {
  return pathname === ROUTES.RESET_PASSWORD || pathname === ROUTES.FORGOT_PASSWORD
}
