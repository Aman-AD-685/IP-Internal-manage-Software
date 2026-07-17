import { apiClient } from './axios'
import {
  API_CACHE_TTL_MS,
  genericLogicalKey,
  sessionApiCacheClearLogicalPrefix,
  sessionApiCacheGet,
  sessionApiCacheSet,
} from '../utils/sessionApiCache'

export const DEPARTMENTS = [
  'Customer Support & Success',
  'Marketing',
  'Accounts & Admin',
  'Internal Development',
] as const

export const FREQUENCY_OPTIONS = [
  { value: 'D', label: 'D - Daily' },
  { value: '2D', label: '2D - Every 2 days' },
  { value: 'W', label: 'W - Weekly' },
  { value: '2W', label: '2W - Every 2 weeks' },
  { value: 'M', label: 'M - Monthly' },
  { value: 'Q', label: 'Q - Quarterly' },
  { value: 'F', label: 'F - Half-yearly' },
  { value: 'Y', label: 'Y - Yearly' },
] as const

export interface ChecklistTask {
  id: string
  task_name: string
  doer_id: string
  doer_name?: string
  department: string
  frequency: string
  start_date: string
  created_by: string
  created_at: string
  reference_no?: string
}

export interface ChecklistOccurrence {
  task_id: string
  task_name: string
  reference_no?: string
  doer_id: string
  doer_name?: string
  department: string
  occurrence_date: string
  completed_at: string | null
}

/** One row per checklist task in NA_Checklist (universal Mark NA). */
export interface ChecklistNaTask {
  task_id: string
  task_name: string
  reference_no?: string
  department: string
  doer_id: string
  doer_name?: string
  pending_count: number
  has_today?: boolean
  has_overdue?: boolean
  has_upcoming?: boolean
}

export const checklistApi = {
  getDepartments: async () => {
    const key = 'checklist:departments'
    const cached = sessionApiCacheGet<{ departments: string[] }>(key)
    if (cached) return cached
    const r = await apiClient.get<{ departments: string[] }>('/checklist/departments')
    sessionApiCacheSet(key, r.data, API_CACHE_TTL_MS.checklistDepartments)
    return r.data
  },

  getHolidays: (year: number) =>
    apiClient.get<{ holidays: { holiday_date: string; holiday_name: string }[] }>(`/checklist/holidays?year=${year}`).then((r) => r.data),

  getTasks: (userId?: string, referenceNo?: string) => {
    const params = new URLSearchParams()
    if (userId) params.set('user_id', userId)
    if (referenceNo) params.set('reference_no', referenceNo)
    const q = params.toString()
    const key = genericLogicalKey('checklist:tasks', { user_id: userId, reference_no: referenceNo })
    const cached = sessionApiCacheGet<{ tasks: ChecklistTask[] }>(key)
    if (cached) return Promise.resolve(cached)
    return apiClient.get<{ tasks: ChecklistTask[] }>(`/checklist/tasks${q ? `?${q}` : ''}`).then((r) => {
      sessionApiCacheSet(key, r.data, API_CACHE_TTL_MS.checklistTasks)
      return r.data
    })
  },

  getOccurrences: (filter: 'today' | 'completed' | 'overdue' | 'upcoming', userId?: string, referenceNo?: string) => {
    const params = new URLSearchParams({ filter })
    if (userId) params.set('user_id', userId)
    if (referenceNo) params.set('reference_no', referenceNo)
    const key = genericLogicalKey('checklist:occurrences', { filter, user_id: userId, reference_no: referenceNo })
    const cached = sessionApiCacheGet<{ occurrences: ChecklistOccurrence[] }>(key)
    if (cached) return Promise.resolve(cached)
    return apiClient.get<{ occurrences: ChecklistOccurrence[] }>(`/checklist/occurrences?${params}`).then((r) => {
      sessionApiCacheSet(key, r.data, API_CACHE_TTL_MS.checklistOccurrences)
      return r.data
    })
  },

  createTask: async (data: { task_name: string; department: string; frequency: string; start_date: string }) => {
    const r = await apiClient.post<ChecklistTask>('/checklist/tasks', data)
    sessionApiCacheClearLogicalPrefix('checklist:tasks:')
    sessionApiCacheClearLogicalPrefix('checklist:occurrences:')
    return r.data
  },

  completeTask: async (taskId: string, occurrenceDate: string) => {
    const r = await apiClient.post(`/checklist/tasks/${taskId}/complete`, { occurrence_date: occurrenceDate })
    sessionApiCacheClearLogicalPrefix('checklist:occurrences:')
    return r.data
  },

  bulkComplete: async (items: { task_id: string; occurrence_date: string }[]) => {
    const r = await apiClient.post<{
      ok: { task_id: string; occurrence_date: string }[]
      failed: { task_id?: string; occurrence_date?: string; detail: string }[]
    }>('/checklist/tasks/bulk-complete', { items })
    sessionApiCacheClearLogicalPrefix('checklist:occurrences:')
    return r.data
  },

  getUsers: async () => {
    const key = 'checklist:users'
    const cached = sessionApiCacheGet<{ users: { id: string; full_name: string }[] }>(key)
    if (cached) return cached
    const r = await apiClient.get<{ users: { id: string; full_name: string }[] }>('/checklist/users')
    sessionApiCacheSet(key, r.data, API_CACHE_TTL_MS.checklistUsers)
    return r.data
  },

  uploadHolidays: (year: number, holidays: { holiday_date: string; holiday_name: string }[]) =>
    apiClient.post('/checklist/holidays/upload', { year, holidays }).then((r) => r.data),

  getNaActive: (userId?: string) => {
    const params = new URLSearchParams()
    if (userId) params.set('user_id', userId)
    const q = params.toString()
    return apiClient
      .get<{ tasks: ChecklistNaTask[]; count: number; doer_name: string; user_id: string }>(
        `/checklist/na-active${q ? `?${q}` : ''}`,
      )
      .then((r) => r.data)
  },

  /** Mark entire checklist task NA (all dates — today, overdue, upcoming). */
  markTaskNa: async (taskId: string) => {
    const r = await apiClient.post<{
      success: boolean
      reference_no?: string
      task_name?: string
      marked_na?: boolean
      already_marked_na?: boolean
    }>(`/checklist/tasks/${taskId}/mark-na`, {})
    sessionApiCacheClearLogicalPrefix('checklist:tasks:')
    sessionApiCacheClearLogicalPrefix('checklist:occurrences:')
    return r.data
  },
}
