import { apiClient } from './axios'
import type { Ticket } from './tickets'

export type SoftSuggestionType = 'chore' | 'bug' | 'feature'
export type SoftSuggestionStatus = 'open' | 'moved'

export interface SoftSuggestion {
  id: string
  reference_no: string
  suggestion_text: string
  attach_link?: string | null
  page_id?: string | null
  page_name?: string | null
  ticket_type: SoftSuggestionType
  created_by: string
  user_display_name?: string
  status: SoftSuggestionStatus
  support_ticket_id?: string | null
  support_ticket_ref?: string | null
  created_at?: string
  updated_at?: string
}

export interface SoftSuggestionMe {
  user_id: string
  user_display_name: string
  email?: string
  pages: { id: string; name: string }[]
}

export const softSuggestionsApi = {
  me: () => apiClient.get<SoftSuggestionMe>('/soft-suggestions/me'),

  list: () =>
    apiClient.get<{
      data: SoftSuggestion[]
      can_edit_all: boolean
      can_edit_move: boolean
    }>('/soft-suggestions'),

  create: (payload: {
    suggestion_text: string
    attach_link?: string
    page_id?: string
    ticket_type: SoftSuggestionType
  }) => apiClient.post<{ success: boolean; data: SoftSuggestion }>('/soft-suggestions', payload),

  update: (
    id: string,
    payload: Partial<{
      reference_no: string
      suggestion_text: string
      attach_link: string
      page_id: string
      ticket_type: SoftSuggestionType
    }>,
  ) => apiClient.patch<{ success: boolean; data: SoftSuggestion }>(`/soft-suggestions/${id}`, payload),

  linkTicket: (id: string, ticket_id: string) =>
    apiClient.post<{ success: boolean; data: SoftSuggestion }>(`/soft-suggestions/${id}/link-ticket`, {
      ticket_id,
    }),

  remove: (id: string) => apiClient.delete<{ success: boolean }>(`/soft-suggestions/${id}`),
}

export type SupportFormPrefill = {
  title?: string
  description?: string
  type_of_request?: SoftSuggestionType
  page_id?: string
  attachment_url?: string
  submitted_by?: string
}

export function buildSupportPrefillFromSoftSuggestion(row: SoftSuggestion): SupportFormPrefill {
  const text = row.suggestion_text || ''
  return {
    title: text.length > 120 ? `${text.slice(0, 117)}...` : text,
    description: text,
    type_of_request: row.ticket_type,
    page_id: row.page_id || undefined,
    attachment_url: row.attach_link || undefined,
    submitted_by: row.user_display_name,
  }
}

export type { Ticket }
