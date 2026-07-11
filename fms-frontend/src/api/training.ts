import { apiClient } from './axios'
import { API_ENDPOINTS } from '../utils/constants'
import {
  API_CACHE_TTL_MS,
  sessionApiCacheClearLogicalPrefix,
  sessionApiCacheGet,
  sessionApiCacheSet,
} from '../utils/sessionApiCache'

export interface TrainingClientRecord {
  payment_status_id: string
  company_name: string
  onboarding_reference_no: string
  timestamp: string
  client_reference_no: string
  has_assignment?: boolean
  poc_name?: string | null
  trainer_user_id?: string | null
  trainer_name?: string | null
  assignment_created_at?: string | null
  expected_day0?: string | null
  day0_status?: 'pending' | 'on_time' | 'delayed'
  day0_completed_in_text?: string | null
  day0_delay_text?: string | null
  day0_submitted_at?: string | null
  day0_skipped?: boolean
  day1_minus2_submitted_at?: string | null
  day1_submitted_at?: string | null
  day1_planed_iso?: string | null
  day1_delay_text?: string | null
  day1_plus1_submitted_at?: string | null
  day1_minus2_skipped?: boolean
  day1_skipped?: boolean
  day1_plus1_skipped?: boolean
  day2_skipped?: boolean
  day3_skipped?: boolean
  feedback_skipped?: boolean
  day2_planed_iso?: string | null
  day2_delay_text?: string | null
  day2_submitted_at?: string | null
  day3_planed_iso?: string | null
  day3_submitted_at?: string | null
  feedback_submitted_at?: string | null
}

export interface TrainingUser {
  id: string
  full_name: string
}

export interface TrainingDay0ChecklistResponse {
  data: Record<string, string>
  submitted_at: string | null
  editable_until?: string | null
  editable_48h?: boolean
  trainer_name?: string | null
}

export interface TrainingStageStatus {
  data: Record<string, string>
  submitted_at: string | null
  editable_48h: boolean
  editable_until?: string | null
}

export interface TrainingStatusResponse {
  day0_submitted: boolean
  day0_submitted_at: string | null
  stages: Record<string, TrainingStageStatus>
  next_stage: string | null
}

export interface TrainingStagesConfigResponse {
  order: string[]
  stages: Record<string, { title: string; fields: [string, string][] }>
}

export const trainingApi = {
  listClients: async () => {
    const key = 'training:clients:list:v2'
    const cached = sessionApiCacheGet<{ items: TrainingClientRecord[] }>(key)
    if (cached) return cached
    const pageSize = 200
    let page = 1
    let total = 0
    const items: TrainingClientRecord[] = []
    do {
      const r = await apiClient.get<{ items?: TrainingClientRecord[]; data?: TrainingClientRecord[]; total?: number }>(
        API_ENDPOINTS.TRAINING.CLIENTS,
        { params: { page, page_size: pageSize } },
      )
      const body = r.data
      const batch = body.items ?? body.data ?? []
      items.push(...batch)
      total = body.total ?? items.length
      page += 1
    } while (items.length < total && page <= 50)
    const payload = { items }
    sessionApiCacheSet(key, payload, API_CACHE_TTL_MS.trainingClientsList)
    return payload
  },

  createAssignment: async (paymentStatusId: string, payload: { poc_name: string; trainer_user_id: string; expected_day0?: string | null }) => {
    const r = await apiClient.post<{ message: string }>(API_ENDPOINTS.TRAINING.ASSIGN(paymentStatusId), payload)
    sessionApiCacheClearLogicalPrefix('training:clients:list')
    return r.data
  },

  updateAssignment: async (paymentStatusId: string, payload: { poc_name?: string; trainer_user_id?: string; expected_day0?: string | null }) => {
    const r = await apiClient.put<{ message: string }>(API_ENDPOINTS.TRAINING.ASSIGN(paymentStatusId), payload)
    sessionApiCacheClearLogicalPrefix('training:clients:list')
    return r.data
  },

  listUsers: async () => {
    const key = 'training:users'
    const cached = sessionApiCacheGet<{ users?: TrainingUser[]; data?: TrainingUser[] }>(key)
    if (cached) {
      const users = cached.users ?? (Array.isArray(cached.data) ? cached.data : [])
      return { users }
    }
    const pageSize = 200
    let page = 1
    let total = 0
    const users: TrainingUser[] = []
    do {
      const r = await apiClient.get<{ users?: TrainingUser[]; data?: TrainingUser[]; total?: number }>(
        API_ENDPOINTS.TRAINING.USERS,
        { params: { page, page_size: pageSize } },
      )
      const batch = r.data.users ?? r.data.data ?? []
      users.push(...batch)
      total = r.data.total ?? users.length
      page += 1
    } while (users.length < total && page <= 50)
    const payload = { users }
    sessionApiCacheSet(key, payload, API_CACHE_TTL_MS.trainingUsers)
    return payload
  },

  getDay0Checklist: (paymentStatusId: string) =>
    apiClient
      .get<TrainingDay0ChecklistResponse>(API_ENDPOINTS.TRAINING.DAY0(paymentStatusId))
      .then((r) => r.data),

  saveDay0Checklist: (paymentStatusId: string, data: Record<string, string>) =>
    apiClient
      .post<TrainingDay0ChecklistResponse>(API_ENDPOINTS.TRAINING.DAY0(paymentStatusId), { data })
      .then((r) => {
        sessionApiCacheClearLogicalPrefix('training:clients:list')
        return r.data
      }),

  getStagesConfig: () =>
    apiClient
      .get<TrainingStagesConfigResponse>(API_ENDPOINTS.TRAINING.STAGES_CONFIG)
      .then((r) => r.data),

  getTrainingStatus: (paymentStatusId: string) =>
    apiClient
      .get<TrainingStatusResponse>(API_ENDPOINTS.TRAINING.TRAINING_STATUS(paymentStatusId))
      .then((r) => r.data),

  getStage: (paymentStatusId: string, stageKey: string) =>
    apiClient
      .get<{ data: Record<string, string>; submitted_at: string | null; editable_48h: boolean }>(
        API_ENDPOINTS.TRAINING.STAGE(paymentStatusId, stageKey)
      )
      .then((r) => r.data),

  saveStage: (paymentStatusId: string, stageKey: string, data: Record<string, string>) =>
    apiClient
      .post<{ data: Record<string, string>; submitted_at: string }>(
        API_ENDPOINTS.TRAINING.STAGE(paymentStatusId, stageKey),
        { data }
      )
      .then((r) => {
        sessionApiCacheClearLogicalPrefix('training:clients:list')
        return r.data
      }),

  getAvailableForManual: () =>
    apiClient
      .get<{ items: { payment_status_id: string; company_name: string; reference_no: string; timestamp?: string }[] }>(
        API_ENDPOINTS.TRAINING.AVAILABLE_FOR_MANUAL
      )
      .then((r) => r.data),

  addManualClient: (paymentStatusId: string) =>
    apiClient
      .post<{ message: string; payment_status_id: string }>(API_ENDPOINTS.TRAINING.MANUAL_ADD, {
        payment_status_id: paymentStatusId,
      })
      .then((r) => {
        sessionApiCacheClearLogicalPrefix('training:clients:list')
        return r.data
      }),
}
