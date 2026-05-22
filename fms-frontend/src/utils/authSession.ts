import { storage } from './storage'
import { normalizeUserSectionPermissions } from './helpers'
import type { User } from '../types/auth'

/** Read shared browser session synchronously (localStorage) for instant hydration in new tabs. */
export function readStoredAuthSession(): {
  token: string | null
  user: User | null
  hasSession: boolean
} {
  const token = storage.getToken()
  const rawUser = storage.getUser()
  if (!token || !rawUser) {
    return { token: null, user: null, hasSession: false }
  }
  try {
    const user = normalizeUserSectionPermissions(rawUser)
    return { token, user, hasSession: true }
  } catch {
    return { token: null, user: null, hasSession: false }
  }
}
