import { apiClient } from './axios'
import { API_CACHE_TTL_MS, sessionApiCacheGet, sessionApiCacheSet } from '../utils/sessionApiCache'

export interface WeeklyStats {
  totalTickets: number
  totalChores: number
  totalBugs: number
  completed: number
  pendingBugs: number
  pendingChores: number
  responseDelay: number
  completionDelay: number
}

export interface WeekData {
  weekNumber: number
  weekDateRange: string
  success: boolean
  stats: WeeklyStats
}

export interface SupportDashboardStats {
  success: boolean
  weeksData: WeekData[]
  pendingItems: {
    grouped: {
      chores: { '1-2': unknown[]; '2-7': unknown[]; '7+': unknown[]; hold: unknown[] }
      bugs: { '1-2': unknown[]; '2-7': unknown[]; '7+': unknown[]; hold: unknown[] }
    }
  }
  counts?: {
    chores: { '1-2': number; '2-7': number; '7+': number; hold: number }
    bugs: { '1-2': number; '2-7': number; '7+': number; hold: number }
  }
  monthlyTopCompanies: {
    chores: { company: string; requests: number }[]
    bugs: { company: string; requests: number }[]
    period: string
  }
  statistics: {
    totalChores: number
    totalBugs: number
    onHoldChores: number
    onHoldBugs: number
  }
  featureMetrics?: {
    total: number
    pending: number
  }
  summary: {
    period: string
    lastUpdated: string
  }
}

export const supportDashboardApi = {
  getStats: async (options?: { skipCache?: boolean }): Promise<SupportDashboardStats> => {
    const key = 'support-dashboard:stats'
    if (!options?.skipCache) {
      const cached = sessionApiCacheGet<SupportDashboardStats>(key)
      if (cached?.weeksData) return cached
    }
    const r = await apiClient.get<SupportDashboardStats>('/support-dashboard/stats')
    sessionApiCacheSet(key, r.data, API_CACHE_TTL_MS.dashboardMetrics)
    return r.data
  },
  getFiltered: async (filterType: string, category: string) => {
    const r = await apiClient.get('/support-dashboard/filtered', {
      params: { filter_type: filterType, category },
    })
    return r.data
  },
  getWeeklyDetails: async (weekNumber: number, months: string, years: string, ticketType: string) => {
    const r = await apiClient.get('/support-dashboard/weekly-details', {
      params: { week_number: weekNumber, months, years, ticket_type: ticketType },
    })
    return r.data
  },
  getFeatureTickets: async (filterType: 'all' | 'pending') => {
    const r = await apiClient.get('/support-dashboard/feature-tickets', {
      params: { filter_type: filterType },
    })
    return r.data
  },
}
