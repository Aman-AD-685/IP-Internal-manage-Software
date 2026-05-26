import { apiClient } from './axios'
import type { SuccessKpiResponse } from './dashboardKpi'
import {
  API_CACHE_TTL_MS,
  sessionApiCacheGet,
  sessionApiCacheRemove,
  sessionApiCacheSet,
  invalidateAfterDashboardPaymentSubmit,
} from '../utils/sessionApiCache'

export interface DashboardMetrics {
  all_tickets: number
  pending_till_date: number
  total_pending_bug_till_date: number
  pending_till_date_exclude_demo_c: number
  pending_chores_include_demo_c: number
  feature_excluding_demo_c: number
  feature_with_demo_c: number
  custom_received_monthly?: number
  custom_received_quarterly?: number
  custom_received_half_yearly?: number
  custom_received_yearly?: number
  custom_total_due?: number
  custom_total_due_quarter?: number
  custom_raised_quarter?: number
  /** Gross raised across all invoices (excl. NA); pairs with Payment card denominator */
  custom_raised_all?: number
  /** Cash received in current India FY quarter — matches Client Payment Overall / carry-forward logic */
  custom_received_in_fy_quarter?: number
  custom_pending_delegation?: number
  response_delay: number
  completion_delay: number
  total_last_week: number
  pending_last_week: number
  staging_pending_feature: number
  staging_pending_chores_bugs: number
}

export interface TrendPoint {
  month: string
  response_delay: number
  completion_delay: number
}

export interface DashboardDetailTicket {
  id: string
  referenceNo: string
  title: string
  description?: string
  type: string
  company: string
  status: string
  /** Client Payment row fields (custom_total_due / custom_total_rec_amount detail) */
  invoiceAmount?: number
  invoiceDate?: string
  invoiceNumber?: string
  stage?: string
  genre?: string
  agingDays?: number | null
  delegationOn?: string
}

export interface Stage2RemarkNotificationItem {
  id: string
  ticket_id: string
  reference_no: string
  ticket_type: string
  remark_text: string
  added_at: string
  added_by_name: string
  seen?: boolean
}

export interface Stage2RemarkNotificationResponse {
  count: number
  unread_count?: number
  items: Stage2RemarkNotificationItem[]
  expires_hours: number
}

export interface SuccessPerformanceListItem {
  id: string
  reference_no?: string
  company_name?: string
  completion_status?: string | null
  created_at?: string
  total_percentage?: number | null
  current_stage?: string
  training_schedule_date?: string | null
  has_training?: boolean
  feature_count?: number
}

export const dashboardApi = {
  /** Single request for metrics + trends (fast first paint). */
  getBootstrap: async (options?: { skipCache?: boolean }): Promise<{
    metrics: DashboardMetrics
    trends: TrendPoint[]
  }> => {
    const key = 'dashboard:bootstrap'
    if (!options?.skipCache) {
      const cached = sessionApiCacheGet<{ metrics: DashboardMetrics; trends: TrendPoint[] }>(key)
      if (cached?.metrics) return cached
    }
    const r = await apiClient.get<{ metrics: DashboardMetrics; trends: TrendPoint[] }>('/dashboard/bootstrap', {
      params: options?.skipCache ? { _: Date.now() } : undefined,
    })
    const body = {
      metrics: r.data.metrics,
      trends: Array.isArray(r.data.trends) ? r.data.trends : [],
    }
    sessionApiCacheSet(key, body, API_CACHE_TTL_MS.dashboardMetrics)
    sessionApiCacheSet('dashboard:metrics', body.metrics, API_CACHE_TTL_MS.dashboardMetrics)
    sessionApiCacheSet('dashboard:trends', { data: body.trends }, API_CACHE_TTL_MS.dashboardTrends)
    return body
  },

  getMetrics: async (options?: { skipCache?: boolean }): Promise<DashboardMetrics> => {
    const key = 'dashboard:metrics'
    if (!options?.skipCache) {
      const cached = sessionApiCacheGet<DashboardMetrics>(key)
      if (cached) return cached
    }
    const r = await apiClient.get<DashboardMetrics>('/dashboard/metrics', {
      params: options?.skipCache ? { _: Date.now() } : undefined,
    })
    sessionApiCacheSet(key, r.data, API_CACHE_TTL_MS.dashboardMetrics)
    return r.data
  },
  getDetail: async (metric: string): Promise<{ success: boolean; metric: string; tickets: DashboardDetailTicket[]; total: number }> => {
    const key = `dashboard:detail:${metric}`
    const cached = sessionApiCacheGet<{ success: boolean; metric: string; tickets: DashboardDetailTicket[]; total: number }>(key)
    if (cached) return cached
    const r = await apiClient.get<{ success: boolean; metric: string; tickets: DashboardDetailTicket[]; total: number }>('/dashboard/detail', { params: { metric } })
    sessionApiCacheSet(key, r.data, API_CACHE_TTL_MS.dashboardDetail)
    return r.data
  },
  getTrends: async (): Promise<{ data: TrendPoint[] }> => {
    const key = 'dashboard:trends'
    const cached = sessionApiCacheGet<{ data: TrendPoint[] }>(key)
    if (cached) return cached
    const r = await apiClient.get<{ data: TrendPoint[] }>('/dashboard/trends')
    sessionApiCacheSet(key, r.data, API_CACHE_TTL_MS.dashboardTrends)
    return r.data
  },
  getActivityCount: async (): Promise<number> => {
    const data = await dashboardApi.getStage2RemarkNotifications()
    return data.unread_count ?? data.count
  },

  getStage2RemarkNotifications: async (options?: {
    skipCache?: boolean
  }): Promise<Stage2RemarkNotificationResponse> => {
    const key = 'dashboard:stage2-remark-notifications'
    if (!options?.skipCache) {
      const cached = sessionApiCacheGet<Stage2RemarkNotificationResponse>(key)
      if (cached) return cached
    }
    const r = await apiClient.get<Stage2RemarkNotificationResponse>('/activity/stage2-remark-notifications')
    const data = r.data ?? { count: 0, unread_count: 0, items: [], expires_hours: 24 }
    const unread = data.unread_count ?? data.count
    const normalized = { ...data, count: unread, unread_count: unread }
    sessionApiCacheSet(key, normalized, API_CACHE_TTL_MS.stage2RemarkNotifications)
    sessionApiCacheSet('dashboard:activity-count', unread, API_CACHE_TTL_MS.stage2RemarkNotifications)
    return normalized
  },

  markStage2RemarkNotificationsSeen: async (remarkIds?: string[]) => {
    const r = await apiClient.post<{
      success: boolean
      marked: number
      unread_count: number
      count: number
    }>('/activity/stage2-remark-notifications/mark-seen', {
      remark_ids: remarkIds ?? [],
    })
    sessionApiCacheRemove('dashboard:stage2-remark-notifications')
    sessionApiCacheRemove('dashboard:activity-count')
    return r.data
  },
  getPaymentActions: async (): Promise<{
    items: Array<{
      client_payment_id: string
      company_name?: string
      invoice_number?: string
      reference_no?: string
      invoice_date?: string | null
      invoice_amount?: string | null
      genre?: string | null
      tagged_user_id?: string | null
      tagged_user_name?: string | null
      tagged_user_email?: string | null
      tagged_user_2_id?: string | null
      tagged_user_2_name?: string | null
      tagged_user_2_email?: string | null
      /** t1/t2 = pending action; completed = both T1+T2 payment actions submitted (read-only row) */
      pending_payment_tag?: 't1' | 't2' | 'completed'
    }>
  }> => {
    const key = 'dashboard:payment-actions'
    const cached = sessionApiCacheGet<{
      items: Array<{
        client_payment_id: string
        company_name?: string
        invoice_number?: string
        reference_no?: string
        invoice_date?: string | null
        invoice_amount?: string | null
        genre?: string | null
        tagged_user_id?: string | null
        tagged_user_name?: string | null
        tagged_user_email?: string | null
        tagged_user_2_id?: string | null
        tagged_user_2_name?: string | null
        tagged_user_2_email?: string | null
        pending_payment_tag?: 't1' | 't2' | 'completed'
      }>
    }>(key)
    if (cached) return cached
    const r = await apiClient.get<{
      items: Array<{
        client_payment_id: string
        company_name?: string
        invoice_number?: string
        reference_no?: string
        invoice_date?: string | null
        invoice_amount?: string | null
        genre?: string | null
        tagged_user_id?: string | null
        tagged_user_name?: string | null
        tagged_user_email?: string | null
        tagged_user_2_id?: string | null
        tagged_user_2_name?: string | null
        tagged_user_2_email?: string | null
        pending_payment_tag?: 't1' | 't2' | 'completed'
      }>
    }>('/dashboard/payment-actions')
    sessionApiCacheSet(key, r.data, API_CACHE_TTL_MS.dashboardPaymentActions)
    return r.data
  },
  submitPaymentAction: async (body: {
    client_payment_id: string
    person: string
    remarks: string
    /** T1 = first Payment Action; T2 = second after Tag 2 */
    tag?: 't1' | 't2'
  }): Promise<{ success: boolean }> => {
    const r = await apiClient.post<{ success: boolean }>('/dashboard/payment-actions/submit', body)
    invalidateAfterDashboardPaymentSubmit()
    return r.data
  },
  getSuccessPerformanceList: async (
    completionStatus: 'in_progress' | 'completed',
  ): Promise<{ items: SuccessPerformanceListItem[] }> => {
    const key = `dashboard:success-performance-list:${completionStatus}`
    const cached = sessionApiCacheGet<{ items: SuccessPerformanceListItem[] }>(key)
    if (cached) return cached
    const r = await apiClient.get<{ items: SuccessPerformanceListItem[] }>(
      '/success/performance/list',
      { params: { completion_status: completionStatus } },
    )
    sessionApiCacheSet(key, r.data, API_CACHE_TTL_MS.dashboardSuccessPerformanceList)
    return r.data
  },
  getSuccessKpiTillDate: async (): Promise<{
    success: boolean
    rangeStart?: string
    tillDate?: string
    successKpi?: SuccessKpiResponse | null
    error?: string
  }> => {
    const key = 'dashboard:success-kpi-till-date'
    const cached = sessionApiCacheGet<{
      success: boolean
      rangeStart?: string
      tillDate?: string
      successKpi?: SuccessKpiResponse | null
      error?: string
    }>(key)
    if (cached) return cached
    const r = await apiClient.get<{
      success: boolean
      rangeStart?: string
      tillDate?: string
      successKpi?: SuccessKpiResponse | null
      error?: string
    }>('/dashboard/success-kpi-till-date')
    sessionApiCacheSet(key, r.data, API_CACHE_TTL_MS.dashboardSuccessKpi)
    return r.data
  },
}
