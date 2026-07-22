import { apiClient } from './axios'

export type BotProtectEvent = {
  id?: string
  created_at?: string
  event_type?: string
  page?: string | null
  email?: string | null
  user_id?: string | null
  client_ip?: string | null
  user_agent?: string | null
  strike_count?: number | null
  account_deactivated?: boolean
  detail?: string | null
}

export type BotOpenStrike = {
  key: string
  kind: string
  identity: string
  strike_count: number
  last_at?: string
  limit?: number
}

export const botProtectApi = {
  listEvents: async (limit = 100) => {
    const r = await apiClient.get<{
      success?: boolean
      items: BotProtectEvent[]
      open_strikes: BotOpenStrike[]
      hint?: string
    }>('/bot-protect/events', { params: { limit } })
    return r.data
  },
}
