import { apiClient } from './axios'

export type ImprovementStatus = 'done' | 'not_done'

export interface ImprovementSuggestion {
  id: string
  reference_no: string
  suggestion_text: string
  created_by: string
  user_display_name?: string
  status: ImprovementStatus
  created_at?: string
  updated_at?: string
}

export const improvementSuggestionsApi = {
  me: () =>
    apiClient.get<{ user_id: string; user_display_name: string; email?: string }>(
      '/improvement-suggestions/me',
    ),

  list: () =>
    apiClient.get<{ data: ImprovementSuggestion[]; can_edit: boolean }>('/improvement-suggestions'),

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
    apiClient.patch<{ success: boolean; data: ImprovementSuggestion }>(
      `/improvement-suggestions/${id}`,
      payload,
    ),

  remove: (id: string) =>
    apiClient.delete<{ success: boolean; reference_no?: string }>(
      `/improvement-suggestions/${id}`,
    ),
}
