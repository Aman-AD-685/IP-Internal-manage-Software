import { apiClient } from './axios'
import type { ApiResponse, PaginatedResponse } from './types'
import {
  API_CACHE_TTL_MS,
  sessionApiCacheGet,
  sessionApiCacheSet,
  ticketsListLogicalKey,
  ticketGetLogicalKey,
  invalidateAfterTicketMutation,
} from '../utils/sessionApiCache'

export interface Ticket {
  id: string
  reference_no: string
  title: string
  description?: string
  type: 'chore' | 'bug' | 'feature'
  status: 'open' | 'in_progress' | 'resolved' | 'closed' | 'cancelled' | 'on_hold'
  priority: 'low' | 'medium' | 'high' | 'critical' | 'urgent'
  created_by: string
  assignee_id?: string
  created_at: string
  updated_at: string
  resolved_at?: string
  closed_at?: string
  resolution_notes?: string
  company_id?: string
  company_name?: string
  page_id?: string
  page_name?: string
  division_id?: string
  division_name?: string
  division_other?: string
  user_name?: string
  communicated_through?: string
  submitted_by?: string
  query_arrival_at?: string
  query_response_at?: string
  quality_of_response?: string
  customer_questions?: string
  why_feature?: string
  attachment_url?: string
  approval_status?: 'approved' | 'unapproved' | 'rejected' | 'hold' | null
  approval_actual_at?: string
  unapproval_actual_at?: string
  approved_by?: string
  approved_by_name?: string
  approval_source?: 'ui' | 'email'
  remarks?: string
  actual_time_seconds?: number
  // SLA stages (Chores & Bugs)
  status_1?: 'yes' | 'no'
  actual_1?: string
  planned_2?: string
  status_2?: 'completed' | 'pending' | 'staging' | 'hold' | 'na' | 'rejected'
  actual_2?: string
  planned_3?: string
  status_3?: 'completed' | 'pending' | 'hold' | 'rejected' | 'na'
  actual_3?: string
  planned_4?: string
  status_4?: 'completed' | 'pending' | 'na'
  actual_4?: string
  quality_solution?: string
  quality_solution_submitted_by?: string
  quality_solution_submitted_at?: string
  // Staging workflow (Stage 1–3)
  staging_planned?: string
  staging_review_actual?: string
  staging_review_status?: 'pending' | 'completed'
  live_planned?: string
  live_actual?: string
  live_status?: 'pending' | 'completed'
  live_review_planned?: string
  live_review_actual?: string
  live_review_status?: 'pending' | 'completed'
  /** Set by backend for Level 3 (user) role: true = this user has used their one-time edit; drawer is view-only except Stage 2 */
  level3_used_by_current_user?: boolean
  /** Stage locks: Admin/User can edit once; after that only Master Admin can edit */
  stage_1_locked?: boolean
  stage_2_locked?: boolean
  stage_3_locked?: boolean
  stage_4_locked?: boolean
  feature_stage_2_edit_used?: boolean
}

export interface TicketResponse {
  id: string
  ticket_id: string
  response_text: string
  responded_by: string
  responded_by_name?: string
  created_at: string
}

export interface Stage2Remark {
  id: string
  ticket_id: string
  remark_text: string
  added_by: string
  added_by_name?: string
  added_at: string
  updated_at?: string
}

export interface CreateTicketRequest {
  title: string
  description?: string
  type: 'chore' | 'bug' | 'feature'
  priority?: 'low' | 'medium' | 'high' | 'critical' | 'urgent'
  assignee_id?: string
  company_id?: string
  page_id?: string
  division_id?: string
  division_other?: string
  user_name?: string
  communicated_through?: string
  submitted_by?: string
  query_arrival_at?: string
  quality_of_response?: string
  customer_questions?: string
  query_response_at?: string
  why_feature?: string
  attachment_url?: string
}

export interface UpdateTicketRequest {
  title?: string
  description?: string
  company_id?: string
  page_id?: string
  division_id?: string
  division_other?: string
  user_name?: string
  communicated_through?: string
  submitted_by?: string
  query_arrival_at?: string
  quality_of_response?: string
  customer_questions?: string
  query_response_at?: string
  attachment_url?: string
  status?: Ticket['status']
  priority?: Ticket['priority']
  assignee_id?: string
  resolution_notes?: string
  remarks?: string
  approval_status?: 'approved' | 'unapproved' | 'rejected' | 'hold' | null
  approval_actual_at?: string
  unapproval_actual_at?: string
  status_1?: 'yes' | 'no'
  actual_1?: string
  planned_2?: string
  status_2?: 'completed' | 'pending' | 'staging' | 'hold' | 'na' | 'rejected'
  actual_2?: string
  planned_3?: string
  status_3?: 'completed' | 'pending' | 'hold' | 'rejected' | 'na'
  actual_3?: string
  planned_4?: string
  status_4?: 'completed' | 'pending' | 'na'
  actual_4?: string
  staging_planned?: string
  staging_review_status?: 'pending' | 'completed'
  staging_review_actual?: string
  live_planned?: string
  live_actual?: string
  live_status?: 'pending' | 'completed'
  live_review_status?: 'pending' | 'completed'
  live_review_actual?: string
}

export const ticketsApi = {
  list: async (params?: {
    page?: number
    limit?: number
    page_size?: number
    status?: string
    status_2_filter?: string  // Chores & Bugs / Feature: pending | completed | staging | hold | na | rejected
    type_filter?: string  // For Chores & Bugs: chore | bug (Type of Request)
    type?: string
    types_in?: string
    section?: string
    approval_filter?: string
    company_id?: string
    company_ids?: string[]
    priority?: string
    date_from?: string
    date_to?: string
    search?: string
    search_all_sections?: boolean
    reference_filter?: string
    sort_by?: string
    sort_order?: string
    skipCache?: boolean
    /** When true, only tickets created by the logged-in user. */
    mine_only?: boolean
    /** Date-range CSV/print: include all rows in section for the range (chores-bugs: not only open queue). */
    export_date_range?: boolean
  }): Promise<ApiResponse<PaginatedResponse<Ticket>>> => {
    const listKey = ticketsListLogicalKey(params as object | undefined)
    const skipCache = !!(params as { skipCache?: boolean } | undefined)?.skipCache
    const requestParams = params ? { ...params } : undefined
    if (requestParams && 'skipCache' in requestParams) {
      delete (requestParams as { skipCache?: boolean }).skipCache
    }
    const cached = skipCache ? null : sessionApiCacheGet<ApiResponse<PaginatedResponse<Ticket>>>(listKey)
    if (cached) return cached
    // Serialize arrays as repeated keys (company_ids=id1&company_ids=id2) so FastAPI receives list[str]
    const paramsSerializer = (p: Record<string, unknown>) => {
      const search = new URLSearchParams()
      Object.entries(p || {}).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') return
        if (Array.isArray(value)) {
          value.forEach((v) => search.append(key, String(v)))
        } else {
          search.append(key, String(value))
        }
      })
      return search.toString()
    }
    const response = await apiClient.get<ApiResponse<PaginatedResponse<Ticket>>>(
      '/tickets',
      { params: requestParams, paramsSerializer }
    )
    if (!skipCache) {
      sessionApiCacheSet(listKey, response.data, API_CACHE_TTL_MS.ticketsList)
    }
    return response.data
  },

  get: async (id: string): Promise<ApiResponse<Ticket>> => {
    const gKey = ticketGetLogicalKey(id)
    const cached = sessionApiCacheGet<ApiResponse<Ticket>>(gKey)
    if (cached) return cached
    const response = await apiClient.get<ApiResponse<Ticket>>(`/tickets/${id}`)
    sessionApiCacheSet(gKey, response.data, API_CACHE_TTL_MS.ticketGet)
    return response.data
  },

  create: async (data: CreateTicketRequest): Promise<ApiResponse<Ticket>> => {
    const response = await apiClient.post<ApiResponse<Ticket>>('/tickets', data)
    invalidateAfterTicketMutation()
    return response.data
  },

  update: async (id: string, data: UpdateTicketRequest): Promise<ApiResponse<Ticket>> => {
    const response = await apiClient.put<ApiResponse<Ticket>>(`/tickets/${id}`, data)
    invalidateAfterTicketMutation(id)
    return response.data
  },

  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/tickets/${id}`)
    invalidateAfterTicketMutation(id)
  },

  getResponses: async (ticketId: string): Promise<ApiResponse<{ data: TicketResponse[] }>> => {
    const response = await apiClient.get<ApiResponse<{ data: TicketResponse[] }>>(`/tickets/${ticketId}/responses`)
    return response.data
  },

  addResponse: async (ticketId: string, responseText: string): Promise<ApiResponse<TicketResponse>> => {
    const response = await apiClient.post<ApiResponse<TicketResponse>>(`/tickets/${ticketId}/responses`, {
      response_text: responseText,
    })
    invalidateAfterTicketMutation(ticketId)
    return response.data
  },

  submitQualitySolution: async (ticketId: string, qualitySolution: string): Promise<ApiResponse<Ticket>> => {
    const response = await apiClient.post<ApiResponse<Ticket>>(`/tickets/${ticketId}/quality-solution`, {
      quality_solution: qualitySolution,
    })
    invalidateAfterTicketMutation(ticketId)
    return response.data
  },

  markStaging: async (ticketId: string): Promise<ApiResponse<Ticket>> => {
    const response = await apiClient.post<ApiResponse<Ticket>>(`/tickets/${ticketId}/mark-staging`)
    invalidateAfterTicketMutation(ticketId)
    return response.data
  },

  stagingBack: async (ticketId: string): Promise<ApiResponse<Ticket>> => {
    const response = await apiClient.post<ApiResponse<Ticket>>(`/tickets/${ticketId}/staging-back`)
    invalidateAfterTicketMutation(ticketId)
    return response.data
  },

  getStage2Remarks: async (ticketId: string): Promise<ApiResponse<{ data: Stage2Remark[] }>> => {
    const response = await apiClient.get<ApiResponse<{ data: Stage2Remark[] }>>(`/tickets/${ticketId}/stage2-remarks`)
    return response.data
  },

  addStage2Remark: async (ticketId: string, remarkText: string): Promise<ApiResponse<Stage2Remark>> => {
    const response = await apiClient.post<ApiResponse<Stage2Remark>>(`/tickets/${ticketId}/stage2-remarks`, {
      remark_text: remarkText,
    })
    invalidateAfterTicketMutation(ticketId)
    return response.data
  },

  updateStage2Remark: async (ticketId: string, remarkId: string, remarkText: string): Promise<ApiResponse<Stage2Remark>> => {
    const response = await apiClient.put<ApiResponse<Stage2Remark>>(`/tickets/${ticketId}/stage2-remarks/${remarkId}`, {
      remark_text: remarkText,
    })
    invalidateAfterTicketMutation(ticketId)
    return response.data
  },
}
