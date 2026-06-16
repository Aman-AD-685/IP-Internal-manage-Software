import apiClient from './axios'

export interface SystemLockStatus {
  is_locked: boolean
  reason: string | null
  locked_by: string | null
  locked_by_name: string | null
  locked_at: string | null
  unlocked_at: string | null
  updated_at: string | null
}

export interface SystemLockAuditRow {
  id: string
  action: string
  performed_by: string
  performer_email: string | null
  reason: string | null
  created_at: string
}

export const SYSTEM_LOCK_CHANGED_EVENT = 'fms:system-lock-changed'
export const LOCK_STATUS_STORAGE_KEY = 'fms_system_lock_status_v1'
const LOCK_SESSION_KEY = LOCK_STATUS_STORAGE_KEY

export function readCachedSystemLockStatus(): SystemLockStatus | null {
  if (typeof window === 'undefined') return null
  try {
    const raw =
      localStorage.getItem(LOCK_SESSION_KEY) || sessionStorage.getItem(LOCK_SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SystemLockStatus
    if (typeof parsed?.is_locked !== 'boolean') return null
    return parsed
  } catch {
    return null
  }
}

export function writeCachedSystemLockStatus(status: SystemLockStatus): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(LOCK_SESSION_KEY, JSON.stringify(status))
    sessionStorage.setItem(LOCK_SESSION_KEY, JSON.stringify(status))
  } catch {
    /* ignore quota */
  }
}

export function dispatchSystemLockChanged(status?: SystemLockStatus): void {
  if (typeof window === 'undefined') return
  if (status) writeCachedSystemLockStatus(status)
  window.dispatchEvent(new CustomEvent(SYSTEM_LOCK_CHANGED_EVENT, { detail: status }))
}

export const systemLockApi = {
  getStatus: async (): Promise<SystemLockStatus> => {
    const res = await apiClient.get<{ success: boolean; data: SystemLockStatus }>('/system-lock/status', {
      timeout: 12000,
    })
    return res.data?.data ?? { is_locked: false, reason: null, locked_by: null, locked_by_name: null, locked_at: null, unlocked_at: null, updated_at: null }
  },

  lock: async (reason: string): Promise<SystemLockStatus> => {
    const res = await apiClient.post<{ success: boolean; data: SystemLockStatus }>('/system-lock/lock', { reason })
    dispatchSystemLockChanged(res.data.data)
    return res.data.data
  },

  unlock: async (): Promise<SystemLockStatus> => {
    const res = await apiClient.post<{ success: boolean; data: SystemLockStatus }>('/system-lock/unlock')
    dispatchSystemLockChanged(res.data.data)
    return res.data.data
  },

  listAudit: async (limit = 25): Promise<SystemLockAuditRow[]> => {
    const res = await apiClient.get<{ success: boolean; items: SystemLockAuditRow[] }>('/system-lock/audit', {
      params: { limit },
    })
    return res.data?.items ?? []
  },
}

export function isSystemLockedError(err: unknown): boolean {
  const status = (err as { response?: { status?: number } })?.response?.status
  const code = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
  return status === 423 || code === 'SYSTEM_LOCKED'
}

export function systemLockedReasonFromError(err: unknown): string | null {
  const reason = (err as { response?: { data?: { reason?: string } } })?.response?.data?.reason
  return typeof reason === 'string' && reason.trim() ? reason.trim() : null
}
