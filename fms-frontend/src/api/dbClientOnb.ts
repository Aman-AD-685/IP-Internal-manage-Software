import { apiClient } from './axios'
import { API_ENDPOINTS } from '../utils/constants'
import {
  API_CACHE_TTL_MS,
  sessionApiCacheClearLogicalPrefix,
  sessionApiCacheGet,
  sessionApiCacheSet,
} from '../utils/sessionApiCache'

export interface ClientOnbRecord {
  id: string
  timestamp: string
  reference_no: string
  organization_name?: string | null
  company_name?: string | null
  contact_person?: string | null
  mobile_no?: string | null
  email_id?: string | null
  paid_divisions?: string | null
  division_abbreviation?: string | null
  name_of_divisions_cost_details?: string | null
  amount_paid_per_division?: string | null
  total_amount_paid_per_month?: string | null
  payment_frequency?: string | null
  client_since?: string | null
  client_till?: string | null
  client_duration?: string | null
  total_amount_paid_till_date?: string | null
  tds_percent?: string | null
  client_location_city?: string | null
  client_location_state?: string | null
  remarks?: string | null
  whatsapp_group_details?: string | null
  updated_at?: string | null
  /** 'active' | 'inactive'; missing rows treated as active */
  status?: string | null
  last_contacted_on?: string | null
  remarks_2?: string | null
  follow_up_needed?: string | null
}

export type ClientOnbPayload = {
  organization_name?: string | null
  company_name?: string | null
  contact_person?: string | null
  mobile_no?: string | null
  email_id?: string | null
  paid_divisions?: string | null
  division_abbreviation?: string | null
  name_of_divisions_cost_details?: string | null
  amount_paid_per_division?: string | null
  total_amount_paid_per_month?: string | null
  payment_frequency?: string | null
  client_since?: string | null
  client_till?: string | null
  client_duration?: string | null
  total_amount_paid_till_date?: string | null
  tds_percent?: string | null
  client_location_city?: string | null
  client_location_state?: string | null
  remarks?: string | null
  whatsapp_group_details?: string | null
}

export const dbClientOnbApi = {
  checkStatusColumn: () =>
    apiClient
      .get<{ ok: boolean; hint?: string }>(API_ENDPOINTS.DB_CLIENT.CLIENT_ONB_STATUS_COLUMN_CHECK)
      .then((r) => r.data),

  list: async () => {
    const key = 'db-client:onb:list'
    const cached = sessionApiCacheGet<{ items: ClientOnbRecord[] }>(key)
    if (cached) return cached
    const r = await apiClient.get<{ items: ClientOnbRecord[] }>(API_ENDPOINTS.DB_CLIENT.CLIENT_ONB_LIST)
    sessionApiCacheSet(key, r.data, API_CACHE_TTL_MS.dbClientOnbList)
    return r.data
  },

  get: (id: string) =>
    apiClient.get<ClientOnbRecord>(API_ENDPOINTS.DB_CLIENT.CLIENT_ONB_UPDATE(id)).then((r) => r.data),

  create: async (payload: ClientOnbPayload) => {
    const r = await apiClient.post<ClientOnbRecord>(API_ENDPOINTS.DB_CLIENT.CLIENT_ONB_LIST, payload)
    sessionApiCacheClearLogicalPrefix('db-client:onb:list')
    return r.data
  },

  update: async (id: string, payload: ClientOnbPayload) => {
    const r = await apiClient.put<ClientOnbRecord>(API_ENDPOINTS.DB_CLIENT.CLIENT_ONB_UPDATE(id), payload)
    sessionApiCacheClearLogicalPrefix('db-client:onb:list')
    return r.data
  },

  setStatus: async (id: string, status: 'active' | 'inactive') => {
    const r = await apiClient.patch<ClientOnbRecord>(API_ENDPOINTS.DB_CLIENT.CLIENT_ONB_STATUS(id), { status })
    sessionApiCacheClearLogicalPrefix('db-client:onb:list')
    return r.data
  },

  patchFollowUp: (
    id: string,
    payload: {
      last_contacted_on?: string | null
      remarks_2?: string | null
      follow_up_needed?: string | null
    }
  ) => {
    return apiClient
      .patch<ClientOnbRecord>(API_ENDPOINTS.DB_CLIENT.CLIENT_ONB_FOLLOW_UP(id), payload)
      .then((r) => {
        sessionApiCacheClearLogicalPrefix('db-client:onb:list')
        return r.data
      })
  },
}
