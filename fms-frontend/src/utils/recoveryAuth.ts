import { ROUTES } from './constants'

export const RECOVERY_TOKEN_STORAGE_KEY = 'fms_recovery_access_token'

function paramsFromHash(): URLSearchParams {
  const raw = (window.location.hash || '').replace(/^#/, '')
  return new URLSearchParams(raw)
}

function paramsFromSearch(): URLSearchParams {
  return new URLSearchParams(window.location.search)
}

function accessTokenFromParams(params: URLSearchParams): string | null {
  const accessToken = params.get('access_token')
  if (!accessToken) return null
  const type = params.get('type')
  if (type && type !== 'recovery') return null
  return accessToken
}

/** Parse Supabase recovery access_token from hash or query (implicit redirect). */
export function parseRecoveryAccessTokenFromUrl(): string | null {
  return accessTokenFromParams(paramsFromHash()) ?? accessTokenFromParams(paramsFromSearch())
}

export function hasRecoveryRedirectInUrl(): boolean {
  if (parseRecoveryAccessTokenFromUrl()) return true
  for (const params of [paramsFromHash(), paramsFromSearch()]) {
    const type = params.get('type')
    if (type === 'recovery' && (params.get('code') || params.get('token'))) return true
  }
  return false
}

export function saveRecoveryAccessToken(token: string): void {
  try {
    sessionStorage.setItem(RECOVERY_TOKEN_STORAGE_KEY, token)
  } catch {
    /* ignore */
  }
}

export function readStoredRecoveryAccessToken(): string | null {
  try {
    return sessionStorage.getItem(RECOVERY_TOKEN_STORAGE_KEY)
  } catch {
    return null
  }
}

export function clearStoredRecoveryAccessToken(): void {
  try {
    sessionStorage.removeItem(RECOVERY_TOKEN_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

/** Capture token from URL before React/auth runs; redirect to public reset page. */
export function bootstrapRecoveryFromUrl(): void {
  const fromUrl = parseRecoveryAccessTokenFromUrl()
  if (fromUrl) {
    saveRecoveryAccessToken(fromUrl)
  }
  redirectRecoveryToResetPage()
}

/** If Supabase lands on Site URL (/) with recovery tokens, send user to /reset-password. */
export function redirectRecoveryToResetPage(): void {
  if (window.location.pathname === ROUTES.RESET_PASSWORD) return
  if (!hasRecoveryRedirectInUrl() && !readStoredRecoveryAccessToken()) return
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
