import { apiClient } from './axios'
import {
  API_CACHE_TTL_MS,
  genericLogicalKey,
  sessionApiCacheClearLogicalPrefix,
  sessionApiCacheSet,
} from '../utils/sessionApiCache'

export interface DelegationTask {
  id: string
  title: string
  assignee_id: string
  assignee_name?: string
  due_date: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  created_at: string
  delegation_on?: string
  submission_date?: string
  has_document?: 'yes' | 'no'
  document_url?: string
  submitted_by?: string
  submitted_by_name?: string
  reference_no?: string
  completed_at?: string
  /** Auto-advanced when submission_date passed */
  shift_count?: number
  shift_history?: { from: string; to: string; shifted_on: string }[]
  last_assigned_date?: string
}

export interface CreateDelegationTaskPayload {
  title: string
  assignee_id: string
  due_date: string
  delegation_on?: string
  submission_date?: string
  has_document?: 'yes' | 'no'
  document_url?: string
  submitted_by?: string
}

export const delegationApi = {
  getUsers: async () => {
    const key = 'delegation:users'
    const cached = sessionApiCacheGet<{ users: { id: string; full_name: string }[] }>(key)
    if (cached) return cached
    const r = await apiClient.get<{ users: { id: string; full_name: string }[] }>('/delegation/users')
    sessionApiCacheSet(key, r.data, API_CACHE_TTL_MS.delegationUsers)
    return r.data
  },

  getTasks: async (params?: { status?: string; assignee_id?: string; reference_no?: string }) => {
    const key = genericLogicalKey('delegation:tasks', params)
    // Always hit network so assignee sees admin-created tasks immediately.
    // DelegationPage still paints from session cache for instant first paint.
    const r = await apiClient.get<{ tasks: DelegationTask[] }>('/delegation/tasks', { params })
    sessionApiCacheSet(key, r.data, API_CACHE_TTL_MS.delegationTasks)
    return r.data
  },

  createTask: async (data: CreateDelegationTaskPayload) => {
    const r = await apiClient.post<DelegationTask>('/delegation/tasks', data)
    sessionApiCacheClearLogicalPrefix('delegation:tasks:')
    return r.data
  },

  updateTask: async (taskId: string, data: Partial<Pick<DelegationTask, 'status' | 'title' | 'due_date' | 'assignee_id' | 'delegation_on' | 'submission_date' | 'has_document' | 'document_url' | 'submitted_by' | 'completed_at'>>) => {
    const r = await apiClient.put<DelegationTask>(`/delegation/tasks/${taskId}`, data)
    sessionApiCacheClearLogicalPrefix('delegation:tasks:')
    return r.data
  },

  bulkUpdate: async (ids: string[], status: 'completed' | 'cancelled', document_url?: string) => {
    const r = await apiClient.post<{
      ok: string[]
      failed: { id: string; detail: string }[]
    }>('/delegation/tasks/bulk-update', {
      ids,
      status,
      ...(document_url ? { document_url } : {}),
    })
    sessionApiCacheClearLogicalPrefix('delegation:tasks:')
    return r.data
  },
}
