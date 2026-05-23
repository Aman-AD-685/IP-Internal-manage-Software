import { apiClient } from './axios'
import {
  API_CACHE_TTL_MS,
  sessionApiCacheGet,
  sessionApiCacheSet,
  invalidateAfterImprovementI1Mutation,
} from '../utils/sessionApiCache'

export type ImprovementStatus = 'done' | 'not_done'

export interface ImprovementSuggestion {
  id: string
  reference_no: string
  suggestion_text: string
  created_by: string
  user_display_name?: string
  status: ImprovementStatus
  created_at?: string
  done_at?: string | null
  updated_at?: string
}

const I1_LIST_KEY = 'improvement-i1:list'

export const improvementSuggestionsApi = {
  me: () =>
    apiClient.get<{ user_id: string; user_display_name: string; email?: string }>(
      '/improvement-suggestions/me',
    ),

  list: async (options?: { skipCache?: boolean }) => {
    if (!options?.skipCache) {
      const cached = sessionApiCacheGet<{ data: ImprovementSuggestion[]; can_edit: boolean }>(I1_LIST_KEY)
      if (cached?.data) return { data: cached }
    }
    const r = await apiClient.get<{ data: ImprovementSuggestion[]; can_edit: boolean }>(
      '/improvement-suggestions',
    )
    sessionApiCacheSet(I1_LIST_KEY, r.data, API_CACHE_TTL_MS.improvementI1List)
    return r
  },

  prefetchList: () => {
    void improvementSuggestionsApi.list().catch(() => {})
  },

  create: (suggestion_text: string) =>
    apiClient.post<{ success: boolean; data: ImprovementSuggestion }>('/improvement-suggestions', {
      suggestion_text,
    }),

  update: (
    id: string,
    payload: Partial<{
      reference_no: string
      suggestion_text: string
      status: ImprovementStatus
    }>,
  ) =>
    apiClient.patch<{
      success: boolean
      data: ImprovementSuggestion
      email_sent?: boolean
      email_error?: string
    }>(`/improvement-suggestions/${id}`, payload),

  remove: (id: string) =>
    apiClient.delete<{ success: boolean; reference_no?: string }>(
      `/improvement-suggestions/${id}`,
    ),
}

export function invalidateImprovementI1Cache(): void {
  invalidateAfterImprovementI1Mutation()
}
